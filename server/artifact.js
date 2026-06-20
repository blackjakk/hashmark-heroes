// artifact.js — the canonical match-INPUTS artifact + its SHA-256 hash. Single
// source of truth shared by the server (h2h-server.js), the probe (h2h-probe.js)
// and the standalone verifier (verify-artifact.js) so the inputs hash can never
// drift between producer and verifier.
//
// `hash` (this) binds the INPUTS {seed, rosters, tape, ...}; `resultHash`
// (result-hash.js) binds the OUTCOME. Together they are the settlement pair a
// ProofSettlement runner posts and a challenger disputes. `math` declares which
// transcendental mode reproduces the result bit-for-bit (see GC_PORTABLE_MATH).
"use strict";
const crypto = require("crypto");

// Canonical inputs object — FIXED key order (the hash is order-sensitive). v2
// added `math`. Accepts a match `m` or a served artifact (same field names).
function artifactInputs(a) {
  return {
    v: 2,
    seed: a.seed,
    homeTeamId: a.homeTeamId,
    awayTeamId: a.awayTeamId,
    settings: a.settings,
    math: a.math,
    rosters: a.rosters,
    tape: a.tape,
  };
}

function artifactInputsHash(a) {
  return crypto.createHash("sha256").update(JSON.stringify(artifactInputs(a))).digest("hex");
}

module.exports = { artifactInputs, artifactInputsHash };
