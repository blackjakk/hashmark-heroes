# H2H match server — running & deploying

The authoritative server for live head-to-head matches. Plain Node, **zero
npm dependencies**, no build step. Design record:
`INGAME_CLOCK_AND_MULTIPLAYER.md` §C.3.

## Local

```bash
node server/h2h-server.js            # API on :8787
node server/h2h-server.js 9000       # custom port
```

The game client (served separately, e.g. `npx http-server -p 5173`) points
at the server via the "match server" field (dev panel or the 🌐 footer
modal). The share link carries the server address to the joiner.

## Single-process deployment (recommended)

```bash
H2H_STATIC=1 node server/h2h-server.js 8787
# or: node server/h2h-server.js 8787 --static
```

`H2H_STATIC` also serves the game files from the repo root on the same
origin — one process, one port. The client detects this via
`/api/health` and defaults its server field to `location.origin`, and the
share links just work.

## A real box (VPS + TLS)

The server itself stays plain HTTP; terminate TLS at a reverse proxy.
With [Caddy](https://caddyserver.com) (automatic certificates):

```
# /etc/caddy/Caddyfile
yourdomain.example {
    reverse_proxy 127.0.0.1:8787
}
```

systemd unit:

```ini
# /etc/systemd/system/h2h.service
[Unit]
Description=Hashmark Heroes H2H match server
After=network.target

[Service]
WorkingDirectory=/opt/hashmark-heroes
Environment=H2H_STATIC=1
Environment=H2H_DATA=/var/lib/h2h
ExecStart=/usr/bin/node server/h2h-server.js 8787
Restart=always

[Install]
WantedBy=multi-user.target
```

Restarts are free: matches persist as append-only JSONL under `H2H_DATA`
(default `server/data/`), and the server re-sims every unfinished match
back to its exact pending state on boot — determinism IS the recovery
mechanism. SSE reconnects natively (EventSource + Last-Event-ID replay).

Note: one SSE connection per player per match; the kernel's default file
descriptor limits are fine for hobby scale.

## Tests

```bash
node server/h2h-probe.js           # two scripted clients, full match over the wire,
                                   # timeout fallback, independent artifact re-sim,
                                   # canonical OUTCOME-hash match (full play-by-play)
node server/h2h-recovery-probe.js  # SIGKILL mid-match → respawn → exact state restore
node server/h2h-client-probe.js    # two REAL headless browsers through the actual UI
node server/determinism-probe.js   # result-hash.js is sound: stable re-sim, seed-
                                   # sensitive, tamper-evident vs a score-preserving edit
node server/determinism-hazard-probe.js  # CROSS-MACHINE: enumerate outcome-path libm
                                   # calls + measure how far they can drift before the
                                   # result flips (the on-chain validator-fork risk)
PORTABLE=1 node server/determinism-hazard-probe.js  # same, with the portable-math
                                   # mode ON → 0 outcome-path libm calls, infinite margin
node server/league-probe.js        # league server: lifecycle + authoritative draft +
                                   # M2 shared season (canonical rosters, server week
                                   # sims, independent re-sim of published results)
node tools/_league_client_probe.js # two REAL browsers: league lobby/draft/season UI
```

## League server (shared dynasty) — M2 shared season

`league-server.js` hosts multiplayer DYNASTIES (one league, many GMs). Since M2
the season itself is server-authoritative:

- **START mints `leagueSeed`** (once, published immediately — no re-roll).
  Default-roster leagues derive all 32 rosters from it via
  `_fdBuildDefaultLeague` (the fantasy-draft pattern minus picks) and publish
  `rostersHash`; fantasy leagues take the finished draft (poolSeed + tape) as
  genesis. The 18-week schedule is RNG-free — identical on every client.
- **`advance` sims the current week** through the hosted engine (the same
  bundle `draft-host.js` loads): per-game seed = first 4 LE bytes of
  `sha256("hh-league-game|<leagueSeed>|<season>|<week>|<homeId>|<awayId>")`,
  sim under `_setSimRng(seed)` with **portable math**, publish
  `{scores, resultHash}` per game (`result-hash.js`), fold standings,
  broadcast `week_results` over SSE. Full ledger: `GET /api/league/season/:id`.
- **Verification** (the anti-cheat contract): re-derive rosters NATIVELY from
  the genesis, re-sim any game PORTABLY with the seed formula, compare
  `resultHash`. `league-probe.js` does exactly this on every run; browser
  clients verify `rostersHash` live (VERIFIED badge on the season screen).
- Restarts are free: results persist as one atomic `week-results` record per
  week (standings snapshot included); a crash mid-sim loses nothing —
  re-advancing re-sims byte-identical results.
- **Playoffs (M3)**: after the final regular week, each advance sims one
  bracket round. Seeding is a pure fold of the published standings (win% →
  point diff → PF → teamId — re-derivable by any member), 7 seeds per
  conference, #1 bye, reseed each round. Playoff games sim with
  `{isPlayoff: true}` at `week = seasonWeeks + round + 1` — an independent
  verifier must pass the same option and week. Champion → one more advance
  rolls to season N+1 (same canonical rosters, fresh standings; per-game
  seeds re-namespace via the season hash input). Scheduled leagues
  self-drive the entire loop.
- **Live human fixtures (M4, `settings.humanGamesH2H`)**: a fixture between
  two claimed teams is NOT auto-simmed — `advance` publishes the week as
  OPEN (`week_partial`; standings only fold at close) and the members play
  it on an h2h server, seed-bound to the league's own per-game derivation
  (createMatch accepts an optional `seed`). `POST /api/league/h2h-result`
  ingests the finished match artifact only after re-verifying EVERYTHING:
  the fixture is pending, the seed re-derives, both rosters equal the
  canonical genesis, and the full tape re-sims to the same resultHash.
  Because an artifact can't prove the opponent authorized the tape (the
  inputs are public — one member could fabricate a match solo), ingest is
  two-party: the first verified submission proposes, the opponent's matching
  submission confirms; conflicting verified artifacts freeze the fixture as
  disputed. The commissioner's next advance is the deadline hammer — it
  force-sims anything still waiting (byte-identical to a null-tape replay,
  the coordinator-defer property). `POST /api/league/h2h-challenge` relays
  the match invite to the opponent over league SSE.

## Per-call signatures — proving WHO authorized the inputs

Hashes prove a result FOLLOWS from `{seed, rosters, tape}`; they cannot prove
the opponent authorized the tape (the inputs are public — one party can
fabricate a match solo). The attestation layer closes that:

- Seats may register an **ECDSA P-256 pubkey** at create/join; every call from
  a key-registered seat must arrive **signed**
  (`hh-call|matchId|seq|side|JSON(call)`, canon in `artifact.js`) or it is
  rejected before the tape sees it. Clock-timeout / defense-off entries are
  signed by the **server key** (persisted in the data dir). Signatures ride a
  **parallel `sigs` lane** — `artifactInputsHash` (v2) and every replay path
  are unchanged; unsigned legacy seats show up as a visible coverage gap.
- `verify-artifact.js` verifies every carried signature (an invalid one =
  MISMATCH, exit 1) and reports coverage per lane (home/away/server/unsigned).
- **League fixtures**: members register pubkeys with the LEAGUE at join
  (published in the snapshot). An M4 artifact that is fully attested AND whose
  seat keys equal the fixture members' league-registered keys is
  **self-proving → solo-accepted** (one submission, no confirmation round).
  Match-local keys are self-registrable by a fabricator; the league-key
  binding is exactly what they can't forge. Anything less falls back to
  two-party attestation.
- **Draft picks**: key-registered members sign each pick
  (`hh-pick|leagueId|i|teamId|pid`); clock auto-picks are league-server-signed;
  the full `sigTape` + keys are served with the draft state, so a referee
  re-verifies every pick (league-probe does, 126 checks).

## Verifying a settled match (challenger / auditor tool)

`verify-artifact.js` is the standalone, trustless verifier — what an optimistic
challenger or an auditor runs to dispute or confirm a result. Given a match
artifact (the public `{seed, rosters, tape, math}` + its claimed `hash` /
`resultHash`), it INDEPENDENTLY re-sims in the artifact's declared math mode and
recomputes both hashes:

```bash
node server/verify-artifact.js http://host:8787/api/artifact/ID?token=T
node server/verify-artifact.js saved-artifact.json
curl -s .../api/artifact/ID?token=T | node server/verify-artifact.js -
```

Exit `0` = PROVEN (both hashes reproduce), `1` = MISMATCH (the claimed result is
not what the inputs re-sim to → the basis for a challenge), `2` = load/sim error.
No server or trust required — just `(seed+inputs) → deterministic result`. The
core `verifyArtifact()` is unit-checked in `h2h-probe.js` (PROVEN on the genuine
artifact; MISMATCH on a tampered `resultHash` and on a tampered inputs `hash`).

### Cross-machine determinism (the validator-fork risk)

Challenge-by-re-sim is only sound if every validator computes the byte-identical
result. ECMAScript leaves `Math.sin/cos/log/pow/exp/atan2/hypot/...` precision
**implementation-defined** (only `sqrt` is correctly-rounded), so different
Node/V8/libm builds can disagree in the last bit. `determinism-hazard-probe.js`
turns that open risk into a measured list:

- **Outcome-path libm calls** (during re-sim, fixed rosters): `Math.pow` ~994,
  `Math.log` ~354, `Math.cos` ~336 per game. `Math.sin`/`hypot` are render-only
  (not in the headless outcome path). (Since M4 both Node hosts bundle the
  franchise layer — bundle parity, see engine-host.js header — which put
  `combineMeasurables`' weight formula on the outcome path; its `Math.log` was
  switched to the `_olog` dispatcher, so `PORTABLE=1` still measures **zero**
  outcome-path libm calls.)
- **Per-function sensitivity** at ±4 ULP (the upper end of realistic libm
  disagreement): **none** flip the result.
- **Safety margin**: the outcome only diverges once *all* transcendentals are
  perturbed by ~10¹² ULP (≈2.4e-4 relative) — roughly **2.7×10¹¹×** a realistic
  libm gap. The gaussian's `Math.round` (play-engine.js `normal()`) and the
  engine's discrete decision thresholds absorb tiny perturbations.

So today's risk is vanishingly small in practice **but not zero** — a single
near-boundary roll on one forked game breaks an on-chain proof.

**Fixed by construction (portable math, flag-gated).** `play-data.js` ships
pure-IEEE `_plog`/`_pcos` (and `_osq` = `x*x`) — built from only the operations
ECMAScript pins exactly (`+ - * /`, `sqrt`, `round`, integer bit-ops, constants),
accurate to ~1e-13 vs native. `_setPortableMath(true)` / `window.GC_PORTABLE_MATH
="on"` routes the engine's 3 outcome-path call-sites through them. Default is
**native** (every gate runs the byte-identical native path); the on-chain
validators run **portable**, where:

- `PORTABLE=1 determinism-hazard-probe.js` → "0 outcome-path libm calls", and the
  result is **stable through the entire ±1e12 ULP ladder** (perturbing every
  libm function changes nothing — the sim no longer calls them). Margin → ∞.
- `determinism-probe.js` asserts portable mode is **outcome-neutral**: the
  canonical resultHash is identical native vs portable, so the on-chain mode can
  be turned on everywhere with zero behavioral drift.

The dispute `resolver` can therefore move toward an on-chain re-sim verifier
(every validator agrees bit-for-bit) instead of a trusted multisig.

**The GEN path is covered too (2026-07 audit).** Roster/pool generation from a
seed had its own libm exposure — the potential Box-Muller (`Math.log`/`cos`)
and the career-trajectory power curve (`Math.pow`, ~10k calls/league) — now
routed through the same dispatchers (`_opow`/`_oexp` join `_olog`/`_ocos`,
backed by pure-IEEE `_ppow`/`_pexp`). `node server/gen-hazard-probe.js` is the
measured proof (census / per-fn sensitivity / ULP ladder), `PORTABLE=1` is the
CI gate (0 gen-path libm calls, immune to the full ladder), and the probe's
NEUTRALITY check shows native gen ≡ portable gen (full-roster, pid, and pool
hashes identical per seed) — so a portable validator reproduces a native
server's published `rostersHash` bit-for-bit, and the whole
(seed)→rosters→(game seeds)→results pipeline is validator-fork-safe
end-to-end.

**The h2h server runs portable by default** — it's the authority/validator, so it
calls `_setPortableMath(true)` at startup and every re-sim + settled `resultHash`
is bit-exact. The artifact (v2) carries a `math: "portable"` field so an
independent re-simmer knows which mode to use; `h2h-probe.js` asserts it and
re-sims in that declared mode. (The browser/single-player engine stays native by
default — identical outcomes, no flag needed.)

## API sketch

See the header comment in `h2h-server.js`. Decision windows for the same
snap run in **parallel under one shared play-clock** (defense + offense
prompt simultaneously; answers commit to the tape in seam order). The
match artifact is served at `/api/artifact/:id` and carries TWO hashes,
the settlement pair:

- **`hash`** — SHA-256 of the INPUTS `{seed, rosters, tape}`. Binds what the
  match was *given*.
- **`resultHash`** — SHA-256 of the canonical OUTCOME (`result-hash.js`): final
  score + box score + every play's outcome fields, with cosmetic/derived data
  (`motion`/`statsSnap`/`desc`) stripped and keys sorted so it depends only on
  the data. Binds what *happened*.

A challenger re-sims the inputs, recomputes `resultHash`, and disputes on a
mismatch — the optimistic-challenge settlement hook. (Comparing only the final
score + play count, as the first cut did, would wave through a play-by-play or
box-score tamper; `determinism-probe.js` demonstrates exactly that gap.)
