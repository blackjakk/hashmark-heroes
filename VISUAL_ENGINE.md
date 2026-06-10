# Visual Engine — Assessment & Roadmap

> Written after the full codebase audit (see `CODEBASE_AUDIT_PLAN.md`), with
> fresh measurements. The question answered here: **is the visual engine the
> right architecture, and what should the rest of the roadmap be?**

---

## 1. What the visual engine actually is

~20k lines across 9 files:

| Piece | Lines | Role |
|---|---|---|
| `play-animation.js` | 11.3k | The tick loop + **~8.4k lines of per-play choreography** (how 22 players move per play kind), camera/projection (~470), theatrics (faces/taunts/confetti/result cards, ~880), scrubber/segments |
| `play-render.js` | 4.4k | `drawField` (now static-cached) + `_drawPlayerImpl` (~1k lines of canvas player art) + projection helpers |
| `play-broadcast.js` | 1.7k | DOM presentation layer (scoreboard, HUD, live bio, ticker) |
| `play-fx.js` | 0.9k | Canvas2D particles + screen shake (explicitly designed to re-point at PIXI later) |
| `play-sprites.js` | 0.7k | Sprite atlas + pixel-precise team tinting (cached) |
| `play-field-pixi.js` | 0.4k | WebGL field: tilted broadcast grass/lines/EZ + shadows + dynamic LOS |
| `play-player-pixi.js` | 0.3k | WebGL players: pose-state → cached texture (sourced from `_drawPlayerImpl`) → one sprite per player |
| `play-motion.js` | 0.1k | Track sampler for engine-emitted `play.motion` waypoints |

**The render topology is a 4-canvas, two-technology sandwich** (back→front):
`#field-pixi` (WebGL field + shadows) → `#field` (canvas2D: weather,
callouts, ragdolls, celebrations) → `#field-uprights` (canvas2D: goalposts +
GCFx particles) → `.gc-player-pixi` (WebGL player/ball sprites), under a DOM
HUD. The engine emits per-play waypoint tracks (`play.motion`); the tick loop
samples them and draws.

## 2. The decisive finding

Screenshot the same paused frame with the PIXI layers on vs off:

- **PIXI on** = the broadcast view: tilted perspective field, perspective-
  scaled sprites, shadowing. This is the product's signature look.
- **PIXI off** = the flat legacy tactical view.

**The WebGL layer is not optional gloss — it IS the broadcast presentation.**
The canvas2D path is the pre-broadcast fallback. The two paths are not visual
parity; they are two different products. That kills the "retreat to
canvas-only" option: the only sensible direction is to **finish the
migration**, not unwind it.

## 3. Verdict — is this what we'd build?

**The core decisions are right and worth keeping:**

1. **Sim-owned motion** (engine computes waypoint tracks; renderer is a dumb
   sampler). This is the architecture that makes replays, determinism, the
   headless audit, and interactive re-sim possible. Greenfield would build
   exactly this.
2. **The sprite-atlas bridge** (pose-state → cached texture rendered once by
   the existing 1k-line canvas art, drawn by PIXI as sprites) — the
   pragmatic alternative to rewriting the art in GL primitives, and how real
   sprite games work.
3. **DOM for text/HUD**, canvas only for the field. Correct.
4. **Choreography as the bulk** (8.4k lines) is content, not accidental
   complexity — any engine would carry it.

**What we would not build — and should now fix:**

1. **The 4-canvas WebGL→2D→2D→WebGL sandwich.** It's a migration parked at
   ~60%, and the seams are where the measured costs and the bug-classes
   live: the full WebGL stage re-render every frame exists to composite
   shadows written from the canvas-side player loop (~150ms/frame software);
   ragdolls bypass the sprite layer; the player canvas mounts *above* the
   uprights overlay (occlusion-order trap); four composites per frame; every
   new feature must pick a layer.
2. **The motion payload** (~180KB/clip of raw waypoints) — a verbosity
   symptom; determinism now allows regenerating it from seed+inputs.

## 4. Roadmap — the rest, in order

### V1. Finish the renderer unification (the big one, ~2-3 sessions)
Target: **one WebGL stage + DOM HUD.** Steps, each independently shippable:
1. **Particles + uprights → PIXI** — **DONE.** GCFx's containers now parent
   onto the GCPlayer application's stage (one WebGL context; the separate
   z-index-4 `.gc-pixi-fx` canvas is gone when the player layer is up) and
   the goalposts are depth-sorted stage children (`zIndex` = projected base
   Y, the same key player sprites sort on) — the occlusion-order trap died
   by construction; verified by a player-behind-the-post scene. Standalone
   FX app + canvas2D goalposts remain as the no-player-PIXI fallback.
   `#field-uprights` itself survives to step 2: pre-snap callouts and
   result cards still draw there (they're step 2's cargo).
2. **Weather + callouts + result cards → PIXI/DOM** — **DONE** (shipped
   together with step 3; the canvas retirement required it). Pre-snap
   callouts (HIKE!/MOTION!/AUDIBLE! banners, personnel/def chips, cadence)
   and result cards are DOM in `#fieldCalloutLayer` — a 1700×720
   design-space div scaled onto the wrap box, camera-independent, no
   canvas fallback needed. Weather precip/wind renders on a PIXI layer
   UNDER the player stage (GCFx, exact port of the canvas math); the
   weather badge is DOM. `#field-uprights` is out of the layout — only
   the no-WebGL fallback lazily materializes it.
3. **Ragdolls → GCPlayer textures** — **DONE.** The physics state is
   stripped before texture render (the cache key never could carry it)
   and applied per frame on the sprite: `rotation` about the foot anchor
   + the integrated drop as a position offset — the same transform the
   canvas2D path applied around the same pivot. Verified rot/dy integrate
   frame-over-frame on live tackles.
4. **Collapse** — **DONE in effect** (the goal was the perf + the seam,
   not the DOM node): the live broadcast frame no longer paints ANY
   canvas2D and the field stage sleeps. Concretely: all static field art
   (incl. the sideline pads) lives on GCField, which now renders ONLY on
   change (team/camera key, chalk-state key, red-zone pulse quantized to
   10Hz, or dirty topdown shadows) — the per-frame cross-tech shadow
   compositor is gone because player shadows + run/ball trails moved to
   a ground layer on the GCPlayer stage, projected per point
   (`projectBroadcast` IS the CSS tilt, and scaleY(1/cosθ)·cosθ nets
   1.0, so field-plane shapes map exactly — verified). `#field` in
   broadcast is clearRect-only. **Measured: PLAYING p50 367→83ms
   headless software (4.4×), 60s soak clean.**
   Not done (deliberately): the literal `#field` node stays for topdown
   sprites, cinema view, celebrations (cinema-only), and the no-WebGL
   fallback; `#field-pixi` and `.gc-player-pixi` remain two canvases
   because the field's broadcast tilt is CSS on the field canvas while
   sprites are billboards — a true single-canvas merge needs in-stage
   perspective (mesh/projection), which is V2+ work with no perf urgency
   left.
Acceptance: pixel-comparable screenshots; the per-frame double composite and
shadow round-trip disappear from the frame decomposition; uprights occlusion
verified.

### V2. Perf pass 2 — LARGELY REALIZED by V1 step 4
PLAYING p50 went 470 (pre-audit) → 381 (static cache) → 367 (steps 1-3) →
**83ms** (step 4) in headless software raster; GPU clients sit at 60fps.
Remaining V2-flavored work, only if someone asks for it: port topdown
sprites + cinema view off `#field` (then actually delete the node), and a
true single-canvas merge via in-stage perspective.

### V3. Replay motion from seed (~10× save shrink)
Stop storing `play.motion` in replay clips; store `(seed, week, teams,
playIndex)` and re-sim the play on demand (determinism + the interactive
runner's re-sim machinery already prove the pattern). Plan §B's last ticket.

### V4. Workstream C.3 — netcode design, then build
Server-authoritative live H2H per `INGAME_CLOCK_AND_MULTIPLAYER.md`. Needs
product decisions first (pacing: snap-clock vs turn-based; hosting). The
tempo-decision seam can land alongside (same pattern as 4th-down/PAT).

### V5. Realism + polish backlog (small, anytime)
One-score % (~42 vs NFL 44-52) and OT % (~3.2 vs 4-10) tuning;
injury-rate-by-position bands in `_brady_audit.js`; keyboard-only offseason
playthrough (§F's unfinished pass criterion).

---

*Standing rules carry over: the audit gate is law for anything
engine-adjacent; visual changes verify by screenshot comparison; every fix
ships with its detector.*
