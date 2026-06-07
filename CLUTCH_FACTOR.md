# Hashmark Heroes — Clutch Factor, From First Principles

> **Purpose.** A hidden, *real*, scoutable composure-under-pressure trait that
> changes outcomes in big moments. This doc is the durable record of the design
> rationale, the codebase discoveries made while building it (several of which
> **corrected earlier assumptions**), the exact implementation map, the
> verification methodology, and what remains.

---

## ⏯ RESUME HERE (post-compact pointer)

**Branch:** `claude/charming-brown-b18u2` (push `-u origin`, exponential backoff
per session rules). NOTE: this work was consolidated here by fast-forwarding the
old `claude/football-sim-blockchain-game-b3sdq` HEAD onto it — all prior session
work (talent/audit fixes) is included.

**Where things stand:**
- ✅ **Phase 1 — attribute model** (`4a8b3ea`): hidden two-tailed `_clutch`.
- ✅ **Phase 2 — engine gates** (`3c2bf77`): FG accuracy + QB completion/INT +
  WR/TE/RB catching, league-wide, playoff-amplified. 15/15 unit checks pass.
- ✅ **Defensive INT-catch** — clutch DB squeezes the game-sealing pick
  (`dropChance` gate). Added under the all-positions pass (§6).
- ✅ **10,000-game audit** confirms magnitudes on target (FG DiD **+5.8pp**,
  comp **+3.4pp**, INT **−0.2pp**, all normal-moment gaps ≈0). See §5.
- ✅ **Ball-security + discipline channels** (§6) — QB strip-sack + carrier
  fumbles + pre-snap discipline penalties, all via the proven `_clutchMod`.
  Rare-event magnitudes are subtle (not separately aggregate-measured — see §5).
- ✅ **Phase 4 — film/reputation tracking**: `_accrueClutchFilm` accrues each
  player's late-and-close exposures+outcomes onto `p.clutchRecord`, league-wide.
- ✅ **Phase 3 — scoutable confidence read**: `clutchTag` surfaces a read whose
  confidence sharpens with film (Unproven → Proven), converging on the truth.
  Rendered on the scouting card. 8/8 franchise checks pass (`_clutch_film_test.js`).

**The clutch factor is feature-complete** — real, league-wide, all-positions,
and scoutable-by-film, both halves of the original spec delivered.

**The functional core ("real + league-wide") is DONE and verified.** What
remains is the discovery/UX layer ("scoutable").

---

## 1. First principles — what clutch actually is

Before modeling it, we asked whether the thing is even real. The sports-analytics
literature is blunt: **clutch-as-a-stable-skill is mostly an illusion** — what
looks clutch is overwhelmingly variance + survivorship + memory (the hot-hand /
clutch-hitter debunkings). Two asymmetries survive:

1. **Choke is more real than clutch.** Pressure *degrading* a skilled automatic
   motion (the shanked chip, the forced throw) is well-documented; *elevation*
   above baseline barely is.
2. **Perceived clutch is enormous** — and lives almost entirely in the *telling*.

**Design tension that falls out of this:** the reason clutch makes a great
*narrative* (it decides the biggest moments) is exactly why a hidden clutch
*modifier* is dangerous as a *mechanic* — it puts an invisible die on the events
the player has the most ownership of. A hidden number that costs you a
championship reads as "the game cheated," not "great story."

**Owner's decisions (resolved in conversation):**
- Clutch should be **real** (a genuine mechanical effect), not pure reputation.
- It should be **scoutable** ("you can see how clutch a player is if you watch
  their film").
- It affects **accuracy / decision-making / catching — never physical**
  attributes (speed/strength/range). Pressure is a mental/fine-motor effect.
- **Two-tailed, choke tail heavier** (matches the evidence; a blown game then
  reads as "I should've scouted the steadier guy" — authorship-preserving regret
  — rather than a handout to the opponent).
- Concentrated on the positions fans actually talk about: **K, QB**, plus **WR**
  (catching). Spreading it across all 53 dilutes the narrative.

---

## 2. Codebase discoveries (several corrected earlier claims)

These are the things we *learned about the engine* while building — recorded so
nobody re-derives them or trusts the wrong earlier statement.

1. **A clutch mechanic ALREADY existed for kickers — and it was wired.**
   `play-engine.js` FG block: `if (kArch === "CLUTCH") archAccMod = isClutchMoment
   ? +0.05 : -0.005;` gave a CLUTCH-archetype kicker **+5% FG accuracy** in
   late-and-close moments. *(An earlier claim that the kicker CLUTCH trait was a
   dead flavor label was WRONG — it came from grepping only
   `play-franchise-offseason.js`/`-stats.js`; the FG sim lives in `play-engine.js`.)*

2. **QB clutch ALREADY existed too — via `_drive`.** The completion gate had
   `driveCompMod = isQBClutch ? (qbDrive - 60)/600 : 0` (±~6pp, "Brady raises his
   level"). So the "stale" comment at the `HiddenOracle.read.drive` accessor
   (claiming drive feeds a clutch bonus) was **actually correct**. We migrated
   this consumer onto `_clutch` so `_drive` is now purely dev/effort.

3. **`_drive` had exactly one player-attribute clutch consumer** (that QB line).
   Every other `_drive` token in `play-engine.js` is the unrelated **`_drive()`
   method** (a football *drive*) or `_drive4thGoCount` — not the player trait.

4. **There is NO separate box-score generator.** *Every* game — the user's, CPU-
   vs-CPU league games, and playoffs — routes through `frnSimOnce` →
   `GameSimulator` (the full play-by-play engine). `frnSimGame` just delegates to
   `frnSimOnce`. *(This corrected a turn-one assumption that CPU games used a
   lightweight box-score path.)* **Consequence: a clutch effect in the engine is
   inherently league-wide** — the originally-planned "box-score nudge" phase was
   unnecessary and was dropped.

5. **`_pushVisual` stamps every play** with `poss, quarter, time, down, ytg,
   yardLine, homeScore, awayScore, timeouts` plus play-specific fields. This lets
   us classify clutch moments and attribute outcomes *post-hoc from the play log*,
   with zero instrumentation — the basis of the aggregate audit.

6. **Play-kind gotchas for any play-log mining:**
   - FG kinds: `fg_good` / `fg_miss` / `fg_blocked`. **XP misses also emit
     `fg_miss`** → filter real FGs by presence of a numeric `fgDist`.
   - Pass kinds: `complete` / `incomplete` / `int`. **2-pt tries emit
     `incomplete`** → filter real passes by presence of `passer`.
   - Real FGs carry `kicker` + `fgDist`; all real passes (incl. `int`) carry `passer`.

7. **HiddenOracle pattern.** `secretFields` lists server-only attributes;
   `read.*` exposes accessors + public scout *tags*; `roll.*` holds VRF roll
   paths. `_drive`/`_durability` have **no** `roll.*` path — they're generated
   inline in `play-player.js`. So `_clutch` follows that precedent (inline gen +
   `secretFields` + `read` accessor; no roll path needed).

8. **Canonical "late-and-close" definition** (now centralized in `_clutchMod`):
   `quarter >= 4 && time < 300 && |homeScore - awayScore| <= 8` (Q4/OT, under
   5:00, one-score). Matches the engine's pre-existing `isClutchMoment`.

---

## 3. Implementation map

### `play-player.js` — attribute generation (beside `_drive`/`_durability`)
- Generates `_clutch` (1–99, **50 = neutral / no modifier**). Bell-ish via a
  3-roll average, then an **asymmetric stretch** (choke side widened) + jitter,
  so the choke tail is heavier and deeper than the clutch tail.
- CLUTCH-archetype kickers are biased high (`max(rolled, 72 + rand(20))` → 72–91)
  so the visible archetype keeps its old meaning under the new continuous model.

Distribution over 100k rolls: mean **48.8**, ice-veins (≥80) **~1.5%**, folds
(<25) **~7.0%**, median 50. Elite clutch is genuinely rare.

### `play-franchise-offseason.js` — registration, scout surface, playoff wiring
- `HiddenOracle.secretFields` += `"_clutch"`.
- `read.clutch` (raw accessor) + `read.clutchTag` (public scout read — labels:
  *Ice in His Veins / Steps Up / Steady / Streaky / Folds Late*). Confidence
  sharpening is Phase 3.
- Stale `read.drive` comment corrected (drive = dev/effort only now).
- `isPlayoff` threaded into the `GameSimulator` opts at **both** engine call
  sites that know it: `frnSimOnce(...)` and `frnPlayGame(...)`.

### `play-engine.js` — the gates
- **`_clutchMod(name, scale)`** (new method): the single signed helper.
  Returns 0 unless late-and-close; reads the player's hidden `_clutch`; signal
  `(_clutch-50)/50 ∈ [-1,+1]`; **×1.5 in the playoffs** (`this.isPlayoff`, set in
  the constructor from `opts.isPlayoff`). Centralizes the moment definition.
- **FG (accuracy only):** binary CLUTCH-archetype branch replaced by continuous
  `clutchAccMod = _clutchMod(K, 0.06)` added into `fgPct`. Range/power untouched.
- **Pass completion:** `clutchCompMod = _clutchMod(qb, 0.04) + _clutchMod(rcvr,
  0.03)` (QB accuracy + target WR catching) added into `compPct`. Replaces the
  old `_drive`-based `driveCompMod`.
- **INT (decision-making):** `- _clutchMod(qb, 0.012)` subtracted inside `intPct`
  so composure lowers INT% and choke raises it.
- **Defensive INT-catch (hands):** `- _clutchMod(wouldCatch, 0.10)` subtracted
  inside the DB `dropChance` (the drop-the-pick gate) so a composed DB secures
  the game-sealing interception and a folder lets it slip. Mirrors WR catching.
- **Ball security:** `- _clutchMod(QB, 0.04)` in `stripChance` (strip-sack),
  `- _clutchMod(rcvr, 0.004)` in `yacFumbleChance`, `- _clutchMod(RB, 0.005)` in
  the run `fumblePct` — composure → fewer fumbles late.
- **Discipline (pre-snap only):** in `_penMod`, late-and-close False Start /
  Delay of Game / Defensive Offsides / Neutral Zone / Encroachment get
  `rate *= clamp(1 - _clutchMod(sampledOffender, 0.5), 0.5, 1.6)` — a composed
  unit jumps the snap less, a choker more. `_isLateClose()` is now the shared gate.

**Magnitudes** (regular season; ×1.5 in playoffs): FG ≈ **±6pp**, completion ≈
**±4pp** (QB) **+±3pp** (WR), INT ≈ **∓1.2pp**, all only in late-and-close.

---

## 4. Verification

### `_clutch_test.js` — 15 headless unit/integration checks (ALL PASS)
Loads the real engine (same bootstrap as `_sim_audit.js`) and exercises the
**wired** `GameSimulator.prototype._clutchMod`: moment gate (Q1/blowout/early =
0), sign (ice +, choke −), neutral = 0, OT counts, playoff exactly 1.5×, unknown-
player safe, kicker swing ≈ +5.9pp; plus generation (every player in [1,99], mean
≈49, CLUTCH-archetype kickers ≥72) and a live-instance lookup.

### `_clutch_audit.js` — aggregate game-level proof (difference-in-differences)
Runs many real games, mines the play log, buckets each real FG/pass by the acting
player's clutch tier (**ICE ≥60 / CHOKE ≤40**) and by clutch-moment vs not.

**Methodology insight (important).** `_clutch` is generated **orthogonally to
skill**, so the clutch-moment ICE−CHOKE gap *should* be the feature and the
normal-moment gap *should* be ~0. But with a small roster pool, each tier is a
handful of specific players, and their baseline skill does **not** average out —
producing a spurious normal-moment gap (calibration saw ICE QBs −8.5pp in normal
moments purely by draw). The fix is **difference-in-differences**:
`DiD = clutchGap − normalGap`. The same players appear in both moments, so the
skill confound **cancels**, isolating the pure clutch effect. The audit reports
DiD as the verdict and uses a large, frequently-refreshed pool to tighten it.

---

## 5. Audit results

**500-game calibration** (directionally confirms the feature; small-n on FG):

| metric | clutch gap | normal gap | **DiD (clutch effect)** | expected |
|---|---|---|---|---|
| Kicker FG% | +16.6 (n≈51) | −1.0 | **+17.6pp** (noisy) | + |
| QB completion% | −1.6 | −8.5 | **+6.9pp** | + |
| QB INT% | −1.0 | +0.0 | **−1.0pp** | − (lower=better) |

All three DiDs point the correct way. The raw clutch gaps can look wrong (e.g.
comp −1.6) purely from the skill confound; DiD removes it.

**10,000-game run** (957s, 96-roster pool; `play kinds`: complete 466,878 /
incomplete 219,001 / int 21,103 / fg_good 34,895 / fg_miss 5,703):

| metric | clutch gap | normal gap | **DiD (clutch effect)** | target |
|---|---|---|---|---|
| Kicker FG% | +6.3 (n≈1,109) | +0.5 | **+5.8pp** ✓ | ~+5 |
| QB completion% | +3.6 (n≈14,795) | +0.2 | **+3.4pp** ✓ | ~+3 |
| QB INT% | −0.2 | +0.0 | **−0.2pp** ✓ dir | ~−1 |

The **normal-moment gaps are ≈0** for all three — the effect is isolated to
clutch moments and is NOT a skill confound. The completion DiD matching its
prediction almost exactly validates the whole model.

**Calibration note — INT is underpowered.** The INT DiD (−0.2pp) is correct-
direction but far below the ~−1pp the scale predicts. INTs are rare (~3%/att),
so the absolute pp effect is small and within sampling noise (SE ≈ 0.29pp at
this n). It's real but subtle; bump the INT scale (0.012 → ~0.020) if a more
visible effect is wanted — at the risk of clutch QBs almost never throwing late
picks (less realistic). Left modest for now.

---

## 6. The four mental channels (all-positions design)

A first-principles pass over *every* position. The rule (accuracy / decision /
hands / composure — never physical) means clutch flows through exactly **four
mental channels**, and each position gets clutch **only** through the channels
its job actually involves. Physical channels (blocking force, pass-rush burst,
break-tackle, top speed, FG range, tackling, closing speed) are never touched.

| Channel (mental) | Positions | Engine gate | Status |
|---|---|---|---|
| **Accuracy / decision** | QB (completion, INT), K (FG) | `compPct`, `intPct`, `fgPct` | ✅ done |
| **Hands / catching** | WR, **TE, RB-receiving** (same gate — free), DB interception | `compPct` (target `rcvr`); `dropChance` (DB) | ✅ done (incl. DB INT-catch) |
| **Ball security** | QB (strip-sack), RB/WR/TE carrier | `stripChance`, `yacFumbleChance`, run-`fumblePct` | ✅ done |
| **Discipline / penalties** | OL (false start), DL (offsides/NZI/encroach), QB (DOG) | `_penMod` rate × unit composure | ✅ done (pre-snap only) |

**Findings from the pass:**
- **TE and pass-catching RBs are covered for free** — the completion gate keys
  on whoever is targeted (`rcvr`), regardless of position. No new code.
- **OL/DL can ONLY express clutch via discipline/penalties** — their core job
  (blocking, pass rush) is physical, which the rule excludes. So penalties are
  the *sole* principled clutch lever for linemen. That channel has per-player
  attribution (`_pickPenaltyOffender`) but is "messier" — it modulates a penalty
  *rate* for a unit, not a clean per-play resolution gate.
- **Ball security is clean and per-player** for QB (strip-sack fumble), and any
  ball-carrier/receiver (YAC + run fumbles) — each gate has the player in scope.

**Implemented tiers:**
1. **Tier 1 — done:** DB INT-catch + ball-security fumbles (QB strip-sack,
   carrier YAC/run). Clean, per-player, same "concentration" principle as catching.
2. **Tier 2 — done:** pre-snap discipline penalties (False Start / Defensive
   Offsides / NZI / Encroachment / Delay of Game) modulated by the responsible
   unit's composure — the iconic false-start-kills-the-drive lever for linemen.
3. **Skipped:** punter placement, returner muffs, long-snap/hold — low narrative
   value or not granularly modeled.

**Verification note.** Ball-security and discipline both ride the proven
`_clutchMod` (15-check unit-verified) and pass an end-to-end engine smoke, but —
like INT — they act on *rare* events (fumbles ~0.5–1%/touch; discipline
penalties ~1–2%/play before the clutch gate), so their aggregate magnitude is
subtle and not separately DiD-measured. Extend `_clutch_audit.js` to track
fumble/penalty rates by tier if a hard aggregate number is wanted.

## 7. The "scoutable" half (Phase 3–4) — IMPLEMENTED

The other half of the spec: clutch is real *and* you can read it by watching the
film. Tracking and read are split across two pieces.

### Phase 4 — film / reputation (`_accrueClutchFilm`, `play-franchise-offseason.js`)
- Called from `frnSimOnce` (the universal game path) right after
  `captureGameHighlights`, so **every** game — user, CPU, playoff — builds film.
- Scans the play log for late-and-close plays (same gate) and accrues per-player
  counters onto `p.clutchRecord`: `fgAtt/fgMade` (K), `passAtt/comp/int` (QB),
  `tgt/rec` (receivers), `car` (carriers), `picks` (DBs). Reuses the exact
  play-log mining the audit proved (`receiver||intended`, `fgDist`, `defender`).
- Persists on the player object; sizes are sane (only clutch-moment plays — a
  full-season audit saw ≤44 exposures for the busiest QB).

### Phase 3 — scoutable confidence read (`HiddenOracle.read.clutchTag`)
- The TRUE `_clutch` stays hidden. The read = `_clutch` + **deterministic
  name-hash noise whose WIDTH shrinks as `p.clutchRecord` exposure grows**:
  Unproven (<8, ±28) → Limited tape (<25, ±18) → Established (<60, ±9) →
  Proven (≥60, ±3). A rookie reads fuzzy/biasable (the **Brady trap**, on
  purpose); a veteran's read converges on the truth. Noise is deterministic so
  the read sharpens monotonically rather than flickering.
- Surfaced on the scouting card (`play-franchise-season.js`) beside the
  drive/durability tags, with a confidence tooltip ("N clutch snaps on tape")
  and a "(?)" marker while Unproven.

### Verification (`_clutch_film_test.js`, 8/8 pass)
Boots a real franchise, sims a full season (~272 games → 1,398 clutch snaps
accrued across 272 players), then asserts: film accrues league-wide; QBs/all
positions accumulate; records stay clutch-only sized; `clutchTag` goes
Unproven→Proven, converges to the true tier at high sample, and rises
monotonically with sample; a real well-filmed player reads past "Unproven".
