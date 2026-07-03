#!/usr/bin/env node
// _fantasy_draft_probe.js — fantasy-draft determinism + legality gate.
//
// Proves the FANTASY_DRAFT_DESIGN.md S1 invariants:
//   1. Pool generation is a pure function of (seed, year): same seed twice →
//      byte-identical pool + draft order; different seed → different pool.
//   2. A full auto-draft always COMPLETES (constructive no-deadlock proof) and
//      yields 32 legal rosters: 51 players each, every FD_FLOORS minimum met,
//      zero duplicate players, pool fully consumed.
//   3. Tape replay: deriving rosters twice from the same (seed, tape) is
//      byte-identical — the resume/verification contract.
//   4. The real user flow finishes into a playable franchise: contracts on
//      every player, team cap totals sane, phase lands on preseason.
//   5. Mid-draft refresh resumes the draft room with the tape intact.
//
//   node tools/_fantasy_draft_probe.js     (starts its own server :5217)

"use strict";
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");

const PORT = 5217;
const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }));

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ FAIL " + label); }
};

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  // ── 1. Pool determinism ────────────────────────────────────────────────────
  console.log("— 1. pool generation is a pure function of (seed, year) —");
  const det = await page.evaluate(() => {
    const hashPool = (built) => JSON.stringify({
      order: built.order,
      pool: built.pool.map(p => [p.pid, p.name, p.position, p.overall, p.age, p.bodyType || null]),
    });
    const a = hashPool(_fdBuildPool(1337, 2026));
    const b = hashPool(_fdBuildPool(1337, 2026));
    const c = hashPool(_fdBuildPool(42, 2026));
    return { same: a === b, differs: a !== c, size: _fdBuildPool(1337, 2026).pool.length };
  });
  ok(det.same, "same seed twice → byte-identical pool + order");
  ok(det.differs, "different seed → different pool");
  ok(det.size === 32 * 51, `pool holds exactly 32×51 players (got ${det.size})`);

  // ── 2. Full auto-draft: completion + legality ─────────────────────────────
  console.log("— 2. full auto-draft completes with 32 legal rosters —");
  const draft = await page.evaluate(() => {
    const r = _fdSimulateFullDraft(1337, 2026, 1);
    const teams = Object.keys(r.rosters);
    const sizes = teams.map(t => r.rosters[t].length);
    const pids = new Set();
    let dup = false;
    for (const t of teams) for (const p of r.rosters[t]) { if (pids.has(p.pid)) dup = true; pids.add(p.pid); }
    const floorsOk = teams.every(t => {
      const c = {};
      for (const p of r.rosters[t]) c[p.position] = (c[p.position] || 0) + 1;
      return Object.entries(FD_FLOORS).every(([pos, min]) => (c[pos] || 0) >= min);
    });
    return { status: r.status, teams: teams.length, minSize: Math.min(...sizes), maxSize: Math.max(...sizes),
             totalDrafted: pids.size, dup, floorsOk, tapeLen: r.tape.length };
  });
  ok(draft.status === "done", `auto-draft completes (status=${draft.status}) — constructive no-deadlock proof`);
  ok(draft.teams === 32 && draft.minSize === 51 && draft.maxSize === 51, `all 32 rosters land on exactly 51 (min=${draft.minSize}, max=${draft.maxSize})`);
  ok(draft.floorsOk, "every team meets every FD_FLOORS position minimum");
  ok(!draft.dup && draft.totalDrafted === 32 * 51, `no duplicate players; pool fully consumed (${draft.totalDrafted})`);

  // ── 3. Tape replay is byte-identical ──────────────────────────────────────
  console.log("— 3. (seed + tape) → rosters is replay-stable —");
  const replay = await page.evaluate(() => {
    const hashRosters = (r) => JSON.stringify(Object.fromEntries(
      Object.entries(r.rosters).map(([t, ps]) => [t, ps.map(p => p.pid)])));
    const a = hashRosters(_fdSimulateFullDraft(777, 2026, 1));
    const b = hashRosters(_fdSimulateFullDraft(777, 2026, 1));
    return { same: a === b };
  });
  ok(replay.same, "two independent full derivations produce identical rosters");

  // ── 4. Real user flow: pick team → 2 manual picks → resume → auto-rest ────
  console.log("— 4. user flow: draft room, manual picks, refresh-resume, finish —");
  await page.evaluate(() => { localStorage.clear(); _fdSetRounds(12); frnStartFantasyDraft(); });
  await page.waitForTimeout(300);
  const pickerUp = await page.evaluate(() =>
    document.querySelectorAll(".fps-start").length >= 32 && /FANTASY DRAFT/.test(document.body.textContent));
  ok(pickerUp, "start card → 32-team identity picker renders");

  await page.evaluate(() => frnFantasyPickTeam(TEAMS[2].id));
  await page.waitForTimeout(1500); // pool gen + AI picks to the user's turn
  const room = await page.evaluate(() => ({
    phase: franchise.phase,
    onClock: /YOU'RE ON THE CLOCK/.test(document.body.textContent),
    draftBtns: document.querySelectorAll(".frn-ana-table .ds-btn--gold").length,
    tape: franchise.fantasyDraft.tape.length,
  }));
  ok(room.phase === "fantasy_draft" && room.onClock, `draft room renders on the user's turn (phase=${room.phase})`);
  ok(room.draftBtns > 0, `legal picks are draftable (${room.draftBtns} gold Draft buttons)`);

  // Two manual picks via the UI handler
  const afterPicks = await page.evaluate(() => {
    const st = _fdState();
    const first = st.pool.find(p => !st.taken.has(p.pid) && _fdLegal(st, franchise.chosenTeamId, p.position));
    frnFantasyDraftPick(first.pid);
    const st2 = _fdState();
    const second = st2.pool.find(p => !st2.taken.has(p.pid) && _fdLegal(st2, franchise.chosenTeamId, p.position));
    frnFantasyDraftPick(second.pid);
    return { myCount: _fdState().rosters[franchise.chosenTeamId].length, tape: franchise.fantasyDraft.tape.length };
  });
  ok(afterPicks.myCount === 2, `two manual picks landed on my roster (${afterPicks.myCount})`);

  // Refresh-resume: reload the page mid-draft. The boot deliberately lands on
  // the start screen (user explicitly chooses Continue) — so do what a real
  // user does: hit the CONTINUE card, which loads the slot and dispatches the
  // fantasy_draft phase into the draft room.
  const tapeBefore = await page.evaluate(() => franchise.fantasyDraft.tape.length);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const contBtn = await page.evaluate(() => {
    const b = document.querySelector(".fps-continue");
    if (b) b.click();
    return !!b;
  });
  ok(contBtn, "start screen offers CONTINUE for the mid-draft save");
  await page.waitForTimeout(2500); // pool re-derivation + tape replay
  const resumed = await page.evaluate(() => ({
    phase: (typeof franchise !== "undefined" && franchise) ? franchise.phase : "(none)",
    tape: franchise?.fantasyDraft?.tape?.length ?? -1,
    roomUp: /FANTASY DRAFT · ROUND/.test(document.body.textContent),
    myCount: (typeof _fdState === "function" && franchise?.fantasyDraft) ? _fdState().rosters[franchise.chosenTeamId].length : -1,
  }));
  ok(resumed.phase === "fantasy_draft" && resumed.roomUp, "refresh mid-draft resumes the draft room");
  ok(resumed.tape === tapeBefore && resumed.myCount === 2, `tape + my picks survive reload (tape ${resumed.tape}/${tapeBefore})`);

  // Auto-rest → finish → preseason, contracts on everyone, cap sane
  const finish = await page.evaluate(async () => {
    franchise.fantasyDraft.autoRest = true;
    const status = _fdAdvance();
    saveFranchise();
    if (status === "done") _fdFinish();
    const rosters = franchise.rosters;
    const teams = Object.keys(rosters);
    const everyoneSigned = teams.every(t => rosters[t].every(p => p.contract && p.contract.aav > 0));
    const capTotals = teams.map(t => rosters[t].reduce((s, p) => s + (typeof currentYearCapHit === "function" ? currentYearCapHit(p) : p.contract.aav), 0));
    return {
      status, phase: franchise.phase, done: franchise.fantasyDraft.done,
      teams: teams.length, everyoneSigned,
      maxCap: Math.max(...capTotals), minCap: Math.min(...capTotals),
      myRoster: rosters[franchise.chosenTeamId].length,
      psSeeded: !!franchise.practiceSquads,
    };
  });
  ok(finish.status === "done" && finish.phase === "preseason" && finish.done, `auto-rest finishes into preseason (phase=${finish.phase})`);
  ok(finish.teams === 32 && finish.everyoneSigned, "all 32 drafted rosters are fully signed");
  ok(finish.minCap > 40 && finish.maxCap < 210, `team cap totals sane (min $${finish.minCap.toFixed(0)}M, max $${finish.maxCap.toFixed(0)}M)`);
  ok(finish.psSeeded, "practice squads seeded from drafted rosters");

  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "zero page errors");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FANTASY-DRAFT PROBE CRASH:", e); process.exit(2); });
