# Next-session pickup message

Paste this verbatim into the next chat to resume. **There is no single
queued task — the recorded roadmap (V1-V5) is COMPLETE and all
user-reported bugs from the last session are fixed.** Open threads are
listed at the bottom; otherwise take direction from the user.

---

## Repo + state

- Repo: `/home/user/hashmark-heroes` (vanilla HTML/CSS/JS game, no build
  step; optional Solidity layer in `contracts/` — MegaETH, opt-in, NOT
  wired to gameplay).
- Branch: `claude/charming-cray-ggpd7f` — pushed, tree clean, and
  **`main` is fast-forwarded to the same tip on every push** (standing,
  user-confirmed; they treat main as live).
- Browser-globals loading (play.html order): play-data → play-player →
  … → play-engine → franchise-core → season → stats → offseason →
  **play-h2h-client** (last). Top-level const/function/let share one
  global scope across files — `window.X = …` does NOT write a top-level
  `let` binding (bare-name assignment does). This gotcha produced a real
  bug once (frnReplayClip had never worked).
- Gates (all law): `node --check <file>` per edit; `node _audit_gate.js`
  (14 metrics, seed 1337, re-baseline intentional changes in the same
  commit — `--fast` for the 1-min tier); `./_teleport_gate.sh` (seeded
  render replay; egregious-jump baseline + the new OUT-OF-BOUNDS class);
  realism deep-dives via `node _sim_audit.js [seasons] [seed]` (bands in
  `AUDIT.md`). Manual verify: `npx http-server -p 5173` + Playwright at
  `/opt/node22/lib/node_modules/playwright`.

## Where the project stands (all DONE, pushed, on main)

- **Audit era** (`CODEBASE_AUDIT_PLAN.md`): all 9 workstreams + ticket
  backlog closed. §F's last criterion (keyboard-only offseason) now met.
- **V1 renderer unification** (`VISUAL_ENGINE.md`): live broadcast =
  `#field-pixi` (sleeping static WebGL field) + `.gc-player-pixi` (THE
  one per-frame render) + DOM callouts; `#field` is clearRect-only in
  broadcast; `#field-uprights`/`.gc-pixi-fx` exist only as no-WebGL
  fallbacks. PLAYING p50 **83ms** headless software (was 470 pre-audit).
- **V3 replay-clip shrink**: clips 191KB → ~9KB (statsSnap stripped at
  source + load-time backfill; motion tracks KEPT — they're the replay).
- **V4 head-to-head, complete and playable browser-to-browser**:
  - Four Coordinator seams in the engine — run/pass `"playcall"`,
    `"fourthDown"` (go/fg/punt), `"pat"` (kick/two), `"defense"` (six
    coverage shells, fires at snap top BEFORE the 4th-down branch).
    Gate-safe contract: AI consumes its RNG first, coordinator overrides
    the RESULT; defer = byte-identical (CI invariant, tol 0).
  - Single-player interactive playcalling prompts BOTH sides of the ball
    (keys: R/P, G/F/P, K/G, 1-6 shells, O = defer, Coach Mode hand-off).
    Dashboard hero button = 🎙 CALL THE PLAYS (launches it directly).
  - `server/h2h-server.js`: zero-dep Node authority. State =
    (seed, roster snapshots, input tape); re-sims per call; parallel
    same-snap windows under ONE clock (defense+offense prompt together;
    tape commits atomically at window resolution = the durability
    boundary); play-clock timeout → AI defer; JSONL persistence with
    boot-time re-sim recovery; artifact = {seed,teams,rosters,tape} +
    SHA-256 hash served at /api/artifact (the future chain-settlement
    hook — v1 has NO chain dependency, user-confirmed); BYO franchise
    rosters both seats; `H2H_STATIC=1` serves game+API one-origin;
    `server/README.md` has the systemd/Caddy deploy recipe.
  - `play-h2h-client.js`: the network session wears the `_ipc`
    interface — same panels/keys/playback; `frnPlaycall` has a
    `mode==="net"` branch; SSE decisions → `_ipc.pending`; waiting
    banner with countdown; host modal via the 🌐 footer link; share link
    `#h2h=matchId.joinCode.server`; wire-slimmed plays (statsSnap on a
    ~8-carrier cadence + scores + final).
  - Pacing model (user-ratified, in `INGAME_CLOCK_AND_MULTIPLAYER.md`):
    simultaneous hidden calls, server-anchored deadline (deadline-as-data
    → async leagues later), advance-on-both-ready, AI fallback.
- **V5 realism**: one-score 42.7 → **45.0** [44-52 ✓] (canonical
  40-season audit; the GATE's sim tier runs only 2 seasons → its reading
  is ±2pp noise — don't chase it); OT 3.2 → ~4 [4-10 edge]. Levers:
  PREVENT now CONCEDES underneath (passMul 0.92→1.16 — it was backwards
  — sackMul 0.60, 14+ Q4 leads shell from 8:00), the down-8-16 Q4
  FG-script, PAT chart kicks the tying XP (case -1: 0.35→0.10 lateGame),
  kneel-to-OT + tied two-min-drill discipline, deeper Q4 leader run
  tilts. Injury-by-position SHARE bands (11 chk detectors) in
  `_brady_audit.js` — all pass. Keyboard-only offseason proven by
  `tools/_kb_offseason_probe.js` (drafts a prospect + submits an FA
  offer by keyboard; zero app fixes were needed).
- **Last session's user-report fixes**: floating sprites (foot offset
  0.35→0.23 — art's feet measured at ~0.73 of image height, not the
  assumed 0.85; ball hand offset rebased -50→-38 with it); drawPlayer
  bounds guard (nothing renders past the EZ backs / far past sidelines);
  honest entry hierarchy (hero = interactive, Watch Game secondary).

## OPEN THREADS (no commitments made — user picks)

1. **The unreproduced "barrier" runaway** (user report: defenders
   sprint to the endzone after sacks and keep going). Could NOT repro
   across sacks/completes/turnover-returns with two detector styles.
   Armed: the teleport detector's OUT-OF-BOUNDS class flags any player
   draw past the field edges with kind/slot/frame (first catch: FG-def
   FS at x=-5, minor). The renderer clamp hides the symptom meanwhile.
   If the user gives a trigger (play kind / phase — during the play,
   the hold, or next-play setup?), capture a battery around it
   (`node _teleport_capture.js N SEED` → `node _teleport_detect.js`).
2. **Defense-prompt toggle** (proposed, not shipped): a per-game "stop
   prompting my defense" option on the call panel — between full
   prompts (~140/game) and Coach Mode.
3. **H2H beyond v1**: matchmaking/accounts, spectators, async-league
   deadlines (protocol-ready — deadline is already data), parallel
   window for 4th-down/PAT prompts, chain settlement (post artifact
   hash to LeagueManager; optimistic wagers w/ challenge-by-re-sim).
4. **Strict-AA WCAG badge** + landmarks/headings (§F leftovers, low).

## Architecture cheat-sheet (battle-tested this session)

- **Determinism**: engine RNG `_setSimRng/_clearSimRng` (game seed);
  franchise `_withWeekRng` (week seed). The interactive runner AND the
  H2H server both = fresh seeded sim + flat input tape + sentinel throw
  at the first unanswered coordinator call (`_ipcRun` /
  `server/h2h-server.js step()`). Tape replay = byte-identical prefix.
- **Renderer topology** (broadcast): GCField renders ONLY on change
  (static key `home|away|camera`, dynamic key incl. 10Hz red-zone pulse,
  `_shadowsDirty` for topdown); GCPlayer canvas per frame — under
  container (ground shadows/trails projected per point: the CSS tilt IS
  `projectBroadcast`, scaleY(1/cosθ)·cosθ=1), `_stage` (sprites + ball +
  goalposts, zIndex=screenY; ragdoll rot/dy applied ON the sprite, never
  baked into the texture cache), fxRoot (GCFx particles/chrome).
  Callouts/result cards/weather badge = DOM `#fieldCalloutLayer`
  (1700×720 design space scaled onto the wrap; `_fcClearAll` at play
  boundaries). `engine-host.js` = the audit's DOM-shim bundle loader as
  a module (keep FILES in sync with `_sim_audit.js`).
- **Sprite ground truth**: PixelLab art is 104px, feet at ~0.73 height;
  `_SPRITE_FOOT_OFFSET_Y = 0.23`; GCPlayer textures 96×192, anchor
  (0.5, 0.82). Anchor-relative visual constants (ball hand) must be
  rebased if the offset ever changes again.

## Verification recipes that keep paying off

- **Measure before building** (V3's lesson: the "180KB of waypoints"
  was actually statsSnap; tracks were 3-8KB and load-bearing).
- **H2H probes** (all ALL-PASS, run after any engine/server change):
  `node server/h2h-probe.js` (wire + independent artifact re-sim),
  `h2h-recovery-probe.js` (SIGKILL → exact state restore),
  `h2h-client-probe.js` (two real browsers through the UI).
- **Keyboard walkthrough**: `node tools/_kb_offseason_probe.js`.
- **Deterministic frame screenshots**: freeze `Math.random` AND
  `performance.now` to constants for pixel-comparable runs; RNG-stream
  interleave otherwise shifts body-type picks and fakes diffs.
- **Pre-V1 baselines are shadowless in single-frame probes** (shadows
  composited a frame late back then) — compare LIVE frames across eras.
- **In-page coordinate hooks beat pixel-hunting**: monkeypatch
  GCPlayer.render/addShadow to log positions; crop screenshots at
  logged coords.
- **Gate noise**: `sim_one_score_game_pct` at the gate's 2-season tier
  swings ±2pp between content-shifted runs; the 40-season number is the
  realism truth. Tolerances absorb it — don't re-tune off the gate read.

## Conventions

- Commit messages end with the session URL line; never put the model id
  in commits/PRs/code. Push branch, then fast-forward `main` (standing).
- Scratch scripts `_c_*.cjs` at /tmp only — never commit. Probes live in
  `tools/` (or `server/` for the H2H ones); root `_*` files are the live
  gate + calibration suites.
- Findings → fixes split; every fix ships with its detector; the audit
  gate is law for anything engine-adjacent; pkill exit code 144 aborts
  compound shell commands (run it alone).

---

That's it. No queued task — pick up whatever the user asks, with the
open threads above as the menu.
