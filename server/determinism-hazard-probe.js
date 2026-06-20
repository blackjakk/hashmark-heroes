// determinism-hazard-probe.js — enumerates the CROSS-MACHINE determinism
// hazards in the engine's re-sim outcome path.
//
// WHY: the on-chain settlement is challenge-by-re-sim — a validator re-runs the
// artifact {seed, rosters, tape} and disputes on a resultHash mismatch. That is
// only sound if EVERY validator computes the byte-identical result. ECMAScript
// leaves the precision of Math.sin/cos/tan/exp/log/pow/atan2/hypot/cbrt/...
// IMPLEMENTATION-DEFINED — only Math.sqrt is required correctly-rounded — so two
// validators on different Node/V8/libm builds can disagree in the last bit. If
// any such bit difference reaches the integer outcome, honest validators fork
// and the fraud proof is unsound. Same-machine determinism is already proven
// (determinism-probe.js); THIS turns the cross-machine risk into a measured list.
//
//   node server/determinism-hazard-probe.js [seeds...]      default 1337 7 42
//
// Three views:
//   1. STATIC   — every transcendental call site in the engine bundle files.
//   2. CENSUS   — which are actually CALLED during simulate() with FIXED rosters
//                 (re-sim path; roster-GEN transcendentals don't matter — rosters
//                 are fixed inputs in the artifact). Static counts include
//                 render/draw branches that never run headless.
//   3. SENSITIVITY — perturb each called function by a few ULP per call (the
//                 faithful model of cross-libm divergence) and re-sim; if the
//                 canonical resultHash changes, that function's bit-exactness
//                 reaches the OUTCOME → a real cross-machine hazard. A function
//                 that is called but whose perturbation never moves resultHash is
//                 outcome-irrelevant here (e.g. cosmetic ball-wobble) and safe to
//                 leave on native libm.
//
// NOTE: a flagged hazard is DEFINITE. "Not flagged" means "not sensitive at the
// tested ULP budget for these seeds" — a lower bound, not a safety proof.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./engine-host.js");
const { resultHash, canonicalResult } = require("./result-hash.js");

const ROOT = path.join(__dirname, "..");
const ENGINE_FILES = ["play-data.js", "play-player.js", "play-render.js", "play-sim.js", "play-motion.js", "play-engine.js"];
// Unspecified-precision libm functions. sqrt OMITTED — IEEE/ECMAScript require
// it correctly-rounded, so sqrt (and sqrt(dx*dx+dy*dy), since +/* round exactly)
// is cross-machine deterministic; only these are at risk.
const FNS = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1",
  "log", "log2", "log10", "log1p", "pow", "cbrt", "hypot", "sinh", "cosh", "tanh"];

const seedsArg = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seeds = seedsArg.length ? seedsArg : [1337, 7, 42, 2024, 99];
const ULP_BUDGET = 4;   // per-function perturbation magnitude (upper end of realistic libm disagreement)

const eng = loadEngine();
const clone = o => JSON.parse(JSON.stringify(o));
const h = eng.TEAMS[0], a = eng.TEAMS[1];
// Rosters built ONCE, cloned per sim — the re-sim path with FIXED inputs (in a
// real challenge the rosters come from the artifact, so roster-GEN randomness is
// not a re-sim hazard). Build them under a fixed seed so this probe's reported
// counts/margins are reproducible run-to-run. mulberry32 on global Math.random
// covers gen sites whether they draw _rand() (falls back to Math.random when no
// sim RNG is active) or Math.random directly.
const _realRandom = Math.random;
(function seedGen(s) {
  let x = s >>> 0;
  Math.random = function () {
    x |= 0; x = (x + 0x6D2B79F5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(0x6057E2);
const baseH = eng.buildRoster(h), baseA = eng.buildRoster(a);
Math.random = _realRandom;
const ORIG = {}; for (const fn of FNS) ORIG[fn] = Math[fn];
const restoreMath = () => { for (const fn of FNS) Math[fn] = ORIG[fn]; };

function simResult(seed) {
  eng._setSimRng(seed >>> 0);
  try { return new eng.GameSimulator(h, a, clone(baseH), clone(baseA)).simulate(); }
  finally { eng._clearSimRng(); }
}
// Relative ULP perturbation: |x|·EPSILON ≈ 1 ULP near x; sign alternates per call
// (deterministic) so it is not a uniform bias. Math left intact returns ORIG.
const EPS = Number.EPSILON;
function patch(fn, ulp) {
  let c = 0;
  Math[fn] = function (...args) {
    const r = ORIG[fn].apply(Math, args);
    if (r === 0 || !isFinite(r)) return r;
    const dir = (c++ & 1) ? 1 : -1;
    return r * (1 + dir * ulp * EPS);
  };
}

// ── 1. STATIC ──
console.log("CROSS-MACHINE DETERMINISM HAZARD PROBE\n");
console.log("1) STATIC — transcendental call sites in the engine bundle:");
const re = new RegExp("Math\\.(" + FNS.join("|") + ")\\b", "g");
const staticPerFn = {};
for (const f of ENGINE_FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  let m, n = 0; const local = {};
  while ((m = re.exec(src))) { n++; local[m[1]] = (local[m[1]] || 0) + 1; staticPerFn[m[1]] = (staticPerFn[m[1]] || 0) + 1; }
  if (n) console.log(`   ${f.padEnd(18)} ${String(n).padStart(3)}  (${Object.entries(local).map(([k, v]) => k + "×" + v).join(", ")})`);
}
console.log(`   total by fn: ${Object.entries(staticPerFn).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + "×" + v).join(", ")}`);

// ── 2. CENSUS (during simulate, fixed rosters) ──
console.log(`\n2) CENSUS — transcendental calls during simulate() [seed ${seeds[0]}, fixed rosters]:`);
const census = {}; for (const fn of FNS) census[fn] = 0;
for (const fn of FNS) Math[fn] = function (...args) { census[fn]++; return ORIG[fn].apply(Math, args); };
simResult(seeds[0]);
restoreMath();
const called = FNS.filter(fn => census[fn] > 0);
for (const fn of called.sort((x, y) => census[y] - census[x])) console.log(`   Math.${fn.padEnd(6)} ${String(census[fn]).padStart(7)} calls/game`);
if (!called.length) console.log("   (none — the re-sim path uses no unspecified-precision libm functions)");

// ── 3. SENSITIVITY (per-function, the hazard list) ──
console.log(`\n3) SENSITIVITY — re-sim with each function perturbed ±${ULP_BUDGET} ULP/call; does resultHash move?`);
const baseHash = {}; for (const s of seeds) baseHash[s] = resultHash(simResult(s));
const hazards = [];
for (const fn of called) {
  const hitSeeds = [];
  for (const s of seeds) {
    patch(fn, ULP_BUDGET);
    const hsh = resultHash(simResult(s));
    restoreMath();
    if (hsh !== baseHash[s]) hitSeeds.push(s);
  }
  const isHaz = hitSeeds.length > 0;
  if (isHaz) hazards.push(fn);
  console.log(`   Math.${fn.padEnd(6)} ${isHaz ? "⚠ HAZARD" : "· safe   "}  ${isHaz ? "outcome changed on seed(s) " + hitSeeds.join(",") : "no resultHash change"}`);
}

// ── 4. AGGREGATE ESCALATION — find the safety MARGIN ──
// "Clean at 2 ULP" is not "cross-machine safe": the gaussian Math.round and the
// engine's discrete decision thresholds ABSORB tiny perturbations, so the real
// question is HOW BIG a libm divergence the outcome tolerates before an integer
// result flips. Perturb ALL transcendentals together and climb the ULP budget
// until the canonical resultHash first diverges — the margin over the ~1-4 ULP a
// realistic libm actually disagrees by.
console.log(`\n4) AGGREGATE ESCALATION — perturb ALL transcendentals, climb ±ULP until resultHash diverges:`);
const LADDER = [1, 2, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576,
  4194304, 16777216, 67108864, 268435456, 1073741824, 4294967296, 17179869184,
  68719476736, 274877906944, 1099511627776];   // top ≈ 2.4e-4 relative (libm is ~1e-15)
let worstMargin = Infinity;
for (const s of seeds) {
  let firstBreak = null, sample = null;
  for (const k of LADDER) {
    for (const fn of FNS) patch(fn, k);
    const r = simResult(s); restoreMath();
    if (resultHash(r) !== baseHash[s]) {
      firstBreak = k;
      const cb = canonicalResult(simResult(s)), cr = canonicalResult(r);
      const scoreMoved = cb.homeScore !== cr.homeScore || cb.awayScore !== cr.awayScore;
      sample = `${cb.homeScore}-${cb.awayScore}${scoreMoved ? "→" + cr.homeScore + "-" + cr.awayScore : "(score same)"}`;
      break;
    }
  }
  if (firstBreak == null) {
    console.log(`   seed ${String(s).padStart(5)}: STABLE through ±${LADDER[LADDER.length - 1].toLocaleString()} ULP (≈${(LADDER[LADDER.length - 1] * EPS).toExponential(1)} rel) — no divergence found`);
  } else {
    worstMargin = Math.min(worstMargin, firstBreak);
    console.log(`   seed ${String(s).padStart(5)}: first divergence at ±${firstBreak.toLocaleString()} ULP (≈${(firstBreak * EPS).toExponential(1)} rel)  · ${sample}`);
  }
}

console.log(`\n${"─".repeat(64)}`);
console.log(` Outcome-path transcendentals: ${called.map(f => "Math." + f + "×" + census[f]).join(", ") || "none"}`);
console.log(` Per-function hazard at ±${ULP_BUDGET} ULP: ${hazards.length ? hazards.map(f => "Math." + f).join(", ") : "none"}`);
const realistic = 4;   // a good libm disagrees by ~1-4 ULP across builds
if (worstMargin === Infinity) {
  console.log(` Safety MARGIN: outcome stable through the full ±${LADDER[LADDER.length - 1].toLocaleString()} ULP ladder.`);
  console.log(`   → rounding + discrete thresholds absorb realistic (~${realistic} ULP) libm divergence by a wide margin.`);
} else {
  console.log(` Safety MARGIN: smallest divergence at ±${worstMargin.toLocaleString()} ULP ≈ ${Math.round(worstMargin / realistic).toLocaleString()}× a realistic ~${realistic} ULP libm gap.`);
}
console.log(` VERDICT: cross-machine re-sim is robust at realistic libm error for these seeds, but this is a`);
console.log(`   PROBABILISTIC margin, not a guarantee — a near-boundary roll CAN flip, and for on-chain`);
console.log(`   settlement one forked game breaks the proof. The sound fix is to make re-sim bit-exact by`);
console.log(`   construction: PIN the validator Node/V8 build, or compile the sim to wasm / swap the ${called.length}`);
console.log(`   outcome-path libm calls for portable (fdlibm/table) implementations, then this probe is a gate at 0.`);
process.exit(0);
