// _oob_repro.js — find which plays still put bodies past the sidelines
// and capture broadcast screenshots to inspect jersey-number attachment.
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5198;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on("pageerror", e => console.log("PAGEERR", String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);

  const report = await page.evaluate(`(async () => {
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    franchise.phase = "regular";
    const games = [];
    for (const pr of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
      frnPlayGame(pr[0], pr[1]);
      playing = false; cancelAnimationFrame(rafId);
      games.push(gameResult);
    }
    // Wrap drawPlayer to record PRE-clamp world positions per play.
    const rawDP = drawPlayer;
    let oobLog = null;
    drawPlayer = function (ctx, x, y, color, secondary, label, pose, t, facing, style) {
      if (oobLog && Number.isFinite(y)) {
        if (y < FIELD.TOP - 6 || y > FIELD.BOT + 24) {
          const id = (style && style.name) || label || pose || "?";
          const k = id + "|" + pose;
          const e = oobLog.map.get(k) || { id, pose, minY: 1e9, maxY: -1e9, n: 0 };
          e.minY = Math.min(e.minY, y); e.maxY = Math.max(e.maxY, y); e.n++;
          oobLog.map.set(k, e);
        }
      }
      return rawDP(ctx, x, y, color, secondary, label, pose, t, facing, style);
    };
    const out = [];
    for (let g = 0; g < games.length; g++) {
      gameResult = games[g];
      for (let i = 0; i < gameResult.plays.length; i++) {
        playHead = i;
        playing = true; startNextPlay();
        playing = false; cancelAnimationFrame(rafId);
        if (!animState || !animState.anim) continue;
        const play = gameResult.plays[i];
        play._catchFlashFired = true; play._intFlashFired = true;
        const ctx = document.getElementById("field").getContext("2d");
        oobLog = { map: new Map() };
        for (let f = 0.02; f <= 0.99; f += 0.02) {
          _frameStartBroadcast();
          try { animState.anim.render(f, ctx); } catch (e) { break; }
          _frameEndBroadcast(ctx);
          animState.slowMoUntil = 0;
        }
        if (oobLog.map.size) {
          out.push({
            g, i, kind: play.kind, runType: play.runType, isScreen: !!play.isScreen,
            st: play.isOnside ? "onside" : "", desc: (play.desc || "").slice(0, 56),
            who: [...oobLog.map.values()].map(e =>
              e.id + "(" + e.pose + ") y[" + Math.round(e.minY) + "," + Math.round(e.maxY) + "]x" + e.n),
          });
        }
        oobLog = null;
      }
    }
    return out;
  })()`);

  console.log(`plays with PRE-clamp OOB world-y: ${report.length}`);
  for (const r of report.slice(0, 40)) {
    console.log(`  [g${r.g} p${r.i}] ${r.kind}${r.runType ? "/" + r.runType : ""}${r.isScreen ? "/screen" : ""}${r.st} — ${r.desc}`);
    for (const w of r.who.slice(0, 6)) console.log(`      ${w}`);
  }
  process.exit(0);
})();
