# Hashmark Heroes — Codebase Audit Plan

> **Purpose.** A whole-codebase audit roadmap: what to inspect, how, in what
> order, and what "passing" means. Sized so each workstream is a single
> focused session. Companion docs: `AUDIT.md` (sim-realism bands — the one
> audit that already exists and runs), `MFF.md`, `GAMEPLAY_LOOP.md`,
> `INGAME_CLOCK_AND_MULTIPLAYER.md`, `HANDOFF.md` (history).
>
> Line/figure references will drift — re-measure with the commands inline.

---

## 0. Inventory (as of this writing)

| Area | Files | Approx LOC |
|---|---|---|
| Engine + sim | `play-engine.js` (7.2k), `play-player.js` (2.4k), `play-sim.js`, `play-data.js`, `play-motion.js` | ~10.5k |
| Franchise layer | `play-franchise-{core,season,stats,offseason}.js` | ~53k |
| Presentation | `play-animation.js` (11.3k), `play-render.js` (4.4k), `play-broadcast.js` (1.7k), `play-fx/audio/sprites/field-pixi/player-pixi` | ~19k |
| Styles | `play.css` | ~12.9k |
| Dev tools | `play-simtools.js`, `career-lab.html`, `sprite-*.html` | ~1.7k |
| Scratch / probes | 36 top-level `_*.{js,sh,json,html}` files | ~15k |
| Docs | 11 top-level `*.md` (some 70-80KB) | — |

Measured smells to anchor several workstreams below:
- **143 `innerHTML` sinks** across the franchise/UI files; **~600 inline
  `onclick="..."` handlers** interpolating data into JS strings.
- **~340 unseeded `Math.random`** calls in the franchise layer (engine is
  seeded; franchise replay determinism is still open — see `INGAME_CLOCK…`).
- **36 scratch files** at repo root, several >50KB, mixed in with shipping
  code on every clone/Pages deploy.
- Saves grow to **13MB+ by late season** (localStorage mirror trims; IDB
  holds the full payload).

---

## 1. Workstreams

### A. Security / injection audit — `innerHTML` + inline-handler sweep
*Priority: HIGH (cheap, systematic), Risk addressed: XSS-class bugs, the
apostrophe-breaks-scouting class of escaping bugs.*
> **DONE** (commits in the injection-sweep + save-integrity arc). Escaped the
> shared player-name renderers (`playerLink`/`playerLinkByName`) + all
> name-bearing `title=""` attributes; upgraded **all ~94 inline JS-string
> escapers** (`.replace(/'/…)`, `&#39;`, `safeName`, `_jsStr`) to also
> `&quot;`-escape so `onclick="fn('${name}')"` can't break the double-quoted
> attribute; import path sanitizes tag-like `<`. Verified: 10-screen runtime
> sweep with hostile `"`/`<img>` names → 0 injected handlers, 0 page errors.
> **Remaining (ticket):** the 40+ bespoke `>${p.name}<` *display* sinks still
> rely on the import `<`-backstop + clean generation rather than escaping at
> the sink — not a live vuln, but finish escape-at-sink for defense in depth.

Single-player game, but data flows through ~143 `innerHTML` sinks and ~600
inline `onclick` strings: generated player/team names (apostrophes,
hyphens — already bit once), **user-typed text** (franchise chat
`frnPostMessage`, save-slot names, type-to-confirm inputs), and imported
save files (fully attacker-controlled JSON).

- Method: grep-driven inventory (`grep -n "innerHTML\|insertAdjacentHTML"`,
  `onclick="`), classify each sink: static / generated-data / user-text /
  import-derived. Audit the last two classes line-by-line; spot-check
  generated-data sinks with hostile names (`O'Brien`, `<img onerror>`,
  backslash) via a headless harness that injects them into a roster.
- Standardize: one `_esc()` (exists as `_bspnEsc` in places) + one `_jsStr()`
  for handler interpolation; convert the worst inline handlers to delegated
  listeners where touched.
- **Pass:** no user-text or import-derived value reaches `innerHTML`/handler
  strings unescaped; hostile-name harness runs the full season loop clean.

### B. Save integrity, migrations & storage audit
*Priority: HIGH (data loss = worst failure a save-game can have).*
> **DONE** (save-integrity arc). Findings + fixes:
> - **IDB silently lost data under pressure** (critical): `_idbPut`'s write
>   ran in a later microtask, so the in-place localStorage trim mutated
>   `franchise` *before* the canonical IDB clone was taken — IDB got the
>   trimmed save, contradicting "IDB is canonical/uncapped". Now IDB always
>   receives a detached pre-trim snapshot (verified: 120 clips in IDB while
>   the oversized localStorage mirror correctly clears).
> - **replayClips was ~91% of the save** (~80MB at 4 weeks, ~350MB/season)
>   and `_trimReplayClips` left the current season **uncapped**; now capped
>   at 30/week (every week), and excluded from the localStorage mirror
>   without dropping them from the live session (stash + restore).
> - **Import skipped all backfills**: `frnImportSave` now runs the same
>   `_runSaveBackfills()` suite as load (extracted from its two inline copies).
> - **Sanitizer regression** from workstream A (corrupted inch-mark `"` in
>   scouting text) reverted to `<`-only → round-trip is byte-lossless again.
> - Diagnostics now lists `replayClips` + `playLog` (were invisible).
> Verified headless: round-trip byte-identical, import restores 0-missing
> pids, forced-trim preserves all user-visible data, migrations idempotent.
> **Remaining (tickets):** make `_trimFranchiseForStorage` fully non-mutating
> (it still trims careerHistory on the live object); cut the per-clip payload
> (regenerate motion from `seed`+inputs per workstream B rather than storing
> ~180KB of waypoint tracks per highlight); de-jargon the "IDB only" save UI.

The repair/migration block in `showFranchiseDashboard` is ~200 lines of
one-shot heals; `_trimFranchiseForStorage` deletes data under pressure (one
bug fixed this arc: trimmed scoring → zeroed linescores); save is dual-written
(localStorage mirror + IDB canonical).

- Method: enumerate every field written to `franchise.*` (grep assignment
  sweep) → produce a **save schema doc**. Round-trip test: play N weeks →
  export → import → deep-diff. Forced-trim test at every season phase.
  Migration test: synthesize legacy shapes (the `playoffs_pending` class —
  one found this arc) for each heal branch and assert it fires + is
  idempotent (run twice). Quota tests: fill localStorage, kill IDB, assert
  graceful degradation + honest UI copy (today it leaks "IDB only" jargon).
- Measure save growth per season; budget per subsystem (playLog is the
  whale — frozen `epaSummary` per past season is the intended shape).
- **Pass:** schema doc exists; export→import is lossless; every heal branch
  has a synthesized-save test; 5-season save stays under an agreed budget.

### C. Engine realism & statistical audit — extend the existing gate
*Priority: MEDIUM (the strongest existing audit — extend, don't rebuild).*
> **DONE** (realism-gate arc). Added to `_sim_audit.js` + `AUDIT.md` bands +
> the regression baseline (`_audit_baseline.json`, seed 1337):
> - **Special-teams returns gate** (KR avg, PR avg, return-TD/game). Surfaced
>   a real, N-stable finding: KR avg ≈28.9 yd (NFL ~22) yet ~0.005 return
>   TD/game (NFL ~0.05) — returns too long on average, never house-called.
>   Documented as an open realism item; not yet fixed.
> - **Penalty-mix gate** — accepted penalties/game bucketed into NFL families
>   (pre-snap / holding / pass-cover / personal / total). 5/5 in band.
> - **Game-outcome shape** — one-score-game % (43.3%, mildly under NFL 44–52)
>   and tie % added to EVENT RATES.
> - **Interactive-mode invariant** (Workstream C gate-safety): a deferring
>   coordinator produces a byte-identical seeded game to none — baselined as a
>   **hard gate** (value 1, tol 0), so any engine edit that breaks the seam
>   fails CI. Verified PASS at 2 and 8 seasons.
> Gate: 14/14 metrics within tolerance (2 informational NFL-band warns: KR
> avg, one-score %). **Remaining (tickets):** the KR-return realism fix;
> injury-rate-by-position bands (the injury data lives in `_brady_audit.js`,
> the better home for it); time-of-possession spread.

`_sim_audit.js` + `AUDIT.md` bands already cover the headline distributions.
Known soft spots to add bands for: special teams (KR/PR yardage + TD rates,
blocked kicks), penalties by type/team/game, OT frequency & outcomes, injury
rates by position/severity vs NFL IR data, situational splits the new
timeline enables (comeback rate, one-score-game rate vs NFL ~45%),
clock-mechanics sanity (plays/game, time-of-possession spread), and the new
**interactive-mode invariants** (deferring coordinator == no coordinator,
byte-identical; forced-call games stay within sane bounds).
- **Pass:** new bands added to `AUDIT.md` with NFL references; `_audit_all.sh`
  green; interactive-mode invariant test joins the gate.

### D. Determinism completion audit
*Priority: MEDIUM (prereq for replays-from-seed and any multiplayer).*
> **DONE** (determinism arc). Added a SECOND swappable RNG (`_frand` /
> `_setFranchiseRng` / `_clearFranchiseRng` in `play-data.js`), independent of
> the engine's `_activeRng`, and installed a **per-week franchise seed**
> (`_deriveWeekSeed` + `_withWeekRng`, salt `0xF1A` off `rngSeedBase`) around
> the week-resolution body of all three sim entry points (`frnSimWeek`,
> `frnSimToWeek`, `frnSimSeason`). Drove the conversion **empirically** with a
> harness (sim a week twice from one snapshot, deep-diff persisted state) +
> a `Math.random` call-stack profiler — not by guessing. Must-seed sites
> redirected `Math.random()` → `_frand()`: the two injury rollers
> (`_rollGameInjuries` contact + `_rollNonContactInjuries`, which the profiler
> caught — it was 1400+ of the calls) and their type pickers, in-season dev
> (`_inSeasonAwrGrowth`, rehab-outcome OVR penalty via `_rollRehabOutcome`),
> yips, chaos-chemistry swings, practice-squad flash/poach, and CPU POTW
> voting. Cosmetic randomness (AI trash-talk, weekly storylines) intentionally
> left on `Math.random` — re-rolling it gives no competitive edge.
> Verified: a full-franchise re-sim of the same week is **byte-identical**
> across all competitive state (injuries, dev/OVR, morale, scores, standings,
> practice squads) for 3 consecutive weeks; the profiler went from 1669 →
> ~60 cosmetic-only `Math.random` calls/week; new franchises still differ
> (player gen stays stochastic, correctly); realism gate unaffected (14/14).
> **Remaining (tickets):** seed the cosmetic news/chat too if a *fully*
> byte-identical save replay is ever wanted; week-by-week vs bulk-sim
> equivalence is confounded by the save-trim side-effects from §B's
> still-mutating `_trimFranchiseForStorage` (folded into that ticket).

Engine path is seeded; ~340 franchise-layer `Math.random` calls are not.
Inventory each call site → classify: must-seed (anything feeding game
outcomes or persisted state the user can re-roll by reloading: post-game
injury rolls, chemistry swings, weekly dev), can-stay (cosmetic picks, AI
chatter), must-NOT-seed (player generation entropy across new franchises).
- Method: grep inventory → tag in-code (`_rand()` vs documented-exempt
  `Math.random`) → replay test: same save + same week simmed twice →
  deep-diff standings/stats/rosters.
- **Pass:** full-week re-sim is byte-identical; exemptions documented.

### E. Performance & memory audit
*Priority: MEDIUM.*
> **DONE — numbers recorded** (perf arc; headless Chromium, software raster —
> GPU clients will beat the raster-bound numbers, the CPU/stall numbers carry).
> - **Load:** 4.8MB unminified JS; domInteractive ~850ms, DCL ~940ms, full
>   load 2.7s. **Fixed:** the pixi double-load (vendor 7.4.0 + CDN 7.4.3 both
>   parsed; effective version silently differed online vs offline; hard-failed
>   offline). CDN copy removed → load 5.2s→2.7s here, ~1MB less parse, one
>   pinned local pixi. Live field verified rendering on 7.4.0.
> - **Sim throughput:** p50 85ms/game in-franchise (12 games/s); 16-game week
>   1.45s; full `frnSimWeek` wall 3.3s at week-9 state (~1s of that is save).
> - **Interactive re-sim step:** p50 52ms, max 62ms per call — imperceptible.
> - **Save stall (TICKET):** week-9 save is 52MB → `JSON.stringify` 1.0s +
>   `parse` 0.35s + `_flushSaveFranchise` 0.9s **on the main thread every
>   debounced save**. Fix path: move the mirror+IDB snapshot to a worker
>   and/or cut the per-clip motion payload (§B ticket — regenerate from seed).
> - **Live playback frames (TICKET, the big one):** idle + paused = 16.7ms
>   (60fps); PLAYING p50 ~470ms/frame in software raster. Decomposed: NOT
>   PIXI (hiding it changes nothing), NOT JS (CPU profile: ~95% native canvas
>   raster; JS self-time <2%). Root cause: `drawField` repaints the entire
>   static field (grass, pads, gradients, mowing bands, end-zone art, crowd)
>   on the 1700×720 canvas from scratch every tick, ×3 stacked canvases.
>   Fix path: static-layer offscreen cache — render the static field once per
>   (cameraMode, weather, teams) state, blit per frame, draw only dynamic
>   layers live.
> - **Heap:** 12MB after load; 343MB at week 9 with 270 in-memory replay
>   clips (clips are the live-set driver); post-GC at a low-clip season end
>   53MB — no leak signature, just big retained clip payloads (§B ticket).
> - **DOM:** all tabs ≤1,700 nodes — fine.
> - **Incidental finding → §G ticket:** `frnSimToWeek`/`frnSimSeason` never
>   extract replay clips (only `frnSimWeek` does) — bulk sims leave the
>   Replays tab empty; same copied-block divergence family as the week-1
>   scoring bug. Unify the four sim-persist blocks.

- Targets: initial load (5 script files >400KB each, parse cost), per-frame
  cost in live playback (rAF work, PIXI + canvas double-render), sim
  throughput (games/sec — also caps interactive re-sim latency),
  `saveFranchise` serialization stalls (13MB `JSON.stringify` on the main
  thread every week — measure; consider debounce/worker), DOM size on the
  heavy tabs (full-league tables), memory growth across a 3-season session
  (replay clips, news, playLog).
- Method: Playwright + CDP tracing for load/frames; `performance.now()`
  micro-harness around save/sim; heap snapshots at season boundaries.
- **Pass:** numbers recorded in this doc; any frame >50ms or stall >200ms
  in the core loop gets a ticket; no unbounded per-season growth.

### F. UI/UX & accessibility audit — finish the contrast arc, add structure
*Priority: MEDIUM (large surface, but the worst was fixed this arc).*
> **DONE** (UX/a11y arc, two commits). Contrast: extended the
> alpha-compositing WCAG walker to ALL 25 screens (now also composites CSS
> gradients + parses `color(srgb …)` floats); informational fails **4365 →
> ~35** (99.2%). Fixed by lifting the modern theme's secondary gray
> (#7b8798→#a1adbd), routing every remaining raw-team-primary TEXT through
> `_teamInk`/`_teamInkStrong`/`--*-ink` vars (borders keep raw), and lifting
> sub-AA accent colors. The ~35 floor is the documented WCAG-exempt set
> (decorative emoji, placeholders, ASCII field, 7px badges, borderline 3.4–4.4
> secondary labels). IA quick wins: dissolved the Tools tab into Front Office
> sub-tabs; grouped the Analytics 18-pill junk drawer into MY CAP / LEAGUE /
> POSITION MARKETS; demoted the dashboard Abandon button to a quiet link;
> de-jargoned the "IDB only" save status → "✓ Auto-saved". Keyboard a11y: a
> `:focus-visible` ring for the hover-only controls + `aria-live` on the WIRE
> ticker. **Remaining (tickets):** full keyboard-only playthrough of the
> offseason/draft flows; landmarks/headings; the ~35 borderline floor if a
> strict AA badge is ever wanted.

- Contrast: extend the alpha-compositing WCAG walker (see
  `NEXT_SESSION_PICKUP.md` recipe) from the box score to **every** screen
  (offseason flows, draft, FA, trade, analytics sub-tabs) as a scripted
  sweep; codify the `_teamInk` text-only rule as the checked invariant.
- Keyboard & focus: tab-reachability of primary CTAs per screen; visible
  focus states (deck buttons currently rely on hover); Esc/Enter behavior in
  the modal helper is good — verify it everywhere a custom overlay exists.
- Structure: headings/landmarks on the dashboard; `aria-live` for the
  ticker/score updates; button vs link semantics on `div[onclick]`s.
- IA debt from the UX audit: dissolve the Tools tab, group Analytics'
  18 pills, demote Abandon, de-jargon save status, slim Overview header.
- **Pass:** zero <4.5:1 informational fails on every screen; full season
  + one offseason playable keyboard-only; IA items shipped or ticketed.

### G. Code health: duplication, dead code, file layout
*Priority: LOW-MEDIUM (drag on every future session, not user-facing).*
> **DONE** (code-health arc). The two hot-list refactors landed:
> - **One sim factory.** `_frnBuildLiveSim` is now THE construction path for
>   auto-sims, classic watch, and interactive playcalling; `frnSimOnce`'s
>   duplicated 90-line modifier stack is gone. Unifying surfaced + fixed two
>   live-path drifts: live games were missing the weekly-gameplan tilt AND the
>   Rest-Starters snap maps that auto-sims applied. Chaos rolls stay correct
>   per path ("roll" on the seeded franchise stream for auto-sims; pre-rolled
>   fixed values for the interactive runner's deterministic rebuilds).
> - **One persist path.** `_frnPersistSimmedGame` replaces the thrice-copied
>   persist block in `frnSimWeek`/`frnSimToWeek`/`frnSimSeason`. Fixed both
>   known drifts: week-simmed games now store `g.gameplan`, and bulk sims now
>   extract replay clips (the empty-Replays-after-Sim-Season bug from §E).
>   The APB tournament path persists a different shape (matchups, not
>   schedule games) and stays separate by design.
> - **Eager `rngSeedBase`.** Was minted lazily on first sim — a save
>   snapshotted before week 1 captured null and re-simmed differently. Now
>   minted at franchise creation; week-1 re-sims are byte-identical too.
> - **Scratch quarantine.** Root `_*` files 36 → 18: fifteen one-off probes
>   (qb/arch/jumbo/ir/cap/clutch-film/formation/trace/phase/ux/morale probes
>   + the html specimens) moved to `tools/` with their `__dirname` loads
>   patched; verified they still run. The 18 kept at root are the LIVE gate
>   + calibration suites (`_audit_*`, `_sim/_brady/_clutch/_mff_*` and the
>   teleport battery, which `_audit_gate.js` references).
> - **Dead-code inventory:** 1,522 function definitions, 36 zero-reference
>   (2.4%) — list captured below; deletion is a ticket (each needs a manual
>   check for dynamic/console use): drawKickoffFormation, renderRatings,
>   absSalaryFloor, currentCap, _isPlayerScouted, _schemeMatchupLabel,
>   _expireScoutingIntel, _resetWeeklyScoutVisits, frnSaveSummary,
>   frnLoadGame, open/closeFranchiseModal, _maybeEnshrineHOF,
>   frnFANegotiationOpen, frnFAOpenSelf, frnFACutPlayer, frnTogglePSAutoSpend,
>   _depthSlotLabel, _fpts, _clockMMSS, _topPerformer, _mini_helmet,
>   _bsCompRow, mffPlayerOfGame, mffTeamSOS, _weeklyTopTen,
>   _renderCurrentGameHub, _returnAbility, _teamPicksByYear,
>   _processPendingCounters, +7 more (re-run the inventory in §G method).
>
> **Target file layout (the "where does new code go" rule):**
> `play-data.js` constants/teams/RNG · `play-player.js` player gen ·
> `play-engine.js` GameSimulator ONLY (audited — gate every change) ·
> `play-render/animation/sprites/fx/audio/broadcast` presentation ·
> `play-franchise-core.js` save/load/slots/schedule/standings/state machine ·
> `play-franchise-season.js` in-season flows (FA, injuries, preseason) ·
> `play-franchise-stats.js` dashboard shell + stats surfaces ·
> `play-franchise-offseason.js` sim entry points, playoffs, offseason, draft ·
> `tools/` one-off probes · root `_*` = live audit gate + calibration only.
> New code goes in the right file; moved code moves when touched. Don't
> big-bang split the offseason monolith.

- **Duplication hot list:** the sim-result-persist block exists ~4× (
  `frnSimWeek` / `frnSimToWeek` / `frnSimSeason` / APB path — one already
  drifted once: week-1 scoring); the coaching-modifier stack exists 2×
  (`frnSimOnce` + `_frnBuildLiveSim` — documented mirror, should be one
  function); standings sorters; team-row renderers.
- **Scratch quarantine:** move the 36 root `_*` probes to `tools/` (or
  delete the obsolete ones — `_teleport_*`, `_brady_audit` are settled
  arcs); they currently ship with Pages deploys and pad every grep.
- **Monolith pressure:** `play-franchise-offseason.js` is 25k lines / 1.35MB
  and hosts plenty of non-offseason code (live game, playoffs, trades).
  Don't big-bang split; adopt a "new code goes in the right file, moved
  code moves when touched" rule and document the target layout.
- Dead-code pass: `grep -n "function "` inventory vs call sites (headless
  harness with coverage gives this nearly free).
- **Pass:** probes quarantined; duplication hot list refactored or ticketed;
  target file layout documented.

### H. Error handling & state-machine audit
*Priority: LOW (foundations are good: render boundaries, warn-only phase
graph, `_phaseHistory` forensics).*

- Sweep every `catch` that swallows (`catch {}` / log-only) and classify:
  fine / should-surface-banner / should-rethrow. The engine has ~95 catches
  — verify none can hide an outcome-affecting failure (the audit gate would
  drift silently).
- Phase machine: fuzz transitions (random `frnTransition` sequences against
  the edge map) + synthesized-save matrix from Workstream B; assert every
  phase renders *something* navigable (no screen without a Home/escape).
- **Pass:** swallow-sweep classified; phase fuzz finds no unrenderable state.

### I. Dependency & deploy audit
*Priority: LOW (small surface).*

- `play.html` loads **both** `vendor/pixi.min.js` and a pixi CDN copy
  (versions may differ — measured: the CDN load 404s/cert-fails in sandboxes
  and double-loads in prod). Pick one, pin it, subresource-integrity it.
- Hardhat/contracts/career dirs: confirm what's live vs vestigial; the
  `.env.example` suggests chain integration — document its status.
- Pages deploy: what actually ships (everything — including 80KB docs and
  scratch probes); add a deploy manifest or accept and document it.
- **Pass:** single pinned pixi; deploy contents intentional.

---

## 2. Suggested order (one session each, independently valuable)

| # | Workstream | Why this order |
|---|---|---|
| 1 | **A. Injection sweep** | Cheap, mechanical, closes a whole bug class the apostrophe incident proved real. |
| 2 | **B. Save integrity** | Highest-stakes failure mode; the trim bug found this arc says there's more. |
| 3 | **C. Realism-gate extensions** | Locks the engine before more Workstream-C surgery (H2H). |
| 4 | **D. Determinism completion** | Unlocks replay-from-seed + multiplayer; builds on C's gate. |
| 5 | **E. Performance** | Numbers first, fixes second. |
| 6 | **F. UX/a11y completion** | Big surface; contrast walker makes it mostly mechanical. |
| 7 | **G. Code health** | Continuous: quarantine scratch now (30 min), refactor-on-touch after. |
| 8 | **H. Error/state fuzz** | After B provides the synthesized-save tooling. |
| 9 | **I. Deps/deploy** | Anytime; pixi double-load is a quick win. |

## 3. Standing rules (apply to every workstream)

- **The audit gate is law.** Any engine-adjacent change re-runs
  `node _sim_audit.js 2 <seed>` (zero flagged metrics) — refactors aim for
  byte-identical under a fixed seed.
- **Findings → fixes split.** Each audit session produces (1) a findings
  list in the relevant doc, (2) quick fixes landed immediately, (3) tickets
  (doc bullets) for anything structural. No drive-by refactors mid-audit.
- **Every fix ships with its detector.** A bug found by hand gets a harness
  check (the headless Playwright pattern) so the class stays dead.
- **Scratch hygiene:** verification scripts are `_c_*.cjs`, deleted before
  commit; screenshots live in `/tmp`.
