// gen-hazard-probe.js — CROSS-MACHINE determinism hazards on the roster/draft
// GENERATION path (the sibling of determinism-hazard-probe.js, which audits
// the re-SIM path with fixed rosters).
//
// WHY: on-chain full-draft mode requires (seed+inputs)→byte-identical rosters
// on EVERY validator — the league publishes rostersHash from
// (leagueSeed, year) and clients/verifiers re-derive it. ECMAScript leaves
// Math.log/cos/pow/... precision implementation-defined, so a libm bit flip
// inside gen forks the derivation: a flipped stat curve or potential roll
// shifts the seeded RNG stream and every downstream player mutates. The gen
// path's transcendentals are therefore routed through the portable
// dispatchers (_olog/_ocos/_opow — see play-data.js); this probe measures
// that the routing is COMPLETE and the portable mode is sound.
//
//   node server/gen-hazard-probe.js [seeds...]        native census + hazards
//   PORTABLE=1 node server/gen-hazard-probe.js        the validator profile —
//                                                     gate: 0 libm calls, 0
//                                                     divergence, exit 1 on any
//
// Also measures NEUTRALITY (native gen hash == portable gen hash per seed):
// if neutral, a portable validator reproduces a native server's published
// rostersHash bit-for-bit and the mode can be enabled end-to-end with zero
// behavioral drift (the determinism-probe.js outcome-neutrality argument,
// applied to gen).
"use strict";
const crypto = require("crypto");
const { loadDraftKit } = require("./draft-host.js");

const FNS = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1",
  "log", "log2", "log10", "log1p", "pow", "cbrt", "hypot", "sinh", "cosh", "tanh"];
const seedsArg = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seeds = seedsArg.length ? seedsArg : [4182500125, 1337, 7, 42, 2024];
const YEAR = 2026;
const ULP_BUDGET = 4;
const PORTABLE = !!process.env.PORTABLE;

const kit = loadDraftKit();
if (PORTABLE) {
  if (!kit._setPortableMath) { console.error("kit lacks _setPortableMath"); process.exit(2); }
  kit._setPortableMath(true);
}

// key-sorted stringify → the FULL consensus object (every player field, not
// just pids — stats feed the sim, so a stats-only fork is still a fork).
function sortedStringify(x) {
  if (Array.isArray(x)) return "[" + x.map(sortedStringify).join(",") + "]";
  if (x && typeof x === "object") {
    return "{" + Object.keys(x).sort().map(k => JSON.stringify(k) + ":" + sortedStringify(x[k])).join(",") + "}";
  }
  return JSON.stringify(x);
}
const fullHash = (rosters) => crypto.createHash("sha256").update(sortedStringify(rosters)).digest("hex");
const pidHash = (rosters) => crypto.createHash("sha256").update(kit._fdRosterIds(rosters)).digest("hex");

// The two genesis derivations under audit: the default-league rosters
// (leagueSeed genesis) and the fantasy-draft pool (poolSeed genesis).
function genHashes(seed) {
  const L = kit._fdBuildDefaultLeague(seed >>> 0, YEAR).rosters;
  const P = kit._fdBuildPool(seed >>> 0, YEAR);
  return {
    leagueFull: fullHash(L), leaguePids: pidHash(L),
    pool: crypto.createHash("sha256").update(sortedStringify(P.pool)).digest("hex"),
  };
}

const ORIG = {}; for (const fn of FNS) ORIG[fn] = Math[fn];
const restore = () => { for (const fn of FNS) Math[fn] = ORIG[fn]; };
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

let failures = 0;
console.log(`GEN-PATH CROSS-MACHINE HAZARD PROBE  [math: ${PORTABLE ? "PORTABLE" : "native"}]\n`);

// ── 1. CENSUS ──
console.log(`1) CENSUS — libm calls during one default-league + one pool gen [seed ${seeds[0]}]:`);
const census = {}; for (const fn of FNS) census[fn] = 0;
for (const fn of FNS) Math[fn] = function (...args) { census[fn]++; return ORIG[fn].apply(Math, args); };
genHashes(seeds[0]);
restore();
const called = FNS.filter(fn => census[fn] > 0).sort((x, y) => census[y] - census[x]);
for (const fn of called) console.log(`   Math.${fn.padEnd(6)} ${String(census[fn]).padStart(7)} calls`);
if (!called.length) console.log("   (none — the gen path uses no unspecified-precision libm functions)");
if (PORTABLE && called.length) {
  console.log("   ✗ PORTABLE mode must not touch native libm on the gen path");
  failures++;
}

// ── 2. SENSITIVITY per function ──
console.log(`\n2) SENSITIVITY — each called fn perturbed ±${ULP_BUDGET} ULP; do the gen hashes move?`);
const base = {}; for (const s of seeds) base[s] = genHashes(s);
const hazards = [];
for (const fn of called) {
  const hit = [];
  for (const s of seeds) {
    patch(fn, ULP_BUDGET);
    const h = genHashes(s);
    restore();
    if (h.leagueFull !== base[s].leagueFull || h.pool !== base[s].pool) hit.push(s);
  }
  if (hit.length) hazards.push(fn);
  console.log(`   Math.${fn.padEnd(6)} ${hit.length ? "⚠ HAZARD" : "· safe   "}  ${hit.length ? "gen hash moved on seed(s) " + hit.join(",") : "no hash change"}`);
}

// ── 3. AGGREGATE LADDER ──
console.log(`\n3) AGGREGATE — ALL libm perturbed together, climbing ULP until a gen hash diverges:`);
const LADDER = [1, 4, 16, 256, 4096, 65536, 1048576, 16777216, 268435456,
  4294967296, 68719476736, 1099511627776];
let worst = Infinity;
for (const s of seeds) {
  let firstBreak = null;
  for (const k of LADDER) {
    for (const fn of FNS) patch(fn, k);
    const h = genHashes(s);
    restore();
    if (h.leagueFull !== base[s].leagueFull || h.pool !== base[s].pool) { firstBreak = k; break; }
  }
  if (firstBreak == null) {
    console.log(`   seed ${String(s).padStart(10)}: STABLE through ±${LADDER[LADDER.length - 1].toLocaleString()} ULP`);
  } else {
    worst = Math.min(worst, firstBreak);
    console.log(`   seed ${String(s).padStart(10)}: diverges at ±${firstBreak.toLocaleString()} ULP`);
    if (PORTABLE) failures++;   // portable mode must be immune — it calls no libm
  }
}

// ── 4. NEUTRALITY (native gen ≡ portable gen) ──
console.log(`\n4) NEUTRALITY — native vs portable gen hashes (can validators go portable with zero drift?):`);
let neutral = true;
for (const s of seeds) {
  kit._setPortableMath(false);
  const n = genHashes(s);
  kit._setPortableMath(true);
  const p = genHashes(s);
  kit._setPortableMath(PORTABLE);
  const same = n.leagueFull === p.leagueFull && n.pool === p.pool && n.leaguePids === p.leaguePids;
  if (!same) neutral = false;
  console.log(`   seed ${String(s).padStart(10)}: ${same ? "✓ identical (full roster + pids + pool)" : "✗ DIVERGED native↔portable"}`);
}

console.log(`\n${"─".repeat(64)}`);
console.log(` Gen-path libm calls: ${called.map(f => "Math." + f + "×" + census[f]).join(", ") || "none"}`);
console.log(` Per-fn hazards at ±${ULP_BUDGET} ULP: ${hazards.length ? hazards.map(f => "Math." + f).join(", ") : "none"}`);
console.log(` Aggregate margin: ${worst === Infinity ? "stable through the full ladder" : "first break at ±" + worst.toLocaleString() + " ULP"}`);
console.log(` Native↔portable neutrality: ${neutral ? "IDENTICAL for all tested seeds" : "DIVERGED — do not flip modes without re-publishing hashes"}`);
if (PORTABLE) {
  const ok = failures === 0;
  console.log(` PORTABLE GATE: ${ok ? "✓ PASS — 0 gen-path libm calls, immune to the full ULP ladder" : "✗ FAIL"}`);
  process.exit(ok ? 0 : 1);
}
process.exit(0);
