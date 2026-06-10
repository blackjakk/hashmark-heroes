// _kb_offseason_probe.js — §F keyboard-only offseason walkthrough (V5).
// Drives a fresh franchise to season end programmatically, then traverses
// the ENTIRE playoffs + offseason using ONLY Tab/Enter: season recap →
// every playoff round → crown → awards → re-signings (bulk walk + review)
// → draft (begin, draft a prospect by keyboard, sim all rounds, finish) →
// draft grade → free agency (submit an offer by keyboard) → Season 2.
// PASS = "COMPLETED a full offseason loop" + both core-action OKs + zero
// page errors. This is the detector for CODEBASE_AUDIT_PLAN §F's
// "one offseason playable keyboard-only" criterion.
//
//   npx http-server -p 5173 .   (serve the game first)
//   node tools/_kb_offseason_probe.js
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("dialog", d => d.accept());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 120)));
  await page.goto("http://localhost:5173/play.html", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);

  await page.evaluate(async () => {
    let s = 0xABCD;
    Math.random = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    startFranchise(1);
    frnSimSeason();
    await new Promise(r => setTimeout(r, 300));
  });

  const phaseInfo = async () => page.evaluate(() => ({
    phase: franchise?.phase, week: franchise?.week, season: franchise?.season,
    played: franchise?.schedule?.filter(g => g.played).length ?? 0,
    stamp: franchise?._saveStamp ?? 0,
    bracket: JSON.stringify(franchise?.playoffBracket ?? null).length,
    ui: document.querySelectorAll("button, [onclick]").length * 100000
      + (document.body.innerText.length % 100000),
  }));

  // Tab-walk the page recording every reachable element; look for a CTA
  // matching the given regexes in priority order; Enter it.
  // Walk the full Tab cycle per matcher TIER (priority beats tab order),
  // pressing Enter on the first element the tier matches.
  const kbTry = async (matchers) => {
    const budget = await page.evaluate(() =>
      [...document.querySelectorAll("button, [onclick], a[href], [tabindex], input, select")]
        .filter(e => e.offsetParent !== null).length + 25);
    for (const m of matchers) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); window.__kbFirst = null; });
      for (let i = 0; i < budget; i++) {
        await page.keyboard.press("Tab");
        const el = await page.evaluate((idx) => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          // mark the first focused element; stop when we cycle back to it
          if (!window.__kbFirst) { window.__kbFirst = a; }
          return { text: (a.textContent || a.value || "").trim().replace(/\s+/g, " ").slice(0, 50), tag: a.tagName,
                   wrapped: window.__kbFirst === a && idx > 5 };
        }, i);
        if (!el) continue;
        if (el.wrapped) break;
        if (m.test(el.text)) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(500);
          for (let k = 0; k < 3; k++) {
            if (!await page.evaluate(() => !!document.querySelector(".frn-modal-backdrop"))) break;
            await page.keyboard.press("Enter");
            await page.waitForTimeout(500);
          }
          for (let k = 0; k < 40; k++) {
            const busy = await page.evaluate(() =>
              !!document.querySelector(".frn-modal-backdrop") ||
              !!document.querySelector(".frn-sim-spinner, .frn-spinner, [data-spinner]"));
            if (!busy) break;
            await page.waitForTimeout(500);
          }
          return { hit: el.text };
        }
      }
    }
    return { hit: null };
  };

  // Per-phase CTA expectations (discovered iteratively; regexes are loose).
  const CTA = [
    /begin offseason|enter offseason|new season|start (the )?next season|kick off season/i,
    /crown|champion/i,
    /go to draft|to the draft|start the draft|begin draft|start free agency|begin free agency|lock in/i,
    /\b(continue|advance|proceed|begin|start|sim|finish|confirm)\b|skip to|on to |⏭/i,
    /walk all/i,
    /\b(let walk|decline)\b/i,
  ];

  let info = await phaseInfo();
  console.log("START:", JSON.stringify(info), "errors:", errors.length);
  const visited = [];
  for (let step = 0; step < 70; step++) {
    info = await phaseInfo();
    if (visited.length && visited[visited.length - 1].phase === info.phase) {
      // same phase as last step — record the failure detail and stop
    }
    const clickables = await page.evaluate(() => {
      const els = [...document.querySelectorAll("button, [onclick], a[href], [tabindex]")]
        .filter(e => e.offsetParent !== null);
      return {
        total: els.length,
        untabbable: els.filter(e => e.tabIndex < 0 || (e.tagName !== "BUTTON" && e.tagName !== "A" && e.tagName !== "INPUT" && e.tagName !== "SELECT" && !e.hasAttribute("tabindex"))).length,
        primaries: els.filter(e => /continue|advance|proceed|begin|start free|start draft|sim|enter draft|finish|on to/i.test(e.textContent || "")).slice(0, 4).map(e => ({
          tag: e.tagName, text: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 45),
          tabbable: e.tabIndex >= 0,
        })),
      };
    });
    // Core-action sub-tests (reported, non-blocking): can you make YOUR
    // pick / sign a specific FA purely by keyboard?
    if (info.phase === "draft" && !global.__draftActionOK) {
      const boardUp = await page.evaluate(() => /Sim Rest of R/i.test(document.body.innerText));
      const t = boardUp ? await kbTry([/^DRAFT$/]) : { hit: null };
      if (t.hit) { global.__draftActionOK = true; console.log("     [core-action] draft-a-prospect via keyboard: OK — " + t.hit); }
      
    }
    if (info.phase === "free_agency" && !global.__faActionTried) {
      global.__faActionTried = true;
      const t = await kbTry([/make offer|\boffer\b|\bsign\b|pursue/i]);
      console.log("     [core-action] sign-an-FA via keyboard:", t.hit ? "OK — " + t.hit : "NOT FOUND");
    }
    const r = await kbTry(CTA);
    const after = await phaseInfo();
    const advanced = after.phase !== info.phase || after.season !== info.season
      || after.week !== info.week || after.played !== info.played
      || after.stamp !== info.stamp || after.bracket !== info.bracket
      || after.ui !== info.ui;
    console.log(`[${String(step).padStart(2)}] ${info.phase} → ${after.phase}${advanced ? "" : "  ⚠ STUCK"}  kb-hit=${JSON.stringify(r.hit)}  clickables=${clickables.total} untabbable=${clickables.untabbable}`);
    if (!advanced) {
      const diag = await page.evaluate(() => {
        const els = [...document.querySelectorAll("button, [onclick], a[href], [tabindex]")].filter(e => e.offsetParent !== null);
        return els.filter(e => /draft|free agen|advance|continue|proceed|next phase|begin|lock/i.test(e.textContent || ""))
          .slice(0, 14).map(e => ({ tag: e.tagName, ti: e.tabIndex,
            text: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 55) }));
      });
      console.log("     advance-ish elements:", JSON.stringify(diag, null, 1));
      // full tab-cycle census
      const census = [];
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); window.__kbFirst = null; });
      for (let i = 0; i < 260; i++) {
        await page.keyboard.press("Tab");
        const el = await page.evaluate((idx) => {
          const a = document.activeElement;
          if (!a || a === document.body) return { body: true };
          if (!window.__kbFirst) window.__kbFirst = a;
          return { text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 35), tag: a.tagName,
                   wrapped: window.__kbFirst === a && idx > 5 };
        }, i);
        if (el.wrapped) { census.push("«WRAP at " + i + "»"); break; }
        census.push(el.body ? "(body)" : el.tag + ":" + el.text);
      }
      console.log("     census n=" + census.length);
      console.log("     first 10:", JSON.stringify(census.slice(0, 10)));
      console.log("     last 10:", JSON.stringify(census.slice(-10)));
      console.log("     has decline:", census.some(t => /decline/i.test(t)));
      await page.screenshot({ path: "/tmp/v5kb_stuck.png", fullPage: false });
      break;
    }
    visited.push(after);
    if (after.phase === "regular" && after.season >= 2) { console.log("COMPLETED a full offseason loop"); break; }
    await page.waitForTimeout(300);
  }
  console.log("page errors:", errors.length, errors.slice(0, 3));
  await browser.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
