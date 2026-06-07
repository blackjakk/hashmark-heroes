// Bake the MFF Win Probability table from a multi-season round-robin.
//
// First-principles (same argument as the EP bake): WP(state) is a property
// of the engine's RULES (clock-burn rate, scoring rate from a state, etc.),
// not of which franchises are playing. Talent shifts how often a state is
// reached, not the win-value of being in it. So a baked empirical table
// trained on the LEAGUE-WIDE win outcomes is the correct estimate; a "live"
// franchise WP would be strictly noisier (small per-season sample, tied to
// one team's strength).
//
// Method: walk every scrimmage snap in every game. For each snap, record
//   (scoreDiff_offense, secondsLeft_in_regulation, yardLine, down, ytg).
// At the end, label each snap with whether the OFFENSIVE TEAM won that
// game (0/1/0.5 for tie). Aggregate by feature bucket → empirical WP.
//
// 3-level fallback (same shape as EP table):
//   Level 1 (detailed): sd_b | tl_b | yl_b | down       — ~3640 keys
//   Level 2 (mid):       sd_b | tl_b | yl_b              — ~910  keys
//   Level 3 (coarse):    sd_b | tl_b                     — ~91   keys
//
// Buckets:
//   sd (score diff from offense's view):
//     0:≤-17  1:-16..-15  2:-14..-9  3:-8  4:-7  5:-6..-4  6:-3..-1
//     7:0     8:+1..+3    9:+4..+6  10:+7  11:+8  12:+9..+14  13:+15..+16  14:≥+17
//   tl (seconds left in regulation):
//     0:≤30  1:31-120  2:121-300  3:301-600  4:601-1200  5:1201-1800  6:≥1801
//   yl (offensive yardline 1-99, 10-yard buckets):  0..9
//   down: 1..4
//
// Output: /tmp/mff_wp_baked.js — paste into play-franchise-stats.js.
// Run:    node _mff_bake_wp.js [seasons=2]
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
  const SNAP=new Set(["complete","incomplete","sack","int","run","scramble"]);
  function sdBucket(d){
    if (d<=-17) return 0; if (d<=-15) return 1; if (d<=-9) return 2;
    if (d===-8) return 3; if (d===-7) return 4; if (d>=-6 && d<=-4) return 5;
    if (d>=-3 && d<=-1) return 6; if (d===0) return 7;
    if (d>=1 && d<=3) return 8; if (d>=4 && d<=6) return 9;
    if (d===7) return 10; if (d===8) return 11;
    if (d>=9 && d<=14) return 12; if (d>=15 && d<=16) return 13;
    return 14;
  }
  function tlBucket(s){
    if (s<=30) return 0; if (s<=120) return 1; if (s<=300) return 2;
    if (s<=600) return 3; if (s<=1200) return 4; if (s<=1800) return 5;
    return 6;
  }
  const ylBucket = yl => Math.max(0, Math.min(9, Math.floor(yl/10)));
  const ros = {}; for (const t of TEAMS) ros[t.id] = genRoster(getPlaybook(t),{},null);
  const acc = {};   // key → {sum:0,n:0}   sum = sum of off-won (0/1/0.5)
  const add = (k,v) => { (acc[k] || (acc[k] = {sum:0,n:0})); acc[k].sum += v; acc[k].n++; };
  let totalSnaps = 0;
  for (let s=0; s<SEASONS; s++) {
    if (s>0) for (const t of TEAMS) ros[t.id] = genRoster(getPlaybook(t),{},null);
    for (let i=0; i<TEAMS.length; i++) for (let j=i+1; j<TEAMS.length; j++) {
      const sim = new GameSimulator(TEAMS[i], TEAMS[j], ros[TEAMS[i].id], ros[TEAMS[j].id]);
      sim.simulate();
      const fh = sim.score.home, fa = sim.score.away;
      const homeWon = fh>fa ? 1 : fh<fa ? 0 : 0.5;
      for (const p of sim.plays) {
        if (!SNAP.has(p.kind) || !(p.down>=1 && p.down<=4) || typeof p.yardLine!=="number") continue;
        if (p.quarter >= 5) continue;   // skip OT — too sparse, treat as endpoint
        const sl = (4 - p.quarter) * 900 + (typeof p.time==="number" ? p.time : 0);
        const offIsHome = p.poss === "home";
        const sd = offIsHome ? (p.homeScore - p.awayScore) : (p.awayScore - p.homeScore);
        const offWon = offIsHome ? homeWon : (homeWon === 0.5 ? 0.5 : 1 - homeWon);
        const sdB = sdBucket(sd);
        const tlB = tlBucket(sl);
        const ylB = ylBucket(p.yardLine);
        const k1 = sdB+"|"+tlB+"|"+ylB+"|"+p.down;
        const k2 = sdB+"|"+tlB+"|"+ylB;
        const k3 = sdB+"|"+tlB;
        add(k1, offWon); add(k2, offWon); add(k3, offWon);
        totalSnaps++;
      }
    }
  }
  // Tables. Drop low-n entries from levels 1/2 to avoid noise; level 3 keeps all.
  const FULL = {}, MID = {}, COARSE = {};
  const MIN_FULL = 25, MIN_MID = 25;
  let kept=0, df=0, dm=0;
  for (const k of Object.keys(acc).sort()) {
    const e = acc[k];
    const parts = k.split("|");
    if (parts.length === 4) {
      if (e.n >= MIN_FULL) { FULL[k] = +(e.sum/e.n).toFixed(3); kept++; } else df++;
    } else if (parts.length === 3) {
      if (e.n >= MIN_MID)  { MID[k]  = +(e.sum/e.n).toFixed(3); kept++; } else dm++;
    } else {
      COARSE[k] = +(e.sum/e.n).toFixed(3); kept++;
    }
  }
  function WP(sd, sl, yl, down) {
    const sdB = sdBucket(sd), tlB = tlBucket(sl), ylB = ylBucket(yl);
    const k1 = sdB+"|"+tlB+"|"+ylB+"|"+down;
    if (FULL[k1] != null) return FULL[k1];
    const k2 = sdB+"|"+tlB+"|"+ylB;
    if (MID[k2] != null) return MID[k2];
    const k3 = sdB+"|"+tlB;
    if (COARSE[k3] != null) return COARSE[k3];
    return 0.5;
  }
  console.error("Bake: "+totalSnaps+" snaps from "+SEASONS+" season(s).");
  console.error("Sanity:");
  console.error("  start of game, midfield, even:        WP = " + WP(0, 3600, 25, 1).toFixed(2) + "  (NFL ref ~0.50)");
  console.error("  up 7, 30s left, opp territory:        WP = " + WP(+7, 30, 80, 1).toFixed(2) + "  (NFL ref ~0.95+)");
  console.error("  down 7, 30s left, own 20:             WP = " + WP(-7, 30, 20, 1).toFixed(2) + "  (NFL ref ~0.02-0.10)");
  console.error("  up 21, 5 min left, midfield:          WP = " + WP(+21, 300, 50, 1).toFixed(2) + "  (NFL ref ~0.99)");
  console.error("  down 14, 5 min left, own 25:          WP = " + WP(-14, 300, 25, 1).toFixed(2) + "  (NFL ref ~0.05-0.15)");
  console.error("  up 3, 2 min left, own 30:             WP = " + WP(+3, 120, 30, 1).toFixed(2) + "  (NFL ref ~0.75-0.85)");
  console.error("  tied, 2 min left, opp 20:             WP = " + WP(0, 120, 80, 1).toFixed(2) + "  (NFL ref ~0.70-0.85; FG-range tied)");
  console.error("Kept "+kept+" keys; dropped "+df+" full / "+dm+" mid below sample floor.");
  const out = [];
  out.push("// Baked WP table — generated by _mff_bake_wp.js (do not edit by hand).");
  out.push("// Method: empirical P(offense's team wins | game state) over a "+SEASONS+"-season round-robin.");
  out.push("// 3-level fallback: full(sd|tl|yl|down) → mid(sd|tl|yl) → coarse(sd|tl).");
  out.push("//   sd buckets:   0:≤-17 1:-16..-15 2:-14..-9 3:-8 4:-7 5:-6..-4 6:-3..-1 7:0 8:+1..+3 9:+4..+6 10:+7 11:+8 12:+9..+14 13:+15..+16 14:≥+17");
  out.push("//   tl buckets:   0:≤30s 1:31-120 2:121-300 3:301-600 4:601-1200 5:1201-1800 6:≥1801");
  out.push("//   yl buckets:   0=own-goal..9=opp-goal (10-yard chunks)");
  out.push("const _MFF_WP_TABLE_FULL = " + JSON.stringify(FULL) + ";");
  out.push("const _MFF_WP_TABLE_MID  = " + JSON.stringify(MID) + ";");
  out.push("const _MFF_WP_TABLE_COARSE = " + JSON.stringify(COARSE) + ";");
  globalThis.__mffWpOut = out.join("\\n");
})();`;
let code = shim + "\n";
for (const f of files) { let c = fs.readFileSync(path.join(__dirname, f), "utf8"); c = stripUiInit(c, f); code += "\n" + c + "\n"; }
code += driver;
require("vm").runInThisContext(code, { filename: "_mff_bake_wp_bundle.js" });
fs.writeFileSync("/tmp/mff_wp_baked.js", globalThis.__mffWpOut);
console.error("Wrote /tmp/mff_wp_baked.js ("+globalThis.__mffWpOut.length+" bytes).");
