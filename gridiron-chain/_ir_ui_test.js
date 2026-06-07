// Smoke test for the user IR handlers (frnPlaceOnIr / frnSignIrReplacement /
// frnActivateFromIr). Render calls hit the DOM stub harmlessly; we assert state.
const fs=require("fs"), path=require("path");
const shim=`var _stub=new Proxy(function(){},{get(t,k){if(k==="length")return 0;
  if(k===Symbol.iterator)return function*(){};if(k===Symbol.toPrimitive)return ()=>0;
  if(k==="value"||k==="innerHTML"||k==="textContent")return "";if(k==="checked"||k==="disabled")return false;
  if(k==="children"||k==="childNodes")return [];return _stub;},set(){return true;},apply(){return _stub;},
  construct(){return _stub;},has(){return true;}});
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,
    querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub,head:_stub,location:{hash:""}};
  var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=(cb)=>setTimeout(()=>{if(typeof cb==="function")cb(Date.now());},0);
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};var location={hash:""};
  var alert=()=>{};var confirm=()=>true;var prompt=()=>"";var indexedDB={open:()=>({onsuccess:null,onerror:null,result:null})};`;
const files=["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js",
  "play-broadcast.js","play-franchise-core.js","play-franchise-season.js","play-franchise-stats.js","play-franchise-offseason.js"];
function strip(c,f){if(f==="play-render.js")c=c.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x");
  if(f==="play-franchise-stats.js")c=c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm,"//x");
  if(f==="play-franchise-offseason.js")c=c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm,"//x");return c;}
const harness=`;(function(){
  try{ startFranchise(0); }catch(e){ console.log("FAIL start:",e.message); process.exit(1); }
  franchise.chosenTeamId = TEAMS[0].id;   // team ids are 1-indexed; give the test a real user team
  const myId=franchise.chosenTeamId; const roster=franchise.rosters[myId];
  const n0=roster.length;
  // Pick a healthy player and give him a 6-week injury (designated-to-return eligible).
  const victim=roster.find(p=>!p.injury); victim.injury={label:"high-ankle sprain",weeksRemaining:6};
  console.log("victim:",victim.position,victim.name,"roster",n0,"IR",irListForTeam(myId).length);
  // 1) Place on IR (return).
  frnPlaceOnIr(victim.name,"return");
  const onIr = irListForTeam(myId).some(p=>p.name===victim.name);
  const offRoster = !franchise.rosters[myId].some(p=>p.name===victim.name);
  console.log("after place: onIR="+onIr+" offRoster="+offRoster+" roster="+franchise.rosters[myId].length+" slotsLeft="+irReturnSlotsLeft(myId));
  // 2) Sign a min replacement at the victim's position.
  const before=franchise.rosters[myId].length;
  frnSignIrReplacement(victim.position);
  console.log("after sign repl: roster "+before+" -> "+franchise.rosters[myId].length);
  // 3) Heal + advance past minReturnWeek, then activate (cut a scrub first to open a spot if full).
  victim.injury=null; franchise.week=(victim._ir.minReturnWeek||5)+1;
  const elig=irActivationEligible(victim); console.log("activation eligible after heal+week:",elig);
  if(rosterSpotsOpen(myId)<=0){ // open a spot like the UI would (cut worst)
    const worst=[...franchise.rosters[myId]].filter(p=>!p.injury&&(p.overall||60)<78).sort((a,b)=>(a.overall||60)-(b.overall||60))[0];
    if(worst){ const i=franchise.rosters[myId].indexOf(worst); franchise.rosters[myId].splice(i,1); }
  }
  frnActivateFromIr(victim.name);
  const backOnRoster=franchise.rosters[myId].some(p=>p.name===victim.name);
  const offIr=!irListForTeam(myId).some(p=>p.name===victim.name);
  console.log("after activate: backOnRoster="+backOnRoster+" offIR="+offIr+" roster="+franchise.rosters[myId].length);
  const pass = onIr&&offRoster&&elig&&backOnRoster&&offIr;
  console.log(pass?"\\nPASS — full user IR flow works":"\\nFAIL — see above");
  process.exit(pass?0:1);
})();`;
let bundle=shim;
for(const f of files) bundle+="\n;// "+f+"\n"+strip(fs.readFileSync(path.join(__dirname,f),"utf8"),f)+"\n";
bundle+=harness;
new Function(bundle)();
