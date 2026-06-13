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

`--flip-east` for sheets whose profile rows were DRAWN facing left (west
family): carry, refs, ref_first_down. (hurdle/qb_carry/ref_td_signal face
right — do NOT flip.) Check facing on every new sheet: east row must face
RIGHT (skin-centroid heuristics lie on raised-arm poses — eyeball them).

Pipeline: remove_bg (flood + light-family checkerboard acceptance; dark outline is
the protection boundary) → defringe(2) → alpha-projection band detection (NOT equal
grid division — AI sheets are uneven) → scale-normalize body to ~50px (BODY_H=50,
feet pinned FOOT_Y=76) → head-centroid x-anchor for upright figures → per-frame
defringe(1) → despeckle(min_size=25) → reink (bare edge pixels → ink) → 104×104
frames + manifest merge. Source sheets committed as `sprites/v2_src_*.png`.
Generation spec/prompts/ball rules: `sprites/SPRITE_REQUEST.md`.

## Helmet-vanishing root cause (SOLVED — gated flood)

The "helmet color in and out" bug: remove_bg's flood leaked through 1-2px
breaks in the dark outline and deleted the WHITE HELMET DOME as background on
random frames (the helmet is in every source frame). Fix in remove_bg: erode
the bg-acceptable mask 1px before flooding (flood can't pass passages ≤2px),
then dilate the flooded region 2x within the mask. Also: mode_downscale
(majority-color per dest box, replaces NEAREST sampling lottery) and reink
floods OUTSIDE transparency — seals interior pockets, inks only mid/dark
silhouette pixels (whites stay; the 1px dilation ring seals them), so small
white features survive. sprites/_fix_heads.py (head transplant) is SUPERSEDED
— do not run it; keep as a detector (`--report`) only.

## Pending

- "Entire field is shifted" TRUE root cause: PIXI player canvas had
  autoDensity:true, which writes inline style.height=FIELD.H(720)px onto
  the canvas, overriding our height:100%. projectBroadcast back-maps
  players assuming the canvas spans the WRAP (clientHeight), so a 720px
  canvas over a shorter wrap (472px on a short window) scaled every Y by
  ~1.5x — squad jammed toward the far sideline. Worse on short/hiDPI
  windows (error = 720/wrapH). Fixed: autoDensity:false + force cv CSS
  100%/100% (backing stays FIELD×resolution = crisp). The _bcastGeom
  ResizeObserver/per-frame-check + lane squeezes remain (correct, but
  were treating a symptom).
- User QA outstanding: field alignment with side panel open, carry/KR
  facing (carry sheet was drawn mirrored — flipped at slice).
- "Defense doesn't move" (pass plays) SOLVED: parked zone defenders had
  dd.t=0 + track-held position = literal statues through the QB's whole
  scan. Now: slow scrape cycle + seeded ±3-4px sway at the landmark
  (LB/S track path AND CB zone bail). window.GC_FORCE_AUDIBLE debug
  hook pins the audible path for probes. Mid-play freezes beyond this:
  not reproduced (fumble piles lie down by design).
- drawPlayer clamp (TOP-6/BOT+24) stays as the universal backstop for any
  remaining OOB source (e.g. formation lineups).
- Trackless-completes catch teleport SOLVED: completes with hasMotion=false
  (no engine track) fell back to a hardcoded targetY (cy±N) that ignored the
  receiver's split — a wide WR (cy+240) catching at cy+65 had to break 175px
  inward, but the legacy ctrl route holds him at his split until the last 5%,
  cramming the whole break into 1-2 frames = a catch-frame port (esp. visible
  on TOR throws). Fixed: no-track targetY anchors to the receiver's slot,
  drifting toward mid by min(0.45, 0.12 + depth*0.022). Jump 164px→32px (now
  under the continuity-guard SNAP, glided smoothly).
- ALL pose art is now v2 (wave 4+: catch_high/low/over_shoulder, dive_forward,
  big_hit, real ref_first_down + ref_td_signal, signal_first_down,
  td_celebrate, celebrate2/3). "celebrate" dispatches per celebStyle in
  drawPlayerSprite (first_down→signal_first_down, spike/point_sky→
  td_celebrate, else hashed celebrate/2/3). big_hit art has no on-field
  consumer yet (cinema is a DOM overlay) — wire it when upgrading big-hit.
- Backlog: torso/legs layered sprites, punt full-22 cast, big_hit on-field
  choreography.
