// result-hash.js — canonical game-RESULT hash (the settlement primitive).
//
// The match artifact hash (h2h-server.js: artifactHash) covers the INPUTS
// {seed, rosters, tape}. For an optimistic-challenge settlement you also need a
// canonical hash of the OUTCOME: the runner posts (artifactHash, resultHash);
// a challenger re-sims the inputs, recomputes resultHash, and disputes on a
// mismatch. Without it, verification can only compare a weak summary (final
// score + play count) — which a cheater can preserve while perturbing the
// play-by-play or a box-score stat line. This closes that surface.
//
// WHAT IT HASHES — the outcome, not the presentation:
//   • final score + winner + the realized weather
//   • the final box score (result.stats)
//   • every play's OUTCOME fields
// WHAT IT STRIPS (cosmetic / derived / redundant — including these would tie
// the settlement hash to things that can change without the outcome changing,
// causing FALSE challenges, while adding zero integrity because they are pure
// functions of the fields already hashed):
//   • motion     — animation tracks (huge; route-building is RNG-free so it is
//                  deterministic, but it is presentation, not outcome)
//   • statsSnap  — per-play CUMULATIVE box score (the final one == result.stats)
//   • desc       — human-readable narration generated FROM the structured fields
//   • any _-prefixed internal scratch field
//
// Keys are sorted RECURSIVELY so the hash is a function of the DATA, not of
// object-construction order — a future refactor that reorders how a play object
// is built must not change the settlement hash. Arrays keep their order (play
// order is itself part of the outcome).
//
// Determinism is PROVEN, not assumed: server/determinism-probe.js re-sims a
// seeded game twice and asserts identical resultHash, asserts two different
// seeds differ, and asserts a one-field perturbation flips the hash (the exact
// tamper the old score+count check would miss).
//
// Pure + CommonJS + zero deps beyond node:crypto. The canonical SERIALIZER is
// crypto-free so a browser client can reuse it (hash via SubtleCrypto there).
"use strict";

// Per-play fields stripped before hashing (see header).
const PLAY_STRIP = new Set(["motion", "statsSnap", "desc"]);

// Recursive stable serialize: object keys sorted, arrays preserved, _-prefixed
// keys dropped. Produces a canonical string independent of construction order.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).filter(k => k[0] !== "_").sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// The canonical OUTCOME object for a finished GameSimulator result.
function canonicalResult(result) {
  if (!result || !Array.isArray(result.plays)) {
    throw new Error("canonicalResult: expected a finished sim result with .plays");
  }
  const w = result.weather || null;
  return {
    v: 1,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    winner: result.winner ?? null,
    weather: w ? { label: w.label, windDir: w.windDir, windStrength: w.windStrength } : null,
    stats: result.stats ?? null,            // final box score (per-team + per-player lines)
    plays: result.plays.map(stripPlay),
  };
}

function stripPlay(p) {
  const out = {};
  for (const k of Object.keys(p)) {
    if (k[0] === "_" || PLAY_STRIP.has(k)) continue;
    out[k] = p[k];
  }
  return out;
}

// Canonical string + SHA-256 hex of a result.
function canonicalResultString(result) { return stableStringify(canonicalResult(result)); }
function resultHash(result) {
  return require("crypto").createHash("sha256").update(canonicalResultString(result)).digest("hex");
}

module.exports = { canonicalResult, canonicalResultString, resultHash, stableStringify };
