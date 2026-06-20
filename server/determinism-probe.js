// determinism-probe.js — proves the canonical RESULT hash (result-hash.js) is a
// sound settlement primitive. Engine-level (no HTTP server); fast; gate-able.
//
//   node server/determinism-probe.js [seeds...]   default seeds: 1337 7 42 2024
//   exit 0 = all checks pass · 1 = a failure
//
// It asserts the four properties a result hash needs to settle a match on-chain
// via challenge-by-re-sim:
//   1. STABLE      — same {seed, rosters, tape} re-sims to the SAME resultHash
//                    (full outcome, not just score+count). Across several seeds,
//                    twice each, so it isn't one seed's luck.
//   2. SENSITIVE   — different seeds give DIFFERENT resultHashes (the hash
//                    discriminates outcomes; a constant hash would "pass"
//                    determinism trivially yet prove nothing).
//   3. TAMPER-EVIDENT — a ONE-FIELD perturbation that PRESERVES the final score
//                    and play count (exactly what the old re-sim check compared)
//                    FLIPS the resultHash. This is the surface the canonical hash
//                    closes: score+count says "verified", resultHash says "no".
//   4. CANONICAL   — the canonical form strips cosmetic/derived fields
//                    (motion/statsSnap/desc) and keeps the outcome fields, and is
//                    independent of object key-construction order.
"use strict";
const path = require("path");
const { loadEngine } = require("./engine-host.js");
const { resultHash, canonicalResult, canonicalResultString, stableStringify } = require("./result-hash.js");

const SEEDS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seeds = SEEDS.length ? SEEDS : [1337, 7, 42, 2024];

const eng = loadEngine();
const clone = o => JSON.parse(JSON.stringify(o));
const h = eng.TEAMS[0], a = eng.TEAMS[1];
// Rosters are built ONCE and cloned per run — identical inputs every sim, so any
// hash difference is engine non-determinism, not roster-gen entropy.
const baseH = eng.buildRoster(h), baseA = eng.buildRoster(a);

function simAt(seed) {
  eng._setSimRng(seed >>> 0);
  try {
    const sim = new eng.GameSimulator(h, a, clone(baseH), clone(baseA));
    return sim.simulate();
  } finally { eng._clearSimRng(); }
}

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

console.log("RESULT-HASH determinism probe\n");

// 1. STABLE — same seed, twice, identical resultHash. Collect per-seed hashes.
const hashes = new Map();
for (const s of seeds) {
  const h1 = resultHash(simAt(s));
  const h2 = resultHash(simAt(s));
  check(`seed ${s}: resultHash stable across re-sim`, h1 === h2,
    h1 === h2 ? h1.slice(0, 16) + "…" : `${h1.slice(0, 12)} vs ${h2.slice(0, 12)}`);
  hashes.set(s, h1);
}

// 2. SENSITIVE — distinct seeds → distinct hashes.
const uniq = new Set(hashes.values());
check(`distinct seeds give distinct hashes`, uniq.size === hashes.size,
  `${uniq.size} unique of ${hashes.size} seeds`);

// 3. TAMPER-EVIDENT — the demonstration. Take a real result; perturb ONE play's
// gained yardage by 1 in a way that nets out (no score/length change), exactly
// the class the old score+count re-sim check waves through.
const base = simAt(seeds[0]);
const oldCheckVerifies = (orig, other) =>          // the OLD (weak) verification
  orig.homeScore === other.homeScore && orig.awayScore === other.awayScore
  && orig.plays.length === other.plays.length;
const tampered = clone(base);
// pick a play with structured yardage and bump endYard (a stat a cheat could
// pad — "I gained more yards" — without touching the final score).
const idx = tampered.plays.findIndex(p => typeof p.endYard === "number" && typeof p.startYard === "number");
tampered.plays[idx].endYard += 1;
check(`tamper preserves score+count (old check is fooled)`, oldCheckVerifies(base, tampered),
  `play[${idx}] endYard ${base.plays[idx].endYard}→${tampered.plays[idx].endYard}`);
check(`tamper FLIPS resultHash (canonical check catches it)`, resultHash(base) !== resultHash(tampered),
  `${resultHash(base).slice(0, 12)} vs ${resultHash(tampered).slice(0, 12)}`);

// A box-score stat tamper (pad a passing line) must also flip the hash, since
// result.stats is part of the canonical outcome.
const tampered2 = clone(base);
if (tampered2.stats && tampered2.stats.home) {
  const beforeStr = canonicalResultString(tampered2);
  // mutate a leaf number anywhere in the box score
  const bumpFirstNumber = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "number") { o[k] += 1; return true; }
      if (o[k] && typeof o[k] === "object" && bumpFirstNumber(o[k])) return true;
    }
    return false;
  };
  const didBump = bumpFirstNumber(tampered2.stats);
  check(`box-score tamper flips resultHash`, didBump && resultHash(base) !== resultHash(tampered2),
    didBump ? "bumped a stat leaf" : "no numeric stat leaf found");
  void beforeStr;
}

// 4. CANONICAL — strips cosmetic/derived, keeps outcome, order-independent.
const canon = canonicalResult(base);
const samplePlay = canon.plays.find(p => p) || {};
check(`canonical strips motion/statsSnap/desc`,
  canon.plays.every(p => !("motion" in p) && !("statsSnap" in p) && !("desc" in p)));
check(`canonical keeps the outcome fields`,
  "homeScore" in canon && "awayScore" in canon && "stats" in canon
  && "kind" in samplePlay && ("endYard" in samplePlay || "yardLine" in samplePlay));
// key-order independence: a shuffled-key deep copy hashes identically.
const shuffleKeys = (v) => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(shuffleKeys);
  const ks = Object.keys(v).sort().reverse();   // opposite order
  const o = {}; for (const k of ks) o[k] = shuffleKeys(v[k]); return o;
};
check(`canonical hash is key-order independent`,
  stableStringify(canon) === stableStringify(shuffleKeys(canon)));

console.log(`\n${fail ? "✗ " + fail + " FAILURE(S)" : "ALL-PASS"} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
