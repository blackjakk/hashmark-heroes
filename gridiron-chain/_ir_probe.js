// IR usage probe — runs N seasons to steady state and reports, per season:
// mean active-roster size, mean #on-IR, season IR placements, and active-util
// (currentYearCapHit over the active roster, EXCLUDES IR) vs true-util
// (capUsedByTeam, INCLUDES IR). Validates: IR fires, rosters stay <=53, and the
// true cap stays full while the active sum dips (IR'd players still paid).
// Usage: node _ir_probe.js [seasons]
const fs = require("fs");
const path = require("path");
const SEASONS = Number(process.argv[2] || 6);

const shim = `
  var _stub = new Proxy(function(){}, { get(t,k){ if(k==="length")return 0;
    if(k===Symbol.iterator)return function*(){}; if(k===Symbol.toPrimitive)return ()=>0;
    if(k==="value"||k==="innerHTML"||k==="textContent")return ""; if(k==="checked"||k==="disabled")return false;
    if(k==="children"||k==="childNodes")return []; return _stub; },
    set(){return true;}, apply(){return _stub;}, construct(){return _stub;}, has(){return true;} });
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,
    querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub,head:_stub,location:{hash:""}};
  var window=(typeof globalThis!=="undefined"?globalThis:this); window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=(cb)=>setTimeout(()=>{if(typeof cb==="function")cb(Date.now());},0);
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  var location={hash:""}; var alert=()=>{}; var confirm=()=>true; var prompt=()=>"";
  var indexedDB={open:()=>({onsuccess:null,onerror:null,result:null})};
`;
const files=["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js",
  "play-engine.js","play-broadcast.js","play-franchise-core.js","play-franchise-season.js",
  "play-franchise-stats.js","play-franchise-offseason.js"];
function stripUiInit(code,file){let c=code;
  if(file==="play-render.js")c=c.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x");
  if(file==="play-franchise-stats.js")c=c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm,"//x");
  if(file==="play-franchise-offseason.js")c=c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm,"//x");
  return c;}
const extraConsts=`function showFranchiseDashboard(){} function renderFrnPreseason(){}
  function renderFrnDashboard(){} function _flushSaveFranchise(){} function saveFranchise(){}`;

const harness = `
;(async function irProbe(){
  if(typeof _frnConfirm!=="undefined") _frnConfirm=async()=>true;
  const _ne=console.error; const _mute=s=>typeof s==="string"&&(s.indexOf("missing pick row")>=0||
    s.indexOf("[IDB")>=0||s.indexOf("indexedDB")>=0||s.indexOf("Dashboard render")>=0||s.indexOf("[save]")>=0);
  console.error=(...a)=>{if(!_mute(a[0]))_ne.apply(console,a);};
  for(const fn of ["showFranchiseDashboard","renderFrnPreseason","renderFrnDashboard","renderFrnSeasonRecap",
    "renderFrnOffseason","renderFrnDraft","renderFrnAwards","renderFrnResignings","_startDraftFloorAnim",
    "_flushSaveFranchise","saveFranchise"]){ try{ if(typeof eval(fn)==="function") eval(fn+" = function(){}"); }catch(e){} }
  try{ startFranchise(0); }catch(e){ console.error("start threw:",e.message); process.exit(1); }

  // Count IR placements league-wide by wrapping placeOnIr.
  let placements=0, activations=0;
  if(typeof placeOnIr==="function"){ const o=placeOnIr; placeOnIr=function(){ const r=o.apply(this,arguments); if(r)placements++; return r; }; }
  if(typeof activateFromIr==="function"){ const o=activateFromIr; activateFromIr=function(){ const r=o.apply(this,arguments); if(r)activations++; return r; }; }

  function snap(){
    const cap=franchise.salaryCap||1; let nT=0,size=0,irN=0,act=0,tru=0,over=0,maxRoster=0;
    for(const t of TEAMS){ const roster=(franchise.rosters&&franchise.rosters[t.id])||[]; if(!roster.length)continue;
      const ir=(franchise.ir&&franchise.ir[t.id])||[];
      let h=0; for(const p of roster) h+=currentYearCapHit(p);
      const tu=(typeof capUsedByTeam==="function")?capUsedByTeam(t.id):h;
      size+=roster.length; irN+=ir.length; act+=100*h/cap; tru+=100*tu/cap;
      if(roster.length>53) over++; maxRoster=Math.max(maxRoster,roster.length); nT++; }
    return { size:size/nT, ir:irN/nT, act:act/nT, tru:tru/nT, over, maxRoster };
  }

  function step(fn){ if(typeof fn==="function"){ try{ fn(); }catch(e){ console.error("step threw:",e.message); } } }
  async function stepA(fn){ if(typeof fn==="function"){ try{ await fn(); }catch(e){ console.error("stepA threw:",e.message); } } }

  console.log("");
  console.log(" S | roster | onIR | act% | true% | >53 | maxR | placed/activated (cum)");
  console.log("---+--------+------+------+-------+-----+------+-----------------------");
  for(let s=0;s<${SEASONS};s++){
    step(typeof frnSimToEndOfSeason!=="undefined"&&frnSimToEndOfSeason);
    const a=snap();
    console.log(String(s+1).padStart(2)+" | "+a.size.toFixed(1).padStart(6)+" | "+a.ir.toFixed(1).padStart(4)+
      " | "+a.act.toFixed(1).padStart(4)+" | "+a.tru.toFixed(1).padStart(5)+" | "+String(a.over).padStart(3)+
      " | "+String(a.maxRoster).padStart(4)+" | "+placements+" / "+activations);
    step(typeof showFrnAwards!=="undefined"&&showFrnAwards);
    if(franchise.phase==="awards"){ if(typeof frnApbProceedToOffseason==="function") step(frnApbProceedToOffseason);
      else step(typeof startFrnOffseason!=="undefined"&&startFrnOffseason); }
    step(typeof frnProceedToRosterChanges!=="undefined"&&frnProceedToRosterChanges);
    step(typeof frnGoToDraft!=="undefined"&&frnGoToDraft);
    await stepA(typeof frnAutoDraftRemaining!=="undefined"&&frnAutoDraftRemaining);
    await stepA(typeof frnDraftFinishScramble!=="undefined"&&frnDraftFinishScramble);
    if(typeof _trimAiRostersToCap==="function"){ try{ _trimAiRostersToCap(53,{includeUser:true}); }catch(e){} }
    step(typeof frnNewSeason!=="undefined"&&frnNewSeason);
  }
  console.log("");
  console.log("Total IR placements: "+placements+"   activations (returns): "+activations+"   over 100 team-seasons of play");
  console.log("Per team-season: "+(placements/(${SEASONS}*TEAMS.length)).toFixed(1)+" placements, "+
    (activations/(${SEASONS}*TEAMS.length)).toFixed(1)+" activations");
  if(typeof process!=="undefined"&&process.exit)process.exit(0);
})();
`;
let bundle=shim+extraConsts;
for(const f of files) bundle+="\n;// ===== "+f+" =====\n"+stripUiInit(fs.readFileSync(path.join(__dirname,f),"utf8"),f)+"\n";
bundle+=harness;
new Function(bundle)();
