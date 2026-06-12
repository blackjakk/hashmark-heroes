// _anim_pose_audit.js — systematic animation audit GATE. For every play
// family, renders a real exemplar play at 24 fractions through the REAL
// renderer and asserts:
//   • key-actor coverage — every emitted name (rusher/receiver/passer/
//     kicker/kickerName/returner/tackler) must be DRAWN ≥50% of frames.
//     Low coverage = the wrong-player identity class of bug.
//   • EXPECTED POSES — each family's key actor must show at least one of
//     its signature poses (a kicker must kick, a sacked QB must go down…).
//   • drawn-player count — scrimmage plays hold ~22 bodies post-snap;
//     dips mean someone vanished mid-play.
//   • sprite-miss deltas — pose/dir lookups that fell to the procedural
//     fallback (broken pose mappings, missing art).
// Rare/call-only families (speed option, reverse, onside) are guaranteed
// an exemplar via a forced-call coordinator game. Exit 1 on ANY flag.
// Companion: tools/_anim_contact_sheet.js (the eyeball half of the audit).
//
//   node tools/_anim_pose_audit.js        (starts its own server :5195)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5195;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

const FAMILIES = `[
  ["run_inside",        p => p.kind === "run" && (p.runType || "inside") === "inside" && !p.isQBRun && !p.isReverse && !p.isScramble && !p.isTwoBack],
  ["run_stretch",       p => p.kind === "run" && p.runType === "stretch"],
  ["run_counter",       p => p.kind === "run" && p.runType === "counter"],
  ["run_pitch",         p => p.kind === "run" && p.runType === "pitch"],
  ["two_back_run",      p => p.kind === "run" && p.isTwoBack],
  ["qb_scramble",       p => p.kind === "run" && p.isScramble],
  ["qb_run",            p => p.kind === "run" && p.isQBRun && !p.isSpeedOption && !p.isScramble],
  ["speed_option",      p => p.kind === "run" && p.isSpeedOption],
  ["reverse",           p => p.kind === "run" && p.isReverse],
  ["catch_standard",    p => p.kind === "complete" && !p.isScreen && !p.isLeapingCatch && (p.yac ?? 0) > 0 && (p.yac ?? 0) < 4],
  ["catch_in_stride",   p => p.kind === "complete" && (p.yac ?? 0) >= 4 && !p.isLeapingCatch && !p.isScreen],
  ["catch_high_point",  p => p.kind === "complete" && p.isLeapingCatch],
  ["screen",            p => p.kind === "complete" && p.isScreen],
  ["incomplete",        p => p.kind === "incomplete" && !p.isScreen && !p.isLeapMiss],
  ["incomplete_leap",   p => p.kind === "incomplete" && p.isLeapMiss],
  ["interception",      p => p.kind === "int"],
  ["sack",              p => p.kind === "sack"],
  ["fumble",            p => p.kind === "fumble"],
  ["punt",              p => p.kind === "punt"],
  ["fg_good",           p => p.kind === "fg_good"],
  ["fg_miss",           p => p.kind === "fg_miss"],
  ["kickoff_return",    p => p.kind === "kickoff" && !p.isOnside && p.returner],
  ["kickoff_touchback", p => p.kind === "kickoff" && !p.isOnside && !p.returner && !p.onsideRecovered],
  ["onside_kick",       p => p.kind === "kickoff" && p.isOnside],
  ["kneel",             p => p.kind === "kneel"],
  ["spike",             p => p.kind === "spike"],
  ["big_hit",           p => p.kind === "big_hit"],
]`;

// Signature poses per family — the key actor must show at least one.
const EXPECT = `{
  run_inside:       { rusher: ["run", "churn", "carry"] },
  run_stretch:      { rusher: ["run", "churn", "carry"] },
  run_counter:      { rusher: ["run", "churn", "carry"] },
  run_pitch:        { rusher: ["run", "churn", "carry"] },
  two_back_run:     { rusher: ["run", "churn", "carry"] },
  qb_scramble:      { rusher: ["qb_scramble", "truck", "run"] },
  qb_run:           { rusher: ["qb_scramble", "run", "carry", "juke"] },
  speed_option:     { rusher: ["run", "carry", "qb_scramble", "churn"] },
  reverse:          { rusher: ["run", "churn", "carry"] },
  catch_standard:   { receiver: ["reach", "catch", "leap", "dive_forward"] },
  catch_in_stride:  { receiver: ["reach", "catch", "leap"] },
  catch_high_point: { receiver: ["leap", "reach", "catch"] },
  screen:           { receiver: ["reach", "catch", "carry"] },
  incomplete:       { intended: ["reach", "catch", "leap"], passer: ["throw"] },
  incomplete_leap:  { intended: ["leap", "reach"], passer: ["throw"] },
  interception:     { defender: ["carry", "catch", "reach"] },
  sack:             { passer: ["tackled", "sack"] },
  fumble:           { rusher: ["tackled", "reach", "carry"] },
  punt:             { kicker: ["kick"], returner: ["catch", "carry"] },
  fg_good:          { kicker: ["kick"] },
  fg_miss:          { kicker: ["kick"] },
  kickoff_return:   { returner: ["catch", "carry"], kickerName: ["kick"] },
}`;

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(`(async () => {
    const FAMS = ${FAMILIES};
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    franchise.phase = "regular";
    window.GC_POSE_PROBE = true;
    const games = [];
    for (const pr of [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]) {
      frnPlayGame(pr[0], pr[1]);
      playing = false; cancelAnimationFrame(rafId);
      games.push(gameResult);
    }
    // Forced-call game — guarantees exemplars for the rare/call-only
    // families (speed option, reverse, onside kick) regardless of seeds.
    {
      const calls = ["READ_OPTION", "REVERSE", "RUN_COUNTER", "RUN_TOSS"];
      let ci = 0;
      _setSimRng(777);
      const sim = new GameSimulator(TEAMS[10], TEAMS[11],
        JSON.parse(JSON.stringify(franchise.rosters[11])), JSON.parse(JSON.stringify(franchise.rosters[12])));
      sim._coordinators = { home: (c) =>
        c.kind === "playcall" ? calls[(ci++) % calls.length]
        : c.kind === "kickoff" ? "onside"
        : null };
      const res = sim.simulate();
      _clearSimRng();
      res.playerLookup = new Map();
      for (const p of res.homeRoster) res.playerLookup.set(p.name, { ...p, team: "home" });
      for (const p of res.awayRoster) res.playerLookup.set(p.name, { ...p, team: "away" });
      games.push(res);
    }
    const out = [];
    const ACTOR_FIELDS = ["rusher", "receiver", "intended", "passer", "kicker",
                          "kickerName", "defender", "tackler", "returner"];
    for (const [fam, fn] of FAMS) {
      let pick = null;
      for (let g = 0; g < games.length && !pick; g++) {
        const i = games[g].plays.findIndex(fn);
        if (i >= 0) pick = { g, i };
      }
      if (!pick) { out.push({ fam, missing: true }); continue; }
      gameResult = games[pick.g];
      playHead = pick.i;
      playing = true; startNextPlay();
      playing = false; cancelAnimationFrame(rafId);
      if (!animState || !animState.anim) { out.push({ fam, missing: true }); continue; }
      const play = gameResult.plays[pick.i];
      play._catchFlashFired = true; play._intFlashFired = true;
      const ctx = document.getElementById("field").getContext("2d");
      SpriteAtlas.resetCounters();
      const actors = {};
      for (const f of ACTOR_FIELDS) {
        const v = play[f];
        // kickoff's \`kicker\` is a SIDE string, not a name — skip those.
        if (v && typeof v === "string" && v !== "home" && v !== "away") {
          actors[f + ":" + v] = { field: f, drawn: 0, poses: new Set() };
        }
      }
      let frames = 0, minDrawn = 99, maxDrawn = 0, renderErr = null;
      for (let f = 0.04; f <= 0.99; f += 0.04) {
        window._posesThisFrame = {};
        _frameStartBroadcast();
        try { animState.anim.render(f, ctx); } catch (e) { renderErr = String(e.message).slice(0, 80); break; }
        _frameEndBroadcast(ctx);
        animState.slowMoUntil = 0;
        frames++;
        const names = Object.keys(window._posesThisFrame);
        if (f > 0.30) {
          minDrawn = Math.min(minDrawn, names.length);
          maxDrawn = Math.max(maxDrawn, names.length);
        }
        for (const key in actors) {
          const nm = key.slice(key.indexOf(":") + 1);
          const pose = window._posesThisFrame[nm];
          if (pose) { actors[key].drawn++; actors[key].poses.add(pose); }
        }
      }
      const misses = SpriteAtlas.counters().misses;
      out.push({
        fam, desc: (play.desc || "").slice(0, 60), renderErr,
        frames, minDrawn, maxDrawn,
        actors: Object.fromEntries(Object.entries(actors).map(([k, v]) =>
          [k, { field: v.field, cov: Math.round(v.drawn / frames * 100), poses: [...v.poses] }])),
        misses: Object.entries(misses).filter(([k]) => !k.includes("still-loading"))
          .map(([k, v]) => k + "×" + v).join(", "),
      });
    }
    return out;
  })()`);

  // ── Report + gate ─────────────────────────────────────────────────────
  const EXPECT_T = eval(`(${EXPECT})`);
  let flags = 0;
  const OPTIONAL_FAMS = new Set(["big_hit"]);   // too rare to demand an exemplar
  for (const r of report) {
    if (r.missing) {
      console.log(`── ${r.fam}: NO EXEMPLAR${OPTIONAL_FAMS.has(r.fam) ? " (optional)" : "  ⚑"}`);
      if (!OPTIONAL_FAMS.has(r.fam)) flags++;
      continue;
    }
    console.log(`── ${r.fam} — ${r.desc}`);
    console.log(`   bodies drawn (post-snap): ${r.minDrawn}–${r.maxDrawn}`);
    if (r.renderErr) { console.log(`   ⚑ RENDER ERROR: ${r.renderErr}`); flags++; }
    const expect = EXPECT_T[r.fam] || {};
    for (const [k, v] of Object.entries(r.actors)) {
      const want = expect[v.field];
      const hasSig = !want || v.poses.some(p => want.includes(p));
      const lowCov = v.cov < 50;
      console.log(`   ${k} — drawn ${v.cov}% [${v.poses.join("/")}]`
        + (lowCov ? "  ⚑ LOW COVERAGE" : "")
        + (!hasSig ? `  ⚑ MISSING SIGNATURE POSE (want one of: ${want.join("/")})` : ""));
      if (lowCov) flags++;
      if (!hasSig) flags++;
    }
    if (r.minDrawn < 20 && !["kneel", "spike", "kickoff_return", "kickoff_touchback",
                             "onside_kick", "punt", "fg_good", "fg_miss"].includes(r.fam)) {
      console.log(`   ⚑ BODY-COUNT DIP (min ${r.minDrawn} — someone vanished?)`);
      flags++;
    }
    if (r.misses) { console.log(`   ⚑ sprite misses: ${r.misses}`); flags++; }
  }
  console.log(`\n${flags} flag(s) across ${report.length} families`);
  if (errors.length) { console.log("page errors: " + errors.join(" | ")); }
  console.log(flags === 0 && !errors.length ? "ANIM AUDIT PASS" : "ANIM AUDIT FAIL");
  await browser.close();
  process.exit(flags || errors.length ? 1 : 0);
})().catch(e => { console.error("AUDIT CRASH:", e); process.exit(2); });
