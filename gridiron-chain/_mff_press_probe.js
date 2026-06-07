// Throwaway probe: distribution of the per-snap `pressure` scalar on dropbacks,
// to calibrate MFF_PRESS_THRESH to an NFL-like ~33-38% pressure rate.
const fs = require("fs"); const path = require("path");
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js"];
function stripUiInit(code,file){ if(file!=="play-render.js")return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x"); }
const shim=`var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>Date.now()};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;
const audit=`;(function(){
  const DROP=new Set(["complete","incomplete","sack","int"]);
  function buildRoster(t){return genRoster(getPlaybook(t),{},null);}
  const vals=[];
  const N=Number(process.argv[2]||20);
  for(let s=0;s<N;s++){
    const ros={}; for(const t of TEAMS) ros[t.id]=buildRoster(t);
    for(let i=0;i<TEAMS.length;i+=2){ const h=TEAMS[i],a=TEAMS[i+1]; if(!a)break;
      const sim=new GameSimulator(h,a,ros[h.id],ros[a.id]); const r=sim.simulate();
      for(const p of r.plays){ if(DROP.has(p.kind)&&typeof p.pressure==="number") vals.push(p.pressure); }
    }
  }
  vals.sort((x,y)=>x-y);
  const q=f=>vals[Math.floor(f*(vals.length-1))];
  console.error("dropbacks sampled: "+vals.length);
  console.error("min "+q(0).toFixed(2)+"  p10 "+q(.10).toFixed(2)+"  p25 "+q(.25).toFixed(2)+"  median "+q(.5).toFixed(2)+"  p65 "+q(.65).toFixed(2)+"  p75 "+q(.75).toFixed(2)+"  p90 "+q(.90).toFixed(2)+"  max "+q(1).toFixed(2));
  // For target pressure rates, report the threshold that yields them:
  for(const rate of [0.40,0.35,0.33,0.30]){ const th=q(1-rate); console.error("  rate "+(rate*100)+"% → threshold "+th.toFixed(3)); }
  const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
  console.error("mean "+mean.toFixed(3));
})();`;
let code=shim+"\n"; for(const f of files){let c=fs.readFileSync(path.join(__dirname,f),"utf8");c=stripUiInit(c,f);code+="\n"+c+"\n";}
code+=audit; require("vm").runInThisContext(code,{filename:"_probe.js"});
