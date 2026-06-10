# Hashmark Heroes — In-Game Clock & Head-to-Head Multiplayer

> **Purpose.** A durable design doc for the path to **live head-to-head
> playcalling** (two humans calling plays against each other in real time) and
> the in-game depth features that ride the same rails (in-game decisions,
> situational stats, watch-the-game). Companion to `AUDIT.md` (sim realism),
> `MFF.md` (the analytics layer on top of the engine), and `GAMEPLAY_LOOP.md`
> (the franchise UX loop).
>
> **Line numbers are references into large files and WILL drift — grep the
> function/identifier name to re-locate.**
>
> Status: **Phases 0-3 shipped, plus the defensive seam.** Blowout Rest,
> the persisted timeline + situational stats + Drive Chart (Workstream A),
> deterministic seeded game-sim AND franchise-layer determinism (Workstream
> B), single-player interactive playcalling with FOUR decision seams —
> run/pass, 4th-down, PAT, and the **defensive coverage-shell call** (you
> are OC and DC). The **pacing model is decided** (§Pacing, below):
> simultaneous hidden calls, server-anchored play-clock deadline,
> advance-on-both-ready, AI fallback on timeout. Remaining: the hosting
> decision, then Workstream C.3 netcode.

---

## TL;DR — the reframing

The instinct was "if we want more in-game features + multiplayer, we probably
need an in-game clock." Grounding the code flips the conclusion:

- **We already have a clock.** The audited engine (`class GameSimulator`,
  `play-engine.js:350`) is a genuine play-by-play simulator: quarters, a game
  clock (`this.time`, 900s/quarter), drives, downs, distance, field position,
  score-over-time, OT — and **situational AI already woven in** (4th-down
  decisions, tempo by score+time, late/desperate modes). It even has a
  **serializable state snapshot/restore** primitive (~`:2412`).
- **`frnSimOnce` throws the timeline away.** It constructs the sim, runs a full
  game, then persists only the **final box score** (`g.stats` via
  `_stripGameStatsForStorage`, `play-franchise-offseason.js:1889`). The rich
  in-game timeline is computed and discarded every game.

So the real work is **not** "build a clock." It's three **orthogonal**
workstreams, only the last of which is large:

| Workstream | Unlocks | Size |
|---|---|---|
| **A. Persist & expose game-state** | phase-accurate blowout rest, situational/clutch & garbage-time stats, watch-the-game, replays | small–medium |
| **B. Determinism (seed the RNG)** | reproducible games, replays, **and any multiplayer at all** | medium |
| **C. Externalize playcalling + netcode** | **live H2H playcalling**, interactive in-game decisions | large |

And the crucial reframing for multiplayer specifically: **the blocker is
determinism + an authority model, not the clock.** You can ship rich *async*
league multiplayer with the clock fully internal. The clock matters for
*experience and interactivity*, which is exactly what live H2H needs.

---

## North star: live head-to-head playcalling

Two human GMs, each calling plays for their team in real time (or
play-by-play turn-based), against a shared authoritative game state. This is
the most demanding target on every axis:

- It needs the engine to **pause at each playcall**, accept an **external**
  call (human, over the network) instead of the internal AI, resolve the play,
  and continue.
- It needs **determinism** so both clients agree on every outcome (or a server
  is the single source of truth).
- It needs **netcode**: authority, latency handling, a play-clock with an
  AI-fallback on timeout, and reconnection.

Everything below is sequenced so each phase is independently valuable and the
audited engine (`AUDIT.md` bands) is never destabilized.

---

## What exists today (grounded)

- **`class GameSimulator`** — `play-engine.js:350`. Constructor seeds state:
  `this.score={home,away}`, `this.quarter=1`, `this.time=900`, `this.yardLine=25`,
  `this.down=1`, `this.ytg=10`, `this.poss` (`:494–520`).
- **Real game loop** — `while (this.quarter <= 4)` (`:7007`); drive loop
  `while (this.time > 0 && plays < 22)` (`:6707`); OT loop (`:7094`). Clock
  burns `this.time -= 10` per play (`:2507`).
- **Situational AI already inline** — end-of-half "go for points" (`:1133`),
  tempo `heavy`/`mild` by score diff + time (`:1206`), passing-down detection
  (`:2247`), late-game / desperate modes (`:2239`, `:2721`). This is the brain
  that must become *pluggable* for H2H.
- **State snapshot/restore** — `~:2412` restores `yardLine/down/ytg/time/
  quarter/poss/score` from an object `s`. A serializable `GameState` already
  effectively exists; it just isn't named, persisted, or exposed.
- **Per-snap resolution** — `_pickTrenchRep`, `_coverName`, `_trench`/
  `_battleScore` (see `MFF.md`). The engine resolves specific player matchups
  every play; MFF added attribution as a **logging layer**, not engine surgery.
- **Persistence** — `frnSimOnce` (`play-franchise-offseason.js:1682`) →
  `new GameSimulator(...)` → keeps only `g.stats` (box score).
- **Audit gate** — `_audit_all.sh`, `_sim_audit.js`, NFL reference bands in
  `AUDIT.md`. Realism is regression-proofed; engine changes are validated
  against the bands (byte-identical for refactors, behaviorally for intended
  changes — the `MFF.md` discipline).
- **RNG gap** — **215** `Math.random()` calls in `play-engine.js` (142) +
  `play-player.js` (73), plus ~334 in the franchise layer. **Zero seeding.**
  The sim is fully non-deterministic today.

---

## Workstream A — Persist & expose game-state

> **Status: largely shipped.** Discovery found the sim *already* persists a
> scoring timeline per game (`g.scoring`: cumulative `{qtr, homeScore, awayScore,
> isScore}`) plus `g.momentumLog`, and the box score already derives quarter
> scores + a scoring summary from it. The remaining gap — a **gameplay** consumer
> of the timeline — is now closed: **phase-accurate Blowout Rest** (below) reads
> the timeline via the new `_gameRestFraction` accessor (`play-franchise-core.js`)
> and scales the rest benefit by how much of the game was garbage time. A margin
> fallback preserves behavior on legacy/quick-sim games with no timeline.

**Goal:** make the timeline a first-class, serializable artifact instead of an
ephemeral local.

1. Name the snapshot the engine already restores into a **`GameState`** schema:
   `{ quarter, time, down, ytg, yardLine, poss, score, seed, playIndex }`.
2. Have `GameSimulator` emit a **lightweight event stream** as it runs — at
   minimum drive boundaries + scoring + the WP we already chart, ideally one
   compact record per play. Store a downsampled timeline on the game
   (`g.timeline`) alongside `g.stats`; keep it small (drives, not every snap)
   to stay save-size-friendly.
3. Expose **derived queries**: "score/WP at quarter Q", "when did margin first
   exceed N", "snaps by player by quarter".

**Unlocks:**
- **Phase-accurate Blowout Rest** ✅ — reads the persisted `g.scoring` timeline
  (via `_gameRestFraction`) to know *when* the game was in hand. A wire-to-wire
  blowout protects starters far more (injury mul ~0.30, deep wear shed) than a
  late pull-away at the same final margin (~0.71, little shed). The margin
  threshold still gates *whether* rest happens; the timeline scales *how much*.
- **Situational stats** ✅ — `_classifyGameSituation` (core) flags each game
  comeback / wire-to-wire / one-score from `g.scoring`; tallied per team on
  `standings._sit` and surfaced in the recap notes + a standings situational line.
- **Watch-the-game / replay** ✅ — `replayClips`, quarter scores, scoring summary,
  momentum/WP, and now a **Drive Chart** (`g.drives` → `_bspnRenderDriveChart`).

Risk: **low.** No engine-math changes; this is logging + a schema. Gate-safe by
construction (final box score unchanged → `AUDIT.md` bands unaffected).

---

## Workstream B — Determinism (the multiplayer prerequisite)

> **Status: shipped (game-sim path).** A module-level swappable RNG lives in
> `play-data.js` (`_rand` / `_setSimRng` / `_clearSimRng` / `_mulberry32` /
> `_hashSeed`) — loads first in browser + audit. The engine's `Math.random()`
> was redirected to `_rand()` across **play-engine.js (142), play-player.js (71),
> play-sim.js (2), and play-data.js's per-play pickers (5)** — every site in the
> OUTCOME path (the leak hunt found play-data's `pickPersonnel`/target pickers,
> not just the engine). `frnSimOnce` derives a per-matchup seed
> (`_deriveGameSeed` off a per-franchise `rngSeedBase` + season/week/teams),
> installs it for the sim, and clears it after. Result: **same seed → byte-
> identical game** (verified: 3 seeds each run twice all match; different seeds
> differ). Outside a sim `_activeRng` is null → `_rand()` falls through to
> `Math.random()`, so player generation / draft / FA stay stochastic AND the
> headless audit (which never seeds) is unaffected — confirmed calibration-
> neutral via `_sim_audit.js` (flags only the usual 2-season tail noise, which
> moves with the seed; headline bands all OK).
>
> **Remaining (follow-ups):** the franchise layer is still `Math.random` — the
> two chaotic-chemistry ±2 tweaks in `frnSimOnce` and the post-game injury rolls
> aren't seeded yet, so a *full* franchise replay isn't byte-identical even
> though the GAME is. Authority model (server-authoritative) still to decide.

**Goal:** `(seed + inputs) → byte-identical game`, everywhere it matters.

1. Add a small seeded PRNG (e.g. `mulberry32`/`xorshift128`) as an engine
   instance field: `this.rng`. Store the **per-game seed** on `GameState`.
2. Replace `Math.random()` **in the sim path first** (`play-engine.js`,
   `play-player.js`) with `this.rng()`. The franchise-layer 334 calls (draft,
   FA, dev) can migrate later or stay non-deterministic where they don't affect
   live games.
3. Seed from current entropy by default → **no gameplay change, no audit
   drift** (validate with `_audit_all.sh`: the distributions must match the
   pre-change bands).
4. Decide the **authority model**:
   - *Async league:* server (or designated host) sims with a seed; results
     shipped. Clients can re-verify by replaying the seed.
   - *Live H2H:* **server-authoritative** is the safe default (one truth, no
     desync, natural anti-cheat). Deterministic client lockstep is possible but
     brittle across JS engines/float edge cases — not worth it here.

Why this is the real multiplayer unlock: with 215+ unseeded calls, no two
machines can agree on a game. Determinism also buys **replays and debuggable
sims** for free — independently valuable even if multiplayer slips.

Risk: **medium.** Mechanical but broad; the audit harness is the safety net
(re-run, confirm bands hold). Touches the audited engine, so do it as a pure
refactor (seeded-but-statistically-identical), validated byte-for-byte where
possible and behaviorally against `AUDIT.md` otherwise.

---

## Workstream C — Externalize playcalling + netcode (the H2H core)

> **Status: C.1 + C.2 shipped — all four decision seams live.** The engine
> routes run/pass, 4th-down (go/fg/punt), PAT (kick/two), and — V4 — the
> **defensive coverage shell** through optional per-side coordinators.
> The defensive seam (`kind: "defense"`, called for the DEFENDING side at
> the top of every scrimmage snap, before the 4th-down branch — the
> defense commits without knowing go/kick/punt, the hidden-info structure
> H2H needs) accepts one of the six shells (C0_BLITZ / C1_MAN / C2_ZONE /
> C3_ZONE / C4_QUARTERS / TAMPA_2) or null. On pass plays the call
> overrides the AI's coverage roll (which still runs — stream-identical
> when deferring) and flows through the same concept×coverage matchup
> tables; on run plays it shifts the trench battle (blitz = mean toward
> the defense + wider variance = boom/bust; two-high = light box,
> offense-favoring). Context includes the offense's personnel (defenses
> see subs come on — an authentic pre-snap read). The single-player
> interactive runner prompts for it on every defensive snap (keys 1-6,
> O = DC call); the deferring-coordinator CI invariant covers all four
> kinds. Remaining: C.3 — the server-authoritative netcode per the
> decided pacing model.

Today the playcall brain is **inline** in the engine (tempo, 4th-down, run/pass
tendencies computed mid-loop). For H2H it must become an **interface**:

1. **Extract a `Coordinator` seam.** At each offensive/defensive decision the
   engine asks a coordinator for a `PlayCall` instead of deciding inline:
   ```
   interface Coordinator { call(gameState, context) -> PlayCall }
   ```
   - `AICoordinator` wraps the *existing* inline logic (zero behavior change —
     validate against the bands).
   - `HumanCoordinator` resolves the call from UI input.
   - `RemoteCoordinator` resolves it from the network (authoritative server).
   This is the highest-value refactor: it makes the engine **drivable** without
   changing what the AI does.
2. **Make the loop yieldable.** The drive/quarter loops must be able to *pause*
   at a decision point and resume with an injected call (generator/async, or an
   explicit step-function `advanceToNextDecision()`), so a human/network can
   answer. The existing snapshot/restore (~`:2412`) is the resume substrate.
3. **Netcode (live H2H):**
   - **Server-authoritative**: server holds `GameState`, runs the engine, both
     clients send `PlayCall`s and receive resolved deltas + timeline events.
   - **Play clock + AI fallback**: each side has N seconds to call; on timeout
     the `AICoordinator` calls for them (graceful, prevents stalls/grief).
   - **Latency/UX**: pre-snap call submission (both submit, server resolves),
     optimistic animation, snap-clock countdown.
   - **Reconnection**: rejoin from the authoritative `GameState` snapshot.
   - **Anti-cheat**: server authority means clients never compute outcomes;
     they only submit intent.

Risk: **large.** This is the real project. But note it builds *on top of* an
already-calibrated engine — the hard simulation problem is solved; this is
control-flow refactor + transport + UX.

---

## Protecting the audit gate (non-negotiable)

Every change here that touches `play-engine.js` / `play-player.js` must hold the
`AUDIT.md` bands:

- **Refactors (A's logging, B's seeding, C's coordinator extraction)** are
  *intended to be behavior-preserving* → validate with `_audit_all.sh` and aim
  for statistically identical output (ideally byte-identical with a fixed seed).
- **Intentional behavior changes** (e.g. interactive playcalling that lets a
  human deviate from the AI) → validate **behaviorally**, not byte-identically,
  exactly as `MFF.md` did for the analytics coaching AI (Slice G).
- Keep the **GATE-SAFE discipline**: franchise-layer state (morale, rest
  policy, etc.) feeds *triggers and modifiers around* the engine, never the
  audited per-play math.

---

## Phased roadmap (low-regret order)

- **Phase 0 — Blowout Rest (final-margin).** ✅ Shipped (§7). Proves the
  policy + payoff; survives the migration.
- **Phase 1 — Workstream A.** ✅ Timeline already persisted (`g.scoring`);
  phase-accurate Blowout Rest now reads it via `_gameRestFraction`. Remaining:
  clutch / garbage-time stat splits + a drive-by-drive recap (same timeline walk).
- **Phase 2 — Workstream B.** ✅ Engine RNG seeded (`_rand` + per-matchup seed),
  same-seed games byte-identical, calibration-neutral. Remaining: seed the
  franchise-layer randomness (chemistry tweaks, injury rolls) for full replay,
  and decide authority = server-authoritative.
- **Phase 3 — Workstream C.1/C.2.** Extract the `Coordinator` seam + make the
  loop yieldable. Ship **single-player interactive playcalling** first (you vs
  the AICoordinator) — fun on its own and de-risks the seam before networking.
- **Phase 4 — Workstream C.3.** Server-authoritative netcode → **live H2H
  playcalling**, play clock + AI fallback, reconnection.
- **Phase 5 — Polish.** Full play-by-play timeline, live-watch experience,
  spectating, async-league mode reusing the same determinism + authority.

---

## Data model sketch

```
GameState {            // serializable; the engine already restores this shape
  seed, playIndex,
  quarter, time, down, ytg, yardLine, poss,
  score: { home, away },
}

PlayCall {             // what a Coordinator returns
  side: "off" | "def",
  concept,             // run/pass family, formation, blitz, coverage, tempo...
  personnel, target?,  // engine-meaningful knobs
}

Coordinator {          // the H2H seam
  call(gameState, context): PlayCall
}
// AICoordinator (wraps today's inline logic), HumanCoordinator, RemoteCoordinator

TimelineEvent {        // downsampled, stored on g.timeline
  t, quarter, type,    // "drive_end" | "score" | "turnover" | "play"
  scoreAfter, wp,      // WP we already compute for charts
}
```

---

## Risks & open questions

- **Save size.** A full play-by-play timeline per game × a season × many seasons
  is heavy. Mitigation: store **drive-level** by default, regenerate
  play-by-play on demand from `(seed + inputs)` once deterministic.
- **Float/JS determinism across clients.** Avoided by choosing
  **server-authoritative** rather than client lockstep.
- **AI parity in H2H.** A human deviating from the calibrated AI can drift the
  *game's* realism (not the engine's) — acceptable, but awards/stats earned in
  H2H may want a flag.
- **Scope of B.** Do we seed only the live-game path, or the whole franchise
  (draft/FA/dev) for fully reproducible saves? Start with the game path.
- ~~**Pacing of H2H.**~~ **DECIDED** (user-ratified): the dichotomy was
  false — the engine resolves plays instantly and animation is a local
  replay, so the game is structurally turn-based with no twitch input.
  Model: **simultaneous hidden calls per snap** (offense + defense commit
  without seeing each other), a **server-anchored play-clock deadline**
  (per-match parameter, ~20s default — deadline-as-data means a 24h
  deadline gives async league play on the same system), **advance when
  both have submitted** (decisive players finish games in ~20-25 min),
  and **AICoordinator fallback on timeout** (anti-grief + graceful
  disconnect: the game degrades to vs-AI and a reconnect resumes from the
  authoritative state + input tape). Calls are submitted while the replay
  animates — think-time windows are symmetric whether you watch or skip.
  Explicitly rejected: a continuous wall-clock game clock (fake urgency on
  a discrete sim) and client lockstep (already rejected for float drift).

---

## C.3 — Hosting & netcode design (DECIDED, v1 scaffold shipped)

**Hosting (user-ratified): a plain Node + HTTP/SSE process on a small
VPS — no chain, no vendor APIs, zero npm dependencies.** Two facts decide
it: (1) the authoritative state is just `(seed, roster snapshots, input
tape)` — a few hundred KB, perfectly recoverable by re-sim, so restarts
and failover are free; (2) the engine already runs headless in Node (the
audit harness proves it on every gate run), so the server reuses that
exact bundle-loading pattern with zero engine changes. Rejected:
player-as-host P2P (host peeks at the opponent's call before committing —
breaks the authority model; TURN server needed anyway), serverless actors
(scale benefits we don't need, toolchain + no-eval costs we'd pay now),
BaaS realtime DBs (clunky clock enforcement, two vendors).

**MegaETH relationship (user-ratified):** orthogonal layers. The chain
owns identity/assets/league state + (later) settlement truth; the Node
server owns realtime match execution; the deterministic artifact
`{seed, teams, rosters, tape}` is the bridge. The server computes a
SHA-256 **artifact hash** at match end — the settlement hook. Posting
`(resultHash, artifactHash)` to `LeagueManager`, optimistic wagers with
challenge-by-re-sim, and per-call on-chain anchoring (feasible on
MegaETH's fast blocks via session keys, but 260 txs/match of wallet UX
for thin trust gain) are all later bolt-ons — **v1 runs with no chain
dependency at all.**

**The v1 scaffold** (`server/h2h-server.js`, zero-dep; engine loaded by
`server/engine-host.js`, the audit's bundle pattern):

- **Match lifecycle:** `POST /api/match` (create → matchId + hostToken +
  joinCode) → `POST /api/join` → both connected via SSE
  (`GET /api/events/:id?token=&since=`) → decision loop → `final` event
  with result + artifact hash. `GET /api/state/:id` is the reconnect
  snapshot; SSE `since` replays missed events (every event has a seq id).
- **Decision loop = the interactive runner's mechanics, server-side:**
  fresh seeded sim per step, both sides' coordinators answer from one
  flat tape in deterministic order, sentinel-pause at the first
  unanswered call. The pending decision goes to its owner as a
  `decision` event (kind + context + deadline); the opponent gets
  `waiting`. `POST /api/call {seq, call}` appends to the tape (seq
  guards stale/dupe submissions) and re-steps; resolved plays stream to
  both sides as `plays` slices. **Hidden info holds because calls are
  never broadcast** — the defense's shell commits at the snap top (the
  engine seam fires before the 4th-down branch) and the offense never
  sees it. v1 collects the two same-snap calls sequentially (two
  windows); parallel windows are a server-side optimization, no protocol
  change.
- **Play clock:** server timer per pending decision; on expiry the
  server appends `null` (= the AICoordinator decides, exactly like the
  single-player defer) and the match advances. AFK/disconnect therefore
  degrades to vs-AI; reconnection resumes from the snapshot.
- **Persistence:** append-only JSONL per match (header = seed/teams/
  rosters/settings/tokens; one line per call; footer = result + hash).
  On boot the server reloads every unfinished match and re-sims it back
  to its pending state — determinism IS the recovery mechanism.
- **Test harness:** `server/h2h-probe.js` — two scripted clients play a
  FULL match over the real wire (create/join/SSE/calls), including a
  go-silent window asserting the timeout fallback, then independently
  re-sim the artifact tape locally and assert the same final score +
  hash. Runs headless in CI like every other gate.

**Browser client (shipped):** `play-h2h-client.js` — the network
session wears the `_ipc` interface so the existing call panels,
keyboard, and playback loop work unchanged: SSE `decision` events land
in `_ipc.pending`, `frnPlaycall`'s `mode === "net"` branch POSTs the
answer instead of tape-pushing, `_ipcMaybePrompt` parks playback on a
waiting banner (with the opponent's play-clock countdown) when caught
up mid-match, and play slices resume it. Entry: 🌐 Host H2H (dev/testing
panel) → share link `#h2h=matchId.joinCode.server`; joining from the
link works in any app mode. Proven by `server/h2h-client-probe.js`:
two headless browsers play a full match through the real UI (button
click → share link → first prompt answered by clicking the defense
panel → autopilot to FINAL) with identical finals and zero page errors.

**Follow-ups (all shipped):**
- **Parallel same-snap windows** — defense + offense prompt simultaneously
  under ONE shared clock; answers commit to the tape in seam order in a
  single re-sim. Works because the engine's seam order makes the next ask
  after a down-1-3 defense call provably the same snap's playcall, the
  offense's call can't depend on the defense's (hidden info), and every
  seam validates its answer (a mispredicted call degrades to a defer,
  never corrupts). 4th downs/PATs stay sequential so their prompts carry
  real engine context. Durability boundary: calls persist at window
  RESOLUTION — a crash mid-window re-opens it (at-least-once prompting,
  never a divergent tape).
- **Wire slimming** — statsSnap ships on a cadence (every ~8th carrier +
  score plays + the final snapshot) instead of per play; the panels walk
  back to the most recent one. Measured: 7.42 → 1.88 MB per match (4×).
- **Player-facing host entry** — 🌐 footer link → host modal (team pick,
  franchise-roster checkbox, server field); the dev-panel controls remain.
  The share link lives in the waiting banner ("MATCH HOSTED — SEND THE
  LINK") until the join lands.
- **Franchise-roster matches** — create accepts `homeRoster`, join accepts
  `awayTeamId`+`awayRoster` (the joiner picks their own seat; a `start`
  event tells the host, who refetches setup). Supplied snapshots are
  validated, persisted in the header, and become part of the artifact —
  determinism unaffected by roster origin.
- **Deployment readiness** — `H2H_STATIC=1` serves the game files from the
  same process/origin (path-traversal guarded); `/api/health` lets the
  client default its server field to `location.origin`; `server/README.md`
  has the systemd + Caddy TLS recipe. Actual provisioning (box + domain)
  is the operator's step.

**Still open:** matchmaking/accounts, spectators, async-league deadlines
(the protocol already supports them — UX only), chain settlement.

---

## Seams in existing code (where this plugs in)

| Concern | Location |
|---|---|
| Game sim object + state + loop | `class GameSimulator`, `play-engine.js:350`, loop `:7007` |
| State snapshot/restore (resume substrate) | `play-engine.js:~2412` |
| Inline playcall brain (extract → Coordinator) | `play-engine.js` `:1133`, `:1206`, `:2239`, `:2247`, `:2721` |
| Sim entry + box-score persistence | `frnSimOnce`, `play-franchise-offseason.js:1682`; `g.stats` `:1889` |
| Post-game hook (margin already flows here) | `recordFranchiseResult`, `play-franchise-core.js:4368` |
| Injury/wear payoff (rest reads here) | `_rollGameInjuries` + `_blowoutRestedSet`, `play-franchise-season.js` |
| Rest policy (Phase-0 feature; trigger upgrades in Phase 1) | `franchise.restPolicy`, `frnSetRestPolicy` (`play-franchise-stats.js`) |
| Realism validation | `_audit_all.sh`, `_sim_audit.js`, `AUDIT.md` |
| RNG to seed | `play-engine.js` (142), `play-player.js` (73) |
