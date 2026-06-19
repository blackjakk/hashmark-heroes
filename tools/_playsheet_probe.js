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
    // Screen visuals are stamped isScreen (not concept). The HARD invariant is
    // ZERO downfield (concept-stamped) passes — a forced SCREEN must never route
    // to a normal dropback concept. The screens==throws count is relaxed: a
    // pressured screen can legitimately break into a throw-on-run (isScreen
    // false, no concept), so allow a few non-screen / non-downfield breakdowns.
    const res = runGame((c) => c.kind === "playcall" ? "SCREEN" : null);
    const throws = homePlays(res, ["complete", "incomplete"]).filter(p => p.passer);
    const screens = throws.filter(p => p.isScreen);
    const downfield = homePlays(res).filter(p => p.concept && p.concept !== "SCREEN");
    ok(throws.length >= 5 && downfield.length === 0 && screens.length >= throws.length - 3,
       "SCREEN call routes home passes through the screen branch — no downfield leaks ("
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

  // 6 — RUN_DRAW honored (call-only variant).
  {
    const res = runGame((c) => c.kind === "playcall" ? "RUN_DRAW" : null);
    const runs = homePlays(res, ["run"]).filter(p => !/kneel|spike/i.test(p.desc || ""));
    const off = runs.filter(p => (p.runType || "inside") !== "draw");
    ok(runs.length >= 8 && off.length === 0, "RUN_DRAW: every home run is a draw (" + runs.length + ")");
  }

  // 7 — READ_OPTION forces the QB option path (pitch read live).
  {
    const res = runGame((c) => c.kind === "playcall" ? "READ_OPTION" : null);
    const runs = homePlays(res, ["run"]).filter(p => !/kneel|spike/i.test(p.desc || ""));
    const opt = runs.filter(p => p.isSpeedOption);
    ok(runs.length >= 8 && opt.length === runs.length,
       "READ_OPTION: every home run is a speed option (" + opt.length + "/" + runs.length + ")");
    const pitched = opt.filter(p => p.isPitch);
    ok(pitched.length > 0 && pitched.length < opt.length,
       "option read produces BOTH keeps and pitches (" + pitched.length + " pitches)");
  }

  // 8 — Trick plays: REVERSE and FLEA_FLICKER forced.
  {
    const res = runGame((c) => c.kind === "playcall" ? "REVERSE" : null);
    const runs = homePlays(res, ["run"]).filter(p => !/kneel|spike/i.test(p.desc || ""));
    const rev = runs.filter(p => p.isReverse);
    ok(runs.length >= 5 && rev.length === runs.length,
       "REVERSE: every home run is a reverse (" + rev.length + "/" + runs.length + ")");
  }
  {
    const res = runGame((c) => c.kind === "playcall" ? "FLEA_FLICKER" : null);
    const throws = homePlays(res, ["complete", "incomplete"]).filter(p => p.passer && !p.isScreen);
    const ff = throws.filter(p => p.isFleaFlicker);
    // Not 100%: under pressure the QB can escape and throw on the run —
    // the trick broke down. ≥90% of dropbacks must execute the flicker.
    ok(throws.length >= 5 && ff.length >= throws.length * 0.9,
       "FLEA_FLICKER: home dropbacks execute the flicker (" + ff.length + "/" + throws.length + ")");
  }

  // 9 — HAIL_MARY: concept honored, depths are heaves, AI never rolls it.
  {
    const res = runGame((c) => c.kind === "playcall" ? "HAIL_MARY" : null);
    const passes = homePlays(res).filter(p => p.concept);
    const hm = passes.filter(p => p.concept === "HAIL_MARY");
    ok(passes.length >= 5 && hm.length === passes.length,
       "HAIL_MARY: every home pass concept is the heave (" + hm.length + "/" + passes.length + ")");
    const deep = passes.filter(p => (p.targetDepth ?? 0) >= 25);
    ok(deep.length >= passes.length * 0.8, "heave depths are deep (" + deep.length + "/" + passes.length + " ≥25yd)");
    const awayHM = res.plays.filter(p => p.poss === "away" && p.concept === "HAIL_MARY");
    ok(awayHM.length === 0, "the AI never rolls HAIL_MARY on its own (" + awayHM.length + ")");
  }

  // 10 — RPO: a coherent give/pull mix (inside gives + QUICK_GAME pulls).
  {
    const res = runGame((c) => c.kind === "playcall" ? "RPO" : null);
    const runs = homePlays(res, ["run"]).filter(p => !/kneel|spike/i.test(p.desc || ""));
    const passes = homePlays(res).filter(p => p.concept);
    const badRun = runs.filter(p => (p.runType || "inside") !== "inside" || p.isQBRun || p.isReverse);
    const badPass = passes.filter(p => p.concept !== "QUICK_GAME");
    ok(runs.length >= 3 && passes.length >= 3, "RPO produces both gives and pulls (" + runs.length + " gives, " + passes.length + " pulls)");
    ok(badRun.length === 0 && badPass.length === 0, "gives are inside zone, pulls are quick game");
  }

  // 11 — Defensive calls: RUN_COMMIT / PREVENT flow into the coverage tables.
  {
    const res = runGame((c) => c.kind === "defense" ? "RUN_COMMIT" : null);
    const awayPasses = res.plays.filter(p => p.poss === "away" && p.concept && p.coverage);
    const rc = awayPasses.filter(p => p.coverage === "RUN_COMMIT");
    ok(awayPasses.length >= 5 && rc.length === awayPasses.length,
       "RUN_COMMIT: every opposing dropback is read against the sold-out box (" + rc.length + "/" + awayPasses.length + ")");
  }
  {
    const res = runGame((c) => c.kind === "defense" ? "PREVENT" : null);
    const awayPasses = res.plays.filter(p => p.poss === "away" && p.concept && p.coverage);
    const pv = awayPasses.filter(p => p.coverage === "PREVENT");
    ok(awayPasses.length >= 5 && pv.length === awayPasses.length,
       "PREVENT: every opposing dropback is read against the umbrella (" + pv.length + "/" + awayPasses.length + ")");
  }

  // 12 — Special teams: callable onside, fake punt, fake FG.
  {
    const res = runGame((c) => c.kind === "kickoff" ? "onside" : null);
    const onsides = res.plays.filter(p => p.isOnside);
    ok(onsides.length >= 1, "ordered ONSIDE kicks happen (" + onsides.length + " attempts)");
  }
  {
    const res = runGame((c) => c.kind === "fourthDown" ? "fake_punt" : null);
    const fakes = res.plays.filter(p => p.isFakePunt);
    ok(fakes.length >= 1, "called FAKE PUNT runs the fake (" + fakes.length + ")");
  }
  {
    const res = runGame((c) => c.kind === "fourthDown"
      ? ((c.fgDist || 99) <= 68 ? "fake_fg" : "fake_punt") : null);
    const fakes = res.plays.filter(p => p.isFakeFG);
    ok(fakes.length >= 1, "called FAKE FG runs the fake (" + fakes.length + ")");
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
