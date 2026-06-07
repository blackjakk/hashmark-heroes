# Player Portraits

This folder holds pre-generated anime/manga-style player portraits.

## How to populate

1. Open ChatGPT (the one with DALL-E built in — Plus or any free model that
   has image generation enabled).
2. Paste the MASTER PROMPT below, then ask it to generate one portrait at a
   time, working through the VARIATIONS list. About 60-100 portraits is
   plenty.
3. Download each result and save it here as `p001.png`, `p002.png`, ...,
   `p099.png`, `p100.png`, etc. Use 3-digit zero-padded numbers so they sort
   nicely.
4. Refresh the game — players will be auto-assigned a portrait based on a
   deterministic hash of their name + position.

## Master prompt

> Anime/manga style portrait of a stoic male professional athlete. Passport
> photo composition: head and shoulders, front-facing, slightly off-center,
> ID-photo proportions. Dark vertical-gradient background (charcoal to deep
> navy). He wears a high stand-collar military uniform (gakuran/Prussian
> dress-uniform style) — black with gold trim along the collar and small
> gold buttons down the center. Sharp angular face, narrow eyes, serious
> expression, manga-style ink shadow. 1990s seinen manga look (e.g. Slam
> Dunk, Vagabond, Yu-Gi-Oh duelists, Initial D characters). No text, no
> logos, no watermark.

## Variations to ask for

Run through these — each one produces a distinct character that fits the
same universe. Mix and match.

### Hair (cycle through)
- Center-parted shoulder-length black hair
- Spiky black hair, gravity-defying
- Slicked-back hair with single forelock
- Short buzz cut
- Long ponytail
- Side-swept bangs covering one eye
- Wavy dark brown hair past the ears
- Dyed silver/platinum messy hair
- Bleached blonde with dark roots
- Bright red hair, anime protagonist style
- Shaved sides + top knot
- Bowl cut, neat
- Wild long mane
- Cornrows (manga interpretation)
- Box braids tied back
- Dreadlocks tied back

### Skin tone
- Pale East Asian
- Tan East Asian
- Light brown / Latino
- Brown / Black
- Deep brown / dark complexion

### Expression
- Stoic, neutral, dead-eyed stare
- Intense scowl, furrowed brows
- Calm, knowing smirk
- Confident half-smile
- Battle-ready glare
- Slight sad/thoughtful look
- Cocky grin (one corner up)

### Eye color
- Black
- Dark brown
- Hazel
- Steel grey
- Sharp blue (rare)
- Glowing red (very rare, give to villain types)
- Emerald green (rare)
- Heterochromia: one blue, one brown (extremely rare, save for one character)

### Age vibe
- Young rookie (early 20s, fresh)
- Mid-prime (late 20s, focused)
- Grizzled veteran (early 30s, scar or stubble)
- Old master (mid-30s, deeply lined)

### Optional accessories (only on some characters, keeps variety)
- Diagonal scar across left cheek
- Eyepatch
- Earring (single)
- Stubble / goatee
- Bandage on forehead
- Cigarette (held in teeth, manga noir vibe)
- Slight smirk + chipped tooth visible
- Tattoo creeping up the neck above the collar

## Naming convention

Group portraits by position in subfolders:

```
portraits/
  QB/   p001.png  p002.png  ...
  RB/   p001.png  p002.png  ...
  WR/   p001.png  ...
  TE/   p001.png  ...
  OL/   p001.png  ...
  DL/   p001.png  ...
  LB/   p001.png  ...
  CB/   p001.png  ...
  S/    p001.png  ...
  K/    p001.png  ...
  P/    p001.png  ...
```

Each player is hashed by name into the file `pNNN.png` within their
position's subfolder. You don't need to fill every position equally — a
position with 20 files just cycles through those 20 (any missing file
falls back to the canvas-drawn portrait).

PNG preferred (transparent or solid background both fine). 256×256 or
square aspect — the in-game render box is 78×88 and will downscale.

## Where they show up

Portraits appear in the player tooltip / profile hover. Anywhere we
showed the canvas-drawn mugshot, you'll now see the AI-generated one.
