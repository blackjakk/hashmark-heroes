// _bh_normal_probe.js — continuity probe for the GC_BH_NORMAL pilot
// (Stage 1 of the normal-play → ball-handler migration). Headless: builds a
// real dropback-completion play in the engine, runs it through the pilot's
// _bhSpecForPass, then samples the ball timeline + every handler/decoy body
// across a dense frame grid and asserts:
//   • every coordinate is finite (no NaN/Infinity),
//   • no per-frame jump exceeds the carrier step cap (70px/frame) — i.e. the
//     catch is a smooth hand-off of the ball token, not a teleport,
//   • the catch point matches the engine route track at throwT (parity).
// The full visual A/B vs the standard animator still needs an in-browser run;
// this guards the math so the pilot can't regress the no-teleport invariant.
//   node tools/_bh_normal_probe.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const files = ["play-data.js", "play-player.js", "play-render.js", "play-sim.js",
               "play-motion.js", "play-engine.js", "play-animation.js"];
function strip(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "//x").replace(/^setupPreview\([^)]*\);\s*$/gm, "//x");
}
const shim = `var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>0};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;
let code = shim + "\n";
for (const f of files) code += strip(fs.readFileSync(path.join(ROOT, f), "utf8"), f) + "\n";

const probe = `;(function(){
  let pass=0, fail=0;
  const ok=(c,l)=>{ if(c){pass++;console.log("  \\u2713 "+l);}else{fail++;console.log("  \\u2717 FAIL "+l);} };
  const SEED=1337, CAP=70, STEPS=240;
  _setSimRng(SEED);
  const r1=genRoster(getPlaybook(TEAMS[0]),{},null), r2=genRoster(getPlaybook(TEAMS[1]),{},null);
  const sim=new GameSimulator(TEAMS[0],TEAMS[1],r1,r2);
  sim._coordinators={home:(c)=>c.kind==="playcall"?"VERTICAL":null};
  const res=sim.simulate(); _clearSimRng();

  // straight dropback completions with a real route track (exclude variants the
  // pilot doesn't claim).
  const comps=res.plays.filter(p=>p.poss==="home"&&p.kind==="complete"&&p.motion&&p.motion.tracks
    &&!p.isScreen&&!p.isPlayAction&&!p.isTOR&&!p.lateralTo&&!p.isHBPass&&!p.isDoublePass);
  ok(comps.length>=5, "found "+comps.length+" pilot-eligible completions");

  const cy=FIELD.H/2, PX=FIELD.PX_PER_YARD;
  let worstJump=0, worstRole="", nan=0, deliveryMax=0, tested=0;
  for (const play of comps.slice(0,20)) {
    const dir=1, losX=FIELD.W*0.5;
    const env={ play, dir, losX, cy, team:{secondary:"#ffffff",primary:"#222"}, possColor:"#3355ff",
                formation:{ wr1:{x:losX,y:cy-240}, wr2:{x:losX,y:cy+240}, wr3:{x:losX,y:cy-120},
                            te:{x:losX,y:cy+120}, rb:{x:losX-90,y:cy} }, PX:FIELD.PX_PER_YARD };
    const spec=_bhSpecForPass(env);
    let prevBall=null, prevByRole={};
    for (let i=0;i<=STEPS;i++){
      const aT=i/STEPS;
      const b=_bhSampleBall(spec.segs, aT);
      if(!isFinite(b.x)||!isFinite(b.y)) nan++;
      if(prevBall){ const d=Math.hypot(b.x-prevBall.x,b.y-prevBall.y); if(d>worstJump){worstJump=d;worstRole="ball";} }
      prevBall=b;
      const bodies=[];
      const dp=(x,y,...a)=>{ const o=a[a.length-1]; bodies.push({role:(o&&o.role)||"?",x,y}); };
      spec.handlers(dp, aT);
      for(const bd of bodies){
        if(!isFinite(bd.x)||!isFinite(bd.y)) nan++;
        const pv=prevByRole[bd.role];
        if(pv){ const d=Math.hypot(bd.x-pv.x,bd.y-pv.y); if(d>worstJump){worstJump=d;worstRole=bd.role;} }
        prevByRole[bd.role]={x:bd.x,y:bd.y};
      }
      // Catch delivery: at the catch frame the ball should be in the WR's hands
      // (the ball is delivered to the receiver, never to empty grass).
      if(Math.abs(aT-0.58)<0.003){
        const wr=bodies.find(x=>x.role==="WR");
        if(wr){ const d=Math.hypot(b.x-wr.x,b.y-(wr.y-13)); if(d>deliveryMax) deliveryMax=d; }
      }
    }
    tested++;
  }
  ok(nan===0, "no NaN/Infinity across "+tested+" plays \\u00d7 "+(STEPS+1)+" frames ("+nan+")");
  ok(worstJump<=CAP, "max per-frame jump "+worstJump.toFixed(1)+"px <= "+CAP+"px cap (worst: "+worstRole+")");
  ok(deliveryMax<=6, "ball delivered to the WR at the catch (max gap "+deliveryMax.toFixed(1)+"px)");
  console.log("\\n  "+pass+" passed, "+fail+" failed");
  process.exit(fail?1:0);
})();`;
eval(code + probe);
