# START HERE — next session (hashmark-heroes)

**Current branch** `claude/wizardly-ride-h1ir1i` · synced · tree clean · all gates green.
(Branch rotates per session; develop on whatever the session assigns, fast-forward `main` per CLAUDE.md.)

## Read first
1. `CLAUDE.md` — durable engineering notes (ship workflow, gates, every subsystem).
2. `HANDOFF_2026-06-16.md` — the ball-handler model + the full normal-play
   **migration plan** (still the big roadmap; Stage 1 is now started — see below).

## What shipped THIS session (newest → oldest)
- **Normal-play migration Stage 1 pilot** (flag-gated, default OFF): a vanilla
  dropback COMPLETION through the ball-handler model, behind
  `window.GC_BH_NORMAL="on"`, for A/B vs the standard animator. `_bhSpecForPass`
  + `_bhNormalPassAnim` in play-animation.js; headless continuity gate
  `tools/_bh_normal_probe.js` (0 NaN, no >70px/frame jump, ball delivered to WR).
  Gates stay byte-identical with the flag off.
- **Gadget stat attribution**: all six gadgets now credit the box score
  (passer/receiver/rusher/defender + team totals); the non-QB passers (RB on HB
  pass, WR on double pass) finally get a passing line. `_lastPasser` routes a
  gadget TD's pass_td to the real thrower.
- **Two new gadgets**: 🧊 FAKE SPIKE (key C, pass) + 🗽 STATUE OF LIBERTY
  (key V, run) — one engine block + one `_bhGadgetAnim` spec + sheet wiring each.

## State in one breath
Six gadget plays render on the ball-handler model (ON by default; kill-switch
`GC_BALLHANDLER="off"`). The normal-play migration has a **Stage 1 pilot
landed behind `GC_BH_NORMAL`** (default off). Standard run/pass animators are
untouched; gates all green.

## ⚠ Gotchas before touching animation/routes
- Teleport **runaway is at baseline (4/4) — ZERO margin.** One new runaway play
  fails the gate. ST coverage (punt full-22) already flirts with this — any new
  special-teams choreography (two-point/onside/muffed-punt staging) must not add
  a runaway. (egregious is fine at 2/4.)
- Route-track building stays RNG-free (audit byte-identical depends on it).

## Pick the next move
- **Migration Stage 1 finish:** in-browser visual A/B of `GC_BH_NORMAL="on"` vs
  the standard animator (catch point, YAC endpoint, pose families, zero
  teleports). Only then consider a default flip. Then Stage 2 (runs — riskiest,
  evasion poses + the teleport battery), Stage 3 (sack/INT/screen/PA).
- **Loose ends still open:**
  - `#24/#27` defender teleport/loop — investigated this session across 6 seeds
    × both cams, NOT reproduced (see CLAUDE.md Pending). Needs a user-supplied
    repro (down/distance/coverage/jersey) OR a path-shape (loop) detector added
    to the battery — the magnitude gate misses wandering loops.
  - Situational ST (two-point / onside / muffed-punt) still animates generically
    — two-point is a score CARD, not a rendered snap, so dedicated choreography
    is real work AND must respect the zero-margin runaway gate.
  - `animCtx` backfill for pre-fix (old-save) highlights — still fuzzy
    clock-matching; one-time migration, never built (risky blind without a save).

## Always
Run the gates before pushing; `./tools/_stamp_build.sh` before any JS/art push;
push to the session's branch (and fast-forward `main` per CLAUDE.md convention).
