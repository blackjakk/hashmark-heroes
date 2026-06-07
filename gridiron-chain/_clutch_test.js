// Headless verification for the clutch factor (Phase 1 + 2). Reuses the
// _sim_audit.js bootstrap to load the real engine and exercise the WIRED
// _clutchMod method + attribute generation. Dev tool — ignored by the build.
const fs = require("fs");
const path = require("path");

const files = ["play-data.js", "play-player.js", "play-render.js", "play-sim.js", "play-motion.js", "play-engine.js"];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [test] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [test] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "style" || k === "classList" || k === "dataset") return _stub;
                if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
  });
  var document = { createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [], addEventListener: () => {},
    body: _stub, documentElement: _stub };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = () => 0;
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

const test = `
;(function(){
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  \\u2713 " + name + (extra ? "  ("+extra+")" : "")); }
                                      else { fail++; console.log("  \\u2717 FAIL " + name + (extra ? "  \\u2014 " + extra : "")); } };
  const approx = (a, b, eps=1e-9) => Math.abs(a - b) <= eps;

  // ---- A. _clutchMod: moment gate / sign / magnitude / playoff amp ----
  console.log("A. _clutchMod (the wired engine method):");
  const fn = GameSimulator.prototype._clutchMod;
  const ctx = (q, t, diff, playoff, clutch) => Object.assign(Object.create(GameSimulator.prototype), {
    quarter: q, time: t, score: { home: diff, away: 0 }, isPlayoff: playoff,
    _playerByName: new Map([["P", { _clutch: clutch }]]),
  });
  ok("ice (99) in late+close = +scale*0.98", approx(fn.call(ctx(4,120,3,false,99), "P", 0.06), ((99-50)/50)*0.06));
  ok("choke (1) in late+close is negative",  fn.call(ctx(4,120,3,false,1),  "P", 0.06) < 0);
  ok("neutral (50) = exactly 0",             fn.call(ctx(4,120,3,false,50), "P", 0.06) === 0);
  ok("Q1 = 0 (not late)",                    fn.call(ctx(1,120,3,false,99), "P", 0.06) === 0);
  ok("two-score (diff 20) = 0 (not close)",  fn.call(ctx(4,120,20,false,99),"P", 0.06) === 0);
  ok("time > 300 = 0 (not late enough)",     fn.call(ctx(4,400,3,false,99), "P", 0.06) === 0);
  ok("OT (Q5) counts as late",               fn.call(ctx(5,120,3,false,99), "P", 0.06) > 0);
  ok("playoff amplifies exactly 1.5x",       approx(fn.call(ctx(4,120,3,true,99),"P",0.06), fn.call(ctx(4,120,3,false,99),"P",0.06)*1.5));
  ok("unknown player = 0 (defaults neutral)",fn.call(Object.assign(Object.create(GameSimulator.prototype),{quarter:4,time:120,score:{home:3,away:0},isPlayoff:false,_playerByName:new Map()}), "P", 0.06) === 0);
  ok("ice kicker accuracy swing ~ +5.9pp",   approx(fn.call(ctx(4,120,3,false,99),"P",0.06), 0.0588, 1e-3), "+"+(fn.call(ctx(4,120,3,false,99),"P",0.06)*100).toFixed(1)+"pp");

  // ---- B. attribute generation on real rosters ----
  console.log("B. _clutch generation:");
  const buildRoster = (team) => genRoster(getPlaybook(team), {}, null);
  let all = [], kClutch = [];
  for (let i = 0; i < 96; i++) {
    for (const p of buildRoster(TEAMS[i % TEAMS.length])) {
      if (typeof p._clutch === "number") all.push(p._clutch);
      if (p.position === "K" && p.archetype === "CLUTCH") kClutch.push(p._clutch);
    }
  }
  const mean = all.reduce((s,v)=>s+v,0) / all.length;
  ok("_clutch assigned to every player, in [1,99]", all.length > 200 && all.every(v => v>=1 && v<=99), "n="+all.length);
  ok("mean slightly below 50 (choke-skew)", mean > 44 && mean < 50, "mean="+mean.toFixed(1));
  ok("CLUTCH-archetype kickers generate high (>=72)", kClutch.every(v => v >= 72), "kickers="+JSON.stringify(kClutch));

  // ---- C. real GameSimulator instance reads a real player's _clutch ----
  console.log("C. live instance integration:");
  const sim = new GameSimulator(TEAMS[0], TEAMS[1], buildRoster(TEAMS[0]), buildRoster(TEAMS[1]));
  const pbn = sim._playerByName;
  ok("instance built _playerByName", pbn && pbn.size > 0, "size="+(pbn ? pbn.size : 0));
  if (pbn && pbn.size > 0) {
    const name = [...pbn.keys()][0], p = pbn.get(name);
    sim.quarter = 4; sim.time = 120; sim.score = { home: 0, away: 3 };
    p._clutch = 99; const hi = sim._clutchMod(name, 0.06);
    p._clutch = 1;  const lo = sim._clutchMod(name, 0.06);
    ok("ice > choke through the live instance", hi > 0 && lo < 0 && hi > lo, "hi=+"+(hi*100).toFixed(1)+"pp lo="+(lo*100).toFixed(1)+"pp");
  }

  console.log("\\n" + (fail === 0 ? "\\u2705 ALL " + pass + " CHECKS PASS" : "\\u274c " + fail + " FAILED (" + pass + " passed)"));
  if (typeof process !== "undefined") process.exit(fail === 0 ? 0 : 1);
})();
`;

let bundle = shim;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += test;
new Function(bundle)();
