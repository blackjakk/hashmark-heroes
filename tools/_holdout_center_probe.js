// _holdout_center_probe.js — mid-season Holdout Center negotiation probe.
// Covers the modernized screen: always-on offer composer, the negotiation
// exchange (accept / concede / dig-in / final-number), defer/refuse button
// styling (the blank-white-pill regression), and Esc-to-close.
//
//   node tools/_holdout_center_probe.js        (starts its own server :5183)
//
// PASS = all scenario asserts + zero page errors.
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");

const PORT = 5183;
const ROOT = path.join(__dirname, "..");
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ FAIL ${label}`); }
};

(async () => {
  const server = spawn("npx", ["http-server", "-p", String(PORT), "-s", ROOT], { stdio: "ignore" });
  children.push(server);
  await new Promise(r => setTimeout(r, 1500));

  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on("dialog", d => d.accept());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  // Boot a franchise and plant one deterministic walk-year demand.
  await page.evaluate(() => {
    startFranchise(1);
    const myId = franchise.chosenTeamId;
    const roster = franchise.rosters[myId];
    const p = roster.filter(x => (x.overall || 0) >= 80).sort((a, b) => b.overall - a.overall)[0];
    p.contract.remaining = 1;
    const cap = franchise.salaryCap || SALARY_CAP_BASE;
    const market = computeMarketValue(p, cap);
    const tagFloor = _franchiseTagAAV({ position: p.position, name: p.name }, cap);
    const demand = Math.round(Math.max(market * 1.15, tagFloor * 0.95) * 10) / 10;
    window.__probePlayer = p.name;
    franchise.holdoutDemands = [{
      name: p.name, position: p.position, overall: p.overall, age: p.age,
      currentAAV: p.contract.aav || 5, currentRemaining: 1,
      marketValue: market, marketAAV: market, tagFloorAAV: tagFloor,
      demandedAAV: demand, demandedYears: 4,
      offer: demand, offerYears: 4, structure: "BALANCED",
      week: franchise.week, deadlineWeek: franchise.week + 4,
      defers: 0, rounds: 0, lastTalk: null, resolved: null,
    }];
    frnOpenHoldoutCenter();
  });
  await page.waitForTimeout(300);

  console.log("— composer renders + countering reachable —");
  ok(await page.locator(".frn-offer-panel").count() === 1, "offer panel is always-on (no toggle)");
  ok(await page.locator(".frn-offer-submit").count() === 1, "submit button present");
  ok((await page.locator(".frn-offer-submit").innerText()).includes("Meet the Ask"),
    "at-the-ask state labeled 'Meet the Ask'");
  ok(await page.locator(".frn-counter-aav-btn").count() >= 4, "AAV steppers present at 100% odds (old gate removed)");

  // Styling audit — the Defer pill was UA-white with invisible text.
  const deferStyle = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".frn-resign-btn")].find(b => b.textContent.includes("Defer"));
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  ok(!/rgb\(2(3[0-9]|4[0-9]|5[0-5])/.test(deferStyle.bg), `Defer button not UA-white (bg ${deferStyle.bg})`);
  ok(deferStyle.color !== deferStyle.bg && deferStyle.color !== "", `Defer text color resolves (${deferStyle.color})`);

  console.log("— concede branch (credible counter, forced miss) —");
  const r1 = await page.evaluate(() => {
    Math.random = () => 0.999; // forced miss on the accept roll
    const d = franchise.holdoutDemands[0];
    const before = d.demandedAAV;
    d.offer = Math.round(before * 0.93 * 10) / 10; // odds ~0.86 → credible
    frnRefreshHoldoutCenter();
    frnHoldoutMidSubmitOffer(window.__probePlayer);
    const after = franchise.holdoutDemands[0];
    return { before, after: after.demandedAAV, rounds: after.rounds, tone: after.lastTalk?.tone };
  });
  ok(r1.after < r1.before, `ask conceded down ${r1.before} → ${r1.after}`);
  ok(r1.rounds === 1, "one negotiation round consumed");
  ok(r1.tone === "concede", "agent response tone = concede");
  ok(await page.locator(".frn-offer-talk.tone-concede").count() === 1, "concede banner rendered");

  console.log("— dig-in branch (lowball, forced miss) —");
  const r2 = await page.evaluate(() => {
    const d = franchise.holdoutDemands[0];
    const before = d.demandedAAV;
    d.offer = Math.round(before * 0.6 * 10) / 10; // odds 0.2 → insulting
    frnRefreshHoldoutCenter();
    frnHoldoutMidSubmitOffer(window.__probePlayer);
    const after = franchise.holdoutDemands[0];
    return { before, after: after.demandedAAV, rounds: after.rounds, tone: after.lastTalk?.tone };
  });
  ok(r2.after > r2.before, `ask hardened ${r2.before} → ${r2.after}`);
  ok(r2.rounds === 2, "second round consumed");
  ok(r2.tone === "harden", "agent response tone = harden");

  console.log("— talks exhausted → final number, no roll —");
  const r3 = await page.evaluate(() => {
    const d = franchise.holdoutDemands[0];
    const before = d.demandedAAV;
    frnHoldoutMidSubmitOffer(window.__probePlayer); // still below ask
    const after = franchise.holdoutDemands[0];
    return { before, after: after.demandedAAV, tone: after.lastTalk?.tone, resolvedGone: !franchise.holdoutDemands.length };
  });
  ok(r3.after === r3.before && !r3.resolvedGone, "no roll after rounds exhausted (ask unchanged, still pending)");
  ok(r3.tone === "final", "agent response tone = final");
  ok(await page.evaluate(() =>
    document.querySelector(".frn-offer-submit")?.disabled === true), "submit disabled below ask once talks are done");

  console.log("— meeting the ask still signs after talks exhausted —");
  const r4 = await page.evaluate(() => {
    const d = franchise.holdoutDemands[0];
    d.offer = d.demandedAAV; d.offerYears = d.demandedYears;
    const ask = d.demandedAAV;
    frnRefreshHoldoutCenter();
    frnHoldoutMidSubmitOffer(window.__probePlayer);
    const p = franchise.rosters[franchise.chosenTeamId].find(x => x.name === window.__probePlayer);
    return { signedAav: p.contract.aav, ask, demandsLeft: franchise.holdoutDemands.length, unhappy: !!p.unhappy };
  });
  ok(r4.signedAav === r4.ask, `signed at the ask ($${r4.signedAav}M)`);
  ok(r4.demandsLeft === 0, "demand cleared after signing");
  ok(!r4.unhappy, "player happy at full ask");

  console.log("— below-ask ACCEPT branch (fresh demand, forced hit) —");
  const r5 = await page.evaluate(() => {
    Math.random = () => 0.0; // forced accept
    const myId = franchise.chosenTeamId;
    const p = franchise.rosters[myId].filter(x => (x.overall || 0) >= 78 && x.contract)
      .sort((a, b) => b.overall - a.overall)[1];
    p.contract.remaining = 1;
    franchise.holdoutDemands = [{
      name: p.name, position: p.position, overall: p.overall, age: p.age,
      currentAAV: p.contract.aav || 4, currentRemaining: 1,
      marketValue: 20, marketAAV: 20, tagFloorAAV: 19,
      demandedAAV: 20, demandedYears: 4,
      offer: 19, offerYears: 4, structure: "BALANCED", // 95% → odds 0.9
      week: franchise.week, deadlineWeek: franchise.week + 4,
      defers: 0, rounds: 0, lastTalk: null, resolved: null,
    }];
    frnRefreshHoldoutCenter();
    frnHoldoutMidSubmitOffer(p.name);
    return { signedAav: p.contract.aav, demandsLeft: franchise.holdoutDemands.length };
  });
  ok(r5.signedAav === 19, `accepted BELOW the ask — signed at $${r5.signedAav}M vs $20M demand`);
  ok(r5.demandsLeft === 0, "demand cleared");
  ok(await page.evaluate(() => document.body.innerText.includes("NO ACTIVE DEMANDS")),
    "modal shows resolved state");

  console.log("— Esc closes the modal —");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !document.getElementById("frn-holdout-center-modal")), "Esc closed the holdout center");

  ok(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "zero page errors");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail} checks`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
