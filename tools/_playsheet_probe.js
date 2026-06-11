// _playsheet_probe.js — headless engine detector for the interactive play
// sheet (named offensive calls). Asserts, under a seeded RNG:
//   1. GATE SAFETY — a coordinator that always defers (null) produces a
//      byte-identical game to no coordinator at all (every forced-call seam
//      overrides ROLL RESULTS only; the draws still run).
//   2. Named PASS concepts are honored: "VERTICAL" → every offensive pass
//      visual carries concept VERTICAL, no accidental screens/PA.
//   3. "PA_SHOT" forces play action; "SCREEN" forces the screen branch.
//   4. Named RUN variants are honored: "RUN_TOSS" → every offensive
//      designed-run visual is runType "pitch"; reverses/QB keepers are
//      suppressed when a run is called.
//   5. Generic "run"/"pass" and foreign strings still behave (foreign =
//      defer; the seam validates).
//
//   node tools/_playsheet_probe.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const files = ["play-data.js", "play-player.js", "play-render.js", "play-sim.js", "play-motion.js", "play-engine.js"];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "//x").replace(/^setupPreview\([^)]*\);\s*$/gm, "//x");
}
const shim = `var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>Date.now()};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;

const probe = `;(function(){
  if (typeof GameSimulator === "undefined") { console.error("no GameSimulator"); process.exit(1); }
  let pass = 0, fail = 0;
  const ok = (c, l) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ FAIL " + l); } };

  const SEED = 1337;
  function runGame(coordFn) {
    _setSimRng(SEED);
    const ros1 = genRoster(getPlaybook(TEAMS[0]), {}, null);
    const ros2 = genRoster(getPlaybook(TEAMS[1]), {}, null);
    const sim = new GameSimulator(TEAMS[0], TEAMS[1], ros1, ros2);
    if (coordFn) sim._coordinators = { home: coordFn };
    const res = sim.simulate();
    _clearSimRng();
    return res;
  }
  const fingerprint = (res) => JSON.stringify({
    h: res.homeScore, a: res.awayScore, n: res.plays.length,
    p: res.plays.map(p => [p.kind, p.yards ?? 0, p.startYard ?? 0]),
  });

  // 1 — gate safety: defer-always === no coordinator, byte-identical.
  const base  = fingerprint(runGame(null));
  const defer = fingerprint(runGame(() => null));
  ok(base === defer, "defer-always coordinator is byte-identical to no coordinator");
  // ...and a foreign string is treated as a defer at the seam.
  const foreign = fingerprint(runGame((c) => c.kind === "playcall" ? "WISHBONE_LEFT" : null));
  ok(base === foreign, "foreign call string = defer (seam validates)");

  // Helper: offensive (home-possession) visuals of a coordinated game.
  const homePlays = (res, kinds) => res.plays.filter(p => p.poss === "home" && (!kinds || kinds.includes(p.kind)));

  // 2 — VERTICAL: every home pass visual carries the called concept.
  {
    const res = runGame((c) => c.kind === "playcall" ? "VERTICAL" : null);
    const passes = homePlays(res).filter(p => p.concept);
    const offConcept = passes.filter(p => p.concept !== "VERTICAL");
    ok(passes.length >= 5, "VERTICAL game produced " + passes.length + " concept-stamped home passes");
    ok(offConcept.length === 0, "every home pass concept is VERTICAL"
       + (offConcept.length ? " (saw: " + [...new Set(offConcept.map(p => p.concept))].join(",") + ")" : ""));
    const pa = homePlays(res).filter(p => p.isPlayAction);
    ok(pa.length === 0, "no accidental play action under a non-PA call (" + pa.length + ")");
  }

  // 3 — PA_SHOT forces the fake; SCREEN forces the screen branch.
  {
    const res = runGame((c) => c.kind === "playcall" ? "PA_SHOT" : null);
    const passes = homePlays(res).filter(p => p.concept);
    const paShare = passes.length ? passes.filter(p => p.concept === "PA_SHOT").length / passes.length : 0;
    ok(paShare === 1, "PA_SHOT honored on all " + passes.length + " home passes (share=" + paShare.toFixed(2) + ")");
    const paFlag = homePlays(res, ["complete", "incomplete"]).filter(p => p.isPlayAction);
    ok(paFlag.length > 0, "isPlayAction flag set on PA_SHOT throws (" + paFlag.length + ")");
  }
  {
    // Screen visuals are stamped isScreen (not concept) — every home throw
    // must be one, and zero downfield (concept-stamped) passes may exist.
    const res = runGame((c) => c.kind === "playcall" ? "SCREEN" : null);
    const throws = homePlays(res, ["complete", "incomplete"]).filter(p => p.passer);
    const screens = throws.filter(p => p.isScreen);
    const downfield = homePlays(res).filter(p => p.concept && p.concept !== "SCREEN");
    ok(throws.length >= 5 && screens.length === throws.length && downfield.length === 0,
       "SCREEN call routes every home pass through the screen branch ("
       + screens.length + "/" + throws.length + " screens, " + downfield.length + " downfield)");
  }

  // 4 — RUN_TOSS: every home designed run is a pitch; specials suppressed.
  {
    const res = runGame((c) => c.kind === "playcall" ? "RUN_TOSS" : null);
    const runs = homePlays(res, ["run"]).filter(p => !/kneel|spike/i.test(p.desc || ""));
    const offType = runs.filter(p => (p.runType || "inside") !== "pitch");
    ok(runs.length >= 8, "RUN_TOSS game produced " + runs.length + " home designed runs");
    ok(offType.length === 0, "every home run is runType pitch"
       + (offType.length ? " (saw: " + [...new Set(offType.map(p => p.runType + (p.isQBRun ? "/qb" : "") + (p.isReverse ? "/rev" : "")))].join(",") + ")" : ""));
    const specials = runs.filter(p => p.isQBRun || p.isReverse);
    ok(specials.length === 0, "no QB keepers / reverses under a called run (" + specials.length + ")");
  }

  // 5 — generic calls still work: "run" forces run plays, OC picks scheme.
  {
    const res = runGame((c) => c.kind === "playcall" ? "run" : null);
    const passes = homePlays(res).filter(p => p.concept);
    ok(passes.length === 0, "generic 'run' call produces zero home dropbacks (" + passes.length + ")");
    const runs = homePlays(res, ["run"]);
    const variety = new Set(runs.map(p => p.runType || "inside"));
    ok(runs.length >= 10 && variety.size >= 2,
       "OC still varies the scheme on generic runs (" + [...variety].join(",") + ")");
  }

  console.log(fail === 0 ? "ALL-PASS (" + pass + " checks)" : fail + " FAILURES");
  process.exit(fail ? 1 : 0);
})();`;

let code = shim;
for (const f of files) code += "\n" + stripUiInit(fs.readFileSync(path.join(ROOT, f), "utf8"), f);
code += probe;
eval(code);
