# hashmark-heroes — agent notes

Vanilla HTML/CSS/JS football franchise sim. No build step, no framework.
Rendering: PIXI 7.4.0 layer for players + canvas field. Entry: `play.html`.

## Ship workflow (every push)

1. `node --check <file>.js` after every JS edit.
2. Run the gates (all must pass):
   - `node _audit_gate.js --fast` — sim drift, 0 drift required (3 metrics ±tolerance).
   - `./_teleport_gate.sh` — egregious ≤4, runaway ≤4 (seed=1337, 4 games).
   - `node tools/_anim_pose_audit.js` — 27 animation families, 0 flags required.
   - `node tools/_playsheet_probe.js` (28 checks) / `tools/_catch_matrix_probe.js` (9) /
     `tools/_ipc_clock_probe.js` (19) when touching plays/catching/clock.
3. **`./tools/_stamp_build.sh`** before any push that changes JS or art — rewrites
   `?v=` stamps in play.html and `window.GC_BUILD` (play-sprites appends it to all
   sprite/manifest URLs). Without this, browsers serve stale mixes.
4. Develop on `claude/charming-cray-ggpd7f`, commit, then:
   `git push -u origin claude/charming-cray-ggpd7f && git push origin claude/charming-cray-ggpd7f:main`
   (main is always fast-forwarded). User uploads sprite sheets to main via GitHub
   web upload — fetch/merge those in before pushing.

## Engine invariants

- Coordinator seam: named play calls (PASS_CONCEPTS, RUN_CALL_VARIANTS, READ_OPTION,
  REVERSE, FLEA_FLICKER, RPO, HAIL_MARY...) override **roll results only**. Every RNG
  draw must still execute so defer/no-coordinator stays byte-identical (gate-safe).
- FIELD: W:1700 H:720 TOP:50 BOT:670 PX_PER_YARD:15, cy=360.
- drawPlayer vertical clamp: `FIELD.TOP - 6` / `FIELD.BOT + 24` (band-aid for an
  out-of-bounds lineup bug whose root cause was never found — see Pending).

## Sprite system (v2 character migration — LIVE)

- v1 atlas `sprites/`, v2 in `sprites2/` (ChatGPT-generated character). Waves 1+2
  done: 16 pose sets ≈95% of screen time. Kill switch: `localStorage.GC_SPRITE_V2="off"`.
- `sprites2/manifest.json` = `{pose_or_folder: frames}`; `_applyV2Manifest` in
  play-sprites.js matches by pose key OR folder (covers aliases: reach/catch/leap→
  "catch", throw→"pass", tackled/sack→"fall"). Optional-pose probes must NEVER
  overwrite a manifest-granted true.
- Mirror fallback: 5-direction minimum (south, north, east, south-east, north-east);
  west family flips at draw (rotation applied before flip).
- Tint (`_tintedSprite`): near-white pixels (r,g,b>170, spread<30) → team color,
  brightness cel-banded to 1.0 / 0.86 / 0.72.
- Textures: 2x supersampled canvas (TEX_SS=2, smoothing off) + `_crispTexture`
  (resolution 2, LINEAR, mipmaps). PIXI app resolution `min(2, devicePixelRatio)`,
  autoDensity. Don't revert to NEAREST (frays) or plain LINEAR (shimmers).

### Slicing new sheets

```
python3 sprites/_slice_sheet.py "sprites/v2_src_X.png" X --cols N \
  --dirs south,north,east,south-east,north-east --out sprites2
```

Pipeline: remove_bg (flood + light-family checkerboard acceptance; dark outline is
the protection boundary) → defringe(2) → alpha-projection band detection (NOT equal
grid division — AI sheets are uneven) → scale-normalize body to ~50px (BODY_H=50,
feet pinned FOOT_Y=76) → head-centroid x-anchor for upright figures → per-frame
defringe(1) → despeckle(min_size=25) → reink (bare edge pixels → ink) → 104×104
frames + manifest merge. Source sheets committed as `sprites/v2_src_*.png`.
Generation spec/prompts/ball rules: `sprites/SPRITE_REQUEST.md`.

## Head consistency (sprites/_fix_heads.py)

AI sheets draw the same figure helmeted in some frames, bare-headed in others
(the "helmet color in and out" bug). After ANY re-slice, run
`python3 sprites/_fix_heads.py` — most-helmeted frame per pose×dir donates its
head to bare frames (validated: head zone ≤50% of body, pixel growth ≤35%).
celebrate + kick_slide are excluded (raised arms / non-head whites break the
shoulder heuristic). run/north-east_0 source art is malformed — after re-slice,
copy north-east_2 over it. reink now floods OUTSIDE transparency from the
border: seals interior arm/torso pockets with ink, inks+dilates only the true
silhouette (interior dilation made seams 3px dark veins).

## Pending

- User QA outstanding: helmet color stability (head transplants), wave 3 poses
  in live play, OOB catch piles (targetY clamp ∈ [TOP+9, BOT-9]).
- Known leftover art quirks: run/east heads keep a dark hair tuft from source;
  strip_swat/east_1, throw_release/north_2, backpedal/east_3 left unrepaired
  (transplant made them worse — restored from clean slice).
- drawPlayer clamp (TOP-6/BOT+24) stays as the universal backstop for any
  remaining OOB source (e.g. formation lineups).
- Backlog: torso/legs layered sprites (hold until waves judged), punt full-22 cast,
  big_hit pose exemplar, better ref_first_down art (current = arms-out frame).
