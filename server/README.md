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
```

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
  (not in the headless outcome path).
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
