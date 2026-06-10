# Next-session pickup message

Paste this verbatim into the next chat to resume. **V1 (renderer
unification) and V3 (replay-clip shrink) are COMPLETE. Next arcs: V4
(netcode design — needs product decisions from the user first) or V5
(realism nits + keyboard-only offseason run), per `VISUAL_ENGINE.md`.**
V2 (perf) was realized by V1 step 4: PLAYING p50 367→**83ms** headless
software (was 470 at the start of the audit era).

---

## Repo + state

- Repo: `/home/user/hashmark-heroes` (vanilla HTML/CSS/JS, no build step).
- Branch: `claude/charming-cray-ggpd7f` — pushed, working tree clean, and
  **`main` is fast-forwarded to the same tip on every push** (standing,
  user-confirmed pattern; they treat main as live).
- Load order matters (browser globals via `<script>` in `play.html`):
  `play-data.js` → `play-player.js` → … → `play-engine.js` →
  `play-franchise-core.js` → `play-franchise-season.js` →
  `play-franchise-stats.js` → `play-franchise-offseason.js`.
  Top-level `const`/`function` are cross-file accessible.
- Gates: `node --check <file>.js` per edit; realism `node _sim_audit.js
  [seasons] [seed]` (bands in `AUDIT.md`); regression `node _audit_gate.js`
  (14 metrics, seed 1337, re-baseline intentional changes in the same
  commit). Manual verify: `npx http-server -p 5173` + headless Playwright at
  `/opt/node22/lib/node_modules/playwright`.

## Where the project stands (everything below is DONE and pushed)

- **The 9-workstream `CODEBASE_AUDIT_PLAN.md` is fully executed AND its
  ticket backlog is closed.** Every § has a DONE block with findings +
  verification. Highlights: XSS class killed at the shared renderers +
  import sanitizer; IDB-loses-data-under-pressure fixed; replayClips capped
  (was 91% of saves); realism gate extended (ST/penalties/outcome-shape +
  a HARD interactive-mode determinism invariant in CI); franchise-layer
  determinism (full-week re-sim byte-identical, `_frand`/`_withWeekRng`);
  site-wide WCAG pass (4365→~35, exempt floor documented); IA reshuffle
  (Tools tab dissolved into Front Office, Analytics grouped, Abandon
  demoted); one sim factory (`_frnBuildLiveSim`) + one persist path
  (`_frnPersistSimmedGame`); 15 probes quarantined to `tools/`; 36 dead
  functions deleted; phase-machine fuzz clean (12/12 phases navigable).
- **Ticket-closure arc:** static-field render cache (`_drawFieldStatic` +
  `_fieldStaticCache`; PLAYING p50 470→381ms software); non-mutating save
  pipeline (`_slimFranchiseForMirror`; flush 1.9s→~110ms; IDB gets the live
  object; growth trim runs once/season at `frnNewSeason`); KR-return
  realism fixed (PR TDs were structurally impossible — spot clamp floored
  at the 1; ST table 3/3 in band; `sim_kr_avg_yds` re-baselined 24.4);
  Workstream C PAT seam (kick XP / go for 2, K/G/O keys); 43 display sinks
  escaped at sink; scout film reveals seeded (`_frand`).
- **Interactive playcalling** (single-player Workstream C.2) is live: run/
  pass + 4th-down (GO/FG/PUNT) + PAT (KICK/TWO) prompts via deterministic
  re-sim with an input tape; coach mode; protected by the CI invariant.
- **Playoffs → Week 17 bug**: root-caused and fixed (legacy
  `playoffs_pending` heals + tab-route guard).

## V1 — renderer unification: COMPLETE (`VISUAL_ENGINE.md` has the record)

**Where it landed:** live broadcast = `#field-pixi` (sleeping static WebGL
field) + `.gc-player-pixi` (the one per-frame WebGL render) + DOM
callouts/HUD; `#field` is clearRect-only in broadcast; `#field-uprights`
and `.gc-pixi-fx` exist only as no-WebGL fallbacks. PLAYING p50 **83ms**
headless software (was 470 pre-audit, 367 after steps 1-3); 60s soak
clean; occlusion + ragdoll-physics bugs dead by construction.

## V3 — replay clip shrink: COMPLETE (measure before building!)

The planned re-sim-from-seed machinery was never needed: motion tracks
were ~3-8KB/clip, not the assumed 180KB. The whale was `statsSnap` (full
live box score on every stored play, ~45KB × 3) + a duplicated highlight
play. Fixed by stripping at `_extractReplayClips` + a load-time backfill
(`_backfillReplayClips`) for existing saves; tracks kept (they ARE the
replay). Measured: clips 22.9MB → 1.10MB (21×), whole 4-week save
31.8MB → 9.97MB. Also fixed en route: `frnReplayClip` had NEVER worked —
`window.gameResult = …` writes don't touch top-level `let` bindings (it
needed bare assignments) and its synth gameResult lacked
`homeRatings`/`awayRatings`/`playerLookup` (now built from current
franchise rosters via `buildRatings`). Replays run slow-mo
(`speedMul = 0.5`); `_frnEnterLiveGameScreen` restores 1.0 + slider UI.

## V4 progress: pacing DECIDED + defensive seam SHIPPED

- **Pacing model (user-ratified, recorded in
  `INGAME_CLOCK_AND_MULTIPLAYER.md`):** simultaneous hidden calls per
  snap, server-anchored play-clock deadline (per-match parameter, ~20s
  default; deadline-as-data → async leagues reuse the system),
  advance-on-both-ready, AICoordinator fallback on timeout. Rejected:
  continuous wall-clock game clock; client lockstep.
- **Defensive coverage-shell seam (4th Coordinator seam):** engine asks
  `_coordinators[defendingSide]` with `kind:"defense"` at the top of
  every scrimmage snap (before the 4th-down branch — hidden-info
  correct). Shells = the six coverages; pass plays override the AI's
  coverage roll (roll still runs — defer = byte-identical, CI invariant
  extended), run plays shift the trench battle (blitz boom/bust via
  `_shellRun` shift+SD). Interactive runner prompts on defensive snaps
  (keys 1-6, O); plays carry `defShell` only when called.

## V4 progress 2: hosting DECIDED + C.3 server scaffold SHIPPED

- **Hosting (user-ratified):** plain Node + HTTP/SSE on a small VPS,
  zero npm deps, NO chain dependency in v1. MegaETH stays the
  asset/league/settlement layer; the deterministic artifact
  `{seed, teams, rosters, tape}` + its SHA-256 hash (computed at match
  end) is the future settlement bridge. Full rationale + rejected
  options recorded in `INGAME_CLOCK_AND_MULTIPLAYER.md` §C.3.
- **`server/` shipped:** `engine-host.js` (audit-style bundle loader —
  keep its FILES/shims in sync with `_sim_audit.js`), `h2h-server.js`
  (create/join → SSE decision loop → tape re-sim per call → play-clock
  timeout = AI defer → JSONL persistence → artifact endpoint),
  `h2h-probe.js` (two scripted clients, full match over the wire,
  go-silent window, independent re-sim reproduces score + hash),
  `h2h-recovery-probe.js` (SIGKILL mid-match → respawn → exact
  play-count + pending-seq restore → finishes to FINAL). Both probes
  ALL PASS; a full 289-decision match takes ~18s wall with zero-think
  clients.

## V4 progress 3: browser client WIRED — live H2H is playable end-to-end

`play-h2h-client.js` (loaded last in play.html): the network session
wears the `_ipc` interface, so the existing panels/keys/playback work
unchanged — SSE `decision` events land in `_ipc.pending`, `frnPlaycall`
gets a `mode === "net"` branch that POSTs to `/api/call` instead of
tape-pushing, `_ipcMaybePrompt` parks on a waiting banner (with the
opponent's play-clock countdown) instead of the FINAL screen, plays
stream in and resume playback. gameResult shell built from the server's
roster snapshots via `/api/setup` + client-side `buildRatings`. Entry:
🌐 Host H2H button in the dev/testing panel (share link =
`#h2h=matchId.joinCode.server`); join is automatic from the link in any
app mode. Coach mode = client auto-defers each prompt. Reconnect is
native EventSource + Last-Event-ID replay.
**Proof: `server/h2h-client-probe.js`** — two headless browsers play a
full match through the real UI (host button, share link, first prompt
answered by CLICKING the defense panel, autopilot to FINAL): identical
34-14 finals both sides, 254 plays streamed to both, FINAL screen
renders, zero page errors. Local interactive mode regression-checked.

## NEXT options
- **H2H follow-ups:** parallel same-snap decision windows (server-side
  optimization), wire-slim play slices (statsSnap ~45KB/play), host
  entry outside the dev panel, franchise-roster matches, deploy a real
  server + TLS.
- **V5 — realism + polish backlog:** one-score % (~42-43 vs NFL 44-52,
  warn-only), OT % (~3.2 vs 4-10), injury bands in `_brady_audit.js`;
  keyboard-only offseason run.

**The topology after V1** (back→front, all inside `.bspnlive-field-wrap`):
1. `#field-pixi` — WebGL via `GCField`: ALL static field art (grass/bands/
   EZ/yard-lines/numbers/midfield logo AND the sideline pads) + LOS/FD/
   red-zone chalk. **Renders ONLY on change**: static key is
   `home|away|camera`, dynamic key is `los|fd|color|pulseBucket`
   (red-zone pulse quantized to 10Hz), plus `_shadowsDirty` (topdown
   shadows still live here; in broadcast this stage SLEEPS).
2. `#field` — canvas2D, broadcast = clearRect only. Still hosts: topdown
   sprites, cinema view, celebrations (cinema-only), dynamic-chalk +
   static-blit + weather fallbacks (`_fieldStaticCache` is fallback-only
   now). Deleting the node outright needs the topdown + cinema ports
   (V2+, no perf urgency).
3. `.gc-player-pixi` — WebGL via `GCPlayer`, THE per-frame render.
   Bottom-to-top: `under` container (ground Graphics: player shadows +
   run/ball trails, projected per point — `projectBroadcast` IS the CSS
   tilt and scaleY(1/cosθ)·cosθ = 1, so field-plane shapes map exactly;
   then GCFx weather precip), `_stage` (players/ball/goalposts,
   zIndex = projected screenY; ragdolls apply physics rot/dy ON the
   sprite about the foot anchor), `fxStage().root` (GCFx particles +
   broadcast chrome). One render per frame in `frameEnd()`. Visible in
   topdown too (FX/weather); `setCameraMode` calls
   `GCPlayer.hideSprites()` (also clears the ground layer) there.
4. DOM: `#fieldCalloutLayer` — 1700×720 design-space div scaled onto the
   wrap box (`_fcSyncScale` + ResizeObserver): HIKE!/MOTION!/AUDIBLE!
   banners, personnel/def chips, cadence, result card. Plus
   `#fieldWeatherBadge`. `startNextPlay`/`_scrubTo` call `_fcClearAll()`
   (DOM doesn't self-clear like canvas pixels).
   Fallbacks: `#field-uprights` no longer exists in the layout —
   `_frameStartBroadcast` lazily materializes it ONLY when the player
   layer is down (billboard sprite queue + canvas goalposts); GCFx then
   also runs standalone on its own `.gc-pixi-fx` canvas; drawField keeps
   a canvas weather block gated on `GCFx.weatherHandled()`.
   Flags: `window._useFieldPixi`, `window._usePlayerPixi` (both default
   true; toggling them is how the on/off comparison was shot).
   FX draw order: `_frameEndBroadcast(ctx)` flushes the canvas sprite
   queue → `GCFx.draw` (updates display objects) → `GCPlayer.frameEnd()`
   (the single WebGL render).

**Shadow-probe gotcha** (cost a debugging detour): pre-step-4 shadows
composited one frame LATE (stage rendered at frame start), so
single-frame probe renders never showed them — a before/after pixel diff
reads "shadows appeared" as a 7% regression. Compare live frames, or
remember the baseline is shadowless in probes.

**Frame-cost record** (headless software raster, GPU clients far cheaper):
PLAYING p50 470 (pre-audit) → 381 (static cache) → 367 (V1 steps 1-3) →
**83ms** (V1 step 4); p95 117, 60s soak stable. Idle/paused = 16.7ms.

**After V3:** V4 C.3 netcode design (+tempo seam; needs product
decisions), V5 realism nits (one-score ~42 vs 44-52, OT ~3.2 vs 4-10,
injury bands) + keyboard-only offseason run.

## Verification recipes that keep paying off

- **Screenshot comparison** for visual work: pause the same frame, toggle,
  `page.screenshot({clip})`, eyeball + pixel-compare.
- **Frame decomposition**: rAF-delta sampler (p50/p95/max) + monkeypatch
  no-op of suspect functions (GCField.draw, drawPlayer, drawField) to
  attribute cost; CDP `Profiler` for native-vs-JS split.
- **Interactive-playcall invariants**: outcome-prefix byte-identity =
  compare `plays` JSON **with `motion` stripped**; the CI invariant
  (deferring coordinator == none) is metric `sim_interactive_invariant`.
- **Determinism harness**: snapshot `JSON.stringify(franchise)` → sim →
  restore → sim → deep-diff minus cosmetic keys (news/chat/storylines/
  highlights/replayClips/_saveStamp/potwCandidates).
- **WCAG walker**: alpha-composite bg up ancestors; composite gradient
  STOPS over the underlying bg (translucent white overlays poison naive
  averaging); `color(srgb …)` returns 0-1 floats. `_teamInk` for TEXT only.
- **Synthesized-save testing**: hand-set `franchise.phase`/brackets, call
  `showFranchiseDashboard()`, assert the rendered screen.

## Conventions

- Commit messages end with the session URL line; never put the model id in
  commits/PRs/code. Push branch, then fast-forward `main` (standing).
- Scratch scripts are `_c_*.cjs` at repo root or `/tmp` — delete before
  committing (a Stop hook flags untracked files). One-off probes live in
  `tools/`; root `_*` files are the live audit gate + calibration suites.
- Findings → fixes split; every fix ships with its detector; the audit
  gate is law for anything engine-adjacent.

---

That's it. Pick an H2H follow-up (parallel windows / wire-slimming /
deploy), or say **"start V5"** (realism nits + keyboard-only offseason).
