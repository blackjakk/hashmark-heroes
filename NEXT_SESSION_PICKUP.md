# Next-session pickup message

Paste this verbatim into the next chat to resume.

---

## Repo + state

- Repo: `/home/user/hashmark-heroes` (vanilla HTML/CSS/JS, no build step).
- Branch: `claude/charming-cray-ggpd7f` — pushed, working tree clean, and
  **`main` is fast-forwarded to the same tip** (user-confirmed; they treat
  main as live).
- Load order matters (browser globals via `<script>` in `play.html`):
  `play-data.js` → `play-player.js` → … → `play-engine.js` →
  `play-franchise-core.js` → `play-franchise-season.js` →
  `play-franchise-stats.js` → `play-franchise-offseason.js` → …
  Top-level `const`/`function` are cross-file accessible.
- Syntax check: `node --check <file>.js`. Realism gate: `node _sim_audit.js [seasons] [seed]`
  (bands in `AUDIT.md`; zero flagged metrics = pass). Manual verify:
  `npx http-server -p 5173` + headless Playwright at
  `/opt/node22/lib/node_modules/playwright`.
- Older arcs are settled history: `HANDOFF.md` §3–3B (teleport/position
  refactors), and the 2026-06 franchise-systems + UI arc (contrast fixes,
  Workstreams A/B, drive charts, blowout rest…) is in `git log` + the docs.

## What just shipped (this session, newest first)

| Commit | What |
|---|---|
| `de4b9e8` | **Workstream C: 4th-down Coordinator seam.** Engine consults `this._coordinators[poss]` with `kind:"fourthDown"` AFTER the AI pipeline produced `action` (same RNG draws → unset/defer = byte-identical, gate-safe; audit ran clean). Interactive mode pauses on your 4th downs: GO / FG (distance on the button, >68yd disabled) / PUNT / COACH CALL, G/F/P/O keys. GO chains into the run/pass prompt. HC-callout suppressed when the user drove the call. |
| `cfc9629` | **"Playoffs → Week 17" bug FIXED (root-caused by code audit).** Legacy `playoffs_pending` phase + VALID bracket slipped both load heals; tab round-trip fell through Overview → `renderFrnRegular()` (week label clamps to W17). Layered fix: load-heal retires `playoffs_pending` outright; symmetric heals for phase-knocked-to-regular with live/crowned bracket; tab-route guard. Verified against 4 synthesized legacy states. |
| `d7b5409` | **Workstream C.2: single-player interactive playcalling.** 🎙 Call the Plays on the pre-game hero. Deterministic re-sim with an input tape: each decision re-runs a fresh seeded sim, replays the tape through the coordinator seam, aborts via sentinel throw at the next unanswered call (~30ms). Partial runs use JSON-cloned rosters + snapshot-restored ejection/career-ending logs (engine mutates shared player objects in-game!); a completed run re-runs once on real rosters so mutations land exactly once. `frnPlayGame` split into `_frnEnterLiveGameScreen` / `_frnBuildLiveSim` / `_frnStartLivePlayback`; chaos rolls hoisted (`_frnChaosRolls`). Return-mid-game finishes via coach mode. Playback hooks in `startNextPlay`/`jumpAheadTo`/⏭End route partial-end → call panel (`_ipcMaybePrompt`). |
| `651b05f` | UI-audit fixes: live-scoreboard + playoff-bracket team-ink contrast (the `_teamInk` rule missed the live surfaces); trimmed-game linescores (trimmer now keeps the user's games' `g.scoring`; CPU recaps rebuild exact quarter totals from the drive log; dashes + honest copy when nothing retained); live chrome (Return btn + scrubbers deck-styled, LIVE BIO labels WEAR/STRESS/FATIGUE). |

Also: `CODEBASE_AUDIT_PLAN.md` is new — 9 prioritized audit workstreams
(injection sweep → save integrity → realism-gate extensions → determinism →
perf → UX/a11y → code health → error/state fuzz → deps/deploy) with methods
and pass criteria. The full UI/UX audit findings that seeded it are in the
session log (Tools-tab dissolution, Analytics pill sprawl, Abandon-button
demotion, save-status jargon, Overview header slimming are the open IA items).

## What's open / suggested next moves

**The audit plan is FULLY EXECUTED and its ticket backlog is now CLOSED OUT
too** (ticket-closure arc): static-field render cache (470→381ms software;
sprites ~180ms + PIXI shadow-composite ~150ms are the next perf pass),
non-mutating save pipeline (flush 1.9s→~110ms; IDB gets the live object; trim
moved to season rollover), KR-return realism fixed (PR TDs were structurally
impossible — clamp floored the spot at the 1; ST table now 3/3 in band, KR
re-baselined 24.4), Workstream C PAT seam (kick XP / go for 2 prompts, K/G/O
keys), 43 display sinks escaped at the sink, and the 36 dead functions
deleted (531 lines, tombstones point at git).

Open items, in rough order:
1. **Workstream C.3:** server-authoritative netcode for live H2H (needs a
   server + product decisions — design in `INGAME_CLOCK_AND_MULTIPLAYER.md`);
   tempo-decision seam if wanted before that.
2. **Perf pass 2** (plan §E): pre-scaled sprite cache and/or move player
   shadows off the PIXI stage (~330ms of the remaining software-raster frame).
3. **Per-clip motion payload** (plan §B): regenerate replay motion from
   seed+inputs instead of storing ~180KB/clip; would shrink saves ~10×.
4. Realism nits (plan §C): one-score % ~42-43 vs NFL 44-52; OT % ~3.2 vs
   4-10; injury-rate-by-position bands for `_brady_audit.js`.
5. Keyboard-only offseason playthrough (§F pass criterion not yet run).
6. Playoff format remains 14 teams (`PLAYOFF_PER_CONF = 7`).

## Verification recipes that paid off this session

- **WCAG walker:** alpha-composite each element's bg over ancestors before
  computing contrast (translucent `meta.bg` false-positives otherwise).
  `_teamInk(hex)` = contrast-safe TEXT color; never backgrounds/borders.
- **Interactive-playcall invariants (headless):** outcome-prefix
  byte-identity across decisions = compare `plays` JSON **with `motion`
  stripped** (motion is display-only and re-stitched at the boundary);
  real-roster JSON must be byte-identical during partial play and change
  exactly once on commit.
- **Synthesized-save testing:** set `franchise.phase`/bracket shapes by hand
  in the page, call `showFranchiseDashboard()`, assert which screen renders —
  found the playoffs bug without a user save.

## Conventions

- Commit messages end with the session URL line; never put the model id in
  commits/PRs/code. `main` is fast-forwarded after user confirmation (a
  standing pattern now — but still confirm on first push of a session).
- Scratch verification scripts (`_c_*.cjs`, screenshots) are throwaway —
  delete before committing; don't leave untracked files (a Stop hook flags
  them).

---

That's it. Say "perf pass 2" (sprites/shadows), "shrink the clips" (motion
from seed), or "start C.3 netcode design".
