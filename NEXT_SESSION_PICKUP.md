# Next-session pickup message

Paste this verbatim into the next chat to resume. **No single queued
task** — this session shipped a long run of user-driven features and
fixes (all pushed, all detectored). Open threads at the bottom;
otherwise take direction from the user.

---

## Repo + state

- Repo: `/home/user/hashmark-heroes` (vanilla HTML/CSS/JS game, no build
  step; optional Solidity layer in `contracts/` — NOT wired to gameplay).
- Branch: `claude/charming-cray-ggpd7f` — pushed, tree clean, and
  **`main` is fast-forwarded to the same tip on every push** (standing,
  user-confirmed; they treat main as live).
- Browser-globals loading (play.html order): play-data → … → play-engine
  → franchise-core → season → stats → offseason → play-h2h-client (last).
  Top-level const/let share one global scope — `window.X = …` does NOT
  write a top-level `let` binding (bare-name assignment does).
- **Fonts are SELF-HOSTED** (`fonts/fonts.css`, 16 woff2, latin subsets).
  The Google Fonts CDN is gone from play.html; the user's machine was
  silently rendering Courier/Arial fallbacks for a long time, which
  explained a string of "old looking font" reports. The artifact probe
  asserts the three core faces load.
- Gates (all law): `node --check <file>` per edit; `node _audit_gate.js`
  (14 metrics, seed 1337, `--fast` 1-min tier; re-baseline intentional
  changes in the same commit); `./_teleport_gate.sh` (egregious ≤ 4 AND
  runaway ≤ 4 — both re-baselined this session); realism deep-dives via
  `node _sim_audit.js [seasons] [seed]`.
- Probe battery (tools/, each self-serves on its own port):
  `_franchise_qol_probe.js` (30 checks), `_dc_dnd_probe.js` (18),
  `_holdout_center_probe.js` (24), `_ipc_clock_probe.js` (7),
  `_ui_artifact_probe.js` (17 surfaces; classes: white-control,
  tiny-text, stray-font, undef-var, offscreen-x, font-missing),
  `_kb_offseason_probe.js` (§F keyboard loop). pkill exit code 144
  aborts compound shell commands — run it alone; ghost http-servers on
  probe ports cause 404/EADDRINUSE — `fuser -k <port>/tcp`.

## What this session shipped (chronological, all on main)

1. **Holdout Center negotiation** — always-on offer composer (AAV/years/
   structure/chips/odds), real accept/concede/dig-in exchange (2 rounds,
   tag-floor anchored), modernized screen + empty state.
2. **Play clock (solo)** — 20s on every interactive prompt; expiry
   defers to OC/DC (null tape entry = byte-identical to pressing O);
   freezes while tab hidden; net games keep server authority.
3. **Post-sack runaway defenders FIXED** (the long-open user report):
   sack renderer's LB-scrape/DL-hold offsets read `_lastRenderedX`
   (re-synced every frame) as their base → per-frame integration →
   ~48yd/s sprints into the field edge. One-shot `_sackHoldBase` per
   play. New RUNAWAY detector class in `_teleport_detect.js` (≥20yd
   late-sprint ending ≥24yd from the dead ball), gated in
   `_teleport_gate.sh` (baseline 4; egregious tightened 8→4).
4. **Broadcast HUD anchored to the field** (down chip no longer covers
   the play caption).
5. **Player card vitals = the game's own sprite** (`sprites/idle/
   south.png` pixelated in the SVG; wear glows ≥30, margin callout
   chips, career scar dots, active-injury crosshair + banner).
6. **App-wide type/artifact audit**: `:root` now defines `--fg/--text/
   --bg1/--blgray` AND (latest) the **full bl\* palette** (`--blwhite/
   --blgold/--blgreen/--blgreen-d/--blred/--blborder/--blbordr2`) — ~77
   body-level inline usages (re-sign/demands ceremonies etc.) silently
   resolved to nothing and rendered flat. Probe's `undef-var` class
   guards it. Global `.btn` got `font-family: inherit` (was UA Arial).
   All sub-8px font sizes raised.
7. **Bye weeks** — 18-week calendar, 17 games/team, byes in W9/W10
   (split middle Berger round). `GAMES_PER_TEAM = 17` vs
   `FRANCHISE_WEEKS = 18` — use the right one. Dashboard bye hero card +
   gauntlet BYE card.
8. **Final cuts: AUTO-RESTRUCTURE TO CAP** + per-season cap-spread
   tables in both restructure confirms.
9. **IR player card fix** (`_findPlayer` now searches `franchise.ir`).
10. **NEXT MAN UP** — `_emergencyDepthPatch` in `_frnBuildLiveSim`
    converts a healthy neighbor (donor adjacency CB↔S, WR↔RB, K↔P…,
    −18% OVR via `_EMERGENCY_OVR_MULT`) when a group is empty — no more
    50-OVR ghosts. **Street FAs** — depth chart button → mid-season
    1yr half-market signings; pool tops up (`_streetFATopUp`).
11. **Depth chart rework** — drag-and-drop everywhere (cells, bench
    trays, cross-position with OOP chips); **the chart now drives the
    engine** (`_applyDepthChartToRoster` stamps `_depthRank`; engine's
    three depth sorts use `_depthCmp` — rank first, OVR tiebreak;
    byte-identical when no ranks → gate-safe). **Field view** — 🏟
    formation diagram, uniform 108px depth stacks (★ starter pill bold,
    ▸ backup indented), every pill an independent drag source/target.
12. **SB-loss progression fix** — champion auto-crowned when the SB
    result records; ELIMINATED recap shows first (dashboard heal defers
    to `_frnPlayoffRecapPending`); bracket lands on one "🌟 AWARDS
    CEREMONY" button (no CROWN-CHAMPION-behind-wrong-confirm trap).
13. **WPA recap card** — headline says what the play did (GO-AHEAD
    TOUCHDOWN etc., score journey "down 7 → up 1"), swing as display
    number, play pinned on the WP sparkline. Fixed: the Sim Week path
    never wrote the analytics playLog (`_mffAppendPlayLog` now shared by
    both persist paths — every game feeds WPA/EPA).
14. **Real replays everywhere** — `frnReplayHighlight` router: recorded
    motion clip → playLog reconstruction (`_inflateCompactPlay` + shared
    `_frnPlaySynthReplay`) → text modal only for old saves. Floating
    ✕ EXIT REPLAY chip (`frnExitReplay`) restores the dashboard.
15. **Box score de-ASCII'd** (modern footer, dead block-logo removed,
    bracket nav links → chips) and **LIVE BIO panel fixed** — phantom
    128px box per row (rows 210px→82px; the body-wear silhouette had
    computed 0px wide since it shipped — `display: contents` wrapper +
    explicit svg sizing).
16. **Play sheet — THE FULL BOOK** (post-compact, three commits) — the
    offensive prompt offers 16 named plays + generics: 5 runs (…+ DRAW,
    call-only runType), 5 dropbacks, and a SHOTS row (PA, RPO with a
    real give/pull read off the called shell, READ_OPTION forcing the
    speed-option pitch read, REVERSE, FLEA_FLICKER, HAIL_MARY — a
    call-only PASS_CONCEPTS entry absent from the FREQ table). Defense
    adds RUN_COMMIT + PREVENT (readSuccessVs columns on every concept +
    run-yardage shading; coordinator-only). 4th down adds fake_punt /
    fake_fg (new fake-FG holder model in the fg branch). NEW "kickoff"
    decision kind → callable onside (seam in _kickoffAfterScore); the
    franchise decide-cb auto-answers routine kickoffs BEFORE tape
    consumption (ctx-only gate → tape indices stay aligned; prompts only
    Q4 or trailing-from-Q3). Every forced site overrides ROLL RESULTS
    only — defer/no-coordinator is byte-identical (probe check #1 +
    audit gate 0-drift). Madden-style procedural SVG play art on every
    card (_ipcPlayArt; routes/zones/blitz arrows/kick arcs). Keys:
    1-5 runs, 6-0 passes, QWEASD shots, T/K fakes, K/S kickoff,
    7/8 new shells. Works in net play unchanged (the server runs the
    same engine seams; foreign strings = defer). Called runs suppress
    reverses/QB keepers; called concepts suppress accidental screens/PA.
    Probes: `tools/_playsheet_probe.js` (28 headless engine checks),
    `_ipc_clock_probe.js` (19).
17. **Huddle scene + defense pace** (post-compact) — while a call prompt
    is up, both squads form real huddles at the new LOS instead of the
    previous play's freeze-frame; status line on the TOP banner (the
    bottom cadence slot sits under the scrub bar). DEFENSIVE prompts run
    a shorter randomized 8-13s window (`_IPC_DEF_CLOCK_*`): the opposing
    offense BREAKS THE HUDDLE on screen ~2.6s before zero
    (`_ipcHuddleBreakAt`, hidden-tab freeze shifts it too) and at zero
    the DC's call locks in (same null-tape "auto" path). Scene:
    `ipcHuddleStart/Stop` in play-animation.js, jog-transition frame
    skeleton (`_frameStartBroadcast` → drawField/drawPlayer →
    `_frameEndBroadcast`); cinema viewMode keeps the freeze-frame.
    `_ipc_clock_probe.js` now 17 checks (break lead, mid-break call
    window, scene lifecycle).

18. **Throw animation Phase 1** (post-compact) — contact-event release.
    The pass art's 4 frames are ALL pre-release (set/turn/cock/cock-high;
    no arm-extended frame exists, and there's no PixelLab API in-repo —
    sprites came from manually downloaded ZIPs via sprites/_extract.py).
    Old timeline froze the QB on painted-cocked frames through the whole
    flight (double ball, no release read). Now: windup frames 0→3 peak
    EXACTLY at releaseAT (tf*0.55), sprite swaps to empty-handed idle +
    ~5px weight-transfer step-in, releaseX/Y = extended hand, flight arc
    gets relElev (starts at hand height, blends out), standalone-ball
    gap closed (airStart 8%→1% of flight), and a 2-ball frame-history
    RELEASE STREAK (rides drawBall → correct in both cameras; clears on
    scrub-back). Catch hitstop already existed (slowMoUntil freeze 220ms
    + green flash at throwEndAT). Verified: zoom frame sweeps + 71
    pass-family plays × 9 fracs rendered error-free; teleport gate 4/4.
    PHASE 2 (not started): catch matrix (variant by ball-arrival
    geometry; isLeapingCatch/catchRadius already emitted), torso/legs
    sprite layering for catch-in-stride, procedural lean/squash.

## OPEN THREADS (user picks)

1. **Touch drag-and-drop** — HTML5 DnD doesn't fire on touchscreens;
   depth chart on mobile = buttons only. Pointer-events rewrite if asked.
2. **True per-slot 3rd string** — the chart holds starter+backup per
   slot; deeper depth = group's later slots + bench. A literal third
   pill row = data-model extension (user was told, hasn't asked).
3. **Play screen geometry** — chrome cleaned up, but if the user still
   dislikes the layout (scoreboard proportions, panel order), they were
   invited to screenshot specifics.
4. **H2H beyond v1** — matchmaking, spectators, async deadlines, chain
   settlement (artifact + SHA-256 at /api/artifact is the bridge).
5. **Defense-prompt toggle** (proposed): per-game "stop prompting my
   defense" between full prompts and Coach Mode.
6. **Strict-AA WCAG badge** + landmarks (low).

## Architecture cheat-sheet

- **Determinism**: engine `_setSimRng/_clearSimRng`; franchise
  `_withWeekRng`. Interactive runner + H2H server = fresh seeded sim +
  flat decision tape + sentinel throw (`_ipcRun` / server `step()`).
- **Depth pipeline** (NEW): `franchise.depthChart[teamId]` slots
  (`{starter, backup}` pids) → `_applyDepthChartToRoster` (ranks +
  OOP-converts) → `_emergencyDepthPatch` (next-man-up) → engine
  `_depthCmp` sorts. AI auto-charts are OVR-ordered → unchanged.
- **Replays**: `franchise.replayClips` (motion, top-7/game) +
  `franchise.playLog[season]` (EVERY play, compact MFF records, both
  persist paths) → `frnReplayHighlight` resolves, `_frnPlaySynthReplay`
  plays through the broadcast renderer (slow-mo, `_replayMode`).
- **Renderer**: GCField static + GCPlayer per-frame (V1 topology, 83ms);
  teleport detector replays captured batteries through the REAL
  renderer (egregious/OOB/RUNAWAY classes).
- **Sack-anim hazard**: any `_lastRenderedX + f(t)·offset` pattern
  compounds (Stage-4 sync rewrites the base every frame) — stamp a
  one-shot base instead.
- **Sprite ground truth**: 104px PixelLab frames; idle/south figure
  bbox x38-68/y28-77; `_SPRITE_FOOT_OFFSET_Y = 0.23`.

## Verification recipes

- Headless boots: `startFranchise(1)` + seeded `Math.random`; phase
  gates matter (`franchise.phase = "regular"` to skip preseason/FA).
- `frnPlayGame(homeId, awayId)` needs explicit ids.
- Playwright `page.dragAndDrop(srcSel, tgtSel)` drives real HTML5 DnD
  (the dc probes rely on it).
- `_frnConfirm` is an in-DOM modal — buttons "Cancel"/"Continue";
  auto-accept in probes via `window._frnConfirm = async () => true`.
- `document.fonts.check()` lies for unregistered families — use
  `document.fonts.load()` length instead.
- innerText can miss text that textContent sees (probe assertions).

## Conventions

- Commit messages end with the session URL line; never put the model id
  in commits/PRs/code. Push branch, then fast-forward `main` (standing).
- Scratch scripts `_c_*.cjs` at /tmp only — never commit. Probes live in
  `tools/`; root `_*` files are the live gates + calibration suites.
- Findings → fixes split; every fix ships with its detector.

---

That's it. No queued task — pick up whatever the user asks, with the
open threads above as the menu.
