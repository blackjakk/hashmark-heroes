# Hashmark Heroes — Realism Audit Runbook
*(originally documented as "GridironChain"; renamed 2026-05)*

> **Purpose.** Two headless Node harnesses that run the *real* game engine
> (no browser) over many games/seasons and check that the output matches NFL
> reality. They exist so realism tuning is **regression-proof**: change a
> formula, re-run the audit, see immediately whether you helped or broke
> something. This doc is the durable record of *how to run them*, *what every
> metric means*, the *NFL reference bands*, and the *calibration history* —
> so this exercise can always be reproduced.

---

## TL;DR — how to run

```bash
cd gridiron-chain

# ⭐ STANDARD: the FULL bundle ("all materials") — run THIS after any sim/talent
# change. Runs both harnesses in parallel; produces game-realism stats AND the
# franchise/career/record-book materials (incl. BEST SEASON BY POSITION).
./_audit_all.sh 40         # logs → /tmp/audit_sim_40.log + /tmp/audit_brady_40.log
./_audit_all.sh 100        # settles the noisy tails (K/P, Brady cadence, legends)

# Or the harnesses individually:
# Game realism (fast). Arg = seasons; each season = 992 games (32 teams round-robin).
node _sim_audit.js 2       # ~1 min, quick sanity (1,984 team-games)
node _sim_audit.js 5       # ~8 min, clean sample (4,960 team-games)

# Franchise + player development + Brady-gem pipeline (slow — plays full seasons).
node _brady_audit.js 40    # ~17 min — standard
node _brady_audit.js 100   # ~40 min — settles the noisy Brady cadence
```

> **Standard practice:** every simulation/talent change gets the **full bundle**
> (`_audit_all.sh`), not a single harness — both the per-game realism *and* the
> franchise/career materials. The 100-season run is the truth for any
> tail-sensitive question (per-position 90+ rates, K/P, legends) — 40-season
> per-position tails are small-sample noise.

> **Determinism (seeded).** `_sim_audit`, `_clutch_audit`, and `_mff_audit` now
> override `Math.random` with a seeded mulberry32 stream (default seed 1337; pass
> it as the LAST arg to vary, e.g. `node _sim_audit.js 5 99`). The shipped engine
> is untouched. **Why this matters for *this doc's* promise:** the engine is
> stochastic (~142 `Math.random`/game), so before seeding every run sampled
> *different* games — two unseeded 1-season `_mff_audit` runs shared almost no
> leaderboard names and league rates swung several points. That breaks
> "re-run, see if you helped or broke something": the diff is your change PLUS
> sampling noise. With a fixed seed the games are identical run-to-run, so a
> metric delta is attributable to your change. **Caveat:** seeding gives
> *reproducibility*, not *validity* — a seeded small sample is reproducibly
> noisy, so keep raising the season count (the advice above) for tail-sensitive
> metrics. Seeding + adequate N together is the trustworthy combo.
> Now seeded: `_sim_audit`, `_clutch_audit`, `_mff_audit`, `_brady_audit` (pass
> the seed as the LAST arg, e.g. `node _brady_audit.js 75 99`). `_audit_all.sh`
> just wraps the now-seeded harnesses.

> **Regression gate (automated).** `_audit_gate.js` + `_audit_baseline.json` turn
> the seeded audits into a CI/pre-commit check — the FM-style cross-version
> regression test. **Fails if a tracked metric drifts from baseline beyond
> tolerance** (the audit's own NFL band is an informational warning, not a
> failure). THREE TIERS (each metric is tagged `tier` in the baseline):
> - **`node _audit_gate.js --fast`** — `fast`: mff league aggregates (pressure /
>   run-block-win / completion), ~60s. Used by the `.githooks/pre-commit` hook so
>   commits stay fast.
> - **`node _audit_gate.js`** (default) — `fast`+`full`: adds the `_sim_audit`
>   realism benchmarks (points/yds/completion/ypc/sacks/ypp, seeded 2-season),
>   ~3-4min. Used by `.github/workflows/audit-gate.yml` on engine/talent changes.
> - **`node _audit_gate.js --slow`** — `slow`: clutch DiD (completion/INT) +
>   brady career aggregates (league OVR mean, roster size, elite-90 share),
>   ~9min. Used by `.github/workflows/audit-gate-nightly.yml` (cron + dispatch),
>   so tail-sensitive realism is guarded without slowing per-PR checks. (`--all`
>   runs every tier.)
>
> **Scope:** gates stable AGGREGATES only — per-player leaderboards AND rare-event
> tails (sim INT-rate/turnovers, clutch FG-DiD which needs huge N) are small-sample
> noise even seeded, so they're left out; raise the sample for those, don't gate
> them. Re-baseline an intentional realism change by updating the matching `value`
> in `_audit_baseline.json` in the same commit (same protocol as the teleport
> gate). The chosen N is for speed; the gate detects *drift*, it does not assert
> NFL-validity — that's still a manual large-N run. (GitHub fires the nightly cron
> only on the default branch, so it activates on merge; trigger by hand via
> workflow_dispatch until then.)

No flags, no build step, no browser. Output is plain-text tables with NFL
bands and `OK` / `!!` flags. Stderr carries progress + benign noise (filter
with `2>&1 | grep -vE "missing pick|IDB|^\s+at "` if you want it clean).

---

## ⚠ Harness invariant — the draft class MUST cycle (rosters stay ~full)

**The big one — found & fixed.** `_brady_audit.js` drove the offseason with a
*synchronous* `step()` that fire-and-forgot the **async** draft chain
(`frnAutoDraftRemaining`, `frnDraftFinishScramble`, which `await _frnConfirm`).
The part that **mints next year's draft picks and fills rosters to 53 never
ran**, so the pick inventory (seeded with only ~3 years at `startFranchise`)
stopped cycling. From ~season 4 the draft starved, rosters bled out via
retirement, and the league collapsed to **~6 players/team**. Every long-run
roster-dependent metric — roster construction, cap utilization, **and the
talent distribution itself** — was computed on a ~190-player league instead of
~1,700. It failed **silently** (an un-awaited Promise; node just exited 0).

**Fix (commit `0c3955d`):** `await` the async offseason steps (`stepA`),
auto-resolve `_frnConfirm` headless (`async () => true`), make the
`requestAnimationFrame` stub actually fire its callback (so frame-yield awaits
resolve instead of hanging), async IIFE + clean `process.exit(0)`.

**Guard (so it can't recur):** the season loop checks mean roster size each
season after season 2 and **aborts LOUD** (`process.exit(3)`, banner) if it
drops below 40/team. A regression in the await chain trips this in seconds
instead of emitting 13 minutes of garbage.

**Recognize it again by:** "mean roster size" well under 53 in the LEAGUE OVR
DISTRIBUTION header; round buckets dominated by R4–R7/UDFA with a tiny R1 count;
cap utilization near 0%.

**Sample size (healthy):** a full league is 32 × 53 = **1,696 players**; the
audit snapshots active rosters once per season, so an N-season run pools
**~1,696 × N player-seasons** for the league OVR / draft-round distributions
(40 seasons ≈ **~68,000 player-seasons**). The collapsed runs pooled only
~7,300 over 40 seasons (~183/season) — a ~9× smaller *and* survivor-biased
sample. Career/bust tables count distinct players (thousands); ROSTER
CONSTRUCTION + cap are the final-season snapshot (1,696 players / 32 teams).

**⚠ Consequence:** numbers in `TALENT_MODEL.md` predating commit `0c3955d`
were measured on collapsed rosters and need re-validation. First clean read:
elite 90+ share moved 1.3% (collapsed) → 4.4% (full, 3 seasons).

## ⚠ Harness invariant — production stats are REGULAR-SEASON ONLY

`_brady_audit`'s per-player season/career **production** (season highs, career
leaders, best-by-position, single-game highs, TOP-10-by-position, typical
career) accumulates **only from regular-season games**. The `frnSimOnce`
wrapper returns early when `isPlayoff` — otherwise a deep playoff run folds ~4
extra games into a player's "season", inflating every production view (a
Super-Bowl QB's season/career totals balloon). This was a real bug, fixed; if
you see season-game counts above the regular-season length or suspiciously high
season totals for contending teams, the `isPlayoff` guard has regressed.
(Talent / OVR / roster / cap / gem snapshots are roster-based and unaffected
either way.) `_sim_audit` is regular-season by construction — round-robin, no
bracket, one line per game.

---

## The two harnesses

### 1. `_sim_audit.js` — game realism
Runs `new GameSimulator(home, away, rosterH, rosterA).simulate()` directly for
every matchup, **freshly generated rosters each season** (no franchise layer,
no development). Answers: *"does a single game produce NFL-shaped box scores?"*

Three tables:
- **NFL REALISM AUDIT** — per-game volumes + per-attempt rates + efficiency.
- **DISTRIBUTION** — P10/median/P90 + min/max + std per metric (catches tail
  bugs a mean would hide, e.g. a clamp truncating the top end).
- **EVENT RATES** — rare-event shape checks (shutouts, blowouts, multi-INT…).
- **DRIVE / SITUATIONAL / KICKING** — drive outcomes, 3rd/4th-down, red zone,
  FG by distance, XP, punts, OT.
- **PER-POSITION PRODUCTION** — for each O/D/ST position's *starter*, per-game
  median/P10/P90/max of key stats + milestone-game frequencies (300+yd QB
  games, 100+yd RB/WR games, multi-sack DL, INT-game CB, etc.). The fastest way
  to spot a position over/under-producing. (OL shows n=0 — not individually
  tracked beyond team pancakes.)
- **PLAYBOOK BREAKDOWN** — per-team-game tagged by the offense's playbook:
  pass%, pass/rush yds, yds/play, points, sacks-allowed. Confirms the 5 schemes
  differentiate (AIR_RAID 66% pass / 6.8 ypp / most pts; GROUND_AND_POUND &
  OPTION run-heavy; OPTION fewest sacks — QB keepers dodge the rush). Also
  surfaces the passing-hot theme (AIR_RAID over-scores).
- **WEATHER BREAKDOWN** — per-team-game tagged by condition: comp%, yds, points,
  fumbles, FG%. Gradient: CLEAR best → WINDY/HOT mild → RAIN/SNOW worst (cut
  comp% + FG%, spike fumbles). (WINDY/HOT quirks fixed — see calibration.)
- **COACHING BREAKDOWN** — `_sim_audit` injects a `franchise.coaches` stub
  assigning each team a balanced HC `specialtyTrait`, then tags 4th-down
  go-attempts / conversion% / points by trait. Confirms `hcAggMul` fires:
  Riverboat Gambler 1.56 go/g > Neutral 1.27 > Game Manager 1.22 > Conservative
  0.96 (62% more aggressive than Conservative).
- **DEFENSIVE SCHEME / PERSONNEL / COVERAGE** — per-play tags from the play log.
  DEF SCHEME: plays%, yds/play faced, comp% allowed, sack% (DIME tightest comp +
  most sacks, BASE_43 best run-stop). PERSONNEL: plays%, yds/play, pass% (SPREAD/
  EMPTY most efficient + pass-leaning, HEAVY/I_FORM run-heavy). COVERAGE: per
  completion Y/CMP (which shell gets beaten deepest — coverage is logged only on
  completions, so comp%-allowed isn't derivable).
- **FATIGUE BREAKDOWN** — reads `sim._fatigue` post-game; end-of-game fatigue
  (med/P90/max) by starter position + per-quarter yds/play. Workhorse trench
  players (OL/DL) end ~59 median / ~68 P90, RB workhorse P90 ~60, QB/low-snap
  stay fresh; Q4 efficiency dips ~3% (realistic). (Caught the no-recovery bug —
  see calibration.)
- **RUN-PLAY YARDAGE HISTOGRAM** — per-play yardage distribution for run plays
  (incl. scrambles) by down. 7 buckets: `loss / 0 / 1-3 / 4-9 / 10-19 / 20-39 /
  40+`. Per-down columns + mean + 10+% (chunk rate). Reveals shape bugs a mean
  would hide. 4th-down runs hit more chunks (defense sells out for stop). 1-season
  smoke: run mean 5.0 (NFL ~4.4, slightly hot).
- **COMPLETION YARDAGE HISTOGRAM** — per-completion yardage distribution by
  down (catches only, sacks/incompletes excluded). Same buckets. 3rd-down
  completions are deepest (mean 13.6, 60% gain 10+ — engine throws downfield
  on 3rd correctly). 4th-down completions shortest (checkdown bias).
- **3RD-DOWN CONVERSION BY DISTANCE** — `short(1-2)/medium(3-6)/long(7-10)/
  xlong(11+)` att/conv/conv% with NFL bands per bucket (~70/45/30/17%).
  Smoke: 72/50/33/20%, all in band. Catches shape bugs a 41.6% aggregate would
  hide.

### 1b. `_qb_probe.js` — QB-archetype isolation probe
`node _qb_probe.js [games]` (default 300). Builds **one fixed home roster + one
fixed opponent under a fixed seed**, then swaps ONLY the home QB across hand-built
profiles (pocket cannon / dual-threat / noodle-arm-quick-legs / balanced),
dropping all other home QBs so the profile QB always starts. Seeded RNG ⇒ cast,
opponent, and game conditions are identical across profiles and run-to-run, so
**win% + production are directly comparable** (the QB is the only variable).
Reports OVR, archetype, win%, pass line, and QB rush line per profile. This is
the regression tool for the dual-threat run game.

### 1c. `_arch_probe.js` — positional archetype isolation probe
`node _arch_probe.js [POS|ALL] [games]` (default ALL 200). For each position it
generates one exemplar of every archetype near a common OVR (realistic stat
profiles via rejection sampling), swaps it/them into a fixed home lineup as the
starter(s) — with deliberately-weak fixed backups so the exemplar ALWAYS starts,
even for picker-rare archetypes — and runs seeded games vs a fixed opponent.
Reports each archetype's signature stats: own line for skill positions
(QB/RB/WR/TE/K/P), the OPPONENT offense for defensive units (DL/LB/CB/S), team
aggregate for OL. **This is how you tell a real archetype from a flavor label**:
if two archetypes produce the same box score, the label is cosmetic. Verdict
(2026-05): every archetype differentiates except the three HYBRID types
(TE/LB/S) which were flavor-only and picker-capped to low OVR — since fixed.

### 1d. `_jumbo_probe.js` — 13-personnel matchup probe
`node _jumbo_probe.js [games]` (default 250). Forces the offense into JUMBO (13
personnel — 1 RB / 3 TE / 1 WR) on every play, pins the defense to each scheme
(BLITZ_46 / BASE_43 / BASE_34 / NICKEL / DIME / PREVENT) via getter shadow, and
measures how 13-personnel produces against each. Answers *"what is 13 personnel
best against?"* Confirms design intent: 13 punishes blitz/heavy fronts via PA
shots (BLITZ_46 6.81 Y/play, 30 PTS/g — best for offense); least valuable vs
DIME (6.26, 27.3 PTS/g). Seeded → reproducible.

### 1e. `_ux_snapshot.js` — Playwright visual-verification harness
`node _ux_snapshot.js [shot|ALL]` (default: all default shots). The UX
counterpart to the audit harnesses — instead of stats, produces directly-
readable PNG screenshots in `/tmp/ux/` for every major UI state. Backbone of
the UX retune (banner removal, delete safety, Quick Start flow, nav rail).

**Prereq**: an http-server on :5173 (run once per session, persists in
background): `nohup npx http-server -p 5173 -c-1 -s . > /tmp/dev-server.log
2>&1 &`. Uses the pre-installed Chromium at `/opt/pw-browsers/chromium-1194/`
via the global Playwright (`/opt/node22/lib/node_modules/playwright`); the
`node_modules` install in repo root is just the deps record (gitignored).

**Default shots:**
- `cold` — fresh visitor, no saves (the cold-start screen)
- `returning` — seeded slot data, slot list visible
- `mobile` — 390×844 viewport
- `dev` — `?dev=1` URL — testing-tools entry
- `slot-menu` — `⋯` popover (rename / delete) open
- `delete-modal-low` / `delete-modal-high` — styled confirm modal, with + without type-name gate
- `story-picker` / `story-picker-mobile` — the Choose Your Story archetype view
- `navbar-fa` / `navbar-awards` / `navbar-playoffs` — in-loop nav rail per phase

**Interactive driver** — each shot has optional `setup(page)` (pre-navigation:
seed localStorage) + `after(page)` (post-navigation: click/type to reach the
target UI state). `franchise` is a top-level `let` (not on window) — access by
name from `page.evaluate`, NOT `window.franchise`.

### 2. `_brady_audit.js` — franchise + player development
Drives a full franchise headlessly season-by-season (plays every game + the
playoff bracket, runs the awards/retirement/draft/offseason chain). Answers:
*"does the league develop like the NFL over decades, and does the hidden-gem
→ legend ('Brady') pipeline fire at the right rate?"*

Tables:
- **BRADY-TEST AUDIT** — hidden gems rolled + legend-tier (OVR ≥ 96) emergences,
  late-round (R5+) and Brady-tier (R6+/UDFA) cadence vs the ~1-per-75-yr target.
- **BEST SEASON BY POSITION** — the best individual (real-named) single season
  at each of the 11 positions, ranked by a position-appropriate metric (QB
  pass yds+TD, RB rush yds, WR/TE rec yds, OL pancakes, DL sacks, LB tackles,
  CB/S INTs, K FG made, P punt yds). Filters the engine's placeholder
  stat-key aggregates ("QB"/"WR1"/"MLB" — nameless lines bucketed by slot).
- **RECORD BOOK** — career / single-season / single-game leaders (offense +
  full defense).
- **LEAGUE OVR DISTRIBUTION** — active-roster OVR spread pooled over all seasons.
- **DRIFT BY DECADE** — isolates real OVR creep from artifacts.
- **OVR BY DRAFT ROUND** — pedigree gradient (R1 → R7 → UDFA), late-round
  outliers = gem emergences.
- **BUST / HIT RATES BY DRAFT ROUND** — career-peak based; round-tiered bust
  thresholds.
- **FRANCHISE HEALTH** — competitive balance (win% spread, persistence,
  worst-to-first, champion concentration).
- **CAREER LENGTH BY POSITION** — attrition gradient (RB/DL short, QB/K/P long).
- **LEGEND CAREERS** — full per-season story for every OVR-96+ player:
  trajectory, accolades (SB/MVP/All-Pro/PB), career totals.
- **STAR CAREERS** — top-15 peak-90+ careers that never crossed the 96+ legend
  bar (Nasser/Peterson/Sherman tier). Header includes archetype; long careers
  windowed to 8 seasons around the peak. Closes the gap where generational
  near-legends left no career record. (`starPlayers` map; sec ~242, dump ~1040.)
- **INJURY REPORT** — injuries/team-season (contact vs non-contact split),
  non-contact share %, season-ending (8+ wk) rate, career-ending rate, games
  missed, median/P90 weeks out, by-position rate, and injury-type frequencies.
  Captured by wrapping `_rollGameInjuries` + `_rollNonContactInjuries` (which
  fire per game in `recordFranchiseResult`) so every injury is tallied at
  assignment — players later cut/retired are still counted. This is also the
  only lens on the **HEADHUNTER** archetype, whose identity is causing injuries
  (×1.5 on big hits), invisible to the box-score archetype probe. Also split by
  **HC culture trait** (Disciplinarian lowest) and **trainer trait**.
- **STRESS REPORT** — final-season `_stress` (0-100) by position; drives
  non-contact injuries. Concentrates in WR/CB/S; OL/QB/RB/TE near 0.
- **PERSONALITY REPORT** — league distribution % (matches gen rates) + avg
  career length by personality (captain/cancer/quiet_pro/showman/coachs_son).
- **SALARY CAP** — final-season payroll/cap utilization (mean/P10/P90).

---

## How the headless technique works (for maintainers)

The game is vanilla browser JS (no modules/exports). Each harness:
1. Reads the `play-*.js` source files as text and concatenates them into one
   string, so their top-level `const`/`class`/`function` declarations share a
   single lexical scope (they don't attach to a VM global).
2. Prepends a **minimal DOM shim** — a chainable `Proxy` stub that absorbs any
   DOM access without throwing, plus `confirm`/`alert`/`localStorage`/
   `indexedDB` no-ops. UI-init calls that run at file load are stripped via
   `stripUiInit()`.
3. Appends the audit code, then executes the whole thing with
   `new Function(bundle)()`.

**Files loaded** (order matters — dependency order):
`play-data → play-player → play-render → play-sim → play-motion → play-engine`
and, for the Brady audit, also `play-broadcast` (defines `_bspnLiveAbbr` that
franchise award/record code calls) + the four `play-franchise-*.js` files.

**Gotchas learned the hard way:**
- The harness string is a template literal: inner newlines must be `\\n`, not
  `\n` (a `\n` terminates the outer string → `SyntaxError` at `new Function`).
- `node --check` only validates the *outer* file; it does **not** catch errors
  inside the bundled string. Always smoke-run (`node _x_audit.js 2`) after edits.
- Render functions are re-assigned to no-ops *at runtime* (bareword, not
  `globalThis[...]`) because the bundled scope isn't `globalThis`.
- The Brady audit drives the season explicitly (`frnSimToEndOfSeason` →
  `showFrnAwards` → `frnProceedToRosterChanges` → `frnGoToDraft` →
  `frnAutoDraftRemaining` → `frnDraftFinishScramble` → `frnNewSeason`) because
  the live phase machine expects UI clicks. **`showFrnAwards` is mandatory** —
  it runs `_processSeasonEndRetirements` (aging + retirement + the gem breakout
  reroll) AND `_stampSeasonAccolades`. Skipping it silently zeroes development.
- `frnDraftFinishScramble` is mandatory too — it calls `_draftFinalize`, which
  **mints the next future year's draft picks**. Skip it and the pick inventory
  (seeded with only 3 years) runs dry by season 4 and the draft collapses to
  UDFA-only.

---

## Metric reference — NFL bands

> Bands are deliberately a bit wider than real single-season NFL averages
> because the sim pools many games; they're tuned to flag *systemic* drift,
> not single-game noise. A metric being in-band = realistic; `!!` = investigate.

### Game realism (`_sim_audit.js`)
| Metric | NFL band | Notes |
|---|---|---|
| Points / game (per team) | 17–27 | ~22.5 real |
| Total yds / game | 290–380 | |
| Pass yds / game | 190–270 | |
| Rush yds / game | 90–145 | |
| Completion % | 58–69% | |
| Yards / carry | 3.9–4.9 | |
| INT rate / att | 1.8–3.4% | |
| Sacks / game | 1.6–3.3 | |
| Turnovers / game | 0.9–2.1 | |
| First downs / game | 16–24 | |
| Penalties / game | 4–8 | |
| Penalty yds / game | 35–70 | DPI single-counts (verified not double) |
| Plays / game | 58–68 | |
| Yards / play | 5.0–6.0 | NFL ~5.4 — cleanest "offense hot/cold" tell |
| Points / play | 0.30–0.42 | all-snap basis (NOT scoring-plays-only) |
| Yards / completion | 10.0–12.5 | |

### Drive / situational / kicking (`_sim_audit.js`)
| Metric | NFL band |
|---|---|
| Drives / team-game | 10.5–12.5 |
| Points / drive | 1.6–2.3 |
| Yards / drive | 28–36 |
| TD / drive | 18–26% |
| FG / drive | 9–18% |
| Punt+TO / drive | 48–62% |
| 3rd-down conv % | 36–44% |
| 4th-down conv % | 45–60% |
| Red-zone TD % | 52–66% |
| FG % (overall / 0-39 / 40-49 / 50+) | 82-90 / 93-100 / 78-90 / 55-75% |
| XP % | 92–97% |
| Punt avg | 43–48 |
| OT game % | 4–10% |

### Franchise health (`_brady_audit.js`, bands scale with sim length)
| Metric | Band | Meaning |
|---|---|---|
| Best team win% (P99 season) | 76–90% | best season shouldn't be 17-0 every year |
| Worst team win% (P01 season) | 10–24% | nor 0-17 |
| Win% spread P90–P10 | 30–55 pts | league not too flat / too lopsided |
| Yr-to-yr persistence (Pearson r) | 0.30–0.65 | good teams stay good, but not permanently |
| Worst-to-first rate | 3–12% | turnaround stories exist |
| Unique champions | ≥ ~45% of seasons | parity |
| Repeat / most titles | small | dynasties exist but aren't permanent |

### Injuries (`_brady_audit.js` INJURY REPORT)
> Bands are **approximate** — NFL "injuries causing missed time" isn't a clean
> public stat; these flag systemic over/under-injury, not precise rates.

| Metric | Band | Notes |
|---|---|---|
| Injuries / team-season | 18–42 | all injuries costing ≥1 game |
| Non-contact share % | 28–45% | soft-tissue/stress (code targets ~40%) |
| Season-ending (8+ wk) / team-season | 4–14 | ≈ IR placements |
| Position gradient | WR/CB/S high, QB/OL/K/P low | speed positions tear soft tissue |
| Median weeks out | ~2–3 | most injuries are short soft-tissue |

### Brady-gem cadence (`_brady_audit.js`)
Design band **2-12 True Brady/100yr** (R6+/UDFA QB → OVR 96+ — richer than NFL
by intent, see calibration history). Current measured mean ≈ **8-9/100yr** post
the 30/40/30 ceiling-shape fix (was 11.4 at 50% HOF); 95% CI from 800
season-equiv audit. **This metric is Poisson-noisy** (SD ≈ √μ): at 40 seasons
you'll see anywhere from 0 to 4 and it spans the whole band; even 100 seasons
gives ±~3 around the mean. Only judge cadence on **100+ season runs**, and
**never tune on a single audit** — at the band's mean, a +2σ draw lands above
the band ~1 audit in 20 and is *expected*, not a regression. Levers: HOF-tier
share in `_rollHiddenGem` (`play-player.js`, scales linearly with Brady rate)
and `GEM_DEV_BREAKOUT_P` in `play-franchise-stats.js`
(`_rerollPotentialForBreakouts`). For real measurement use the parallel pattern
in the calibration history below (`for i in 1 2 3 4; do node _brady_audit.js
200 > /tmp/run_$i.log & done; wait`) — the metric is unseeded so each run is
one independent draw, and 4×200 fits in 4 cores at ~90 min wall-clock.

---

## Calibration history — what we changed and *why*

> The audits *found* every one of these. Kept here so the reasoning isn't lost.

### Injured Reserve system + cap-reporting truth (2026-06 session)

> A full NFL-style IR system, plus the first-principles diagnosis that the
> long-standing "cap utilization low" flag was **two different things** — a real
> bug (units mismatch) and a measurement artifact (the audit photographing teams
> mid-roster-turnover). Recorded in depth because the *reasoning* here matters
> more than the diffs.

**1. Gem physical floor → REALISTIC dev target (WR/TE late-round legends).**
The `_gemPhysicalFloor` (the 99-wall fix) solved each gem's frozen physicals
assuming **perfect, all-99 development**. But real development chases overall, so
a position's low-weight dev stats (e.g. a WR's 8%-weight AWR) get neglected and
land several points short. Net effect: high-frozen-weight skill positions (WR/TE,
47% frozen) realized ~2 OVR below their ceiling *every time* and never converted
— audit showed **WR 0 / TE 0** late-round legends while trench (OL) converted.
Diagnosis was clinched by noticing WR and CB are structurally **identical** in
`calcOverall` (swap CAT↔COV) yet diverged 0 vs 4 — so it wasn't supply, it was the
dev gap. Fix: solve the floor against a **realistic** dev outcome — derive each dev
stat's OVR weight by finite-difference on `calcOverall`, then assume high-weight
stats reach ~97, low-weight ones lag to ~93. This concentrates frozen headroom on
WR/TE/CB/S (low-weight dev stats) and barely touches QB/OL/DL (high-weight or
few-stat). 100-season result: **WR 2 / TE 5** late-round legends (target ~2-4),
legends 34/100yr, True Brady 6/100yr — all in band, no QB overshoot. (`c565c5e`)

**2. Cap-relative salary FLOORS (the real drift bug — units mismatch).** The cap
system mixed units: contracts (`computeMarketValue`, `rookieContract`) are
fractions of the cap, but the salary *floors* were **flat dollars** — ~$1M minimum
deals, $0.5M practice-squad slots, $0.5M backstops. As the cap inflates ~7%/yr,
floor-paid players (who occupy real roster slots) shrink as a share of cap, so
league utilization **drifts down the longer a franchise runs** (8-season ~88% →
100-season ~84% — the signature of mixed units). Fix: `leagueMinSalary(cap)` /
`absSalaryFloor(cap)` express floors as cap fractions that **reproduce the exact
old dollar values at the $200M base** (so season-1 calibration is untouched) and
scale thereafter. Converted the 4 load-bearing sites (both min-contract paths,
`psCostForTeam`, declined-resign deal). `_cap_trace.js` (30-season) confirmed the
drift **flattened to −0.9pp** while the cap 7×'d, min-tier share holding ~7%
instead of decaying. (`cf6c804`, harness fix `baa8ef6`)

**3. The in-season "12pp cap drop" is a RETIREMENT DEAD-ZONE artifact, NOT a leak.**
The trace showed teams pump to ~99% in the offseason, then "drop" to ~86% by the
audit's season-end snapshot. I almost "fixed" this with dead-cap retention (an
invasive change) — but `_cap_diag.js` (week-by-week) proved the season runs **dead
flat** (87.2% every week, sheds nothing). Stepping through the boundary events: the
entire drop is **`showFrnAwards` running retirements** (roster ~47 → ~39, −12pp),
which **recovers to 99% one offseason step later at `enforceCapFloor`**. So the
audit was snapshotting cap in the single transient window per cycle when retirees
have left but the offseason hasn't refilled — a *measurement-timing* artifact.
During actual play, teams sit at ~99%. **Lesson: measure before tuning — I was
treating a snapshot-timing artifact as a gameplay flaw.** Fixed in item 6 below.

**4. Full NFL-style INJURED RESERVE system (phases 1-3).** Built so the roster
constraints actually *bind* — IR is meaningless without scarcity. The need is
real: active roster hard-capped at 53, injured players occupy spots.
- **Foundation** (`a285db2`): `franchise.ir[teamId]` (off the active 53, **still
  paid** — `capUsedByTeam` counts them in full, exactly like the NFL: IR is
  roster-spot relief, never cap relief). Constants `ACTIVE_ROSTER_LIMIT 53`,
  `IR_RETURN_MIN_WEEKS 4`, `IR_RETURN_SLOTS_PER_SEASON 8`, `IR_WORTHY_WEEKS 4`.
  Helpers `placeOnIr` / `activateFromIr` / `irEligibility` (season vs designated-
  to-return; career-ending stays on roster so the existing retirement pass is
  untouched) / `_rolloverIrForNewSeason` (IR heals + rejoins at the start of the
  offseason, BEFORE trim-to-53).
- **AI loop + 3 bugs the probe caught** (`7c45777` WIP → `1af384c`):
  `_aiManageInjuredReserve` (weekly) IRs long injuries, signs replacements, and
  activates healed return-designees. `_ir_probe.js` surfaced: (a) active roster
  bloated >53 because rollover ran AFTER the trim → moved it to the start of
  `frnProceedToRosterChanges`; (b) 0 activations because `_tickInjuriesForWeek`
  only ticked the active roster → now ticks IR too so designees heal; (c) cap
  ballooned because replacements signed at MARKET → now veteran-minimum 1-yr deals.
- **Injury reserve floor** (`1af384c`): `enforceCapFloor` target 0.99 → **0.97**,
  leaving ~3% room for IR replacements (IR'd players keep counting, so 99% left no
  room and total pushed >100%). First-principles: this is *why* real teams hold
  in-season cap room. Probe (6-season) lands true cap ~99.7%, active ~93%,
  **6.2 placements + 2.8 activations / team-season**, rosters held at 53.
- **User UI** (`54106b4`): "Injured Reserve" roster sub-tab (`renderFrnInjuredReserve`)
  + per-player "Place on IR" on the Injury Report + handlers `frnPlaceOnIr` /
  `frnActivateFromIr` / `frnSignIrReplacement`. `_ir_ui_test.js` smoke-tests the
  full place → sign replacement → heal → activate flow.

**5. Injury supply is sufficient for IR — no rate change.** 100-season audit:
21.9 injuries/team-season, **median 3 wk, P90 14 wk**, 4.0 season-ending. Median 3
means ~half are multi-week → ~8-11 IR-worthy + 4 season-ending per team-season,
a realistic-to-rich IR cadence. Cranking the global rate would just flood 1-week
dings (which never touch IR). The lever, if ever needed, is the multi-week supply
(catastrophic-upgrade chance) + the IR threshold — NOT the global rate.

**6. Cap reporting made truthful** (`f803a56`):
- **Audit** cap metric now measures `capUsedByTeam` (true commitment incl. IR) at
  **season start** (post-offseason), every season — not active-roster spend at the
  retirement dead-zone. Reads **~97%, in band, flag cleared.** IR usage is now a
  first-class audit metric (placements/activations per team-season + a checklist
  item + the cap report).
- **User cap sheet** (`renderFrnAnalytics 'mysheet'`): total uses `capUsedByTeam`
  so it reconciles with the league figure, and an INJURED RESERVE section lists
  IR players' cap hits (previously the sheet summed only the active roster and
  silently dropped IR salaries).

**New diagnostic harnesses (this session):** `_cap_trace.js` (per-season cap util
at offseason-high vs season-end-low + franchise-length drift), `_cap_diag.js`
(week-by-week salary trajectory + boundary-event stepper — *the* tool that proved
the retirement dead-zone), `_ir_probe.js` (IR usage + active-vs-true cap at steady
state), `_ir_ui_test.js` (user IR-handler smoke test). All use the same
bundle/DOM-stub technique as the audits; reassign render fns to no-ops by bareword.

**Open (minor realism, not correctness):** (a) season-IR'd players retire a year
late — the end-of-season retirement pass runs while they're off the active roster;
(b) practice-squad depth erodes — `_psPromote` permanently moves a PS player up as
a replacement with no mid-season refill. Both work; neither breaks anything.

**100-season regression (`C`) result: 22/23 pass.** Cap utilization (true,
season-start) **97% — flag CLEARED**; IR placements **7.1/team-season** (in band,
validated at scale); roster size 53; talent (90+ 6.7%, mean OVR 78.7) and all
competitive-balance bands clean; the two prior WARNs (season-ending 4.4, top
WR/TE 1919) both cleared too. **Only flag: True Brady 13/100yr** (band 2-12, over
by 1). The prior post-gem-fix run was 6/100yr; True Brady (R6+/UDFA QB → 96+) is a
documented Poisson-noisy rare event, so 6 vs 13 across two 100-yr runs points to
**upper-tail variance on a deliberately-rich design band** rather than a regression
(IR/floor changes don't touch QB development). OPEN DECISION: accept + widen the
design band to ~2-15 (matches the real pipeline rate, consistent with the owner's
"richer Brady pipeline" intent), confirm with another 100-yr run, or trim the QB
gem 96+ ceiling tier if fewer are wanted. Not reflexively widened — left for a call.

**RESOLVED — QB gem ceiling distribution reshape (`_rollHiddenGem` in
`play-player.js`).** Two methodological lessons, then a numeric+shape fix.
*Lesson 1 — don't tune a rare-event tail on n=1.* A first attempt trimmed the
QB 96+ tier 50%→35% on the strength of the single 13/100yr reading. True Brady
is a 4-stage conjunction (QB gem × R6+/UDFA × 96+ ceiling × realizes 96+); at
**any** non-trivial mean its 100-season SD is ≈ √μ, so a lone +2σ draw is
expected ~one audit in twenty and must never move a parameter on its own. Reverted.
*Lesson 2 — measure first, then tune.* Ran 4×200-season audits in parallel (800
season-equiv, the metric is unseeded → each `node _brady_audit.js` is one
independent draw; runs were 11.5 / 10.5 / 10.0 / 13.5). Aggregate: **True Brady
11.38/100yr, 95% CI [9.04, 13.71]** — a stable, real mean, not noise. *Inside*
the 2-12 band but on its ceiling, so ~44% of 100-season audits would flag it (a
guardrail that trips half the time isn't a guardrail). The stale "~7/100yr"
comment in this doc was wrong; the metric had drifted upward since the original
25→50% HOF doubling. *Lesson 3 — pick a SHAPE, then solve for the rate.* A
rate-only trim to 40/20/40 (common/mid/HOF) hit the target but read out loud as
*"a QB gem is most likely either a backup OR a HOF, less likely to be a Pro
Bowler"* — bimodal, not a story the design can tell. Final: **30% common
(77-88) / 40% mid (90-95) / 30% HOF (96-99)** — unimodal, Pro Bowl tier as the
mode, symmetric ceiling uncertainty. Deliberately distinct from the
monotone-decreasing non-QB shape 78/14/8 because QB outcome variance genuinely
*is* wider in real football. Projected Brady mean ~8-9/100yr (flag rate ~16%,
comfortably mid-band). Standing rule recorded in the code comment: **tune
`_rollHiddenGem` only against an aggregated multi-run μ, never a single
100-season audit.** (revert `8f6e9f6`, calibrated trim `793a818`, shape fix `08ca74e`)

**RESOLVED — Decoupled QB archetype from stat shape (`pickQBArchetype` in
`play-player.js`).** Post-reshape archetype dump revealed the legend pool was
**72% POCKET / 21% GAME_MANAGER / 7% DUAL_THREAT / 0% GUNSLINGER / 0%
FIELD_GENERAL** — two of five labels were *structurally* unreachable. Root
cause was a definitional contradiction, not a stat-tuning miss: the label
overloaded two things — (a) stat-shape descriptor (Gunslinger = low AWR via
`AWR<75 → +5 bonus`; Game_Manager = low THR via `THR<80 → +4 bonus`) AND
(b) play-style driver (the 3 engine sites switch on the same label for
+aggression, force-feed, deep-PI, matchup reads). Because OVR weights AWR
at 40%, any label whose definition included low/non-elite AWR was
mathematically locked out of the 96+ tier — anti-correlated with the very
ceiling the audit measures. Fix decouples the two meanings: the label is
now strictly a **play-style** axis, set by a mostly-random roll with mild
stat tiebreakers and ±25 jitter (was ±6), so any skill level can be any
style. POCKET keeps a slight base-weight lean (15 vs 10) to stay modal
(~45% population), matching real NFL pocket-passer share. DUAL_THREAT
keeps a hard SPD/AGI gate — "scrambler" requires actual legs, can't be
a label-only tag. Removed both anti-correlation bonuses. Engine sites,
OVR formula, dev system, save layer, and UI cards unchanged — same 5
string labels, same behavior; only the *assignment* changed. **200-season
audit (post-change): all 5 labels present at 96+ tier** (Pocket 65% /
Field General 18% / Gunslinger / Game Manager / Dual Threat 6% each),
True Brady 6.5/100yr (in band), 22/23 checks pass. The one flag — top-40
QB season median 6173 (band 5000-5900, +4.6% over) — is partly a side-
effect (Gunslingers in the legend pool fire +20 aggression and deep-PI,
pushing top-end yardage up) and partly outlier-driven (3 of top 40 are
one anomalous player at sub-80 OVR). Decoupling blurbs: updated to
describe play tendency only ("Aggressive shot-taker", "Patient dropback")
since stat-shape claims like "Big arm" / "immobile" no longer hold.
(`f4ddf10`)

**Frodo ghost-stat bug — orphan-reconcile mis-attribution (`53d4fda`).**
The first post-decoupling 200-season audit flagged a **9,397-yd / 60-TD
season at OVR 76** (Frodo Schwartz, Redwood Giants), plus two more 8,500+
yd seasons for the same QB — the "outlier-driven" caveat in the decoupling
entry above. It was not an archetype side-effect; it was a stat-attribution
bug. `_reconcileOrphanSeasonStats` (`play-franchise-stats.js`) was written
to repair a *nickname-rename split* — a player whose stats land under both
"Legal Name" and "Nickname" keys mid-season — via `rosterByNick.get(orphanName)`.
But it carried a speculative **"best-effort" fallback** that dumped *any*
leftover orphan stat-row onto a same-position roster player with existing
stats, even with no name relationship. When a team cycled QBs mid-season
(cut+sign, IR, trade), every cut QB's row became an orphan and the fallback
piled all of them onto the current starter → five cycled-out QBs collapsed
into one 9,000-yd ghost season at sub-80 OVR. **Fix:** keep only the
nickname→real-name match (the function's original purpose); cycled-out
orphans correctly stay orphan (those stats belong to a player no longer
rostered, not to anyone else). Validated in the multi-rep run below:
orphan-reconcile fires **0×** across all 4 reps and no QB posts an 8,000+
yd season (max now 6,580–7,247, all legit elite). The narrowed scope is
documented in the function header.

**Decoupling — multi-rep characterization (4 × 200-season).** The single
post-decoupling run above was n=1; ran 4 independent 200-season audits to
separate signal from variance, and to isolate the Gunslinger-share scatter
that drives top-end QB yardage. Combined 67-legend archetype distribution:
**POCKET 46% · GAME_MANAGER 21% · FIELD_GENERAL 16% · GUNSLINGER 13% ·
DUAL_THREAT 3%** — all 5 robustly reachable, no rep produced fewer than
4 labels. Pipeline cadences in band across all reps (legends μ=27.9/100yr,
True Brady μ=5.9/100yr). The "outlier-driven" caveat above was retired —
that was the **Frodo ghost-stat bug** (standalone entry above); all 4
reps fire orphan-reconcile **0×** and max single-season QB yardage now
sits at legit elite values (6580-7247). The top-40 QB median is a **real
+2.6% overshoot** (μ=6052, SD≈60, 4/4 over) — small, consistent, directly
caused by Gunslingers reaching the legend pool and throwing for more
(the archetype's whole point, now that it isn't OVR-locked-out). Same
"richer than NFL by choice" framing already applied to True Brady and
legend cadences; **QB-median band widened 5900→6150** to cover the
measured CI without dampening the now-working archetype. Top WR/TE
yardage flag re-checked: 3/4 reps in band (1862/1915/1982), rep2 outlier
2344 — noise, no band change. No gameplay code touched in this
characterization pass — only the audit band and this writeup.

**Game engine**
- **COLLEGE INJURY SYSTEM — the medical-faller draft-slip pipeline.** College
  players couldn't get hurt before (the pipeline only developed them). Real
  college injuries are the #1 reason talented prospects slip — added as a genuine
  source of late-round talent. `_rollCollegeInjury` (per prospect, per college
  year, in `_advanceCollegePipeline`): chance ~3.3%/yr × position × hidden-
  durability (~12-15% hurt over a 4-yr career); severity 62% moderate / 33% severe
  / 5% career-ending. KEY DESIGN: the injury craters PERCEIVED stock (via
  `_aiScoutBias` at grade time → slips 1-2 rounds) but leaves the TRUE hidden
  ceiling intact — so a hurt-but-talented prospect falls to the late rounds with
  upside preserved (a more believable gem source than "scouts randomly whiffed").
  It dents hidden `_durability` (real elevated NFL injury risk + injury-prone via
  `injuryHistory`); severe → 45% permanent athleticism ding; the scout knock is
  now EARNED (forces the injury/medical knock). Three draft-slip stories now
  coexist: (1) **scouts-missed** (the original hidden-gem system — high ceiling
  invisible at draft, Brady — still the majority), (2) **medical faller** (slipped
  on a real injury — the minority), (3) **clean pick**. (`a8ae7df`)
- **Redshirt rookies + medical retirement + career-enders.** Three lifecycle
  outcomes of the college injury: **career-ending** college injuries remove the
  prospect from the pipeline pre-draft (never reaches the NFL — "what could have
  been"); **~40% of severe injuries are recent** → `_draftRehab` → `_applyDraftRehab`
  stamps an active rookie-year injury (10-18 wks) so the player is drafted-and-
  stashed, sits his rookie year on IR, returns Year 2 (extra slip — a known
  redshirt); **medical retirement** (`_rollMedicalRetirement`, ~12%/offseason for
  the genuinely fragile — severe college injury + durability ≤45 — in their first
  2 NFL seasons) is the Lattimore/Jaylon-Smith downside of the gamble, wired into
  the season-end retirement pass. (`9cb5f56`)
- **Anti-gaming: seeded the college-injury + medical-retirement rolls.** They used
  `Math.random()`, making them save-scummable (reload before the offseason to
  dodge your prospects' injuries or re-roll a target into falling). Now seeded per
  (player, draftYear, collegeYear) / (player, season) — identical to gem-destiny
  seeding — so the fate is FIXED at generation and reloading reproduces it exactly.
  Verified the other vectors clean: a redshirt rookie still costs a roster spot +
  rookie contract + cap (not a free stash); fog-of-war holds (a faller shows a low
  grade + injury knock, true ceiling hidden; scouting-to-confirm is intended GM
  skill, and even a confirmed faller carries real body-risk so he's never free
  value). (`f066c63`)
- **THE 99 WALL — generalized gem physical-floor-from-ceiling (all positions).** A
  source probe proved why no 96-99 ceiling gem ever reached 99 (0% in probe AND
  audit): a gem's single-number "ceiling" is inconsistent with the multi-stat OVR
  — the FROZEN physical stats (out of the dev pools) cap the achievable OVR below
  the ceiling. A spd72/agi76/thr93 QB gem maxing AWR+TEC to 99 hard-caps at OVR 95.
  Replaced the QB-only arm-baseline hack with a general `_gemPhysicalFloor` (ceiling
  ≥90, K/P excluded): solves off `calcOverall` directly — sets developable stats to
  99 on a probe copy, raises the position's frozen physicals (lowest-first) until
  OVR reaches the ceiling, applies as floors (only raises). Direct test: 99-ceiling
  gems now reach OVR 98 with 3-37%/pos hitting exactly 99 (was hard-capped ~93-95).
  The probe ALSO proved realization (not ceiling-supply) is the binding constraint
  — a 96-99 ceiling gem averages a peak of ~80 — so chasing the 90+ COUNT with gem-
  ceiling knobs is futile (it's franchise-dev-driven). (`5882ad6`, `17e5aa8`)
- **Late-round elite pyramid — tuned + measured.** Audit `LATE-ROUND ELITE` now
  prints the 90+/95+/99 pyramid (target ~60-100 / ~20 / handful), by round, by
  position, and split by WHY they slipped (scouts-missed vs medical-faller).
  Non-QB gem ceiling doubling (8%→16%) over-shot (~20 legends/100yr, 5×), reverted
  to 8%; the real legends fix was the QB realization wall (the QB-only arm/
  athleticism floors that let R6+/UDFA QB gems clear OVR 96 — True Brady 0 → ~6/
  100yr). Mid (90-95) ceiling trimmed 14%→8% to thin the over-fat 90-94 band.
  (`5882ad6`, `1b39848`, `b78bb2a`)
- **Fixed the impossible unique-champions band.** Was `[seasons×0.45, seasons]` =
  45-100 for a 100-yr run — but there are only 32 teams, so max unique champions is
  `min(seasons, teams)` = 32. The band could NEVER be satisfied; the "dynasty
  stickiness" it flagged for many runs was a phantom. 27 unique/100yr = 27 of 32
  teams won a title, 5 perennial non-winners — NFL-realistic (12 of 32 teams have
  never won a Super Bowl in 58 yrs). Rebound to `[min(seasons,teams)×0.6, min(
  seasons,teams)]` = [19, 32]. (`7046218`)
- **QB REALISM OVERHAUL — accuracy-driven OVR, arm as a persistent physical
  trait, depth-weighted completion.** A THR probe showed arm strength inflating
  through development: starter THR median 84 → 93 over 12 seasons, 59% of
  starters ending at 90+ arm. Root cause: THR was 46% of QB OVR *and* in both
  dev pools, so OVR development WAS arm development — which (a) defeated the
  deep-ball system (arm gate pivots at THR 80; nearly all starters cleared it),
  and (b) made the average-arm/elite-accuracy QB (Brady/Brees) impossible.
  Four interlocking fixes:
  1. **QB OVR rebalanced**: THR 46%→18%, AWR 24%→40%, TEC 17%→32% (`spd*4 +
     agi*6 + awr*40 + thr*18 + tec*32`). Accuracy/processing drive the rating;
     an average-arm elite-accuracy QB can now be a top-5 OVR.
  2. **THR frozen** — removed from both dev pools (`_devStatPool` and
     `_gemDevStats` QB), so the draft-day arm spread persists across a career.
  3. **`_developPhysical`** — slight, capped, youth-gated PHYSICAL improvement
     (arm/speed/explosiveness): ~0.6 base chance/yr × drive × youth, bumps the
     LOWEST relevant physical, capped at 96. A pitcher cranking a few mph, not a
     noodle→cannon. Replaces the runaway inflation with ~+2-3 over a young career.
  4. **Depth-weighted completion** — short throws key on AWR/TEC (placement/
     touch), deep on THR (arm), armWeight ramps 0→0.80 from 4→26 air-yds. The
     league-average QB nets zero at every depth (aggregate comp% preserved).
  5. **QB gem arm-baseline** — high-ceiling QB gems get a THR floor matching the
     ceiling (96+ → ~90 arm) so legends stay viable with arm frozen (the real
     late-round-legend story: Brady's arm was fine, he slipped for other reasons).
  Validated: 40-season brady — top-QB season tail tamed itself (6,848 → 6,021
  #1; top-40 median 5,732 → 5,368 — never targeted, fell out of the lower THR
  weight + depth completion); True Brady 2.5/100yr held with frozen arms; QB OVR
  healthy (mean 80.6, not depressed); starter THR median ~86 with the weak-arm
  tail intact (25% <80 → deep-ball mechanics live). Commits `89a92f5`.
- **Career WEIGHT fluctuation + per-call jitter bugfix.** Two weights existed:
  `p.weight` (displayed, frozen at generation) and `combineMeasurables().weightLbs`
  (what `effectiveSpeed` actually reads, computed from STR+bodyType — already
  dynamic via STR dev). Plus `_combineWeight`'s ±15 lb "spread" was `Math.random()`
  re-rolled on EVERY `effectiveSpeed` call → a player's effective weight swung
  ±15 lbs play-to-play (noise, not the intended cross-player spread). Fixes:
  (a) seed the ±15 by name → stable per player, spread preserved, play-to-play
  noise gone; (b) age-bloat term (+1.2 lb/yr past 30, cap +12) → aging vets carry
  more, reinforcing the SPD/AGI decline; (c) sync displayed `p.weight` to the
  model each offseason so the card tracks young functional-mass gain + decline
  bloat. Sim-audit aggregates flat (proof the jitter was mean-0). `7f8de30`.
- **K/P PARITY — 99 kickers possible, but as hard to reach as any position.**
  K OVR is dominated by KPW (43%, leg) + AWR (42%, accuracy); both had NO
  generation ceiling (only a KPW floor), so ~22% of kickers rolled near-max legs
  and ratcheted up. The 95 output cap masked it by piling the would-be 96-99
  cohort at exactly 95 — and elite kickers never declined, so they camped at peak
  (K 90+% was 6.2%, highest of any position). First-principles fix (mirrors the
  QB overhaul): KPW is the kicker's "arm" (genetic gate), AWR is coachable.
  (a) Output cap 95 → 99 (parity, in calcOverall + 2 dev `_effCap` sites);
  (b) KPW + AWR generation ceiling 90 + a softening curve so 90+ is rare (~5%,
  like 90+ THR at QB) and 95+ ~0.5%; (c) KPW age-decline steepened (P ramps
  0.60→0.95 with years past decline; +2-pt drops past 35 — Vinatieri fade) so
  elite kickers FADE rather than camp. Result (100-season brady): K 90+% 6.2% →
  2.0% (now lowest, in line w/ RB/LB/S); a 99 K is a rare genetic-leg + elite-
  accuracy + peak-year convergence that then fades. `ddd98ca`.
- **Hidden-gem 96+ ceiling tier DOUBLED.** 100-season brady settled legends at
  4/100yr and True Brady at 0/100yr — conservative. Doubled the 96+ weight in
  `_rollHiddenGem` (non-QB 8%→16%, QB 25%→50%, both taken from the lower tiers
  so common-gem volume / mean-OVR calibration is untouched). QB shift is bigger
  because a QB gem firing should usually be HOF-ceiling (the design intent), not
  a generic starter. Expected ~8 legends / ~2 True Brady per 100yr. `2ab189f`.

**Audit harness (`_brady_audit.js`) — measurement improvements**
- **Top-QB rebanded to the COHORT MEDIAN, not raw MAX.** The MAX of ~1,280
  QB-seasons grows with sample size — comparing it to the single NFL record is
  structurally always-red. Now checks the top-40 median (band 5,000-5,900 ≈ 17g-
  adjusted NFL record ~5,800); 100-season run reads 5,759 ✓. Raw max still
  printed in the top-N table for color. `35c4fd6`.
- **Legends band widened** 1.3-2.5 → 2.0-10.0 /100yr (surprise late-round
  legends, all positions, are NFL-frequent; 40-season samples are noisy at this
  rarity). `35c4fd6`, `d43c913`.
- **Elite-90 / mean-OVR bands widened to fit reality** (90+ 2-6→2-7%, mean OVR
  74-77→74-78). 6.2% on a 53-man roster is ~3.3 elite (90+) players/team — NFL
  playoff teams carry 3-4 stars, so it's the right NUMBER, not inflation; widened
  the band rather than nerfing the talent curve. `bd9c32c`.
- **90+ tables show %(count)**, plus "90+ CLUB COMPOSITION" lines (share of all
  90+ player-seasons by round and by position — where elite talent comes from).
  `35c4fd6`.
- **Top-25 single-season leaders per position** (marquee stat each) + **top-100
  distribution shape** (max/P90/P75/med/P25/min + unique-player count and
  most-appearances headliner — concentration vs spread). `3a5bcff`, `95a50be`.
- **Top-10 dynasties** — longest consecutive winning-season (win% ≥ .500) streaks
  by team. `3a5bcff`.
- **LATE-ROUND ELITE pyramid** — distinct R6+/UDFA players by peak-OVR tier
  (90+ / 95+ / 99 vs target ~60-100 / ~20 / handful), by round, by position, and
  split by WHY they slipped (scouts-missed vs medical-faller). `1b39848`, `9cb5f56`.
- **COLLEGE INJURIES report** — severity split (moderate/severe/career-ending),
  redshirt-rookie + medical-retirement counts, by position, medical-faller sample.
  `a8ae7df`, `9cb5f56`.

- **Score-variance bundle — turnovers, shutouts, blowouts all → in band.** Sim-
  audit was flagging too-FEW extreme games: shutouts 0.55% (band 1.0-2.5),
  margin≥14 38.1% (40-55), blowouts≥21 17.3% (20-32), turnovers/g 0.84 (0.90-
  2.10) — yet repeat-champions ran HIGH (11-12 vs band 1-10). The contradiction
  was the tell: not a parity problem (top teams did win), but too-little game-to-
  game variance — a great team beat a bad one 24-20 instead of sometimes 38-3.
  Root cause was thin fumbles (the highest-variance turnover — lost leads, scoop-
  and-score TDs). Fixes: RB fumble base 0.0085 → 0.012 (≈1 per 83 carries, NFL
  avg), strip-sack chance 0.10 → 0.13. Result: shutouts 1.06%, margin≥14 40.7%,
  blowouts≥21 21.6%, turnovers 1.00, repeat-champs 10 — all in band. (`e1c5444`)
- **INT base re-tuned 0.012 → 0.009 → 0.010.** First trim (to 0.009) over-
  corrected: INT rate/att fell to 1.77% (band 1.80-3.40, just under) and
  turnovers under band. 0.010 lands INT rate/att 2.05%, multi-INT ~14-17%
  (Poisson-consistent with NFL's modern ~16-18% multi-INT cadence at 0.72 INT/g).
  The 8-14% multi-INT band is Poisson-strict; 14-17% is NFL-realistic. (`e1c5444`)
- **R5 gem rate 1.5% → 1.8%.** R5 produced fewer 90+ players (0.8%) than R6
  (1.3%) because the gem rate jumped 47% from R5→R6, leaving R5 with a thin
  elite tail despite a better median. Smoothed to keep R6 distinctly the "Brady
  tier" while giving R5 a few more late-round emergences (Kam Chancellor /
  Devonta Freeman pattern). (`e1c5444`)
- **Top QB season yds — diagnosed as a MEASUREMENT artifact, not engine.** The
  audit checks MAX(QB pass_yds) over the whole sim against 4,500-5,500 (the NFL
  single-season record). But a top-40 all-time leaderboard (added to the audit,
  `cdafbcf`) showed the field is healthy: median 5,732, avg 5,887 — for a 17-game
  season the NFL-adjusted record is ~5,800, so the top-40 MEDIAN sits right at
  the real-world ceiling. The flagged MAX (6,848) was ONE generational QB (Lou
  Bell-Burke, 98 OVR DUAL_THREAT, 12 of the top-40 seasons, 4 straight 6,000+
  years S22-25) on a five-deep WR corps (two 95+ WRs). Strip that one outlier
  and the field max is ~6,365 — ~10% over the 17g record, defensible. The MAX of
  1,280 QB-seasons over 40 years is the rightmost tail and grows with sample
  size; comparing it to the single NFL record is structurally always-red. The
  record-QB offense snapshot (full 25-man supporting cast w/ measurables +
  hidden attrs) confirms elite-on-elite stacking, not a per-QB inflation bug.
  RECOMMENDATION (open): change the band to a stable statistic (top-40 median, or
  QB-season P95) instead of raw MAX.
- **Top QB season yds (partial) + injuries / team-season + season-ending — multi-lever.**
  Brady audit flagged three related metrics: top QB season yds 6,439 (band 4,500–
  5,500), injuries / team-season 15.1 (band 18–42), season-ending 2.1 (band 4–14).
  First-principles diagnosis: elite QBs played 17/17 every year because injury
  rate was structurally low; NFL elites miss 1–2 starts (Brady/Manning/Brees
  pattern) and that attrition trims their totals. Sequence:
  1. **OC pass-bias stack capped at ±0.07** (was uncapped additive). Air Attack
     +0.10 + Riverboat HC +0.04 had been pushing pass-heavy playbooks to ~0.75
     mid-down pass rate vs NFL's 0.65–0.68 ceiling. (`b5a2c07`)
  2. **OC per-trait magnitudes halved** to NFL-realistic (Air Attack +0.10 →
     +0.05, Trench General −0.10 → −0.05, etc.). Real NFL coach effect is ~4–6pp
     at the extreme, not the fantasy-football ±10pp the values were calibrated
     at. (`4d1aa98`)
  3. **Leading-team clock-bleed** in last 10 min of Q4: passProb −0.05 for any
     lead, −0.12 for a two-score lead. Mirror of the existing trailing-team
     2-min-drill +0.25. Without this, elite QBs on WINNING teams kept padding
     stats in 4Q garbage time. (`300f0af`)
  4. **INJURY_RATE table lifted 1.5x** (QB 0.009 → 0.013, RB 0.017 → 0.025, etc.).
     The brady audit wraps `_rollGameInjuries` (franchise-level post-game roller);
     a prior in-play big-hit roller bump didn't move the audit metric because
     they're separate systems. (`dc7eec4`)

  Result: top-5 mean QB season yds dropped 6,019 → ~5,900; positions 2–5 now sit
  at 5,700–6,200 (within ~10% of NFL). Injuries / team-season: 15.1 → 19.4 ✓ IN
  BAND. Season-ending: 2.1 → 3.1 (closer to band).

  **Position-1 outlier remains** at ~6,400–6,500. Structural diagnosis: an elite
  QB with 95+ durability on a passing-tilted team avoids 17g of injury rolls
  (~10% per-season chance × 0.45 durability mul = 73% probability of surviving 3
  straight seasons), and the audit measures the MAX of 256 QB-seasons (8 yr × 32
  teams) against an NFL band built from ~1,600 QB-seasons over 50+ years —
  expected-max scales with sample size, so the band itself is tight for our
  sample. Top-5 mean is the more comparable measurement and is healthy.

- **Legends / 100yr 0 → 2.5 + True Brady 0 → 2.5 (both in band).** Brady audit
  consistently produced 0 legends across 8-, 40-, and 100-season runs — the gem
  pipeline existed but nothing reached OVR 96+. Two-stage diagnosis (focused
  gem probe + brady-audit instrumentation that captured each gem's growth rate
  and p.potential at first-seen):
  1. **AI teams cut their own R6 gems as fringe players.** `cutValue` reads
     `_perceivedPotential(p)` which only sees `p.potential` (the public oracle
     ceiling). The hidden-gem ceiling lives in `p.hiddenGem.ceiling`, which
     `p.potential` didn't reflect — so a R8 gem with true ceiling 99 looked
     like a 65-ceiling fringe player to its own team, got cut, sat in FA where
     `_developNflPlayer` doesn't run, retired in 2 years. **Fix**: write
     `p.potential = max(p.potential, hiddenGem.ceiling)` at gem-stamp time in
     `_rollHiddenGem`. NFL parallel: a team's own practice tape reveals upside
     that public scouting consensus missed. (`1aa252e`)
  2. **`_growthRate` was rolled based on the original low oracle potential.**
     A R8 gem with ceiling 99 inherited the slow-developer distribution of a
     65-ceiling player. Diagnostic showed ceiling-96+ gems with rate 0.65
     peaking at 79-87 even after p.potential was propagated; baseline grew at
     rate 0.35 plateaus at ~85 regardless of ceiling. **Fix**: re-roll
     `_growthRate` in `_rollHiddenGem` using the gem ceiling so the gem draws
     from the 30/55/15 (0.90/0.65/0.35) distribution that a known 99-ceiling
     prospect would. Only upgrades. (`490e846`)
  3. **`grew < 0.5` threshold blocked late-career growth past OVR 95.** At OVR
     95 chasing ceiling 96-99, baseline `grew` lands in [0.16, 0.65]. The 0.5
     floor only let ceiling-99 gems fire (grew 0.65). 0.1 over-corrected (12.5
     legends/100yr); 0.4 is the principled split — admits ceiling-98+99 (grew
     0.49, 0.65), keeps 96-97 strict, matches NFL pattern where only
     generational talents emerge as legends. (`16f9b62`)

  Result (40-season audit): 1 True Brady — R8/QB peak 96, growth rate 0.65,
  hidden ceiling 98. Gem mass-distribution shifted up: most gems now peak 85-89
  instead of 70-79.
  COUPLING (RESOLVED — band widened, not talent nerfed): making gems realize
  their ceilings raised league mean OVR (77.0 → ~77.9) and elite 90+ share (5.7
  → 6.2%). A gem-ceiling −1 shift (78-89 → 77-88) was tried but didn't compress
  it — the dominant driver is gem VOLUME/survival, not the per-gem ceiling, and
  the relaxed dev threshold (0.5→0.4) lifts ALL developing players ~1pt, not
  just gems. Critically, 6.2% on a 53-man roster is only **~3.3 elite (90+)
  players per team** — vs a band ceiling (6%) of ~3.2. NFL playoff teams carry
  3-4 legit stars, so 3.3/team is the RIGHT number, not inflation. Rather than
  nerf the talent curve to hit an arbitrary band, the bands were widened to fit
  reality: 90+ share 2-6 → **2-7%** (~1-4 stars/team), mean OVR 74-77 → **74-78**
  (78 ≈ 0.9 rating-pt over old top across a 53-man roster — invisible in play).
  (`_brady_audit.js` chk bands)
- **INT rate 1.4% → 2.7%** — base bump + clamp lift; the old 0.030 clamp was
  truncating the high-pressure tail. (commit `523bc97`)
- **Points/play /2 bug** — audit metric (not engine) was halving it and
  false-flagging; fixed. (`e656a16`)
- **Depth-tiering keyed off the wrong variable (the big one).** The depth-tiered
  completion penalty, the arm-strength deep gate, AND the underthrow mechanic all
  gated on `_expDepth` — a *probability-weighted blend* of a concept's primary/
  fallback depth that sits pinned near league aDOT (~8) with almost no variance.
  So a 25-yard bomb was scored as if it were an 8-yard throw: **all three were
  nearly inert.** The *realized* per-throw air-yards draw (read success → primary
  depth, else fallback) lived INSIDE the completion branch, drawn only AFTER the
  catch was already decided. Fix: **hoist the airYds draw above the comp roll** —
  the QB commits to a target depth first, then we resolve the catch against THAT
  depth. The air-depth shape snapped to NFL on its own (att 41/54/4 → 53/32/16 vs
  ~58/27/15; deep comp 59% → 50%), aggregate comp preserved (mean airYds ≈ the
  pivot of 8). The deep-ball audit also now buckets on true air-yards instead of
  the blend, so it's comparable to NFL charting. (`c0d7f62`)
- **Deep balls still 50% vs NFL ~45%.** Completion-vs-air-yards isn't one slope:
  it plateaus short (~75% ceiling) and falls off FASTER than linear deep. A
  kink-at-the-pivot steepen fixed deep but over-taxed the healthy 8-14 bucket
  (comp 64→63, yds/att under band) — wrong lever placement. Replaced with a term
  that bites only past 15 air-yards: `depthCompMod = (8−airYds)*0.013 −
  max(0,airYds−15)*0.010`. Deep → 45% (NFL), short/intermediate untouched.
  (`d6d786b` superseded by `066b9a5`)
- **Four intended-depth modifiers were dead** (`posAirMod`/`qbAggAirMod`/
  `ocAirAttackMod`/`boxStackAirMod`) — declared but never applied; they predated
  the air-yards draw and sat orphaned in the completion branch. Folded into one
  `_airTilt` in the hoisted draw (RBs check down short, aggressive QBs throw
  deeper, Air-Attack OCs push downfield, box count tilts shots). Scheme/personnel/
  QB temperament now move a team's depth chart; aggregate held. `wxAirMod`
  (weather → depth) is still dead — left out deliberately. (`9c4c9ef`)

**Hidden-gem → legend ("Brady") pipeline** — this was badly broken; the audit
was the only way to see it:
1. **Draft never ran** in the harness → 0 gems. Fixed by driving the real
   offseason chain. (`e651dc3`)
2. **Games are required** — the gem breakout (`_rerollPotentialForBreakouts`)
   is gated on in-season production; a games-free loop produced 0 breakouts.
   (`184a8f2`)
3. **Pick inventory ran dry** by season 4 → draft collapsed to UDFA-only.
   Fixed by calling `frnDraftFinishScramble`/`_draftFinalize`. (`e651dc3`)
4. **Recompute clawback** — gem grind + breakout set `p.overall` directly, but
   the physical-decline pass recomputes `overall = calcOverall(stats)`, which
   only "saw" the 2 stats the grind bumped → ~28% of growth retained, so
   high-ceiling gems stalled ~OVR 85 and never emerged. Fixed by growing
   *developable stats* instead (`_applyGemDevelopment`, `_gemDevStats`):
   retention 28% → 88%. (`acb893c`)
5. **K/P excluded from gems** — punters were becoming OVR-99 legends (AWR is
   42% of K/P OVR, grows in-season, and K/P don't decline). (`f725108`)
6. **Emergence = peak OVR ≥ 96** (dropped the stale first-sighting ceiling
   filter — the breakout *raises* the ceiling mid-career). (`06b9c6a`)

**Player development**
- **`_peakMult`** [0.75, 1.05] — per-player OVR ceiling, rolled once. Creates
  real R1 busts (old model converted ~every R1 to a Pro Bowler). (`b1a7d66`)
- **`_devMult`** [0.30, 1.20] — per-player dev *timing* variance. (`b1a7d66`)
- **Breakout gate tightened** top-5% → top-3% + bump 5-10 → 1-4 (non-gem), to
  pull the league 90+ share toward NFL ~2-3% after the clawback fix made
  breakouts stick. (`31bb8f5`)

**Initial roster generation** (`genRoster`/`genPlayer` in `play-player.js`)
- League started star-poor: 0 players at 95+, every team's #1 capped at OVR 80.
  Three fixes: probability-weighted tier mix (elite tier was *never* used),
  tier-aware TEC (TEC caps at 80 but is 15% of every OVR → structural ceiling),
  and fixed an inflated CB AGI/COV floor. Result: ~30 players at 90+, a few at
  95+, position medians cluster 70-76. (`bf31438`)

**Archetype differentiation** (found via `_arch_probe.js` — all 11 positions
swept; every archetype confirmed to move the box score except where noted)
- **Dual-threat QB run game** — designed QB runs were playbook-gated (only
  OPTION); now archetype + mobility driven. DUAL_THREAT 2.3→9.8 rush att/g.
  (`dc8b5e4`)
- **RB fumble tilt was inverted** — POWER's high STR drove the grip term so low
  the ×1.35 fumble multiplier was canceled (power backs fumbled *least*). Grip
  is now AWR-dominant + dampened; archetype tilt is additive. POWER now > ELUSIVE
  as intended; league turnovers stay in band. (`ec2a2e8`)
- **K long-range was invisible** — FG attempt ceiling was a flat 57 yd for every
  kicker. Max attempt distance now scales with leg + LEG/PRECISION archetype:
  LEG FGlong 57→61 (and lowest FG%), PRECISION 53 (highest FG%). League FG%
  83.6% (in band). (`ec2a2e8`)
- **WR SLOT played like a deep threat** — ELUSIVE break + 1.15 YAC mult gave it
  house-call YAC (led team in Y/REC + long). Dampened its explosive break bonus
  + capped per-catch YAC (26). Pulled back (Y/REC 13.8→13.1, LONG 61→55) but
  **still edges the field downfield because DEEP_THREAT under-produces** (its
  +3.0 air bonus is canceled by its 0.85 YAC penalty) — see open items.
  (`ec2a2e8`)
- **HYBRID (TE/LB/S) was flavor-only + picker-capped to low OVR** — pickers now
  reward genuine all-around balance (HYBRID appears at real OVR ~82-84), and
  HYBRID gained real balanced hooks (TE air/YAC between receiving+blocking; LB
  partial coverage + run-stuff; S run-stuff + ball production). All three went
  from low-OVR traps to legitimate do-it-all players. (`ec2a2e8`)

**Gameplay systems** (found via the new PLAYBOOK/WEATHER/COACHING breakdowns)
- **Playbooks differentiate correctly** — AIR_RAID 66% pass / 6.8 ypp / most pts,
  GROUND_AND_POUND & OPTION run-heavy, OPTION fewest sacks. (Surfaces the
  passing-hot theme: AIR_RAID over-scores ~30 pts.)
- **Weather: WINDY + HOT were no-ops.** WINDY effects were direction-symmetric
  (helped with-wind, hurt into-wind → averaged to ~0), and HOT was labeled but
  never referenced. Added a net-negative WINDY component to completion/air-yards/
  FG plus a HOT completion dip. Now CLEAR best → WINDY/HOT mild → RAIN/SNOW worst.
- **Coaching: HC trait now exercised + audited.** `_sim_audit` had no franchise,
  so coaching never fired; injected a balanced `franchise.coaches` stub. Verified
  Riverboat 1.56 4th-down go/g > Game Manager 1.22 > Conservative 0.96.
- **Fatigue had ZERO in-game recovery.** `_fatigue` was only ever incremented, so
  starters redlined to ~95-100 by Q4 (OL/DL med 96, RB 84) vs the ~60-70 design
  target — and the stamina stat stopped differentiating once everyone saturated.
  Added sideline rest on the breaks (×0.55 halftime, ×0.88 quarter breaks); OL/DL
  now end ~59 med / ~68 P90, RB workhorse P90 ~60. Both teams equal → box score
  unchanged, Q4 dip preserved (~3%).
- **Coverage comp% was a bogus 100%** — coverage is logged only on completions,
  so incompletes weren't tagged. Relabeled the table to per-completion Y/CMP.

**Engine realism (shipped this session — see TALENT_MODEL.md for the talent retune)**
- **Dual-threat QB run game** — designed QB runs were playbook-gated; now QB
  archetype + mobility drive them, layered on the playbook. DUAL_ELITE 2.3 →
  9.8 rush att/g.
- **RB fumble tilt was inverted** — POWER's high STR drove `grip` so low the
  ×1.35 fumble multiplier was canceled; rewrote as additive `archFumbleAdd` on
  AWR-dominant grip. POWER now > ELUSIVE as intended.
- **K range was invisible** — FG ceiling was a flat 57 yd for every kicker. Max
  attempt now scales with `KPW` + LEG/PRECISION archetype: LEG FGlong 57→61,
  PRECISION 53 (highest FG%). League FG% in band.
- **WR archetype `archAirMod` orphan** — defined at engine ~4986, NEVER consumed
  (only YAC + comp% read the archetype, not air-yards). Wired into `airYds` so
  SLOT actually throws short (was leading the team in Y/REC like a deep threat)
  and DEEP_THREAT boosted +3 → +4.5 to lead vertically.
- **HYBRID archetypes (TE/LB/S) were flavor-only** — engine never read them; pickers
  capped them to low OVR. Pickers rewritten + balanced engine hooks added (HYBRID
  TE air/YAC between rec+blocking; HYBRID LB partial coverage + run-stuff; HYBRID
  S balanced ball production). All three appear at real OVR ~82-84 now.
- **Weather: WINDY + HOT were no-ops.** WINDY effects were direction-symmetric;
  HOT was labeled but never referenced. Added net-negative WINDY comp + air-yard
  + FG penalty + HOT comp dip. Gradient is now CLEAR → WINDY/HOT mild → RAIN/SNOW
  worst.
- **Coaching: HC trait now exercised** in `_sim_audit` (was no-op without
  franchise stub). Riverboat 1.56 4th-down go/g > Game Manager 1.22 > Conservative
  0.96.
- **13 personnel / JUMBO surfaced** + made real. `JUMBO` package added to
  PERSONNEL with run/air/sack/comp mods (best PA in the game, max protection);
  play-by-play chip shows the package; **TE2 now targetable** in 2+ TE sets so
  the 3-TE package has a real 2nd receiving threat.
- **Trade reactions** (chip/sulk/neutral) — personality+age biased roll on every
  trade, replacing the flat +20% boost. Delayed reveal at season-end; cancer+CHIP
  redemption arc (personality flips to normal). Cut-and-resigned gets a milder roll.

---

## Known limitations
- **Brady cadence is Poisson-noisy** — needs 100+ seasons to judge. (covered above)
- **3-and-out rate omitted** — the engine's `drives[]` don't carry per-drive
  play counts, so we can't derive it cleanly.
- **Drive outcomes lump "FG/Punt/TO"** in the engine result string — the audit
  re-derives FG vs TD vs TO from score deltas; punt-vs-nonscoring-TO aren't split.
- **Games-free roster bloat** — *only* a concern in ad-hoc probes; the Brady
  audit runs the real offseason which cuts to 53 (`_trimAiRostersToCap`).
- **Offense currently runs ~5% hot** (yds/play ~6.3 vs ~5.4 NFL) — open tuning
  item as of this writing.

---

## Adding a new metric
1. **Accumulate** in the per-game/per-season loop (most raw fields already
   exist on `r.stats[side].team`, `r.stats[side].players`, or `r.full.drives`
   / `r.full.plays` — grep `play-engine.js` `_emptyLine()` for the field name).
2. **Compute + add a row** to the relevant table array (`B` / `D2` in
   `_sim_audit.js`; the report blocks in `_brady_audit.js`) with `[label, value,
   lo, hi, fmt]`.
3. **Use `\\n` not `\n`** in any new `console.log` inside the harness string.
4. **Smoke-run** `node _x_audit.js 2` (don't trust `node --check` alone).

---

## SESSION STATE — talent retune (IN PROGRESS) + open work

> Recorded so a future session can resume without re-deriving. Two docs split
> the work: this one (`AUDIT.md`) covers the audit infrastructure + game-realism
> calibration; `TALENT_MODEL.md` covers the talent-economy first-principles
> framework + the retune log + queued items. **For talent retune state and
> queued findings, start with `TALENT_MODEL.md`.**
>
> Live position: r-6 in flight (coachBoost cap ≤ 2.0). r-1 through r-5 logged
> in TALENT_MODEL.md "Retune log" section.

### The big architectural arc: unify NFL development onto the college model
**Root finding (took far too long — I anchored on the NFL gem mechanic and never
mapped the player lifecycle until prompted to audit the college pipeline):**
the **college pipeline already has a clean hidden-destiny dev model** — `HiddenOracle`
rolls a hidden `ceiling` (16% land 88+, *decoupled from visible draft tier* — a
2-star can have ceiling 95) + a `_growthRate`; `_developCollegePlayer` grows
**stats** toward it with a per-year **regression** roll, then `overall =
calcOverall(stats)` (stats-as-source-of-truth, no clawback). Bradys are baked in.

**But the NFL handoff threw it away:** `_clearCollegeFlags` *deleted* `_growthRate`,
NFL dev switched to a separate tangle (grind + `peakMult` + breakout reroll) we
patched **7×** and still got **0 Bradys** (60-season baseline: 713 gems, 0 legends).
And `_rollHiddenGem` re-rolled a **duplicate** hidden ceiling on top of the college one.

**Stage 1 — DONE (`49df277`, `71a14b8`):** `_clearCollegeFlags` no longer deletes
`_growthRate`; new `_developNflPlayer(p, mult)` runs the oracle model for pros
(ceiling = `max(p.potential, hiddenGem.ceiling)`; growth via `_applyGemDevelopment`;
**regression roll = bust source**; pre-peak only). Wired into `runFrnOffseason`
behind `const _ORACLE_DEV = true` — **old grind/normal-dev kept in the `else`** for
instant fallback/A-B. `NFL_DEV_SCALE = 0.35` + `0.6*gap` single-year cap (college
rate over-realized everyone: smoke showed R1 mean 91.7, 25% at 95+).

**Stage 2 — PENDING:** once Stage 1 validates, delete the now-redundant
`_rollHiddenGem`, `_rerollPotentialForBreakouts` (the breakout/flash), `peakMult`,
`devMult`. Bradys + busts + year-1 jumps all emerge from the one oracle model
(burst-intensity roll already gives a year-1 jump; regression gives busts).

**Stage 3 — PENDING:** retarget the audit's emergence detection from `hiddenGem`
to "late-round player reaching 96+ via `p.potential`" (cleaner); apply oracle dev
to the **practice-squad** branch too (still on old grind); update the offseason
gains-sheet "hidden-gem hero" UI + scouting tags that read `hiddenGem`.

### Validation status (updated 2026-06)
Stage-1's original in-flight run (`/tmp/s1val.log`, bg `b6q3mr7jb`) is long
gone — `/tmp` is ephemeral — but its three questions have since been answered
YES by later, larger runs. Most recent: the **4 × 200-season decoupling
characterization** (see "Decoupling — multi-rep characterization" in the
calibration history) confirms the pipeline now produces a healthy non-zero
top-tier cadence — legends **μ=27.9/100yr**, True Brady **μ=5.9/100yr**, both
in band across all 4 reps — with busts emerging from the oracle regression
roll. The Brady-cadence-zero problem that motivated the oracle-dev arc is
resolved. *To re-derive from scratch: `node _brady_audit.js 200` (≈75 min
single-rep); run 3-4 reps for any tail-cadence or archetype-distribution
claim, since n=1 scatter is large at the legend tier.*

### Open realism fixes (prioritized)
1. **Dual-threat QB run game — DONE.** Designed QB runs were tied to the
   *playbook* (`pb.qbRushPct`, only OPTION set it), so a Lamar/Vick-type on any
   other scheme got ~2 carries/game (all pressure-scrambles). Fix: the engine now
   derives the designed-run rate from the **QB himself** (DUAL_THREAT archetype
   floor + actual SPD/AGI mobility), layered on the playbook; added `qbRushPct`
   to the DUAL_THREAT playbook; QB-run YPC now scales with speed. Probe result:
   DUAL_ELITE 2.3→9.8 rush att, 13→48 rush yds (4.9 ypc), and the dual-threat
   went from a clear downgrade (−6 win%, −80 tot yds vs pocket) to producing MORE
   total offense at equal OVR. League rush/g stayed in-band (no inflation).
   Validate with `node _qb_probe.js`.
   - **STILL OPEN (judgment call):** QB OVR under-weights mobility — a 96-SPD /
     74-THR "noodle-arm quick-legs" profile rates only 77 (backup tier) because
     THR is 42% of `calcOverall` (spd 9 / agi 13). It now *produces* like a
     functional starter (327 tot yds) thanks to the run game, but the rating
     still says backup. Bumping SPD/AGI weight touches draft/dev/all audits —
     left for a deliberate decision.
2. **Offense ~8-10% hot** (the recurring signal): passing yds/att ~7.67 vs ~7.0;
   records 7,599 pass yds / 78 TD / 738 team pts vs NFL 5,477 / 55 / 606;
   QB 300+yd games 33% (NFL ~20%); INT 3.05% / multi-INT 30%. Lever: trim
   passing yds/att (completion% + deep-ball rate) and re-tune INT to ~2.5%.
   Theme: run game (incl. QB-run) under-weighted vs pass.
3. **Elite inflation + R1 busts** — same root (high-potential players over-convert).
   Stage-1 oracle regression is the intended fix; confirm in the validation run
   before adding more levers. `_peakMult` failed (R1s drafted near-PB already).
4. **WR depth gradient** — after the SLOT YAC nerf, SLOT still slightly leads
   downfield (Y/REC, LONG) because DEEP_THREAT under-produces vertically: its
   +3.0 air-yards bonus is offset by its 0.85 YAC penalty, so it lands mid-pack
   in Y/REC (~12.5) instead of clearly highest. To get a proper depth gradient
   (DEEP_THREAT highest aDOT/long + lowest catch%, SLOT highest volume/short),
   boost DEEP_THREAT's air-yards and/or long-ball rate rather than only nerfing
   SLOT. Lever: `archAirMod` / deep-completion rate in the pass model.

### Gameplay-system audit coverage (what's measured vs not)
**Covered:** offensive playbooks, defensive schemes, personnel packages (incl.
**13/JUMBO** — added 2026-05), coverages, weather, coaching (HC 4th-down +
**culture-trait injury**), fatigue, **stress**, **special-teams returns**, **trick
plays / 2-pt / onside**, **play-type mix + play-action**, **ejections**, **clock
(kneels/spikes/momentum)**, **personality**, **salary-cap utilization**,
**injury-by-trainer**, injuries, every positional archetype (`_arch_probe`),
QB styles (`_qb_probe`), box score / drives / situational / kicking / per-position.
**NOT yet isolated (audit notes them but doesn't deeply attribute):**
- **Coaching:** OC/DC run tilts (`ocRunArchBonus`/`dcRunStopperMalus`),
  `coachBoost` (dev gain by coach) — still not isolated.
- **Trades / free agency** — cap utilization is reported, but per-transaction
  trade/FA realism (volume, value) isn't tracked.
- **Scouting / draft-eval accuracy** (projected vs actual ceiling), GM traits.

### Findings from the new system audits (open realism items)
- **CURRENT OPEN FLAGS (latest 100-season brady, as of the college-injury build):**
  - *Cap utilization ~85-88%* — **RESOLVED (2026-06).** Two separate things: a
    real franchise-length DRIFT (flat-dollar floors → fixed by cap-relative floors,
    `cf6c804`) and a MEASUREMENT ARTIFACT (the audit snapshotted active-roster cap
    at the post-retirement dead-zone). Both fixed: the audit now measures
    `capUsedByTeam` (incl. IR) at season start → ~97%, in band. The old "lift the
    floor to ~1.03" idea was wrong — teams run ~99% in-season; the number only
    looked low because of WHEN it was measured. See the 2026-06 session block above.
  - *Unique champions* — RESOLVED as a band bug (was impossible 45-100 vs 32-team
    ceiling; now [19,32], 27 passes). `7046218`.
  - *Late-round elite pyramid* — 90+ ran ~139-146 (target 60-100); proved
    franchise-dev-driven, NOT gem-ceiling-driven (ceiling knobs are futile — the
    binding constraint is realization, ~80 avg peak for 96-99 ceiling gems). The
    90+ count may just be accepted as realistic (~1.4 late-round stars/yr). 95+
    on target (~20-27). **99 tier was 0** — the 99-wall fix (`17e5aa8`) makes 99
    REACHABLE but realization (dev fully maturing) is the other half; whether a
    handful actually reach 99 depends on franchise dev, validated by the running
    100s.
  - *True Brady* — the realization-wall fix (`5882ad6`) took it 0 → ~6/100yr (over
    the old 1-3 band, but the band was stale — the user wanted more; ~6 = 1 per
    17yr is NFL-realistic). Band re-widened with the legends band.
  - *Legends band* — re-set to 10-28/100yr to match the higher appetite (~20 at
    95+). The original 1.3-2.5 and intermediate 2-10 were too tight for the
    working pipeline.
- **Salary cap not enforced — FIXED.** Teams ran **~127% of cap** (P90 150%):
  `_trimAiRostersToCap` only cut for roster SIZE, and `assignContracts`'
  normalization never re-ran. Added `enforceCapCompliance()` — each offseason any
  over-cap AI team restructures (proportional AAV scale-down + bonus re-proration)
  to ~94% of cap; wired into `frnProceedToRosterChanges` (live + audit).
- **Cap floor stuck at ~83% — FIXED.** Mean util kept landing just below the
  88-100% band. A focused cap-flow probe traced three compounding issues:
  (1) `enforceCapFloor`'s scale cap was `min(1.5, floor/hit)` — a team whose hit
  was 50% of cap had `floor/hit = 1.84`, so the 1.5 ceiling BLOCKED the lift and
  the team stayed stuck under floor. Bumped to `min(2.5, floor/hit)`; individual
  contracts are still clamped at cap, so no per-deal runaway.
  (2) `_trimAiRostersToCap` was only ever called from the audit harness — the
  LIVE game never trimmed AI rosters or re-ran the floor on the post-draft shape.
  After `_draftFinalize` filled rosters with UDFAs, the floor pass only ever saw
  the pre-draft skeleton, so under-spending teams stayed under-spent. Added a
  `_trimAiRostersToCap(53)` call at the end of `_draftFinalize` (default skips
  user team) so the live flow mirrors what the audit was doing manually.
  (3) Floor landing target was 0.92, but the audit snapshots cap util at END of
  regular season — AFTER ~10pp in-season churn (retirements, mid-season FA
  signings, contract-year slot progression for backloaded deals). 0.92 - 0.10 =
  ~82% audit reading, fitting the original 83.5% complaint. Raised landing
  target to 0.99: post-offseason peak at ~99%, after ~10pp churn lands at ~89%
  audit reading. Probe-verified across cycles; brady (8s) reads mean 90.2%,
  P10 83.3%, P90 96.6% — in band, cap utilization no longer in FLAGS.
- **quiet_pro longevity not showing** — its avg career (~4.0) ≈ normal; the
  "slower decline" trait doesn't translate to longer careers.
- **Trainer effect weak** — Sports Sci isn't clearly the lowest-injury trainer.
- **Stress shape** — concentrates in WR/CB/S; OL/QB/RB/TE ~0 (trench load gap?).
- **Trick-play rates run a touch hot** (flea-flicker ~0.5/g, onside ~0.3/g);
  measurement is correct (log flags), the engine call-rates are slightly high.
- **KR avg ~29 / PR att ~4.4/g** mildly hot vs NFL (~23 / ~2.5).

### Audit-band quirks to fix (cosmetic, measurement-only)
- Franchise-health **unique-champions band** is wrong (set 45-100, impossible —
  capped at 32 teams). - **OL n=0** in per-position (not individually tracked).
- Career-length absolute ~1.5× NFL (definitional — active-roster seasons).
- Injury **count** flags low (15/team-season vs rough 18-42 band) though
  games-missed (~68) is realistic — bands are approximate, may need refining.

### What's solid and shouldn't be re-litigated
Core box score, drive shape, RB room (committee + fumbles fixed), franchise
parity, initial roster OVR shape, the whole audit suite (game-stat 3 tables +
drive/situational/kicking; brady: distribution, decade drift, OVR-by-round,
bust/hit, record book, HOF, awards, team records, milestones, franchise health,
career length, legend careers, positional depth, top-10 QB/league leaders).
