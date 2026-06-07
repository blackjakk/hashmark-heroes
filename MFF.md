# MFF — advanced-analytics layer (EPA + PFF-style player grades)

> Status: **slices #1-#3 + EPA audit + pressure-log fix + franchise UI Slices
> A-I all shipped.** Engine attribution (trench reps, coverage), EPA, WPA,
> CPOE, DVOA-style adjustment, live WP charts, signature-plays leaderboard,
> Player-of-the-Game, analytics coaching AI (4th-down chart), production-
> based player development, and awards voting by EPA + WPA + grades — all
> live in the franchise. Two engine changes: Fix 1 (the visual pressure-log
> bug — bug fix) and Slice G (analytics coaching AI — intentional behavior
> change, validated behaviorally not byte-identically). The LB run-D grade
> is excluded as a structural limit. A tackle-skill engine tweak was
> attempted, found NOT calibration-neutral, and reverted — see "Engine
> fixes" below.

## Goal

Add an EPA / DVOA / PFF-family analytics layer ("MFF") on top of the sim:
team & QB **EPA**, and per-player **0-99 grades** for every position. The owner
wants full-position grades ("go all the way"), with the explicit constraint:
do not destabilise the calibration the engine was just tuned to (AUDIT.md bands).

## Architecture decision — attribution-only (Arch A), NOT mechanistic (Arch B)

A deep read of the engine flipped the original risk assessment. The per-rep
matchups are **already computed every snap — they just weren't recorded**:

- `_pickTrenchRep()` (`play-engine.js:2277`) picks a **specific DL + OL player**
  each snap (position-aware: edges vs tackles, interior vs guards/center;
  `overall^2`-weighted) and resolves their battle into the `pressure` scalar
  (`play-engine.js:3034-3044`) via team d-line/o-line ratings + the per-archetype
  `PASS_MATCHUP`/`RUN_MATCHUP` tables (`play-player.js`).
- Coverage already maps target receiver → covering defender deterministically
  (`_coverName`, ~`play-engine.js:4904`) and that defender's COV modulates the
  completion (`compPct`, ~`:5179`).
- Run blocking already resolves a **per-snap** OL-vs-DL win/loss
  (`_trench`/`_battleScore`, ~`:6019-6047`).

So "full-position grades" is mostly a **logging layer**, not engine surgery.

| | **Arch A — attribution-only (CHOSEN)** | Arch B — mechanistic (rejected) |
|---|---|---|
| What | Record the rep outcomes the engine already computes | Rewrite how pressure/credit drive play results |
| Calibration risk | **Zero** — no new `Math.random()`, no outcome change → aggregates byte-identical | Re-opens sack rate, comp%, YPC, INT, turnovers |
| Grade quality | Defensible for OL, DL/edge, CB, S, LB-coverage | Marginally better only for LB run-defense |

The only grade that stays genuinely weak under Arch A is **LB run-defense
tackling / S run-support**, because tackle *credit* is RNG-assigned
(`_creditDefStat`, `:1922`) — a grade there re-discovers OVR. Everything trench-
and coverage-based is real. Arch B's sole win over A (real LB run-D) does not
justify re-doing the whole calibration, so it is rejected.

## Safety model — `_MFF_ATTR` flag + A/B byte-identical proof

- Instance flag `this._MFF_ATTR` (constructor, default on; `opts.mffAttr:false`
  to disable) mirrors the existing `_ORACLE_DEV` pattern.
- **All** attribution writes are gated by it, use the `(x||0)+1` idiom (so the
  new keys only exist when written — `_emptyLine` is untouched), consume **no
  `Math.random()`**, and never mutate an existing field or a play outcome.
- `_mff_ab_check.js` proves the safety property: it patches `Math.random` with a
  seeded PRNG and runs each game **twice from the same seed** — flag off vs on —
  then asserts the box score (`sim.stats`) is **byte-identical** after stripping
  the MFF-only keys. If attribution ever consumed RNG or mutated state, the RNG
  streams desync and the test fails. It currently **PASSES**.
- Independently confirmed: `node _sim_audit.js 2` with the flag on (default)
  still reports every band OK (Completion% 64.3, INT 1.83%, Sacks/g 1.95,
  Turnovers 0.97, Yds/comp 10.5).

## Slice #1 — pass-rush / pass-protection (SHIPPED)

### What the engine now records (gated by `_MFF_ATTR`)
On every dropback, the resolved `reps` pair is credited:
- DL: `pass_rush_snaps`, `pressures` (expected-pressure, fractional), `qb_hits`
  (= sacks). On a sack the existing `sk` credit (`reps.dl`, `:4573`) is unchanged.
- OL: `pass_pro_snaps`, `pressures_allowed`. Existing `sacks_allowed`
  (`reps.ol`, `:4585`) unchanged.

Insertion points in `_playInner`: the per-dropback block sits just before the
sack roll (`if (Math.random() < sackPct)`, ~`:4440`); the sack top-up sits right
after the existing OL sacks_allowed charge (~`:4600`).

### xPressure credit (the key modelling choice)
The engine's `pressure` scalar is a **team** trench quantity (it uses team
d-line/o-line averages + the picked pair's archetype matchup; it does **NOT**
use the individual rusher's own rating). Measured over ~23k dropbacks it sits at
median **-0.12**, range ~[-0.57, +0.24] (OL wins most reps — completions ~62%;
probe: `_mff_press_probe.js`).

A **hard threshold** on it saturated badly — a dominant d-line cleared it on
~95% of reps, producing absurd 90%+ "pressure rates." Replaced with a smooth,
deterministic **expected-pressure (xPressure)** credit per rep:
`xp = clamp(MFF_PRESS_BASE + (pressure − MFF_PRESS_MED)·MFF_PRESS_SLOPE, 0.02, 0.85)`
with `BASE=0.34, MED=-0.12, SLOPE=0.55` (`play-engine.js`, top consts). A sack
tops the rep's credit up to a full 1.0. This lands the **league pressure rate at
36.8%** (NFL ~33-38%) and realistic per-player rates (top rushers ~40-46% over
their *key-matchup* reps — note the denominator is "snaps where this player was
THE resolved rep," a selected subset, so rates run higher than the all-snaps
NFL ~15%).

### Grade formulas (`_mff_audit.js`, 0-99 PFF-style, standardized)
- **Pass-rush**: `60 + 7·z(xPressureRate) + 11·z(sackRate) + 3·z(reps)`.
  Weighted toward sacks because the engine's pressure ignores the individual
  rusher's rating (so rate alone is a noisy individual signal), whereas sacks
  ARE individually credited; reps add a workload signal (picks are `overall^2`).
- **Pass-pro**: `60 − 13·z(pressureAllowedRate) − 6·z(sackAllowedRate)`.

### Validation (2-season round-robin)
- League pressure rate **36.8%** — in NFL band. ✓
- Pass-rush grade ↔ OVR **r=0.47**, pass-pro grade ↔ OVR **r=0.43** — both in the
  target 0.4-0.85 "defensible" band: talent shows through, but the grade adds
  information beyond raw OVR (not circular). ✓
- Face validity: top rushers are OVR 86-90, best blockers OVR 90-94, worst
  blockers all OVR 74-76, with realistic mid-OVR outliers having good/bad seasons.

## Slice #2 — run-block / run-stuff (SHIPPED)

### What the engine now records (gated by `_MFF_ATTR`)
On every run, the resolved `reps` pair is credited from the **already-computed**
per-snap run battle `_trench` (`play-engine.js:6079-6084`), which is derived from
`_battleScore = (reps.ol.overall − reps.dl.overall)/8 + (runMul−1)·5 + …` plus
`normal(0,1.5)` noise. Unlike pass pressure, this uses the **individual** lineman
ratings, so it's a genuine individual signal.
- OL: `run_block_snaps`, `run_block_wins` (`_trench` win/dominant_win),
  `run_block_losses` (loss/dominant_loss).
- DL: `run_def_snaps`, `run_stuffs` (OL beaten), `run_def_losses` (DL blocked).

Insertion point: immediately after the `_trench` tier is assigned (`:6085`).
Purely additive (`(x||0)+1`), no `Math.random()`, no outcome change.

**Deliberately left untouched:** the existing random pancake credit
(`olArr[Math.floor(Math.random()*olArr.length)]`, `:6207`). Redirecting it to
`reps.ol` would either remove a `Math.random()` (RNG desync) or change the
per-player pancake distribution (breaks the A/B byte-identical proof). The
run-block grade uses the new win/loss fields instead.

### Grades (`_mff_audit.js`)
- **Run-block (OL)**: `60 + 14·z((wins−losses)/snaps)`.
- **Run-stuff (DL)**: `60 + 14·z((stuffs−losses)/snaps)` (net DL run-trench win rate).
- **Combined DL** = avg(pass-rush, run-stuff); **Combined OL** = avg(pass-pro, run-block).

### Validation (5-season round-robin, ~1.4M plays — stable)
| grade | r ↔ OVR | verdict |
|---|---|---|
| pass-rush | 0.42 | ✓ defensible |
| pass-pro | 0.52 | ✓ defensible |
| run-block | 0.78 | ✓ defensible |
| run-stuff | 0.87 | ⚠ slightly circular (see finding #2) |
| DL combo | 0.79 | ✓ |
| OL combo | 0.82 | ✓ |

League run-block-win rate 48.2%; pressure rate 38.0%. A/B still byte-identical
(`_mff_ab_check.js` strips the six new run fields). Face validity strong: combined
OL leaders OVR 89-95, worst all OVR 72-76; combined DL leaders OVR 82-92.

## Slice #3 — coverage (CB / cover-LB) (SHIPPED)

### What the engine now records (gated by `_MFF_ATTR`)
Every targeted dropback already maps the target receiver → a deterministic cover
defender (`_coverName`, `play-engine.js:4954-4964`: wr1→cb1, wr2→cb2, slot→cb3,
TE→lb2, RB→lb1, …) whose COV rating modulates the completion (`cbCoverMod` →
`compPct`, `:5229`). Now that defender is credited:
- `cover_tgt` — every target in his coverage (denominator), at `:4965`.
- `cover_comp` + `cover_yds` — on a completion, after `yards` is finalized (`:5347`).

PD/INT come from the engine's existing `_creditDBStat` credit (`pd`/`int_made`).
Purely additive, no `Math.random()`, no outcome change.

### Grade (`_mff_audit.js`) — standardized WITHIN position group
`60 − 11·z(completion-allowed rate) − 6·z(yds/target) + 7·z((PD+2·INT)/target)`,
standardized within {CB, LB} separately (LBs cover worse by design via the larger
`_coverScale`, so pooling them with CBs would be unfair).

### Validation (round-robin) — validate against COV, not OVR
Coverage is driven by the **COV** rating (`stats[8]`), which is only one component
of a DB's OVR — so the correct yardstick is grade↔COV:
| grade | r ↔ COV | (r ↔ OVR) | verdict |
|---|---|---|---|
| cover-CB | **0.75** | 0.27 | ✓ defensible — tracks coverage skill |
| cover-LB | **0.43** | 0.33 | ✓ defensible |

League completion-allowed rate **64.2%** — matches NFL comp% ~64% (a strong
sanity check that the attribution captures the real outcome). A/B still byte-
identical. Face validity: worst CBs are all **COV 60** (despite OVR ~76); top CBs
are COV 86-95.

## EPA layer (SHIPPED — no engine change, pure post-processing)

`_mff_epa.js` builds an empirical Expected-Points model and EPA per play entirely
from the play log — **no engine edit, so no A/B gate is even needed** (it can't
affect a simulation it only reads).

### Method (nflfastR-style, simplified)
1. **EP model:** `EP(down, ytg-bucket, yardline-bucket)` = mean signed points of the
   NEXT score within the same half, over all plays (with coarser down/yardline and
   yardline-only fallbacks when a bucket has < 30 samples). Scores are detected from
   the play log's `homeScore`/`awayScore` tuple changes.
2. **EPA(play)** = `EP_after − EP_before`, where `EP_after` is the actual points if
   the drive scored before the next snap, else the next snap's EP (negated if
   possession flipped), else 0 at end of half.
3. **Roll-ups:** team offense/defense EPA/play, pass vs run EPA, success rate
   (% plays with EPA > 0), and per-QB EPA (attributed via the log's `passer` field).

### Validation (2-season round-robin)
- **EP gradient is textbook:** own-25 +0.66, midfield +2.57, 1st&goal-5 +5.75,
  3rd&8-own-10 −1.02, backed-up-own-1 −0.18. Monotonic in field position, negative
  on long downs deep in own territory. Absolute values run slightly above NFL refs
  (the sim's next-score-within-half is a touch scoring-rich) but the shape and
  relative ordering — what EPA actually uses — are correct.
- pass EPA/play **+0.042** > run **−0.055** (passing more efficient, as in the NFL);
  overall success rate **48%** (NFL ~45%).
- **Construct validity:** team offensive EPA/play ↔ points/game **r=0.94** — EPA
  explains scoring, the key check for an EPA model.
- QB leaderboard: the OVR-97 QB tops EPA/dropback; QB EPA/db ↔ OVR **r=0.45**
  (talent shows through without being a circular OVR restatement).

### Skill-player EPA (WR / RB) and LB run-D (added to `_mff_epa.js`)
- **Receiving EPA** (attributed via the log's `receiver`): top-12 by TOTAL EPA are
  OVR 78-95 (mostly 90+); total EPA ↔ OVR **r=0.51** ✓. But EPA **per reception**
  ↔ OVR **r=−0.04** — per-catch efficiency is QB/scheme/situation-driven, not WR
  skill, so volume (total EPA) is the WR signal, not efficiency.
- **Rushing EPA** (via `rusher`): top-12 by TOTAL EPA are OVR 90-92; total EPA ↔ OVR
  **r=0.16**, EPA/att ↔ OVR **r=0.21** — weak, matching the analytics consensus that
  RB production is less individually determinative.
- **LB run-defense grade** (built from the log's `tackler` + run yardage): stop-rate
  grade ↔ OVR **r=0.00 — pure noise.** This is the predicted Arch-A failure: the
  engine's tackle credit (`_creditDefStat`, `:1922`) picks WHO tackles by a
  positional context weight + a final RANDOM draw, NOT by the individual defender's
  rating, so an LB's run-stop counts are rating-blind. A defensible LB run-D grade
  needs Arch-B (assign the run tackle to the LB who actually filled the gap by
  AWR-vs-context) — out of scope, but the audit prints the verdict explicitly.

## Engine fixes (post slice #3)

### Fix 1 — latent pressure-log bug (SHIPPED, safe) — `_currentPressure = 0` reset removed
A stray `this._currentPressure = 0` at the start of `_playInner` clobbered the
real pressure value (set above at `:3070` when the trench matchup is picked)
before the visual layer could read it — every logged play had `pressure: 0`. The
reset is a leftover from a refactor where the trench computation moved above this
point. Removed. **Provably safe:** `_currentPressure` is read in exactly ONE place
— `_pushVisual` (`:2592`) — which builds the play-log/animation object. It never
feeds game logic or any `Math.random()`, so it cannot move a calibration band; it
only restores the real per-snap pressure to the trench animation + play log.

### Fix 2 — tackle-skill weighting (ATTEMPTED, then REVERTED — not calibration-neutral)
The attempt: weight `_creditDefStat`'s within-position tackle pick by the
defender's TCK+AWR so the better run-defender gets the box-score credit. It was
committed (10a8fa2) with a claim of "byte-identical, RNG-stream preserved." **That
claim was wrong, and the change is reverted.**

Why it broke: the chosen tackler name flows into `_bumpHitWear` (`:6291`), whose
`force` is computed from THAT tackler's STR/SPD/archetype and then gates several
`Math.random()` rolls — the big-hit injury roll (`:737`, gated `force≥1.1`), the
tackler-injury roll (`:749`, `force≥1.3`), the UR-penalty roll (`:759`, `force≥1.4`),
and `_pickHitMechanism` (`:701`, `force≥1.45`). Picking a different tackler changes
`force`, flips which RNG-gated branches fire, and **desyncs the whole RNG stream** —
the A/B gate showed 5/8 games diverging completely (different play counts, yardage,
scores). Worse, that injury surface is a *deliberately tuned* calibration knob (see
the comment at `:721-736`: it was set to land QB-availability and passing-yield
ceilings in their NFL bands). So the tweak silently re-opened the exact calibration
the MFF layer promised never to touch.

Why reverting costs nothing: **no grade reads `tkl`.** DL run-stuff (the real
run-defense grade) comes from the trench `reps` (slice #2), not tackle counts; LB
run-D is excluded as a structural category error regardless (a team's LB tackles
are ~fixed by play volume + context, so within-team reshuffling can't manufacture
cross-league signal — the same reason PFF doesn't grade LBs from box scores). The
tweak's only benefit was cosmetic (which LB tops his unit in tackles), which does
not justify re-opening calibration. The LB UI grade is coverage-only (cover-LB from
slice #3, graded against the COV rating that drives it).

**Lesson:** "one weighted draw, same RNG count" is necessary but NOT sufficient for
calibration-neutrality — the *return value* of an attribution pick can still steer
downstream RNG. The A/B byte-identical gate is what caught it; always run it, and
never trust a "looks count-neutral" argument over the gate's verdict.


1. **The engine's `pressure` is team-level** — it never incorporates the picked
   rusher's individual rating, only team d-line avg + archetype matchup + pick
   frequency. So a pure pressure-rate grade is a weak *individual* signal
   (pass-rush rate ↔ OVR is NOISY); sack-weighting is needed to recover talent
   correlation. (Lifting this would require Arch B — out of scope.)
2. **Opposite asymmetry in the run game:** the run-trench `_battleScore` IS
   individual (OVR-delta dominated, only SD-1.5 noise), so run-trench outcomes
   are nearly rating-deterministic. A pure run-D win-rate grade therefore
   re-derives OVR (run-stuff r=0.87 — too high to "add info"). The grade is still
   REAL (actual resolved reps), it just confirms OVR; combined with pass-rush into
   the DL grade (r=0.79) it's defensible. Real value-add for run-D will come from
   the (noisier) tackle/TFL attribution in a later slice. Net: pass-rush is too
   NOISY and run-stuff too DETERMINISTIC — opposite failure modes, both inherent
   to how the engine models each phase, and both fixed by combining signals.
3. **Coverage validates against COV, not OVR; safeties aren't directly targeted.**
   A DB's coverage grade tracks the COV rating (the actual `compPct` driver), not
   his blended OVR — so grade↔OVR looks "noisy" (CB 0.27) while grade↔COV is
   defensible (CB 0.75). Always validate a skill grade against the rating the
   engine actually uses. Separately, the `_coverName` map never assigns a SAFETY
   as the primary cover man (safeties only contribute via the team safety-help
   term), so safeties accrue zero `cover_tgt` and cannot be coverage-graded from
   this signal — a safety grade needs the run-support / deep-help attribution of a
   later slice. Same pattern as findings #1/#2: pass-completion is a many-factor
   aggregate (CB is a small term → noisy individual signal), so the CB grade is
   only defensible once judged on the right axis.
4. **Latent pressure-log bug — NOW FIXED (Fix 1 above).** `this._currentPressure`
   was set to the real value when the trench matchup is picked, then immediately
   **reset to 0** at the top of the per-snap block, so the play-log / visual trench
   animation always saw `pressure=0`. Game logic was unaffected (only `_pushVisual`
   reads it — confirmed the single reader), so removing the reset is calibration-
   safe. The MFF attribution layer always used the local `pressure` const, not the
   logged value, so it was already correct.

## Franchise UI — Slice A (grades) + Slice B (EPA), SHIPPED

The audit scripts (`_mff_audit.js`, `_mff_epa.js`) compute the analytics offline
against a clean round-robin. The live franchise needs the same numbers shown to
the player in their player-detail panel + matchup compare. Two slices were
shipped — each tested with synthetic + end-to-end (engine→merge→module) checks.

### Slice A — live PFF-style grades (no engine change, no save-state change)
`mergeSeasonStats` (`play-franchise-stats.js:8146`) already persists every MFF
attribution field via generic `+=` iteration — so the rate stats are already in
`franchise.seasonStats`. New module in `play-franchise-stats.js`:
`_mffComputeLeagueGrades` iterates the league pool, builds qualified subpools
per position group, z-scores rates exactly matching `_mff_audit.js`'s formulas,
and returns 0-99 grades; `mffGradeChipsHtml(p)` renders the chip block; wired
into `_buildStatScopeBlock` (`play-franchise-season.js`) on the regular-season
scope only. Pool thresholds tuned for live display (≥100 pass-rush snaps, ≥80
run snaps, ≥25 coverage targets, pool min ≥6) so chips surface by ~week 5.

Position rollup handles BOTH the engine's slot strings (DE/DT/LT/LG/C/RG/RT
on per-game stat lines) AND the live player object's group strings (DL/OL/CB/LB).
This dual lookup was the bug that field-realism testing caught — without it the
feature would have rendered nothing in the real UI.

End-to-end validation (1-season round-robin → seasonStats → grade module):
- DL combined ↔ OVR **r=0.74** ✓  · OL combined ↔ OVR **r=0.54** ✓
- DL pass-rush ↔ OVR **r=0.40** ✓ · CB coverage ↔ OVR r=0.15 (correct — coverage
  is driven by COV not OVR; audit confirmed r=0.75 vs COV)

### Slice I — Awards voting by EPA + WPA + grades
The awards-voting machinery (`mvpScore`, `_computeOPOY`, `_computeDPOY`)
gets a small analytics bonus layered on top of the existing traditional
box-score formulas. The metric weights are calibrated so an elite
"analytics darling" (high EPA + high WPA + high CPOE) competes with a
traditional box-stat MVP (high TD/yards) — but doesn't dominate.

Bonus weights (calibrated so a typical elite QB earns ~30-80 bonus
points on a 200-400 baseline traditional score):
- EPA: 2.0 points per EPA-unit (sum across season)
- WPA: 8.0 points per WPA-unit (heavily weighted — clutch matters)
- CPOE (MVP only): 1.0 point per CPOE % (modest, since CPOE correlates
  with the existing pass_comp / pass_yds traditional metrics already)

Surfaces affected:
- `mvpScore(p)` — adds EPA + WPA + CPOE bonus inline (used by MVP, ROY,
  per-game MVP, all-pro voting).
- `_computeOPOY()` — uses `_mffAwardsAnalyticsBonus(p)` (EPA + WPA only).
- `_computeDPOY()` — uses Slice A MFF grades (defensive EPA attribution
  is sparse at per-snap level, so we proxy via grade × 0.5 × (grade - 50)).
- Defensive scoring not broken — `_idpScore` baseline is unchanged.

VALIDATION (smoke test):
- ANALYTICS_DARLING (28TD/4000y/+25 EPA/+4 WPA) gets ~82pt bonus on top.
- BOX_STAT_KING (38TD/4800y/+8 EPA/+1 WPA) still wins MVP (TD/yards
  dominate) — but the gap (65.4pts) narrows enough that analytics
  outperformers can compete.
- OPOY voting still picks BOX_STAT_KING in this scenario (correct —
  big TD/yard advantage isn't fully offset by bonus alone).
- DPOY voting crash-safe even with no grade data available.

ENGINE UNCHANGED. Save-state additive only via reads (no new fields).
On legacy saves with no EPA history → bonus = 0, awards behave identically
to before.

### Slice H — Production-based player development [OFFSEASON FLOW CHANGE]
Statistical production now loops back into player development. A player
who posted elite EPA/CPOE/grades last season gets a small dev tailwind
in the next offseason; an underperformer gets a headwind. Bounded
±20% (multiplier in [0.80, 1.20]) so a single great season can't
catapult a player past their potential ceiling.

Surface: a new `_mffProductionBoost(p, season)` multiplier in
`play-franchise-stats.js`, applied alongside `coachBoost * tradeBoost`
in the offseason dev pass at `play-franchise-offseason.js:11468`.

Tier mapping per position (chosen to match each position's Slice B/A
signal strength):
- **QB** (volume gate: ≥50 dropbacks; signal: EPA/db)
  - ≥+0.15 → ×1.20  (elite — Mahomes/Allen tier)
  - ≥+0.05 → ×1.10  (good — playoff starter)
  - ±0.05  → ×1.00  (average)
  - ≥-0.15 → ×0.92  (poor)
  - <-0.15 → ×0.85  (bad)
- **WR/TE** (gate: ≥20 catches; signal: total EPA)
  - ≥+25 → ×1.15, ≥+10 → ×1.08, ±10 → ×1.00, <-10 → ×0.92
- **RB** (gate: ≥60 carries; signal: total EPA — magnitudes smaller
  because RB EPA is noisy per audit)
  - ≥+15 → ×1.10, ≥+5 → ×1.05, ±15 → ×1.00, <-15 → ×0.93
- **DL/OL/CB/LB** (signal: Slice A standardized MFF grade)
  - ≥85 → ×1.15, ≥72 → ×1.06, 50-72 → ×1.00, ≥35 → ×0.92, <35 → ×0.85

Players with no production data (rookies, didn't play) get 1.00 —
defensive: the boost helper never blocks the dev pass.

VALIDATION (smoke test, 16 checks): every tier mapping correct, bounds
held, unknown/null/missing-name all safely return 1.0.

ENGINE UNCHANGED. Save-state additive (no new fields — reads existing
EPA/grade data Slice B/A already produce).

### Slice G — Analytics coaching AI (4th-down chart) [ENGINE CHANGE]
**FIRST ENGINE CHANGE OF THIS SERIES** that's intentional (not the bug-fix
Fix 1 from earlier). Coaches with a new `analyticsAgg` trait (0-100)
consult an NFL-style 4th-down decision chart (Burke / nflfastR / Stats
Bomb consensus) — analytics-aggressive coaches defer to the chart more
often; conservative coaches stick with traditional rules.

ARCHITECTURE:
- `coach.hc.analyticsAgg` (0-100): new trait, backfilled in
  `_backfillCoachingStaff`. Derived from specialtyTrait:
  Riverboat Gambler=80, Conservative=15, Game Manager=45,
  Offensive Minded=55, Defensive Minded=35, Player Developer=50,
  default=50, all ±10 random for within-trait variance.
- In `_play` 4th-down decision block (`play-engine.js:3227`): after the
  traditional `action` is set, an analytics-chart recommendation overrides
  it with probability `analyticsAgg / 100`. So:
  - analyticsAgg=80 → chart wins 80% of decisions
  - analyticsAgg=15 → chart wins 15% (traditional logic still drives most)
  - analyticsAgg=50 (default) → chart wins half the time
- Chart encodes the standard NFL analytics-era go thresholds (max ytg
  that says GO):
  - own deep ≤30: ≤1 yd
  - own mid 30-50: ≤2 yd
  - midfield 50-75: ≤4 yd
  - opp 75-85 (FG range): ≤2 yd (FG is high-make)
  - opp 85-95 (RZ edge): ≤2/≤4 trailing late
  - opp 95+ (goal line): ≤2 always; ≤4 trailing late
- Game-state shifts: trailing 14+ late → bump threshold ≥5;
  leading 14+ late → drop to ≤1 (burn clock); tied/trailing 1-3 late
  with FG that ties/wins → always kick.

ENGINE INSIGHT: this is NOT calibration-neutral by design. The A/B
byte-identity check would FAIL — that's expected. Validation is
behavioral: no crashes, sensible directional shift, no desyncs.

VALIDATION (60 games × 3 levels of analyticsAgg):
| analyticsAgg | 4th-down GO% | FG% | PUNT% |
|---|---|---|---|
| 10 (conservative) | 22.0% | 6.3% | 71.7% |
| 50 (default / backfilled) | 21.6% | 5.7% | 72.7% |
| 90 (Riverboat-style) | 29.8% | 4.4% | 65.8% |

Clear +7.8pt shift in go-for-it rate from low → high analyticsAgg.
Bounded (not a 100% revolution). agg=50 sits naturally between agg=10
and agg=90 — backfilled saves don't get a dramatic behavior change.

ENGINE TOUCHED: `play-engine.js` 4th-down decision block ONLY. Adds new
`coach.hc.analyticsAgg` field via backfill. Safe even on legacy saves
(coach missing analyticsAgg → defaults to 50 via `?? 50`).

### Slice F — Live WP curve + Player of the Game + signature plays UI
Pure UI on top of Slice C's data. Three new visible surfaces:
- **Live WP curve** on every post-game recap: compact SVG sparkline of
  the game's win-probability from the user's perspective. Quarter
  dividers + 50% baseline for reference.
- **Player of the Game** callout right below the WP curve: pulls the
  biggest |WPA| play of the game from the `bestPerGame` array Slice C
  populates.
- **Biggest WP swings of the season** leaderboard in the season-highlights
  yearbook: top 10 plays by |WPA|, sourced from the `topPlays` buffer.
  Captures signature plays that the existing highlight reel (selects on
  EPA + clutch heuristics) might miss.

New API:
- `mffGameWPCurve(homeId, awayId, week, userTeamId)` — per-snap curve
  from the user's perspective; null if game not in log.
- `mffWPCurveSvg(curve, opts)` — SVG sparkline (default 320×60).
- `mffPlayerOfGameFor(homeId, awayId, week)` — HTML callout.
- `mffSeasonTopSwingsHtml(limit)` — leaderboard HTML.
- `mffPostGameWPBlock(userTeamId)` — composite (curve + PotG) for the
  user's most-recently-played game.

Wired in at:
- `_buildPostGameHeadline` (`play-franchise-stats.js:6135`) — appends
  `mffPostGameWPBlock(teamId)` after the existing headline + blurb.
- `frnGoToOffseason` season-highlights section
  (`play-franchise-offseason.js:9100`) — adds the swings leaderboard
  between the highlight reel and the historical section.

VALIDATION (smoke test, 5 sections):
- WP curve is zero-sum (home WP + away WP ≈ 1 at every snap) ✓
- Curve ends at WP=1 for winner, WP=0 for loser ✓
- Curve x-axis monotonic in time ✓
- SVG renders with quarter dividers + path element ✓
- PotG callout pulls from `bestPerGame` correctly ✓
- Top-swings leaderboard renders rows ✓

ENGINE UNCHANGED. No save-state changes (consumes existing playLog).

### Slice E — DVOA-style opponent adjustment
Iteratively adjusts each team's EPA by the strength of opponents they
faced. Massey-style algorithm: each pass subtracts opponent strength
(weighted by per-game play counts) and replaces raw with adjusted; 4
iterations to convergence on a 32-team league.

- `_mffComputeDVOA(maxIter=4)` — does the iteration.
- `mffTeamDVOA(teamId)` — cached lookup returning `{off, def, sosOff, sosDef}`.
- `mffTeamSOS(teamId)` — convenience for just the strength-of-schedule.
- Matchup compare block now shows **ADJ EPA/PLAY (OFF/DEF)** as the primary
  rows (more predictive than raw). Falls back to raw when DVOA data
  isn't yet meaningful (week 1, few games).

VALIDATION: live engine output with deliberately UNBALANCED schedule
(strong-half vs weak-half teams play more in-tier games):
- SOS ordering correct (weak-half teams' sosDef = 0.023, strong-half =
  0.011 — strong teams faced tougher opposing defenses in this setup).
- Adjusted net EPA ↔ wins r=0.74, ↔ margin r=0.90 (vs raw 0.80 / 0.93).
- Specific team example: tid 21 (strong-half, 14 wins, +145 pt diff) —
  rawNet EPA +0.141 → adjNet +0.181 (recognized as better-than-record
  because faced tough opponents).

ENGINE INSIGHT: in this engine, individual-game outcomes are LOW-VARIANCE
relative to NFL (roster talent ~deterministically wins). So raw EPA
already implicitly captures opponent strength, and the adjustment adds
estimation noise without much aggregate-correlation gain. The adjustment
is mathematically correct and helps INDIVIDUAL team rankings (where SOS
matters most — see tid 21 above), but won't dramatically shift aggregate
metrics in our low-variance environment. In NFL where individual games
have ~14pt std dev, this would matter much more.

### Slice D — CPOE (Completion Percentage Over Expected)
The QB accuracy metric. Built on the same per-play log + walker as B/C.
- **Baked xComp table** (`_mff_bake_xcomp.js`, 6 cells, ~0.5 KB inline).
  Method: empirical completion rate per (targetDepth_bucket ×
  pressure_bucket) over the 2-season round-robin. **SKILL-FREE BY
  CONSTRUCTION** — depends on throw difficulty only, never on the QB.
  Otherwise CPOE collapses to ~0 for everyone (you'd subtract QB's own
  expected from his actual).
- **`td` (targetDepth) + `pr` (pressure)** added to `_mffCompactPlay`
  (sparse — only set when present).
- **CPOE per QB** folded into the existing walker as `(actComp - xComp)
  / attComp`, only counted on complete/incomplete attempts with a
  measurable depth (sacks/INTs aren't accuracy events). Threshold 30
  attempts for the chip.
- **QB chip block** now shows EPA/DB · WPA · SR · **CPOE** (4 chips).

ENGINE INSIGHT from the bake: in this engine, **pressure barely affects
completion rate** (short clean 75.2% vs short pressured 76.7% — opposite
of NFL where pressure drops completion ~15pts). So CPOE here primarily
reflects QB depth-selection accuracy, not pressure-handling. Candidate
for a future xPressure recalibration (engine fix, its own A/B gate).

End-to-end validation (live engine output through the live walker):
| Metric | NFL ref | Live | Verdict |
|---|---|---|---|
| League mean CPOE | ~0% (skill-free) | −0.54% | ✓ baseline holds |
| **QB CPOE ↔ OVR** | **~0.50** | **r=0.56** | matches ✓ |
| QB raw comp% ↔ OVR | ~0.45 | r=0.52 | ✓ |
| Top-5 CPOE all OVR 79+ | yes | yes (79-94) | ✓ |
| Bottom-5 mostly OVR <85 | yes | yes (72-84) | ✓ |

CPOE adds **independent signal beyond raw completion %** (r=0.56 vs 0.52)
— the metric is doing real work, not just renaming completion percentage.

### Slice C — WP / WPA / real Success Rate
Extends Slice B's per-play log + module (single walker, single cache). Adds:
- **Baked WP table** (`_mff_bake_wp.js`, ~26 KB → 3 inline constants).
  Method: empirical P(offense wins | sd_bucket, time_bucket, yl, down) over
  the 2-season round-robin, with 3-level fallback (full → mid → coarse).
- **`t` (per-quarter clock seconds)** added to `_mffCompactPlay` (the one
  field the WP lookup needs that wasn't already in the Slice B log).
- **WPA computation** in the same walker as EPA: `wpa = WP_after − WP_before`,
  where WP_after uses the next snap's state (negated on possession flip;
  zero-sum). End-of-game uses actual outcome ONLY IF the play actually
  changed the final score — otherwise the play ran out the clock and WPA≈0.
  (Without that guard, every team's last play of a loss took the full
  −0.5 WPA hit even when the loss was already locked in, which broke the
  team-WPA-↔-wins correlation.)
- **Real Football Outsiders Success Rate**: 1st-down ≥40% of YTG, 2nd-down
  ≥60%, 3rd/4th ≥100% (conversion). Sacks/INTs/incompletions are never
  successful; any score on the play overrides. Replaces Slice B's positive-
  EPA proxy.
- **Top-swings leaderboard + Player-of-the-Game**: every play with |WPA| >
  0.05 is bucketed; top 200 retained, sorted by |WPA|. Per-game best WPA
  emitted to `bestPerGame` for "Player of the Game" rendering.

UI surface: the existing player chip block (`mffPlayerEPAChipsHtml`) now
renders **EPA · WPA · SR** triplets per position (efficiency · leverage ·
consistency). The matchup compare block adds a SUCCESS RATE row alongside
EPA/PLAY. Two new accessors (`mffTopPlays`, `mffPlayerOfGame`,
`mffAllPlayerOfGame`) expose the signature-plays / PotG data for the
post-game / season leaderboard UIs to be added in Slice F.

End-to-end validation (live engine output through the live walker):
| Metric | NFL ref | Live | Verdict |
|---|---|---|---|
| Pass EPA/play | +0.05 to +0.15 | +0.058 | ✓ |
| Pass WPA/play | small positive | +0.0004 | ✓ (zero-sum near zero) |
| League success rate | ~45% | 48-50% | ✓ |
| Σ off+def WPA (zero-sum) | 0 | 0.000 | exact ✓ |
| **QB WPA/db ↔ OVR** | similar to EPA r=0.47 | **r=0.47** | matches ✓ |
| QB SR ↔ OVR | r=0.35-0.50 | r=0.49 | ✓ |
| Team SR ↔ pt margin | r=0.75-0.85 | r=0.63-0.76 | ✓ in band |
| Team WPA ↔ wins | theoretical r=1.0 | r=0.41-0.84 (high variance) | direction only ✓ |

KNOWN LIMITATION: the empirical lookup table isn't a calibrated probabilistic
forecast. Per-play WPA is correct in shape; multi-game aggregates have
~±1 WPA noise per team because game-WPA doesn't perfectly integrate to ±0.5.
This drags the team-WPA-↔-wins correlation from the theoretical r≈1.0 to
0.4-0.8 in practice. Per-play surfaces (signature plays, PotG, individual
chip values) are NOT materially affected — only multi-game aggregates show
the bias. Proper fix would refit the bake as a smoothed logistic/GBM model
(future work; not blocking the gameplay enhancements that consume WPA).

### Slice B — live EPA (team / QB / WR / RB)
Three architectural decisions ground this:

1. **Bake the EP model, don't compute it live.** EP(state) is a property of
   the engine's RULES (yards-per-drive, scoring odds from a state); talent
   shifts HOW OFTEN a state is reached, not its points-value. A baked table
   from a 2-season round-robin is the correct estimate. A "live" franchise
   model is strictly noisier mid-season (~12k plays vs 64k+ baked) for zero
   fidelity gain. Baked table lives in `play-franchise-stats.js` as three
   constants (~173 entries, ~2.8 KB).
2. **Retain a compact per-play log per season** (`franchise.playLog[season]`).
   EPA itself doesn't strictly need retention — could be tallied at game-end —
   but the same log enables WPA, "signature plays" leaderboards, and replay
   navigation without a later additive save-state change. ~120 bytes/snap ×
   ~34k snaps/17-game-season ≈ **3.9 MB**. IndexedDB has no size limit
   (canonical save) so this fits trivially; localStorage may trim under
   pressure, which `_trimFranchiseForStorage` handles gracefully.
3. **Score attribution follows the audit's "credit the play that got you
   here" convention** — a TD play has the BEFORE-score on its record (engine
   convention) and the next drive's snap has the AFTER-score; the EPA walker
   detects the score change at the FIRST snap with a higher running score and
   credits the previous snap (which IS the TD play). End-of-game scores are
   captured via the `__g` marker's `hf`/`af` (final scores), so walk-off TDs
   don't lose EP_after credit.

Capture point: `markGamePlayed` (`play-franchise-offseason.js:1883`) walks
`sim.plays` before discard and pushes compact records via `_mffCompactPlay`
(13 essential fields, sparse — only present when meaningful). Season rollover
(`frnNewSeason`, `:14410`) freezes the season's EPA summary into
`franchise.epaSummary[oldSeason]` (team totals + top-20 QB / top-30 WR / top-20
RB) and drops the raw log; `_trimFranchiseForStorage` (`play-franchise-core.js`)
is a safety net for any orphaned old-season logs.

UI surface: `mffPlayerEPAChipsHtml(p)` renders alongside the grade chips in
`_buildStatScopeBlock`; `mffTeamEPAStatRows` adds **EPA/PLAY (OFF)** and
**EPA/PLAY (DEF)** rows to the win-prob matchup compare block
(`play-franchise-stats.js:5566`). Chip thresholds: QB ≥10 dropbacks, WR ≥5
catches, RB ≥10 attempts — to suppress noisy single-game readings.

End-to-end validation (engine→playLog→`_mffComputeEPA`, 1-season round-robin):
| Metric | Audit reference | Live | Verdict |
|---|---|---|---|
| Pass EPA/play | +0.042 | +0.058 | ✓ in NFL band |
| Run EPA/play | -0.055 | +0.003 | ✓ in NFL band |
| Success rate | 48% | 48% | exact ✓ |
| Team EPA ↔ PPG | r=0.94 | r=0.86 | ✓ strong |
| **QB EPA/db ↔ OVR** | **r=0.45** | **r=0.47** | matches ✓ |
| WR total EPA ↔ OVR | r=0.51 | r=0.61 | ✓ matches |
| RB total EPA ↔ OVR | r=0.16 (weak) | r=0.27 (weak) | ✓ matches weakness |

## Tooling
- `_mff_audit.js [seasons]` — grades + leaderboards + validation.
- `_mff_epa.js [seasons]` — EPA leaderboards + validation.
- `_mff_ab_check.js` — byte-identical safety gate (run after ANY engine change).
- `_mff_bake_ep.js [seasons]` — re-bake the EP table if the engine's scoring
  environment drifts; outputs `/tmp/mff_ep_baked.js` to paste into
  `play-franchise-stats.js`. Re-run only when the engine's rules of field
  position change.
- `_mff_bake_wp.js [seasons]` — re-bake the Win Probability table. Same
  output convention as `_mff_bake_ep.js` — outputs `/tmp/mff_wp_baked.js`.
  Note known limitation: the empirical bake doesn't satisfy calibrated-
  probability constraints (Σ WPA across teams ≠ 0 over a season), which
  drags team-level WPA aggregates down. Per-play WPA is correct in shape.
  Proper fix is GBM/logistic smoothing of the bake (future work).
- `_mff_bake_xcomp.js [seasons]` — re-bake the skill-free expected-
  completion table for CPOE (Slice D). Outputs `/tmp/mff_xcomp_baked.js`.
  6 cells (depth × pressure). Re-run if the engine's completion model
  changes materially.
- `_mff_press_probe.js` — pressure-distribution probe for the xPressure consts.
- `/tmp/mff_prof.js` — paste-into-devtools-console UI profiler (wraps the
  hot render functions, prints a sorted timing table). Built during the
  perf pass; not committed (throwaway diagnostic).

## Done ledger (everything shipped, newest first)
Each line = one shipped, validated, pushed unit. Commits on branch
`claude/football-sim-blockchain-game-b3sdq`.

ENGINE ATTRIBUTION (calibration-safe, A/B byte-identical proven):
- ✅ Slice #1 — pass-rush / pass-protection grades
- ✅ Slice #2 — run-block / run-stuff grades
- ✅ Slice #3 — coverage grades (CB / cover-LB)
- ✅ Fix 1 — latent pressure-log bug (visual-only, calibration-safe)
- ❌ LB run-defense tackling — ASSESSED + EXCLUDED (structural category
  error; tackle-skill engine tweak attempted, found NOT calibration-
  neutral, reverted — see "Engine fixes → Fix 2")

OFFLINE AUDIT TOOLS:
- ✅ `_mff_audit.js` — grades + leaderboards + validation
- ✅ `_mff_epa.js` — EPA leaderboards + validation

LIVE FRANCHISE UI (Slices A-I, all shipped this session):
- ✅ A — live PFF-style grades (player chips)
- ✅ B — live EPA (team / QB / WR / RB) + retained per-play log
- ✅ C — WP / WPA / real FO Success Rate + top-swings + Player-of-Game data
- ✅ D — CPOE (skill-free baked xComp)
- ✅ E — DVOA-style opponent adjustment + SOS
- ✅ F — live WP curve SVG + Player-of-the-Game callout + signature-plays board
- ✅ G — analytics coaching AI (4th-down chart) [ENGINE CHANGE, behavioral]
- ✅ H — production-based player development [offseason flow change]
- ✅ I — awards voting by EPA + WPA + grades

PERF (post Slice I): ✅ 5 commits, see "UI performance pass" above.

LIVE GAME PRESENTATION (post-perf session):
- ✅ Receiver-catch teleport fix (map ALL receivers to a tracked slot) —
  diagnosed headlessly over 4k completions; deep-ball teleport 5.3%→0%.
- ✅ DRIVE CHART tab — every play as a +/- bar at its TRUE field position
  (home L→R, away R→L), colored by success/EPA via `_mffIsSuccess`/`_mffEP`
  (the analytics layer, reused). Live + post-game. See below.
- ✅ Top-down view = dots (one colored dot + jersey # per player) instead
  of sprites; broadcast cam unchanged.
- ✅ LED stadium ribbon / light beams hidden in top-down (broadcast-only
  chrome was floating over the flat field).

## Drive chart (analytics consumer)

`DriveChartPanel` + `_buildDriveChartData(gr, head)` in play-broadcast.js.
Walks `gameResult.plays` up to `playHead`, groups into drives
(drive_summary markers + possession-change fallback + result inference from
score/fg/punt markers), and lays each scrimmage play out as a horizontal
bar on a 0-100 field at its real yard line. Geometry: home poss →
fieldX=yardLine (drives right), away poss → fieldX=100−yardLine (drives
left); bar spans [start, start+yards]; a bright LOS tick shows the snap
side so gain vs loss direction reads. Color tiers from the analytics layer:
TD / good (success) / ok (gain but stalled) / loss-fail / turnover. EPA
shown in the per-bar tooltip (exact for non-terminal plays via next-snap
EP delta; terminal play uses the drive-result EP). Memoized on `head`.
Validated headlessly: drive grouping, field geometry, [0,100] bounds,
tier + EPA population, clean HTML.

## UI performance pass (post Slice I)

After Slices A-I shipped, the franchise UI felt laggy. Investigated +
fixed in five commits. The lesson: the MFF additions were a minor
contributor; the dominant cause was a pre-existing CSS issue that the
new content happened to expose. Diagnostic order mattered — JS profiling
(via a paste-into-console tracer) ruled out render time FIRST (27ms,
fast), which redirected the hunt to paint/composite cost.

Fixes, in order shipped:
1. **`407fec9` — memoize `mffPostGameWPBlock` + `mffGameWPCurve`.** These
   ran on every dashboard render via `_buildPostGameHeadline`, each
   walking the full ~34k-entry playLog + rebuilding the WP-curve SVG.
   Measured cold cost 330ms → 0.002ms cached (172,773x). Cache keyed on
   (userTeamId, season, playLog length, recent-game-week).
2. **`680e5c8` — `content-visibility:auto` on `.frn-card-box`.** Defers
   paint of off-screen dashboard cards. Helped marginally.
3. **`6b66d5f` — news feed + bottom ticker.** `.frn-wire-item` gets
   content-visibility (500-item list culls off-screen paint);
   `.frn-wire-scroll` gets `contain: layout style paint`;
   `.bspnlive-ticker-inner` gets `will-change: transform` (the 60s marquee
   wasn't GPU-composited → main-thread paint every frame).
4. **`fb7efa3` — DISABLE body opacity flicker (THE FIX).** `body {
   animation: crt-flicker 6s infinite }` animated opacity on the entire
   <body>, forcing a full-viewport repaint+recomposite every animation
   frame, forever. This was the load-bearing cause of page-wide lag
   (scroll stutter, slow hover, sluggish clicks) AND the "floating
   players" in gameplay (dropped PIXI frames desync'd players from their
   shadows). Commented out; keyframes kept for a future fixed-overlay
   reimplementation. CRT look preserved via scanlines + phosphor text-shadows.

Audit also surveyed but did NOT action (not worth the risk/effort yet):
- `.crt-scanlines` uses `mix-blend-mode: multiply` over a fullscreen
  overlay — a known paint hog; candidate next fix if lag returns. Could
  swap for plain `opacity` with near-identical look.
- `showFranchiseDashboard()` is called from ~58 sites, each a full
  dashboard rebuild (~27ms). A section-level partial-render refactor
  would be the big architectural win but is multi-day + regression-risky.
- `_drawPlayerShadow` (`play-render.js:512`) allocates a fresh
  `createRadialGradient` per-player per-frame (~1300 gradients/sec at
  22 players × 60fps) — cacheable by (bulk, scale, alpha). Minor.
- 24 infinite CSS animations on small elements (individually fine); could
  gate via IntersectionObserver to pause off-screen ones.
- 121 box-shadows (not animated, one-time cost — fine).

NONE of the gameplay-rendering files (`play-player-pixi.js`,
`play-motion.js`, the player-draw paths in `play-render.js`) were
touched by the MFF work — the gameplay lag was a symptom of the body
flicker, not an MFF regression.

## Future work (not built)
- **WP-table refit (logistic / GBM smoothing).** The empirical WP bake
  isn't a calibrated probabilistic forecast — per-play WPA is correct in
  shape but multi-game aggregates carry ~±1 WPA/team of noise (documented
  in Slice C). Refitting the bake as a smoothed model would tighten the
  team-WPA-↔-wins correlation from r≈0.4-0.8 to the theoretical ~1.0.
- **CPOE pressure sensitivity (engine).** The xComp bake (Slice D) found
  pressure barely affects completion in this engine (76.7% pressured vs
  75.2% clean — opposite of NFL's ~15pt drop). An xPressure recalibration
  would make CPOE reflect pressure-handling, not just depth-selection.
  Engine change → needs its own A/B gate.
- **Safety run-support grade** — would need engine work to attribute
  run-support snaps to safeties; currently they have no defensible grade.
- **Scanlines `mix-blend-mode` perf fix** — see UI performance pass above.
- **Section-level dashboard re-render refactor** — the biggest remaining
  perf lever; deferred as high-effort / high-risk.
