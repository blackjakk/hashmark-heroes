# Hashmark Heroes — Handover Document
*(originally documented as "GridironChain"; renamed 2026-05)*

## 1. Project overview

**What we're building**
GridironChain is a vanilla HTML/CSS/JS football franchise simulation (no build tools). State persists in localStorage + IndexedDB under `gc_franchise_v1_slot_<id>`. The codebase is large (~44k lines across the main play-franchise-*.js files) and has evolved through dozens of major features. The current arc is pushing toward "class-leading" — beating Madden / 2K / Football Manager / OOTP on engine realism and visual quality.

**Current state**
Mature, deeply-featured. Recent work has shifted from contract/extension UX (settled) and engine physics (settled, in NFL elite stat bands) to the **visual / broadcast layer** — making the live game viewer feel like a real TV broadcast rather than a top-down sprite simulator. Replay system + week recap + scrubbable timeline now ship alongside the broadcast camera.

---

## 2. Repository / environment

- **Repo path**: `/home/user/datasciencecoursera/gridiron-chain/` (or Windows: `C:\Users\bsg50\PyCharmMiscProject\datasciencecoursera\gridiron-chain\`)
- **Active branch**: `claude/charming-brown-b18u2`
- **Latest commit**: `ba248ad` (Stage 11 LB-track package mapping + DL formation jitter sweep + late-YAC overshoot freeze + post-catch _wrLastX freeze + safety rotation ease + INT/PD/dropped-pick ease starts + sack LB last-rendered + many more — see § 3 *position-contract refactor*)
- **Stack**: vanilla JS, no bundler. Files concatenated via `<script src>` in `play.html` in this order: `play-data.js` → `play-franchise-core.js` → `play-franchise-season.js` → `play-franchise-stats.js` → `play-franchise-offseason.js` → `play-engine.js` → `play-broadcast.js` → `play-render.js` → `play-animation.js`. Top-level `const`/`function` declarations are cross-file accessible.
- **Lint/test**: `node -c <file>.js` for syntax checks (no other tests). User views via CDN: `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html`
- **Teleport detector** (this session, durable): `node _teleport_capture.js 4 && node _teleport_detect.js tactical`. Stage 11 floor = 6 egregious plays out of ~300 (96% reduction from a 138-baseline). Use the `teleport-check` skill (user-level `~/.claude/skills/teleport-check/`) to run + interpret.
- **Save layer**: `_idbPut`/`_idbGet` is primary; localStorage is the fast mirror. Auto-trim at 4MB via `_trimFranchiseForStorage`. Diagnostic: `frnSaveDiagnostics()` from devtools.
- **Verification helpers** (in `/tmp/`): `snap_calib.mjs` (projection dots on field), `snap_scrub.mjs` (timeline interaction), `snap_backfill.mjs` (round-trip a stripped save). All assume `python3 -m http.server 8765` running in repo root.

---

## 3. Current arc — position-contract refactor: 96% teleport closure (this session)

End-to-end execution of the `REFACTOR_POSITION_CONTRACT.md` design that
had been sitting at "DESIGN — awaiting go-ahead" since prior sessions.
Stages 0-11 shipped. Egregious teleport plays dropped **138 → 6 (96%)**.
Runs are structurally clean (0 / 6 flagged). The snap-teleport class is
closed across run, complete-pass, incomplete-pass, sack, and the
DIME-LB-on-wrong-hook subclass.

### How the work was driven

The whole arc followed the methodology now captured in the
`stage-gated-refactor` skill (`~/.claude/skills/stage-gated-refactor/`):
contract doc first → build detector (Stage 0) → measure baseline → ship
one boundary per stage with measured deltas → docs commit per stage →
name what's superseded by later cleaner fixes → stop honestly at
diminishing returns. See the skill for the methodology and
`REFACTOR_POSITION_CONTRACT.md` for the canonical worked example.

### Pre-refactor session fixes (4 commits, before Stage 1)

| Commit | What |
|---|---|
| `c854d51` | Bind tackle-time to `play.motion.tackleT` — 5 hardcoded `0.72` gates in `play-animation.js` were drifting from the engine's `tackleT: 0.78`. Ragdoll was firing ~125 ms before the tackler arrived. |
| `a6f4f33` | Emit `play.force` on runs from engine biomechanics. `_bumpHitWear` already computes a 0.5-2.2 force from tackler STR/SPD/archetype; the run emit path now surfaces it as `play.force = engineForce * 5`. Animation reads it for ragdoll impulse + slow-mo depth. |
| `520c5c1` | I-Form FB/RB spacing — FB was at `cy+4`, RB at `cy+6` (2 px Y separation, sprites overlapping QB). Fixed to FB at -9 yd, RB at -12 yd, both on midline. |
| `72526ac` | Engine carrier-track t=0 was hardcoded at single-back depth. On I-style 2-back runs the RB sprite teleported 4 yd + 28 px at runT=0. Engine now picks the 2-back style deterministically per snap, emits `twoBackStyle`, and adjusts the carrier track t=0 accordingly. |

### Position-contract refactor stages (11 commits + 5 docs commits)

| Stage | Commit | What changed | Egregious after |
|---|---|---|---|
| 1 | `15c0bb7` | Engine emits specific `tacklerSlot` (cb1/cb2/fs/ss/lb1-3/nb), animation reads slot directly; renderer rewrites every engine-track t=0 waypoint to the matched formation slot before sampling. | 137 |
| 2 | `2a59003` | Defender `_sim` sync with track position — `_syncSimAt(nx, ny, factor)` creates the sim at the track position if missing instead of letting `pursue()` lazily create it at formation. | 107 |
| 3 | `1b0df9c` | TD-celebration init + WR-block target lock — capture `_lastRenderedX/Y` after the run-play offense map; cache the WR's chosen block defender INDEX (not reference) on first selection. | 119 (runs hit 0/6) |
| 4 | `c2c8b08` | `_syncDefRendered(rendered)` after every `def.map` syncs `d._sim` to the rendered position uniformly; pass-play `def.map` post-snap init reads `dd.x = d._lastRenderedX`. | 55 |
| 5 | `d0a1955` | Same `_lastRenderedX` capture pattern applied to pass-play offense map + `_followX` init. | 61 (variance) |
| 6 | `49ae992` | Safety rotation ease uses `d._lastRenderedX/Y` as `_disgX/_disgY` (replacing hardcoded 11yd/9yd disguise) and applies to C0_BLITZ too; sack `def.map` post-snap init reads `dd.x = d._lastRenderedX`. | 32 |
| 7 | `5e0f817` | INT defender + dropped-pick + PD-defender ease all start from `d._lastRenderedX/Y` instead of `d.x` formation home. | 14 |
| 8 | `6735fd6` | Post-catch `_wrLastX = wr.x` after the override. **SUPERSEDED by Stage 9.** Closed the visible late-YAC teleport but silently broke the overshoot clamp by making `_carrySign` flip exactly where the clamp condition needed to hold. | 10 |
| 9 | `1e92925` | Freeze `_wrLastX` at the catch frame (gate line 4004 on `t < throwPhase`) — the structurally correct fix. `_catchX` and `_carrySign` stay stable, clamp fires only on real overshoot. Also: sack-branch LB scrape bases from `d._lastRenderedX`. | 7 |
| 10 | `575f705` | Sweep through DL formation-jitter fallback paths (3 sites: run-play DL hold, complete-pass DL engagement-unavailable, sack-branch DL holds) — all read `d._lastRenderedX/Y`. Practical impact small (DL shifts are small) but uniform. | 8 (variance) |
| 11 | `f4d5466` | **Real systemic bug.** LB → engine-track mapping used positional ordinal (index 0 → `lb1`), so in DIME packages the single MLB was driven to the top-side hook. Now routes by formation LB count: BASE_43 = unchanged; NICKEL = lb1/lb3 (outside hooks); DIME = lb2 (middle MLB). | **6** |

Docs commits paired with the code stages: `2918432` (Stages 1-5),
`20d522b` (Stage 6), `a0948f5` (Stages 7-8), `b805add` (Stage 9),
`8dc1b6b` (Stages 10-11).

### Durable tools shipped this session

- `_teleport_capture.js` / `_teleport_detect.js` / `_teleport_trace.js` —
  these existed BEFORE the session (Stage 0 was already built in a prior
  session). They were the enabler.
- `_inc_trace.js` (new this session, `ba248ad`) — single-play per-frame
  dump that finds the worst per-frame jump across all rendered players.
  Currently configured to target `complete/wr1` TD plays (edit the
  selector loop at the top to retarget). That's how the Stage 11
  DIME-LB-mapping bug surfaced.

### Skills added (user level, `~/.claude/skills/`)

- **`stage-gated-refactor`** — general-purpose, codifies the methodology
  (contract doc → detector → stage commits with deltas → honest
  supersession → stop at diminishing returns). References
  `REFACTOR_POSITION_CONTRACT.md` as the canonical example.
- **`teleport-check`** — gridiron-chain-specific. Wraps the harness into
  one command, knows the Stage 11 floor (6 plays), lists the closed
  classes so you don't false-alarm on expected residuals, and tells
  you what to do when a new class appears.

Both are user-level, NOT in this repo (the repo's `.claude/` is
gitignored — intentional). They persist for this user across all
sessions on this container.

### Audit caveats honestly recorded

- **Stage 8 was superseded by Stage 9.** Stage 8's `_wrLastX = wr.x`
  patch closed the visible late-YAC teleport but had a subtle side
  effect: keeping `_catchX = sim.x` made `_carrySign` flip exactly when
  the overshoot clamp should fire, silently disabling it. Stage 9
  replaced it with the structurally correct freeze-at-catch. Both
  stages are in git history; the contract doc records the supersession.
- **Stage 5 was structurally correct but practically flat.** The
  failure mode it targeted was rarely hit (route branch maintains
  `_followX` every frame). Recorded as flat.
- **Stage 10 was a uniform DL sweep that didn't reduce the egregious
  count** (DL pre-snap shifts via `defShiftXY` are small, ≤2 yd).
  Recorded as variance-equivalent. The fix is still right because it
  uniformizes the source-of-truth pattern.
- **Stage 11's NICKEL mapping** is a small improvement of similar
  magnitude in both directions (top → lb1, bottom → lb3). The big win
  was the DIME case (1 LB → lb2 instead of lb1). Both shipped together.

### What's NOT closed yet (after Stage 11)

Per the detector's class breakdown, **6 egregious plays remain**, in
2 patterns:

1. **TD-celebration window `complete/wr1`** (× 3 plays at f452+,
   worst 15.7 yd). For passes that end as TDs, the target receiver
   transitions through `wrPose = "celebrate"` at `aT > 0.90`. `_inc_trace.js`
   pointed at TD plays didn't reproduce the jump in 1-game captures —
   likely interacts with the wall-clock slow-mo window
   (`animState.slowMoUntil` set in `play-animation.js:2380+`) at the
   celebration transition. Worth instrumenting at the next user report.
2. **`complete/rb` checkdown + `complete/wr2` outliers** (× 3 plays,
   7-10 yd). Per-play handoff timing edge cases that don't replay in
   `_inc_trace.js` on similar-looking plays.

These are scattered per-play timing windows, not patterns. The
structural framework is closed. The detector + `_inc_trace.js` will
identify the override site in seconds at the next user report.

### Latest commits on this arc

- `ba248ad` — chore: `_inc_trace.js` retargeted to complete/wr1 TD plays
- `8dc1b6b` — docs: record Stages 10-11 (96% reduction, +DIME-LB fix)
- `f4d5466` — fix: LB-track mapping by package, not ordinal (Stage 11)
- `575f705` — fix: DL formation-jitter fallbacks read last-rendered (Stage 10)
- `b805add` — docs: record Stage 9 (95% reduction)
- `1e92925` — fix: freeze `_wrLastX` at catch + sack LB last-rendered (Stage 9)
- `a0948f5` — docs: record Stages 7-8 (93% reduction)
- `6735fd6` — fix: post-catch `_wrLastX` tracks `_wrSim`, not route (Stage 8 — superseded by Stage 9)
- `5e0f817` — fix: INT/dropped-pick/PD ease starts from last rendered (Stage 7)
- `20d522b` — docs: add Stage 6 results (77% reduction)
- `49ae992` — fix: safety rotation ease + sack dd init (Stage 6)
- `2918432` — docs: record Stages 1-5 progress + session fixes
- `d0a1955` — fix: `_lastRenderedX` capture + `_followX` init on pass plays (Stage 5)
- `c2c8b08` — fix: sync defender sim + carry rendered pos through snap (Stage 4)
- `1b0df9c` — fix: TD celebration init + WR block target lock (Stage 3)
- `2a59003` — fix: sync defender sim with track position (Stage 2)
- `15c0bb7` — fix: enforce track t=0 = formation slot for run plays (Stage 1)
- `72526ac` — fix: align engine carrier-track start with renderer 2-back style
- `520c5c1` — fix: I-Form FB/RB spacing — sprites no longer overlap QB
- `a6f4f33` — fix: emit `play.force` on runs from engine biomechanics
- `c854d51` — fix: bind tackle-time to engine's `play.motion.tackleT`

---

## 3A. Earlier arc — animation realism + sprite atlas expansion (prior session)

The shipped focus this session was making each play TYPE read distinctly and
realistically (so a sack doesn't look like a clean dropback, a fumble doesn't
look like a tackle, etc.), plus generating dedicated PixelLab sprites for the
most-aliased poses. ~40 commits, ~700 sprite files added.

### Principle saved to memory (durable feedback)

**`no-outcome-preview`** — the game must never tip a play's result before
the on-field moment. No crowd cheer / SFX / banner / pressure indicator
before its cause is visible. Five gate fixes shipped this session for the
known leaks (sack pressure ring, strip-sack sub-banner, fumble recovery
banner, fumble context card, INT context card). Reference memory file:
`C:\Users\bsg50\.claude\projects\C--Users-bsg50-PyCharmMiscProject\memory\feedback_no_outcome_preview.md`.

### Sprite atlas — 14 new dedicated pose folders

All ball-in-hand variants live on the `football tucked unde` PixelLab character
(`ed3c9fef-4048-48a5-b22e-1d3f17162ab0`). Defensive/OL poses on `Default`
(`6f395002-3f23-475d-a406-f17b51605f6b`). Refs on user's capped variant
(`488d33da-c825-44c5-a15d-23f15c646a75`).

| Pose | Source | Notes |
|---|---|---|
| `carry` | football-tucked-under | Ball tucked, foundation for all carry-derived poses |
| `juke` | ball-tucked | RB juke move |
| `spin` | ball-tucked, **8 frames** | Full 360°; east/west iterated separately by user |
| `hurdle` | ball-tucked | All 8 directions now (was 7) |
| `truck` | ball-tucked | Pads-low driving through contact |
| `stiff_arm` | ball-tucked | Free arm extended |
| `kick_slide` | Default | OL pass-pro |
| `backpedal` | Default | DB facing forward, moving back (replaces wrong-way `run` alias) |
| `dive_forward` | Default | Lay-out dive |
| `ref_idle` / `ref_td_signal` / `ref_first_down` / `ref_flag` / `ref_whistle` | capped ref | Penalty feature prereq |

Extraction script: `sprites/_extract.py` reads downloaded PixelLab ZIPs (named
`_carry-character.zip`, `_default-character.zip`, `_ref-character.zip`),
remaps `frame_001..N → 0..N-1` (PixelLab v3 mode emits a reference frame at
000 that we skip), writes to `sprites/<pose>/<direction>_<idx>.png`. The
`SOURCES` table maps PixelLab folder-name prefixes → pose name. **When
extending: be careful with prefixes** — `"running"` would match
`"running_back_executing_*"` too. Use `"running-"` (with trailing dash) to
target only the template animation folder.

Atlas wiring lives in `play-sprites.js`. Each entry is `{ folder, frames, dirs }`.
Spin is the only pose currently at `frames: 8`; all others 4. `dirs` is
`_DIRECTIONS` for everything except `kick` (`_KICK_DIRS`, 6 dirs).

### Gameplay polish (one commit per area)

**Sacks** — rework into a 3-beat play: developing pass play → rusher wins
visibly → contact + pile + celebration.

- `2800-4500ms` action duration (was scaledDuration formula)
- `contactT` range 0.62-0.75 (was 0.62-0.88); first ~65% looks like a normal pass play
- `rushReleaseT = max(0.45, contactT - 0.12)` (was contactT - 0.35); rusher wins shortly before contact
- QB drift is closeness-scaled bias AWAY from estimated primary rusher position (was random seeded sin)
- All non-rushing DL release from OL at `contactT + 0.05` and converge on QB
- Primary sacker transitions sack → celebrate at `contactT + 0.15`
- WRs run real routes (streak/out/dig) during scan so the developing play reads
- Per-frame rumble + crowd `bigplay` swell fire AT contact (was at snap from `_isBigPlay`)
- OL matched to primary rusher by position-index (`primaryIdx → LT/LG/RG/RT`) gets visible extra
  shove + lean + `engage → stiff` transition at `rushReleaseT`
- Strip-sack (engine surfaces `play.isStripSack` / `play.recoveredByDef`): ball pops loose with
  bounce physics, primary sacker dives onto ball instead of celebrating, pile converges on ball,
  STRIP-SACK + recovery banner

**Fumbles** — `play.forcedBy` now resolved against `formation.defense`; forcer sprints to carrier
and arrives AT `CARRY_END` in `dive → tackled` for the visible hit. Pulsing amber halo around
loose ball during strip + roll window. Strip arc bumped 10→16 px, roll uses 3 decaying bounces.
Recoverer (closest pile member on recovering side) stands + celebrates at `SCRUM_END`.

**Pass plays** —
- Catch-arrival and post-catch-carry hand-tracking branches gated to `play.kind === "complete"`
  so incomplete passes show the bounce physics instead of being yanked onto the WR's hand
- `incOffsetX/Y` added for `incReason === "pd"` (defender swats ball off trajectory)
- Named PD defender (`play.defender`) closes on the ball, leaps and swats at the catch frame, lands
- Catch pose t no longer cycled by wall-clock — now driven once across the catch window (no more
  pump-catch loop)
- INT freeze (`280ms slowMo` + amber field flash + bigplay swell) synced to the actual pick frame
- Big-catch / big-run / interception **pulled out of start-of-play `_isBigPlay`** — crowd
  reactions now inline-fired from per-play render at the catch / break-through / pick moment
- Deep-ball WR teleport fixed at the root: engine and renderer used DIFFERENT formulas to compute
  the catch waypoint. Engine emits `play.motion.throwT`; renderer now uses that as `throwFrac`
  when motion is present so the route-track sample at the catch frame and the post-catch `_wrSim`
  initialization land at the same `aT`. Drop ratio kept constant at 0.42 of throwFrac.
- Short TE/RB throws (`targetDepth <= 3` && target slot is te/rb) get a SWING/FLAT shape in
  `_buildPassRouteTracks` — early break, big lateral release. Was QUICK_GAME shape that gave
  the TE 0.4 yd forward + 1 yd lateral at the catch ("standing on the LOS").

**Screens** — engine now emits ~30% of `isScreenCall` as WR screens (`isWRScreen` + `targetSlot=wr1|wr2`,
`isStripSack`/`recoveredByDef`-style structured payload). Render unblocked: `wrChoice` honors
engine's `targetSlot` on screens instead of hardcoding "rb". `screenSide` follows the carrier
(wr1 → top, wr2 → bottom). OL on screens: sell window 0→0.18, release ~6.3 yd downfield, anchor
on `cy + screenSide * 60` so convoy STACKS on the catch-side sideline.

**3rd-and-long defense** (`makeFormation` in `play-render.js`) — triggers on `(down>=3 && ytg>=8)`,
`ytg >= 15`, or `defPackage === "PREVENT"`. LBs to depth `max(base, ytg - 2)` capped 18 yd,
splits widen 44→62 px laterally. Safeties to `min(20, max(16, ytg + 4))`. CBs press 7 → off 9.
CB cushion in coverage man 2 → 5, zone 6 → 9. Engine zone-drop tracks shifted by formation depth
delta in `def.map` secondary-track sample so LBs/S don't snap back to standard hook depth
post-snap. Formation exposes `isLongYd / lbDepthYd / sDepthYd / cbDepthYd`.

**Stride frequency** — was fixed wall-clock 3 Hz on run carrier + pre-catch WR. Decoupled from
world motion → ice-skating at high speeds (long runs read as "too fast") and leg-flailing at low
speeds (short routes read as "teleport at catch"). Both now use velocity-derived
`strideHz = clamp(yps / 2, 2.0, 5.5)`.

**TD callout timing** — bumped nine in-play thresholds (run-TD carrier celebrate, run-TD
fireworks, pass-TD celebrators, run-TD celebrators, pass-TD cinema fireworks, KR RETURN TD!,
blocked-FG TOUCHDOWN!, punt cinema HOUSE-CALL, punt top-down HOUSE-CALL) so celebrations only fire
after the carrier has visibly crossed the goal line. Per the `no-outcome-preview` principle.

**KR/PR** — facings fixed across the punt return path (returner, engaged chaser, free pursuer,
blockers; geometry analysis around `aheadOffset` in the punt render). KR was already correct.

**FG** — good-FG flight window extended from `t < 0.78` to `t < 0.95` (was leaving ballX/ballY
undefined for the IT'S GOOD! banner window, invisible-ball bug). Post-uprights overshoot bumped
30 → 55 px so the ball visibly arcs THROUGH the posts during the banner.

### Session 2 continuation (since `5057d5e`)

Built on top of the §3 work. ~25 more commits. Closes the procedural-fallback
era — every player rendered in this session is sprite-backed.

**Sprite atlas — 10 additional dedicated pose folders** (on top of the 14 above)

| Pose | Source | Notes |
|---|---|---|
| `drop_step` | Default | QB 3-step drop, ball at chest; restricted to SE/SW dirs (only diagonals read right) |
| `ragdoll` | Default | Mid-air tumble; sprite rotated per-frame by physics integrator (see "rotated sprites" below) |
| `tumble` | football-tucked-under | Ballcarrier end-over-end roll post-contact |
| `spin_fall` | football-tucked-under | Mid-air corkscrew off a side hit (ball in hand) |
| `qb_carry` | Default | QB cradle at chest, 2 hands |
| `qb_scramble` | football-tucked-under | QB sprinting with ball — replaces `carry` for QB-run / scramble |
| `strip_swat` | Default | DB axe-chop arm — wired at sack-play forcer + fumble-play forcer |
| `release` | Default | WR explosive first step off line, no ball |
| `scrape` | Default | LB lateral shuffle pursuit |
| `tackled_carry` | football-tucked-under | Ballcarrier prone with ball — used at every ballcarrier-tackle emit |
| `jam` | Default | DB press at line, both arms chopping forward (single-player frame) |

**Engine wiring of new poses**

- QB `carry` → `qb_carry` (flea-flicker post-pitch, sack-play pocket-scan)
- `qb_scramble` replaces `carry`/`churn` for `isScramble` and `isQBRun` carriers
- `strip_swat` fires for the primary sacker between `contactT-0.10` and `contactT+0.03`; also fires for the fumble forcer between `CARRY_END` and `STRIP_END`
- `tackled_carry` wired at every ballcarrier-prone emit (WR post-catch default fall, INT runback tackled, KR/PR after tackle, fumble recoverer's first beat)
- Big-hit defender `dive` → `hit` so it routes to the `tackle/` diving-wrap sprite instead of `dive_forward/` (a receiver layout)

**Procedural suppression + diagnostic counter** (`play-render.js`)

- `_drawPlayerImpl` early-returns under `!window.GC_ALLOW_PROCEDURAL` (default).
- `_proceduralSuppressed[pose]` counts every suppression for devtools inspection.
  Any sprite gap surfaces as an *invisible* player + a counter bump.
- `drawPlayer` normalizes `pose ?? "idle"` up-front so missing poses don't slip through.
- Shadow extracted into `_drawPlayerShadow(ctx, x, y, style, pose)` and called *before* the sprite path so sprite players still cast a drop shadow.

**Rotated ragdoll sprite**

`drawPlayerSprite` reads `style._ragdoll` and applies `ctx.rotate(rot)` + `ctx.translate(0, dy)` before `drawImage` when pose is `ragdoll`. The sprite cycle plays the tumble frames while the physics integrator drives the body angle. Broadcast `_spriteQueue.run()` now tries the sprite path before falling to `_drawPlayerImpl` — closes the last source of procedural rendering in broadcast camera.

**Speed audit (first principles)**

Real NFL elite ≈ 10.7 yps. Multiple knobs were 13-18 yps. All adjusted:

| Knob | Was | Now |
|---|---|---|
| `scaledDuration` visual yps | 12 | 10 (longer time budget on big plays) |
| `runPacing` accel phase | 5% time / 3% dist | 15% / 10% (gentle ramp) |
| `runPacing` cruise minimum | 0.78 | 0.88 (cruise consumes more of the action window) |
| `WR_TOP_YPS_VISUAL` | 13 | 10.5 |
| `primarySpeedPx` cap | 18 (40 mph) | 11 |
| `ST_PLAYER_YPS` (returner) | 14 | 10.5 |
| `COVER_BASE_YPS` | 12 | 10 |
| `BLOCKER_BASE_YPS` | 15 | 9 |

Plus engine-side: **carrier "read" waypoint** at `t=0.22` was `yards * 0.14` (RB had to cover 8 yds in 12% time on a 30-yd run → 25-30 yps pre-LOS burst). Now clamped to `[-1, 2]` so the read sits near the LOS regardless of total play distance.

**RB move-window widening** — juke/spin/stiff arm/hurdle windows each grew by 2-4% of action time so the moves take ~0.5s instead of ~0.3s (no more teleport-cuts).

**INT return rewrite** — `easeOutCubic` peaks at 3× avg speed at t=0 (interception teleport). Replaced with `runPacing(tt, postCatchMs)`. Also: `POST_CATCH_MS` for INT now scales with return distance (`max(1800, retDistYds * 100 + 1500)`) so a 30-yd runback doesn't have to fit in 1800 ms.

**Route concept de-convergence** — three concepts had wr1 and wr2 running identical routes (QUICK_GAME, VERTICAL/PA_SHOT, default). Now spread:

- QUICK_GAME: wr1 slant in (`lat +5`), wr2 quick out (`lat -3, depth 4`)
- VERTICAL/PA_SHOT: wr1 go (22yd straight), wr2 deep dig (18yd then in 5yd)
- default: wr1 curl out (`lat -2`), wr2 curl in (`lat +2`)

DRAG_MESH (crossing) and INTERMEDIATE (already opposite directions) left alone.

**Non-target WR clamp** — WR route handler now clamps `_x, _y` to `[EZ_PX*0.3, W - EZ_PX*0.3]` × `[TOP+20, BOT-20]`. A deep `go` route's track was extending past the back of the endzone (x ≈ 1300 on a 1280-wide field), and combined with procedural suppression that read as "the receiver vanished."

### Latest commits on this arc

- `bcc4e96` — wire qb_scramble + strip_swat for fumble forcer
- `6c6d8bd` — engine: carrier "read" waypoint near LOS, not yards*0.14
- `69367e8` — engine: route concepts space wr1/wr2 instead of mirroring
- `d264464` — clamp non-target WR positions to field bounds
- `43ea5dd` — normalize missing pose to "idle" so WRs don't vanish
- `4bc589a` — INT returns: scale time + replace easeOutCubic with linear cruise
- `5327560` — runs: widen juke / spin / stiff-arm windows so moves don't teleport
- `b263f08` — drop shadow for sprite-rendered players
- `14fb9cf` — speed audit: realistic caps + gentler RB cruise transition
- `ac53e2e` — suppress procedural shape-math fallback entirely
- `677431a` — rotate the ragdoll sprite, never fall to procedural
- `819a295` — settled ragdoll swaps to tackled_carry / tackled sprite
- `87c79c0` — primary tackler dive routes to tackle/, not dive_forward/
- `0cdab78` — tackled_carry + wire all ballcarrier-prone emits
- `307c96c` — wire qb_carry + strip_swat into engine
- `2121e2c` — P2/P3 batch — tumble / spin_fall / jam / qb_carry / qb_scramble / strip_swat / release / scrape
- `651df28` — drop_step restricted to SE/SW only
- `3346450` — regen drop_step — QB 3-step drop, ball cradled at chest
- `0159a23` — regen ragdoll north — head-over-heels tumble
- `4639b83` — dedicated drop_step + ragdoll (break run/ and fall/ aliasing)

### Earlier commits on this arc

- `44e26c9` — empty commit to retry CI after a runner-allocation transient
- `9170f8e` — ref animation pack (5 poses, 8 dirs, 160 files)
- `ad07150` — spin 8-frame regen + dedicated `stiff_arm` folder
- `c8bb9c2` — RB highlight pack (juke / spin / hurdle / truck)
- `370c273` — carry / kick_slide / backpedal / dive_forward (first sprite batch)
- `ab14f50` — short TE/RB swing-flat route override
- `7bacbbd` — catch pose single-fire + crowd-at-contact + INT freeze
- `6dbc681` — TD callout threshold sweep
- `efbd043` — no-outcome-preview audit gates
- `4b9cded` — deep-ball WR teleport root-cause fix
- `9b0230c` — velocity-derived stride
- `ae5a8a4` — 3rd-and-long defense
- `6d4d899` — strip-sack visual
- `900bb9f` — sack realism rework
- `4ed1ad9` — fumble polish

---

## 3B. Earlier arc — visual / broadcast / replay (older sessions)

Foundation for the current arc. Don't redo.

Recent commits on this arc:
- `82000b7` — replay system + saved highlights (SportsCenter Top 10 style)
- `cb2ee4d` — broadcast cam by default + week-recap modal + field/stadium art upgrade
- `f3099b3` — revert of broadcast tilt/perspective tweak (players landing off-field)
- `a68d701` — fix WR alignment off-field in broadcast cam (rewrote `projectBroadcast`)
- `7814b93` — scrubbable timeline + replay-clips backfill
- `682d508` — handoff refresh
- `e295b6a` — sideline pad: skip top apron in broadcast cam to avoid crowd gap
- `7580d74` — stadium wall band between crowd and field in broadcast cam
- `473f3fc` — port top sideline pad to cinema field render
- `904c69f` — LED ad ribbon on the stadium wall in broadcast cam
- `9823439` — larger yard-line numbers with black stroke
- `7ee5370` — soft radial-gradient player drop shadows
- `ddb54a4` — Tier 1 player uniform pass (cleats, gloves, name, captain "C", towel, visor, rim light)
- `062606b` — Tier 2 polish: AO shading, long sleeves on linemen, foot dust
- `c15fb85` — Tier 2 pass B: sock striping variants, knee braces, QB no gloves
- `5a5cfd4` — stadium audio system (Web Audio API, synth-based SFX)
- `c85bbd0` — visual FX layer (particles, screen shake) + vendored PIXI

### Audio system (new)

- **`play-audio.js`** — `GCAudio` global, vanilla Web Audio API. Lazy-inits AudioContext on first user gesture per browser autoplay policy.
- **SFX**: `snap` (square wave with frequency drop), `whistle` (sine + LFO vibrato), `hit` (low-pass noise + sub osc sweep), `cheer` (band-pass noise swell).
- **Ambient**: `GCAudio.crowd.start()` runs a band-pass-filtered noise loop while plays advance, stops at game end. ~6% gain so it sits under SFX.
- **Hooks** in `play-animation.js:startNextPlay`: routes per-`play.kind` to the appropriate SFX. Note actual kinds used (per a sample game): `score`/`fg_good`/`xp_good` → cheer; `big_hit`/`ejection`/`fumble`/`sack` → hit; `halftime`/`quarter`/`ot`/`two_min_warning` → whistle; `hc_decision` → silent; everything else → snap.
- **Mute toggle** in the field HUD camera bar (🔊/🔇 button). `_toggleAudio()` in `play-broadcast.js`. Single global enable flag.

### Visual FX layer (new)

- **`play-fx.js`** — `GCFx` global, canvas2D particles + CSS-transform screen shake. API: `dust(x,y,dir)`, `hitBurst(x,y,color)`, `confetti(x,y,color,n)`, `shake(strength,ms)`, plus `tick(dtMs)` + `draw(ctx)`.
- **Wired into tick loop** at `play-animation.js:5867-` — `tick(dt)` between frame setup, `draw(fxCtx)` after `_frameEndBroadcast`. `fxCtx` is `_uprightCtx` in broadcast, the field ctx in topdown.
- **Event hooks** in `startNextPlay`: score → confetti (28 particles, team-color palette) + light shake; big_hit/sack/fumble/ejection → hit burst (22 chips) + heavy shake (11px / 350ms).
- **Particle cap** 600 in `MAX`. Tan dust + team-color chips + 4-color confetti palette. Designed so the API can later re-point to a PIXI ParticleContainer with no caller changes.

### PIXI vendoring (new, not yet active)

- **`vendor/pixi.min.js`** — PIXI.js 7.4.0 (MIT, 456KB) downloaded from GitHub releases.
- **Not yet loaded by play.html** — vendored as the foundation for the future WebGL renderer migration. See section 8 for the migration roadmap.

### Broadcast camera

- **Default view**, not opt-in. The "looks like the old game" complaint traced to broadcast being hidden behind a BCAST toggle. Default flipped at `play-animation.js:5371`.
- **Two-canvas architecture**: `#field` is tilted via CSS `rotateX(38°) scaleY(1/cos(38°))` with origin `50% 100%`. `#field-uprights` is a flat overlay sibling for billboarded player sprites, depth-sorted via `_spriteQueue` per frame (closer players occlude farther on pile-ups).
- **Tilt + perspective constants** (`BROADCAST_TILT_DEG = 38`, `BROADCAST_PERSPECTIVE_PX = 1100`) are calibrated to the wrap CSS. **Don't tweak in isolation** — we already burned a commit reverting a tilt change that drifted sprite positions off the field.
- **`projectBroadcast` does the full CSS pipeline now**, not a simplified canvas-internal approximation. It reads the wrap's actual `clientWidth/clientHeight` + padding, derives the field's pre-transform CSS box from the aspect ratio, applies `scaleY` → `rotateX` around the transformOrigin, then the wrap's perspective with its 50%/80% origin, and finally maps the resulting screen position back into upright-canvas internal coords. Geometry cached in `_bcastGeom`, invalidated on resize and in `setCameraMode`.
- **Stadium chrome**: `.bspnlive-field-wrap.broadcast-cam` has a night-sky gradient + crowd silhouette band (32% tall with decked seating tiers via repeating-linear-gradient) + 5 stadium light banks with 26px halos and 4px bright cores.
- **Field art upgrade** (`drawField` in `play-render.js`): darker base grass (`#1c5e2f`), higher-contrast mowing stripes, radial vignette over the field, end-zone team text now has a 4px black stroke + 0.92 white fill.

### Replay system

- **`_scoreHighlight(play, ctx)`** in `play-franchise-offseason.js` scores every play; non-zero scores produce a `{rating, type}` candidate.
- **`_extractReplayClips(plays, ...)`** keeps the top 7 per game, including 1-2 preceding plays as context for the lead-up.
- **`_saveReplayClips(highlights)`** dedupes by id, persists into `franchise.replayClips`. Called from both `markGamePlayed` (user-played games) and the sim path (`frnSimOnce` invocations in week advance).
- **`_trimReplayClips()`** caps at 200 past-season + uncapped current season + top 30/week. **Note**: this had a bug — checked `franchise?.highlights` (wrong property) so trimming was effectively skipped. Fixed in `7814b93`.
- **`frnReplayClip(highlightId)`** swaps in a synthetic single-play gameResult and pumps it through the standard animation pipeline at 0.5x speed. **Note**: had the same stale `franchise?.highlights` reference. Fixed.
- **Replays tab UI** (`renderFrnReplayLib`) — scope tabs (Top 10 week / All week / My Team / Season Top 25), week chips, friendly empty state.

### Week-recap modal

- **`_showWeekRecapIfReady()`** in `play-franchise-offseason.js` — pops a modal once per completed regular-season week. Renders the top 6 league-wide plays with inline ▶ replay buttons.
- **Gated via `franchise._lastRecapSeen`** per `(season, week)` key. Idempotent — won't repeat.
- **`frnDismissWeekRecap()`** closes + sets the flag. **`frnOpenReplaysTab()`** dismisses + navigates to replays tab.
- **Hook**: `play-franchise-season.js:11` adds `try { _showWeekRecapIfReady && _showWeekRecapIfReady(); } catch (_e) {}` in `showFranchiseDashboard()`.

### Scrubbable timeline

- **DOM-injected, not part of the HUD render** — because `FieldHUD.update()` rebuilds its inner HTML on play change and would wipe drag state. The scrubber is appended to `.bspnlive-field-wrap` once via `_ensureScrubber()` (called at the top of `tick()`) and updated by ID lookup.
- **Controls**: play/pause button, restart (↺), drag track with knob, elapsed time readout (`0.00s` format).
- **`_scrubTo(ev, track)`** re-anchors `animState.startTime = performance.now() - frac * animState.duration` so elapsed matches the dragged position. Also clears `holdStart` and renders one frame immediately so the scrub feels live.
- **`_scrubStart` → pointerdown → document-level pointermove/pointerup** so dragging outside the track still tracks. Releases restore `playing` if it was true at drag start.
- **CSS** in `play.css` at the bottom of the broadcast-cam section. Sits at `bottom: 36px` so it clears the camera toggle row.

### Replay-clips backfill

- **`_backfillReplayClips()`** in `play-franchise-core.js` (next to `_backfillStamina`) initializes `franchise.replayClips = []` if missing.
- Wired into all three load-path backfill chains via `replace_all` in `play-franchise-core.js`.
- **Historical games can't be reconstructed** — `_stripGameStatsForStorage` drops the plays array after the game's stored. Empty array + the existing empty-state copy in `renderFrnReplayLib` is the answer.

---

## 4. Earlier shipped work (compact summary)

This is everything that was settled in prior sessions and remains the foundation. Don't redo any of this.

### Contracts / extensions / holdouts
- All three contract screens (offseason re-sign, mid-season holdout center, offseason demand) have portraits, tier-styled clickable names, raise/premium math, hover-preview cap bars, and the `_buildExtensionPitch` data block ("THE CASE" — season prod, career, honors, trajectory, league rank, availability, window, money's worth, market, comp $, verdict).
- Cap bars render as split-fill (baseline + signed extension segments in gold) with per-year delta callouts.
- Contract demand cooldown via `contract.startSeason` (stamped at all 7 creation sites, backfilled from `years - remaining` for legacy contracts).
- Demand probability 35% with 0.70 underpay threshold (3 seasons cooldown).
- Ignored-extension consequences: -2 OVR + dev freeze flag + 40% trade-request roll + 25% demand premium at FA + locker-room banner on player card.

### Player legacy / tier system
- LEGEND / ICON / ELITE / PRO tiers via `playerLegendTier(p)`. Wired through `playerLink(p)` everywhere.
- `_playerLinkSmart(name)` + `_findRetiredPlayer` + `_frnOpenRetiredPlayerModal` so historical names click through to a minimal HOF/RETIRED-badged modal.
- Nicknames are **flag-only** (`p.nickname` + `p.goesByNicknameOnly` — never rewrite `p.name`). 230 entries across 14 themed pools. Gate: OVR ≥ 85 AND (1+ MVP OR 1+ All-Pro OR 2+ Pro Bowls), top-5 per position, 70% acquisition. Themed origin stories per pool, deterministic via name-hash seed.

### HOF + awards
- Annual class-based HOF voting (`_runHOFVoting`, `_computeHOFScore`, `_hofPositionMul`) replacing direct enshrinement.
- First-ballot badges + active ballot section in `_legacyHOF`.
- `_cpuVoteWeeklyPOTW` casts weighted-random weekly POTW votes for every category so POTY races have full-season data.
- `_processSeasonEndRetirements` adds retirees to `_hofEligible` pool (not direct HOF).

### Offseason gains sheet
- `_buildOffseasonGainsSheet` — net Δ, biggest gainer/dropper, hidden-gem hero, re-sign priority block, gainers/holding/decliners tables, stat-delta chips, ceiling cells, contract cells, position filter chips.
- `runFrnOffseason` instruments per-player change records into `franchise._offChanges`.

### Migrations (version-flagged on `franchise.*`)
- `_careerHistoryRepaired_v3` — softened from over-aggressive calendar-year stripping
- `_careerHistoryRestored_v4` — reconstructs prior-team rows where v3 over-stripped
- `_reconcileOrphanSeasonStats` — defensive merge for nickname-split per-game stats
- All backfills idempotent (`_backfillCoachable`, `_backfillStamina`, `_backfillPhysicalPeak`, `_backfillReplayClips`, etc.)

---

## 5. Engine + physics layer (still authoritative)

All major NFL stat categories land in NFL elite bands. The full implementation lives in `play-engine.js` and `play-franchise-season.js`.

### Wear + stress
- `p._wear` (0-100), `p._stress` (0-100), `p._bodyWear` (21 regions).
- Force-scaled hit wear: `_bumpHitWear(carrier, base, tackler, opts)` = `base × tacklerForce × carrierVulnerability + extras`. Tackler gets 25% reciprocal wear.
- Age coupling: 30+ recover slower; 33+ +25% stress per snap; injury rate +10/25/45/65% by age band.

### Injury system
- Contact path (`_rollGameInjuries`) — weekly per-player roll, position-weighted, wear×age multipliers stacking.
- Non-contact path (`_rollNonContactInjuries`) — separate per-game roll, stress-banded rate (0.002-0.033).
- Bimodal ACL spike — W1-4 conditioning multiplier (2.0x → 1.0x) with veteran/Ironman/Sports-Sci mitigation up to -60%.
- Concussion engine — Second Impact recency multiplier (≤3 wks → 3.5x catastrophic), CTE arc (4+ lifetime → independent CE roll).
- Catastrophic variants: torn ACL, chronic concussion syndrome, labrum tear, Lisfranc fracture, torn achilles, chronic hamstring.
- Big-hit instant injury — fires inside `_bumpHitWear` for force ≥ 1.1.

### Tackle attribution
- `_tackleWeightsForContext(ctx)` — first-principles tackle weights per play type (run inside / outside / breakaway / stuff / pass short-middle / short-outside / mid / deep / goal-line / screen / scramble / TOR).
- MLB-biased LB picker (`_creditDefStat`): `lb2 × 1.15`, `lb1 × 0.95`, `lb3 × 0.85`. Bobby Wagner pattern emerges.

### Hit mechanism + discipline
- `_pickHitMechanism(tackler, opts)` returns `head_on / side / low / high / behind`. Weighted by archetype + play context.
- `_maybeFlagURForHit` — UR flag chance scales with mechanism × HEADHUNTER × defenseless context.
- Ejection roll — ~1.6/season league-wide. `_processWeeklyDiscipline(w)` runs auto-suspension cascade.

### Vitals UI
- `_buildVitalsBlock(p)` in `play-franchise-season.js`. Vitruvian body diagram (240×520 viewBox), position-scaled per `_VITALS_BODY_PROFILES` + player height/weight, 21 wearable regions overlaid as translucent paths colored by `_vitalsColor(v)`.
- Overall health score (100 − max(wear, stress)), STATUS card, CONCERNS top 4, RECOVERY GUIDANCE, RISK FACTORS, INJURY HISTORY last 6.

### Realism audit harnesses → see **`AUDIT.md`** (runbook)
Two headless Node harnesses run the real engine over many games/seasons and
flag any metric that drifts off NFL reality. **`AUDIT.md` is the durable
runbook** — how to run them, every metric + NFL band, the headless technique,
and the full calibration changelog (what was tuned and why). Run:
- `node _sim_audit.js 5` — game realism (volumes, rates, efficiency,
  distributions, event rates, drive/situational/kicking). ~8 min.
- `node _brady_audit.js 100` — franchise + player development + the hidden-gem
  "Brady" cadence, record book, OVR-by-round, bust/hit rates, franchise health,
  career length, legend career pages. ~40 min (use 40 for a quick read).

Always smoke-run after editing either (`node _x_audit.js 2`) — `node --check`
does not catch errors inside the bundled harness string.

### Clutch factor → see **`CLUTCH_FACTOR.md`** (design + discoveries)
Hidden, real, scoutable composure-under-pressure trait (`_clutch`) that tilts
FG accuracy / QB completion+INT / WR catching in late-and-close moments
(league-wide, playoff-amplified). `CLUTCH_FACTOR.md` is the durable record —
first-principles rationale, the engine discoveries made while building it
(incl. that clutch already partly existed via the kicker archetype + `_drive`,
and that *all* games route through `frnSimOnce`→`GameSimulator`), the exact
code map, and the verification harnesses (`_clutch_test.js`, `_clutch_audit.js`
— the latter uses difference-in-differences to cancel the skill confound).

### Audited stat outcomes (NFL elite bands)
| Category | Audit | NFL elite |
|---|---|---|
| Top sacker / season | 22, 21, 21, 21, 20 | 15-22 ✓ |
| Top rusher / season | 2055, 1874, 1833 | 1800-2100 ✓ |
| Top WR / season | 1776, 1713, 1662 | 1700-1964 ✓ |
| Top tackler / season | 190, 182, 180 | 150-195 ✓ |
| Top QB / season | 5338, 5227, 4931 | 4500-5500 ✓ |
| Total injuries / team | 10.7-13.8 | 12-15 IR ✓ |
| Catastrophic % | 7-8% | ~8% ✓ |
| Career-ending / season | 2.6 | 5-10 (slightly under) |
| Ejections / season | 1.6 (5-season avg) | 1-3 ✓ |
| Avg injury duration | 4.0 wks | 4-6 ✓ |

### Personnel mix (modernized)
NFL 2024 uses 11 personnel (TRIPS) on ~62% of plays. All five playbooks (BALANCED, AIR_RAID, GROUND_AND_POUND, DUAL_THREAT, OPTION) bumped TRIPS share, trimmed BASE. WR3 / slot CB now see realistic snap shares.

---

## 6. Key decisions (cumulative)

**Visual / broadcast layer:**
- **Broadcast cam is the default**, not opt-in. Toggle still exists.
- **Two-canvas architecture is non-negotiable** — flat sprite overlay billboarded on top of tilted field. Don't try to draw sprites on the tilted canvas directly (they lie flat instead of standing upright).
- **`projectBroadcast` reads live wrap geometry** — don't hardcode dimensions. Constants (TILT 38°, PERSPECTIVE 1100px) are tested values; if changing them, re-run `/tmp/snap_calib.mjs` and verify the calibration dots against the field rect.
- **Scrubber is DOM-injected**, not in the HUD render, because the HUD rebuilds inner HTML on play change.

**Replay system:**
- **Top 7 per game** is the storage cap; `_trimReplayClips` further caps past seasons at 30/week and 200 total.
- **Historical replays can't be reconstructed** from old saves — sim games drop their plays after storage. Backfill initializes the array empty; new games populate going forward.
- **Replay clip carries 1-2 preceding plays as context** — `frnReplayClip` plays the whole context sequence so the user sees the lead-up.

**Design (cumulative from prior sessions):**
- **`p.name` is sacred** for lookups. Never rewrite. Use `p.nickname` + `p.goesByNicknameOnly`.
- **Tier system uses any-of clauses** for thresholds (a single MVP jumps you to ICON; a single ring jumps you to ELITE).
- **Cooldown via `contract.startSeason`** rather than per-player flags. Stamped at every contract creation site.
- **Pitch block takes a normalized `ctx`** — `{ position, marketAAV, demandedAAV, demandedYears }` — so all three contract screens map their row shape into the same signature.
- **Migrations are version-flagged** (`_careerHistoryRepaired_v3`, etc.) and run once per save.

**Architecture:**
- All player-name surfaces go through `playerLink(p)` or `_playerLinkSmart(name)`.
- `_findPlayer` falls through to `_findRetiredPlayer` so historical names don't dead-end on click.
- Cap bars use `data-cap-year` / `data-cap-used` attributes for hover-preview without re-rendering.

**UI/UX:**
- Pitch block always rendered (no toggle) — user wants to be "convinced with data."
- Split-fill cap bars over single-fill — makes "what did this signing add?" obvious.
- Reconstructed history rows render dimmed/italic with `~estimated` note.

**Explicitly rejected:**
- Pruning save data — user wants full fidelity. Auto-trim only at 4MB pressure.
- Recovering lost calendar-year rows perfectly — data is gone, reconstruction is even-distribution approximation.
- Counter-offer custom slider UI — discussed, not yet built.

---

## 7. Bugs / issues discovered (cumulative)

| Symptom | Cause | Status |
|---|---|---|
| Crowd cheered before sack happened | Sack in `_isBigPlay`; SFX fired at snap | Fixed (`7ff8650`) — per-frame trigger at contactT |
| WR teleports under deep ball at catch | Engine `throwT` and renderer `throwFrac` from different formulas (2200/1000 floor vs 1200/700) — engine track waypoints at one aT, renderer transitions at another | Fixed (`4b9cded`) — renderer uses engine `throwT` when `play.motion` present |
| 1-yard TE pass — TE barely moves, ball arrives at LOS | QUICK_GAME shape with `targetDepth=1` gave TE 0.4 yd forward + 1 yd lateral by catch | Fixed (`ab14f50`) — swing/flat shape override at `targetDepth <= 3` for TE/RB target |
| 26-yard run looks too fast / 4-yard catch teleports | Wall-clock 3 Hz stride decoupled from world motion — ice-skating at high speeds, leg-flailing at low | Fixed (`9b0230c`) — velocity-derived stride for run carrier + pre-catch WR |
| FG ball disappears before uprights on good kick | `t < 0.78` branch closed with no continuation; `ballX/ballY` undefined at banner time | Fixed (`7ff8650`) — extended flight window to 0.95 |
| TD callouts fire while runner still 10 yd from goal | Per-play t-thresholds at 0.82-0.88 don't track actual goal-line crossing on long plays | Fixed (`6dbc681`) — bumped to 0.92-0.95 across run / pass / KR / punt / blocked-FG TD callouts |
| Incomplete pass ball invisible during bounce | Catch-arrival hand-track and post-catch tuck both pulled ball to receiver hand regardless of `play.kind` | Fixed (`859336e`) — branches gated to `complete`; `skipCarryShift: true` on bounces |
| Punt return blockers face the returner | Position math correct but `facing` sign inverted for the punt path | Fixed (`859336e`) — facings flipped for chasers / blockers / free pursuer |
| `2026-05-28` CI failed at "Set up job" in 2s | GitHub Actions runner-allocation transient (no setup happened, no log) | Resolved (`44e26c9`) — empty commit re-triggered, green |
| WR lining up out of bounds in broadcast cam | `projectBroadcast` used canvas-internal coords, didn't match upright canvas geometry | Fixed (`a68d701`) — full CSS pipeline math |
| Players landing off-field after tilt tweak | Changed TILT/PERSPECTIVE constants without re-deriving sprite layer positions | Reverted (`f3099b3`) |
| Replays tab crashed on old saves | `franchise.replayClips` undefined; two stale `franchise.highlights` refs | Fixed (`7814b93`) — backfill + property rename |
| `_trimReplayClips` skipped silently | Guard checked `franchise?.highlights` (wrong key) | Fixed (`7814b93`) |
| QB demanding ext after just signing | `_detectHoldouts` had no cooldown | Fixed via `startSeason` gate |
| 168% availability | `careerStats.gp` polluted by phantom rows | Fixed: use careerHistory only, cap at 100% |
| Career table "2 seasons" / 12k yds | v3 over-stripped calendar-year rows | Fixed v3 + added v4 reconstruction |
| Marv Rossi click does nothing | `_findPlayer` only searched active rosters | Fixed via `_findRetiredPlayer` |
| WR missed Pro Bowl | nickname rewrite split per-game stats across two name keys | Fixed: `_reconcileOrphanSeasonStats` + nickname fallback |
| FPTS = 0.0 | per-game lookup keyed only by `p.name` | Fixed: nickname fallback + seasonStats |
| HIGH CEILING on a 31-yr-old vet | `potentialTag` didn't gate on age vs peak | Fixed: vets past peak get realized-state tags |
| Cap bars seemed unchanged after signing | bars updated but visual snap had no callout | Fixed: split fill + delta callouts |
| Procedural shape-math body visible on tackles | `_drawPlayerImpl` ragdoll case fired whenever the sprite path returned false | Fixed (`ac53e2e`) — procedural suppressed by default, `_proceduralSuppressed` counter for diagnosis |
| Ragdoll mid-fall rendered procedurally even with sprite available | Sprite was static and couldn't follow physics rotation; renderer forced procedural for `pose === "ragdoll"` | Fixed (`677431a`) — `drawPlayerSprite` applies `style._ragdoll.rot` via `ctx.rotate` before draw |
| Non-target WRs disappeared the moment another WR caught the ball | Track sample for a deep go route puts `_x ≈ snap.x + 600px` on a 1280-wide field; sprite drew correctly but off-canvas, and procedural suppression turned the gap into "vanished" | Fixed (`d264464`) — `_clampX/_clampY` matches the downfield-blocker clamp |
| Players with undefined pose vanished (FBs, non-targets) | `drawPlayerSprite` returned false for `undefined` pose → procedural → suppressed → invisible | Fixed (`43ea5dd`) — `drawPlayer` normalizes `pose ?? "idle"` up-front |
| INT runback teleports from catch spot | `easeOutCubic` peaks at 3× avg at t=0; `POST_CATCH_MS` fixed at 1800 forced a 30-yd return into 16 yps avg → 48 yps peak | Fixed (`4bc589a`) — `runPacing` curve + `POST_CATCH_MS` scaled to `retDistYds` |
| RB "first part of run is faster than normal" | Engine carrier track at `t=0.22` had `dxYd = yards * 0.14` — on a 30-yd run that's 8 yds in 12% of action time = 25-30 yps pre-LOS burst | Fixed (`6c6d8bd`) — read waypoint clamped to `[-1, 2]` regardless of total yards |
| Primary tackler outran the rest of the defense by 2× | `primarySpeedPx` clamp ceiling at 18 yps (40 mph) | Fixed (`14fb9cf`) — dropped to 11 yps |
| Two WRs running same area | QUICK_GAME / VERTICAL / default emitted identical wr1 and wr2 routes | Fixed (`69367e8`) — concept-specific spacing (slant + out, go + dig, mirrored curls) |
| Big-hit defender renders as a layout-catch sprite | Engine emitted `dive` for primary tackler → atlas routed to `dive_forward/` (WR layout) | Fixed (`87c79c0`) — defender `dive` → `hit` → routes to `tackle/` (the diving-wrap sprite) |

**Logs/errors**: console outputs `[career repair v3] cleaned X player histories` and `[career repair v4] reconstructed prior history for X player(s)` on first save load.

---

## 8. Next steps (prioritized)

### Top of queue (animation arc continuation)

1. **Penalty feature** — engine emits `play.kind === "penalty"` (or flag-on-the-play during another kind), render shows the ref throwing the flag + banner + accept/decline UI + yardage apply. **Ref sprites are ready** (`ref_idle / ref_td_signal / ref_first_down / ref_flag / ref_whistle` all 8 dirs landed `9170f8e`). Largest visible feature gap left.
2. **Pre-snap motion / shifts** — engine emit + render slide. Visually free variety; every play looks less identical. Also: the motion man currently uses regular `run` pose — should be a slower trot.
3. **Verification sit-and-watch pass** — strongly recommended now. ~50 commits across two sessions of animation/sprite/wiring/speed work; the user has been driving fixes via specific symptoms but a full end-to-end watch hasn't happened yet.
4. **Task #47 ball position (RB area)** — lingering pre-snap ball-near-RB report; needs new sprite-aware repro.
5. **`hit` pose variant for pass-D pre-tackle contact** (`play-animation.js:4118`) — currently uses `engage` which routes to the OL/DL `block/` clash sprite. A defender wrestling a WR pre-fall would read better as `hit`.
6. **Sprite quality regen audits** — `tackle/` (the diving-wrap) was generated way back at commit `57304e9`; head-on south/north read as "forward reach" not full dive. Lower priority than functional gaps, but worth a regen if you want pixel-perfect.

**RESOLVED since previous handoff:**
- Strip/swat sprite — done (`db_strip_swat` + `db_strip_swat_diag`, dedicated `strip_swat/` folder, wired both at sack forcer and fumble forcer).
- QB ball-in-hand poses — `qb_carry` + `qb_scramble` both generated + wired.
- Fall variant split — `tackled_carry`, `ragdoll`, `tumble`, `spin_fall` all dedicated folders with engine emits.

### PIXI / WebGL migration (committed direction — Tier 3 from session art-direction discussion)

The user picked Tier 3 ("Full engine rebuild") — migrate the canvas2D renderer to PIXI.js for WebGL shaders, real particle systems, post-processing. PIXI is **already vendored** at `vendor/pixi.min.js` (7.4.0, MIT, 456KB). This is multi-session work.

**Phase 1 — Foundation** (DONE, `1dccbe1`):
- Loaded `vendor/pixi.min.js` via script tag in `play.html`.
- Initialized a PIXI.Application as a `.gc-pixi-fx` canvas attached to the broadcast-cam wrap, internal 1700×720, `pointer-events:none`, z-index 4. Re-attached on wrap rebuilds (`_ensurePixiOverlay` pattern).
- Re-implemented `GCFx.draw` on PIXI Graphics in a pooled Container. Caller API unchanged. BlurFilter (blur 2.4, quality 2) provides bloom-lite.
- `preserveDrawingBuffer: true` so Playwright headless screenshots capture WebGL output.
- Canvas2D fallback intact — `_drawPixi` returns false on init failure.

**Phase 1.5 — Stage layers** (resolved + extended):
- Initial vignette + flash attempts on `PIXI.Graphics` produced uniform gray on the headless software-WebGL renderer. Fixed by switching to the `RenderTexture + Sprite` pattern for static elements (vignette, haze, noise) and `Graphics → RenderTexture → swap-Sprite-texture` for dynamic-color elements (flash). PIXI 7 `Sprite.tint` was unreliable on SwiftShader; baking color into a fresh texture per fire works.
- Shipped: vignette (`32b0ee4`), light beams (`32b0ee4`), flash (`4e6be68`), atmospheric haze (`33684e4`), TD celebration cinematic (`81e07f4`), replay film grain (`4472bb3`).

**Phase 2A — Static field migration to tilted PIXI canvas** (DONE):
- `d9979d5` Phase 2A.1: Stood up #field-pixi as a sibling of #field, both tilted via the same CSS rotateX(38°)/scaleY transform. PIXI Application attached with autoStart:false + preserveDrawingBuffer:true. Grass + mowing bands rendered into a Container, cached per (homeId|awayId). Canvas2D drawField skips the same elements when GCField.active().
- `863013a` Phase 2A.2: End zones (team-color Graphics) + KRAKEN/TITANS PIXI.Text rotated -90°/+90° with scale.x stretching the natural reading direction.
- `7e02b33` Phase 2A.3: Sidelines, yard lines (every 5/10), yard numbers, hash marks, sideline ticks.
- `64a6551` killed four compounding dimming sources (PIXI vignette + PIXI haze + canvas2D radial vignette + CSS contrast) — field reads vibrant green now.

**Phase 2B — Remaining field elements** (DONE):
- `634a36a` Phase 2B.1: Midfield team-initial logo (gold ring + initial PIXI.Text) + goal line indicators.
- `f2e177d` Phase 2B.2: Per-frame LOS + first-down line on a separate _dynG Graphics. GCField.drawDynamic(state) is called by drawField each frame.
- `ec749a1` LOS/FD glow halo — wider blurred lines on _dynGlow Graphics with BlurFilter, broadcast first-down-line styling.
- `f7c55f3` Red-zone goal-line pulse — when LOS is within 20 yards of a goal line, that goal line pulses warm orange.

Weather particles are still canvas2D. Phase 2C would port them to a PIXI ParticleContainer; works fine as-is so deferred.

**Phase 3 — Player + ball migration** (FUNCTIONALLY COMPLETE for broadcast cam):
- `4cefb2a` Phase 3.1: Player drop shadows ported. Single batched PIXI Graphics on the field-pixi canvas — one WebGL draw call for all 22 players' shadows instead of 22 canvas2D radial-gradient strokes.
- `3828088` Phase 3.2: Sprite-atlas player renderer. Each unique (color, secondary, label, pose, facing, frame-bucket) lazily renders the canvas2D _drawPlayerImpl to a 96×192 offscreen canvas, loaded as PIXI.Texture. Per-frame, drawPlayer updates one PIXI.Sprite per player.
- `c6f64be` Phase 3.3: Ball ported to same atlas (48×48 offscreen → PIXI.Texture). Lives in same _stage as players; depth-sorted via zIndex = screenY (+0.5 bias for ball so it sits above a same-y carrier).
- `5d57525` Default-on. `1828139` Audit fix: sprite identity switched from label-based to per-frame call-order slot (label collisions on kickoffs etc. were collapsing 22 players into 4 sprites).
- **Topdown cam**: still canvas2D players (PIXI route is broadcast-cam-only). Not a regression; broadcast is the default view.
- **Remaining smaller pieces**: ball trail (pass arc) still canvas2D; foot dust inline; penalty/fumble markers; topdown players.
- **Architecture**: depth sort now via PIXI `sortableChildren = true` + `child.zIndex = screenY` (ball gets +0.5 bias). _spriteQueue still exists for non-player canvas2D draws (ball trail, decals).

**Phase 2 — Element ports** (extensive overlay work shipped earlier this session):
- LED ad ribbon (`6e6e098`): CSS background → PIXI Graphics panels with cycling color palette + BlurFilter glow.
- LED ribbon "slogan flash" mode (`62d0133`): every ~5s the ribbon switches from color-cycling to solid amber with a bright scan sweep.
- TOUCHDOWN/FIELD GOAL/EXTRA POINT/2-PT banner (`b23c88a`): PIXI.Text with overshoot scale + drop shadow.
- Player-highlight chyron (`20a0572`): Bloomberg-style lower-left banner with name + play-type tag. Wired to TD scorers, sacks, INTs.
- Drive recap chyron (`3424c3e`): fires on drive_summary plays w/ N PLAYS · M YDS · TOP.
- LIVE indicator (`ebb7427`): blinking red dot + LIVE text upper-left, swaps with INSTANT REPLAY badge in replay mode.
- INSTANT REPLAY badge + VHS scanlines + film grain (`e319402`, `4472bb3`): all gated by window._replayMode.
- Lens flare (`e319402`): 4-pointed star sprite that fires on TDs alongside the celebration.
- Atmospheric haze (`33684e4`), vignette + light beams (`32b0ee4`), flash (`4e6be68`), color grading (`81e07f4`).
- End-of-game FINAL banner + final whistle + delayed cheer (`62d0133`).
- Quarter / halftime / OT / two-min-warning banners (`62d0133`).

True `drawField` porting (grass / mowing / end zones / yard lines / numbers / hash marks) still requires either applying the CSS rotateX tilt to a dedicated PIXI canvas OR positioning each element via `projectBroadcast()`. Deliberate multi-session arc — don't start without committing to it.

**Phase 3 — Player render migration** (unchanged from prior plan):
- Port `_drawPlayerImpl` (`play-render.js:407-` ~1000 lines) to PIXI Containers. Player = Container of Graphics + Sprite + Text. Pose changes update child positions/rotations. Depth-sorted sprite queue becomes PIXI z-index sorting. 2-3 sessions for clean parity.

**Phase 4 — Effects unlocked**:
- Bloom upgrade on lights + LED ribbon (already in light/particles, can extend).
- Motion blur on breakaway runs (needs `@pixi/filter-motion-blur` vendored separately).
- Color grading by weather/time (currently a static CSS filter; PIXI ColorMatrixFilter would let it vary per state).
- Screen-space distortion ripple on big hits.
- Sprite sheet animation for run cycles (sample Mixamo for reference).

**Phase 2 — Field render migration**:
- Port `drawField` (`play-render.js:24-180`) to PIXI Graphics + Sprite. The grass, mowing bands, end zones, sidelines, yard numbers, hash marks, LOS marker, first-down line are all paint operations that map cleanly to PIXI Graphics.
- Keep the existing `#field` canvas around as a fallback during the migration.
- Verify topdown + broadcast cam look identical to the canvas2D version before deleting the old code.

**Phase 3 — Player render migration**:
- Port `_drawPlayerImpl` (`play-render.js:407-` — the big one, ~1000 lines) to PIXI Containers. Each player becomes a `Container` with child `Graphics` for helmet/body/limbs and child `Sprite`/`Text` for jersey number + name. Pose changes update child positions/rotations.
- This is the biggest single piece. Estimate 2-3 sessions to migrate cleanly with parity testing.
- The depth-sorted sprite queue (`_spriteQueue`) becomes PIXI's z-index sorting on the player Container parent.

**Phase 4 — Effects unlocked by PIXI**:
- Bloom on stadium lights + LED ribbon.
- Motion blur on breakaway runs (PIXI `MotionBlurFilter` from `@pixi/filter-motion-blur` — would need to vendor separately).
- Color grading for weather/time-of-day (day vs night vs snow).
- Screen-space distortion ripple on big hits.
- Sprite sheet animation for player run cycles (sample Mixamo as reference, export keyframes).

**Don't break the working game during migration.** Keep both renderers alive behind a feature flag (`useWebGL`) and switch to PIXI fully only when parity is verified.

### Visual / broadcast follow-ups (still open in canvas2D)

1. **Mechanism / UR / ejection visuals** in real-time play log — show hit mechanism chips ("blindside", "high hit") + UR flags + ejection moments as they happen, not just in injury history. Independent of the PIXI migration.
2. **Helmet shape rework toward NFL silhouette** — was proposed mid-session (option B from art-direction discussion: NFL helmet not sphere, slimmer proportions, jersey hang). Deferred when user committed to Tier 3 PIXI migration. Would be **redone in PIXI** during Phase 3, so don't do it in canvas2D first.

### Engine roadmap (open from prior session)

4. **Phase 5 — Smart pickers / player contracts**: replace flat snap-share % with three goal modes per slot: `share`, `count`, `touches`. Multi-file refactor: extend snapShares data model, modify `_rotateForSnap` + `pickRusher` + `pickReceiver` to consult mode/target, add auto-manage policies (Balanced / Ride starters / Playoff push), expose modes in the UI.
5. **Auto-manage UI for rest/sit decisions** — surface wear/stress with recommended sub policy per game.
6. **Career-ending injury rate bump** — currently 2.6/season vs NFL 5-10. Raise catastrophic upgrade chance slightly.
7. **Non-contact share** — currently 25% vs NFL ~40%. Stress accumulation works; rate could lift further.
8. **Pace tuning** — slightly too many plays per game (was 70 vs NFL 62 in earlier audit; may have shifted).

### Contract / extension follow-ups (from prior reassessment)

9. **#6 AI inquiries for unhappy stars** — when `tradeRequested=true`, generate weekly inbound trade offers.
10. **#2 Counter-offer flexibility** — custom AAV slider, "match years cut AAV" variants.
11. **#9 Price-aware verdict** — factor demand AAV vs market into pitch verdict.
12. **#7 Comp pick surplus value math** — quantify "let walk" vs deal cost.
13. **#8 Unify mid-season vs offseason demand systems** — `_checkHoldoutDemands` vs `_detectHoldouts` have subtly different rules.

**Do NOT do unless asked:**
- Tweak `BROADCAST_TILT_DEG` / `BROADCAST_PERSPECTIVE_PX` / field transformOrigin — coupled across JS and CSS, easy to break.
- Counter-offer slider UI redesign (touches a lot of layout).
- Save data pruning (user wants full fidelity).
- Coaching carousel expansion (already comprehensive).

---

## 9. Instructions for the next Claude Code chat

You're continuing mid-session work on GridironChain. Read this carefully:

- **Do not redo completed work.** Everything in sections 3-5 is shipped and committed on `claude/football-sim-blockchain-game-b3sdq`. Check `git log --oneline -30` before starting.
- **Inspect files before editing.** Files are large (`play-franchise-offseason.js` is 12k+ lines, `play-animation.js` is ~284 KB). Use `grep -n` to find functions; don't try to read whole files. Key entry points by area:
  - Broadcast cam: `projectBroadcast`, `setCameraMode`, `_frameStartBroadcast`/`_frameEndBroadcast` (all in `play-animation.js` ~5370-5530)
  - Replay system: `_scoreHighlight`, `_extractReplayClips`, `_saveReplayClips`, `frnReplayClip`, `renderFrnReplayLib` (`play-franchise-offseason.js` ~1900-2300)
  - Scrubber: `_ensureScrubber`, `_scrubToggle`, `_scrubTo`, `_updateScrubberUI` (`play-animation.js` ~5688-5800)
  - Contracts: `_buildExtensionPitch`, `_holdoutCapProjectionDetail`, `_renderHoldoutsBlock`, `_resignPlayerDemand`
  - Engine: `_rollGameInjuries`, `_rollNonContactInjuries`, `_tackleWeightsForContext`, `_bumpHitWear`, `_pickHitMechanism`, `_processWeeklyDiscipline`
  - Player names: `playerLink`, `_findPlayer`, `_findRetiredPlayer`
- **Preserve existing patterns.** Tier system goes through `playerLink`. Cap-bar hover uses `data-resign-hits`/`data-resign-cap` + `_resignHoverIn/Out`. Migrations flag-gated on `franchise.*`. Contracts must stamp `startSeason` + `signedOvr` at every creation site (currently 7). Backfills are idempotent + run from all three load paths.
- **`p.name` is sacred** — never rewrite for nicknames. Use `p.nickname` + `p.goesByNicknameOnly`.
- **`projectBroadcast` constants are tested** — TILT 38°, PERSPECTIVE 1100px, transform-origin 50% 100%, perspective-origin 50% 80%. If you change any, re-run `/tmp/snap_calib.mjs` and verify calibration dots against the actual field rect.
- **Verify edits with `node -c <file>.js`** — no formal test suite.
- **For UI changes, verify in a real browser** before claiming done. `python3 -m http.server 8765` in repo root + use Playwright via `/opt/node22/lib/node_modules/playwright/index.js`. Templates in `/tmp/snap_*.mjs`.
- **Commit + push each logical change** with a clear commit message. The user iterates fast and likes the audit trail.
- **Ask before broad architectural changes** — especially the broadcast cam math, unifying demand systems, or restructuring the contract screens.
- **The user prefers data-driven, persuasive UX** — when adding info, frame it as evidence the GM can act on.
- **CDN delivery**: after every push, give them `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html` (use `rawcdn`, not `raw`, to bypass branch caching).

---

## 10. Compact context (paste this as the opening message)

> Continuing work on **GridironChain**, a vanilla JS NFL franchise simulation at `/home/user/datasciencecoursera/gridiron-chain/`. Active branch: `claude/football-sim-blockchain-game-b3sdq`. Latest commit: `bcc4e96`. Files concatenated via `<script src>` in `play.html` — top-level `const`/`function` declarations are cross-file accessible. No build step. Syntax check with `node -c <file>.js`. Deploys to GitHub Pages on push (`.github/workflows/pages.yml`).
>
> **Current arc — animation realism, sprite expansion, speed + route polish** (~65 commits across two sessions):
> - **24 dedicated pose folders** in `sprites/`. Ball-in-hand on `football tucked unde` PixelLab char (`ed3c9fef`), defensive/OL on `Default` (`6f395002`), refs on user's capped variant (`488d33da`). Full list: `carry / juke / spin (8-frame) / hurdle / truck / stiff_arm / kick_slide / backpedal / dive_forward / drop_step (SE+SW only) / ragdoll / tumble / spin_fall / qb_carry / qb_scramble / strip_swat / release / scrape / tackled_carry / jam / ref_idle / ref_td_signal / ref_first_down / ref_flag / ref_whistle`.
> - Extract script at `sprites/_extract.py`. Maps PixelLab folder prefixes → pose name. **Be careful with prefix collisions** — e.g. `"running"` matches `"running_back_executing_*"` too; use `"running-"` (trailing dash) for the template folder.
> - **Procedural shape-math fallback is SUPPRESSED.** `_drawPlayerImpl` early-returns under `!window.GC_ALLOW_PROCEDURAL`. Any sprite gap surfaces as an invisible player + a `_proceduralSuppressed[pose]` counter bump (devtools-greppable). Don't expect procedural bodies to appear under any circumstance — diagnose missing sprites via the counter.
> - **Ragdoll sprite rotates with physics.** `drawPlayerSprite` reads `style._ragdoll.rot` and applies `ctx.rotate` before draw. Broadcast queue tries sprite before procedural. Means ragdolls aren't a special case anymore.
> - **Drop shadow** extracted to `_drawPlayerShadow(ctx, x, y, style, pose)` called from `drawPlayer` before the sprite path. PIXI field path uses batched `GCField.addShadow`; canvas2D uses a radial-gradient ellipse. Bulk/scale from `bodyType`. Ragdoll alpha fades as the body rotates off the ground.
> - **`no-outcome-preview` principle saved to feedback memory** — never tip a play's result before it visually resolves on field. Reference: `~/.claude/projects/.../memory/feedback_no_outcome_preview.md`. 5+ leaks gated.
> - **Sack rework**: action 2800-4500ms, contactT 0.62-0.75, rushReleaseT = max(0.45, contactT-0.12), QB drift biased away from estimated rusher, pile convergence, matched-OL "lost the rep" beat at rushReleaseT, strip-sack visual + recovery banner. Crowd reaction at contactT.
> - **Pass play**: catch flash + INT freeze (per-frame trigger), catch pose single-fire, PD viz, deep-ball teleport fixed (engine `throwT` = renderer `throwFrac` when `play.motion` present), short TE/RB swing-flat shape override at `targetDepth <= 3`.
> - **Speed audit (first principles, this arc):** every yps cap pinned to NFL realistic. `scaledDuration` 12 → 10 yps, `WR_TOP_YPS_VISUAL` 13 → 10.5, `primarySpeedPx` cap 18 → 11, `ST_PLAYER_YPS` 14 → 10.5, `BLOCKER_BASE_YPS` 15 → 9. `runPacing` accel widened (5%/3% → 15%/10%) so RB doesn't burst to top speed in 1 yd. Engine carrier "read" waypoint at `t=0.22` clamped to `[-1, 2]` regardless of total yards (was `yards * 0.14`).
> - **INT runback** rewritten — `easeOutCubic` → `runPacing`. `POST_CATCH_MS` for INT scales with return distance.
> - **Route convergence fixed** — QUICK_GAME / VERTICAL / default no longer emit identical wr1/wr2 routes. Concept-specific spacing: slant+out, go+dig, mirrored curls.
> - **Engine wiring of new poses**: QB `carry` → `qb_carry` (flea-flicker, sack pre-contact scan); `qb_scramble` replaces `carry`/`churn` for `isScramble`/`isQBRun` carriers; `strip_swat` at sack-forcer contact window + fumble-forcer contact window; `tackled_carry` at every ballcarrier-prone emit (WR post-catch, INT runback, KR/PR, fumble recoverer).
>
> **Earlier shipped foundations** (settled, don't redo): all three contract screens have portraits + tier-styled names + raise math + hover-preview cap bars + `_buildExtensionPitch` data block. Demand cooldown via `contract.startSeason` (7 creation sites, backfilled). Player legacy tier system (LEGEND/ICON/ELITE/PRO) via `playerLink`. Nicknames flag-only (never rewrite `p.name`). HOF voting annual + class-based. Engine physics layer with `p._wear`/`p._stress`/`p._bodyWear` (21 regions), force-scaled hit wear, bimodal ACL spike, concussion engine with CTE arc, hit mechanism + UR/ejection discipline. All major stat categories in NFL elite bands.
>
> **Open priorities** (top of queue):
> 1. **Penalty feature** — engine emits flag-on-play, render uses the ref sprites for accept/decline UI + yardage apply. Largest visible feature gap.
> 2. **Pre-snap motion / shifts** — engine emit + render slide. Motion man should trot, not sprint.
> 3. **Verification sit-and-watch pass** on user side. ~65 commits, no full end-to-end review yet.
> 4. **Task #47 pre-snap ball position (RB area)** — lingering.
> 5. **`hit` pose for pass-D pre-tackle contact** (`play-animation.js:4118`) — uses `engage` (block sprite) currently.
> 6. PIXI / WebGL migration (Tier 3) — multi-session work, see § 8.
>
> **Conventions**: never rewrite `p.name`. Tier system through `playerLink(p)`. Migrations version-flagged on `franchise.*`. Contracts include `startSeason` + `signedOvr`. Verify with `node -c`. For UI, also verify in browser via Playwright (templates in `/tmp/snap_*.mjs` — `python3 -m http.server 8765` in repo root). Commit + push each change. Ask before broad architectural moves or before touching broadcast cam math.
