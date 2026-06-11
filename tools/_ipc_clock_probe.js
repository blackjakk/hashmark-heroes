// _ipc_clock_probe.js — local play-clock detector for solo interactive
// play-calling. Asserts: the prompt panel arms a 20s clock, expiry
// auto-defers to the OC/DC (null on the tape — byte-identical to pressing
// O), and a manual call cancels the clock. Net matches are out of scope
// (the H2H server clock is authoritative there; see h2h-probe.js).
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
  await page.waitForFunction(() => {
    const el = document.getElementById("ipcPanel");
    return el && el.style.display !== "none";
  }, { timeout: 60000 });
  const c1 = await page.evaluate(() => document.getElementById("ipcClock")?.textContent);
  ok(/⏱ (19|20)/.test(c1), `clock armed at 20s ("${c1}")`);
  await page.waitForTimeout(2300);
  const c2 = await page.evaluate(() => document.getElementById("ipcClock")?.textContent);
  ok(/⏱ 1[678]/.test(c2), `clock counting down ("${c2}")`);
  const r = await page.evaluate(async () => {
    const tapeBefore = _ipc.tape.length;
    const kind = _ipc.pending?.kind;
    _ipcClockDeadline = Date.now() - 1;   // fast-forward to expiry
    await new Promise(res => setTimeout(res, 600));
    return { tapeBefore, kind, tapeAfter: _ipc ? _ipc.tape.length : -1,
             lastEntry: _ipc && _ipc.tape.length ? _ipc.tape[_ipc.tape.length - 1] : "n/a" };
  });
  ok(r.tapeAfter === r.tapeBefore + 1, `expiry recorded a tape entry (${r.tapeBefore} → ${r.tapeAfter}, kind=${r.kind})`);
  ok(r.lastEntry === null, "entry is null = deferred to OC/DC");
  await page.waitForFunction(() => {
    const el = document.getElementById("ipcPanel");
    return el && el.style.display !== "none" && _ipc && _ipc.pending;
  }, { timeout: 60000 });
  const r2 = await page.evaluate(async () => {
    const kind = _ipc.pending.kind;
    const call = kind === "fourthDown" ? "punt" : kind === "pat" ? "kick" : kind === "defense" ? "C3_ZONE" : "run";
    frnPlaycall(call);
    await new Promise(res => setTimeout(res, 300));
    return { clockText: document.getElementById("ipcClock")?.textContent,
             timerDead: _ipcClockTimer === null,
             last: _ipc ? _ipc.tape[_ipc.tape.length - 1] : "gone", call };
  });
  ok(r2.last === r2.call, `manual call recorded (${r2.call})`);
  ok(r2.timerDead && r2.clockText === "", "clock cleared after manual call");
  ok(errors.length === 0, errors.length ? "page errors: " + errors.join(" | ") : "zero page errors");
  console.log(fail === 0 ? `ALL-PASS (${pass} checks)` : `${fail} FAILURES`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
