// _anim_pose_audit.js — systematic animation audit sweep. For every play
// family (same exemplar finder as the contact sheet), renders the full play
// at 24 fractions through the REAL renderer and reports, per family:
//   • key-actor coverage — % of frames each emitted name (rusher/receiver/
//     passer/kicker/defender/tackler) was actually DRAWN, + poses seen.
//     Low coverage = the wrong-player identity class of bug.
//   • drawn-player count range — scrimmage plays should hold ~22 bodies;
//     dips mean someone vanished mid-play.
//   • sprite-miss deltas — pose/direction lookups that fell through to the
//     procedural fallback (broken pose mappings, missing art).
// Pure discovery instrument: prints a table + FLAG lines. Exit 1 only on
// render errors. Companion to tools/_anim_contact_sheet.js (the eyeball
// half of the audit).
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
  ["run_inside",       p => p.kind === "run" && (p.runType || "inside") === "inside" && !p.isQBRun && !p.isReverse && !p.isScramble && !p.isTwoBack],
  ["run_stretch",      p => p.kind === "run" && p.runType === "stretch"],
  ["run_counter",      p => p.kind === "run" && p.runType === "counter"],
  ["run_pitch",        p => p.kind === "run" && p.runType === "pitch"],
  ["two_back_run",     p => p.kind === "run" && p.isTwoBack],
  ["qb_scramble",      p => p.kind === "run" && p.isScramble],
  ["qb_run",           p => p.kind === "run" && p.isQBRun && !p.isSpeedOption && !p.isScramble],
  ["speed_option",     p => p.kind === "run" && p.isSpeedOption],
  ["reverse",          p => p.kind === "run" && p.isReverse],
  ["catch_standard",   p => p.kind === "complete" && !p.isScreen && !p.isLeapingCatch && (p.yac ?? 0) > 0 && (p.yac ?? 0) < 4],
  ["catch_in_stride",  p => p.kind === "complete" && (p.yac ?? 0) >= 4 && !p.isLeapingCatch && !p.isScreen],
  ["catch_high_point", p => p.kind === "complete" && p.isLeapingCatch],
  ["screen",           p => p.kind === "complete" && p.isScreen],
  ["incomplete",       p => p.kind === "incomplete" && !p.isScreen && !p.isLeapMiss],
  ["incomplete_leap",  p => p.kind === "incomplete" && p.isLeapMiss],
  ["interception",     p => p.kind === "int"],
  ["sack",             p => p.kind === "sack"],
  ["fumble",           p => p.kind === "fumble"],
  ["punt",             p => p.kind === "punt"],
  ["fg_good",          p => p.kind === "fg_good"],
  ["fg_miss",          p => p.kind === "fg_miss"],
  ["kickoff",          p => p.kind === "kickoff" && !p.isOnside],
  ["kneel",            p => p.kind === "kneel"],
  ["spike",            p => p.kind === "spike"],
]`;

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
    for (const pr of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
      frnPlayGame(pr[0], pr[1]);
      playing = false; cancelAnimationFrame(rafId);
      games.push(gameResult);
    }
    const out = [];
    const ACTOR_FIELDS = ["rusher", "receiver", "intended", "passer", "kicker",
                          "defender", "tackler", "returner", "punter"];
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
        if (play[f] && typeof play[f] === "string") actors[f + ":" + play[f]] = { drawn: 0, poses: new Set() };
      }
      let frames = 0, minDrawn = 99, maxDrawn = 0, renderErr = null;
      const FR = [];
      for (let f = 0.04; f <= 0.99; f += 0.04) FR.push(f);
      for (const f of FR) {
        window._posesThisFrame = {};
        _frameStartBroadcast();
        try { animState.anim.render(f, ctx); } catch (e) { renderErr = String(e.message).slice(0, 80); break; }
        _frameEndBroadcast(ctx);
        animState.slowMoUntil = 0;
        frames++;
        const names = Object.keys(window._posesThisFrame);
        // Ignore pure pre-snap frames for the body count (formation builds)
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
          [k, { cov: Math.round(v.drawn / frames * 100), poses: [...v.poses].join("/") }])),
        misses: Object.entries(misses).filter(([k, v]) => !k.includes("still-loading"))
          .map(([k, v]) => k + "×" + v).join(", "),
      });
    }
    return out;
  })()`);

  // ── Report + flags ────────────────────────────────────────────────────
  let flags = 0;
  for (const r of report) {
    if (r.missing) { console.log(`── ${r.fam}: NO EXEMPLAR`); continue; }
    console.log(`── ${r.fam} — ${r.desc}`);
    console.log(`   bodies drawn (post-snap): ${r.minDrawn}–${r.maxDrawn}`);
    if (r.renderErr) { console.log(`   ⚑ RENDER ERROR: ${r.renderErr}`); flags++; }
    for (const [k, v] of Object.entries(r.actors)) {
      const flag = v.cov < 50 ? "  ⚑ LOW COVERAGE" : "";
      console.log(`   ${k} — drawn ${v.cov}% [${v.poses}]${flag}`);
      if (v.cov < 50) flags++;
    }
    if (r.minDrawn < 20 && !["kneel", "spike", "kickoff", "punt", "fg_good", "fg_miss"].includes(r.fam)) {
      console.log(`   ⚑ BODY-COUNT DIP (min ${r.minDrawn} — someone vanished?)`);
      flags++;
    }
    if (r.misses) { console.log(`   ⚑ sprite misses: ${r.misses}`); flags++; }
  }
  console.log(`\n${flags} flag(s) raised across ${report.length} families`);
  if (errors.length) { console.log("page errors: " + errors.join(" | ")); }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error("AUDIT CRASH:", e); process.exit(2); });
