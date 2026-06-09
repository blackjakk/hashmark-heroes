# Next-session pickup message

Paste this verbatim into the next chat to resume.

---

## Repo + state

- Repo: `/home/user/hashmark-heroes` (vanilla HTML/CSS/JS, no build step).
- Branch: `claude/youthful-franklin-UasDV` — pushed, working tree clean.
  As of this writing **`HEAD == origin/branch == origin/main == b543374`**
  (main was fast-forwarded; everything is recorded).
- Load order matters (browser globals via `<script>` in `play.html`):
  `play-data.js` → `play-player.js` → … → `play-engine.js` →
  `play-franchise-core.js` → `play-franchise-season.js` →
  `play-franchise-stats.js` → `play-franchise-offseason.js` → …
  Top-level `const`/`function` are cross-file accessible.
- Syntax check: `node --check <file>.js`. Realism gate: `node _sim_audit.js [seasons] [seed]`
  (bands in `AUDIT.md`). Manual verify: `npx http-server -p 5173` + headless
  Playwright at `/opt/node22/lib/node_modules/playwright`.
- Older arcs (teleport/position-contract refactor, sprite atlas, broadcast cam)
  are in `HANDOFF.md` §3–3B. That history is settled — don't redo it.

## What just shipped (this session)

A franchise-systems + UI arc. Newest first:

| Commit | What |
|---|---|
| `b543374` | **Color contrast.** Team-colored text (abbrevs/names/scores/headers) was raw dark-navy at ~1.1:1 (invisible). Routed box-score color through `_teamInk()` at the source (`_bspnTeamFromFranchise`); wrapped standings/leaders/schedule/recap abbrevs; lifted `--bspn-gray`/`--bspn-gray-dim` for AA. Box-score informational fails 26→0 (8 left are decorative, WCAG-exempt). |
| `111e1ec` | Live game: consolidate the two scoreboards into one (sticky scoreboard, hide field-HUD top corners). |
| `41c37e6` | Reimagine the live-game control deck (`#playbackControls` broadcast deck). |
| `1ffa5e5` | Pre-game "Play Game" screen → broadcast matchup hero (`.frn-hero-vsbanner`/`-side`/`-wpbar`). |
| `fcee76b` | Reimagine the Play (start) screen (`.fps-*`). |
| `4678f96` | **Workstream C (start):** run/pass Coordinator seam in the engine (`this._coordinators[this.poss]` in `_play()`, defaults to existing pass-prob roll when unset). |
| `70f985c` | Scouting: "Your Draft Capital" panel (picks + takeable prospects) in `renderFrnScoutingBoard`. |
| `9315651` | WPA swings: situational context ("why the play mattered") in `mffSeasonTopSwingsHtml` + `mffPlayerOfGameFor`. |
| `fe6c40c` | 3 bug fixes: schedule home/away balance (`@`/vs was always away), rested QB still played (now subs at snap-share ≤0.15), apostrophe names couldn't be scouted (`_jsStr` escaper). |
| `ed3935c` | **Workstream B:** deterministic seeded sim. Module-level swappable RNG in `play-data.js` (`_rand`/`_setSimRng`/`_clearSimRng`/`_mulberry32`/`_hashSeed`); `Math.random()`→`_rand()` across engine/player/sim/data. Same seed → byte-identical game. Calibration-neutral when unseeded. |
| `7d22982` | Situational stats: comeback / wire-to-wire / one-score tracking (`_classifyGameSituation`, `_sit` on standings). |
| `91aed23` | Drive-by-drive recap: persist a drive log (`_extractDriveLog` → `g.drives`) + render a Drive Chart (`_bspnRenderDriveChart`). |
| `c3cc989` | **Workstream A:** phase-accurate Blowout Rest off the game timeline (`_gameRestFraction`, `_restFractionFromMargin`). |
| `3ed4baa` | Rest Starters button + AI playoff rest (`_aiShouldRestForPlayoffs`) + reimagined Depth Chart WORKLOAD & REST card; configurable thresholds split offense/defense (`_REST_OFF_POS`/`_REST_DEF_POS`, `frnSetRestPolicy`). |

Design notes for the in-game-clock / multiplayer direction live in
`INGAME_CLOCK_AND_MULTIPLAYER.md` (`d4164aa`). The engine already has a real
play-by-play clock (`GameSimulator`); A/B/C reframed around persisting &
exposing that.

## What's open / suggested next moves

1. **Live-game chrome polish (offered, not started):** restyle the
   Return-to-Franchise button + play scrubber to match the new control deck.
   Low risk, finishes the live-game-screen reimagining.
2. **Workstream C continuation:** the Coordinator seam exists in the engine
   (`_coordinators[poss]`). Next is the *yieldable* play loop + a single-player
   playcall UI so a human can call plays instead of auto-rolling pass-prob.
   This is the larger, multi-session piece toward head-to-head.
3. **"Playoffs → Week 17 loop" bug — UNREPRODUCED.** User reported the playoff
   bracket bouncing back to the regular-season dashboard. Full playoff sim in
   the normal flow lands correctly on awards/champion. Likely a legacy/malformed
   bracket from an old save. **Awaiting a screenshot or save export to repro.**
4. Playoff format confirmed correct: **14 teams** (`PLAYOFF_PER_CONF = 7`).

## Verification recipe used this session

- **WCAG contrast audit (box score):** headless Playwright → `frnQuickStart()` →
  `frnSimWeek()` → `renderFrnPastGame(week, homeId, awayId)`, then walk
  `#frnHomeContent *`, **alpha-composite** each element's bg over its ancestors
  (translucent `meta.bg` like `rgba(...,.12)` must be composited or you get
  false positives), compute `(L1+0.05)/(L2+0.05)`, flag <4.5 (normal) / <3
  (large). `_teamInk(hex)` (play-franchise-stats.js ~6708) is the contrast-safe
  text color — lifts dark primaries to a readable accent; use for TEXT, never
  backgrounds/borders/`--team-color` tints.

## Conventions

- Commit messages end with the session URL line; never put the model id in
  commits/PRs/code. Fast-forward `main` only after the user confirms (they did).
- Scratch verification scripts (`_c_*.cjs`, screenshots) are throwaway — delete
  before committing; don't leave untracked files (a Stop hook flags them).

---

That's it. Ask me what you'd like to pick up — or say "restyle the return
button + scrubber" to finish the live-game chrome, or "continue Workstream C".
