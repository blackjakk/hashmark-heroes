// QB-STYLE PROBE — isolates QB archetype effect on production.
// Builds ONE fixed home roster + ONE fixed away roster, then swaps ONLY the
// home QB across hand-built profiles (pocket cannon / dual-threat / noodle-arm
// quick-legs / balanced), dropping all other home QBs so the profile QB always
// starts. Same supporting cast + same opponent across profiles → win% and
// production are directly comparable. Answers "how would peak Mike Vick do?"
// Dev/audit tool only — ignored by the build.  Usage: node _qb_probe.js [games]
const fs = require("fs");
const path = require("path");

const files = [
  "play-data.js", "play-player.js", "play-render.js",
  "play-sim.js", "play-motion.js", "play-engine.js",
];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "style" || k === "classList" || k === "dataset") return _stub;
                if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = () => 0;
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

const GAMES = Number(process.argv[2] || 300);

const audit = `
;(function runProbe() {
  if (typeof TEAMS === "undefined" || typeof GameSimulator === "undefined") {
    console.error("Missing TEAMS or GameSimulator after load"); process.exit(1);
  }
  console.error("Loaded OK — QB probe, " + ${GAMES} + " games per profile.");
  const GAMES = ${GAMES};
  // Seeded RNG (mulberry32) so the cast + opponent are IDENTICAL run-to-run and
  // every profile faces the same game conditions — the QB is the only variable.
  // This makes win% comparable across profiles AND across before/after a tuning
  // change (the live game uses Math.random; we override it deterministically).
  let _seed = 0;
  function _srand(s){ _seed = s >>> 0; }
  Math.random = function(){
    _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // stat idx: 0 SPD,1 STR,2 AGI,3 AWR,4 THR,5 CAT,6 BLK,7 PRS,8 COV,9 TCK,10 KPW,11 TEC
  // Profiles are hand-built to a comparable talent budget; the point is to see
  // (a) what OVR the formula assigns each style and (b) how each PRODUCES.
  const PROFILES = {
    POCKET_CANNON:  [58,72,60,92,96,30,30,30,30,30,30,88],  // Brady/Manning — statue + cannon
    DUAL_ELITE:     [96,74,94,82,86,30,30,30,30,30,30,84],  // peak Lamar/Vick — elite legs, good arm
    NOODLE_QUICK:   [96,68,93,68,74,30,30,30,30,30,30,70],  // raw Vick/RGIII — noodle arm, quick legs
    BALANCED:       [76,70,78,84,86,30,30,30,30,30,30,82],  // control
  };

  function makeQB(name, stats) {
    const s = stats.slice();
    const p = genUniquePlayer("QB", "good", new Set([name]));
    p.name = name; p.stats = s;
    p.overall = calcOverall("QB", s);
    p.archetype = pickQBArchetype(s);
    p.age = 26; p.position = "QB";
    return p;
  }

  // Fixed teams + fixed rosters (built ONCE under a fixed seed, reused across
  // every profile so supporting cast + opponent are held constant).
  _srand(0xC0FFEE);
  const HOME = TEAMS[0], AWAY = TEAMS[1];
  const homeBase = genRoster(getPlaybook(HOME), {}, null);
  const awayRoster = genRoster(getPlaybook(AWAY), {}, null);
  // Strip ALL QBs from the home base — we inject the profile QB as the only one.
  const homeNoQB = homeBase.filter(p => p.position !== "QB");

  function fmt(n, d=1){ return Number(n).toFixed(d); }

  const rows = [];
  for (const [label, stats] of Object.entries(PROFILES)) {
    _srand(0xA11CE);                 // stable archetype roll per profile
    const qb = makeQB("Probe " + label, stats);
    const roster = [qb, ...homeNoQB];
    let wins=0, ties=0, pts=0;
    let pAtt=0,pComp=0,pYds=0,pTD=0,pInt=0,sacks=0;
    let rAtt=0,rYds=0,rTD=0;
    _srand(0x5EED);                  // identical game-condition stream for every profile
    for (let g=0; g<GAMES; g++) {
      const sim = new GameSimulator(HOME, AWAY, roster, awayRoster);
      const r = sim.simulate();
      pts += r.homeScore;
      if (r.homeScore > r.awayScore) wins++; else if (r.homeScore === r.awayScore) ties++;
      const line = r.stats.home.players[qb.name];
      if (line) {
        pAtt += line.pass_att||0; pComp += line.pass_comp||0; pYds += line.pass_yds||0;
        pTD += line.pass_td||0; pInt += line.pass_int||0; sacks += line.sacks_taken||0;
        rAtt += line.rush_att||0; rYds += line.rush_yds||0; rTD += line.rush_td||0;
      }
    }
    rows.push({ label, ovr: qb.overall, arch: qb.archetype,
      winPct: 100*wins/GAMES, pts: pts/GAMES,
      pAtt: pAtt/GAMES, comp: pComp/Math.max(1,pAtt)*100, pYds: pYds/GAMES,
      pTD: pTD/GAMES, pInt: pInt/GAMES, sacks: sacks/GAMES,
      rAtt: rAtt/GAMES, rYds: rYds/GAMES, ypc: rYds/Math.max(1,rAtt),
      rTD: rTD/GAMES, totYds: (pYds+rYds)/GAMES });
  }

  console.log("\\n══════════ QB-STYLE PROBE — " + GAMES + " games each, same cast + opponent ══════════");
  console.log("(home QB swapped only; all other home QBs dropped so the profile QB always starts)\\n");
  const H = ["PROFILE","OVR","ARCHETYPE","WIN%","PTS","pAtt","CMP%","pYDS","pTD","INT","SK","rAtt","rYDS","YPC","rTD","TOTyd"];
  const W = [14,4,13,5,5,5,5,6,4,4,4,5,5,5,4,6];
  console.log(H.map((h,i)=>h.padEnd(W[i])).join(""));
  console.log("─".repeat(W.reduce((a,b)=>a+b,0)));
  for (const r of rows) {
    const cells = [r.label, String(r.ovr), r.arch, fmt(r.winPct,0), fmt(r.pts,1),
      fmt(r.pAtt,1), fmt(r.comp,1), fmt(r.pYds,0), fmt(r.pTD,2), fmt(r.pInt,2), fmt(r.sacks,1),
      fmt(r.rAtt,1), fmt(r.rYds,1), fmt(r.ypc,1), fmt(r.rTD,2), fmt(r.totYds,0)];
    console.log(cells.map((c,i)=>String(c).padEnd(W[i])).join(""));
  }
  console.log("\\nNFL reference: pocket QB ~2-3 rush att / ~12 rush yds per game;");
  console.log("peak dual-threat (Lamar/Vick) ~8-12 rush att / ~55-80 rush yds per game.");
  console.log("Real-world: an elite dual-threat is a TOP-TIER QB, not a downgrade vs a pocket passer.\\n");
})();
`;

let bundle = shim + "\n";
for (const f of files) {
  let code = fs.readFileSync(path.join(__dirname, f), "utf8");
  code = stripUiInit(code, f);
  bundle += "\n;//=== " + f + " ===\n" + code + "\n";
}
bundle += "\n" + audit;
new Function(bundle)();
