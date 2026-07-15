// verify-artifact.js — standalone, trustless match verifier. The tool a
// CHALLENGER or auditor runs: given a match artifact (the public {seed, rosters,
// tape, math} + its claimed hashes), it INDEPENDENTLY re-sims and recomputes
// both settlement hashes, then prints PROVEN or MISMATCH. No server, no trust —
// just (seed+inputs)→deterministic result, exactly what an on-chain optimistic
// challenge re-runs off-chain to dispute a false result.
//
//   node server/verify-artifact.js <artifact-url | artifact.json | ->
//     e.g.  node server/verify-artifact.js http://host:8787/api/artifact/ID?token=T
//           node server/verify-artifact.js saved-artifact.json
//           curl -s .../api/artifact/ID?token=T | node server/verify-artifact.js -
//
//   exit 0 = PROVEN (both hashes match) · 1 = MISMATCH · 2 = load/sim error
//
// The artifact's `math` field says which transcendental mode reproduces the
// result bit-for-bit; the verifier re-sims in THAT mode (portable = the
// cross-machine bit-exact path), so any machine reaches the same hash.
"use strict";
const { loadEngine } = require("./engine-host.js");
const { resultHash } = require("./result-hash.js");
const { artifactInputsHash, verifySignatures } = require("./artifact.js");

// Core: returns a structured report; does not print or exit (so it's testable).
function verifyArtifact(art, opts = {}) {
  const out = {
    inputsOk: false, outcomeOk: false,
    math: art.math || "native",
    expectedInputs: art.hash || null, recomputedInputs: null,
    expectedOutcome: art.resultHash || null, recomputedOutcome: null,
    replay: null, error: null, signatures: null,
  };
  try {
    if (!art || !Array.isArray(art.tape) || !art.rosters) throw new Error("not an artifact (missing tape/rosters)");
    // 1. INPUTS hash — recompute over the canonical {seed,rosters,tape,...}.
    out.recomputedInputs = artifactInputsHash(art);
    out.inputsOk = !!art.hash && out.recomputedInputs === art.hash;

    // 2. Independent re-sim, in the artifact's DECLARED math mode.
    const eng = opts.eng || loadEngine();
    const clone = o => JSON.parse(JSON.stringify(o));
    const prevPortable = eng._isPortableMath ? eng._isPortableMath() : false;
    if (eng._setPortableMath) eng._setPortableMath(out.math === "portable");
    eng._setSimRng(art.seed);
    let replay;
    try {
      const home = eng.getTeam(art.homeTeamId), away = eng.getTeam(art.awayTeamId);
      if (!home || !away) throw new Error("unknown team id in artifact");
      const sim = new eng.GameSimulator(home, away, clone(art.rosters.home), clone(art.rosters.away));
      let di = 0;
      const coord = () => (di < art.tape.length ? art.tape[di++] : null);
      sim._coordinators = { home: coord, away: coord };
      replay = sim.simulate();
    } finally {
      eng._clearSimRng();
      if (eng._setPortableMath) eng._setPortableMath(prevPortable);
    }
    out.replay = { homeScore: replay.homeScore, awayScore: replay.awayScore, plays: replay.plays.length };

    // 3. OUTCOME hash — recompute the canonical result hash from the re-sim.
    out.recomputedOutcome = resultHash(replay);
    out.outcomeOk = !!art.resultHash && out.recomputedOutcome === art.resultHash;

    // 4. SIGNATURES — per-call attestation (when the artifact carries them).
    out.signatures = verifySignatures(art);
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
  }
  return out;
}

async function loadArtifact(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error("HTTP " + res.status + " fetching artifact");
    return res.json();
  }
  const fs = require("fs");
  return JSON.parse(fs.readFileSync(src === "-" ? 0 : src, "utf8"));   // 0 = stdin
}

function report(art, v) {
  const line = "─".repeat(60);
  const mk = ok => (ok ? "✓ MATCH" : "✗ MISMATCH");
  console.log("ARTIFACT VERIFICATION");
  console.log(`  match    : team ${art.homeTeamId} vs team ${art.awayTeamId}  ·  seed ${art.seed}  ·  ${Array.isArray(art.tape) ? art.tape.length : "?"} calls  ·  math ${v.math}`);
  if (v.error) { console.log(`  ✗ ERROR  : ${v.error}`); return; }
  console.log(line);
  console.log(`  INPUTS  hash (artifactHash):  ${mk(v.inputsOk)}`);
  console.log(`     expected   ${v.expectedInputs || "—"}`);
  console.log(`     recomputed ${v.recomputedInputs}`);
  console.log(`  re-sim  : ${v.replay.homeScore}-${v.replay.awayScore} / ${v.replay.plays} plays` +
    (art.result ? `   (artifact claims ${art.result.homeScore}-${art.result.awayScore} / ${art.result.plays})` : ""));
  console.log(`  OUTCOME hash (resultHash)  :  ${v.expectedOutcome ? mk(v.outcomeOk) : "— (none posted)"}`);
  console.log(`     expected   ${v.expectedOutcome || "—"}`);
  console.log(`     recomputed ${v.recomputedOutcome}`);
  if (v.signatures && v.signatures.present) {
    const sg = v.signatures;
    console.log(`  SIGNATURES (per-call)      :  ${sg.invalid ? "✗ " + sg.invalid + " INVALID at [" + sg.invalidAt.slice(0, 8).join(",") + "]" : "✓ " + sg.valid + " valid"}`);
    console.log(`     coverage   home ${sg.byHome} · away ${sg.byAway} · server ${sg.byServer} · unsigned ${sg.unsigned}`);
  } else {
    console.log(`  SIGNATURES (per-call)      :  — (none carried — pre-attestation artifact)`);
  }
  console.log(line);
  const proven = v.inputsOk && v.outcomeOk && !(v.signatures && v.signatures.invalid);
  console.log(`  VERDICT: ${proven ? "✓ PROVEN — re-sim reproduces both hashes" : "✗ MISMATCH — claimed result is NOT what the inputs re-sim to"}`);
}

if (require.main === module) {
  (async () => {
    const src = process.argv[2];
    if (!src) {
      console.error("usage: node server/verify-artifact.js <artifact-url | artifact.json | ->");
      process.exit(2);
    }
    let art;
    try { art = await loadArtifact(src); }
    catch (e) { console.error("✗ could not load artifact:", e.message); process.exit(2); }
    const v = verifyArtifact(art);
    report(art, v);
    process.exit(v.error ? 2 : (v.inputsOk && v.outcomeOk && !(v.signatures && v.signatures.invalid) ? 0 : 1));
  })();
}

module.exports = { verifyArtifact, verifySignatures, loadArtifact };
