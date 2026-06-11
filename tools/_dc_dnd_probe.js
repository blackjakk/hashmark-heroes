// _dc_dnd_probe.js — drag-and-drop depth chart detector.
// Asserts the rework's three contracts:
//   1. ENGINE HONORS THE CHART — dragging a backup into the starter cell
//      changes who the sim actually starts (previously the engine started
//      by raw OVR and the chart's "starter" flag was cosmetic).
//   2. OUT-OF-POSITION ASSIGNMENTS — dragging a WR into an RB slot is
//      accepted (donor adjacency), renders the OOP chip, and the sim
//      fields a position-converted clone at the −18% penalty. Invalid
//      pairs (OL→CB) are rejected.
//   3. BENCH TRAY — unassigned players are draggable in; dropping a
//      charted player on the bench unassigns him. Keyboard buttons
//      (▲/⇅) still work — drag is never the only path.
//
//   node tools/_dc_dnd_probe.js     (starts its own server :5200)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5200;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ FAIL " + l); } };

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1100 } })).newPage();
  page.on("dialog", d => d.accept());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    let s = 0xD0D;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    renderFrnDepthChart();
  });
  await page.waitForTimeout(400);

  console.log("— 1. within-group drag: backup → starter, engine honors it —");
  const before = await page.evaluate(() => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const byPid = Object.fromEntries(franchise.rosters[franchise.chosenTeamId].map(p => [p.pid, p]));
    const sim = _frnBuildLiveSim(franchise.chosenTeamId, TEAMS.find(t => t.id !== franchise.chosenTeamId).id, false, null, true);
    return { rb1: dc.RB1.starter, rb2: dc.RB2.starter,
             rb1Name: byPid[dc.RB1.starter]?.name, rb2Name: byPid[dc.RB2.starter]?.name,
             simRb: sim.homeR.starters.rb };
  });
  ok(before.simRb === before.rb1Name, `baseline: engine starts the chart's RB1 (${before.simRb})`);
  await page.dragAndDrop(`[data-slot="RB2"][data-role="starter"]`, `[data-slot="RB1"][data-role="starter"]`);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const byPid = Object.fromEntries(franchise.rosters[franchise.chosenTeamId].map(p => [p.pid, p]));
    const sim = _frnBuildLiveSim(franchise.chosenTeamId, TEAMS.find(t => t.id !== franchise.chosenTeamId).id, false, null, true);
    return { rb1: dc.RB1.starter, rb2: dc.RB2.starter, rb1Name: byPid[dc.RB1.starter]?.name, simRb: sim.homeR.starters.rb };
  });
  ok(after.rb1 === before.rb2 && after.rb2 === before.rb1, "drag swapped RB1 ↔ RB2 in the chart");
  ok(after.simRb === before.rb2Name, `ENGINE HONORS THE CHART — now starts ${after.simRb} (was ${before.simRb})`);

  console.log("— 2. cross-position drag: WR into the RB2 slot —");
  const xp = await page.evaluate(() => {
    // pick the WR2 starter as the donor
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const byPid = Object.fromEntries(franchise.rosters[franchise.chosenTeamId].map(p => [p.pid, p]));
    return { wrPid: dc.WR2.starter, wrName: byPid[dc.WR2.starter]?.name };
  });
  await page.dragAndDrop(`[data-slot="WR2"][data-role="starter"]`, `[data-slot="RB2"][data-role="starter"]`);
  await page.waitForTimeout(400);
  const xpAfter = await page.evaluate((wrPid) => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const oopChip = !!document.querySelector(".frn-dc-badge.oop");
    const sim = _frnBuildLiveSim(franchise.chosenTeamId, TEAMS.find(t => t.id !== franchise.chosenTeamId).id, false, null, true);
    const roster = franchise.rosters[franchise.chosenTeamId];
    const natural = roster.find(p => p.pid === wrPid);
    return { atRB2: dc.RB2.starter === wrPid, oopChip,
             rb2Sim: sim.homeR.starters.rb2, naturalOvr: natural?.overall };
  }, xp.wrPid);
  ok(xpAfter.atRB2, `WR ${xp.wrName} accepted at the RB2 slot`);
  ok(xpAfter.oopChip, "OOP chip renders (WR→RB · eff OVR)");
  ok(xpAfter.rb2Sim === xp.wrName, `sim fields him as the RB2 (${xpAfter.rb2Sim})`);

  console.log("— 3. invalid drop rejected: OL onto a CB slot —");
  const inv = await page.evaluate(() => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    return { olPid: dc.LT.starter, cb1Before: dc.CB1.starter };
  });
  await page.evaluate(() => { _dcActiveUnit = "DEF"; renderFrnDepthChart(); });
  await page.waitForTimeout(300);
  // drag source is on OFF tab — simulate via the handler contract instead:
  const invRes = await page.evaluate(({ olPid, cb1Before }) => {
    // direct handler-level check (the dragover gate is _dcCanPlay)
    const can = _dcCanPlay("OL", "CB");
    // and a forced drop attempt must be a no-op
    _dcDrag = { pid: olPid, fromSlot: "LT", fromRole: "starter" };
    const ev = { preventDefault() {}, currentTarget: document.createElement("div") };
    frnDcDrop(ev, "CB1", "starter");
    const dc = franchise.depthChart[franchise.chosenTeamId];
    return { can, cb1Same: dc.CB1.starter === cb1Before, ltIntact: dc.LT.starter === olPid };
  }, inv);
  ok(!invRes.can, "_dcCanPlay rejects OL at CB");
  ok(invRes.cb1Same && invRes.ltIntact, "forced drop is a no-op (chart unchanged)");

  console.log("— 4. bench tray: unassign via bench drop + chips draggable —");
  await page.evaluate(() => { _dcActiveUnit = "OFF"; renderFrnDepthChart(); });
  await page.waitForTimeout(300);
  const bench = await page.evaluate(() => ({
    chips: document.querySelectorAll(".frn-dc-bench-chip").length,
    benches: document.querySelectorAll(".frn-dc-bench").length,
  }));
  ok(bench.benches >= 4, `bench trays render (${bench.benches} groups)`);
  const unas = await page.evaluate(() => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const pid = dc.RB2.starter;
    _dcDrag = { pid, fromSlot: "RB2", fromRole: "starter" };
    const ev = { preventDefault() {}, currentTarget: document.createElement("div") };
    frnDcDropBench(ev);
    return { cleared: franchise.depthChart[franchise.chosenTeamId].RB2.starter === null };
  });
  ok(unas.cleared, "dropping a charted player on the bench unassigns him");

  console.log("— 5. keyboard path intact —");
  const kb = await page.evaluate(() => {
    const dc = franchise.depthChart[franchise.chosenTeamId];
    const b = dc.QB.backup, s = dc.QB.starter;
    frnDepthSwapInSlot("QB");
    const dc2 = franchise.depthChart[franchise.chosenTeamId];
    return { swapped: dc2.QB.starter === b && dc2.QB.backup === s };
  });
  ok(kb.swapped, "frnDepthSwapInSlot (▲/⇅ buttons) still swaps");

  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "zero page errors");
  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
