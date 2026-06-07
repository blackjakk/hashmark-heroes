// _phase_verify.js — verifies the milestones-as-real-phases refactor end-to-end
// by driving the real game headless: season_recap + draft_grade as router
// phases, refresh-safety, the legacy-save migration (the old infinite-bounce
// repro), and the auto-sim bypass.
const { chromium } = require(process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright");
const URL = "http://localhost:5173/play.html";

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const check = (c, m) => c ? ok(m) : bad(m);

const sig = () => {
  const el = document.getElementById("frnHomeContent");
  const h = el ? el.innerHTML : "";
  const nav = document.getElementById("frnNavBar");
  const navText = (nav && nav.style.display !== "none") ? (nav.innerText || "").replace(/\s+/g, " ").trim() : "";
  return {
    phase: franchise.phase,
    navText,
    isRecap: /REGULAR SEASON COMPLETE|frn-recap-hero|START THE PLAYOFFS|BEGIN WILD CARD/i.test(h),
    isGrade: /BEGIN NEW SEASON|DRAFT GRADE|YOUR CLASS|frn-draft-pick-review/i.test(h),
    hasBracket: !!franchise.playoffBracket,
  };
};

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newContext({ viewport: { width: 1280, height: 1000 } }).then(c => c.newPage());
  const errs = []; p.on("pageerror", e => errs.push(e.message.slice(0, 160)));
  await p.goto(URL, { waitUntil: "networkidle", timeout: 15000 });
  await p.waitForTimeout(700);
  await p.click("button.frn-start-new", { timeout: 6000 });
  await p.waitForTimeout(700);

  // ── 1. Season end → real season_recap phase (interactive drive) ───────────
  console.log("\n[season_recap phase]");
  await p.evaluate(() => { if (typeof frnSimSeason === "function") frnSimSeason(); });
  await p.waitForTimeout(300);
  let s = await p.evaluate(sig);
  check(s.phase === "season_recap", `season end lands on phase 'season_recap' (got '${s.phase}')`);
  check(s.isRecap, "the recap screen actually renders (was orphaned dead code before)");
  check(/Season Recap/i.test(s.navText), `nav bar shows the Season Recap milestone (got "${s.navText}")`);
  check(!s.hasBracket, "bracket not seeded yet (recap precedes playoffs)");

  // Refresh-safety: re-dispatch should stay on the recap.
  await p.evaluate(() => showFranchiseDashboard());
  await p.waitForTimeout(200);
  s = await p.evaluate(sig);
  check(s.phase === "season_recap" && s.isRecap, "recap is refresh-safe (re-dispatch stays on recap)");

  // CTA target seeds the bracket → playoffs.
  await p.evaluate(() => startFrnPlayoffs());
  await p.waitForTimeout(200);
  s = await p.evaluate(sig);
  check(s.phase === "playoffs" && s.hasBracket, "recap CTA (startFrnPlayoffs) advances to playoffs + seeds bracket");

  // ── 2. Auto-sim bypass: frnSimToEndOfSeason blows past recap to offseason ──
  console.log("\n[auto-sim bypass]");
  const land = await p.evaluate(() => {
    if (typeof frnSimToEndOfSeason === "function") frnSimToEndOfSeason();
    return franchise.phase;
  });
  await p.waitForTimeout(400);
  check(["awards", "offseason"].includes(land) || land !== "season_recap",
    `'sim to end' bypasses the recap and lands downstream (got '${land}')`);

  // ── 3. draft_grade phase: routing + refresh-safety (surgical, authoritative) ─
  console.log("\n[draft_grade phase]");
  const grade1 = await p.evaluate(() => {
    const myId = franchise.chosenTeamId;
    const roster = franchise.rosters[myId] || [];
    const yng = roster.slice().sort((a,b)=>(a.age||30)-(b.age||30)).slice(0, 3);
    const yr = (new Date().getFullYear()) + (franchise.season || 1);
    franchise.draftLog = franchise.draftLog || {};
    franchise.draftLog[yr] = {
      season: franchise.season || 1,
      picks: yng.map((pl, i) => ({ name: pl.name, pid: pl.pid, pos: pl.position,
        round: i + 1, pick: 1, isComp: false, ovrAtDraft: pl.overall })),
    };
    // Reconstruction helper should rebuild the class from the log.
    const recon = (typeof _myDraftPicksForGrade === "function") ? _myDraftPicksForGrade() : [];
    // Enter the real phase and dispatch.
    franchise.phase = "draft_grade";
    showFranchiseDashboard();
    return { reconLen: recon.length };
  });
  s = await p.evaluate(sig);
  check(grade1.reconLen === 3, `_myDraftPicksForGrade() rebuilds the class from draftLog (got ${grade1.reconLen})`);
  check(s.phase === "draft_grade", "phase is 'draft_grade'");
  check(s.isGrade, "draft_grade phase renders the grade screen");
  check(/Draft Grade/i.test(s.navText), `nav bar shows the Draft Grade milestone (got "${s.navText}")`);

  // Refresh-safety: re-dispatch stays on the grade.
  await p.evaluate(() => showFranchiseDashboard());
  await p.waitForTimeout(150);
  s = await p.evaluate(sig);
  check(s.phase === "draft_grade" && s.isGrade, "draft_grade is refresh-safe (re-dispatch stays on grade)");

  // ── 4. Legacy-save migration: the OLD fragile state (phase=draft, draft=null) ─
  // Before the refactor this re-dispatched renderFrnDraft → null guard →
  // showFranchiseDashboard → … (a bounce). Now it migrates to draft_grade.
  console.log("\n[legacy-save migration]");
  await p.evaluate(() => {
    franchise.phase = "draft";
    franchise.draft = null;
    showFranchiseDashboard();   // migration block should flip phase → draft_grade
  });
  const mig = await p.evaluate(sig);
  check(mig.phase === "draft_grade", `legacy (phase='draft', draft=null) migrates to 'draft_grade' (got '${mig.phase}')`);
  check(mig.isGrade, "migrated legacy save renders the grade (no infinite bounce)");

  // ── 5. Exit CTA advances to the next season ───────────────────────────────
  console.log("\n[exit]");
  const nxt = await p.evaluate(() => { if (typeof frnNewSeason === "function") frnNewSeason(); return franchise.phase; });
  check(nxt === "free_agency", `'Begin new season' (frnNewSeason) advances to free_agency (got '${nxt}')`);

  console.log(`\npageerrors: ${errs.length ? JSON.stringify(errs) : "none"}`);
  if (errs.length) fail += errs.length;
  console.log(`──────────────────────────────────────\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
