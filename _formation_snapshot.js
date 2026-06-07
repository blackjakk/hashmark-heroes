// _formation_snapshot.js — golden-reference harness for the FORMATION_DEPTHS
// extraction (position-contract refactor, renderer Stage 1). Loads makeFormation
// headlessly and dumps every slot's (role,x,y) across the full opts battery, so
// the extraction can be proven BYTE-IDENTICAL (diff before vs after).
//
//   node _formation_snapshot.js > /tmp/formation_<tag>.json
//   (run before the edit → golden; run after → diff against golden)
//
// Dev tool only. Mirrors _sim_audit.js's loader.
const fs = require("fs");
const path = require("path");

const files = ["play-data.js", "play-render.js"];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [snap] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [snap] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t,k){ if(k==="style"||k==="classList"||k==="dataset")return _stub;
              if(k==="length")return 0; if(k===Symbol.iterator)return function*(){};
              return _stub; }, set(){return true;}, apply(){return _stub;}, construct(){return _stub;} });
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
  var window=(typeof globalThis!=="undefined"?globalThis:this);
  window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=()=>0;
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
`;
const snap = `
;(function(){
  if (typeof makeFormation === "undefined" || typeof PERSONNEL === "undefined") {
    console.error("missing makeFormation/PERSONNEL"); process.exit(1);
  }
  const out = {};
  const personnels = Object.keys(PERSONNEL);
  const battery = [];
  for (const personnel of personnels)
    for (const poss of ["home","away"])
      for (const isGoalLine of [false,true])
        for (const [down,ytg] of [[1,10],[3,12]])
          for (const twoBackStyle of ["I","PRO"]) {
            battery.push({ personnel, poss, isGoalLine, down, ytg, twoBackStyle });
          }
  const losX = 800;  // fixed reference LOS
  for (const b of battery) {
    const f = makeFormation(losX, b.poss, { personnel:b.personnel, isGoalLine:b.isGoalLine, down:b.down, ytg:b.ytg, twoBackStyle:b.twoBackStyle });
    // Serialize the SKILL slots the contract governs (offense), deterministically.
    const slot = (s) => s ? [s.role, +s.x.toFixed(4), +s.y.toFixed(4)] : null;
    const key = [b.personnel,b.poss,b.isGoalLine?"GL":"-",b.down,b.ytg,b.twoBackStyle].join("|");
    out[key] = {
      qb: slot(f.qb), rb: slot(f.rb), fb: slot(f.fb), realRb: slot(f.realRb),
      wr1: slot(f.wr1), wr2: slot(f.wr2), wr3: slot(f.wr3), wr4: slot(f.wr4), wr5: slot(f.wr5),
      te: slot(f.te), te2: slot(f.te2),
      oline: f.oline.map(slot),
    };
  }
  window.__snap = out;
})();
`;
let blob = shim + "\n";
for (const f of files) blob += "\n;// ==== " + f + " ====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
blob += snap;
try { (0, eval)(blob); } catch (e) { console.error("snapshot failed: " + (e && e.stack || e)); process.exit(1); }
process.stdout.write(JSON.stringify(globalThis.__snap, null, 1));
