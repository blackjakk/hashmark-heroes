// Bake the MFF EP (expected points) table from a multi-season audit run.
// Reuses _mff_epa.js's exact methodology (next-score-within-half) but,
// instead of computing EPA, dumps the three-level lookup table as a JS
// constant ready to paste into play-franchise-stats.js.
//
// First-principles: EP(state) depends only on the engine's RULES (yards-
// per-drive, scoring odds from a state), which are fixed. Talent shifts
// HOW OFTEN you reach a state, not the points-value of being there. So
// a baked table from a large round-robin is the correct estimate; a live
// franchise model would be noisier (mid-season only ~12k plays vs audit's
// 64k+/season) and would re-relearn the same structural curve.
//
// Output: /tmp/mff_ep_baked.js  — paste contents into play-franchise-stats.js.
// Run:    node _mff_bake_ep.js [seasons=2]
const fs = require("fs"), path = require("path");
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js"];
function stripUiInit(c,f){return f!=="play-render.js"?c:c.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x");}
const shim = `var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>Date.now()};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;
const driver = `;(function(){
  const SEASONS = Number(process.argv[2] || 2);
  const PASS=new Set(["complete","incomplete","sack","int"]);
  const RUN =new Set(["run","scramble"]);
  const SNAP=new Set([...PASS,...RUN]);
  const ytgB = y => y<=3?0:y<=6?1:y<=10?2:3;
  const yardB = y => Math.max(0,Math.min(9,Math.floor(y/10)));
  const keyFull = (d,y,yl) => d+"|"+ytgB(y)+"|"+yardB(yl);
  const keyDown = (d,yl)   => d+"||"+yardB(yl);
  const keyYard = (yl)     => "||"+yardB(yl);
  const ros = {}; for (const t of TEAMS) ros[t.id] = genRoster(getPlaybook(t),{},null);
  const acc = {};
  const add = (k,v) => { (acc[k] || (acc[k] = {sum:0,n:0})); acc[k].sum += v; acc[k].n++; };
  for (let s=0; s<SEASONS; s++) {
    if (s>0) { for (const t of TEAMS) ros[t.id] = genRoster(getPlaybook(t),{},null); }
    for (let i=0; i<TEAMS.length; i++) for (let j=i+1; j<TEAMS.length; j++) {
      const sim = new GameSimulator(TEAMS[i], TEAMS[j], ros[TEAMS[i].id], ros[TEAMS[j].id]);
      sim.simulate();
      const pl = sim.plays; let h=0,a=0; const snaps=[], scores=[];
      for (let gi=0; gi<pl.length; gi++) { const p=pl[gi];
        const nh=p.homeScore??h, na=p.awayScore??a;
        if (nh!==h || na!==a) { const team = nh>h?"home":"away", pts = Math.abs((nh-h)||(na-a)); const half = (p.quarter<=2)?1:2;
          scores.push({gi, team, pts, half}); h=nh; a=na; }
        if (SNAP.has(p.kind) && p.down>=1 && p.down<=4 && typeof p.yardLine==="number") {
          snaps.push({gi, d:p.down, y:p.ytg||10, yl:p.yardLine, poss:p.poss, half:(p.quarter<=2)?1:2}); }
      }
      function nextScoreVal(snap) {
        for (const sc of scores) { if (sc.gi>snap.gi && sc.half===snap.half) { return sc.team===snap.poss ? sc.pts : -sc.pts; } }
        return 0;
      }
      for (const sn of snaps) { const v = nextScoreVal(sn);
        add(keyFull(sn.d, sn.y, sn.yl), v); add(keyDown(sn.d, sn.yl), v); add(keyYard(sn.yl), v); }
    }
  }
  // Tables, sorted, with sample counts so we can drop low-n entries.
  const FULL = {}, DOWN = {}, YARD = {};
  const MIN_N_FULL = 30, MIN_N_DOWN = 30;
  let kept=0, droppedFull=0, droppedDown=0;
  for (const k of Object.keys(acc).sort()) { const e = acc[k];
    if (k.indexOf("||") === 0) { // yardline-only
      YARD[k.replace("||","")] = +(e.sum/e.n).toFixed(3); kept++;
    } else if (/^\\d+\\|\\|/.test(k)) { // down + yardline
      if (e.n >= MIN_N_DOWN) { DOWN[k] = +(e.sum/e.n).toFixed(3); kept++; }
      else droppedDown++;
    } else { // full
      if (e.n >= MIN_N_FULL) { FULL[k] = +(e.sum/e.n).toFixed(3); kept++; }
      else droppedFull++;
    }
  }
  // Sanity check: print canonical states the audit reported.
  function EP(d,y,yl) { const kf = keyFull(d,y,yl);
    if (FULL[kf] != null) return FULL[kf];
    const kd = keyDown(d,yl); if (DOWN[kd] != null) return DOWN[kd];
    return YARD[String(yardB(yl))] ?? 0;
  }
  console.error("Sanity (after baking, "+SEASONS+"-season run):");
  console.error("  1st&10 own-25:           EP = " + EP(1,10,25).toFixed(2) + "  (NFL ref +0.4)");
  console.error("  1st&10 midfield:         EP = " + EP(1,10,50).toFixed(2) + "  (NFL ref +2.0)");
  console.error("  1st&10 opp-25:           EP = " + EP(1,10,75).toFixed(2) + "  (NFL ref +3.6)");
  console.error("  1st&goal opp-5:          EP = " + EP(1,5,95).toFixed(2)  + "  (NFL ref +4.5)");
  console.error("  3rd&8 own-10:            EP = " + EP(3,8,10).toFixed(2)  + "  (NFL ref -1.5)");
  console.error("  4th&2 opp-40:            EP = " + EP(4,2,60).toFixed(2));
  console.error("  1st&10 own-1 (backed):   EP = " + EP(1,10,1).toFixed(2)  + "  (NFL ref -0.5)");
  console.error("Bake summary: "+kept+" kept; "+droppedFull+" full-keys / "+droppedDown+" down-keys dropped below sample threshold.");
  // Emit JS source.
  const out = [];
  out.push("// Baked EP table — generated by _mff_bake_ep.js (do not edit by hand).");
  out.push("// Method: empirical next-score-within-half over a "+SEASONS+"-season round-robin.");
  out.push("// 3-level fallback: full(down|ytg-bucket|yardline-bucket) → down|yardline-bucket → yardline-bucket.");
  out.push("//   ytg buckets:  0=short(≤3)  1=med(4-6)  2=long(7-10)  3=vlong(11+)");
  out.push("//   yardline buckets: 0=own-goal..9=opp-goal (10-yard chunks)");
  out.push("const _MFF_EP_TABLE_FULL = " + JSON.stringify(FULL) + ";");
  out.push("const _MFF_EP_TABLE_DOWN = " + JSON.stringify(DOWN) + ";");
  out.push("const _MFF_EP_TABLE_YARD = " + JSON.stringify(YARD) + ";");
  globalThis.__mffBakedOut = out.join("\\n");
})();`;
let code = shim + "\n";
for (const f of files) { let c = fs.readFileSync(path.join(__dirname, f), "utf8"); c = stripUiInit(c, f); code += "\n" + c + "\n"; }
code += driver;
require("vm").runInThisContext(code, { filename: "_mff_bake_ep_bundle.js" });
fs.writeFileSync("/tmp/mff_ep_baked.js", globalThis.__mffBakedOut);
console.error("Wrote /tmp/mff_ep_baked.js ("+globalThis.__mffBakedOut.length+" bytes).");
