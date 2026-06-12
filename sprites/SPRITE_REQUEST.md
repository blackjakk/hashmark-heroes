# Sprite generation request — contact-moment upgrade pack

Four new animation sets that lift the throw + catch from "pose swap" to
real contact animation. The renderer is **already wired** for all four:
drop the frames into `sprites/<pose>/` (via `_extract.py`) and they go
live on refresh — no code changes. Until they exist, the game keeps its
current behavior.

## How to generate (PixelLab, v3 animation mode)

- **Character:** the base "Default" character (`6f395002`) — same one the
  run/idle/catch sets use, so style and proportions match.
- **Mode:** 8-direction animation, 4 frames (the standard template).
- **IMPORTANT — prompt naming:** start each animation prompt with the
  exact token below (e.g. `qb_release: …`). The downloaded folder name is
  slugged from the prompt, and `sprites/_extract.py` maps it by that
  prefix.
- When done: download the ZIP(s) into `sprites/`, run
  `python3 sprites/_extract.py`, refresh the game.

---

## 1. `qb_release` → sprites/throw_release/  (the missing throw release)

Quarterback releasing a pass. **Empty hands in every frame — no ball**
(the engine draws the real ball leaving the hand).

- **frame 1:** throwing arm whipping forward beside the helmet, elbow
  leading, chest opening toward the target, back foot driving
- **frame 2:** arm fully extended forward at shoulder height, fingers
  spread (ball just released), weight on the front foot
- **frame 3:** follow-through — throwing arm swept down across the body,
  shoulders rotated through, back heel off the ground
- **frame 4:** recovering to balanced stance, both arms relaxing, eyes
  downfield

Suggested prompt: `qb_release: quarterback throwing motion follow
through, empty hands no ball, arm whips forward then sweeps across body,
football uniform`

## 2. `high_point_catch` → sprites/catch_high/  (jump ball)

Receiver high-pointing a catch at the apex of a jump. Ball appears only
in frames 3–4.

- **frame 1:** knees bent, arms loading down-back, eyes up (gather before
  the jump)
- **frame 2:** airborne, body extended, both arms fully stretched
  overhead, hands open, **no ball yet**
- **frame 3:** ball secured in both hands above the helmet, body still
  airborne, legs trailing
- **frame 4:** landing — knees absorbing, ball pulled down to the chest
  with both arms

Suggested prompt: `high_point_catch: football receiver leaping vertical
jump catch, arms stretched overhead, catches ball at highest point, lands
pulling ball to chest`

## 3. `over_shoulder` → sprites/catch_over_shoulder/  (in-stride deep ball)

Receiver catching over his shoulder **without breaking stride** — running
posture in every frame. Ball appears in frames 3–4.

- **frame 1:** full running stride, head turned looking back over the
  shoulder
- **frame 2:** still striding, both arms raised up-and-back forming a
  basket over one shoulder, hands open, **no ball yet**
- **frame 3:** ball settling into the hands over the shoulder, still
  running
- **frame 4:** ball tucked under the near arm, head turning forward,
  back to a sprint

Suggested prompt: `over_shoulder: football receiver running catching ball
over shoulder without stopping, looking back while sprinting, ball lands
in hands then tucked, full stride`

## 4. `low_scoop` → sprites/catch_low/  (shoetop grab)

Receiver scooping a low throw at the shoetops. Ball appears in frames
2–4.

- **frame 1:** bending sharply at knees and waist, arms shooting down,
  fingers near the grass
- **frame 2:** hands slid under the arriving ball just off the turf
- **frame 3:** ball cradled low against the shins/knees, body still bent
- **frame 4:** rising back upright, ball being tucked away

Suggested prompt: `low_scoop: football receiver bending low scooping
catch at shoe level, hands under ball near ground, rises tucking ball`

---

## Generating with ChatGPT instead (sprite-sheet path)

Works fine — the slicer (`sprites/_slice_sheet.py`, needs Pillow) cuts a
grid sheet into the game's per-frame files. The rules that matter:

1. **Match the existing character.** Attach 2–3 reference frames to the
   chat (e.g. `sprites/run/east_0.png`, `sprites/idle/south.png`,
   `sprites/catch/east_3.png`) and say: *"match this exact pixel-art
   character — same proportions, palette, helmet, and pixel density."*
   Style drift is the #1 risk; judge the first sheet harshly.
2. **WHITE jersey, always.** The game tints team colors by replacing
   white pixels — a colored jersey breaks every team's look.
3. **Transparent background** (or a flat solid color — the slicer
   flood-fills it away from the corners). NO checkerboard patterns.
4. **Grid layout, equal cells:** one POSE per sheet, **rows =
   directions** top-to-bottom, **4 columns** = the 4 frames left-to-right
   (frame descriptions in each section above).
5. **You only need 5 directions** — rows in this order:
   `south, north, east, south-east, north-east`.
   The renderer mirrors the west side from the east side automatically.
   (Generate all 8 if quality holds; row order then must be
   `east, north-east, north, north-west, west, south-west, south,
   south-east`.)

Then per sheet:

    python3 sprites/_slice_sheet.py qb_release.png throw_release \
        --dirs south,north,east,south-east,north-east

…and refresh the game. Start with ONE pose (`throw_release`), check it
in a live game before generating the rest.

Suggested ChatGPT prompt skeleton:

> Using the attached pixel-art football player as the exact character
> reference (same proportions, palette, white jersey, pixel density),
> generate a sprite sheet on a transparent background: 5 rows × 4
> columns of equal-size cells. Each row is the same 4-frame animation
> seen from a different angle, rows top to bottom: facing camera
> (south), facing away (north), facing right (east), facing
> down-right (south-east), facing up-right (north-east).
> The animation, frame by frame: [paste the 4 frame descriptions from
> the section above].

## Wiring already in place (for reference)

| Set | Used by | Fallback until art exists |
|---|---|---|
| throw_release | QB release window (tf·0.55→0.80), single-fire | empty-hand idle swap + streak |
| catch_high | high-point variant (leap window + lift) | generic `leap` alias |
| catch_over_shoulder | in-stride variant, full 0→1 timing | late-reach on generic catch art |
| catch_low | registered, not yet routed (needs arrival-height data) | — |

Registration: `_SPRITE_POSES` in `play-sprites.js` (`optional: true` — a
single probe request at boot; the full set loads only once frame files
exist). Live check from devtools: `SpriteAtlas.hasPose("throw_release")`.

---

# Character v2 — FULL REPLACEMENT (optional, user-approved direction)

If ChatGPT produces a nicer character than the current PixelLab one, the
whole cast can migrate. The engine supports this **pose-by-pose** via a
parallel tree — nothing breaks mid-migration:

- Slice new-character sheets with `--out sprites2` — the slicer keeps
  `sprites2/manifest.json` up to date, and the game loads any pose listed
  there from `sprites2/`, **falling back to the current art for
  everything else**.
- Instant rollback from devtools: `localStorage.GC_SPRITE_V2 = "off"`
  then reload (delete the key to re-enable).
- Caveat while partially migrated: two art styles share the field. Get
  through Wave 1 quickly or expect a mixed look.

## Step 0 — lock the character (do this FIRST)

Generate ONE image: the new character standing idle, seen from all 8
directions in a row (a "turnaround sheet"), 104px-scale pixel art,
**white jersey, grey pants, transparent background**, proportions close
to the current character (body ≈ 30-40px of the 104px frame, feet near
the bottom). Iterate until you love it — then **attach this turnaround
to EVERY subsequent generation** as the character reference. This is the
single biggest factor in cross-sheet consistency.

Renderer contract the character must keep:
- white jersey (team tint replaces white pixels)
- feet at the bottom-center of the cell (the foot anchor, ball-hand
  offsets, and nameplates are tuned to that)
- similar overall proportions — a much taller/wider body needs constant
  retuning (possible, but say so and we'll do it deliberately)

## Frame counts — yes, MORE frames where they matter

The engine reads frame count per pose from the manifest, so new sets are
not stuck at 4. Use:

| Tier | Poses | Frames |
|---|---|---|
| Contact moments | throw_release, catch_high, catch_over_shoulder, catch_low, hit/tackle, juke | **6** (`--cols 6`) |
| Cycles | run, carry, backpedal, kick_slide, stance | **4** — they loop fast; 4 reads fine at this scale |
| Single poses | idle | 1 |

(6-column sheets: watch that ChatGPT keeps every cell the same size —
ask for "equal-size cells in a strict grid".)

## Migration waves (priority order)

**The ball rule:** the engine draws the REAL ball whenever it's in the
air / loose / spotted, and hides it whenever a sprite visibly holds one.
So paint a ball ONLY in frames where the player possesses it — a ball in
the wrong frames = double ball on screen; a missing ball in carry frames
= the carrier runs empty-handed.

1. **Wave 1 — 90% of screen time:**

   | sheet | frames | ball |
   |---|---|---|
   | idle | 1 | no |
   | run | 4 | NO — used by every player, not just carriers |
   | carry | 4 | YES, all frames, tucked under one arm |
   | stance | 4 | no |
   | pass (throw windup) | 4 | YES, all frames — cradled → cocked at the ear |
   | throw_release | 6 | NO — empty hands every frame (real ball launches at release) |
   | catch | 6 | frames 1-3 NO (track/reach, hands open) → frames 4-6 YES (secure/tuck) |

2. **Wave 2 — contact:** fall (tackled — no ball), tackled_carry (ball
   wrapped, all frames), block (no), tackle (no), ragdoll (no),
   backpedal (no), kick_slide (no), qb_scramble (ball in both hands /
   tucking, all frames), drop_step (ball cradled, all frames).
3. **Wave 3 — flavor:** juke / spin / truck / stiff_arm / hurdle /
   tumble / spin_fall / qb_carry (ball, all frames); jam / celebrate /
   scrape / release / dodge / strip_swat (no ball); kick + handoff
   (ball per the action); refs (no ball).

Slice command per sheet (note `--out sprites2` and the folder name —
use the FOLDER names from this table, e.g. the throw windup is `pass`,
tackled is `fall`):

    python3 sprites/_slice_sheet.py wave1_run.png run \
        --dirs south,north,east,south-east,north-east --out sprites2

### Future (bigger ask, discussed separately)
Torso/legs **layered** sets for throw-on-the-run and catch-in-stride
composition — needs the same characters exported as separate torso and
legs layers per frame. Hold off until the waves above are judged.
