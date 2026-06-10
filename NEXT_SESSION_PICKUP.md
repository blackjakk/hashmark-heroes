# Next-session pickup message

Paste this verbatim into the next chat to resume. **V1 (renderer
unification) is COMPLETE — all 4 steps. Next arc: V3 replay-motion-from-
seed (~10× save shrink), per `VISUAL_ENGINE.md`.** V2 (perf) was realized
by step 4: PLAYING p50 367→**83ms** headless software (4.4×; was 470 at
the start of the audit era).

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

## NEXT: V3 — replay motion from seed (~10× save shrink)

Stop storing `play.motion` (~180KB of waypoints per replay clip); store
`(seed, week, teams, playIndex)` and re-sim the play on demand. The
determinism harness + the interactive runner's re-sim machinery already
prove the pattern (fresh seeded sim + tape replay, byte-identical). Mind:
`_deriveGameSeed` per game / `_withWeekRng` per week; motion is
display-only and stripped in outcome-prefix comparisons. After V3: V4
netcode design (needs product decisions), V5 realism nits + keyboard-only
offseason.

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

That's it. Say **"start V3"** (replay motion from seed — drop stored
waypoints, re-sim clips on demand).
