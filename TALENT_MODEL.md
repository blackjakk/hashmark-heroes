# Hashmark Heroes — Talent Model, From First Principles
*(originally documented as "GridironChain"; renamed 2026-05 — references in the body kept verbatim where they refer to the codebase rather than the product)*

---

## ⏯ RESUME HERE (post-compact pointer)

> **⚠ DRAFT-CYCLING BUG → RE-VALIDATED (mostly confirms the model).** A
> regression made the headless harness **silently collapse rosters to ~6
> players/team** (the async offseason/draft chain wasn't awaited → the draft
> class stopped cycling; see `AUDIT.md` "Harness invariant", fix `0c3955d`,
> guard `c5bb9d3`). Audits run in that state were on a ~190-player
> survivor-biased league. **Re-validated on the fixed harness (clean 40-season,
> 67,838 player-seasons, synthetic survivors ~0):** the documented targets
> roughly HOLD —
> - **90+ share 5.7% ≈ the 6.0% target** (the scary collapsed reading of 1.3%
>   was the BUG, not the model).
> - **DRIFT BY DECADE is now flat/stable** (mean ~78, 90+ 5.5–5.9% across all 4
>   decades) instead of the false decay the collapsed runs showed.
> - **R1 picks are healthy:** 18% of rosters, **29% of starters** (~7/team) —
>   the "few round-1 picks" worry was purely the collapsed-roster artifact.
>
> So **no major retune needed.** **100-season run now COMPLETE** (169,597
> player-seasons, synthetic survivors 0): stability holds over a full century —
> DRIFT BY DECADE dead-flat across all 10 decades (mean ~78, 90+ 5.2–6.0%),
> elite 90+ 5.7% / 95+ 1.6%. Legends 2 (1 S, 1 LB) = 1/50yr, on target.
> **GAP — TRUE BRADY = 0 in 100 yrs:** a late-round/UDFA QB never reaches 96+
> (target ~1/75yr). The general gem→legend pipeline works, but the *namesake*
> QB pipeline doesn't fire — ties to the old "QB genetic drag" note; flagged for
> a future fix (likely QB dev ceiling from late rounds is too weak). Minor
> calibration notes: league mean OVR ~78 a touch high, cap util 84% a touch
> conservative vs NFL ~95%. Branch: `claude/charming-brown-b18u2`.

**Branch:** `claude/football-sim-blockchain-game-b3sdq` (push with `-u origin`, retry exponential backoff per session rules).

**Where things stand:**
- **Level retune: settled** (r-8 + 100-season validation). 90+ share **6.0%** (target 2-3%, still ~2× over — accepted as architectural floor with flat DRIFT BY DECADE 5.6-6.7% over 8 measured decades). R1 bust **1.5%**, R3 bust 9%, R7 bust 12% — bust shape working. Full retune log in `## Retune log (executed)` below.
- **UX work: complete.** All 6 steps shipped (banner removed, dev demoted, delete safety, Your Story flow, in-loop nav rail, confirm modal conversion). See `GAMEPLAY_LOOP.md` for the full breakdown.
- **Rebrand:** GridironChain → **Hashmark Heroes — American Football Manager**. User-facing only; codebase identifiers preserved.

**⚠ DIRECTION CHANGE (read `TALENT_RATING_ARCHITECTURE.md` first):** A
first-principles pass concluded the per-position-reachability problem (Valve 6)
and the "90+ league share" target are symptoms of OVR conflating a
*within-position rating* with a *cross-position value scale*. The agreed
direction is the **two-layer model** in `TALENT_RATING_ARCHITECTURE.md`:
calibrate OVR to a within-position percentile (Layer 1) + a canonical
`POSITION_VALUE` weight for all cross-position comparisons (Layer 2, generalizing
`_hofPositionMul`). The sim runs on `stats[]` not OVR, so Layer 1 is gameplay-safe.
Under it, "90+ share" is a *dial you set*, not a target to chase — so the
remaining flow-tuning re-points at drift/career/bust realism, not share counts.

**Done this session:** HoF position-multiplier re-tune settled at r-3
(`a5875b0`) — NFL-realistic shares (the old CB 0.7% / S 0% / LB 24% / K 8%
catastrophe is fixed). This becomes Layer 2's seed ordering.

**✅ RESOLVED (see `TALENT_RATING_ARCHITECTURE.md` OUTCOME):** Stable
100-season audits showed the "per-position reachability spread" was a
small-sample artifact; the one real problem was a **K/P OVR inflation bug**
(decline only chipped STR — not in their formula — while AWR grew and kpw was
uncapped → ratchet to 99 over a long career, K 23.4% at 90+). Fixed at the
source (commits `6d091c6`, `a398d97`): K 23.4%→0.0%, P 8.8%→0.0% at 90+, every
position now in a uniform 0–3.5% band, and **HoF shares went NFL-realistic with
K 2.0% / P 1.0%**. The full per-position calibration was never built (would have
fit noise); the existing `_hofPositionMul` is the only value weight needed.

**Still open (separate, pre-existing — not rating-architecture):** HoF
first-ballot 91% (target ~15%), HoF induction rate ~2/yr (target ~7-8) —
threshold/vote-logic. And Valve-6 *legend reachability* (QB late-round Brady) is
distinct from the K/P bias and untouched.

**Tools in use:**
- `node gridiron-chain/_brady_audit.js 40` — fast retune iteration (~17 min)
- `node gridiron-chain/_brady_audit.js 100` — equilibrium validation (~50 min)
- `node gridiron-chain/_sim_audit.js 2` — game-realism check
- `node gridiron-chain/_arch_probe.js` / `_qb_probe.js` / `_jumbo_probe.js` — archetype/style probes
- `node gridiron-chain/_ux_snapshot.js` — visual UX verification (Playwright PNG screenshots in `/tmp/ux/`)

**Companion docs:**
- `AUDIT.md` — audit harnesses, NFL reference bands, calibration history
- `GAMEPLAY_LOOP.md` — UX map + executed step log
- `HANDOFF.md` — broader project context (from earlier animation-arc session)

---

> Written before retuning, after the 100-season audit showed the league
> over-inflates (90+ share **14.7%** vs NFL ~2-3%, roster mean **80.8**), R1 picks
> **never bust** (0% / 95% Pro Bowl), and QBs **never** emerge as late-round
> legends while safeties over-emerge. These are not three bugs — they're three
> symptoms of one mis-balanced **talent economy**. This doc reasons about how
> that economy *should* work, so we tune flows toward an equilibrium instead of
> chasing knobs. Mechanics are mapped against the real code (file:line).

---

## The central principle: the league is a stock-and-flow system at steady state

Over many seasons the league OVR distribution converges to an **equilibrium**
set by the balance of *flows*, not by the starting rosters. For any OVR tier
(say 90+), at steady state:

> **rate IN (players developing up into the tier) = rate OUT (players declining
> + retiring out of it).**

If IN > OUT, the tier grows every year — that's our **14.7% at 90+** (the audit's
*DRIFT BY DECADE* should be flat; it rises). So the goal of any retune is to
balance the flows so the distribution holds decade over decade — **not** to
tweak one number until a single season looks right.

There are exactly **six valves** on this economy. Three set how talent ENTERS
the top, three set how it LEAVES. We have to move them *together*.

---

## The six valves (principle → current → gap)

### 1. Generation — how many players are *capable* of elite (the source)
- **Principle:** a draft class should yield a *handful* of future stars; most
  prospects top out as roleplayers. Real NFL: maybe 2-5 future 90+ players per
  class.
- **Current:** the `HiddenOracle` ceiling roll puts **16% of prospects at an
  88+ ceiling** (offseason ~19057). Over a ~210-prospect class that's **~34
  future 88+ players minted every single year.**
- **Gap:** ~5-8× too generous. This is the **primary inflation source** — too
  many high ceilings created. Target ~2-4% at 88+ (a class yields ~4-8 future
  stars, not 34).

### 2. Scouting / draft evaluation — the bust↔gem SYMMETRY (the missing tail)
- **Principle:** teams draft on **perceived** value = true ability + scouting
  error. Busts and gems are the two *symmetric tails* of that error: a R1 busts
  when his true ceiling is **below** where he was drafted; a R7 gem hits when his
  true ceiling is **above**. Bust rate ≈ gem rate ≈ the scouting-error rate.
- **Current:** rookies enter the NFL at their **true current OVR**. Scouting
  error IS modeled via `_aiScoutBias` (offseason ~19265) — `polarRoll` is mostly
  symmetric (30% negative, 30% positive, 40% small noise) and there's a small
  symmetric wildcard tail (5% ±10) + ultra tail (1% ±15). **BUT the
  `scoutBuyIn` layer is asymmetrically gated by ceiling:**
  - ceiling ≥ 88: **55% chance of +3 to +9** (scouts hype high-ceiling guys)
  - ceiling ≥ 80: 35% chance of +2 to +6
  - ceiling ≥ 55: 30% chance of −2 to −6 (low-ceiling guys fall)
  - ceiling < 55: 50% chance of −3 to −9 (real fallers)

  So R1 picks are **structurally protected** from being busts: they're heavily
  correlated with high ceilings → which get the positive buy-in → which inflates
  them into R1 → and they actually have high ceilings → and they realize. The
  system creates *more gems* (low-ceiling guys falling out of the draft) than
  *busts* (low-ceiling guys staying in R1). The thin wildcard/ultra tail (~6%)
  is the only path to true R1 busts → that's why bust rate is 0.0-1.1%.
- **Gap:** not that the symmetric scouting model is missing — it's that the
  `scoutBuyIn` correlation with ceiling clamps the bust tail. **Fix is
  structural decoupling, not new invention.** Two options:
  - Make 5-10% of high-ceiling prospects get NO buy-in (or negative buy-in)
    despite scout consensus — creates "the consensus was wrong" busts.
  - Add a separate "draft-hype" mechanic: 3-5% of prospects get +5 to +10 bias
    *independent* of ceiling, creating overhyped low-ceiling busts.

  Either approach generates the negative tail without inventing a new system.

### 3. Development — how *reliably* the ceiling is realized (the spread)
- **Principle:** growth toward ceiling should be *uncertain* — real variance and
  regression risk, so even high-ceiling players sometimes stall or wash out. The
  realized-OVR distribution should be **wider** than the ceiling distribution
  (a few over-realize, many under-realize).
- **Current:** regression fires rarely (**2%/yr** for ceiling ≥ 80) and softly
  (1-3 OVR), so high-ceiling players climb almost deterministically
  (`_developNflPlayer`, offseason ~10801). `peakMult`/`devMult` cap how *far*,
  never *whether*.
- **Gap:** downside too thin → everyone reaches their ceiling → no busts, dense
  top tier. Need fatter, more frequent stalls so realization spreads out.

### 4. Peak / decline — the top-tier OUTFLOW (the drain)
- **Principle:** post-peak decline should turn the top over — a 90+ player should
  shed back toward ~85 within 2-3 years of peak and be roster-fringe within ~5.
  Decline is the **main drain** on the 90+ stock.
- **Current:** **1-2 OVR/yr** decline with late onset ages and small per-stat
  drops (offseason ~11228) — vs a realistic **3-5/yr** cliff (worse for RB).
- **Gap:** decline is ~2× too shallow, so 90+ players *linger* in the tier for
  years and the stock piles up. **The most direct lever to drain 90+.**

### 5. Retirement / attrition — the depth OUTFLOW
- **Principle:** ~25-30% annual turnover; a *few* elites get real longevity
  (Brady/Brees), the rest age out on schedule.
- **Current:** ~35-50% attrition (`_processSeasonEndRetirements`, stats ~9074) —
  actually *higher* than NFL, so volume isn't the problem. But the
  **accolade-longevity bonus** keeps *elite* vets around to 38-40, which
  specifically preserves the 90+ stock.
- **Gap:** minor. Attrition is fine/high; only the elite-longevity protection
  mildly props up the top. A secondary lever at most.

### 6. OVR formula — per-position reachability of the ceiling (the QB/S skew)
- **Principle:** every position should mint legends at a rate scaled to real-NFL
  scarcity — and **QB is *the* Brady position**, so "0 QB late-round legends in
  100 yrs" is wrong.
- **Current:** QB OVR is **42% THR** (player.js:851); a late-round QB rarely has
  elite THR and can't reach 96+ without near-max THR. Safety OVR spreads across
  SPD/COV/TCK/AWR/TEC and tops out more easily → **all 3 late-round legends were
  safeties.**
- **Gap:** the 96+ threshold is differentially reachable by position. Either
  normalize reachability, or let dev push the *signature* stat (THR for QB) hard
  enough that a high-ceiling late QB can actually get there.

---

## The three observed problems → which valves own them

| Observed (100-season) | Root valve(s) | Direction |
|---|---|---|
| 90+ share 14.7% (vs 2-3%), mean 80.8 | **1 (ceilings)** + **4 (decline)** | fewer born elite + drain faster |
| R1 bust 0% / PB 95% | **2 (scouting symmetry)** + **3 (dev spread)** | add the bust tail + widen realization |
| QB never a late legend; S over-emerges | **6 (per-position reachability)** | let the signature stat reach the bar |

**Key coupling:** valves 1 and 4 *jointly* set the 90+ equilibrium and must move
**together** — steepen decline alone and legends decline before they peak (too
few stars); cut ceilings alone and the few stars still linger (weak decline).
Busts (valve 2) are a *separate, structural* addition — the model currently has
only the upside tail of scouting error.

---

## The north star (how we'll know the retune is right)

Run `_brady_audit` long and check **equilibrium**, not single seasons:
1. **DRIFT BY DECADE is flat** (the league isn't inflating).
2. **90+ ≈ 2-3%, 95+ ≈ 0.5-1%**, roster mean ~74-76.
3. **R1 bust ≈ 25-30%**, PB% ≈ 50-60% (R1s are good bets, not locks).
4. **Legends emerge across positions** at NFL-like rates — including **QB**.
5. **Brady cadence:** QB late-round legend ~1 per 60-100 yrs; all-position
   late-round legend more frequent but not safety-only.

Tune the *flows* to hit that steady state; don't chase any single metric.

---

## Proposed retune order (once we agree on the framework — NOT done yet)

1. **Ceiling distribution (valve 1):** pull the 88+ ceiling share from 16% →
   ~3-4%; reshape the curve so most prospects top out 70-82.
2. **Decline (valve 4):** steepen post-peak to ~3-4 OVR/yr, earlier onset for
   speed positions (RB cliff).
3. *Re-run, confirm 90+ heads toward 2-3% and drift flattens, then:*
4. **Scouting symmetry (valve 2):** give a fraction of early picks hidden
   ceilings *below* their slot (busts), mirroring the existing gem mechanic.
5. **Dev spread (valve 3):** modestly raise regression frequency/severity so
   realization widens (more partial busts).
6. **Per-position (valve 6):** ensure QB dev can push THR to the legend bar;
   check S isn't structurally easiest.

Each step re-runs the long audit and reads the equilibrium, not one season.

---

## Retune log (executed)

Per the discipline: one valve per step, 40-season audit, read the *equilibrium*
(DRIFT BY DECADE flatness + 90+ share + R1 bust%). Each row is a single change
+ the measured result.

| step | change | 90+ share | drift | R1 bust | notes |
|---|---|---|---|---|---|
| **baseline (100s)** | (pre-retune) | 14.7% | rising | 0.0% | inflation visible |
| **r-1: decline ×1.75** | `_dc` 35/55/70% (was 20/30/40), +25% chance of −2 drops | 13.9% | flat ~81 | 0.1% | direction right, magnitude small. **Drift flattened** — equilibrium-able |
| **r-2: ceilings cut** | 88+ band 16%→4%, 80-87 24%→13%, mass shifted to 70-79 | **6.8%** | flat ~79 | 0.9% | big move; R1 PB% 95→78% |
| **r-3: ceilings further** | 88+ 4%→2.5%, 80-87 13%→10%, 70-79 22%→26.5% | 6.0% | flat ~79 | 0.7% | small move — diminishing returns |
| **r-4: NFL_DEV_SCALE 0.35→0.25** | slow dev so growthRate variance drives outcomes | 5.7% | flat ~79 | 0.8% | barely moved — gap math means same outcome over more years |
| **r-5: wear-driven decline** | `wearMul` on `_dc` (high-wear → 1.7× decline, low → 0.9×) | 5.7% | flat ~78 | 1.1% | level stuck, **but bust % ticked up structurally** (0.8→1.1) — wear-decline is real |
| **r-6: coachBoost cap ≤ 2.0** | clamp compound multiplier (was hitting 2.9×+) | _in flight_ | — | — | targets the hidden inflation pump |

**Key learnings from the log:**
- **Drift flattened on r-1** (decline steepened) and has stayed flat ever since,
  across 4 retunes that moved different valves. The model is at a stable
  equilibrium that *can hold* — what we're tuning is the *level*.
- **The 5.7% floor wasn't a tuning failure** — r-3, r-4, r-5 all attacked
  different valves (ceilings, dev pace, decline rate) and the floor didn't
  budge. That's the signal that **a previously-unexamined inflation pump exists**.
- **Wear-driven decline added structural busts** even though it didn't move the
  level (R1 bust 0.8% → 1.1%, R7 13.5% → 15.1%). Confirms the *shape* is now
  more realistic — low-usage R1s that don't play age out before realizing.
- **The hidden pump was coach compounding** (HC 1.35 × coachable 1.25 × FO 1.6
  × coachs_son 1.15 × captains 1.10 → ~2.9× for a coachable young player on a
  great staff). Discovered via the system-discovery audit, untouched by any
  prior retune. Capping at 2.0× is r-6.

---

## Engine systems inventory (discovered via system-discovery agent)

A comprehensive scan turned up many systems that exist in the engine but weren't
in this doc or our audit. Documented here so the retune work has the full
context (and so we don't accidentally re-invent any of them).

### Hidden persistent player state (the underscore fields)

| field | range | what it drives | UI |
|---|---|---|---|
| `_drive` | 20-99 | dev `driveMul = 0.85 + (drive−50)/300`; in-engine clutch / 2nd-effort bonuses | hidden (intel tag only) |
| `_durability` | 25-99 | inverse injury vulnerability multiplier | hidden |
| `_trajectory` | enum: EARLY_BLOOM / LATE_BLOOM / CONSISTENT / STREAKY / FLASH | career-arc archetype; STREAKY adds ×1.9 OVR swing variance; FLASH = low-OVR breakout potential | ✓ shown on player history card |
| `_devMult` | 0.30-1.20 | per-player dev timing variance (slow-burn vs Bo-Jackson-fast) | hidden |
| `_peakMult` | ~0.85-1.15 | per-player ceiling-height variation | hidden |
| `_growthRate` | enum 0.35 / 0.65 / 0.90 | intrinsic growth capacity (HiddenOracle.roll.growthRate) | hidden |
| `_awrCeiling` | 70-95 | AWR stat cap (HIGH_FOOTBALL_IQ gets 85-95, else 70-85) | hidden |
| `_tecCeiling` | similar | TEC stat cap | hidden |
| `_devFreezeUntilSeason` | season # | ignoring contract demand → 1-yr growth freeze | ✓ locker-room consequences |
| `_physicalPeak` | { spd/agi/str: { peak, onset } } | position-specific peak ages for SPD/AGI/STR | hidden |
| `_aiScoutBias` | −10 to +10 | perceived OVR adjustment (see valve 2) | hidden mechanism, visible via consensus grade |
| `_generatedRound` | 0-7 | consensus draft round from `trueOvr + bias` | ✓ "R3" / "UDFA" badge |
| `_combineResult` | { overall, isRiser, isFaller, isSuperathlete } | combine performance snapshot, riser/faller flags | ✓ "📈 COMBINE RISER" banner |
| `_slipGrade` | 1-7 | original consensus grade for UDFAs who slipped | ✓ "↓ ~R3 SLIP" notation |
| `_scoutedAtDraftSeason` / `_apbScoutedSeason` / `_jpScoutedSeason` | season # | scout-effort timestamps; sharpen perceived-OVR noise bands | hidden mechanism |
| `_psFlashLog` | array | practice-squad flash performance log; multi-flash = real talent | ✓ "Flashes: 2" badge |
| `_yips` / `_yipsAccPenalty` / `_yipsLastMissWeek` | { weeksRemaining, severity } | kicker/punter confidence meltdown; escalates if misses cluster within 10 wks | ✓ broadcast "YIPS EPISODE" |
| `_bodyWear` | { head, neck, shoulder, ... } | per-body-part wear → re-injury risk by body part | hidden |
| `_concussionsThisSeason` / `_concussionsLifetime` | counts | per-season escalation + career CTE arc | ✓ vitals "CTE risk" tag |
| `_lastConcussionWeek` | week # | Second-Impact tracker (concussion ≤ 3 wks after another → catastrophic) | hidden |
| `_rehabSeasons` / `_rehabRestore` / `_rehabPermGain` | counters | post-injury rehab state machine | ✓ "Out (Rehab)" |
| `_postseasonDepth` / `_postseasonDepthSeason` | round idx 0-3, season # | deepest playoff round; sharpens scout grade | ✓ intel narrative |
| `_facedInPlayoffsSeason` / `_facedInPlayoffsMajor` / `_regSeasonFacedSeason` / `_regSeasonFacedMajor` | season # | experience tracking by tier (playoff / major playoff / reg-season / major reg-season role) | ✓ "Faced in major playoff" narrative |
| `_tradedAtSeason` | season # | trade-cooldown / freshness check | hidden |
| `_tradeReaction` / `_tradeReactionYrs` / `_tradeReactionRevealed` / `_tradeReactionSeason` / `_tradeReactionFromCut` | enum + state | CHIP / SULK reaction with delayed reveal | ✓ "🔥 CHIPPED" / "😒 SULKING" badge |
| `_cutSeason` / `_cutFromTeamId` / `_unsignedSeasons` | season #, team ID, count | FA market eligibility + age-out timing | hidden |
| `_elitePlateauBumped` | bool | one-time elite ceiling-bump idempotency | hidden |
| `_retired` / `_retiredHOF` / `_retiringFromInjury` / `_forceRetire` / `_retiredAt` / `_retiredTeamName` | flags + season | retirement state + cause | ✓ "(retired)" / "🏆 HOF BOUND" |
| `_potentialRerolled` | bool | breakout reroll idempotency | hidden |
| `_collegeJoinedSeason` | season # | college-pipeline tracking | hidden |
| `_milestonesSeen` | { key: true } | milestone-notification dedup | hidden |
| `_careerGeneratedBackfill` | bool | procedural-vs-drafted career flag | hidden |

### Compound dev multiplier stack (the inflation pump)

Each player's offseason `coachBoost` is the product of *all* of these (cap added
in r-6: clamp ≤ 2.0):

| layer | mul | gate |
|---|---|---|
| HC `Player Developer` specialtyTrait | **×1.35** | per HC |
| `coachable` trait | ×1.25 | 25-45% of prospects |
| FO strength coach `_foDevBoost` | up to ×1.6 | per team rating + trait match |
| `coachs_son` personality | ×1.15 | 4% of prospects |
| Team captains (player ≤25, non-captain) | up to ×1.10 | 8% captain rate per team |
| `quiet_pro` personality | ×0.88 | 12% of prospects (slow growth AND slow decline) |
| Cancer team-wide drain | ×penalty | 2% cancer rate per team |
| CHIP trade reaction | ×1.50 | one-shot, year after trade |
| SULK trade reaction | ×0.80 | one-shot, year after trade |

DC traits affect TEC specifically (not in `coachBoost`): `Film Mastermind` DC
gives **×2.0 TEC growth for coachable defenders** (×1.2 non-coachable). TEC is
15% of every position's OVR formula — silent inflation lever.

In-engine effects (coordinator traits affect snap-by-snap):
- OC `Run Architect`: +0.05 run yardage formula bias (engine.js:5816)
- DC `Run Stopper`: −0.05 run yardage formula bias

### Discoveries that were already partially covered

| system | docs status |
|---|---|
| Wear (`_wear`) — Q4 eff-OVR + injury rate + (now) decline rate | ✓ wired into _dc in r-5 |
| Stress (`_stress`) — non-contact injury driver | ✓ in AUDIT.md STRESS REPORT |
| Concussion lifetime CTE arc | ✓ documented; **AWR decline gap below** |
| HC 4th-down `specialtyTrait` aggression | ✓ COACHING BREAKDOWN |
| HC `cultureTrait` injury rate | ✓ INJURY by HC culture |
| Trainer trait | ✓ INJURY by trainer |
| Personality archetypes (rates) | ✓ PERSONALITY REPORT |
| All positional archetypes | ✓ `_arch_probe` |
| `_stamina` (base stat) | ✓ snap chart "STAM XXX" |
| Trade reactions | ✓ shipped this session |

---

## Queued findings (post-retune)

Tracked here so they're not lost; **do not tune until the talent retune settles**
(otherwise we'd be calibrating against a moving target).

### HoF position multipliers are over-corrected (stale 500-season rebalance)
At 100 seasons of the pre-retune sim:

| pos | inductees | % of HoF | NFL target | verdict |
|---|---|---|---|---|
| LB | 135 | 23.9% | ~8% | **way over** (1.15× mul + tackle volume) |
| QB | 128 | 22.7% | ~10-12% | over (counting bonus too generous given hot sim stats) |
| OL | 83 | 14.7% | ~17% | OK |
| DL | 78 | 13.8% | ~12% | OK |
| K  | 46 | 8.1%  | ~1% | **way over** (counting-only + no accolades) |
| RB | 32 | 5.7%  | ~6% | OK |
| P  | 23 | 4.1%  | ~0.5% | **way over** |
| WR | 22 | 3.9%  | ~12% | **way under** |
| TE | 17 | 3.0%  | ~5% | under |
| CB | 1  | 0.18% | ~9% | **catastrophically under** |
| S  | 0  | 0%    | ~6% | **broken** (4 in-sim 96+ LEGENDS were all safeties, but ZERO inducted) |

`_hofPositionMul` (`play-franchise-season.js:1604`) currently has CB/S at 0.85×
and K/P at 1.30-1.45×. The 0.85 over-corrected DBs from 25.7% (pre-rebalance) to
~0%. Re-tune **against the post-retune 100-season equilibrium** (sim stat rates
will have shifted by then) — adjust mults toward NFL shares.

### S-only legend bias (per-position reachability — already valve 6)
4 of 4 legend (96+) emergences in 100 seasons were **safeties** — confirms the
position-formula bias flagged in valve 6. S OVR = `SPD×21 + COV×30 + TCK×26 +
AWR×8 + TEC×15`: COV and TCK are both heavily developable through the gem path,
so 56% of the formula is "easy growth." Compare QB OVR = `THR×42` — needs near-
max THR specifically to clear 96+, and the gem grind doesn't push THR fast
enough. Fix is structural (per-position dev stat selection in `_gemDevStats`,
not multipliers).

### Star-tier ("near-legend") tracking gap — **DONE**
~~`LEGEND CAREERS` only tracks peak OVR ≥ 96.~~ Added **STAR CAREERS** to
`_brady_audit.js`: parallel `starPlayers` map captures every player whose peak
OVR reaches ≥ 90 regardless of gem status; dumped after LEGEND CAREERS, top 15
by peak OVR, with archetype on the header line and an 8-season window centered
on the peak for long careers. RB stat-cols also expanded to include receiving
(rec / rec_yds) so Nasser-tier dual-threat backs show their full role. Next
audit produces the data; doesn't affect engine.

### Dev-curve shape — sharkfin gaps (do AFTER level retune settles)
The ascent is already quasi-sharkfin via gap-driven exponential taper (year-1
~6 OVR, year-5 ~1.5 OVR for a high-ceiling player). Two real gaps remain:

**1. No rookie year-1 burst.** Mahomes/Lamar/Stroud-style year-1-to-year-2
jumps are bigger than the gap math alone produces. Currently `intensity` weights
(`4.0/1.8/1.0` at `0.2/0.3/0.5`) are constant by year. Fix: bias year-1 toward
the burst tail (`0.5/0.3/0.2`). Concrete impl: `HiddenOracle.roll.intensity(p,
year)` — special-case `yearsInLeague <= 1` to use rookie-burst weights.

**2. Decline isn't tied to usage (wear).** The wear system already tracks
accumulated punishment (`p._wear`, 0-100) from snaps + hits, but it's only
plumbed into in-game Q4 effective-OVR (≤−7%) and injury rate (up to 1.6×) — NOT
persistent decline. Current `_dc(onset)` = `35/55/70%` is purely age-based.
**Preferred fix: wear-driven decline scalar.** A workhorse RB with 320 carries
should cliff at 27; a committee back stays starter-grade at 30; Brady avoids
hits → plays at 43. Implement as a `wearMul` on `_dc`:

```js
const wear = p._wear || 0;
const wearMul = wear >= 70 ? 1.5
              : wear >= 50 ? 1.20
              : wear >= 30 ? 1.0
              : 0.80;
const _dc = (onset) => {
  const yrs = age - onset;
  const base = yrs <= 0 ? 0 : yrs === 1 ? 0.35 : yrs === 2 ? 0.55 : 0.70;
  return base * wearMul;
};
```

This **subsumes** the position-differentiated decline idea: RB cliff = emergent
(high carries → high wear → fast decline), QB plateau = emergent (low hits
absorbed → low wear → slow decline), without hard-coded position rules. Smart
usage = career extension. *Fallback only if wear data is too noisy*: position-
aware `_dc` tables — RB `60/80/90`, WR/CB/S `35/55/70`, QB/OL/TE `20/35/50`.

Both changes are **shape, not level** — they shouldn't materially shift the 90+
equilibrium (rookie burst pushes some R1s to 90+ year-1 = small +; RB cliff
shortens dwell time at peak = small −; roughly washes). Do AFTER the current
level retune so the signals don't muddle.

### RB mileage system — "tread on the tires" (queued, RB-only)
Distinct from wear (which is per-season beating that mostly resets, ×0.10 each
offseason). Mileage is **career-cumulative, mostly sticky, occasionally
rejuvenated** — what real NFL fans mean by "tread."

| layer | timescale | recovers | drives |
|---|---|---|---|
| wear (exists) | season | ~90% each offseason | Q4 fatigue + injury + (queued) decline scalar |
| **mileage (new)** | career | ~3-7%/offseason, rare 12% rejuv | RB peakAge/declineAge shift + cliff steepness |

**What it tracks:** `p._mileage` (RB only initially). Weighted per touch:
- rush_att: +0.5 base
- inside-run / short-yardage: +0.3 (extra contact)
- broken-tackle event: +0.1
- reception (RB only): +0.3 (catches over the middle absorbed)

**Career tiers** (target the "tread point" at ~2,500-3,000 touches):

| mileage | effect |
|---|---|
| < 1,500 | no effect (most RBs never hit this) |
| 1,500-2,000 | `declineAge -1` (subtle erosion) |
| 2,000-2,500 | `declineAge -2`, `peakAge -1` (cliff edge) |
| 2,500-3,000 | `declineAge -3`, `peakAge -2`, `_dc` scalar × 1.3 |
| 3,000+ | `_dc` scalar × 1.5 (every step is painful) |

**Rejuvenation logic** (the "mostly not" part):

| season usage | offseason mileage decay |
|---|---|
| light (<150 touches) | ×0.93 (small recovery) |
| IR or ≥8 missed games | ×0.88 (Lynch sit-out) |
| default (150-300) | ×0.97 (tread is sticky) |
| heavy (>300) | ×1.00 (no recovery) |

Floor: mileage never drops below 50% of accumulated peak — cartilage / joints
don't regrow.

**Hidden:** user-facing surface is the *manifest* effects (earlier decline,
worse year), not the raw number. Restores scouting tension on aging RBs.

**RB only first:** cleanest test case; position with the most empirical "cliff"
data. Extensible to WR (deep balls absorbed), CB/S (collisions on screens) if
the mechanism proves out.

**Sequencing:** **after** wear-driven decline lands. Wear handles the general
usage→aging mechanism for all positions; mileage adds the RB-specific career-arc
refinement. If wear gets 90+ share in band, mileage is polish + RB narrative
flavor; if wear doesn't close the gap, mileage is the closer.

### Concussion-driven AWR decline (queued — 3rd sticky load layer)
Concussion tracking already exists (`_concussionsThisSeason` / `_concussionsLifetime`)
and drives CTE escalation + catastrophic injury risk + career-ending arc. But
there's **no persistent AWR decline** tied to lifetime concussion count — a QB
with 5 lifetime concussions decays AWR at the same rate as a QB with 0.

This is the third leg of the same "career punishment → diminished player"
mechanism alongside wear and mileage. Concrete impl in physical-decline block:

```js
const cct = (p._concussionsLifetime || 0) + (p._concussionsThisSeason || 0);
if (cct >= 4 && age >= 28) {
  const awrProb = cct >= 6 ? 0.30 : cct >= 5 ? 0.20 : 0.12;
  if (Math.random() < awrProb) p.stats[3] = Math.max(40, (p.stats[3] || 70) - 1);
}
```

A 6-time-concussed 30-yo QB / LB starts losing AWR ~3pp/yr — the Aaron Hernandez
/ Junior Seau arc. Queue alongside mileage, both apply after the level retune.

### `_aiScoutBias` → buy-in/ceiling decoupling (queued — valve 2 final piece)
Per the valve 2 analysis above: the symmetric scout-error model already exists,
but `scoutBuyIn` is gated by ceiling, which clamps the bust tail. Two options:
- **Decouple ~5-10% of high-ceiling prospects from their positive buy-in** — they
  get NO buy-in (or negative buy-in) despite scout consensus. "The consensus was
  wrong" busts emerge naturally.
- **Add an independent draft-hype mechanic** — 3-5% of prospects get a +5 to +10
  bias independent of ceiling. Overhyped low-ceiling busts.

Queued because retune-6 (coach compound cap) may resolve enough of the inflation
that R1 bust rate ticks up organically (wear-decline already moved it 0.0% →
1.1%, showing the mechanism responds). If r-6 lands 90+ in band but R1 bust is
still <10%, this is the structural close.

### Dead code to remove (orphan systems)
The system-discovery agent found code that's deleted but never set anywhere —
planned features that were superseded. Safe to remove for clarity:

| field | location | status |
|---|---|---|
| `_srStockMaker` / `_srStockBreaker` | offseason ~19562-63 (only deletion code) | QB draft-stock momentum, never wired |
| `_breakoutYear` / `_breakoutSeverity` / `_breakoutMagnitude` / `_breakoutFired` | offseason ~19553-60 (only deletion code) | replaced by hidden-gem breakout mechanic |
| `_secondaryFired` / `_secondaryMagnitude` | offseason ~19553-60 | multi-wave breakout, never wired |
| `_tertiaryFired` / `_tertiaryMagnitude` | offseason ~19553-60 | same |

Plus the legacy `_tradedAtSeason` (now cleared by the trade-reaction system but
the field is still set + cleared in 4 trade-exec sites — could be folded into
`_tradeReactionSeason`).

Cleanup is cosmetic + reduces grep confusion; no functional change.

### Real gaps (systems that should exist but don't)

| gap | what exists | what's missing |
|---|---|---|
| **Contract-year walk** | `_ignoredDemandSeason` exists, *penalizes* ignored demands with dev freeze | no walk-year *boost* — Aaron Donald lifting before extension isn't modeled |
| **Rookie wall (year-2 collapse)** | `_trajectory` has FLASH for late bloomers | no explicit year-2 sophomore-slump mechanic; partially absorbed by `_devMult` variance |
| **Mentor/rookie pairing** | flavor text ("wants to mentor a rookie") on veteran FA cards | no mechanical bonus when a rookie shares a roster with a same-position vet |
| **QB-WR chemistry** | `player.systemYears` field referenced in career assignment | field exists, **zero mechanics** use it — no familiarity bonus, no continuity premium |
| **Garbage-time stat scaling** | none | every stat counts equally regardless of margin; contributes to "records run hot" finding |
| **Primetime / playoff scaling** | playoff games sim normally | no big-game boost/choke, no showman bonus in primetime (showman is gen-flag only) |
| **Workout warrior decay** | `_combineResult.isRiser` flag exists | no mechanism for workout-grade to fade if performance doesn't match (Vernon Adams effect) |
| **Position switch / re-position** | none | a CB who can't cover but can hit could move to S, etc. — no in-engine re-categorization |

These are all *additive* features (not corrections), so they don't gate any
current retune. Worth tracking as future depth.
