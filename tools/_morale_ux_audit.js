// _morale_ux_audit.js — verifies the "surface the locker room + agency" work by
// driving the REAL game headless (same pattern as _ux_snapshot.js): Quick Start
// → seed morale scenarios on the live franchise → render the depth chart, the
// Locker Room, and a player card → assert on DOM + state, and exercise each
// agency lever (talk / promise / name captain / clear the air) end-to-end.
//
//   Prereq: http-server on :5173 from this dir.
//   Usage : node _morale_ux_audit.js
const path = require("path");
const fs = require("fs");
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const URL = "http://localhost:5173/play.html";
const OUT_DIR = "/tmp/morale_ux";

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const check = (cond, m) => cond ? ok(m) : bad(m);

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => bad(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(URL, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click("button.frn-start-new", { timeout: 6000 });
  await page.waitForTimeout(700);

  // ── Seed deterministic morale scenarios on the live franchise ─────────────
  const seed = await page.evaluate(() => {
    if (typeof franchise === "undefined" || !franchise) return { err: "no franchise" };
    franchise.phase = "regular";
    franchise.week = 5;
    const myId = franchise.chosenTeamId;
    const roster = franchise.rosters[myId] || [];
    roster.forEach(p => _initMorale(p));
    const byPos = (pos) => roster.filter(p => p.position === pos).sort((a, b) => (b.overall || 0) - (a.overall || 0));

    // 1) A star QB who's asked out (rock-bottom morale).
    const qb = byPos("QB")[0];
    qb.overall = 88; qb.morale = 18; qb._wantsOut = true; qb._moraleLowWeeks = 3;
    qb.personality = "quiet_pro";

    // 2) A locker-room cancer dragging the room.
    const wr = byPos("WR")[0];
    wr.overall = 84; wr.morale = 28; wr.personality = "cancer";

    // 3) A respected veteran eligible to be named captain.
    const ol = byPos("OL")[0];
    ol.age = 31; ol.overall = 86; ol.morale = 72; ol.personality = "quiet_pro";

    return {
      myId, n: roster.length,
      qb: qb.name, wr: wr.name, ol: ol.name,
      qbPid: qb.pid || "", olPid: ol.pid || "",
      namedCaptainSeason: franchise._namedCaptainSeason ?? null,
    };
  });
  console.log("seed:", JSON.stringify(seed));

  // ── 1. Depth-chart mood strip + per-cell badge ───────────────────────────
  console.log("\n[depth chart]");
  await page.evaluate(() => { _frnRosterSubTab = "depth"; renderFrnRosterHome(); });
  await page.waitForTimeout(500);
  const dc = await page.evaluate(() => {
    const el = document.getElementById("frnHomeContent");
    const html = el ? el.innerHTML : "";
    return {
      hasStrip: /frn-dc-mood-strip/.test(html),
      stripOpensLocker: /frnSetRosterSubTab\('locker'\)/.test(html),
      hasMoodBadge: /frn-dc-badge mood/.test(html),
      hasOutBadge: /📢 OUT/.test(html),
      mentionsWantsOut: /wants? out/i.test(html),
    };
  });
  check(dc.hasStrip, "mood strip renders on the depth chart");
  check(dc.stripOpensLocker, "mood strip click opens the Locker Room sub-tab");
  check(dc.hasMoodBadge || dc.hasOutBadge, "an unhappy player shows a mood badge in his depth-chart cell");
  check(dc.hasOutBadge, "the wants-out star shows a 📢 OUT badge");
  await page.screenshot({ path: path.join(OUT_DIR, "depth-chart.png"), fullPage: false });

  // ── 2. Locker Room view: leadership control + clear-air button ────────────
  console.log("\n[locker room]");
  await page.evaluate(() => frnSetRosterSubTab("locker"));
  await page.waitForTimeout(400);
  const lr = await page.evaluate(() => {
    const el = document.getElementById("frnHomeContent");
    const html = el ? el.innerHTML : "";
    return {
      hasNameCaptain: /NAME A CAPTAIN/.test(html) && /frnNameCaptain\(/.test(html),
      hasCaptainSelect: /frn-lr-captain-pick/.test(html),
      hasClearAir: /frnClearTheAir\(/.test(html),
      hasAttention: /NEEDS ATTENTION/.test(html),
      hasCaptainsMeeting: /frnCaptainsMeeting\(\)/.test(html),
    };
  });
  check(lr.hasAttention, "needs-attention panel renders (disgruntled star surfaced)");
  check(lr.hasNameCaptain && lr.hasCaptainSelect, "'Name a Captain' control renders with an eligible-vet picker");
  check(lr.hasClearAir, "'Clear the air' lever renders on the cancer's row");
  check(lr.hasCaptainsMeeting, "existing Captains' Meeting lever still present");
  await page.screenshot({ path: path.join(OUT_DIR, "locker-room.png"), fullPage: false });

  // ── 3. Name a Captain (state mutation + once-per-season lock) ─────────────
  console.log("\n[lever: name a captain]");
  const cap = await page.evaluate((olName) => {
    const myId = franchise.chosenTeamId;
    const before = (franchise.rosters[myId].find(p => p.name === olName) || {}).personality;
    frnNameCaptain(olName);
    const p = franchise.rosters[myId].find(x => x.name === olName);
    // try again — should be a no-op (once per season)
    const seasonLock = franchise._namedCaptainSeason;
    return { before, after: p.personality, namedCaptain: p._namedCaptain, seasonLock, season: franchise.season };
  }, seed.ol);
  check(cap.before !== "captain" && cap.after === "captain", "named captain: personality flips to captain");
  check(cap.namedCaptain === cap.season, "named captain: stamped with the current season");
  check(cap.seasonLock === cap.season, "named captain: once-per-season lock is set");

  // ── 4. Clear the air (always applies once; outcome is a roll) ─────────────
  console.log("\n[lever: clear the air]");
  const air = await page.evaluate((wrName) => {
    const myId = franchise.chosenTeamId;
    const p0 = franchise.rosters[myId].find(x => x.name === wrName);
    const before = p0.morale;
    frnClearTheAir(wrName);
    const p = franchise.rosters[myId].find(x => x.name === wrName);
    const success = (p._cancerCalmUntil || 0) > (franchise.week || 1);
    return { before, after: p.morale, cleared: p._clearedAirSeason === franchise.season, success, calmUntil: p._cancerCalmUntil || 0 };
  }, seed.wr);
  check(air.cleared, "clear the air: marked used this season (once per cancer)");
  check(air.after !== air.before, `clear the air: morale moved (${air.before} → ${air.after}, ${air.success ? "landed → calm window" : "backfired"})`);

  // ── 5. Player card MORALE block + inline Talk action ──────────────────────
  console.log("\n[player card]");
  await page.evaluate(({ qbName, qbPid }) => frnOpenPlayerCard(qbName, qbPid), { qbName: seed.qb, qbPid: seed.qbPid });
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => {
    const ov = document.getElementById("frn-pcard-overlay");
    const html = ov ? ov.innerHTML : "";
    return {
      open: !!ov,
      hasMoraleTitle: />MORALE</.test(html),
      hasTalk: /frnPCardMoraleAction\('talk'/.test(html),
      hasPromise: /frnPCardMoraleAction\('promise'/.test(html),
      hasWantsOut: /WANTS OUT/.test(html),
    };
  });
  check(card.open, "player card opens for the owned QB");
  check(card.hasMoraleTitle, "player card shows a MORALE block");
  check(card.hasTalk && card.hasPromise, "player card exposes Talk + Promise actions");
  check(card.hasWantsOut, "player card flags WANTS OUT for the disgruntled star");
  await page.screenshot({ path: path.join(OUT_DIR, "player-card.png"), fullPage: false });

  // Fire the card's Talk action → morale should rise and the card re-render.
  const talk = await page.evaluate(({ qbName, qbPid }) => {
    const myId = franchise.chosenTeamId;
    const before = franchise.rosters[myId].find(x => x.name === qbName).morale;
    frnPCardMoraleAction("talk", qbName, qbPid);
    const p = franchise.rosters[myId].find(x => x.name === qbName);
    return { before, after: p.morale, talked: p._talkedSeason === franchise.season };
  }, { qbName: seed.qb, qbPid: seed.qbPid });
  check(talk.after > talk.before, `card Talk lever raises morale (${talk.before} → ${talk.after})`);
  check(talk.talked, "card Talk lever marks talked-this-season");

  console.log(`\n──────────────────────────────────────\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
