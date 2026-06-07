# Refactor: the single position-source-of-truth contract

*Goal: close the entire "teleport" bug family in the play renderer, instead of
discovering each seam by user report and patching it.*

Status: **STAGES 0-11 SHIPPED — 96% reduction in egregious teleports
(138 → 6). Runs structurally clean. Snap teleport class closed across
all play kinds. Late-YAC overshoot clamp restored. DIME-LB coverage
mapping corrected (was being driven to top-side hook track instead of
MLB hook).** See *Execution log* at the bottom.
The RB-target reference-frame patch (`eb67c82`) and the FG fixes
(`b94f8c4`) were interim seam-patches that this refactor subsumes.

---

## Why this keeps happening (the root cause, not the symptom)

`play-animation.js` contains **27 distinct "teleport" fix comments**. That's a
structural fingerprint, not bad luck. Grouped:

- **Family A — coordinate-frame / init-point mismatch** (~17 comments: 1498,
  2002, 2315, 2652, 2837, 2919, 3397, 3468, 3565, 3589, 3986, 4265, 4415, 4512,
  4536, 4687, 5105, 5404, 6015). Two position systems hand off at a phase
  boundary (snap → route → catch → YAC → tackle), and the second initializes at
  a point the first didn't end at → visible jump.
- **Family B — time-budget mismatch** (~10: 1588, 3510, 3539, 3620, 7114, 7151,
  8547, 8666, 9019, 9049). A movement is given a fixed time window but must
  cover a distance that doesn't fit → easing snaps.

**The root cause of both families:** the renderer keeps its **own parallel
position model** alongside the engine's emitted motion tracks, and the two are
reconciled *by hand at every transition*. Each historical fix repaired one
transition; the *condition that produces transitions* — two models — was never
removed. So every new play-type × slot × coverage combination is a fresh chance
for the two models to disagree.

The RB bug was a perfect example: the engine emits route depth as **LOS-relative
yards**, but the renderer projected it from the **slot's X**. WR/TE slots sit on
the LOS so the gap is ~0 and they were always fine; the RB slot sits 8 yd behind
the LOS (`play-render.js:2844`), so its catch resolved 8 yd short and the YAC sim
absorbed the gap as a lateral slide. A prior continuity patch (3565) had made the
catch→YAC handoff smooth *from* `_wrLastX` — but never checked that `_wrLastX`
itself was right, so it masked the error for everyone except the one slot far
from the line.

---

## The contract (three rules)

For any slot that has an engine-emitted track in `play.motion.tracks[slot]`:

1. **One frame.** Every waypoint is **absolute LOS-relative yards** in *both*
   axes (downfield `dxYd` from the LOS, lateral `dyYd` toward midfield). No
   waypoint is ever interpreted relative to a slot's formation X/Y.
2. **Explicit start.** Each track carries an explicit **t=0 waypoint equal to
   the player's formation start** (in the same LOS-relative frame). The renderer
   *never* derives a tracked player's starting position from formation geometry,
   `targetX/targetY` constants, or hash decoys.
3. **One projector.** A single function projects a track sample → screen
   position. It is the *only* place that converts track yards to pixels. The
   renderer never re-computes a tracked player's position any other way.

Corollary (kills Family B): **time budgets derive from the track's own
arc-length**, not from `yards`/`yac`/`targetDepth`. The track is the clock.

Slots *without* a track (rare paths: some screens, kick coverage) either get a
track emitted, or are explicitly flagged `fallback: "constant"` so the
exception is deliberate and visible, not silent.

---

## Shared constant to extract

Formation-start offsets currently live only in `play-render.js:makeFormation`
(e.g. RB at `losX − dir·8·PX`, FB `−7`, WR/TE ~`losX`). The contract needs
**one** source of truth shared by the engine emit (rule 2) and the renderer:

```
FORMATION_DEPTHS = { wr1:{backYd:0, latYd:-16}, wr2:{backYd:0, latYd:16},
                     te:{backYd:0.13, latYd:5}, rb:{backYd:8, latYd:1.87},
                     fb:{backYd:7, latYd:0.27}, ... }   // i-form / pro variants
```

Extract to a module both sides import. `makeFormation` consumes it (no behavior
change); the engine consumes it to emit the t=0 waypoint.

---

## Staged plan (each stage independently shippable + detector-verified)

### Stage 0 — Teleport detector harness  *(enabler, no production change)*
The single most important step: convert "found by user report" → "found by
harness." Without it, the refactor just trades known patches for unknown
regressions.

- Headless render via the existing Playwright path (`_ux_snapshot.js` already
  boots the page against the dev server). Construct **synthetic `play` objects**
  and call `buildAnimForPlay(play)` directly in `page.evaluate` (top-level fns
  are reachable by name — same pattern as `franchise`).
- Instrument `drawPlayer` / `drawBall` in-page to record `(name|role, x, y)`
  every frame; step the returned `render(t, ctx)` over `t ∈ [0,1]` against an
  offscreen canvas.
- Battery: every `play.kind` (run, pass complete/incomplete/int, screen, sack,
  scramble, fg, punt, kickoff) × every target slot (wr1/wr2/te/rb) ×
  representative coverages × both `poss` directions.
- Flag any per-player frame Δ exceeding a physical cap (top speed ≈ 12 yps × dt
  + tolerance). Report play, player, frame, Δ.
- **Run against HEAD for a baseline.** This validates the detector (it should
  light up on the pre-patch RB bug and stay quiet on the patched build) and
  gives a regression baseline for every later stage.

### Stage 1 — Define contract + emit-side conformance  *(engine, behavior-neutral)*
- Extract `FORMATION_DEPTHS`; `makeFormation` consumes it (no visual change →
  detector unchanged).
- Engine emits the t=0 formation-start waypoint per slot, in LOS-relative yards.
- Renderer still uses its current projection, so nothing moves yet. Detector
  green throughout.

### Stage 2 — Unified projector + migrate the RB-target pass  *(behind a flag)*
- Add `_trackToScreen(track, aT, {losX, dir, cy})` — the single projector
  (rule 3).
- Replace the RB-target route + `_wrSim` + ctrl-fallback chain
  (`play-animation.js` ~3677–4006) with the unified sampler, behind
  `USE_TRACK_CONTRACT`. A/B against the old path.
- Detector confirms: no new teleports, RB lateral jump gone *without* the
  interim seam-patch.

### Stage 3 — Fold post-catch/YAC into the track  *(kills the parallel sim)*
- The track already carries YAC waypoints to the tackle. The catch stops being
  a handoff to a *separate* `_wrSim` model; the sim becomes a smoothing layer on
  the track sample, not a second source. Time budget = track arc-length (closes
  Family B for pass plays).

### Stage 4 — Migrate remaining slots/phases
- Non-target decoys (5389–5440), downfield blockers + `_followX/_followVX`
  (5167–5311), coverage CBs `_cbFollow*` (4358–4490), OL/DL engagement read-back
  (4300–4330, 5350–5360). One at a time, detector after each.

### Stage 5 — Delete dead fallbacks + retire the seam patches
- Once every slot is track-driven, remove hash-decoy fallbacks, the
  `_followX/_followVX` accumulators, bespoke `targetX/Y` constants, and fold the
  27 teleport patches into the contract. Detector is the guard.

### Stage 6 — Wire the detector into session-start / CI
- Runs on every change so the family stays closed.

---

## Handoff-init boundaries to retire (from the scoping inventory)

These 8 `new SimPlayer` / `_followX=` / `_cbFollowX=` sites are where Family-A
lives. The contract removes the *need* for per-boundary init because there's one
continuous track:

| site | init | boundary | risk |
|---|---|---|---|
| ~1527 | `d._sim` | run snap → rush | med |
| ~3988 | `_wrSim` | pass catch → YAC | **high** (the classic "WR under the ball") |
| ~4439 | `_cbFollowX` | route → coverage break | **high** (CB freeze-frame) |
| ~5273a/b | `_followX` / `_followVX` | route → post-catch blocker | med (NaN surge fixed) |
| ~4693 | `d._sim` | catch → YAC defender | low |
| ~2654/2663 | `d._sim` | run pursue → contact | med |
| ~5405/5443/5465 | `_followX` | post-catch persists | low |

## Time-budget sites to re-anchor on arc-length (Family B)

`basePass` / `POST_CATCH_MS` / `_yacScaleMs` (~3514, 3522, 3499), the INT-return
budget (~3620), `dropFrac`/`throwFrac` (~3592). All currently sized from
`yards`/`yac`/`targetDepth`; Stage 3 re-anchors them on the track length.

---

## Risk + rollback

- Every stage is flag-gated or behavior-neutral and verified by the Stage-0
  detector against the HEAD baseline. Roll back a stage by flipping its flag.
- The biggest risk is detector fidelity (a stubbed canvas drifting from the real
  render). Mitigated by using the *real* in-page render path via Playwright, not
  a hand-rolled ctx stub.
- This is the most heavily-patched file in the repo; do not big-bang. One slot
  per migration, detector after each, commit per stage.

---

## Stage 0 — BUILT (detector operational, baseline captured)

Three dev harnesses (committed, mirror the `_sim_audit.js` loader conventions):
- **`_teleport_capture.js`** (node) — runs the engine headlessly, buckets REAL
  play-visual objects by (kind × concept × coverage × targetSlot × poss), and
  writes per-game context (`teams`, `ratings`, serialized `playerLookup` Map,
  plays) → `/tmp/teleport_plays.json`.
- **`_teleport_detect.js`** (Playwright) — loads the real page, replays each
  play through `buildAnimForPlay`, records `drawPlayer`/`drawBall` positions per
  frame, and flags any per-frame jump over a human-speed cap. Players are the
  headline; the ball gets a high flight cap; non-finite (vanished) draws are a
  separate failure class.
- **`_teleport_trace.js`** — single-play per-frame dump for diagnosis.

**Gotchas solved (record for the next instance):**
- Scripts load as classic `<script>` — `buildAnimForPlay`/`drawPlayer` are
  global and reassignable. But `gameResult`/`cameraMode` are top-level **`let`s**
  (script scope, NOT `window`): assign by **bare name** inside `page.evaluate`.
- `playerLookup` is a **Map** → serialize as entry-pairs, rebuild per game; each
  play must replay against its OWN game's ratings+lookup or named lookups fail.
- `drawPlayer(ctx, x, y, …)` → **x=args[1], y=args[2]**. An off-by-one here
  (reading args[2]/args[3]) made the detector read the color string as "y",
  `isFinite` dropped every player, and it falsely reported "0 teleports."
  **Lesson: validate the detector against a known bug before trusting green.**

**Baseline on HEAD (5 games, 279 field plays, broadcast cam):**
- **228 plays** have a player teleport over the cap · 0 non-finite · 3 ball
  anomalies (spike — legit) · 1 render error.
- Teleports span BOTH targets and secondary players (converging defenders,
  downfield blockers) — i.e. the Family-A handoff seams the scoping inventory
  flagged (`_cbFollow`, tackler `_sim` sync, `_followX`).
- The interim RB anchor-fix (`eb67c82`) corrects catch position + ball-flight
  distance but does NOT change the post-catch teleports the detector finds
  (`complete/rb` worst 20.5yd at f38→39 is identical with the fix on/off) —
  confirming those are SEPARATE seams for Stages 2–4.

**Calibrated (done).** The first baseline (228/279) was inflated by two
harness-fidelity bugs, both now fixed in `_teleport_detect.js`:
- **Coarse sampling.** Stepping only 48 frames turned continuous fast motion
  into fake jumps. Now samples at **native ~60fps** (N = round(dur/16.67)), so a
  flagged jump is a real discontinuity in `render(t)` — which the live raf loop
  samples at the same cadence, so it IS visible on screen.
- **Frozen wall-clock sims.** `_wrSim` / pursuit integrate on
  `performance.now()`; in a tight replay loop that's ~0 so they froze, and a
  frozen sim handing off to a moving branch manufactured phantom jumps. Now a
  **controlled clock** advances `performance.now()` by the play-time dt each
  frame, so those sims step exactly as they do live.
- Plus **multi-draw continuity chaining** (an entity drawn twice in a frame is
  matched to the closest prior position, not "last wins") and **severity tiers**.

**Validated against a real bug:** traced a flagged play frame-by-frame — a
defender (Renly Pope) holds his formation spot in `stance` for many frames, then
**snaps 10.6yd to his pursuit start** in one frame as the pose flips to `run`.
A genuine Family-A teleport (formation-hold → pursuit-sim handoff with no
continuity), not an artifact.

**Calibrated baseline (HEAD, 5 games / 279 field plays, broadcast):**
- **116 plays** with an EGREGIOUS (≥6yd in one ~16ms frame) player teleport ←
  the regression gate. Each migration stage must drive this DOWN.
- 242 plays with any flag (incl. borderline 2–6yd); 0 non-finite; 1 ball
  anomaly; 1 render error.
- Dominant classes: complete/wr1, /wr2, /rb, /te, /- (catch & post-catch
  handoffs) and run/-, sack/- (defender formation→pursuit snaps). Mostly
  SECONDARY players (defenders, blockers) — the seams Stages 2–4 migrate.

Usage: `node _teleport_capture.js 6` then `node _teleport_detect.js broadcast`
(dev server on :5173). Report → `/tmp/teleport_report.json`.

---

## Resume pointer

- Stages 0-11 done. **Egregious teleports down 96% (138 → 6).** Runs
  structurally clean; pass-play snap teleports closed; sack pre-snap
  shifts (DL + LB) closed; safety rotation handles all coverages
  including C0_BLITZ; INT / PD / dropped-pick ease starts from
  pre-snap render; late-YAC overshoot clamp restored via `_wrLastX`
  freeze; DIME / NICKEL / BASE_43 LB mapping now respects formation
  count.
- The structural framework: every engine track's t=0 is the formation
  slot (or `_lastRenderedX/Y` for pre-snap-shifted defenders); every
  defender's `_sim` syncs to the rendered position each frame; every
  offense slot's last rendered (x,y) is captured; post-catch
  `_wrLastX` is frozen at the catch frame so the YAC clamp's
  `_carrySign` stays stable.
- Remaining ~7 egregious plays are scattered per-play edge cases, not
  patterns — see *What's NOT closed yet* below. Each is best
  addressed with a targeted trace via `_teleport_trace.js` against
  the specific failing play if/when a user actually sees it.
- Interim patches already in: RB reference-frame remap `eb67c82`,
  FG sail/cheer `b94f8c4`. Both are subsumed by Stages 2-3.

---

## Execution log — what shipped (this session)

Five stages landed on branch `claude/charming-brown-b18u2`. All measured
against the Stage-0 detector at native 60fps × tactical (dots) view × 4
captured games (~330 field plays).

### Stage 1 — `15c0bb7` — Track t=0 = formation slot (run plays)

**Two coupled changes:**
1. Engine emits the specific tackler slot (`cb1`/`cb2`/`fs`/`ss`/`lb1-3`/`nb`)
   alongside the role string. Animation reads slot first and looks up the
   defender index directly (`_idxForSlot`) instead of hash-picking by role.
   Closes the worst case: engine emitted a play-side CB tackler track but
   the animation hash-picked the off-side CB, so the corner warped 34yd
   laterally at the snap to reach the engine's t=0 waypoint.
2. Renderer rewrites every engine-emitted track's t=0 waypoint to the
   matched formation slot's LOS-relative position before sampling. The
   `_alignT0(track, slot)` helper runs once per frame, idempotent.
   Applied to carrier, primary tackler, FS, SS, CB1, CB2.

**Results:** 138 → 137 egregious plays (variance); worst run-play jump
34.1yd → 10.0yd; f131→132 snap teleport on runs eliminated.

### Stage 2 — `2a59003` — Defender sim sync with track position

When an engine motion track drove a defender, the code previously parked
`d._sim` at the track position ONLY if the sim already existed. If the sim
hadn't been created yet (the common case for track-driven defenders), the
parking was skipped. The moment the track branch deactivated (juke flips
`isDodged`, truck flips `isTrucked`), `pursue()` CREATED `d._sim` from
scratch at the formation position — warping the defender from his track
position back to formation.

**Fix:** `_syncSimAt(nx, ny, factor)` creates the sim at `(nx, ny)` if
missing, otherwise updates position. Called every frame the track drives
the defender.

**Results:** 137 → 107 egregious; 4/6 runs flagged.

### Stage 3 — `1b0df9c` — TD celebration init + WR block target lock

Two run-play seams of the same Family-A pattern: code reading formation
home instead of previously rendered position.

1. **TD celebration init** at `runT > 0.92`:
   `if (p._followX == null) { p._followX = p.x; p._followY = p.y; }`
   At the frame celebration starts, the player teleported from his
   downfield blocking position back to formation home, then the
   velocity-based converge moved him toward the scorer. QB/OL
   "celebrate in place" branch returned `{ ...p }` with no x/y override.

   **Fix:** capture each offense slot's rendered (x, y) at the end of
   `offense.map` each frame as `_lastRenderedX/_lastRenderedY`.
   Celebration init reads from there.

2. **WR run-block target re-pick:** `sameSide.filter().reduce(nearest)`
   re-picked every frame. When the nearest CB switched sides (crosses
   midline), the WR's lerp endpoint jumped 30-50px.

   **Fix:** cache the chosen defender's INDEX (not reference — `def[]`
   is rebuilt each frame) on first selection. Lock for the play.

**Results:** 107 → 119 egregious (capture variance); **0/6 runs flagged**
— run-play teleport class structurally closed.

### Stage 4 — `c2c8b08` — Defender sim sync + carry rendered pos through snap

Same Family-A pattern, applied to pass plays. Pre-snap defenders are
shifted by coverage (CB press at 2yd, walked-up safety at 5-6yd in C0/C1,
etc.). Post-snap, `pursue()` initialized `d._sim` from `d.x`/`d.y` —
formation home — teleporting the defender 5-9 yards back to his
formation slot at t=PRE.

**Two coupled changes:**
1. `_syncDefRendered(rendered)` helper, called after every `def.map`.
   For each rendered defender, stores its position on the formation slot
   (`d._lastRenderedX` / `d._lastRenderedY`) AND syncs `d._sim` to that
   position. Mirrors Stage 2's `_syncSimAt`, applied uniformly across
   every play kind's `def.map`.
2. In the pass-play `def.map` post-snap branch, initialize `dd.x`/`dd.y`
   from `d._lastRenderedX/Y`. The `dd` object is `{ ...d }` each frame;
   without this, post-snap code reading `dd.x` as a baseline (CB follow
   init `d._cbFollowX = dd.x`, zone-bail ease from `dd.x`) snapped to
   formation slot.

**Results:** 119 → 55 egregious (−60% from baseline). Runs stay clean.
Pass-play snap teleport class largely closed.

### Stage 5 — `d0a1955` — _lastRenderedX capture + _followX init on pass plays

Propagated Stage 3's "read from last rendered position" pattern to
pass-play offense. Captures `_lastRenderedX/Y` after the complete-pass
`offense.map`; updates the downfield-blocker / TD-celebration init
(`if (p._followX == null) p._followX = p._lastRenderedX ?? p.x`).

**Results:** 55 → 61 (essentially flat). Structural fix landed but
practical impact small — most pass-play offense branches already
maintain `_followX` via `p._followX = _x` lines, so the init at line
~5501 rarely fires. Diminishing returns from this angle.

### Stage 6 — `49ae992` — Safety rotation ease + sack dd init

Two coupled changes targeting the safety pre-snap → post-snap teleport
on pass plays (~30 of the remaining 61) and extending Stage 4's dd
init pattern to the sack branch (`def.map` at ~6204).

1. **Safety rotation block at `play-animation.js:4804`** previously
   used a hardcoded `_disgX/_disgY` (two-high disguise: 11yd, ±9yd)
   as the start of the ease, and *excluded C0_BLITZ entirely*. So:
   - In C0_BLITZ, safeties skipped the ease and snapped to the
     engine track t=0 directly — a 7-8 yd diagonal jump from the
     walked-up box position to deep middle.
   - In non-blitz, the hardcoded `_disgX/_disgY` happened to match
     the pre-snap render by coincidence — until any pre-snap
     variant moved it.

   Fix: replace the hardcoded disguise with `d._lastRenderedX/Y`
   (the actual pre-snap render, captured by `_syncDefRendered`) and
   drop the C0_BLITZ exclusion. The ease now starts from wherever
   the safety was *just drawn*, regardless of coverage.

2. **Sack `def.map` at line ~6204** had its own pre-snap branch but
   no carry-forward of the rendered position into `dd`'s post-snap
   starting basis. Added the `dd.x = d._lastRenderedX` init, matching
   Stage 4 for the complete-pass branch.

**Results:** 61 → 32 (−48% vs Stage 5, **−77% vs baseline**).
Safety / incomplete-wr* snap teleports largely closed. `sack/-`
went from 6 worst 9.5yd to 1 worst 6.5yd.

### Stage 7 — `5e0f817` — INT / dropped-pick / PD ease starts from last rendered

Three coupled sites in the pass-play `def.map` (INT defender at line
5067, dropped pick at 5092, PD defender at 5129) used the same broken
pattern:

```js
dd.x = d.x + (target - d.x) * easeOutCubic(tt)
```

`d.x` is the FORMATION home. Stage 4's `dd` init had set
`dd.x = d._lastRenderedX` (the coverage-shifted pre-snap render),
but these three lines OVERWROTE that with `d.x` every frame. So at
`t = PRE+ε` the defender jumped from his press/disguise position
back to formation, then started the ease to the ball.

Flagged at f270 in the `incomplete/-` class with jumps to 21.6yd.

**Fix:** capture `_lastRenderedX/Y` as `_intStartX`, `_dpStartX`,
`_pdStartX` and ease from there.

**Results:** 32 → 14 (−56% vs Stage 6, **−90% vs baseline**).

### Stage 8 — `6735fd6` — Post-catch `_wrLastX` tracks `_wrSim`, not route

Post-catch, line 4004 unconditionally wrote `_wrLastX = wr.x`. But
`wr.x` at that point was the still-advancing ROUTE position (from
the route branch at 3899+). The post-catch branch at line 4251 then
overrode `wr.x = ballX = _wrSim.x`; the override never propagated
back to `_wrLastX`.

Downstream, `_catchX = _wrLastX` is recomputed every frame; the
route's projection keeps advancing along YAC waypoints while
`_wrSim.x` diverges. When the route's `_wrLastX` crosses `_effEndX`,
`_carrySign` flips and the overshoot clamp fires, teleporting
`_wrSim.x` back to `_effEndX`. Detector flagged this as `complete/wr1`
/ `wr2` / `te` at f421-f534 with jumps to 16 yd.

**Initial fix:** after `wr.x = ballX` in the post-catch branch, also
write `_wrLastX = wr.x`. `_wrLastX` now tracks the sim instead of the
still-running route.

**Results:** 14 → 10 (−29% vs Stage 7, **−93% vs baseline**).

**Note:** Stage 8's fix was *superseded by Stage 9* — see below. The
update at line 4253 had a side effect of breaking the clamp entirely
(by keeping `_catchX = sim.x` constant, `_carrySign` flipped exactly
when needed, making the clamp condition false on both sides of
`_effEndX`). Stage 9 replaces it with a cleaner freeze-at-catch
approach.

### Stage 9 — `1e92925` — Freeze `_wrLastX` at catch + sack LB last-rendered

Two coupled changes.

1. **POST-CATCH `_wrLastX` FREEZE.** The proper structural fix for
   the late-YAC overshoot, replacing Stage 8's workaround. Only
   update `_wrLastX` during the route phase by gating line 4004 on
   `t < throwPhase`. Once past `throwPhase`, `_wrLastX` stays at
   the catch-frame value. `_catchX` constant; `_carrySign` stable;
   the overshoot clamp fires correctly only when `_wrSim.x` *truly*
   overshoots `_effEndX` (small per-frame correction, not a teleport).
   Stage 8's downstream update at line 4253 removed.

2. **SACK BRANCH LB SCRAPE.** Line 6397 `dd.x = d.x - dir * lbProg * 12`
   used formation as base. For a walked-up LB blitzer, pre-snap
   `d._lastRenderedX` is at the walked-up position; the post-snap
   scrape snapped back to formation slot — a 14yd jump on `sack/-`
   plays at f131. Fix: base from `d._lastRenderedX` (fallback to
   `d.x`), mirroring the Stage 6 safety rotation pattern.

**Results:** 10 → 7 (−30% vs Stage 8, **−95% vs baseline**).
Closes `complete/wr2` late YAC, `sack/-` LB walked-up, drops
`complete/rb` from 6 to 2 plays.

### Stage 10 — `575f705` — DL formation-jitter fallbacks read last-rendered

Sweep through remaining `d.x`-anchored fallback paths in the
def.map (three sites: run-play DL formation hold, complete-pass DL
engagement-unavailable fallback, sack-branch DL holds). All converted
to base from `d._lastRenderedX` so pre-snap shifts carry through.

**Results:** 7 → 8 egregious (capture variance — statistically
equivalent at this magnitude). Structural cleanup but small practical
impact because DL pre-snap shifts via `defShiftXY` are small (≤2yd).

### Stage 11 — `f4d5466` — LB-track mapping by package, not ordinal

First-principles trace of a single incomplete PD play (via
`_inc_trace.js`) revealed a real systemic bug. The LB → engine-track
mapping used the defender's POSITIONAL ORDINAL in the formation array
(`lb1` = index 0, `lb2` = 1, `lb3` = 2), regardless of how many LBs
were on the field. In DIME and QUARTER packages, the single LB is the
MLB (middle linebacker), but ordinal 0 mapped it to the `lb1` track —
the TOP-side hook (−7 yd from middle).

Result: the DIME LB at `cy` snapped to `lb1`'s t=0 waypoint at
`cy − 42` (2.8 yd Y delta) at the snap, and his entire coverage
assignment for the play was wrong (running the top hook, leaving
the middle unmanned).

**Fix:** route by formation LB count (`idxCB1 − idxLB1`):

| LB count | Package | Mapping |
|---|---|---|
| 3 | BASE_43 | `lb1` / `lb2` / `lb3` by ordinal (unchanged) |
| 2 | NICKEL  | ordinal 0 → `lb1`, ordinal 1 → `lb3` (outside hooks) |
| 1 | DIME    | ordinal 0 → `lb2` (middle / MLB) |
| 0 | QUARTER | n/a |

Tracing tool committed: `_inc_trace.js` — a single-play per-frame dump
similar to `_teleport_trace.js` but ranges over all players and finds
the worst per-frame jump. That's how this bug surfaced.

**Results:** 8 → 6 (**−96% vs baseline**). Borderline class also
dropped 122 → 82 plays — the DIME-LB mismapping produced many
small misalignments across plays that were under the egregious
threshold individually but all relaxed at once with the correct
mapping.

---

## Pre-refactor session fixes (this session, not Stage work)

Four earlier commits this session were focused fixes that surfaced during
the investigation but didn't fit the staged refactor. They're part of the
same branch and were validated independently:

| Commit | What |
|---|---|
| `c854d51` | Bind tackle-time to `play.motion.tackleT` — `play-animation.js` had `0.72` hardcoded in five run-play gates while the engine emitted `tackleT = 0.78`. Ragdoll fired ~125ms before the tackler arrived. Single source of truth pattern (prefigured Stage 1). |
| `a6f4f33` | Emit `play.force` on runs from the engine's biomechanics. `_bumpHitWear` already computes a 0.5-2.2 force based on tackler STR/SPD/archetype; the run path now captures it and surfaces as `play.force = engineForce * 5`. Animation reads it for ragdoll impulse + slow-mo depth. |
| `520c5c1` | I-Form FB/RB spacing — formation had FB at `cy+4`, RB at `cy+6` (2px Y separation), which read as overlapping sprites stacked behind the QB. Fixed to proper I-Form depths (FB -9yd back, RB -12yd back, both on midline). |
| `72526ac` | I-Form carrier-track start aligned with renderer 2-back style. The engine's carrier track `t=0` was hardcoded at single-back depth (-8yd, +1.87yd); on I-style 2-back runs the RB sprite teleported 4yd forward + 28px at runT=0. Engine now picks the 2-back style deterministically per snap, emits `twoBackStyle`, and adjusts the carrier track `t=0` accordingly. |

---

## Detector — usage cheat sheet

The `_teleport_capture.js` + `_teleport_detect.js` harness is the
regression gate. The one-command form (seeded + baseline-compared):

```
./_teleport_gate.sh                   # capture(seed=1337,4g) → detect → compare baseline; exit 1 on regression
```

Or the manual form:

```
node _teleport_capture.js 4           # SEEDED battery (default seed 1337 → reproducible)
nohup npx --yes http-server -p 5173 -c-1 -s . > /tmp/dev-server.log 2>&1 &
node _teleport_detect.js tactical     # detect against tactical (dots) view
# headline at top of stdout: egregious-plays count
# full detail: /tmp/teleport_report.json
```

Live diagnostic for a single play: enable `window.GC_DEBUG_TELEPORT = true`
in the console; the continuity guard (`play-render.js:608`) logs every
per-frame jump >12px with the player's name, jump magnitude, branch
(SNAP/glide), and destination coords.

For run-play tackle diagnosis: `window.GC_DEBUG_TACKLE = true` logs
tackler↔carrier distance, role, position at impact.

---

## Determinism — the metric is now reproducible (post-refactor follow-up)

The Stage-0 detector was sound in *kind* (it replays the REAL render path and
flags ≥6yd/frame jumps, which are genuine on-screen pops) but its inputs were
**non-deterministic**: `_teleport_capture.js` simulated fresh stochastic games
every run (the engine draws `Math.random` in ~142 sites, unseeded). So every
measurement used a different battery, and the egregious count wobbled
**4–13 on identical code**. Consequences that were hiding in the stage numbers:

- The "138 → 6, 96%" headline is *directionally* real (the borderline band fell
  too, runs went structurally 0/6) but the precision is false — the doc's own
  baseline is quoted as both **116** (calibration text) and **138** (the table).
- Three "stage wins" actually went the wrong way (S2→S3 107→119, S4→S5 55→61,
  S9→S10 7→8) and were waved off as "variance" — correctly, but that same
  variance applies to the deltas counted as progress.
- The "floor 6, alarm if >10" gate would **false-alarm on its own committed
  code**: the reproducible count on the canonical battery is **11**, not 6.

**Fix (this follow-up):** `_teleport_capture.js` now overrides `Math.random`
with a seeded mulberry32 PRNG **inside its eval scope only** — the shipped game
engine is untouched and stays stochastic for real players. Same seed → byte-
identical battery (verified by sha256) → reproducible count. The detector was
already deterministic given a fixed battery (`play-animation.js` has zero
`Math.random`; the 18 in `play-render.js` are in stubbed visual-only draws).

Artifacts:
- `_teleport_baseline.json` — canonical numbers (seed 1337, 4 games, tactical):
  **11 egregious / 82 flags / 336 plays** at commit `f8d7012`.
- `_teleport_gate.sh` — runs the seeded pipeline and exits 1 if egregious
  exceeds the baseline. Verified: passes at 11≤11, fails at 11>10.
- `_teleport_detect.js` — Playwright path is now resolved portably
  (`PLAYWRIGHT_LIB` env → module resolution → this env's hardcoded path), so
  the detector runs in CI as well as here.

Triggers (so the gate actually guards):
- **Pre-commit hook** (`.githooks/pre-commit`, repo root) — fires only when
  position-critical game files (`play-animation/engine/render/motion.js`) are
  staged; runs the gate, blocks on regression (rc 1), warns-but-allows if the
  harness is unavailable (rc 2). Install once: `git config core.hooksPath .githooks`.
  Bypass a single commit with `git commit --no-verify`.
- **GitHub Action** (`.github/workflows/teleport-gate.yml`) — installs
  Playwright + Chromium, points the detector at the global install via
  `PLAYWRIGHT_LIB`, runs the gate on push/PR that touch the watched paths, and
  uploads `/tmp/teleport_report.json` as an artifact on failure.

Re-baseline after a genuine improvement by lowering `egregious` in the JSON in
the same commit as the fix. **Don't compare across seeds** — seed 99 is a
different (also fixed) battery with a different absolute count.

---

## Baseline vs current — at a glance

| Stage | Commit | Egregious | Runs flagged | Worst run jump |
|---|---|---|---|---|
| 0 baseline | — | 138 | 6/6 | 34.1 yd |
| 1 | `15c0bb7` | 137 | 5/6 | 10.0 yd |
| 2 | `2a59003` | 107 | 4/6 | 11.1 yd |
| 3 | `1b0df9c` | 119 | **0/6** | none |
| 4 | `c2c8b08` | 55 | 0/6 | none |
| 5 | `d0a1955` | 61 | 0/6 | none |
| 6 | `49ae992` | 32 | 0/6 (1/6 variance) | 18 yd outlier |
| 7 | `5e0f817` | 14 | 0/6 | none |
| 8 | `6735fd6` | 10 | 0/6 | none |
| 9 | `1e92925` | 7 | 0/6 | none |
| 10 | `575f705` | 8 (variance) | 0/6 | none |
| 11 | `f4d5466` | **6** | 0/6 | none |

`(Stage 3's 119 vs Stage 2's 107 is capture variance — the run-play
composition flipped to clean, which is the durable signal.)`

---

## What's NOT closed yet — RE-DIAGNOSED on the deterministic battery

On the seed=1337 battery the floor is now **8 egregious plays** (was 11; the
`run/-` truck-snap class is closed — see *Stage 12* below). Not 6 — see
*Determinism*. The remaining classes:

| Class | × | Worst | Example (player · frame · jump) |
|---|---|---|---|
| ~~`run/-`~~ | ~~3~~ | ~~21.8yd~~ | **CLOSED** (Stage 12 — trucked-defender continuity) |
| `complete/wr1` | 3 | 11.3yd | WR f445→446, (499,74)→(360,172) |
| `complete/rb` | 3 | 10yd | RB/defender f150-484 |
| `complete/wr2` | 1 | 14.5yd | WR f496→497 |
| `incomplete/-` | 1 | 20.5yd | f270→271 |

**The handoff's "TD-celebration `complete/wr1`" hypothesis is WRONG** — verified
by frame-by-frame trace (`/tmp/trace_play.js`, kept under `_inc_trace.js`
lineage). None of the flagged `complete/wr1` plays are TDs (endYard 68/77, not
100+); the receiver pose at the jump is `hit`/`run`, never `celebrate`.

**The true root cause is a single seam: the tackle-frame snap.** Every one of
these is the same signature:

1. A player is drawn at position A for the whole pre-tackle phase — a defender
   at his scrape/coverage spot, or a carrier at his YAC-sim spot.
2. At the tackle frame his pose flips to `tackled` / `hit` / `ragdoll` and he
   **snaps in one frame to position B** — the engine's tackle/rest coordinate
   (next to where the carrier was downed).
3. He then freezes / ragdolls from B.

Mechanism (located, not yet fixed): the primary tackler is driven by
`play.motion.tracks.tackler` via `MotionPlayback.sampleTrack` (`play-animation.js`
~2761-2820; `_useTacklerMotion` skips the continuous rubber-band at ~2897 because
"the waypoint path already lands on the carrier at t=0.78"). The pre-tackle
scrape/coverage branch holds the player at a static early position while that
track advances toward the carrier; when the tackle pose releases to the track
sample, it lands on the carrier — a discontinuity of up to 22yd. The pass-play
`complete/*` cases are the SAME seam (a tackling **defender** snapping to the
carrier-end at the tackle), **not** the receiver/`_wrSim` path — see *Stage 13*,
which disproves the earlier `_wrSim` hypothesis by instrumentation. It is the
**same Family-A seam at the tackle boundary** that the `_lastRenderedX`
convention never reached.

**Why it isn't patched here:** the fix is not a one-liner. Either (a) the
pre-tackle branch must sample the (continuous) tackler track instead of freezing,
or (b) the tackle pose must EASE the anchor from the player's last-rendered
position to the tackle spot over the ragdoll window, applied at every tackle-pose
site (carrier ragdoll ~2358, primary tackler ~2920, pile-on ~2937, trucked ~2860,
receiver post-catch ~4199). The blast radius is every tackle animation across
every play kind — too wide to land safely without a dedicated session. With the
seeded gate now guarding (baseline 11), that work is now *measurable*: a correct
fix should drop the count toward ~1-2 (the `incomplete/-` outlier may be separate)
with no regression. Recommended approach: option (a) for the track-driven tackler
(keep one source of truth), option (b)'s ease only for the ragdoll-physics sites.

### Stage 12 — trucked-defender continuity (`run/-` truck-snap closed)

First tackle-seam site fixed, gate-verified. Confirmed by instrumented trace
that the `run/-` 21.8yd jumps were the **trucked defender** (`isTrucked =
i === dodgeIdx && rbPose === "truck"`, ~2713): when `truck` flips true, the
branch at ~2860 hard-set `dd.x = rb.x + dir*6` (the carrier), teleporting the
victim from his scrape spot to the carrier — up to 22yd — because his pursuit
sim never converged (he was 22yd away at truck onset).

**Fix:** capture the victim's last-rendered position (`dd.x/y`, already set from
`np` just above) at truck onset and ease to the carrier anchor over a 0.18-runT
window (smootherstep), instead of snapping. The "bowled over" motion now reads
as a continuous slide; max per-frame delta dropped from 328px to ~13px.

**Result (seed=1337):** 11 → **8** egregious. `run/-` ×3 closed; no regression
(remaining 8 are exactly the prior non-run classes). Baseline lowered to 8.

### Stage 13 — `complete/*` re-diagnosis (investigated, NOT yet fixed)

Traced the remaining `complete/wr1` egregious (e.g. play#76, flagged player
"Malik Karpov", f425→426 (560,71)→(450,158), then frozen). Two earlier
hypotheses **disproven by instrumentation**:

1. **Not the receiver / `_wrSim`.** Instrumented `_wrSim` directly: it moves
   perfectly smoothly to its endpoint (preClamp == postClamp every frame, the
   overshoot clamp never fires a big correction). The targeted receiver on that
   play is "Rob Pukui", not the flagged player — `_wrSim` is a red herring.
2. **The flagged player is a TACKLING DEFENDER**, drawn with pose `hit`, whose
   POSITION snaps to the carrier's tackle spot at the tackle frame and freezes.
   This is the **same family as Stage 12** (the run/truck tackle snap), just on
   pass plays — *not* a receiver/YAC issue.

Where it is NOT: the pass def.map contact-snap (`~5063-5067`, `dd.x = ballX ±
CONTACT_DIST`) does **not** fire for this defender (instrumented — no hits). So
his position is set further upstream in the pass def.map pursuit/tracker path
(likely the `_passTacklerTrack` sample or a pursuit handoff landing on the
carrier-end spot at the tackle window), which this session did not fully pin.

**Why not fixed:** the exact upstream line wasn't isolated, and that block
(pursuer set / locked-tackler / `_passTacklerTrack` / pile-on) is densely
nested. Per the session's own rule, no guess-patch into tangled tackle code just
to move the gate number — the fix must be as understood as Stage 12 was.
**Next step:** instrument the pass def.map per-defender at its `return dd` for
the flagged defender, find the line that lands him on the carrier-end at the
tackle window, then apply the Stage-12 ease-from-last-rendered pattern;
gate-verify (target 8 → ~2). The `incomplete/-` 20.5yd outlier is likely the
same family (a defender on the incomplete-pass tackle/break).

Gate remains green at the 8 baseline (no code shipped this stage).

**Stage 13 follow-up (second tracing pass — dead-ends, so the next effort skips
them):** the flagged player is confirmed a **CB** (`role=CB`), drawn `hit`,
snapping (560,71)→(450,158) at f426 then frozen. Key surprise: the **complete-pass
def.map at `play-animation.js:4430` (the obvious one — `_postCatchPursuerSet`,
`_isPassTacklerByName`, the `hit` tackle at ~5083) does NOT execute at the tackle
frame.** Instrumented its `return dd` (5222) and the `isPursuer` line (4974) to
fire for ALL defenders at t∈(0.865,0.868) (≈f425-426): **zero hits.** The pre-snap
early-return at 4505 is `t<PRE` only, so that's not it. Conclusion: post-catch
defender rendering for the flagged CB goes through a **different / second render
path** than the 4430 map — `render(t)` appears to be multi-phase, and the CB's
`hit` draw at the tackle comes from a path not yet located (a separate post-catch
def render, or a tackle-pile/overlay draw). **The actual next probe:** monkeypatch
`drawPlayer` to log the call STACK (or a unique marker per draw site) for the
flagged CB at f426 — that names the exact draw site directly, instead of guessing
which def.map. Two diagnoses down (not TD-celebration, not `_wrSim`); the render
path itself is the remaining unknown.

**Stage 13 follow-up #2 (call-site probe — ran the stack trace):** wrapped
`drawPlayer` to capture `new Error().stack` for the flagged CB at f424/425/426.
**Exact draw site, all three frames:**
`drawPlayers (play-animation.js:1268)` ← `render (play-animation.js:5803)`. Line
5803 is `drawPlayers(off, def)`; there is exactly one `const def =
formation.defense.map(...)` in scope (the 4430 map), so `def` *is* the 4430 map
output. **The blocker:** instrumenting that map's own return (line 5223, the
`return dd` — verified placement) to fire for ALL defenders at the tackle frame
gives **zero hits**, even role=CB across t∈[0.84,0.88]. So the map's return is
not executed at the tackle frame, yet `drawPlayers(def)` at 5803 still draws the
CB from `def`. That's only possible if `def` at 5803 is built in a scope/cadence
other than the per-frame 4430 map (a cached array, an outer-scope reassignment,
or a second render path sharing the name) — render indirection not yet unravelled.
**The actual next probe (start here):** instrument INSIDE `drawPlayers`
(`play-animation.js:1268`) — log each element's `(name, x, y)` as it draws — and
separately map the control flow around line 5803 (is `def` the 4430 result that
frame, or something else?). That resolves the indirection; the position fix
itself (ease the CB's tackle-convergence from last-rendered) is the easy part
once the array feeding 5803 is identified. Three diagnoses down; the obstacle is
now a specific, narrow structural question, not a hunt.
