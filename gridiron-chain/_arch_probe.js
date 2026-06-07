// ARCHETYPE PROBE — does each positional archetype actually CHANGE the box
// score, or is it a flavor-only label? For a position, generates one exemplar
// of EACH archetype near a common OVR (realistic stat profiles, controlled
// rating), swaps it/them into the starting lineup of a fixed home team, and
// runs many seeded games vs a fixed opponent. Everything else is held constant,
// so the archetype is the only variable. Reports each archetype's signature
// stats — offensive skill positions read the exemplar's own line; defensive
// units read what the OPPONENT offense did against them. Dev/audit tool only.
//   Usage:  node _arch_probe.js [POS|ALL] [games]
//   POS in QB RB WR TE OL DL LB CB S K P   (default ALL, 200 games)
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
const POS_ARG = (process.argv[2] || "ALL").toUpperCase();
const GAMES = Number(process.argv[3] || 200);

const audit = `
;(function runArchProbe() {
  if (typeof TEAMS==="undefined"||typeof GameSimulator==="undefined"){console.error("load fail");process.exit(1);}
  const GAMES = ${GAMES};
  const POS_ARG = ${JSON.stringify(POS_ARG)};

  // Seeded mulberry32 — identical cast/opponent/conditions per archetype + run.
  let _seed=0; function _srand(s){_seed=s>>>0;}
  Math.random=function(){ _seed=(_seed+0x6D2B79F5)|0; let t=Math.imul(_seed^(_seed>>>15),1|_seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };

  const ARCHES = {
    QB:["POCKET","GUNSLINGER","GAME_MANAGER","DUAL_THREAT","FIELD_GENERAL"],
    RB:["POWER","ELUSIVE","SPEED","WORKHORSE","RECEIVING"],
    WR:["DEEP_THREAT","POSSESSION","SLOT","RED_ZONE","ROUTE_RUNNER"],
    TE:["RECEIVING","BLOCKING","HYBRID"],
    OL:["ANCHOR","ATHLETIC","TECHNICIAN","PLUG","MAULER"],
    DL:["POWER","SPEED","TWEENER","PENETRATOR","TECHNICIAN"],
    LB:["THUMPER","COVER","BLITZER","SIGNAL","HEADHUNTER","HYBRID"],
    CB:["SHUTDOWN","BALL_HAWK","PHYSICAL","SLOT_CB","ZONE"],
    S:["BALL_HAWK","BOX","CENTER_FIELD","HEADHUNTER","HYBRID"],
    K:["LEG","PRECISION","CLUTCH","BALANCED"],
    P:["BOOMER","DIRECTIONAL","HANG_TIME","ATHLETE","BALANCED"],
  };
  // unit = how many starters to swap; side = which box score the signal lives in.
  const CFG = {
    QB:{unit:1,side:"off",tgt:84}, RB:{unit:1,side:"off",tgt:84}, WR:{unit:1,side:"off",tgt:84},
    TE:{unit:1,side:"off",tgt:84}, OL:{unit:5,side:"off",tgt:82}, DL:{unit:4,side:"def",tgt:82},
    LB:{unit:3,side:"def",tgt:82}, CB:{unit:3,side:"def",tgt:82}, S:{unit:2,side:"def",tgt:82},
    K:{unit:1,side:"st",tgt:80}, P:{unit:1,side:"st",tgt:80},
  };

  function weightedTier(){ const r=Math.random(); return r<0.30?"elite":r<0.80?"good":"average"; }
  // Pull count distinct exemplars of arch near tgt OVR by rejection sampling.
  function exemplars(pos, arch, tgt, count){
    const pool=[];
    for(let i=0;i<9000 && pool.length<count*40;i++){
      const p=genPlayer(pos, weightedTier());
      if(p.archetype===arch) pool.push(p);
    }
    pool.sort((a,b)=>Math.abs(a.overall-tgt)-Math.abs(b.overall-tgt));
    const out=[];
    for(const p of pool){ if(out.length>=count)break;
      if(out.some(o=>o.name===p.name))continue; out.push(p); }
    while(out.length<count){ const p=genPlayer(pos,"good"); p.archetype=arch; p.name="X"+out.length+" "+p.name; out.push(p); }
    return out;
  }

  _srand(0xC0FFEE);
  const HOME=TEAMS[0], AWAY=TEAMS[1];
  const homeBase=genRoster(getPlaybook(HOME),{},null);
  const awayRoster=genRoster(getPlaybook(AWAY),{},null);

  const POSN = (POS_ARG==="ALL") ? Object.keys(CFG) : [POS_ARG];
  function f(n,d=1){ return Number.isFinite(n)?Number(n).toFixed(d):"--"; }

  for(const POS of POSN){
    if(!CFG[POS]){ console.log("unknown pos "+POS); continue; }
    const {unit,side,tgt}=CFG[POS];
    console.log("\\n══════════ "+POS+" ARCHETYPES — "+GAMES+" games, OVR~"+tgt+", swap "+unit+" starter(s) ══════════");
    // Fixed deliberately-weak backups so the exemplar ALWAYS starts, even for
    // archetypes the picker only assigns at low OVR (e.g. WORKHORSE). Removing
    // the base depth at POS and capping these well below tgt guarantees the
    // exemplar is the starter without inflating its rating.
    _srand(0xBACC);
    const posBackups=[genPlayer(POS,"poor"),genPlayer(POS,"poor")];
    posBackups.forEach((b,i)=>{ b.name="Bkp"+i+"_"+POS; b.overall=Math.min(b.overall,62); });
    const rows=[];
    for(const ARCH of ARCHES[POS]){
      _srand(0xA11CE);                                   // stable exemplar gen per arch
      const exs=exemplars(POS, ARCH, tgt, unit);
      const exNames=new Set(exs.map(e=>e.name));
      const avgOvr=exs.reduce((s,e)=>s+e.overall,0)/exs.length;
      // Build roster: remove ALL base players at POS, install exemplars + weak
      // backups, keep every other position intact.
      const roster=[...exs, ...posBackups, ...homeBase.filter(p=>p.position!==POS)];

      const A={g:0,
        pAtt:0,pComp:0,pYds:0,pTD:0,pInt:0,sk:0,            // QB own
        rAtt:0,rYds:0,rTD:0,bt:0,fum:0,rec:0,recY:0,        // RB/WR/TE own (+rec)
        tgt:0,recTD:0,drop:0,recLong:0,
        oPassY:0,oRushY:0,oPAtt:0,oPComp:0,oRAtt:0,         // opp offense (def units)
        dSk:0,dTkl:0,dInt:0,dPd:0,dFF:0,                    // def own
        panc:0,teamSkAllow:0,teamRushY:0,teamRAtt:0,        // OL/team
        fgM:0,fgA:0,fgLong:0,xpM:0,xpA:0,                   // K
        puntA:0,puntY:0,in20:0,tb:0,puntLong:0,             // P
        homePts:0,awayPts:0,win:0 };
      _srand(0x5EED);
      for(let gi=0; gi<GAMES; gi++){
        const sim=new GameSimulator(HOME,AWAY,roster,awayRoster);
        const r=sim.simulate(); A.g++;
        A.homePts+=r.homeScore; A.awayPts+=r.awayScore; if(r.homeScore>r.awayScore)A.win++;
        const hp=r.stats.home.players, ap=r.stats.away.players;
        const ht=r.stats.home.team, at=r.stats.away.team;
        // own exemplar lines (exact attribution by name)
        for(const nm of exNames){ const L=hp[nm]; if(!L)continue;
          A.pAtt+=L.pass_att||0;A.pComp+=L.pass_comp||0;A.pYds+=L.pass_yds||0;A.pTD+=L.pass_td||0;A.pInt+=L.pass_int||0;A.sk+=L.sacks_taken||0;
          A.rAtt+=L.rush_att||0;A.rYds+=L.rush_yds||0;A.rTD+=L.rush_td||0;A.bt+=L.broken_tackles||0;A.fum+=L.fumbles||0;
          A.rec+=L.rec||0;A.recY+=L.rec_yds||0;A.tgt+=L.rec_tgt||0;A.recTD+=L.rec_td||0;A.drop+=L.rec_drops||0;A.recLong=Math.max(A.recLong,L.rec_long||0);
          A.dSk+=L.sk||0;A.dTkl+=L.tkl||0;A.dInt+=L.int_made||0;A.dPd+=L.pd||0;A.dFF+=L.ff||0;
          A.panc+=L.pancakes||0;
          A.fgM+=L.fg_made||0;A.fgA+=L.fg_att||0;A.fgLong=Math.max(A.fgLong,L.fg_long||0);A.xpM+=L.xp_made||0;A.xpA+=L.xp_att||0;
          A.puntA+=L.punt_att||0;A.puntY+=L.punt_yds||0;A.in20+=L.punts_in_20||0;A.tb+=L.touchbacks||0;A.puntLong=Math.max(A.puntLong,L.punt_long||0);
        }
        // opponent offense (defensive-unit signal) + home team aggregate
        A.oPassY+=at.passYds||0;A.oRushY+=at.rushYds||0;A.oPAtt+=at.pass_att||0;A.oPComp+=at.pass_comp||0;A.oRAtt+=at.rush_att||0;
        A.teamSkAllow+=ht.sacks_allowed||0;A.teamRushY+=ht.rushYds||0;A.teamRAtt+=ht.rush_att||0;
      }
      rows.push({ARCH,avgOvr,A});
    }
    printTable(POS, side, rows, f);
  }

  function printTable(POS, side, rows, f){
    const g=rows[0].A.g;
    let cols;
    if(POS==="QB") cols=[["pAtt",r=>f(r.A.pAtt/g,1)],["CMP%",r=>f(r.A.pComp/Math.max(1,r.A.pAtt)*100,1)],
      ["pYDS",r=>f(r.A.pYds/g,0)],["pTD",r=>f(r.A.pTD/g,2)],["INT",r=>f(r.A.pInt/g,2)],
      ["SK",r=>f(r.A.sk/g,1)],["rAtt",r=>f(r.A.rAtt/g,1)],["rYDS",r=>f(r.A.rYds/g,1)],["WIN%",r=>f(100*r.A.win/g,0)]];
    else if(POS==="RB") cols=[["rAtt",r=>f(r.A.rAtt/g,1)],["rYDS",r=>f(r.A.rYds/g,1)],["YPC",r=>f(r.A.rYds/Math.max(1,r.A.rAtt),2)],
      ["rTD",r=>f(r.A.rTD/g,2)],["BT/g",r=>f(r.A.bt/g,2)],["FUM/g",r=>f(r.A.fum/g,3)],["REC",r=>f(r.A.rec/g,1)],["recY",r=>f(r.A.recY/g,1)]];
    else if(POS==="WR"||POS==="TE") cols=[["TGT",r=>f(r.A.tgt/g,1)],["REC",r=>f(r.A.rec/g,1)],["CATCH%",r=>f(r.A.rec/Math.max(1,r.A.tgt)*100,1)],
      ["recYDS",r=>f(r.A.recY/g,1)],["Y/REC",r=>f(r.A.recY/Math.max(1,r.A.rec),1)],["Y/TGT",r=>f(r.A.recY/Math.max(1,r.A.tgt),1)],
      ["recTD",r=>f(r.A.recTD/g,2)],["DROP/g",r=>f(r.A.drop/g,2)],["LONG",r=>f(r.A.recLong,0)],
      ...(POS==="TE"?[["tmRshY",r=>f(r.A.teamRushY/g,0)]]:[])];
    else if(POS==="OL") cols=[["skAllow/g",r=>f(r.A.teamSkAllow/g,2)],["tmRushY",r=>f(r.A.teamRushY/g,0)],
      ["tmYPC",r=>f(r.A.teamRushY/Math.max(1,r.A.teamRAtt),2)],["PANC/g",r=>f(r.A.panc/g,1)]];
    else if(POS==="DL"||POS==="LB"||POS==="CB"||POS==="S") cols=[["SK/g",r=>f(r.A.dSk/g,2)],["TKL/g",r=>f(r.A.dTkl/g,1)],
      ["INT/g",r=>f(r.A.dInt/g,3)],["PD/g",r=>f(r.A.dPd/g,2)],["FF/g",r=>f(r.A.dFF/g,3)],
      ["oppPassY",r=>f(r.A.oPassY/g,0)],["oppCMP%",r=>f(r.A.oPComp/Math.max(1,r.A.oPAtt)*100,1)],["oppRushY",r=>f(r.A.oRushY/g,0)]];
    else if(POS==="K") cols=[["FGM/g",r=>f(r.A.fgM/g,2)],["FGA/g",r=>f(r.A.fgA/g,2)],["FG%",r=>f(r.A.fgM/Math.max(1,r.A.fgA)*100,1)],
      ["FGlong",r=>f(r.A.fgLong,0)],["XP%",r=>f(r.A.xpM/Math.max(1,r.A.xpA)*100,1)]];
    else if(POS==="P") cols=[["PUNT/g",r=>f(r.A.puntA/g,1)],["AVG",r=>f(r.A.puntY/Math.max(1,r.A.puntA),1)],
      ["in20/g",r=>f(r.A.in20/g,2)],["TB/g",r=>f(r.A.tb/g,2)],["LONG",r=>f(r.A.puntLong,0)]];
    const W0=14; const head=["ARCHETYPE".padEnd(W0),"OVR".padEnd(5),...cols.map(c=>c[0].padEnd(9))].join("");
    console.log(head); console.log("─".repeat(head.length));
    for(const r of rows){ console.log([r.ARCH.padEnd(W0), f(r.avgOvr,1).padEnd(5), ...cols.map(c=>String(c[1](r)).padEnd(9))].join("")); }
  }
})();
`;
let bundle = shim + "\n";
for (const fl of files) { let code=fs.readFileSync(path.join(__dirname,fl),"utf8"); code=stripUiInit(code,fl); bundle+="\n;//=== "+fl+" ===\n"+code+"\n"; }
bundle += "\n" + audit;
new Function(bundle)();
