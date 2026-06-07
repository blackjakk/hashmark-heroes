// Franchise-level verification for the clutch "film" (Phase 4) + scoutable
// confidence read (Phase 3). Boots a real franchise, sims a full season so
// _accrueClutchFilm runs over ~272 games, then asserts the record accrues and
// HiddenOracle.read.clutchTag sharpens with sample. Dev tool — ignored by build.
const fs = require("fs");
const path = require("path");

const shim = `
  var _stub = new Proxy(function(){}, {
    get(t,k){ if(k==="length")return 0; if(k===Symbol.iterator)return function*(){};
      if(k===Symbol.toPrimitive)return ()=>0;
      if(k==="value"||k==="innerHTML"||k==="textContent")return "";
      if(k==="checked"||k==="disabled")return false;
      if(k==="children"||k==="childNodes")return []; return _stub; },
    set(){return true;}, apply(){return _stub;}, construct(){return _stub;}, has(){return true;} });
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,
    querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub,head:_stub,location:{hash:""}};
  var window=(typeof globalThis!=="undefined"?globalThis:this); window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=()=>0;
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  var location={hash:""}; var alert=()=>{}; var confirm=()=>true; var prompt=()=>"";
  var indexedDB={open:()=>({onsuccess:null,onerror:null,result:null})};
`;
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js",
  "play-engine.js","play-broadcast.js","play-franchise-core.js","play-franchise-season.js",
  "play-franchise-stats.js","play-franchise-offseason.js"];
function stripUiInit(code, file) {
  let c = code;
  if (file === "play-render.js")
    c = c.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x");
  if (file === "play-franchise-stats.js")
    c = c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm,"//x");
  if (file === "play-franchise-offseason.js")
    c = c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm,"//x");
  return c;
}
const extraConsts = `
  function showFranchiseDashboard(){} function renderFrnPreseason(){} function renderFrnDashboard(){}
  function _flushSaveFranchise(){} function saveFranchise(){}
`;

const harness = `
;(function(){
  let pass=0, fail=0;
  const ok=(n,c,x)=>{ if(c){pass++;console.log("  \\u2713 "+n+(x?"  ("+x+")":""));} else {fail++;console.log("  \\u2717 FAIL "+n+(x?"  \\u2014 "+x:""));} };

  startFranchise(0);
  console.error("inited season "+franchise.season+" week "+franchise.week);
  // Sim a full season (regular + playoffs) so _accrueClutchFilm runs everywhere.
  frnSimToEndOfSeason();

  // Gather every player with a clutch record across the league.
  const all = [];
  for (const roster of Object.values(franchise.rosters||{}))
    for (const p of roster) if (p && p.clutchRecord) {
      const r=p.clutchRecord;
      const exp=(r.fgAtt||0)+(r.passAtt||0)+(r.tgt||0)+(r.car||0)+(r.picks||0);
      if (exp>0) all.push({p, exp, r});
    }
  all.sort((a,b)=>b.exp-a.exp);
  const totalExp = all.reduce((s,a)=>s+a.exp,0);

  console.log("\\nPhase 4 — film accrual:");
  ok("clutch film accrued across the league", all.length>0 && totalExp>0, all.length+" players, "+totalExp+" total clutch snaps");
  ok("QBs accrued clutch pass attempts", all.some(a=>a.p.position==="QB" && (a.r.passAtt||0)>0),
     "top QB passAtt="+(all.filter(a=>a.p.position==="QB").sort((x,y)=>(y.r.passAtt||0)-(x.r.passAtt||0))[0]?.r.passAtt||0));
  ok("records only hold late-and-close plays (sane sizes)", all.every(a=>a.exp < 400), "max exp="+(all[0]?.exp||0));

  console.log("\\nPhase 3 — scoutable confidence read:");
  const tag = HiddenOracle.read.clutchTag;
  const mk = (clutch, recExp) => tag({ _clutch: clutch, name: "Calibration Tester", clutchRecord: recExp!=null?{passAtt:recExp}:undefined });
  const un = mk(88, 0), pr = mk(88, 100);
  ok("no tape => 'Unproven'", un.confidence==="Unproven", "label="+un.label);
  ok("lots of tape => 'Proven'", pr.confidence==="Proven", "label="+pr.label);
  // Convergence: Proven noiseW=3, so truth 88 -> read in [85,91] -> the true
  // 'Ice in His Veins' tier (>=80). The read has sharpened onto the truth.
  ok("Proven read converges to the true tier", pr.label==="Ice in His Veins", "true=88, proven label="+pr.label);
  // Confidence tiers rise monotonically with sample.
  const tiers = [0,8,25,60].map(e=>mk(70,e).confidence);
  ok("confidence rises with sample", tiers.join(">")==="Unproven>Limited tape>Established>Proven", tiers.join(" -> "));
  // A real high-film player should not read 'Unproven'.
  const veteran = all.find(a=>a.exp>=25);
  if (veteran) ok("a well-filmed real player is past 'Unproven'", tag(veteran.p).confidence!=="Unproven",
     veteran.p.name+" exp="+veteran.exp+" -> "+tag(veteran.p).confidence);

  console.log("\\nTop filmed players (read is the SCOUT view, not the hidden truth):");
  for (const a of all.slice(0,6)) {
    const t = tag(a.p);
    console.log("  "+(a.p.position+" "+a.p.name).padEnd(26)+" true _clutch="+String(a.p._clutch).padStart(2)
      +"  exp="+String(a.exp).padStart(3)+"  read='"+t.label+"' ["+t.confidence+"]");
  }

  console.log("\\n"+(fail===0?"\\u2705 ALL "+pass+" CHECKS PASS":"\\u274c "+fail+" FAILED ("+pass+" passed)"));
  if (typeof process!=="undefined") process.exit(fail===0?0:1);
})();
`;

let bundle = shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += harness;
new Function(bundle)();
