# START HERE — next session (hashmark-heroes)

**Branch** `claude/charming-cray-ggpd7f` · in sync with main · tree clean · all gates green.

## Read first
1. `CLAUDE.md` — durable engineering notes (ship workflow, gates, every subsystem).
2. `HANDOFF_2026-06-16.md` — last session's full summary + **the ball-handler
   migration plan** (the big roadmap).
   *(The older `HANDOFF.md` is a stale prior-session arc — ignore it.)*

## State in one breath
Just built a **ball-handler animation model** (`_bhSampleBall` / `_bhGadgetAnim`
in `play-animation.js`): the ball is a token on a timeline of HELD/FLIGHT
segments. It's **ON by default for the 4 gadget plays** (halfback pass,
double-pass, hook & ladder, wildcat); kill-switch `GC_BALLHANDLER="off"`. The
standard run/pass animators are untouched. Also shipped: a deeper pass route
library, a pile of franchise/replay/UI fixes, and the punt full-22 cast.

## ⚠ One gotcha before you touch animation/routes
Teleport **runaway is at baseline (4/4) — ZERO margin.** One new runaway play
fails the gate. Check the offender (benign deep-route receiver vs. real defender
overrun) before raising the baseline. (egregious is fine at 2/4.)

## Pick the next move
- **Big payoff (multi-session):** start the **normal-play migration**, Stage 1
  pilot per HANDOFF §5 — a vanilla completion behind `GC_BH_NORMAL`, A/B vs the
  standard animator. *Port the continuity guards, not just the choreography.*
- **Quick wins (cheap now that the model exists):** new gadgets **fake spike** /
  **Statue of Liberty** (= one spec each); **stat attribution** for gadget passers.
- **Loose ends:** `animCtx` backfill for old-save highlights; reproduce the
  **#24/#27** teleport reports (the broad sweep kept dying — try a lighter,
  fewer-seed run); dedicated **two-point / onside / muffed-punt** staging.

## Always
Run the gates before pushing; `./tools/_stamp_build.sh` before any JS/art push;
`git push -u origin claude/charming-cray-ggpd7f && git push origin claude/charming-cray-ggpd7f:main`.
