# Talent Rating Architecture — the two-layer model

*Successor framing to `TALENT_MODEL.md`. The valve/stock-and-flow model there
is still correct for **career dynamics**; this doc fixes what OVR **means** and
re-points what we tune for.*

> ## ⚠ SCOPE COLLAPSE (data update — read this first)
> Stable 100-season audits **killed most of this plan.** The "28× per-position
> reachability spread" that motivated the full per-position calibration was a
> **small-sample artifact** of the 40-season audit's ~6-player rosters. At
> stable n, **every non-K/P position sits in a tight 0–2.7% band at 90+** —
> there is no spread to calibrate. The *one* replicable problem is a **K/P
> inflation bug**: their decline only chips STR (not in their OVR formula),
> AWR (42% weight) grows in-season, and kpw is uncapped — so K/P OVR ratchets
> up monotonically over an age-41 career and never falls. Result: **K hits
> 23.4% at 90+ (mean 79.6, highest of any position), kpw → 99** over 100 seasons.
>
> **So Layer 1's per-position quantile calibration is DROPPED.** The
> proportionate fix is a **source-level K/P repair** (cap kpw/awr in
> calcOverall; make K/P decline their own OVR stats) + **Layer 2
> (`POSITION_VALUE`) for cross-position consumers**, which is still right.
> The verbose calibration design below is kept as rejected-alternative
> rationale, not the plan. This is a case study in letting stable data kill an
> over-engineered architecture — the simpler fix turned out to be the more
> correct one.

Status: **✅ RESOLVED. The whole thread collapsed to a ~50-line K/P source fix.**

> ## ✅ OUTCOME (100-season confirm)
> The K/P inflation fix (`calcOverall` input clamp kpw≤90/awr≤84/tec≤88 +
> lower kpw floor + K/P decline their own OVR stats + remove the K/P
> `awrOvrWeight` nudge leak) **fully killed the bug** at the 100-season
> timescale where it was worst:
> - **K: 23.4% → 0.0% at 90+, mean 79.6 → 69.0.** **P: 8.8% → 0.0%, 76.8 → 68.2.**
> - Every position now in a uniform **0.0–3.5% band at 90+** — no outliers, no drift.
> - **HoF shares went NFL-realistic** (DL 16.9 / OL 13.4 / QB 12.4 / LB 12.4 /
>   WR 10.9 / RB 10.9 / CB 8.5 / S 7.0 / TE 4.5 / **K 2.0 / P 1.0**).
>
> **Layer 1 (per-position calibration): never built — was noise-fitting.**
> **Layer 2 (`POSITION_VALUE`): not needed as new plumbing.** Fixing K/P OVR at
> the source resolved every cross-position symptom directly (best-player,
> contracts, 90+ count), and `_hofPositionMul` (r-3) already serves as the HoF
> value weight. The conceptual two-layer model is still *true*; it just turned
> out the system only needed the one value weight it already had, plus the bug
> fixed.
>
> **Not addressed (separate, pre-existing — not rating-architecture):** HoF
> first-ballot 91% (target ~15%) and induction rate ~2/yr (target ~7-8) are
> threshold/vote-logic issues, tracked for later.
>
> **The lesson:** stable data turned a grand multi-stage architecture into a
> localized bug fix that is both smaller and more correct. The rigor paid for
> itself — building Layer 1 would have been effort spent fitting a small-sample
> artifact.

---

## TL;DR

OVR is being asked to be two incompatible things at once:

1. a **within-position rating** ("how good is this kicker *among kickers*"), and
2. a **cross-position value scale** ("how much does this player help you win").

A 90 K and a 90 QB are equal as (1) and wildly unequal as (2). Every recurring
talent symptom — "K reaches 90+ at 8.5%", "league 90+ share too high", "HoF
position bias", "kicker is somehow a franchise cornerstone" — is the same root
error: **using a within-position number for cross-position questions.**

The fix is to make the two layers explicit:

- **Layer 1 — OVR = within-position percentile.** Calibrate the weighted-sum
  output *per position* to one common shape, so `90` means "top ~2.5% of your
  position" *everywhere*.
- **Layer 2 — `POSITION_VALUE` weight.** One canonical positional-value table,
  applied at every point where players are compared *across* positions (HoF,
  "best player", contract/trade value, team strength).

---

## Three findings that ground this (all verified this session)

1. **The sim runs on stats, not OVR.** Individual matchups resolve from the
   stat vector — `tackler.stats[9]` for tackling, coverage/rush/block all
   `stats[...]` (34 `stats[]` refs vs 12 `.overall` in `play-engine.js`). OVR
   only feeds *aggregates and selection* (team-strength rollups `g`/`gw`,
   target weighting, RB committee, the OL/DL trench rating). **So reshaping OVR
   does not touch play resolution** — it's a display/roster/aggregate metric.

2. **Per-position 90+ reachability is a formula artifact, not realism.** OVR is a
   weighted average; reaching 90 needs the heavily-weighted stats to *jointly*
   hit ~90. The count of stats that must fire, weighted by reachability, sets the
   tail:

   | pos | OVR-driving stats (wt) | must fire | observed 90+ |
   |---|---|---|---|
   | K/P | kpw 43 + awr 42 | **2** (both uncapped; kpw floored ≥75) | **8.5% / 4.2%** |
   | TE  | cat 34 + blk 25 | ~2 | 6.3% |
   | LB  | tck 26 + cov 22 + prs 21 | 3 | 3.3% |
   | WR  | cat 30 + spd 26 | 2, but **spd compressed** by SPD_MAP | 2.0% |
   | QB  | **thr 42** + awr 21 | 3, thr must be ~96+ | 0.7% |
   | OL/DL | blk 38 + str 30 + agi 17 | **4** | 0.4% / 0.3% |

   Spread runs 0.3% → 8.5% (28×), driven by `calcOverall` weights ×
   `POSITION_PHYSICAL_CAPS` × the `statsFor` polarization pass (which over-spikes
   2-stat positions → the K **bimodality**: P10=42 floor *and* 8.5% at 90+).
   None of this is "realism" — it's geometry. Fighting it stat-by-stat is
   whack-a-mole.

3. **Cross-position OVR consumers are display/HoF/contract — and several already
   want a value layer.** Trace of `.overall` reads:
   - sim matchups → `stats[]` (untouched by calibration)
   - within-position sorts (depth chart, same-pos FA/contract compare) → **safe**
   - team aggregates (`gw`, trench) → shift **symmetrically** (both sides
     recalibrated), balance holds; and `g("QB")*0.30 + gw("OL")*0.20…` is
     *already* a crude value layer
   - HoF/awards → already patched by `_hofPositionMul` (the camel's nose)
   - "team's best player" / opponent star / injury headline / contract-year
     thresholds (`overall ≥ 88 → 5yr`) → these **break under a within-position
     OVR unless routed through `POSITION_VALUE`**

---

## The architecture

### Layer 1 — OVR as within-position percentile
**`player.overall` must stay RAW** — do NOT wrap `calcOverall` globally. Career
dynamics are calibrated to raw OVR in raw-OVR space: the hidden-gem `ceiling`
and `potential` are raw-OVR numbers, the breakout jumps to `ceiling × 0.82–0.87`
and develops stats until `calcOverall` (raw) reaches it, and the bust cap is
`potential × peakMult` (raw) — all in `_rerollPotentialForBreakouts`
(`play-franchise-stats.js:8982–9019`). Recalibrating `calcOverall` would shift
every one of those thresholds → a career-dynamics feedback loop. Verified, not
hypothesized.

So Layer 1 is a **derived rating**, not a replacement:

```
rawWeightedSum            → player.overall   (UNCHANGED — internal dynamics only)
CALIBRATE[pos](overall)  → player.ovrPct     (NEW — within-position percentile, consumers)
```

`CALIBRATE[pos]` is a per-position monotone map pinning each position's raw OVR
distribution to ONE common target shape. A **piecewise-quantile** map (knot LUT
from the S1 audit dump `CALIB_LUT_JSON`) handles the bimodal K/P that an affine
can't. Params are CONSTANTS fit offline (like the physical caps), re-fit only
when generation/dev changes — never per play. `ovrPct` is stamped wherever
`overall` is recomputed.

**This also shrinks the migration surface:** internal dynamics (dev, decline,
peak, breakout, ceiling, in-sim selection) keep reading `overall` untouched;
only the *cross-position consumers* below switch to `ovrPct` (× `POSITION_VALUE`
where it's a value question).

**Common target shape (every position identical — that's the point):**

| metric | target |
|---|---|
| mean | ~74 |
| P10 / P50 / P90 | ~64 / ~74 / ~84 |
| 90+ | ~2.5% |
| 95+ | ~0.5% |
| floor (rostered) | ~55 (depth below) |

Result: `90` is the same rarity at every position, `league 90+ share ≈ 2.5%`
*by construction*, and the per-position reachability problem **dissolves** — no
weight/cap/dev surgery needed to equalize tails.

### Layer 2 — `POSITION_VALUE`
One canonical table (generalize `_hofPositionMul`), consumed everywhere players
are ranked across positions:

```
POSITION_VALUE = { QB: 1.0, … , LB: ~0.5, OL: ~0.6, … , K: ~0.15, P: ~0.12 }
effectiveValue(player) = ovrPercentileScore(player) × POSITION_VALUE[pos]
```

Consumers: HoF induction, MVP/All-Pro, "franchise's best player" displays,
contract/trade value, AI roster-need, and (folding in the ad-hoc weights) the
`g`/`gw` team-strength formula. **`_hofPositionMul` becomes a view of this table,
not a separate magic number.**

### The atomic-shipping constraint
Layer 1 alone makes "who's your best player / how much do we pay him" ill-posed
(a calibrated-elite kicker would outrank an 88 QB). **Layer 1 and Layer 2 must
ship together** — calibration without the value lens produces "our All-Pro
kicker is the franchise cornerstone" headlines. They are one atomic change.

---

## Re-pointed north star

"90+ ≈ 2-3%, mean 74-76" is **calibration**, not realism — under Layer 1 it's a
dial you *set*, not a target you *chase*. The honest epilogue on the prior
retune: **r-1 (steepen decline) flattening the drift was the real, irreplaceable
win** (a league that inflates decade-over-decade is genuinely broken — only
flow-balancing fixes that). **r-2…r-8 grinding 90+ from 6.8%→5.7% was partly
chasing a labeling artifact** a per-position normalization just assigns; the
"floor that wouldn't budge" was the formula geometry refusing a cross-position
target it was never built to hit.

What's *actually* realism (and what flow-tuning should target):

1. **Drift flat** (no inflation) — ✅ won at r-1.
2. **Career arcs** — rookie → peak → decline shapes — dev/decline/wear valves.
3. **Draft uncertainty** — bust/gem rates, the scouting-error tail — valve 2.
4. **Value scarcity** — elite *value* is rare, elite *kickers* are cheap —
   Layer 2, not OVR.
5. **Competitive balance** — parity vs dynasties — barely measured yet.

`90+ league share` is no longer on the list. It dissolved into "pick the
percentile."

---

## Staged build plan (each audit-verified; nothing ships until the pair is ready)

- **S1 — Measure.** Audit dumps the RAW per-position OVR distribution
  (`_brady_audit` already has the histogram; add raw-vs-calibrated columns).
  Establishes the `CALIBRATE[pos]` fit targets.
- **S2 — Fit Layer 1.** Derive `CALIBRATE[pos]` (piecewise-quantile from the S1
  LUT). Stamp `player.ovrPct` wherever `overall` is recomputed. `overall` is
  UNTOUCHED, so sim + career dynamics are byte-unchanged by construction; verify
  the `ovrPct` distribution per position matches the common target shape.
- **S3 — Build Layer 2.** Canonical `POSITION_VALUE`; reroute HoF (replace
  `_hofPositionMul`), "best player"/awards displays, contract/trade value, and
  the `g`/`gw` weights through it.
- **S4 — Flip together.** Enable Layer 1 + Layer 2 atomically. Audit: HoF shares
  (should need little/no extra correction now), team-strength balance unchanged,
  no "kicker is best player" regressions.
- **S5 — Re-point tuning.** Retire 90+-share chasing; keep flow valves aimed at
  drift/career/bust realism. Add a competitive-balance audit (parity/dynasty).

---

## Risks / open questions

- **Calibration fit drift.** If generation/dev changes, `CALIBRATE[pos]` must be
  re-fit — a periodic audit job, not per-play. Acceptable (physical caps already
  work this way).
- **Quantile vs affine for K/P.** Bimodal K likely needs a quantile LUT; confirm
  affine suffices for the rest.
- **Team-strength re-fit.** Folding the value weights into `g`/`gw` while
  calibrating OVR must keep current competitive balance — verify with the
  margin/parity audit before/after.
- **`POSITION_VALUE` numbers.** Start from `_hofPositionMul`'s implied ordering;
  validate against roster-construction sanity (does the AI still value a QB over
  a kicker correctly?).

---

## Relationship to `TALENT_MODEL.md`

- **Kept:** the stock-and-flow framework, the six valves, the retune log (real
  history), and the career-realism targets (drift/arc/bust).
- **Superseded:** "tune the flows until 90+ share = 2-3%" and "Valve 6 =
  per-position reachability surgery." Those are replaced by Layer 1 calibration
  (sets the share) + Layer 2 value (handles cross-position) — a cleaner home for
  the same intent.
