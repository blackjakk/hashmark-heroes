// Cap in-season diagnostic — watches the salary trajectory WEEK BY WEEK across a
// single season to see exactly what sheds the ~12pp from offseason-high to
// season-end-low. Wraps _bumpWeek (called after each week's _runWeekEndResolution)
// to snapshot league-mean utilization + roster size + a salary-bucket breakdown.
// Usage: node _cap_diag.js
const fs = require("fs");
const path = require("path");

const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                if (k === Symbol.toPrimitive) return () => 0;
                if (k === "value" || k === "innerHTML" || k === "textContent") return "";
                if (k === "checked" || k === "disabled") return false;
                if (k === "children" || k === "childNodes") return [];
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; }, has() { return true; },
  });
  var document = { createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [], addEventListener: () => {},
    body: _stub, documentElement: _stub, head: _stub, location: { hash: "" } };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = (cb) => setTimeout(() => { if (typeof cb === "function") cb(Date.now()); }, 0);
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  var location = { hash: "" }; var alert = () => {}; var confirm = () => true; var prompt = () => "";
  var indexedDB = { open: () => ({ onsuccess: null, onerror: null, result: null }) };
`;
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js",
  "play-engine.js","play-broadcast.js","play-franchise-core.js","play-franchise-season.js",
  "play-franchise-stats.js","play-franchise-offseason.js"];
function stripUiInit(code, file) {
  let c = code;
  if (file === "play-render.js") c = c.replace(/^buildOptions\([^)]*\);\s*$/gm, "//x").replace(/^setupPreview\([^)]*\);\s*$/gm, "//x");
  if (file === "play-franchise-stats.js") c = c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm, "//x");
  if (file === "play-franchise-offseason.js") c = c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm, "//x");
  return c;
}
const extraConsts = `function showFranchiseDashboard(){} function renderFrnPreseason(){}
  function renderFrnDashboard(){} function _flushSaveFranchise(){} function saveFranchise(){}`;

const harness = `
;(async function diag() {
  if (typeof _frnConfirm !== "undefined") _frnConfirm = async () => true;
  for (const fn of ["showFranchiseDashboard","renderFrnPreseason","renderFrnDashboard",
    "renderFrnSeasonRecap","renderFrnOffseason","renderFrnDraft","renderFrnAwards",
    "renderFrnResignings","_startDraftFloorAnim","_flushSaveFranchise","saveFranchise"]) {
    try { if (typeof eval(fn) === "function") eval(fn + " = function(){}"); } catch(e){}
  }
  const _origWarn = console.warn, _origErr = console.error;
  const _mute = (s) => typeof s === "string" && (s.indexOf("missing pick row")>=0 ||
    s.indexOf("[IDB")>=0 || s.indexOf("indexedDB")>=0 || s.indexOf("Dashboard render")>=0 || s.indexOf("[save]")>=0);
  console.warn = (...a)=>{ if(!_mute(a[0])) _origWarn.apply(console,a); };
  console.error = (...a)=>{ if(!_mute(a[0])) _origErr.apply(console,a); };
  try { startFranchise(0); } catch(e){ console.error("start threw:", e.message); process.exit(1); }

  function leagueSnap() {
    const cap = franchise.salaryCap || 1;
    let nT=0, util=0, size=0, starHit=0, midHit=0, minHit=0, nStar=0, nMid=0, nMin=0;
    for (const t of TEAMS) {
      const roster = (franchise.rosters&&franchise.rosters[t.id])||[];
      if (!roster.length) continue;
      let hit=0, sStar=0, sMid=0, sMin=0, cStar=0, cMid=0, cMin=0;
      for (const p of roster) {
        const h = currentYearCapHit(p); hit += h;
        const aav = (p.contract&&p.contract.aav)||0;
        if (aav >= cap*0.05) { sStar+=h; cStar++; }
        else if (aav >= cap*0.006) { sMid+=h; cMid++; }
        else { sMin+=h; cMin++; }
      }
      util += 100*hit/cap; size += roster.length;
      starHit += 100*sStar/cap; midHit += 100*sMid/cap; minHit += 100*sMin/cap;
      nStar += cStar; nMid += cMid; nMin += cMin; nT++;
    }
    return { util:util/nT, size:size/nT, star:starHit/nT, mid:midHit/nT, min:minHit/nT,
             nStar:nStar/nT, nMid:nMid/nT, nMin:nMin/nT };
  }

  // Wrap _bumpWeek: it runs AFTER each week's _runWeekEndResolution, so snapshot here.
  const rows = [];
  if (typeof _bumpWeek === "function") {
    const _orig = _bumpWeek;
    _bumpWeek = function() {
      const wk = franchise.week;
      const s = leagueSnap(); s.week = wk; rows.push(s);
      return _orig.apply(this, arguments);
    };
  }

  console.log(" wk | util% | roster | STAR(n,$%) | MID(n,$%) | MIN(n,$%)");
  console.log("----+-------+--------+------------+-----------+-----------");
  const k0 = leagueSnap();
  console.log(" 0* | " + k0.util.toFixed(1).padStart(5) + " | " + k0.size.toFixed(1).padStart(6) + " | " +
    (k0.nStar.toFixed(1)+","+k0.star.toFixed(1)).padStart(10) + " | " +
    (k0.nMid.toFixed(1)+","+k0.mid.toFixed(1)).padStart(9) + " | " +
    (k0.nMin.toFixed(1)+","+k0.min.toFixed(1)).padStart(9) + "   (season start, pre-week-1)");

  // Play exactly ONE season.
  try { frnSimToEndOfSeason(); } catch(e){ console.error("sim threw:", e.message); }
  const afterGames = leagueSnap();
  // Now run the season-end boundary events one at a time, snapshotting after each,
  // to locate where the util drops (and recovers).
  const _bn = [];
  function _mark(label){ const s = leagueSnap(); s.label = label; _bn.push(s); }
  try { if (typeof showFrnAwards === "function") showFrnAwards(); } catch(e){ console.error("awards threw:", e.message); }
  _mark("after showFrnAwards (retirements)");
  if (franchise.phase === "awards") { try { (typeof frnApbProceedToOffseason==="function"?frnApbProceedToOffseason:startFrnOffseason)(); } catch(e){ console.error("toOff threw:", e.message); } }
  _mark("after startFrnOffseason");
  try { if (typeof frnProceedToRosterChanges==="function") frnProceedToRosterChanges(); } catch(e){ console.error("rosterChanges threw:", e.message); }
  _mark("after rosterChanges (re-sign + enforceCapFloor)");
  try { if (typeof frnGoToDraft==="function") frnGoToDraft(); } catch(e){}
  try { if (typeof frnAutoDraftRemaining==="function") await frnAutoDraftRemaining(); } catch(e){}
  try { if (typeof frnDraftFinishScramble==="function") await frnDraftFinishScramble(); } catch(e){}
  _mark("after draft");
  try { if (typeof _trimAiRostersToCap==="function") _trimAiRostersToCap(53,{includeUser:true}); } catch(e){}
  _mark("after trim-to-53");

  for (const r of rows) {
    console.log(String(r.week).padStart(3) + " | " + r.util.toFixed(1).padStart(5) + " | " +
      r.size.toFixed(1).padStart(6) + " | " +
      (r.nStar.toFixed(1)+","+r.star.toFixed(1)).padStart(10) + " | " +
      (r.nMid.toFixed(1)+","+r.mid.toFixed(1)).padStart(9) + " | " +
      (r.nMin.toFixed(1)+","+r.min.toFixed(1)).padStart(9));
  }
  console.log("");
  console.log(" BOUNDARY EVENTS (where the snapshot drop actually happens):");
  console.log("   after final game:        util " + afterGames.util.toFixed(1) + "%  roster " + afterGames.size.toFixed(1));
  for (const s of _bn) {
    console.log("   " + s.label.padEnd(40) + " util " + s.util.toFixed(1) + "%  roster " + s.size.toFixed(1));
  }
  const end = leagueSnap();
  console.log("");
  console.log("START util " + k0.util.toFixed(1) + "%  roster " + k0.size.toFixed(1) +
    "  (STAR " + k0.nStar.toFixed(1) + " / MID " + k0.nMid.toFixed(1) + " / MIN " + k0.nMin.toFixed(1) + ")");
  console.log("END   util " + end.util.toFixed(1) + "%  roster " + end.size.toFixed(1) +
    "  (STAR " + end.nStar.toFixed(1) + " / MID " + end.nMid.toFixed(1) + " / MIN " + end.nMin.toFixed(1) + ")");
  console.log("Δ util " + (end.util-k0.util).toFixed(1) + "pp   Δ roster " + (end.size-k0.size).toFixed(1) +
    "   Δ STAR$ " + (end.star-k0.star).toFixed(1) + "pp  Δ MID$ " + (end.mid-k0.mid).toFixed(1) +
    "pp  Δ MIN$ " + (end.min-k0.min).toFixed(1) + "pp");
  if (typeof process !== "undefined" && process.exit) process.exit(0);
})();
`;
let bundle = shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += harness;
new Function(bundle)();
