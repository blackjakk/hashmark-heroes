// _ipc_clock_probe.js — local play-clock + huddle-scene detector for solo
// interactive play-calling. Asserts: the prompt panel arms a play clock
// (20s on offensive prompts; a shorter randomized 8-13s window on DEFENSIVE
// prompts where the opposing OC decides first), expiry auto-defers to the
// OC/DC (null on the tape — byte-identical to pressing O), a manual call
// cancels the clock, and the huddle field scene runs while the prompt is up
// (offense breaks the huddle ~2.6s before a defensive deadline). Net matches
// are out of scope (the H2H server clock is authoritative there).
//
//   node tools/_ipc_clock_probe.js        (starts its own server :5198)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5198;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ FAIL " + l); } };
(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on("dialog", d => d.accept());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    let s = 0xC10C;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    frnPlayGameInteractive(1, 2);
  });
  const waitPrompt = () => page.waitForFunction(() => {
    const el = document.getElementById("ipcPanel");
    return el && el.style.display !== "none" && _ipc && _ipc.pending;
  }, { timeout: 60000 });
  await waitPrompt();

  // ── Clock arm + countdown (window depends on prompt kind) ───────────
  const a1 = await page.evaluate(() => ({
    kind: _ipc.pending?.kind || "playcall",
    txt: document.getElementById("ipcClock")?.textContent,
    winMs: _ipcClockDeadline - Date.now(),
    breakAt: _ipcHuddleBreakAt,
    huddle: typeof _huddleScene !== "undefined" && _huddleScene !== null,
  }));
  if (a1.kind === "defense") {
    ok(a1.winMs > 7000 && a1.winMs <= 13200, `defense clock armed in the 8-13s window (${Math.round(a1.winMs)}ms, "${a1.txt}")`);
    ok(a1.breakAt > 0, "huddle break scheduled");
  } else {
    ok(/⏱ (19|20)/.test(a1.txt), `offense clock armed at 20s ("${a1.txt}", kind=${a1.kind})`);
    ok(a1.breakAt === 0, "no huddle break scheduled on offensive prompts");
  }
  ok(a1.huddle, "huddle field scene running while the prompt is up");
  await page.waitForTimeout(2300);
  const a2 = await page.evaluate(() => parseInt((document.getElementById("ipcClock")?.textContent || "").replace(/\D/g, ""), 10));
  const a1n = parseInt((a1.txt || "").replace(/\D/g, ""), 10);
  ok(a2 <= a1n - 2, `clock counting down (${a1n} → ${a2})`);

  // ── Expiry → null tape entry (deferred to the coordinator) ──────────
  const r = await page.evaluate(async () => {
    const tapeBefore = _ipc.tape.length;
    const kind = _ipc.pending?.kind;
    _ipcClockDeadline = Date.now() - 1;   // fast-forward to expiry
    await new Promise(res => setTimeout(res, 600));
    return { tapeBefore, kind, tapeAfter: _ipc ? _ipc.tape.length : -1,
             lastEntry: _ipc && _ipc.tape.length ? _ipc.tape[_ipc.tape.length - 1] : "n/a",
             huddleGone: typeof _huddleScene === "undefined" || _huddleScene === null };
  });
  ok(r.tapeAfter === r.tapeBefore + 1, `expiry recorded a tape entry (${r.tapeBefore} → ${r.tapeAfter}, kind=${r.kind})`);
  ok(r.lastEntry === null, "entry is null = deferred to OC/DC");
  ok(r.huddleGone, "huddle scene stopped at expiry");

  // ── Manual call cancels the clock + scene. On offensive playcall
  //    prompts the PLAY SHEET must render and a named call must record. ──
  await waitPrompt();
  const r2 = await page.evaluate(async () => {
    const kind = _ipc.pending.kind;
    const call = kind === "fourthDown" ? "punt" : kind === "pat" ? "kick"
               : kind === "defense" ? "C3_ZONE" : "VERTICAL";
    const sheet = kind === "playcall" || kind === undefined
      ? { present: !!document.querySelector(".ipc-sheet"),
          btns: document.querySelectorAll(".ipc-sheet .ipc-btn").length }
      : null;
    frnPlaycall(call);
    await new Promise(res => setTimeout(res, 300));
    return { clockText: document.getElementById("ipcClock")?.textContent,
             timerDead: _ipcClockTimer === null,
             huddleGone: _huddleScene === null,
             last: _ipc ? _ipc.tape[_ipc.tape.length - 1] : "gone", call, kind, sheet };
  });
  ok(r2.last === r2.call, `manual call recorded (${r2.call}, kind=${r2.kind})`);
  ok(r2.timerDead && r2.clockText === "", "clock cleared after manual call");
  ok(r2.huddleGone, "huddle scene stopped after manual call");
  if (r2.sheet) ok(r2.sheet.present && r2.sheet.btns >= 13,
                   `play sheet rendered with ${r2.sheet.btns} calls`);

  // ── Walk to an offensive PLAYCALL prompt: sheet renders, named run
  //    call records on the tape ─────────────────────────────────────────
  let sheetSeen = null;
  for (let i = 0; i < 24 && !sheetSeen; i++) {
    await waitPrompt();
    sheetSeen = await page.evaluate(() => {
      const kind = _ipc.pending?.kind || "playcall";
      if (kind !== "playcall") { frnPlaycall("auto"); return null; }
      const present = !!document.querySelector(".ipc-sheet");
      const btns = document.querySelectorAll(".ipc-sheet .ipc-btn").length;
      frnPlaycall("RUN_TOSS");
      return { present, btns, last: _ipc.tape[_ipc.tape.length - 1] };
    });
  }
  if (!sheetSeen) ok(false, "never reached an offensive playcall prompt in 24 prompts");
  else {
    ok(sheetSeen.present && sheetSeen.btns >= 13, `play sheet on playcall prompt (${sheetSeen.btns} calls)`);
    ok(sheetSeen.last === "RUN_TOSS", "named run call recorded on the tape");
  }

  // ── Walk to a DEFENSIVE prompt: shorter window, break-lead invariant,
  //    and the on-screen huddle actually breaks before the DC takes over ──
  let defSeen = null;
  for (let i = 0; i < 24 && !defSeen; i++) {
    await waitPrompt();
    defSeen = await page.evaluate(() => {
      if ((_ipc.pending?.kind || "playcall") !== "defense") { frnPlaycall("auto"); return null; }
      return {
        winMs: _ipcClockDeadline - Date.now(),
        lead: _ipcClockDeadline - _ipcHuddleBreakAt,
        huddle: _huddleScene !== null,
      };
    });
  }
  if (!defSeen) {
    ok(false, "never reached a defensive prompt in 24 prompts");
  } else {
    ok(defSeen.winMs > 7000 && defSeen.winMs <= 13200, `defensive window is 8-13s (${Math.round(defSeen.winMs)}ms)`);
    ok(defSeen.lead === 2600, `huddle breaks 2.6s before the deadline (lead=${defSeen.lead}ms)`);
    ok(defSeen.huddle, "huddle scene running on the defensive prompt");
    // Trigger the break NOW, confirm the scene survives the jog phase, then
    // let the deadline hit — DC ("auto" → null) takes the call.
    const br = await page.evaluate(async () => {
      const tapeBefore = _ipc.tape.length;
      _ipcHuddleBreakAt = Date.now() - 10;
      _ipcClockDeadline = Date.now() + 2590;
      await new Promise(res => setTimeout(res, 800));
      const midBreak = _huddleScene !== null && _ipc && _ipc.pending !== null;
      const cadence = document.getElementById("fcBannerTitle")?.textContent || "";
      await new Promise(res => setTimeout(res, 2400));
      return { tapeBefore, midBreak, cadence,
               tapeAfter: _ipc ? _ipc.tape.length : -1,
               lastEntry: _ipc && _ipc.tape.length ? _ipc.tape[_ipc.tape.length - 1] : "n/a" };
    });
    ok(br.midBreak, "scene + prompt still live mid-break (user can still call it)");
    ok(/BREAKING|SET/.test(br.cadence), `break cadence shown ("${br.cadence}")`);
    ok(br.tapeAfter === br.tapeBefore + 1 && br.lastEntry === null,
       `deadline after the break deferred to the DC (${br.tapeBefore} → ${br.tapeAfter}, entry=${String(br.lastEntry)})`);
  }

  ok(errors.length === 0, errors.length ? "page errors: " + errors.join(" | ") : "zero page errors");
  console.log(fail === 0 ? `ALL-PASS (${pass} checks)` : `${fail} FAILURES`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
