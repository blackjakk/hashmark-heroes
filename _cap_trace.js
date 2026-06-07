// Cap-utilization trace — headless franchise sim that measures cap utilization
// at TWO points each season:
//   (B) ENTERING the season — the roster as set by the prior offseason, AFTER
//       enforceCapFloor pumped it to ~99% (the "high").
//   (A) SEASON-END — after the regular season's in-season churn (injuries,
//       mid-season signings, cuts) but BEFORE the offseason re-signs (the "low").
// The in-season drop = B − A. The franchise-length DRIFT is whether A (and B)
// decay as the cap inflates — the signature of flat (non-cap-relative) salary
// floors leaking utilization over a long franchise. Same bundle approach as
// _brady_audit.js. Usage: node _cap_trace.js [seasons]
const fs = require("fs");
const path = require("path");

const SEASONS = Number(process.argv[2] || 30);

const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                if (k === Symbol.toPrimitive) return () => 0;
                if (k === "value" || k === "innerHTML" || k === "textContent") return "";
                if (k === "checked" || k === "disabled") return false;
                if (k === "children" || k === "childNodes") return [];
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
    has() { return true; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
    head: _stub, location: { hash: "" },
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = (cb) => setTimeout(() => { if (typeof cb === "function") cb(Date.now()); }, 0);
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  var location = { hash: "" };
  var alert = () => {};
  var confirm = () => true;
  var prompt = () => "";
  var indexedDB = { open: () => ({ onsuccess: null, onerror: null, result: null }) };
`;

const files = [
  "play-data.js",
  "play-player.js",
  "play-render.js",
  "play-sim.js",
  "play-motion.js",
  "play-engine.js",
  "play-broadcast.js",
  "play-franchise-core.js",
  "play-franchise-season.js",
  "play-franchise-stats.js",
  "play-franchise-offseason.js",
];

function stripUiInit(code, file) {
  let c = code;
  if (file === "play-render.js") {
    c = c.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [trace] stripped")
         .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [trace] stripped");
  }
  if (file === "play-franchise-stats.js") {
    c = c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm, "// [trace] stripped");
  }
  if (file === "play-franchise-offseason.js") {
    c = c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm, "// [trace] stripped");
  }
  return c;
}

const extraConsts = `
  function showFranchiseDashboard() {}
  function renderFrnPreseason() {}
  function renderFrnDashboard() {}
  function _flushSaveFranchise() {}
  function saveFranchise() {}
`;

const harness = `
;(async function capTrace() {
  if (typeof startFranchise !== "function") { console.error("startFranchise missing"); process.exit(1); }
  console.error("Cap-trace: " + ${SEASONS} + " seasons.");
  if (typeof _frnConfirm !== "undefined") _frnConfirm = async () => true;
  const _origWarn = console.warn, _origErr = console.error;
  const _mute = (s) => typeof s === "string" && (
    s.indexOf("missing pick row") >= 0 || s.indexOf("[IDB") >= 0 ||
    s.indexOf("indexedDB") >= 0 || s.indexOf("Dashboard render") >= 0 || s.indexOf("[save]") >= 0);
  console.warn  = function(...a) { if (!_mute(a[0])) _origWarn.apply(console, a); };
  console.error = function(...a) { if (!_mute(a[0])) _origErr.apply(console, a); };
  // No-op the render functions. In the new Function() scope these are LOCAL
  // bindings (not globalThis properties), so reassign each directly — otherwise
  // the real renders run and throw on undefined team.city/.name, and (worse)
  // showFrnAwards / the offseason chain call them INTERNALLY.
  if (typeof showFranchiseDashboard === "function") showFranchiseDashboard = function(){};
  if (typeof renderFrnPreseason === "function")     renderFrnPreseason = function(){};
  if (typeof renderFrnDashboard === "function")     renderFrnDashboard = function(){};
  if (typeof renderFrnSeasonRecap === "function")   renderFrnSeasonRecap = function(){};
  if (typeof renderFrnOffseason === "function")     renderFrnOffseason = function(){};
  if (typeof renderFrnDraft === "function")         renderFrnDraft = function(){};
  if (typeof renderFrnAwards === "function")        renderFrnAwards = function(){};
  if (typeof renderFrnResignings === "function")    renderFrnResignings = function(){};
  if (typeof _startDraftFloorAnim === "function")   _startDraftFloorAnim = function(){};
  if (typeof _flushSaveFranchise === "function")    _flushSaveFranchise = function(){};
  if (typeof saveFranchise === "function")          saveFranchise = function(){};
  try { startFranchise(0); } catch (e) { console.error("startFranchise threw:", e.message); process.exit(1); }
  if (!franchise) { console.error("franchise global not populated"); process.exit(1); }

  function step(fn, label, s) { if (typeof fn !== "function") return;
    try { fn(); } catch (e) { console.error("[trace] "+label+" threw (s"+s+"): "+e.message); } }
  async function stepA(fn, label, s) { if (typeof fn !== "function") return;
    try { await fn(); } catch (e) { console.error("[trace] "+label+" threw async (s"+s+"): "+e.message); } }

  // Aggregate cap snapshot across all teams. Returns mean utilization plus the
  // composition that explains it: active-roster hit, dead cap, practice squad,
  // and the share occupied by minimum-tier contracts (the flat-floor suspect).
  function snap() {
    const cap = franchise.salaryCap || 0;
    let nT=0, sumActive=0, sumTrue=0, sumPS=0, sumDead=0, sumMin=0, nMin=0;
    const minThresh = cap * 0.006;          // ~min-tier ceiling (1.5× the 0.4% floor)
    for (const t of TEAMS) {
      const roster = (franchise.rosters && franchise.rosters[t.id]) || [];
      if (!roster.length || !cap) continue;
      let active = 0, minDollars = 0;
      for (const p of roster) {
        const h = (typeof currentYearCapHit === "function") ? currentYearCapHit(p) : 0;
        active += h;
        if (p.contract && (p.contract.aav || 0) <= minThresh) { minDollars += h; nMin++; }
      }
      const trueUsed = (typeof capUsedByTeam === "function") ? capUsedByTeam(t.id) : active;
      const ps = (typeof psCostForTeam === "function") ? psCostForTeam(t.id) : 0;
      sumActive += active/cap; sumTrue += trueUsed/cap; sumPS += ps/cap;
      sumDead += Math.max(0, (trueUsed - active - ps))/cap; sumMin += minDollars/cap;
      nT++;
    }
    return {
      cap,
      active: nT? 100*sumActive/nT : 0,
      trueU:  nT? 100*sumTrue/nT : 0,
      ps:     nT? 100*sumPS/nT : 0,
      dead:   nT? 100*sumDead/nT : 0,
      minShare: nT? 100*sumMin/nT : 0,
      minCount: nT? nMin/nT : 0,
    };
  }

  const rows = [];
  console.log("");
  console.log(" S |    cap |  ENTER% (B) | END%(A) act/true | drop | PS%  dead% | min$%  min#/tm");
  console.log("---+--------+-------------+------------------+------+-----------+----------------");
  for (let s = 0; s < ${SEASONS}; s++) {
    const B = snap();                                         // entering season (post prior offseason)
    step(typeof frnSimToEndOfSeason !== "undefined" && frnSimToEndOfSeason, "simSeason", s);
    step(typeof showFrnAwards !== "undefined" && showFrnAwards, "showFrnAwards", s);
    const A = snap();                                         // season-end (post in-season churn)
    rows.push({ s:s+1, cap:B.cap, enter:B.trueU, endA:A.active, endT:A.trueU,
                drop:B.trueU-A.trueU, ps:A.ps, dead:A.dead, minShare:A.minShare, minCount:A.minCount });
    const r = rows[rows.length-1];
    console.log(
      String(r.s).padStart(2) + " | " +
      String(Math.round(r.cap)).padStart(6) + " | " +
      r.enter.toFixed(1).padStart(11) + " | " +
      (r.endA.toFixed(1)+"/"+r.endT.toFixed(1)).padStart(16) + " | " +
      r.drop.toFixed(1).padStart(4) + " | " +
      r.ps.toFixed(1).padStart(3)+"  "+r.dead.toFixed(1).padStart(4) + " | " +
      r.minShare.toFixed(1).padStart(5)+"  "+r.minCount.toFixed(1).padStart(5));
    // Offseason chain (mirrors live game + _brady_audit ordering).
    if (franchise.phase === "awards") {
      if (typeof frnApbProceedToOffseason === "function") step(frnApbProceedToOffseason, "toOffseason", s);
      else step(typeof startFrnOffseason !== "undefined" && startFrnOffseason, "startOffseason", s);
    }
    step(typeof frnProceedToRosterChanges !== "undefined" && frnProceedToRosterChanges, "rosterChanges", s); // enforceCapFloor here
    step(typeof frnGoToDraft !== "undefined" && frnGoToDraft, "goToDraft", s);
    await stepA(typeof frnAutoDraftRemaining !== "undefined" && frnAutoDraftRemaining, "autoDraft", s);
    await stepA(typeof frnDraftFinishScramble !== "undefined" && frnDraftFinishScramble, "finishDraft", s);
    if (typeof _trimAiRostersToCap === "function") {
      try { _trimAiRostersToCap(53, { includeUser: true }); } catch (e) { console.error("[trace] trim threw (s"+s+"): "+e.message); }
    }
    step(typeof frnNewSeason !== "undefined" && frnNewSeason, "newSeason", s);
    if ((s+1) % 10 === 0) console.error("  ...season "+(s+1)+"/"+${SEASONS}+" ("+((Date.now())/1000|0)+"s wall)");
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const _avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
  const first = rows.slice(0, Math.max(1, Math.floor(rows.length/3)));
  const last  = rows.slice(-Math.max(1, Math.floor(rows.length/3)));
  console.log("");
  console.log("══ SUMMARY ══════════════════════════════════════════════════════");
  console.log(" Mean ENTER (B, post-offseason high):  " + _avg(rows.map(r=>r.enter)).toFixed(1) + "%");
  console.log(" Mean END   (A true, season-end low):  " + _avg(rows.map(r=>r.endT)).toFixed(1) + "%");
  console.log(" Mean in-season DROP (B−A):            " + _avg(rows.map(r=>r.drop)).toFixed(1) + "pp");
  console.log("");
  console.log(" DRIFT over franchise life (season-end true util):");
  console.log("   first " + first.length + " seasons: " + _avg(first.map(r=>r.endT)).toFixed(1) + "%");
  console.log("   last  " + last.length  + " seasons: " + _avg(last.map(r=>r.endT)).toFixed(1) + "%");
  console.log("   → drift: " + (_avg(last.map(r=>r.endT))-_avg(first.map(r=>r.endT))).toFixed(1) + "pp  (flat = floors are cap-relative; falling = leak)");
  console.log("");
  console.log(" Mean min-tier $ share of cap (season-end): " + _avg(rows.map(r=>r.minShare)).toFixed(1) + "%   (" + _avg(rows.map(r=>r.minCount)).toFixed(1) + " min contracts/team)");
  console.log(" Cap inflation: $" + Math.round(rows[0].cap) + "M → $" + Math.round(rows[rows.length-1].cap) + "M");
  if (typeof process !== "undefined" && process.exit) process.exit(0);
})();
`;

let bundle = shim + extraConsts;
for (const f of files) {
  bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
}
bundle += harness;

new Function(bundle)();
