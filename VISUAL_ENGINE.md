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
1. **Particles + uprights → PIXI** (`GCFx` was designed for this re-point;
   uprights become stage children with correct z so the occlusion-order trap
   dies by construction).
2. **Weather + callouts + result cards → PIXI/DOM** (text cards are better
   as DOM anyway).
3. **Ragdolls → GCPlayer textures** (the one pose still on canvas2D).
4. **Collapse canvases**: static field becomes a PIXI RenderTexture (the
   §E static cache, GPU-side); delete the `#field` and `#field-uprights`
   canvases.
Acceptance: pixel-comparable screenshots; the per-frame double composite and
shadow round-trip disappear from the frame decomposition; uprights occlusion
verified.

### V2. Perf pass 2 — falls out of V1
Sprite batching becomes native PIXI; the ~150ms shadow composite and ~180ms
software sprite cost collapse into one GPU pass. Only do targeted work here
if V1's numbers say so.

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
