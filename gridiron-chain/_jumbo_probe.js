// JUMBO (13 personnel) MATCHUP PROBE — what is 13 personnel best against?
// Forces the home offense into JUMBO (1 RB / 3 TE / 1 WR) on every play, then
// pins the DEFENSE to each scheme in turn (BLITZ_46 / BASE_43 / NICKEL / DIME /
// PREVENT) and measures how the 13-personnel offense produces against it.
// Confirms the design intent: 13 punishes run-committed / blitz fronts via
// play-action, and is least valuable vs soft deep coverage. Seeded → reproducible.
//   Usage: node _jumbo_probe.js [games]   (default 250)
const fs = require("fs");
const path = require("path");
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js"];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t,k){ if(k==="style"||k==="classList"||k==="dataset")return _stub;
              if(k==="length")return 0; if(k===Symbol.iterator)return function*(){};
              return _stub; }, set(){return true;}, apply(){return _stub;}, construct(){return _stub;} });
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,
    querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
  var window=(typeof globalThis!=="undefined"?globalThis:this); window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=()=>0;
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
`;
const GAMES = Number(process.argv[2] || 250);
const audit = `
;(function runJumboProbe(){
  if (typeof GameSimulator==="undefined"){console.error("load fail");process.exit(1);}
  const GAMES = ${GAMES};
  let _seed=0; function _srand(s){_seed=s>>>0;}
  Math.random=function(){ _seed=(_seed+0x6D2B79F5)|0; let t=Math.imul(_seed^(_seed>>>15),1|_seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };

  // Force the offense into JUMBO every snap (both teams; we only read home).
  pickPersonnel = function(){ return "JUMBO"; };

  _srand(0xC0FFEE);
  const HOME=TEAMS[0], AWAY=TEAMS[1];
  const homeRoster=genRoster(getPlaybook(HOME),{},null);
  const awayRoster=genRoster(getPlaybook(AWAY),{},null);

  const SCHEMES=["BLITZ_46","BASE_43","BASE_34","NICKEL","DIME","PREVENT"];
  const rows=[];
  for (const scheme of SCHEMES){
    if (!DEF_PLAYBOOKS[scheme]) continue;
    let plays=0,passY=0,rushY=0,pAtt=0,pComp=0,sk=0,pts=0,g=0;
    _srand(0x5EED);
    for (let i=0;i<GAMES;i++){
      const sim=new GameSimulator(HOME,AWAY,homeRoster,awayRoster);
      // Pin the defensive scheme for every snap (shadows the situational getter).
      Object.defineProperty(sim,"currentDefPlaybook",{configurable:true,get(){return DEF_PLAYBOOKS[scheme];}});
      const r=sim.simulate(); g++;
      const t=r.stats.home.team;
      plays+=t.plays||0; passY+=t.passYds||0; rushY+=t.rushYds||0;
      pAtt+=t.pass_att||0; pComp+=t.pass_comp||0; sk+=t.sacks_allowed||0; pts+=r.homeScore;
    }
    rows.push({scheme,
      ypp:(passY+rushY)/Math.max(1,plays), passG:passY/g, rushG:rushY/g,
      cmp:100*pComp/Math.max(1,pAtt), skG:sk/g, ptsG:pts/g});
  }

  console.log("\\n══════════ JUMBO (13 personnel) vs DEFENSIVE SCHEME — "+GAMES+" games each ══════════");
  console.log("(home offense forced into 13 personnel every snap; defense pinned to each scheme)\\n");
  console.log("  "+"DEF SCHEME".padEnd(12)+"Y/PLAY".padStart(8)+"passYds".padStart(9)+"rushYds".padStart(9)+"CMP%".padStart(7)+"SKallw".padStart(8)+"PTS/g".padStart(7));
  console.log("  "+"-".repeat(60));
  const byYpp=[...rows].sort((a,b)=>b.ypp-a.ypp);
  for (const r of byYpp){
    console.log("  "+r.scheme.padEnd(12)+r.ypp.toFixed(2).padStart(8)+r.passG.toFixed(0).padStart(9)
      +r.rushG.toFixed(0).padStart(9)+r.cmp.toFixed(1).padStart(7)+r.skG.toFixed(2).padStart(8)+r.ptsG.toFixed(1).padStart(7));
  }
  const best=byYpp[0], worst=byYpp[byYpp.length-1];
  console.log("\\n  BEST against:  "+best.scheme+" ("+best.ypp.toFixed(2)+" Y/play, "+best.ptsG.toFixed(1)+" pts/g)");
  console.log("  WORST against: "+worst.scheme+" ("+worst.ypp.toFixed(2)+" Y/play, "+worst.ptsG.toFixed(1)+" pts/g)\\n");
})();
`;
let bundle = shim + "\n";
for (const f of files){ let c=fs.readFileSync(path.join(__dirname,f),"utf8"); c=stripUiInit(c,f); bundle+="\n;//=== "+f+" ===\n"+c+"\n"; }
bundle += "\n" + audit;
new Function(bundle)();
