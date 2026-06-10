# Next-session pickup message

Paste this verbatim into the next chat to resume. **Next task: V1 step 4 —
collapse to one WebGL canvas (see `VISUAL_ENGINE.md`). V1 steps 1-3 are
DONE:** GCFx + goalposts + ragdolls on the shared GCPlayer stage; weather
on a PIXI under-player layer; callouts/result cards/weather badge are DOM;
`.gc-pixi-fx` is gone and `#field-uprights` is out of the layout (lazy
no-WebGL fallback only). See the updated topology below.

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

## NEXT: V1 — renderer unification (`VISUAL_ENGINE.md` has the full plan)

**Verdict recap:** sim-owned motion tracks + sprite-atlas bridge + DOM HUD
are keepers. The **4-canvas WebGL→2D→2D→WebGL sandwich** is a migration
parked at ~60% — and the PIXI layer IS the broadcast look (tilt/
perspective); the canvas path is the flat legacy view (screenshot-proven).
Direction: finish the migration to **one WebGL stage + DOM HUD**.

**The topology after steps 1-3** (back→front, all inside
`.bspnlive-field-wrap`):
1. `#field-pixi` — WebGL via `GCField` (play-field-pixi.js): tilted grass/
   bands/EZ/yard-lines (memoized on team key but `_app.renderer.render()`
   runs EVERY frame as the cross-tech shadow compositor), `addShadow`/
   `clearShadows` (shadows written from the canvas-side player loop),
   `drawDynamic` (LOS/FD, state-keyed).
2. `#field` — canvas2D: static blit from `_fieldStaticCache` + dynamic
   chalk fallback, topdown sprites, celebrations/confetti-rain overlays,
   cinema view, run/ball trails. THE step-4 deletion target.
3. `.gc-player-pixi` — WebGL via `GCPlayer` (play-player-pixi.js): the
   shared stage. Bottom-to-top: `under` container (GCFx weather precip),
   `_stage` (players/ball as pose-state-cached textures + goalposts as
   depth-sorted Graphics, zIndex = projected screenY; ragdolls apply
   physics rot/dy ON the sprite about the foot anchor), `fxStage().root`
   (GCFx particles + LED ribbon/beams/badges/flash/chyron). One render
   per frame in `frameEnd()`. The canvas stays visible in topdown (FX +
   weather); `setCameraMode` calls `GCPlayer.hideSprites()` to drop the
   broadcast-projected objects there.
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

**V1 steps (verify by screenshot comparison):**
1. **DONE — Particles + uprights → PIXI stage** (p50 383→367ms headless).
2. **DONE — Weather → PIXI under-layer; callouts/cards/badge → DOM.**
3. **DONE — Ragdolls → GCPlayer** (physics applied on the sprite, never
   baked into the texture cache).
4. **Collapse**: static field as a PIXI RenderTexture; move/port the
   remaining `#field` cargo (celebration overlays, topdown sprites,
   cinema view, trails); delete `#field`; one WebGL canvas + DOM remains.
Acceptance: pixel-comparable screenshots; frame decomposition loses the
double composite + shadow round-trip (probe pattern below); uprights
occlusion verified; audit gate untouched (no engine files involved).

**Frame-cost context** (headless software raster, GPU clients far cheaper):
PLAYING p50 381ms = sprites ~180 + PIXI stage re-render ~150 + rest ~50.
Idle/paused = 16.7ms. V2 (perf) is expected to mostly fall out of V1.

**After V1:** V3 replay-motion-from-seed (~10× save shrink — stop storing
~180KB waypoints/clip, re-sim on demand), V4 C.3 netcode design (+tempo
seam), V5 realism nits (one-score ~42 vs 44-52, OT ~3.2 vs 4-10, injury
bands) + keyboard-only offseason run.

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

That's it. Say **"start V1 step 4"** (collapse to one WebGL canvas:
static field as a PIXI RenderTexture; port the remaining `#field` cargo;
delete `#field`).
