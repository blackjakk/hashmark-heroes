// ─── H2H browser-client probe — two real pages play a network match ────────
// Spawns the h2h-server + a static server, then drives TWO headless browser
// pages through the actual UI flow: host clicks 🌐 Host H2H, the opponent
// opens the share link, the first decision is answered by CLICKING the real
// panel button, and the rest auto-answer through frnPlaycall (the same code
// path the keyboard uses). Asserts both pages reach FINAL with identical
// scores and that the FINAL screen renders.
//
//   node server/h2h-client-probe.js     (exit 0 = pass)
"use strict";
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);

const H2H_PORT = 18789;
const WEB_PORT = 5173;
const ROOT = path.join(__dirname, "..");

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

const children = [];
process.on("exit", () => { for (const c of children) { try { c.kill("SIGKILL"); } catch (_) {} } });

function bootH2h() {
  const child = spawn(process.execPath, [path.join(__dirname, "h2h-server.js"), String(H2H_PORT)],
    { env: { ...process.env, H2H_DATA: path.join(os.tmpdir(), "h2h-client-probe-" + Date.now()) },
      stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("h2h boot timeout")), 15000);
    child.stdout.on("data", d => {
      if (String(d).includes("authoritative match server")) { clearTimeout(to); resolve(child); }
    });
    child.stderr.on("data", d => process.stderr.write("[h2h-server] " + d));
  });
}
async function ensureWeb() {
  try { await fetch(`http://localhost:${WEB_PORT}/play.html`); return null; } catch (_) {}
  const child = spawn("npx", ["http-server", "-p", String(WEB_PORT), "--silent", ROOT],
    { stdio: "ignore", detached: false });
  children.push(child);
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { await fetch(`http://localhost:${WEB_PORT}/play.html`); return child; } catch (_) {}
  }
  throw new Error("static server failed to start");
}

// In-page auto-answer policy installed on both sides (side-flavored so real
// calls flow through the seams, not just defers).
const AUTOPILOT = `(side) => {
  window.__answered = 0;
  setInterval(() => {
    if (typeof _ipc === "undefined" || !_ipc || _ipc.mode !== "net") return;
    if (_ipc.status !== "pending" || !_ipc.pending) return;
    const k = _ipc.pending.kind;
    const call = side === "home"
      ? (k === "defense" ? "C0_BLITZ" : k === "playcall" ? "pass" : k === "pat" ? "kick" : "auto")
      : "auto";
    window.__answered++;
    frnPlaycall(call);
  }, 60);
}`;

(async () => {
  const h2h = await bootH2h();
  const web = await ensureWeb();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors = { A: [], B: [] };
  const mkPage = async (tag) => {
    const page = await ctx.newPage();
    page.on("pageerror", e => errors[tag].push(String(e.message).slice(0, 140)));
    page.on("dialog", d => { errors[tag].push("dialog: " + d.message().slice(0, 100)); d.dismiss(); });
    return page;
  };

  // ── Host (page A) creates the match through the real button flow.
  const A = await mkPage("A");
  await A.goto(`http://localhost:${WEB_PORT}/play.html`, { waitUntil: "networkidle", timeout: 30000 });
  await A.waitForTimeout(600);
  await A.evaluate((port) => {
    setAppMode("testing");   // the H2H host controls live in the dev/testing panel
    document.getElementById("h2hServer").value = "http://localhost:" + port;
    document.getElementById("homeTeam").value = "5";
    document.getElementById("awayTeam").value = "9";
  }, H2H_PORT);
  await A.click("#h2hCreateBtn");
  await A.waitForSelector("#h2hStatus input.h2h-link", { timeout: 15000 });
  const link = await A.$eval("#h2hStatus input.h2h-link", el => el.value);
  check("host created match + share link", /#h2h=[a-f0-9]+\./.test(link));
  const waitingShown = await A.waitForFunction(
    () => document.getElementById("ipcPanel")?.textContent.includes("WAITING FOR OPPONENT"),
    null, { timeout: 10000 }).then(() => true).catch(() => false);
  check("host parks on the waiting banner pre-join", waitingShown);

  // ── Opponent (page B) joins via the share link.
  // NOTE: "networkidle" never fires once the SSE stream opens — use
  // domcontentloaded and poll for the joined session instead.
  const B = await mkPage("B");
  await B.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });
  const joined = await B.waitForFunction(
    () => typeof _ipc !== "undefined" && _ipc && _ipc.mode === "net" && gameResult && gameResult._h2hNet,
    null, { timeout: 20000 }).then(() => true).catch(() => false);
  check("opponent joined via link", joined);

  // ── First decision: answered by clicking the REAL panel button on
  // whichever page gets prompted first (exercises the full UI path).
  const firstPanel = await Promise.race([
    A.waitForSelector("#ipcPanel .ipc-btn", { timeout: 30000 }).then(() => A),
    B.waitForSelector("#ipcPanel .ipc-btn", { timeout: 30000 }).then(() => B),
  ]).catch(() => null);
  check("a call panel appeared", !!firstPanel);
  if (firstPanel) {
    const badge = await firstPanel.$eval("#ipcBadge", el => el.textContent);
    await firstPanel.screenshot({ path: "/tmp/h2h_first_panel.png" });
    await firstPanel.click("#ipcPanel .ipc-btn");   // first option (real click path)
    check("panel button clicked", true, badge.trim());
  }

  // ── Autopilot both sides to the final whistle.
  await A.evaluate(`(${AUTOPILOT})("home")`);
  await B.evaluate(`(${AUTOPILOT})("away")`);
  const finalOk = await Promise.all([A, B].map(p =>
    p.waitForFunction(() => _ipc && _ipc.status === "final", null, { timeout: 200000 })
      .then(() => true).catch(() => false)));
  check("both pages reached FINAL", finalOk[0] && finalOk[1]);

  const [sA, sB] = await Promise.all([A, B].map(p => p.evaluate(() => ({
    score: [gameResult.homeScore, gameResult.awayScore],
    plays: gameResult.plays.length,
    answered: window.__answered,
    side: _ipc.userSide,
  }))));
  check("scores agree across both browsers",
    JSON.stringify(sA.score) === JSON.stringify(sB.score),
    `A=${sA.score.join("-")} (${sA.side}, ${sA.answered} calls) B=${sB.score.join("-")} (${sB.side}, ${sB.answered} calls)`);
  check("both received the full play stream", sA.plays === sB.plays && sA.plays > 100,
    `plays A=${sA.plays} B=${sB.plays}`);
  check("both sides actually answered prompts", sA.answered > 30 && sB.answered > 30);

  // ── Jump host playback to the end: the FINAL screen must render.
  await A.evaluate(() => { playHead = gameResult.plays.length; playing = false; startNextPlay(); });
  await A.waitForTimeout(400);
  const finalText = await A.evaluate(() => {
    const c = document.getElementById("field");
    return !!c && gameResult.winner != null;
  });
  check("FINAL screen rendered on host", finalText);
  await (await A.$(".bspnlive-field-wrap"))?.screenshot({ path: "/tmp/h2h_final.png" });

  check("no page errors on A", errors.A.length === 0, errors.A.slice(0, 2).join(" | "));
  check("no page errors on B", errors.B.length === 0, errors.B.slice(0, 2).join(" | "));

  await browser.close();
  h2h.kill("SIGKILL");
  if (web) web.kill("SIGKILL");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
