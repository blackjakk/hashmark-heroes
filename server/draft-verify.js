#!/usr/bin/env node
// draft-verify.js — the fantasy-draft re-derivation referee (FANTASY_DRAFT_
// DESIGN.md S3). Given a PUBLIC draft artifact, independently re-derives all
// 32 rosters via server/draft-host.js (the same generator + draft core the
// browser and league server run) and prints the canonical hashes that
// DraftSettlement adjudicates:
//
//   artifactHash = sha256({poolSeed, year, draftRounds, order, tape[[teamId,pid,auto]]})
//   resultHash   = sha256(order.map(t => [t, rosterPids(t)]))
//
// This is the tool the DraftSettlement `resolver` runs on a dispute, and the
// tool anyone runs to audit a league before ingestion.
//
// Usage:
//   node server/draft-verify.js <artifact.json>            print both hashes
//     [--seed 0x<bytes32>]      also assert poolSeed === uint32(seed) (the
//                               on-chain derivation contract)
//     [--expect-artifact 0xH]   exit 1 unless artifactHash matches
//     [--expect-result 0xH]     exit 1 unless resultHash matches
//
// Accepts either the raw artifact shape or a league-server
// GET /api/league/draft/:id response ({poolSeed, year, rounds|draftRounds,
// order, tape}). Exit codes: 0 verified/printed · 1 mismatch · 2 bad input.

"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { loadDraftKit } = require("./draft-host.js");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node server/draft-verify.js <artifact.json> [--seed 0x…] [--expect-artifact 0x…] [--expect-result 0x…]");
  process.exit(2);
}

let a;
try { a = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.error("draft-verify: cannot read artifact —", e.message); process.exit(2); }

const poolSeed = Number(a.poolSeed);
const year = Number(a.year);
const rounds = Number(a.draftRounds != null ? a.draftRounds : a.rounds);
const order = a.order;
const tape = a.tape;
if (!Number.isFinite(poolSeed) || !Number.isFinite(year) || !Number.isFinite(rounds)
    || !Array.isArray(order) || !Array.isArray(tape)) {
  console.error("draft-verify: artifact must carry poolSeed, year, draftRounds|rounds, order[], tape[]");
  process.exit(2);
}

// On-chain seed derivation check: poolSeed MUST equal uint32(uint256(seed)).
const seedHex = arg("--seed");
if (seedHex) {
  const clean = seedHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) { console.error("draft-verify: --seed must be a bytes32 hex"); process.exit(2); }
  const derived = Number(BigInt("0x" + clean) & 0xFFFFFFFFn);
  if (derived !== poolSeed) {
    console.error(`draft-verify: SEED MISMATCH — uint32(seed) = ${derived}, artifact poolSeed = ${poolSeed}`);
    process.exit(1);
  }
  console.log(`seed check      ✓ poolSeed ${poolSeed} == uint32(0x${clean.slice(0, 12)}…)`);
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Canonical forms — MUST stay byte-identical to server/league-server.js
// finalizeDraft (and the client's verification in play-league-client.js).
const artifactCanonical = JSON.stringify({
  poolSeed, year, draftRounds: rounds, order,
  tape: tape.map(e => [e.teamId, e.pid, e.auto ? 1 : 0]),
});
const artifactHash = sha(artifactCanonical);

const kit = loadDraftKit();
const built = kit._fdBuildPool(poolSeed, year);
built.order = order;
const st = kit._fdApplyTape(built, tape);
const resultHash = sha(JSON.stringify(order.map(t => [t, st.rosters[t].map(p => p.pid)])));

console.log(`picks           ${tape.length} (${order.length} teams × ${kit.FD_PICKS_PER_TEAM} = ${order.length * kit.FD_PICKS_PER_TEAM})`);
console.log(`artifactHash    ${artifactHash}`);
console.log(`resultHash      ${resultHash}`);

let bad = false;
for (const [flag, mine, label] of [["--expect-artifact", artifactHash, "artifactHash"], ["--expect-result", resultHash, "resultHash"]]) {
  const want = arg(flag);
  if (!want) continue;
  const clean = want.replace(/^0x/, "").toLowerCase();
  if (clean === mine) console.log(`${label.padEnd(15)} ✓ matches expectation`);
  else { console.error(`${label.padEnd(15)} ✗ MISMATCH — expected ${clean.slice(0, 16)}…, derived ${mine.slice(0, 16)}…`); bad = true; }
}
process.exit(bad ? 1 : 0);
