# Fantasy Draft — league-wide "draft every roster from scratch" mode

**Status: S1 SHIPPED (single-player) — `play-franchise-fantasydraft.js`, gated by
`tools/_fantasy_draft_probe.js` (20 checks). S2 (league-server commissioner flow) and
S3 (on-chain) remain design.** This is the "on-chain full-draft mode" CLAUDE.md already
anticipates — the gen-time determinism fix (pickBodyType → `_rand()`) was landed
specifically so this mode could exist.

**S1 implementation notes (deviations from the design below):**
- SEEDING: the roster generator's helpers still hold ~11k raw `Math.random` draws
  (jersey/college numbers, `weightedTierPick`, flavor rolls, …) beyond the
  `_rand()`-routed paths — `_setSimRng` alone was NOT reproducible. Pool build and
  contract assignment therefore run inside `_fdSeededScope(seed, fn)`: a scoped,
  synchronous **Math.random override** with a mulberry32 stream (the audit-gate
  technique), restored in `finally`. Five top-level gen draws (assignTeamTiers /
  assignFranchiseAges / assignContracts / assignDraftInfo ×2) were converted to
  `_rand()` per the CLAUDE.md rule; full `_rand()`-routing of the helpers is the
  long-term path to dropping the override.
- Contracts: `assignContracts(rosters, SALARY_CAP_BASE)` (the tested default-league
  pricer) runs post-draft under seed `poolSeed ^ 0x5eed5eed` — team totals land
  ~$163-177M of $200M. This replaces the design's market-value × FIT sketch (same
  idea, tested code path).
- Constants: `FD_FLOORS` (hard minimums, mirrors `_seedPracticeSquads`),
  `FD_TARGET` (= `ROSTER_SLOTS`, 51 picks/team), snake order, rounds 12/25/51.
- Resume goes through the standard start-screen CONTINUE card (boot deliberately
  never auto-loads a save); the `fantasy_draft` phase dispatch re-derives the room
  from `(poolSeed, settings, tape)`.

## The one-sentence architecture

The entire draft is a **pure function**: `(poolSeed + settings + pickTape) → 32 rosters`
— generation is seeded, every pick (human, AI, or timeout auto-pick) is one tape entry,
and any client can re-derive the full league byte-identically from those inputs. This is
the same deterministic-replay trick the interactive playcalling runner uses
(re-sim from an input tape), applied to league creation. Resume, multiplayer sync,
spectating, and on-chain proof are all "replay the tape."

## Where it hooks in

| Tier | Entry point | Who drafts |
| --- | --- | --- |
| S1 single-player | Start screen: new "🧢 FANTASY DRAFT" start card → team picker → draft room | You + 31 AI GMs |
| S2 league server | Commissioner lobby: `settings.rosterMode = "fantasy_draft"`; **START** branches `lobby → "drafting" → "active"` (today `startLeague` goes straight to `active`) | Human members + AI for unclaimed teams |
| S3 on-chain | `LeagueManager`: VRF seed → bonded propose(artifactHash, resultHash) → challenge window (the `ProofSettlement` pattern, reused) | Same as S2, settled on-chain |

One core module serves all three; S2/S3 only change who mints the seed and who
validates picks.

## 1) Deterministic pool generation

- **Pool = flatten the default league.** Generate the same 32 rosters
  `_buildDraftLeague()` would (32 × `ROSTER_SLOTS` = exact position counts,
  tested talent curve), then strip team identity/contracts and pour every player
  into one pool. Guarantees the draft is completable (enough QBs/OL/K/P for
  everyone) and reuses the entire tested generator.
- **All gen under `_setSimRng(poolSeed)`.** RULE (already in CLAUDE.md): any
  gen-time value that feeds the sim draws from `_rand()`, never `Math.random()`.
  A single unseeded draw forks validators. Sort keys on the board must be total
  (OVR desc, then name, then pid) so every client orders identically.
- **Seed minting:** SP — minted at draft start and stored (like `rngSeedBase`).
  S2 — server mints at lobby LOCK, *after* settings freeze (see anti-cheat).
  S3 — Chainlink-VRF style request/fulfill, exactly the `openMatch` flow.
- Pool players carry no contract; `pid`s assigned in generation order
  (deterministic).

## 2) Draft mechanics

- **Order:** snake (1→32, 32→1, …). Order = Fisher-Yates over team ids drawn from
  the seeded stream; commissioner may override with a manual order — the override
  lives in `settings`, which is part of the hashed inputs.
- **Length (commissioner setting):** `draftRounds` = 12 (default — starters + key
  depth, ~25 min solo) / 25 / 51 (full). After the drafted rounds, **auto-fill**
  completes every roster to `ROSTER_SLOTS` using the same deterministic
  auto-pick algorithm — so a short draft is literally "everyone gets auto-picked
  early," not a different code path.
- **Position legality (the no-deadlock rule):** you cannot pick position X if
  `remainingPicks < sum(remaining minimums)` after taking X (minimums = the
  `FLOORS`-style table: QB 2, K 1, P 1, …). One validator function, used twice:
  client-side to disable cards, authority-side to reject. Because the pool is a
  flattened legal league and every team obeys the same constraint, the draft can
  always complete.
- **Pick clock (S2):** `pickClockMs` setting (async leagues: hours; live drafts:
  60s). Timeout → server executes the deterministic auto-pick and appends
  `{auto:true}` to the tape. An absent GM can never stall the league, and their
  roster still comes out legal (BPA-by-need).
- **AI teams** are picked by the authority (SP: local loop; S2: server) with the
  same auto-pick function — personality/tier-flavored BPA-by-need, **RNG-free
  given the state** (or drawing only from the seeded stream), and no libm
  transcendentals in the scoring math (cross-machine rule; use `_olog` etc. if
  ever needed).

## 3) Contracts & cap

After auto-fill, every drafted player signs deterministically:
`aav = computeMarketValue(p, cap) × FIT` (FIT ≈ 0.92, tuned so a median 51-man
roster lands ~88-92% of the $200M cap), years by age band, standard
baseSalaries/proration via the existing contract builder. Considered and
rejected for v1: draft-slot-scaled contracts (early picks costing more) — it
punishes a top pick twice and moves strategy from *who* to accounting. Market
pricing keeps the draft about talent while the cap still forces spread (you
can't draft 10 stars). Rookie classes, FA, `_seedPracticeSquads` all run as
normal afterward on the drafted rosters.

## 4) UX

- **SP:** start screen gains a fourth start card (🧢 FANTASY DRAFT). Pick your
  team identity, then enter the **existing rookie-draft war room**
  (`renderFrnDraft` + preshow) pointed at the vet pool instead of a class: draft
  board strip, filterable big board, my-roster panel with a position-needs
  meter, ⏩ Skip to my pick (`frnSkipDraftFloor`), 🤖 Auto-Draft Rest
  (`frnAutoDraftRemaining`), and the draft-grades recap
  (`renderFrnDraftReportCard`) scaled league-wide. All DS components; if pool
  gen takes >~150ms, chunk it behind a `DS.skeleton` (genuinely-async rule).
- **S2 commissioner lobby:** settings panel adds Rosters (Default / Fantasy
  draft), rounds, clock. START = `DS.button` with `DS.busy` while the server
  locks the lobby + mints the seed; members' clients receive `draft_started`
  over the existing SSE event log and mount the same war room bound to tape
  events. Your turn = the IPC-style "YOUR CALL" banner energy.
- **Refresh/resume anywhere:** replay `(poolSeed, settings, tape)` — SP stores
  it on `franchise.fantasyDraft = { poolSeed, settings, tape, done }`; the
  server already persists via its append log.

## 5) Multiplayer protocol (league-server)

- Phases: `lobby → drafting → active`.
- Draft state: `{ poolSeed, order[], round, pickIdx, tape[] }`; tape entry
  `{ seq, teamId, pid, auto, t }`.
- `POST /api/league/:id/draft/pick { token, pid }` → server validates (phase;
  member owns the team on the clock; pid available; position-legal) → appends
  to tape → `pushEvent("pick", …)`. **Clients never receive rosters** — they
  re-derive everything from the tape. Wire cost per pick: one tiny event.
- Unclaimed (AI) teams: the server auto-picks on their turn, optionally on a
  short cadence for broadcast drama (setting).

## 6) Anti-cheat — surfaces named + closed (CLAUDE.md discipline)

| Surface | Closure |
| --- | --- |
| Commissioner re-rolls seeds until a pool he likes | Seed minted once at lobby lock, after a hash of frozen settings; no re-roll. S3: VRF fulfills the seed — nobody, including the server, chooses it. |
| Out-of-turn / duplicate / illegal picks | Authority validates turn + availability + position-legality; clients submit *intent* (pid) only and render from the tape. |
| Client tampers with derived rosters | Rosters are never uploaded — they're re-derived. `artifactHash = sha256(canonical(poolSeed, settings, tape))`, `resultHash = sha256(canonical(rosters))` (extend `server/result-hash.js` canonicalization). Any participant re-derives and verifies; S3 uses the ProofSettlement challenge window. |
| Auto-pick divergence forks validators | Auto-pick is a pure function of draft state (no Math.random, no impl-defined libm on the scoring path); proven by the probe below. |
| Hidden-info leak | v1 pool is **open ratings** — fantasy drafts are open-information, so there is no secret to leak. A scouting-fog draft (server-held truth, commit-reveal) is explicitly deferred; do not half-build it. |

## 7) Gate-safety / determinism impact

- Opt-in creation flow only: the audit/teleport/anim batteries never enter it;
  default franchise creation is byte-identical to today.
- `poolSeed` is a NEW field — `rngSeedBase` and `_deriveGameSeed` are untouched,
  so the week-replay determinism contract is unaffected.
- New probe `tools/_fantasy_draft_probe.js` (ship WITH S1): (a) same seed twice →
  identical pool hash; (b) full auto-draft → 32 legal, cap-compliant rosters;
  (c) tape replay → identical roster hash; (d) legality validator can always
  complete from any reachable state (no deadlock); (e) gen path contains no
  unseeded RNG (run under `_setSimRng`, assert `Math.random` uncalled — the
  pickBodyType regression class).

## 8) Edges

- Commissioner disconnects mid-draft → the server is the authority; clock +
  auto-pick continue without him.
- A member never shows → auto-picked every turn; legal roster anyway.
- Mid-draft pick trades → **deferred v2** (tape gains a "trade" entry type;
  big validator surface, don't smuggle it into v1).
- 2 humans in a 32-team league → identical to SP with two claimed teams.

## 9) Phasing

1. **S1** — SP fantasy draft: pool gen, war-room reuse, auto-fill, contracts,
   probe. No server work. This alone ships the user-visible feature.
2. **S2** — league-server `drafting` phase: pick endpoint, tape events, clock,
   auto-pick; commissioner lobby settings + START flow.
3. **S3** — on-chain: VRF seed, artifact/result hashes, `LeagueManager`
   ingestion bound to `TeamNFT.ownerOf`.

## Open questions (product calls, not blockers)

- Default `draftRounds`: 12 (fast, recommended) or full 51?
- Snake confirmed as default? (Linear as a commissioner option is cheap.)
- Open ratings confirmed for v1 (fog draft deferred)?
- In MP, may GMs rename/re-skin their claimed franchise at draft time?
