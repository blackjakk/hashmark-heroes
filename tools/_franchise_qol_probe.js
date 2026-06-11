// _franchise_qol_probe.js — detector battery for the QoL batch:
//   1. BYE WEEKS — 18-week calendar, 17 games/team, every team rests
//      exactly once (week 9 or 10), totals exact, full season sims to
//      playoffs, dashboard bye card renders.
//   2. IR PLAYER CARD — clicking an IR player opens his live card, not
//      the retired-player modal.
//   3. AUTO-RESTRUCTURE — over-cap roster restructures to (or toward)
//      compliance in one confirmed plan with a per-season spread.
//   4. NEXT MAN UP — a team with zero healthy RBs fields a converted
//      neighbor at an out-of-position penalty, never a 50-OVR ghost.
//   5. STREET FA — mid-season signing: pool → roster, cap charged,
//      1-year street deal.
//
//   node tools/_franchise_qol_probe.js     (starts its own server :5199)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5199;
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
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log("— 1. bye weeks: schedule shape —");
  const sched = await page.evaluate(() => {
    let s = 0xB1E;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    const sch = franchise.schedule;
    const byWeek = {};
    const gamesByTeam = {};
    const byeByTeam = {};
    for (const g of sch) {
      byWeek[g.week] = (byWeek[g.week] || 0) + 1;
      gamesByTeam[g.homeId] = (gamesByTeam[g.homeId] || 0) + 1;
      gamesByTeam[g.awayId] = (gamesByTeam[g.awayId] || 0) + 1;
    }
    for (const t of TEAMS) {
      const wks = new Set(sch.filter(g => g.homeId === t.id || g.awayId === t.id).map(g => g.week));
      const missing = [];
      for (let w = 1; w <= FRANCHISE_WEEKS; w++) if (!wks.has(w)) missing.push(w);
      byeByTeam[t.id] = missing;
    }
    return { total: sch.length, weeks: FRANCHISE_WEEKS, byWeek, gamesByTeam, byeByTeam,
             dupCheck: sch.every(g => g.homeId !== g.awayId) };
  });
  ok(sched.weeks === 18, `FRANCHISE_WEEKS = 18`);
  ok(sched.total === 272, `272 games total (got ${sched.total})`);
  ok(Object.values(sched.gamesByTeam).every(n => n === 17), "every team plays exactly 17 games");
  ok(Object.values(sched.byeByTeam).every(m => m.length === 1 && (m[0] === 9 || m[0] === 10)),
    "every team has exactly ONE bye, in week 9 or 10");
  ok(sched.byWeek[9] === 8 && sched.byWeek[10] === 8, `bye weeks host 8 games each (W9=${sched.byWeek[9]}, W10=${sched.byWeek[10]})`);
  ok(Object.entries(sched.byWeek).filter(([w]) => +w !== 9 && +w !== 10).every(([, n]) => n === 16),
    "all other weeks host 16 games");
  ok(sched.dupCheck, "no team plays itself");

  console.log("— 1b. bye dashboard card + season completes —");
  const bye = await page.evaluate(async () => {
    const myId = franchise.chosenTeamId;
    const myWeeks = new Set(franchise.schedule.filter(g => g.homeId === myId || g.awayId === myId).map(g => g.week));
    let byeW = null;
    for (let w = 1; w <= FRANCHISE_WEEKS; w++) if (!myWeeks.has(w)) { byeW = w; break; }
    franchise.phase = "regular";   // probe skips the preseason/FA flow
    frnSimToWeek(byeW - 1);
    await new Promise(r => setTimeout(r, 200));
    // dashboard should now show the bye card (we're AT the bye week)
    showFranchiseDashboard();
    const txt = document.body.innerText;
    return { byeW, week: franchise.week, hasByeCard: txt.includes("BYE"),
             hasByeRow: [...document.querySelectorAll(".frn-gauntlet-card")].some(c => c.textContent.includes("BYE WEEK")) };
  });
  ok(bye.week === bye.byeW, `simmed to the user's bye week (W${bye.byeW})`);
  ok(bye.hasByeCard && bye.hasByeRow, "dashboard renders the BYE card + schedule BYE row");
  const fin = await page.evaluate(async () => {
    frnSimSeason();
    await new Promise(r => setTimeout(r, 400));
    const gp = Object.values(franchise.standings).map(s => (s.w||0)+(s.l||0)+(s.t||0));
    return { week: franchise.week, phase: franchise.phase, gpMin: Math.min(...gp), gpMax: Math.max(...gp) };
  });
  ok(fin.week > 18, `season simmed through week 18 (now W${fin.week}, phase=${fin.phase})`);
  ok(fin.gpMin === 17 && fin.gpMax === 17, `every team finished 17 games (${fin.gpMin}-${fin.gpMax})`);

  console.log("— 2. IR player card —");
  const ir = await page.evaluate(() => {
    const myId = franchise.chosenTeamId;
    const p = franchise.rosters[myId].find(x => (x.overall || 0) >= 70);
    p.injury = { label: "torn ACL", weeksRemaining: 10 };
    // use the real IR pipeline if present, else simulate its storage shape
    if (typeof moveToIR === "function") { try { moveToIR(myId, p); } catch (e) {} }
    if (!((franchise.ir || {})[myId] || []).includes(p)) {
      franchise.rosters[myId] = franchise.rosters[myId].filter(x => x !== p);
      (franchise.ir ||= {}); (franchise.ir[myId] ||= []).push(p);
    }
    frnOpenPlayerCard(p.name);
    const body = document.getElementById("frn-pcard-overlay")?.innerText || "";
    const retired = body.includes("RETIRED") || body.includes("HALL OF FAME");
    const live = body.includes("VITALS") || body.includes("Compare");
    frnClosePlayerModal();
    return { name: p.name, retired, live };
  });
  ok(!ir.retired, `IR player card is NOT the retired modal (${ir.name})`);
  ok(ir.live, "IR player card renders the live panel");

  console.log("— 3. auto-restructure —");
  const rs = await page.evaluate(async () => {
    const myId = franchise.chosenTeamId;
    // Force an over-cap state with restructure-eligible deals
    const roster = franchise.rosters[myId];
    for (const p of roster.slice(0, 8)) {
      if (!p.contract) continue;
      p.contract.years = 3; p.contract.remaining = 3;
      p.contract.aav = (p.contract.aav || 4) + 12;
      p.contract.baseSalaries = [p.contract.aav, p.contract.aav, p.contract.aav];
      p.contract.bonusProration = 0;
      delete p.contract.restructuredSeason;
    }
    const cap = effectiveSalaryCap(myId);
    const before = capUsedByTeam(myId);
    if (before <= cap) return { skip: true, before, cap };
    window._frnConfirm = async () => true;   // auto-accept the plan
    await frnFAAutoRestructure();
    const after = capUsedByTeam(myId);
    return { before, after, cap, freed: before - after };
  });
  if (rs.skip) ok(false, `couldn't force over-cap (used ${rs.before} vs cap ${rs.cap})`);
  else {
    ok(rs.after < rs.before, `auto-restructure freed $${rs.freed.toFixed(1)}M (${rs.before.toFixed(1)} → ${rs.after.toFixed(1)}, cap ${rs.cap.toFixed(1)})`);
    ok(rs.after <= rs.cap || rs.freed > 0, "moved to/toward compliance");
  }

  console.log("— 4. next man up (all RBs hurt) —");
  const nmu = await page.evaluate(() => {
    const aId = TEAMS.find(t => t.id !== franchise.chosenTeamId).id;
    const roster = franchise.rosters[aId];
    for (const p of roster) if (p.position === "RB") p.injury = { label: "hamstring", weeksRemaining: 3 };
    const patched = _emergencyDepthPatch(roster, aId);
    const healthyRBs = patched.roster.filter(p => p.position === "RB" && !(p.injury && p.injury.weeksRemaining > 0));
    const conv = patched.conversions.find(c => c.to === "RB");
    // and through the real sim factory:
    const sim = _frnBuildLiveSim(aId, franchise.chosenTeamId, false, null, true);
    const rbStarter = sim.homeR.starters.rb;
    const isGhost = rbStarter === "RB";
    // cleanup
    for (const p of roster) if (p.position === "RB" && p.injury?.label === "hamstring") delete p.injury;
    return { healthyRBs: healthyRBs.length, conv, rbStarter, isGhost,
             penalized: healthyRBs[0] ? healthyRBs[0]._emergencyFrom != null : false };
  });
  ok(nmu.healthyRBs >= 1, `patched roster has a healthy RB (${nmu.healthyRBs})`);
  ok(!!nmu.conv, `conversion recorded (${nmu.conv ? nmu.conv.from + " " + nmu.conv.name + " → RB" : "none"})`);
  ok(!nmu.isGhost, `engine starter is a real player (${nmu.rbStarter}), not the ghost`);
  ok(nmu.penalized, "convert carries the out-of-position penalty marker");

  console.log("— 5. street FA signing —");
  const fa = await page.evaluate(() => {
    const myId = franchise.chosenTeamId;
    _streetFATopUp();   // the street never runs dry — top-up is part of the feature
    if (!(franchise.freeAgents || []).length) return { skip: true };
    // ensure a roster spot
    while (typeof rosterSpaceLeft === "function" && rosterSpaceLeft(myId) <= 0) {
      const cut = franchise.rosters[myId].reduce((a, b) => ((a.overall||0) < (b.overall||0) ? a : b));
      franchise.rosters[myId] = franchise.rosters[myId].filter(x => x !== cut);
    }
    const room = effectiveSalaryCap(myId) - capUsedByTeam(myId);
    const target = franchise.freeAgents.slice().sort((a,b)=>_streetFAPrice(a)-_streetFAPrice(b))
      .find(p => _streetFAPrice(p) <= room);
    if (!target) return { skip: true };
    const poolBefore = franchise.freeAgents.length;
    const rosterBefore = franchise.rosters[myId].length;
    const usedBefore = capUsedByTeam(myId);
    frnOpenStreetFA();
    frnSignStreetFA(target.name);
    frnCloseStreetFA();
    const onRoster = franchise.rosters[myId].some(p => p.name === target.name);
    return { name: target.name, onRoster,
             poolDelta: poolBefore - franchise.freeAgents.length,
             rosterDelta: franchise.rosters[myId].length - rosterBefore,
             capDelta: +(capUsedByTeam(myId) - usedBefore).toFixed(1),
             deal: franchise.rosters[myId].find(p => p.name === target.name)?.contract };
  });
  if (fa.skip) ok(false, "no street FA pool to test against");
  else {
    ok(fa.onRoster && fa.poolDelta === 1 && fa.rosterDelta === 1, `${fa.name} signed: pool -1, roster +1`);
    ok(fa.capDelta > 0, `cap charged ($${fa.capDelta}M)`);
    ok(fa.deal && fa.deal.years === 1 && fa.deal.remaining === 1, "1-year street deal");
  }

  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "zero page errors");
  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
