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

## UI typography (broadcast view)

- play.css `:root` defines the type system — use these tokens, don't inline
  font stacks: `--font-display` (Bebas Neue/Anton condensed caps — team names,
  section titles, logo), `--font-num` (Anton/Teko heavy condensed — scores,
  clock, big numerals; ONE stack — the clock used to fall back to Impact and
  read different from the scores), `--font-mono` (IBM Plex Mono — all data,
  labels, chips, list rows). Body copy/prose stays `--font-prose` (Bricolage).
- bspnlive caption scale (also `:root`): `--bspn-cap` .56rem (chips, dense bio
  text), `--bspn-lbl` .64rem (field labels, records, meta, nav), `--bspn-txt`
  .74rem (list rows, table cells). The scoreboard/LIVE BIO/play-by-play used to
  scatter .5–.82rem micro-sizes; collapsed onto these three steps. New bspnlive
  text should pick one of the three, not a fresh px/rem value.
- play.css is loaded WITHOUT a `?v=` stamp (never has been) — `_stamp_build.sh`
  only rewrites JS/art stamps, so CSS-only changes don't run gates or stamp.

## Sprite system (v2 character migration — LIVE)

- v1 atlas `sprites/`, v2 in `sprites2/` (ChatGPT-generated character). Waves 1+2
  done: 16 pose sets ≈95% of screen time. Kill switch: `localStorage.GC_SPRITE_V2="off"`.
- `sprites2/manifest.json` = `{pose_or_folder: frames}`; `_applyV2Manifest` in
  play-sprites.js matches by pose key OR folder (covers aliases: reach/catch/leap→
  "catch", throw→"pass", tackled/sack→"fall"). Optional-pose probes must NEVER
  overwrite a manifest-granted true.
- Mirror fallback: 5-direction minimum (south, north, east, south-east, north-east);
  west family flips at draw (rotation applied before flip).
- Tint (`_tintedSprite`): FULL-COLOR cel ramp with depth. 3 bands split by
  PERCENTILE of the sprite's own white luminance (bottom 38% → shadow, top
  28% → highlight, middle → full color) — a FIXED lum cut dumped ~64% of
  the AI art's bright whites into one band = flat "filled in paint". Colors:
  highlight = teamColor×1.40 clamped (GC_TINT_HI, BRIGHTENS the hue — don't
  lerp to white, that pinks red), mid = full teamColor, shadow = teamColor×
  0.74 (GC_TINT_SHADOW). PANTS stay white (skip white below waist
  minY+0.56*h, upright only; GC_TINT_WAIST). FACEMASK spared: skip white
  touching skin in the HEAD band (top 40%) only — bare arms below are skin
  too and a body-wide skip made a polka-dot jersey. Skin mask snapshotted
  from ORIGINAL pixels (a warm tint passes isSkin → cascade-dots otherwise).
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
- "Defense doesn't move" / frozen defender (pass plays) SOLVED in two
  passes: (1) parked zone defenders had dd.t=0 + track-held position;
  (2) the NICKEL BACK (idxNB) fell through every coverage branch (not an
  LB, not cb1/cb2, not a safety) so it froze on EVERY nickel pass, and
  trackless plays froze the LBs/CBs too. Fix: universal coverage-liveness
  fallback at the end of the defender map — any LB/CB/NB/S whose UNDITHERED
  computed spot is unchanged frame-to-frame gets a slow scrape cycle +
  seeded ±3-4px sway (broadcast-cam only; tactical dot-view skips it to
  spare the teleport gate). window.GC_FORCE_AUDIBLE pins the audible path
  for probes. Mid-play freezes beyond this: not reproduced.
- drawPlayer clamp (TOP-6/BOT+24) stays as the universal backstop for any
  remaining OOB source (e.g. formation lineups).
- "Defenders circling like flies" (only while PLAYING at high frame rate,
  NOT when scrubbing): the parked-coverage-defender position SWAYS added
  for the frozen-defender fixes (bail-target sway, secondary-track sway,
  universal coverage-liveness sway) nudged the body ±3-4px; that nudge
  got synced into _lastRendered/_sim and fed back through the per-frame
  position pipeline, so the defender chased its own oscillating spot and
  INTEGRATED into a fast circle — worse the higher the frame rate
  (scrubbing clamps per-frame dt so it hid the bug). Fix: removed ALL
  three position sways; parked-defender liveness is now the LEG-CYCLE
  pose (dd.t) only — animates feet in place, never translates the body.
  Verified frame-rate independent: defender path ratio 240fps/30fps =
  1.01 (was growing with fps).
- Sack-play defense froze: the sack defender map gave DL/LB dd.t=0 (frozen
  pose frame) and NEVER handled CB/NB/S (i>=7) at all → whole secondary
  held its pre-snap stance. Fix: leg-cycle dd.t on DL engage + LB scrape,
  and a new CB/S branch (shallow backpedal off the snap → scrape, live leg
  cycle). All sack defenders animate now (probe: 9/9, was frozen).
- STILL OPEN: user reports "#24 teleports to the top" — may be the same
  sway-feedback drift culminating in a snap (now removed) or a separate
  coverage teleport; needs confirm after this build.
- Defender runs cross-field BEFORE the throw (probe found CBs covering
  22-34yd pre-throw): on a deflection/dropped-pick the engine credits a
  specific defender, but his formation SLOT can be on the opposite side
  of the ball (the BOTTOM corner credited with breaking up a throw to
  the TOP receiver). The PD block drives the credited defender to the
  catch point, so he sprints sideline-to-sideline during the dropback.
  Fix: for PD / dropped-pick (no return → name fidelity matters little),
  if the credited defender's slot is >12yd laterally off the ball, render
  the CLOSEST coverage defender to the catch point instead. INT keeps its
  named interceptor. Also made the CB zone-bail _cbSide alignment-based
  (d.y<cy) not index-based, so a corner always bails to his OWN deep
  third. The two remaining 22-25yd pre-throw CBs are man coverage on deep
  crossers (legit). Probe now: 0 defenders running long pre-throw.
- Defender "#27 ran a big loop" (user-traced): the post-catch RALLY tier
  gave EVERY back-seven defender an intercept-lead aim (carrier's
  PROJECTED future spot). For a far rally defender the projected point
  swings each time the carrier cuts during YAC, and with the defender's
  own momentum that traces a wandering loop across the field. Fix:
  intercept lead is now COMMITTED-tacklers-only; rally defenders aim
  DIRECTLY at the carrier's current spot (clean converging line, just
  doesn't reach a short play). NOTE: not reproduced in the test seed
  (game 1,2) — shipped as the most-likely cause; needs user confirm.
- Duplicate/phantom RB ("RB runs a huge looping route", user traced #27):
  the carrier object `wrBase` (line ~3962) only named wr1/wr2/te and
  DEFAULTED wr3/wr4/wr5/te2 → formation.rb. So an engine target of wr3+
  built the catcher from the RB's identity+position: the RB was drawn
  TWICE (mis-IDed downfield catcher + real backfield blocker) and the
  true WR never appeared. Fix: `wrBase = formation[wrChoice] || formation.rb`
  (same slot dressSlotAs already resolved). Exposed a latent deep-WR
  catch-frame teleport (carrier now starts at the WR split, not the RB) —
  fixed with a per-frame carrier step cap (≤70px/frame, just before
  wrWithPose; glides any route→YAC-sim pop under the continuity SNAP).
  Teleport gate egregious 4→3 after.
- CB "ran off the top of the field instead of covering": the Cover-2/4/
  Tampa deep-half corner landmark used lateral 22yd = cy±330px, but the
  half-field is only ~20.7yd (sideline 310px from center) — so the TOP
  corner bailed to y=30, 20px PAST the sideline, and chased that
  off-field spot into the corner. Fixed: lateral capped 22→17yd + landY
  clamped to [TOP+40, BOT-40] so no coverage drop ever routes a defender
  off the field. Min CB Y now 74 (was 30); only corner-blitz CBs go
  near the line now (legit).
- Post-catch RALLY: the pursuit set was only the 2 closest defenders +
  named tackler (+ safeties on 10+yd), so deep corners/safeties who
  bailed downfield just STOOD there ("what are those defenders doing at
  the top right?"). Now two tiers in the complete-pass defender map:
  COMMITTED (closest 2 + tackler + situational safeties) auto-scale to
  arrive and make the tackle; RALLY (every other back-seven coverage
  defender) pursues at a relaxed factor 0.82 with intercept angles —
  flows to the ball, doesn't teleport-sprint, just doesn't reach a short
  play. _committedSet drives _needArrival; _postCatchPursuerSet = all
  candidates. Verified: 0 still back-seven defenders post-catch (was
  ~5 moving / rest frozen).
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
