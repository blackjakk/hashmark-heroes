// _anim_contact_sheet.js — animation AUDIT instrument. Finds one play per
// animation family in seeded games, renders each at key time-fractions
// through the REAL renderer (same scrub path the UI uses), and stitches a
// labeled contact sheet PNG for human review. This is how we audit every
// play animation systematically (dropbacks, scrambles, runs, ST…) instead
// of by anecdote: re-run after any animation change, diff the sheet.
//
//   node tools/_anim_contact_sheet.js [outPath]
//   → default out: audit-results/anim_contact_sheet.png  (+ coverage table)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const PORT = 5197;
const OUT = process.argv[2] || path.join(__dirname, "..", "audit-results", "anim_contact_sheet.png");
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

// family key → matcher over a play visual. First match wins; one exemplar
// per family. Ordered so specific families match before generic ones.
const FAMILIES = `[
  ["catch_high_point", p => p.kind === "complete" && p.isLeapingCatch],
  ["catch_dive",       p => p.kind === "complete" && (p.yac ?? 99) === 0 && (p.targetDepth ?? 0) >= 8 && !p.isScreen],
  ["catch_in_stride",  p => p.kind === "complete" && (p.yac ?? 0) >= 4 && !p.isLeapingCatch && !p.isScreen],
  ["catch_standard",   p => p.kind === "complete" && !p.isScreen && !p.isLeapingCatch && (p.yac ?? 0) > 0 && (p.yac ?? 0) < 4],
  ["screen",           p => p.kind === "complete" && p.isScreen],
  ["incomplete",       p => p.kind === "incomplete" && !p.isScreen && !p.isLeapMiss],
  ["incomplete_leap",  p => p.kind === "incomplete" && p.isLeapMiss],
  ["interception",     p => p.kind === "int"],
  ["sack",             p => p.kind === "sack"],
  ["run_inside",       p => p.kind === "run" && (p.runType || "inside") === "inside" && !p.isQBRun && !p.isReverse],
  ["run_stretch",      p => p.kind === "run" && p.runType === "stretch"],
  ["run_counter",      p => p.kind === "run" && p.runType === "counter"],
  ["run_pitch",        p => p.kind === "run" && p.runType === "pitch"],
  ["qb_run",           p => p.kind === "run" && p.isQBRun && !p.isSpeedOption],
  ["speed_option",     p => p.kind === "run" && p.isSpeedOption],
  ["reverse",          p => p.kind === "run" && p.isReverse],
  ["two_back_run",     p => p.kind === "run" && p.isTwoBack],
  ["punt",             p => p.kind === "punt"],
  ["fg_good",          p => p.kind === "fg_good"],
  ["fg_miss",          p => p.kind === "fg_miss"],
  ["kickoff",          p => p.kind === "kickoff" && !p.isOnside],
  ["kneel",            p => p.kind === "kneel"],
  ["spike",            p => p.kind === "spike"],
  ["big_hit",          p => p.kind === "big_hit"],
  ["fumble",           p => p.kind === "fumble"],
]`;

const FRACS = [0.18, 0.34, 0.46, 0.54, 0.62, 0.78, 0.94];

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

  // Collect one exemplar play per family across several seeded games.
  // The play sheet's call-only families (reverse, option…) are forced via
  // an installed coordinator on extra games so the sheet covers them too.
  const found = await page.evaluate(`(async () => {
    const FAMS = ${FAMILIES};
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    franchise.phase = "regular";
    window._sheet = { games: [], picks: {} };   // picks: fam → {g, i}
    const scan = (g) => {
      for (let i = 0; i < gameResult.plays.length; i++) {
        const p = gameResult.plays[i];
        for (const [fam, fn] of FAMS) {
          if (window._sheet.picks[fam]) continue;
          try { if (fn(p)) { window._sheet.picks[fam] = { g, i }; break; } } catch (e) {}
        }
      }
      window._sheet.games[g] = gameResult;
    };
    const pairs = [[1, 2], [3, 4], [5, 6], [7, 8]];
    for (let g = 0; g < pairs.length; g++) {
      frnPlayGame(pairs[g][0], pairs[g][1]);
      playing = false; cancelAnimationFrame(rafId);
      scan(g);
    }
    // Forced-call game for the rare/trick families.
    const want = ["reverse", "speed_option", "run_counter", "run_pitch", "catch_high_point"];
    if (want.some(f => !window._sheet.picks[f])) {
      const calls = ["REVERSE", "READ_OPTION", "RUN_COUNTER", "RUN_TOSS", "VERTICAL", "HAIL_MARY"];
      let ci = 0;
      franchise.pendingFranchiseGame = null;
      _setSimRng(777);
      const r1 = _applyDepthChartToRoster ? franchise.rosters[9] : franchise.rosters[9];
      const sim = new GameSimulator(TEAMS[8], TEAMS[9],
        JSON.parse(JSON.stringify(franchise.rosters[9])), JSON.parse(JSON.stringify(franchise.rosters[10])));
      sim._coordinators = { home: (c) => c.kind === "playcall" ? calls[(ci++) % calls.length] : null };
      gameResult = sim.simulate();
      _clearSimRng();
      gameResult.playerLookup = new Map();
      for (const p of gameResult.homeRoster) gameResult.playerLookup.set(p.name, { ...p, team: "home" });
      for (const p of gameResult.awayRoster) gameResult.playerLookup.set(p.name, { ...p, team: "away" });
      scan(pairs.length);
    }
    return Object.keys(window._sheet.picks);
  })()`);
  console.log(`families found: ${found.length}`);

  // Render each exemplar at the key fractions; element-screenshot each frame.
  const wrap = page.locator(".bspnlive-field-wrap");
  const rows = [];   // { fam, desc, shots: [dataURL...] }
  const famList = await page.evaluate(() => Object.keys(window._sheet.picks));
  for (const fam of famList) {
    const desc = await page.evaluate((f) => {
      const pk = window._sheet.picks[f];
      gameResult = window._sheet.games[pk.g];
      playHead = pk.i;
      playing = true; startNextPlay();
      playing = false; cancelAnimationFrame(rafId);
      if (animState) { animState.slowMoUntil = 0; }
      return (gameResult.plays[pk.i].desc || "").slice(0, 70);
    }, fam);
    const shots = [];
    for (const fr of FRACS) {
      const okF = await page.evaluate((frac) => {
        if (!animState || !animState.anim) return false;
        animState.slowMoUntil = 0;
        const ctx = document.getElementById("field").getContext("2d");
        if (typeof _fcClearAll === "function") _fcClearAll();
        _frameStartBroadcast();
        try { animState.anim.render(frac, ctx); } catch (e) { return "ERR:" + e.message; }
        _frameEndBroadcast(ctx);
        return true;
      }, fr);
      if (okF !== true) { console.log(`  [${fam}] render ${fr}: ${okF}`); continue; }
      await page.waitForTimeout(60);
      shots.push((await wrap.screenshot()).toString("base64"));
    }
    rows.push({ fam, desc, shots });
    console.log(`  ✓ ${fam} (${shots.length} frames) — ${desc}`);
  }

  // Stitch the collage in a fresh page and screenshot it.
  const collage = await browser.newPage();
  const rowsHtml = rows.map(r => `
    <div class="row">
      <div class="lab"><b>${r.fam}</b><span>${r.desc.replace(/</g, "&lt;")}</span></div>
      ${r.shots.map((b, i) => `<figure><img src="data:image/png;base64,${b}"><figcaption>t=${FRACS[i]}</figcaption></figure>`).join("")}
    </div>`).join("");
  await collage.setContent(`<!doctype html><html><head><style>
    body { background: #0b0f14; color: #dde6f2; font: 12px monospace; margin: 12px; }
    .row { display: flex; gap: 4px; margin-bottom: 6px; align-items: center; }
    .lab { width: 150px; flex: 0 0 150px; display: flex; flex-direction: column; gap: 2px; }
    .lab b { color: #f5c542; font-size: 12px; } .lab span { color: #8b98ab; font-size: 8px; }
    figure { margin: 0; } img { width: 218px; display: block; border: 1px solid #222; }
    figcaption { color: #5a6678; font-size: 8px; text-align: center; }
  </style></head><body><h3 style="margin:0 0 8px">ANIMATION CONTACT SHEET — ${rows.length} families × ${FRACS.length} frames</h3>${rowsHtml}</body></html>`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  // ~170 embedded data-URL images — wait for decode explicitly (the "load"
  // event was timing out on the giant document).
  await collage.waitForFunction(
    () => [...document.images].every(i => i.complete),
    { timeout: 120000 });
  await collage.setViewportSize({ width: 1750, height: Math.min(20000, 60 + rows.length * 146) });
  await collage.waitForTimeout(800);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await collage.screenshot({ path: OUT, fullPage: true });

  // Coverage report — which families never appeared (audit to-do list).
  const allFams = (await page.evaluate(`(${FAMILIES}).map(f => f[0])`));
  const missing = allFams.filter(f => !famList.includes(f));
  console.log(`\nsheet → ${OUT}`);
  if (missing.length) console.log(`NOT COVERED (no exemplar found in seeded games): ${missing.join(", ")}`);
  if (errors.length) { console.log(`page errors: ${errors.join(" | ")}`); }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error("SHEET CRASH:", e); process.exit(2); });
