# hashmark-heroes — agent notes

Vanilla HTML/CSS/JS football franchise sim. No build step, no framework.
Rendering: PIXI 7.4.0 layer for players + canvas field. Entry: `play.html`.

## Multiplayer / on-chain — anti-cheat is the #1 invariant

NON-NEGOTIABLE, above features and ship speed (same tier as the audit gate):
the authority (Node server now, MegaETH later) owns ALL competitive state;
clients submit *intent* only, never trusted outcomes. Determinism
(`(seed+inputs)→SHA-256 hash`) makes every result independently re-simmable =
**proven, not asserted**. On-chain results must be PROVEN from a re-simmable
artifact, never typed in by an admin. Full threat model + MegaETH settlement
design: `INGAME_CLOCK_AND_MULTIPLAYER.md` §Anti-cheat. Every new MP feature
must name its cheat surface + how it's closed, same discipline as gate-safety.
- CROSS-MACHINE RULE: JS leaves `Math.log/cos/pow/...` precision impl-defined, so
  any libm on the OUTCOME path can fork validators. Use the portable, pure-IEEE
  helpers for outcome-affecting transcendentals — `_olog/_ocos/_osq` (dispatchers,
  native by default, portable under `GC_PORTABLE_MATH="on"` / `_setPortableMath`)
  backed by `_plog/_pcos` in play-data.js. `Math.sqrt` is correctly-rounded =
  safe. Prove with `server/determinism-hazard-probe.js [PORTABLE=1]` (portable →
  ∞ ULP margin) + the outcome-neutral check in `server/determinism-probe.js`.

## Settlement / contracts (on-chain anti-cheat — Hardhat, solc 0.8.20)

- `npm install && npx hardhat test` (toolchain not committed; deps in package.json).
- `ProofSettlement.sol` = the trust-hole fix: Chainlink VRF v2 seed (a consumer;
  `openMatch`→`requestRandomWords`→`fulfillRandomWords` fixes the unforgeable
  game seed) → bonded propose `(artifactHash=inputs, resultHash=outcome)` →
  optimistic challenge window → resolver slashes the liar. `LeagueManager` no
  longer types in scores: `ingestResult(gameIdx)` PULLS a finalized match's
  proven result, bound to the franchise via `TeamNFT.ownerOf`. Canonical outcome
  hash = `server/result-hash.js` (strips motion/statsSnap/desc, key-sorted).
  TeamNFT metadata is seeded post-deploy (`setTeams`, `scripts/teams.js`) — its
  literals were in the constructor and blew the EIP-3860 init-code limit. 37 tests
  in `test/`. Deploy: `scripts/deploy.js` (auto-mocks the VRF coordinator when
  none is configured — MegaETH testnet has no Chainlink VRF yet); runbook in
  `DEPLOY.md`. Local dry-run: `npx hardhat run scripts/deploy.js`.

## Ship workflow (every push)

1. `node --check <file>.js` after every JS edit.
2. Run the gates (all must pass):
   - `node _audit_gate.js --fast` — sim drift, 0 drift required (3 metrics ±tolerance).
   - `./_teleport_gate.sh` — egregious ≤4, runaway ≤6, loop ≤0 (seed=1337, 4
     games; loop = DEF-side big-circular-path class, see Pending). Loop math is
     unit-proven by `node _teleport_loop_selftest.js`.
   - `node tools/_anim_pose_audit.js` — 27 animation families, 0 flags required.
   - `node tools/_playsheet_probe.js` (28 checks) / `tools/_catch_matrix_probe.js` (9) /
     `tools/_ipc_clock_probe.js` (19) when touching plays/catching/clock.
   - `node tools/_bh_normal_probe.js` (4 checks) when touching the GC_BH_NORMAL
     ball-handler normal-play pilot (`_bhSpecForPass`/`_bhNormalPassAnim`).
3. **`./tools/_stamp_build.sh`** before any push that changes JS or art — rewrites
   `?v=` stamps in play.html and `window.GC_BUILD` (play-sprites appends it to all
   sprite/manifest URLs). Without this, browsers serve stale mixes.
4. Develop on `claude/charming-cray-ggpd7f`, commit, then:
   `git push -u origin claude/charming-cray-ggpd7f && git push origin claude/charming-cray-ggpd7f:main`
   (main is always fast-forwarded). User uploads sprite sheets to main via GitHub
   web upload — fetch/merge those in before pushing.

## Pass route library (engine `_buildPassRouteTracks`)

- Concept-driven routes for EVERY on-field receiver (target + decoys), keyed by
  slot, attached to `play.motion.tracks[slot]`; the animation samples them
  (targeted WR in drawPass, decoys at the "Non-targeted receivers run REAL
  routes" block). Deepened from 5 fixed per-concept shapes to a NAMED route
  library (`ROUTE`: slant/quick_out/hitch/drag/curl/dig/out/comeback/post/
  corner/go/wheel/post_corner/flat) + per-concept option POOLS
  (`CONCEPT_ROUTES`) picked by a deterministic per-play `_variant` =
  `(down*7 + ytg*13 + yardLine*3)` → 30-54 distinct route pictures per concept.
- depthFAtBreak > 1 = stem past the catch then come back (curl/comeback).
  Optional `viaF/viaDepthF/viaLat` inserts a second break for lateral
  double-moves (wheel, post_corner); `trackFor` adds the via waypoint.
- GATE-SAFETY RULE: route-track building MUST stay RNG-free. The audit gate's
  byte-identical requirement holds because shapes never draw from the sim RNG
  and the metrics don't read route data — vary routes ONLY via a deterministic
  hash of play state, never `_rand()`. (Verified: audit 0 drift after the
  deepening; teleport egregious dropped 4→2, runaway at-baseline 4 — the
  uptick is coverage legitimately following deeper routes downfield.)

## Engine invariants

- Coordinator seam: named play calls (PASS_CONCEPTS, RUN_CALL_VARIANTS, READ_OPTION,
  REVERSE, FLEA_FLICKER, RPO, HAIL_MARY, HB_PASS, DOUBLE_PASS...) override **roll
  results only**. Every RNG draw must still execute so defer/no-coordinator stays
  byte-identical (gate-safe).
- Gadget plays (HB_PASS = RB throws deep; DOUBLE_PASS = WR throws back across) are
  SELF-CONTAINED resolution blocks at the top of the pass path, modeled on the
  fake-FG/fake-punt blocks: they roll their own INT/complete/incomplete with a
  non-QB passer (lower accuracy, higher INT), attach real `motion` via
  `_buildPassRouteTracks` so they animate as deep shots, and return the same
  shapes `_drive()` expects. Call-only → never on the AI roll → audit byte-identical.
  Wired into the interactive playcall sheet (cards + keys F/G + route diagrams).
  WILDCAT (🐅, key Z, self-contained RUN) and HOOK_LADDER (🪜, key X, short
  hitch + lateral YAC) follow the same pattern, as do FAKE_SPIKE (🧊, key C,
  PASS — QB sells the clock-kill then fires the quick game: completion bonus
  off the napping defense, low INT) and STATUE (🗽, key V, RUN — QB cocks to
  throw, RB takes the hidden ball off the fake to the edge, reverse-like
  variance). Six gadgets total. Adding another = one engine resolution block +
  one `_bhGadgetAnim` spec + sheet wiring (card/key/route diagram).
- Gadget flourish = a broadcast CALLOUT BANNER (`_gadgetBanner` in the main
  render loop, keyed off isHBPass/isDoublePass/isWildcat/isHookLadder/
  isFakeSpike/isStatue), NOT a true handoff/lateral choreography: the pass/run
  animators dress the passer into the QB slot, so a real exchange needs a
  second-player beat that doesn't fit the QB-centric model and barely reads at
  broadcast zoom. Banner is the cheap, visible, regression-free win.
- Gadget STAT ATTRIBUTION (done): the gadget blocks return early, so they
  bypassed the normal pass/run crediting — gadget plays were invisible in the
  box score and the non-QB passers (RB on HB pass, WR on double pass) got no
  passing line. `_gadgetPassComplete/_gadgetPassIncomplete/_gadgetPassInt/
  _gadgetRun` (engine) mirror the normal crediting (passer pass_*, receiver
  rec_*, rusher rush_*, team totals, defender int_made/yds, takeaways) and are
  wired into all six gadgets. `_lastPasser` (reset each snap, set on gadget
  completions) makes a gadget TD credit pass_td to the real passer, not the QB.
  Box score filters passing rows by pass_att>0, so non-QB passers now surface.
- BALL-HANDLER model (ON by default for gadgets; kill-switch
  `window.GC_BALLHANDLER="off"`): all four gadgets render through a shared
  renderer (`_bhGadgetAnim` in play-animation.js) — a full-22 SCAFFOLD (`_bhDrawOL` + `_bhDrawDefense`, an
  11-man defense that converges on the ball spot, + `_bhDrawDecoys`) plus a
  per-gadget SPEC giving the ball-handling players, the ball TIMELINE
  (`_bhSampleBall` HELD/FLIGHT segments), and the convergence spot. Choreographies:
  HB pass (snap→QB→pitch→RB sweep→RB THROWS→WR), double-pass (QB→short lateral→WR1
  →WR1 THROWS deep→WR2), hook&ladder (QB→hitch→WR1→LATERAL→trailer runs), wildcat
  (DIRECT snap→RB downhill), fake spike (snap→QB→ball DIPS to the turf→pulls up→
  THROWS quick game→WR), statue (snap→QB COCKS to throw→RB sweeps behind→hidden
  handoff→RB to the edge). Self-contained intercept at the top of
  buildAnimForPlay (after attachPlayerStyles) — never touches the validated
  run/pass animators; only gadget plays take the path, so the standard
  run/pass render is byte-identical. NOTE: the intercept sits BEFORE the
  function's `ctx`/`fieldState` decls (TDZ), so the renderer uses a LOCAL ctx +
  its own field state. Draws are DEPTH-SORTED: every player is pushed to a sink
  keyed by field-Y and painted back-to-front (correct in tactical cam;
  broadcast re-sorts its sprite queue anyway). Gates unaffected — the AI
  battery never calls gadgets.
- NORMAL-PLAY MIGRATION — Stage 1 pilot LANDED (flag-gated, default OFF):
  `window.GC_BH_NORMAL="on"` routes a vanilla dropback COMPLETION through the
  ball-handler model (`_bhSpecForPass` + `_bhNormalPassAnim`) for A/B vs the
  standard animator. Intercept sits right after the gadget one, scoped tight:
  straight completes only (no screen/PA/throwback/lateral/gadget). Default OFF
  → the gate batteries take the standard path → byte-identical, all gates green.
  Continuity guards are INHERITED, not re-coded: drawPlayer's clamp bounds every
  body, and the continuous `_bhWRSampler` route + parabolic ball segments make
  the catch a smooth ball-token hand-off (no catch-frame teleport).
  `tools/_bh_normal_probe.js` is the headless continuity gate (20 real completes
  × 241 frames: 0 NaN, no per-frame jump >70px, ball delivered to the WR ≤6px).
  NEXT: in-browser visual A/B (catch point, YAC endpoint, pose families) before
  any default flip; then Stage 2 runs (riskiest — evasion poses + the teleport
  battery), Stage 3 pass variants (sack/INT/screen/PA), Stage 4 ST. One kind at
  a time, fully gated, standard animator retained as the per-kind fallback.
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

- Gen-time determinism hole (SOLVED): `pickBodyType` (play-render.js) assigned
  `bodyType` with raw `Math.random()`, and `bodyType` feeds the contested-catch
  `bodyBonus` (play-engine.js ~6170) — so it's OUTCOME-AFFECTING. With raw
  Math.random the same seeded roster/draft-class generation produced different
  body types run-to-run → silently perturbed catch outcomes. Production GAME
  re-sim was safe (body types are persisted roster fields, fixed inputs), and the
  audit gate masked it (globally overrides Math.random), but it broke seed-
  reproducible roster/class GENERATION — which on-chain full-draft mode needs
  ((seed+inputs)→hash must re-sim byte-identically, gen included). Surfaced as a
  FLAKY playsheet seam check (the probe seeds `_rand` via `_setSimRng` but NOT
  Math.random, so gen drifted while the seam comparison ran). Fix: pickBodyType
  now draws from `_rand()` (falls back to Math.random only when no sim RNG is
  active, so unseeded gen stays stochastic). RULE: any gen-time value that feeds
  the sim must use `_rand()`, never raw `Math.random()`. Removing the gen noise
  also EXPOSED that the RUN_TOSS/RUN_DRAW playsheet checks were passing by stream
  luck — a 4th-down 🎩 FAKE PUNT (kind="run", no runType) slipped the "every run
  is pitch/draw" assertion; the probe filtered kneel/spike but not ST fakes, so
  the filter now excludes `fake (punt|field goal)` too (they're situational
  overrides, not designed runs — matches the "specials suppressed" intent).
  Net: playsheet now STABLY green (28/28, was flaky on the seam), all gates green,
  teleport-neutral (egregious 1, runaway 5), realism 16/16 NFL bands.

- Season highlights linked to the WRONG play / playoff highlights TEXT-only
  (SOLVED): captureGameHighlights stored only quarter/time + a text `clip`, so
  frnReplayHighlight re-found the play by fuzzy game-clock match against
  replayClips (a DIFFERENT top-N set → grabbed a neighbour) or the playLog
  (which EXCLUDES playoff plays → fell to the text card). Fix: each highlight is
  now self-contained — `animCtx` (highlight play + 2 lead-up plays, full minus
  statsSnap) on per-play AND capsule highlights; frnReplayHighlight step 0 plays
  animCtx directly. animCtx is IDB-only — `_slimFranchiseForMirror` strips it
  from the localStorage mirror (like replayClips/playLog), ~311KB/60 highlights.
  RULE: link a "replay this moment" UI to the actual stored play, never re-search
  by clock across an independently-selected clip set.
- Season-screen flow fixes (SOLVED, earlier this pass):
  - Awards-reel highlight cards ("▶ Watch", hlCard in renderFrnAwards/offseason)
    called `renderHighlightReplay` (the TEXT-card modal) directly instead of
    `frnReplayHighlight` (the animated router: recorded clip → playLog re-anim →
    text only as old-save fallback). Repointed to frnReplayHighlight. Every other
    highlight watcher already uses it; that card was the lone bypass.
  - Season-recap PLAYOFF BRACKET preview drew a FAKE league-wide 8-team single
    bracket (1v8 … "win 3 in a row"), so the #1 overall seed showed a wild-card
    game with no bye — contradicting the real format. Rebuilt from the actual
    seeding (per conference: #1 BYE + 2v7/3v6/4v5). New CSS: `.frn-recap-bracket-confs/
    -conf-title/-match.bye/-bye-tag`.
  - Overview tab showed "REGULAR SEASON COMPLETE / START PLAYOFFS" AFTER winning
    the Super Bowl. frnSetTab → `_frnRenderActiveTab` overview case only handled
    phase "playoffs"; in "offseason" it fell to renderFrnRegular (seasonDone →
    START PLAYOFFS). Extracted `_frnRenderOverviewTab` mirroring the phase
    dispatch (offseason → re-signings/offseason hub, awards → awards, playoffs →
    bracket). RULE: any new "what does Overview show" logic must branch on
    franchise.phase, not assume in-season.
- In-game ↻ REPLAY did nothing useful (SOLVED): frnReplayLastPlay wrote
  `window.playHead/animState/speedMul/playing`, but those are top-level
  `let` bindings (play-render.js) that do NOT alias onto `window` in the
  browser — every write was inert, so the button re-ran the CURRENT play at
  full speed instead of rewinding to the previous play in slow-mo. Fixed with
  bare assignments (same trap _frnPlaySynthReplay already documents). The
  other replay paths (Replays tab `frnReplayClip`, season `frnReplayHighlight`,
  week-recap) share `_frnPlaySynthReplay` and use direct assignment. RULE: never
  `window.X =` for gameResult/playHead/playing/speedMul/animState — assign the
  bare name so the real `let` binding moves.
- Dashboard replays rendered OFF-SCREEN (SOLVED): clicking ▶ REPLAY on the
  Replays tab / a season highlight / the week-recap reel looked dead.
  `_frnPlaySynthReplay` built the synth gameResult and started playback but
  skipped the live-game SCREEN SWAP — it left `#franchiseHome` visible and
  `#playbackControls` hidden, so the broadcast rendered into `#gameArea`
  stacked BELOW the still-mounted dashboard list, past the fold. Fixed by
  doing the same flip `_frnEnterLiveGameScreen` does (hide franchiseHome, show
  playbackControls); `frnExitReplay` already restored both. When adding a new
  full-screen-game entry point, mirror that enter/exit pair or it renders
  under the dashboard.
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
- User QA (field alignment + carry/KR facing): VISUALLY VERIFIED off-chain this
  session via headless-Chromium screenshots of the real broadcast (`H2H_STATIC=1
  node server/h2h-server.js`). Field alignment is correct with the side panel
  open across normal / short (1366×540) / hiDPI-2× viewports (the autoDensity
  fix holds — players sit on the LOS, in-bounds; no sideline jam). Carry facing
  is correct: rendering `drawPlayerSprite` for carry/qb_carry east vs west
  alongside the known-good `run` reference, carry-EAST faces right (matches
  run-EAST) and carry-WEST mirrors it — the slice-time `--flip-east` fix worked.
  Re-confirm in your own playtest; if carry ever reads mirrored again, re-slice
  the carry sheet toggling `--flip-east` (see Slicing new sheets).
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
- STILL OPEN: user reports "#24 teleports to the top" / "#27 ran a big loop"
  — may be the same sway-feedback drift culminating in a snap (now removed) or
  a separate coverage teleport; needs confirm after this build.
  INVESTIGATION (2026-06-16, this session): NOT reproduced. Swept seeds 1337,
  7, 42, 99, 2024, 5 (2-4 games each) through `_teleport_detect.js` in BOTH
  tactical and BROADCAST cam (users play broadcast; the gate runs tactical —
  broadcast re-sorts sprites + lane-squeezes, the suspected gap). Broadcast
  matched tactical exactly (egregious 2, runaway 4 on the baseline seed). Every
  flagged runaway was a KNOWN/LEGIT pattern: punt cosmetic coverage (documented
  near-baseline tradeoff), offensive deep-route receivers ending far from a
  short completion, and INT returns — NOT a defender looping/teleporting. The
  detector flags MAGNITUDE (≥6yd/frame jump, late sprint far from ball), not
  looping PATH SHAPE, so the "#27 big loop" wandering may slip its net even if
  present. The most-likely-cause fixes already shipped (rally-defender direct
  aim, coverage-liveness leg-cycle-only, CB landmark clamps). NEXT: needs a
  user-supplied reproducing scenario (down/distance/coverage + the exact
  jersey) — or add a path-shape (curvature/turn-accumulation) detector to the
  battery to catch loops the magnitude gate misses. Did NOT ship a speculative
  fix without a repro (would risk the zero-margin runaway gate).
  PATH-SHAPE DETECTOR SHIPPED (the "NEXT" above): `_teleport_detect.js` now has a
  LOOP class wired into `_teleport_gate.sh` (baseline `loop`). It flags a player
  whose path WINDS ≥330° around its own centroid with radius-of-gyration ≥5yd and
  a FAT minor principal axis ≥3yd — the geometry of a real circle. Winding (not
  raw heading-change accumulation) is the key: end-of-play tackle jitter sits far
  from the centroid so it contributes ~0, a straight run winds only ~180°, and a
  thin out-and-back has ~0 minor axis — all rejected. Side is resolved by name vs
  the possessing team's offensive starters; only DEF-side loops are gated (the
  bug), offense YAC circles are informational. Seed-1337 baseline: 0 def / 2 off
  (the #27 defender loop still does NOT reproduce in seed). The classifier math
  is proven on synthetic paths by `node _teleport_loop_selftest.js` (circle
  flags; straight / out-and-back / tight-circle / jitter do not). So a defender
  loop would now be caught by tooling the moment it appears in the battery; a
  user repro (jersey + down/distance/coverage) would let us capture that seed and
  confirm the gate trips, then fix against it.
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
  td_celebrate, else hashed celebrate/2/3).
- On-field pose consumers wired this pass (all in play-animation.js):
  - `dodge` (was orphan art): clean-sack credited rusher slips the block in
    the final strides before the QB, then finishes the `sack`. Both the
    engine-track sacker branch and the procedural rush fallback; strip-sacks
    keep `strip_swat`.
  - `big_hit` (was DOM-overlay-only): the big_hit cinema play now renders the
    tackler driving the big_hit pose THROUGH the carrier (who tumbles) in the
    field's lower third, behind the centered DOM card. Victim=offense color,
    tackler=defense color.
  - Punt FULL-22: punt animator now draws all 22 (was 9). Added 13 cosmetic
    background players (punt: long snapper + 2 protectors + 3 gunners; return:
    2 jammers + 5-man wall). They never touch the tackle/return geometry.
    Coverage settles by ~t=0.5 then holds — sprinting the whole play tripped
    the teleport "runaway" class (coverage legit finishes far from a short
    return's dead ball; the heuristic can't tell that from a parked-defender
    bug). Wall blockers use one continuous setup→hold→wedge path (no
    phase-boundary jump).
- Torso/legs sprite layering: FOUNDATION landed, flag-gated
  `window.GC_SPRITE_LAYERED` (OFF by default; default render path untouched).
  `_splitLayers`/`_composeLayered`/`_waistCentroidX` in play-sprites.js cut a
  normalized frame at the HIP (~0.60h) and composite run-cycle legs under an
  action torso, hip-centroid-aligned (frames are head-anchored so hips sway).
  Proven clean (no seam/ghost). NOT rolled out — a wash on already-good poses
  like carry (they already carry matched legs); the payoff is only future
  action-during-locomotion art with no legs of its own. `_LAYER_TORSO_POSES`
  gates which poses opt in (just `carry` today). Don't enable broadly without
  per-pose hip tuning.
