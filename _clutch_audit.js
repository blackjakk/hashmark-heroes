// Aggregate game-level audit for the clutch factor. Runs many real engine
// games and mines the play log (every play is stamped with quarter/time/score
// by _pushVisual) to measure outcomes by the acting player's clutch tier, in
// clutch moments vs not. Because _clutch is generated ORTHOGONALLY to skill,
// any ICE-vs-CHOKE gap that appears ONLY in clutch moments is the feature
// working (not a talent confound). Dev tool — ignored by the build.
const fs = require("fs");
const path = require("path");

const files = ["play-data.js", "play-player.js", "play-render.js", "play-sim.js", "play-motion.js", "play-engine.js"];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t,k){ if(k==="style"||k==="classList"||k==="dataset")return _stub; if(k==="length")return 0;
              if(k===Symbol.iterator)return function*(){}; return _stub; },
    set(){return true;}, apply(){return _stub;}, construct(){return _stub;} });
  var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,
    querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
  var window=(typeof globalThis!=="undefined"?globalThis:this); window.addEventListener=()=>{};
  if(typeof performance==="undefined")var performance={now:()=>Date.now()};
  var requestAnimationFrame=()=>0;
  var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
`;

const GAMES = Number(process.argv[2] || 4000);

const audit = `
;(function(){
  const GAMES = ${GAMES};
  // Large pool of distinct rosters (3 per team) so each clutch tier contains
  // MANY distinct players and baseline skill averages out — and we report
  // difference-in-differences anyway, which cancels any residual skill confound.
  const POOL_N = 96;
  const buildPool = () => { const a = []; for (let n = 0; n < POOL_N; n++)
    a.push({ team: TEAMS[n % TEAMS.length], roster: genRoster(getPlaybook(TEAMS[n % TEAMS.length]), {}, null) }); return a; };
  let pool = buildPool();
  const tier = (c) => (c == null ? null : c >= 60 ? "ICE" : c <= 40 ? "CHOKE" : null);
  const isClutch = (p) => p.quarter >= 4 && p.time < 300 && Math.abs((p.homeScore||0) - (p.awayScore||0)) <= 8;

  // tally[pos][tier][moment] = { att, made, comp, int }
  const T = {};
  const bump = (pos, tr, mom, f) => {
    T[pos] = T[pos] || {}; T[pos][tr] = T[pos][tr] || {};
    const o = (T[pos][tr][mom] = T[pos][tr][mom] || { att:0, made:0, comp:0, int:0 });
    o[f]++;
  };
  const kinds = {};

  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    if (g > 0 && g % 600 === 0) pool = buildPool();           // bound injury drift
    let i = (Math.random() * pool.length) | 0, j;
    do { j = (Math.random() * pool.length) | 0; } while (j === i || pool[j].team === pool[i].team);
    const sim = new GameSimulator(pool[i].team, pool[j].team, pool[i].roster, pool[j].roster);
    sim.simulate();
    const byName = sim._playerByName;
    for (const p of sim.plays) {
      const k = p.kind; if (!k) continue;
      const mom = isClutch(p) ? "clutch" : "normal";
      if ((k === "fg_good" || k === "fg_miss") && typeof p.fgDist === "number") {
        kinds[k] = (kinds[k]||0) + 1;
        const tr = tier(byName.get(p.kicker)?._clutch); if (!tr) continue;
        bump("K", tr, mom, "att"); if (k === "fg_good") bump("K", tr, mom, "made");
      } else if ((k === "complete" || k === "incomplete" || k === "int") && p.passer) {
        kinds[k] = (kinds[k]||0) + 1;
        const tr = tier(byName.get(p.passer)?._clutch); if (!tr) continue;
        bump("QB", tr, mom, "att");
        if (k === "complete") bump("QB", tr, mom, "comp");
        if (k === "int")      bump("QB", tr, mom, "int");
      }
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const pct = (n, d) => d ? (100 * n / d) : NaN;
  const f1 = (x) => Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(1) : "n/a";
  const get = (pos, tr, mom) => (T[pos]?.[tr]?.[mom]) || { att:0, made:0, comp:0, int:0 };
  const row = (label, ice, cho, key) => {
    const iR = pct(ice[key], ice.att), cR = pct(cho[key], cho.att);
    const gap = (iR - cR);
    console.log("    " + label.padEnd(16)
      + "ICE " + (Number.isFinite(iR)?iR.toFixed(1):"n/a") + "% (n=" + String(ice.att).padStart(5) + ")   "
      + "CHOKE " + (Number.isFinite(cR)?cR.toFixed(1):"n/a") + "% (n=" + String(cho.att).padStart(5) + ")   "
      + "gap " + f1(gap) + "pp");
    return gap;
  };
  const block = (title, pos, key, expectPos) => {
    console.log("\\n" + title);
    const cg = row("clutch moments", get(pos,"ICE","clutch"), get(pos,"CHOKE","clutch"), key);
    const ng = row("normal moments", get(pos,"ICE","normal"), get(pos,"CHOKE","normal"), key);
    const did = cg - ng;
    const good = expectPos ? did > 0 : did < 0;
    console.log("    => DiD (clutch effect, skill-confound-cancelled): " + f1(did) + "pp  "
                + (good ? "\\u2713 correct direction" : "\\u2717 WRONG / inconclusive"));
    return did;
  };

  console.log("\\n=== CLUTCH AGGREGATE AUDIT — " + GAMES + " games in " + secs + "s, pool " + POOL_N + " ===");
  console.log("play kinds captured: " + JSON.stringify(kinds));
  console.log("tier = hidden _clutch (ICE>=60 / CHOKE<=40); DiD = clutchGap - normalGap");
  block("KICKER FG% (real attempts):",        "K",  "made", true);
  block("QB COMPLETION%:",                     "QB", "comp", true);
  block("QB INT% (lower=better, expect ICE<CHOKE in clutch):", "QB", "int", false);
  console.log("\\nREAD: DiD isolates the clutch effect (the within-moment skill confound");
  console.log("cancels). Targets: FG DiD ~+5pp, comp ~+3pp, INT ~-1pp.");
})();
`;

// DETERMINISM: both the engine (~142 unseeded Math.random/game) and this audit's
// own pool shuffle draw from Math.random, so an unseeded run samples different
// games AND a different player pool every time — the worst case for detecting a
// SMALL orthogonal signal (the ICE-vs-CHOKE clutch DiD, targets ~+5pp/+3pp/-1pp).
// Seeding (mulberry32, bundle eval scope only; shipped engine untouched) makes
// the run reproducible so the DiD is attributable, not noise. Default seed fixed;
// pass arg 3 to vary. The DiD still needs large GAMES (arg 2, default 4000) to
// resolve — seeding gives reproducibility, sample size gives the signal.
const SEED = (process.argv[3] != null ? Number(process.argv[3]) : 1337) >>> 0;
const seedPrelude = `
  (function () {
    var __a = ${SEED} >>> 0;
    Math.random = function () {
      __a |= 0; __a = (__a + 0x6D2B79F5) | 0;
      var t = Math.imul(__a ^ (__a >>> 15), 1 | __a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
`;
console.error("[_clutch_audit seed=" + SEED + ", deterministic — DiD still needs large GAMES (arg 2) to resolve]");
let bundle = seedPrelude + shim;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += audit;
new Function(bundle)();
