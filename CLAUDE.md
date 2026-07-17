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
Commissioner league-wide fantasy draft (rosters drafted from scratch; the
"on-chain full-draft mode"): S1 (single-player) SHIPPED —
`play-franchise-fantasydraft.js` + `tools/_fantasy_draft_probe.js` (20-check
gate: pool determinism / no-deadlock legality / tape-replay stability / full
user flow incl. refresh-resume). S2 SERVER SHIPPED — league-server drafting
phase (`server/draft-host.js` hosts the same gen+draft core in Node;
intent-only pick endpoint, pick clock, batched events, artifact/result hashes
independently re-derived by `server/league-probe.js`, 68 checks; run it when
touching the league server or the draft module). S2 CLIENT SHIPPED —
`play-league-client.js` (ONLINE LEAGUE card: create/join/lobby + SSE, live
league draft room, client-side sha256 verify → VERIFIED badge, "Start my
franchise" derives the identical local league per member; invite links carry
the server base, h2h-style) + `tools/_league_client_probe.js` (30 checks, two
real browsers: deep-link join, SSE picks, unattended clock finish, cross-
browser PID-identical rosters). Run BOTH probes when touching league code.
LEAGUE M2 (shared-season sim) SHIPPED — the server sims real weeks; see
"League M2" section below for the full design + verifier recipe.
PICK QUEUES (SP + league): a private, ordered pid wishlist — board ＋/✓ toggle,
▲▼✕ panel, "Draft #1 queued" quick action, 🔎 name search on both boards.
SP auto-rest/bench-fill and the SERVER's clock-timeout auto-pick take the queue
head (first available + legal) before BPA (`_fdQueueBest` / server `queuedBest`;
league queues sync via POST /api/league/draft/queue, PRIVATE — never broadcast).
Tape stays the only artifact, so replay/verification are unaffected.
Design + S3 plan: `FANTASY_DRAFT_DESIGN.md`
(pure-function draft: (poolSeed+settings+pickTape)→rosters). KEY FINDING: the
roster generator's helpers still hold ~11k raw Math.random draws (jersey/
college numbers, weightedTierPick, …) — seeded gen therefore uses
`_fdSeededScope` (scoped Math.random override, audit-gate technique), NOT
_setSimRng alone. Run the probe when touching gen or the draft module.
- CROSS-MACHINE RULE: JS leaves `Math.log/cos/pow/...` precision impl-defined, so
  any libm on the OUTCOME path can fork validators. Use the portable, pure-IEEE
  helpers for outcome-affecting transcendentals — `_olog/_ocos/_osq/_oexp/_opow`
  (dispatchers, native by default, portable under `GC_PORTABLE_MATH="on"` /
  `_setPortableMath`) backed by `_plog/_pcos/_pexp/_ppow` in play-data.js.
  `Math.sqrt` is correctly-rounded = safe. This covers BOTH the sim path AND
  (since the 2026-07 gen audit) the GEN path — the only gen transcendentals were
  the potential Box-Muller (core) and the career-trajectory pow (play-player),
  both routed; `server/gen-hazard-probe.js` is the gate (PORTABLE=1 → 0 gen-path
  libm, in CI) and proved native≡portable gen NEUTRALITY (full roster + pids +
  pool hashes identical), so validators run portable END-TO-END and reproduce
  published rostersHash/resultHash bit-exactly. Sim side: prove with
  `server/determinism-hazard-probe.js [PORTABLE=1]` (portable → ∞ ULP margin) +
  the outcome-neutral check in `server/determinism-probe.js`. Any NEW gen-time
  transcendental must go through the dispatchers.
- BUNDLE-PARITY RULE (found by M4, 2026-07-07): engine-host.js and
  draft-host.js MUST load the IDENTICAL file list. The engine typeof-branches
  on franchise-layer symbols (`combineMeasurables` → player weight → break-
  tackle physics), so a host missing play-franchise-core.js sims a DIFFERENT
  game from the same (seed, rosters, tape) — engine-host replays diverged from
  draft-host/browser until the franchise files were added to it. The browser
  loads everything, so the FULL file set is the consensus world. league-probe's
  "force-sim ≡ null-tape replay" check is the cross-bundle regression detector.
  Corollary: `_combineWeight`'s Math.log is on the outcome path — it now goes
  through `_olog` (see CROSS-MACHINE RULE); any new engine dependency on a
  franchise helper must keep that helper RNG-free and libm-clean.

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
  literals were in the constructor and blew the EIP-3860 init-code limit.
  `DraftSettlement.sol` = the FANTASY DRAFT's genesis settlement (S3): VRF pool
  seed (off-chain poolSeed MUST be uint32(uint256(seed))), bonded propose
  (artifactHash, resultHash) → challenge window → resolve; successful challenge
  VOIDS (no challenger-genesis; re-run vs the same seed).
  `LeagueManager.ingestGenesisDraft(draftId)` pulls a finalized draft as the
  season's once-only roster genesis. Referee tool: `server/draft-verify.js`
  (re-derives via draft-host; --seed checks the uint32 derivation;
  --expect-* for dispute adjudication). KNOWN LIMIT (natspec'd): the artifact
  can't prove a GM's pick wasn't fabricated by the server — needs per-pick
  signatures (future tier). 53 tests in `test/`. Deploy: `scripts/deploy.js` (auto-mocks the VRF coordinator when
  none is configured — MegaETH testnet has no Chainlink VRF yet); runbook in
  `DEPLOY.md`. Local dry-run: `npx hardhat run scripts/deploy.js`.

## Ship workflow (every push)

CI: `.github/workflows/gates.yml` runs this battery + all probes + the hardhat
suite on every push (main + claude/**) — main is also the Pages deploy branch,
so a red run means a broken build is LIVE. The local workflow below remains
the pre-push discipline; CI is the backstop.

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
   - `node tools/_ds_guard.js` — Design System no-bypass ratchet (0 NEW font/color/
     hand-rolled-component bypasses vs `tools/_ds_guard_baseline.json`) when touching
     franchise UI. Plus `node tools/_ds_component_test.js` (115) + `node tools/_ds_e2e.js`
     when touching `design-system/`. See "Design System" below.
3. **`./tools/_stamp_build.sh`** before any push that changes JS or art — rewrites
   `?v=` stamps in play.html and `window.GC_BUILD` (play-sprites appends it to all
   sprite/manifest URLs). Without this, browsers serve stale mixes.
4. Develop on the session branch (currently `claude/wizardly-ride-h1ir1i`), commit, then:
   `git push -u origin <branch> && git push origin <branch>:main`
   (main is always fast-forwarded). User uploads sprite sheets to main via GitHub
   web upload — fetch/merge those in before pushing.

## Design System (DOM/franchise UI) — route ALL new UI through it

The franchise UI (DOM chrome — NOT the canvas/PIXI game render) is built on one unified
Design System in `design-system/`. **Non-negotiable: all NEW franchise UI goes through
`DS.*` factories + `.ds-*` classes + tokens — never hand-roll.** The `_ds_guard` ratchet
enforces it (a build gate). This is a DOM-only layer; it must stay determinism-neutral.
- Files: `design-system/tokens.css` (the token layer — `--ds-*` spacing/radius/shadow/
  z-index/motion + semantic color aliases; ADDITIVE, never edit the raw palette there),
  `design-system/ds.css` (`.ds-*` component classes, token-only), `design-system/ds.js`
  (`window.DS` HTML-string factories). Includes: tokens.css+ds.css before play.css (no
  `?v=`); ds.js before the `play-franchise-*` scripts (stamped by `_stamp_build.sh`).
  Contract = `design-system/CONTRACT.md`; usage = `design-system/README.md`; how to add a
  component = `design-system/CONTRIBUTING.md`.
- API: `DS.button/card/chip/tab/tabBar/modal(+modalHtml)/banner/statTile/row/table/progress/
  toggle/toolbar/select` + helpers `esc/attrs/cx/mount`. Factories return HTML STRINGS (match
  the innerHTML idiom); inline handlers via `on:"frnFoo('x')"`; text auto-escaped (`DS.esc`);
  `body`/`cells`/`on`/`attrs` are TRUSTED; extra hook/legacy classes via `class:`/`cls:`.
  `DS.modal()` mirrors `_frnConfirmModal` (Promise, backdrop/Esc=cancel, Enter=confirm).
- INTERACTION-STATE LAYER (2026-07): `DS.skeleton` (text/block/tile/table shimmer;
  role="status" aria-busy + ONE sr-only label, bars aria-hidden — ONLY for genuinely-async
  content like IDB/network reads, never instant renders), `DS.emptyState`/`DS.errorState`
  (shared `.ds-state`; error = role="alert" + `retry` sugar → gold ↻ Retry),
  `DS.spinner`, `DS.button{busy}` / `DS.busy(el,on)` (spinner+disabled+aria-busy, label
  kept; busy=.75+progress cursor ≠ disabled=.4; DS.busy is idempotent + doubles as a
  double-click guard), `DS.toast({message,kind,duration})` (singleton, token palette,
  status/alert per kind — `_frnFlashToast` DELEGATES here; new code calls DS.toast).
  Interactive chips/tabs/nav-links auto-emit `role="button" tabindex="0"` + Enter/Space
  activation (they're span/div/a); active tab = `aria-current`; disabled non-buttons =
  `aria-disabled` + handler dropped. :focus-visible double ring covers btn/chip/tab/toggle/
  card-close/nav-link/select/modal-type-input. 89-check component test; states demoed in
  `design-system/gallery.html`. Consumers wired: boot IDB-fallback skeleton
  (`_frnIdbBootPending` → start-screen slot shimmer), Cap/Cuts empty state, H2H Host busy.
- FORM LAYER (2026-07): `DS.field/input/checkbox` factories + `DS.form(root,{validate,
  onSubmit})` controller (native constraint validation humanized → custom rule; silent until
  first BLUR, then live re-validation; submit focuses first invalid, busies the submitter,
  failure → `.ds-form-error` role=alert), `DS.steps`+`DS.stepper` (multi-step: `[data-step-
  panel]`/`[data-step-next]` gated on the ACTIVE panel's fields), `DS.trapFocus(dialog)`.
  Real consumer: the H2H Host-a-match modal (`h2hShowModal`, play-h2h-client.js) — franchise-
  team + last-used-server defaults (`h2h_last_server`), URL validation, inline failure with
  the modal kept OPEN (old one hid the modal pre-await and alert()ed), Esc/backdrop/focus-
  restore; `h2hCreateMatch({quiet:true})` returns `{ok,error}` instead of alerting. Demos in
  gallery.html (single form + 3-step wizard).
- H2H NORMIE FLOW (2026-07): "🎮 Play a friend" — the modal FINDS the server itself
  (`_h2hFindServer`: same-origin → `h2h_last_server` → localhost, 1.3s-timeout /api/health
  pings); the address field lives folded in an Advanced <details> and only unfolds when
  discovery fails or create errors. DS.form skips fields inside closed <details>
  (`visible()` uses getClientRects), so the folded URL never blocks submit; onSubmit
  re-checks it and unfolds with the error instead of firing a doomed request. Invite panel
  (_h2hShowWaiting preJoin) = plain-English lean + `.h2h-link` input (PROBE CONTRACT — the
  two-browser probe reads it) + 📋 Copy (clipboard → execCommand fallback → DS.toast) +
  📤 Share… (navigator.share, phones). Join confirm is a DS.modal ("You're invited! 🏈");
  it only shows when a franchise is ALREADY loaded — h2hJoinFromHash fires at boot before
  loadFranchise, so link-arrivals default to a fresh squad (pre-existing timing, safe
  default). /api/health now reports {static, port, lanHosts} (h2h-server) and
  h2hCreateMatch rewrites a localhost share link onto http://LAN-IP:port when the server
  is STATIC (serves the game files) — couch multiplayer: a phone on the same Wi-Fi can tap
  the link. Regression: `node server/h2h-client-probe.js` (two browsers play to FINAL,
  now also asserts the invite banner + Advanced-folded modal).
- Migration status (DS-UNIFY PASS, 2026-07-08 — the big one): guard debt 1967→829
  (−58% under the EXPANDED scope below; the original four-file scope went 1554→721).
  **Hand-rolled component bypasses 20→0** — nothing grandfathered anymore:
  `_frnConfirmModal` now DELEGATES to DS.modal (legacy `.frn-modal-backdrop`/`.frn-modal`
  + title/footer/type-input classes ride the new `cls`/`backdropCls` hooks + post-mount
  fixups, so probes + team theming + the stats-file Esc-yield keep working; DS.modal
  gained the 250ms backdrop double-click guard), rich-`<span>`-label buttons route
  through `DS.button{labelHtml}` (TRUSTED slot — never pass unescaped data), self-styled
  buttons keep their legacy classes via `cls:`. Fonts: play.css raw stacks 426→108 and
  franchise JS inline stacks →~0 (`font-family:var(--font-…)` is the clean form — the
  guard's lookahead excludes it; survivors are `font-family:inherit` form controls + a
  handful of no-token stacks). Colors 1399→692 via byte-identical token swaps — tier 1
  (lexically inside `style="…"`) AND tier 2 (ternary/const/object colors whose EVERY
  consumer was traced to a DOM style sink; `var()` in DOM-inline SVG fill/stroke/
  stop-color was empirically proven identical in Chromium). SURVIVOR CLASSES (legitimate,
  in baseline): hex-alpha string-concat (`${col}55` — var() would corrupt), colors parsed
  as hex (`_teamInk` luminance math), persisted save data, `var(--x, #hex)` fallbacks,
  console `%c` styling, `_frnFlashToast`'s DS-less fallback palette, sub-8-occurrence
  one-off hues, cross-file palette objects. SCOPE-STABILITY RULE (found by the pass):
  `--blgold`/`--blgray`/`--gold` are REDEFINED by team-theming/HH-MODERN scopes — when
  tokenizing a raw literal use the scope-stable twins `--ds-gold-accent`/`--ds-slate-blue`
  (never redefined), not the theme-following vars; native alert()→`DS.toast` (guarded,
  `else alert` fallback); native confirm() left (sync control flow).
  `#franchiseHome .ds-btn` parity rule keeps migrated buttons matching the legacy look.
- GUARD RULES: `node tools/_ds_guard.js` must exit 0 (check the BARE exit code — never
  pipe it). Coverage = EVERY UI file (core/season/offseason/stats/fantasydraft JS,
  league-client, h2h-client, + play.css font-family-only via CONFIG.fileCategories); a
  new UI file MUST be added to CONFIG.files. Migrating LOWERS counts (fine). Run
  `--update-baseline` ONLY after a verified migration, to lock the gain. Never raise
  the baseline to admit a new bypass.
- Review: the `design-system-review` skill (`.claude/skills/design-system-review/`) is the
  checklist for any UI diff (guard + tokens + components + tests + determinism gates + no-go).

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
  read different from the scores), `--font-data` (Bricolage Grotesque proportional — all data,
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
  minY+0.66*h, upright only; GC_TINT_WAIST — was 0.56, which cut mid-torso and
  left the lower jersey white above the pants; 0.66 = the real waistband).
  FACE + FACEMASK spared (not team-colored): the team color goes on the helmet
  dome/shell, never the face opening. The old 1px skin-adjacency skip left the
  whole cheek/jaw/chin ring tinted; now a FACE-OPENING BOX (skin/face bbox
  expanded ×GC_TINT_FACE_W=1.15 wide, +GC_TINT_FACE_DOWN=0.30 below the chin,
  HEAD band only, needs a detected face) stays white. Bare arms below are skin
  too and a body-wide skip made a polka-dot jersey — hence head-band only. Skin
  mask snapshotted
  from ORIGINAL pixels (a warm tint passes isSkin → cascade-dots otherwise).
  - QA the tint with `node tools/_jersey_color_probe.js [pose]` (regression gate,
    0 flags). It MEASURES color accuracy per region across all 32 teams + stress
    colors instead of eyeballing, using a DIFFERENTIAL mask: render the sprite
    with two tints (magenta/cyan) → pixels that change are jersey/helmet
    (color-independent), the rest is skin/pants/outline. This dodges the same
    warm-color=isSkin trap the tint itself fights (naive output-classification
    scored orange jerseys ΔE 98). Reports jersey hue-drift/chroma/ΔE/exact-band,
    helmet coverage (catches white-helmet vanish), pants speckle, pose-level
    bare-skin frac. Baseline finding: all teams accurate; bright gold/yellow
    drifts most (~ΔE18, ~13° hue) from the ×1.40 highlight clamp — visually fine,
    inherent to the cel ramp. Sheet → /tmp/jersey_color_sheet.png. NOTE:
    drawPlayerSprite tints with PRIMARY only — secondary is unused on the sprite,
    so helmet == jersey color (single-tone by design, not a bug).
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

- Arm↔body daylight gap (SPRITE-ART, not tint): user circled the recess between
  the down-swung arm and the body "filling in color." Confirmed in-art (raw
  structure viz): that pocket is SOLID WHITE FABRIC drawn behind the arm, not
  trapped background — so the tint has no empty pixels to reveal and CANNOT carve
  a see-through gap (it only recolors). The tint mitigations shipped (cavity
  shadow `GC_TINT_CAVITY`/`_REACH` darken the recess for depth), but a true gap
  needs the SPRITE regenerated/sliced with real daylight between arm and torso —
  documented as a renderer-contract rule in `sprites/SPRITE_REQUEST.md` (Step 0).
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

## League M2 — shared-season sim (SHIPPED 2026-07-05)

Online leagues are one REAL shared season, server-owned (was: `advance` only
ticked a clock). Shipped along the planned slices:
- CANONICAL ROSTERS: START mints `leagueSeed` (once, published in the started
  event + snapshot — no re-roll). Default-roster leagues derive all 32 rosters
  from it via `_fdBuildDefaultLeague` (play-franchise-fantasydraft.js — the
  pool build's gen sequence with teams KEPT; contracts deferred to the client
  finish under `leagueSeed ^ 0x5eed5eed`, _fdFinish's exact discipline, because
  generateContract needs offseason.js helpers outside the server bundle) and
  publish `rostersHash` = sha256(`_fdRosterIds`). Fantasy leagues: genesis
  stays (poolSeed + tape). The 18-week schedule is RNG-free → identical
  everywhere, nothing to canonicalize.
- WEEK SIM: `advance` sims the week through the DRAFT-HOST bundle (it already
  contained play-engine.js; EXPORT_HOOK now also exposes GameSimulator +
  schedule/standings builders — engine-host stays for h2h). Per-game seed =
  first 4 LE bytes of sha256("hh-league-game|leagueSeed|season|week|home|away")
  — a pure hash of published inputs, no per-game entropy to shop. Sims run
  PORTABLE math (restored native in finally; GEN stays native = the shipped
  fantasy status quo). Per game only {scores, resultHash} is stored/broadcast
  (`week_results` SSE + GET /api/league/season/:id); standings fold
  server-side; ONE atomic `week-results` jsonl record per week (standings
  snapshot included so reload never needs the kit) — a crash mid-sim loses
  nothing, re-advancing re-sims byte-identically. Week 18 → phase
  "season_complete" (probe-only `settings.seasonWeeks` shortcut,
  HH_LEAGUE_TEST-gated). ~150ms/game, ~2.5s/week wall.
- CLIENT: season HQ screen in play-league-client.js (conference standings,
  last-week scores, this-week fixtures, live via week_results/advanced SSE;
  commissioner ▶ Advance with DS.busy). Default leagues get a ROSTERS
  VERIFIED badge (client re-derives all 32 rosters from leagueSeed and
  sha256-compares) + "Start my franchise" (canonical rosters + seeded
  contracts → preseason). ENGINE NULL-GUARD RULE learned: play-engine's
  `typeof franchise !== "undefined"` guards ALSO need `&& franchise` —
  headless hosts that bundle the franchise layer have `franchise` DEFINED but
  null (audit bundle: undefined; browser: object; league server: null — the
  third state the old guards missed and crashed on).
- PROBES: `server/league-probe.js` now 71 checks (canonical genesis
  re-derived, fixtures match the RNG-free schedule, standings = fold of
  results, independent re-sim resultHash match for BOTH roster modes, restart
  mid-season, season-complete parking, genesis-freeze + seed-publication
  guards); `tools/_league_client_probe.js` now 30 checks (two browsers:
  default-league season screen over SSE, VERIFIED badges, advance → live
  scores, PID-identical local franchises). Verifier recipe: rosters NATIVE,
  game re-sim PORTABLE, NO franchise loaded (server/README.md §League server).
- ADVERSARIAL-REVIEW HARDENING (same session, follow-up commit — 18 findings
  raised, 13 confirmed, all closed): (1) GENESIS FREEZE — rosterMode/
  draftRounds are immutable once phase leaves lobby (rosterMode became the
  genesis POINTER seasonRosters branches on; a post-START flip silently
  swapped the verified genesis or bricked the season). (2) SEED PUBLICATION —
  fantasy leagues now commit leagueSeed to the public event log in
  `draft_started`, BEFORE any pick exists (it previously first appeared in
  `started` AFTER the full tape = a seed-shopping window for an operator who
  knows the finished rosters). (3) ATOMIC ADVANCE — one week-results record
  carries results + a standings CLONE + the week/phase bump (`next`), written
  BEFORE memory commits: no memory/disk fork on append failure, no
  double-fold after a torn two-record write, and event-log history no longer
  aliases the live standings object. (4) tolerant per-line jsonl reload (one
  torn line skipped, not the whole league); manual advance re-arms the
  scheduled timer; season_complete releases the roster cache. Client: verify
  badge keyed to (leagueId, leagueSeed) — never a stale VERIFIED across
  league switches; `_lgLeaveScreens()` on every league-screen exit (SSE
  re-renders were stomping the dashboard); server-sourced numerics coerced
  via `_lgNum` before innerHTML (a malicious deep-linked server could smuggle
  markup through "numbers"); Start-my-franchise disabled on hash MISMATCH.
LEAGUE M3 (playoffs + rollover) SHIPPED 2026-07-07: after the final regular
week ("season_complete") each advance sims ONE bracket round — seeding is a
PURE FOLD of the published standings (win% → point diff → PF → teamId; no
RNG, no h2h reconstruction), 7 seeds/conf + #1 bye + reseed + Super Bowl
(seed-order host), games sim {isPlayoff:true} at week seasonWeeks+round+1
(seeds can't collide with regular weeks; VERIFIERS MUST PASS THE SAME OPT).
Champion → "season_over" → one more advance = "arcade" rollover v1: SAME
canonical rosters (cross-season player dev is its own queued slice),
standings/results/bracket reset, season++ re-namespaces every game seed.
Every playoff record carries the full bracket snapshot (atomic, last-wins
reload); scheduled leagues self-drive the whole loop; champions land on a
persisted trophy shelf. Client: phase-aware season HQ (bracket rounds, alive
chips, champion banner, dynamic advance labels through "Start season N+1"),
live via playoff_results/rollover SSE. Probes: league-probe 79 checks
(bracket re-derived from published standings, SB re-sim hash match, rollover
genesis/reset assertions, restart mid-dynasty), client probe 39 (two
browsers driven to a champion + season 2).
LEAGUE M4 (humanGamesH2H) SHIPPED 2026-07-07: fixtures between two CLAIMED
teams are not auto-simmed — `advance` publishes them as an OPEN week
(`week-partial` record + `week_partial` SSE; standings fold ONLY at week
close) and the members play the game live on an h2h server (match seed =
the league's own per-game derivation, passed via createMatch's new optional
`seed`; rosters = canonical genesis). Result ingest (`POST
/api/league/h2h-result`) trusts NOTHING: pending-fixture match, seed
re-derivation, canonical-roster equality (key-sorted stringify, both sides
JSON-normalized), full tape re-sim on the draft-host kit in the artifact's
declared math mode, resultHash match. NAMED CHEAT SURFACE + CLOSE: a
verified artifact can't prove the opponent authorized the tape (seed+rosters
are public → one member can fabricate a whole match solo, shopping tapes for
a favorable outcome) — so ingest is TWO-PARTY: first verified submission
proposes, the opponent's matching one confirms; two verified artifacts that
DISAGREE mark the fixture disputed (named in the event log, socially
arbitrated) and the commissioner's deadline advance FORCE-SIMS it (null-tape
≡ force-sim byte-identically — coordinator-seam defer). Full close = per-call
GM signatures (queued). `POST /api/league/h2h-challenge` relays the invite
link over league SSE (validated `^https?://|#h2h=`, escaped client-side).
`submitH2HResult` rejects during `_simming` (advance race). CLIENT: season
HQ "LIVE FIXTURES" cards (host = create+challenge+enter; away = join from
the SSE challenge with the CANONICAL roster — never the franchise squad),
auto artifact fetch+submit at FINAL via the `_lgOnH2HFinal` hook in
_h2hOnFinal (both sides → propose+confirm hands-free), deadline-labelled
commissioner advance, create-form 🎮 checkbox. Probes: league-probe 112
(fabricated-artifact rejection battery, dispute→force-sim, live scripted
match → verified ingest, restart with open week + proposal), client probe 49
(two browsers: host card → challenge SSE → join → coach-mode autoplay to
FINAL → verified ledger entry).
GEN DETERMINISM AUDIT DONE (2026-07, see CROSS-MACHINE RULE above): gen path
routed through portable dispatchers, gen-hazard-probe gates it in CI,
native≡portable neutrality proven — the (seed)→rosters derivation is now
validator-fork-safe end-to-end.
PER-CALL GM SIGNATURES SHIPPED (2026-07): the fabricated-tape (M4) and
fabricated-pick (DraftSettlement natspec) surfaces are CLOSED at the
artifact layer with one ECDSA P-256 scheme. Canon lives in
`server/artifact.js` (sigMessage `hh-call|matchId|seq|by|JSON(call)`,
verifyCallSig, verifySignatures) — producer and every verifier share it.
H2H: seats register a pubkey at create/join (browser keypair persisted in
localStorage `h2h_seat_key_v1`, secure-context only); every call from a
keyed seat MUST be signed or it's rejected pre-tape; clock/defense-off auto
entries are SERVER-signed; sigs ride a PARALLEL lane (`sigs[i]` attests
`tape[i]`) so artifactInputsHash v2 and every replay path are UNCHANGED
(unsigned legacy seats = visible coverage gap, not an error).
verify-artifact.js has a signature pass (invalid sig = MISMATCH exit 1).
LEAGUE: members register pubkeys at create/join (published in the
snapshot); draft picks from keyed members are signed
(`hh-pick|leagueId|i|teamId|pid`, auto-picks league-server-signed, full
sigTape + keys served on GET draft); M4 ingest SOLO-ACCEPTS a fully-
attested artifact whose seat keys equal the fixture members'
LEAGUE-REGISTERED keys (match-local keys are self-registrable — the
binding is the point) — one submission, no confirmation round; anything
less falls back to two-party attestation. league-probe 126 checks / the
h2h probe's forged/unsigned/tamper battery are the gates.
NEXT SLICES still queued: draft-verify.js signature report (the referee
recipe is proven in league-probe; the standalone tool prints hashes only),
cross-season player development for league rollovers, LeagueSettlement
(weekly resultHashes on chain — the artifacts are already published +
re-simmable + attested), and playoff fixtures over H2H (M4 is
regular-season only).
PARTY MODE (one-command friend testing): `npm run party` = server/party.js —
h2h + league servers behind ONE origin (path-routed proxy; merged /api/health
serves BOTH discovery contracts with front port + LAN hosts, so every client
auto-finds the same origin), static game files, persistent server/data-party/,
and an automatic cloudflared HTTPS quick tunnel when the binary exists
(secure context keeps remote seats SIGNING — crypto.subtle needs it).
`server/party-probe.js` gates the proxy contract in CI.
SESSION-ENV NOTE: this environment's container resets can silently restore a
stale checkpoint — PUSH (branch + main) immediately after EVERY commit, and
verify expected files exist before editing.
CI (gates.yml, first runs observed 2026-07-05): RED on every push since it
landed — two pre-existing breaks, both fixed this session: (1)
package-lock.json was out of sync with package.json → `npm ci` refused
(lock regenerated; 53 hardhat tests green); (2) _anim_pose_audit
false-flagged the v2-ONLY poses (celebrate2/3, td_celebrate,
signal_first_down) as 404-or-missing on slow runners — the v1 preload 404s
them and the fixed 1.5s settle expired before the v2 manifest reload landed;
the audit now waits for networkidle + SpriteAtlas.stats().loading===0 and
polls http-server readiness instead of sleeping. Gate strictness unchanged.

## UX pass (2026-07 session) — audit → fixes, all SOLVED + shipped

- Full senior-UX audit of the core flows (severity-rated C/H/M/L, grounded in
  screenshots + file:line) drove this batch. Fixes landed, each headless-verified
  + gated:
  - C1 broken preseason roster table: `.frn-scout-row` was BOTH a grid div
    (scout list) and a `<tr>` (roster tables) — `display:grid` on a `<tr>`
    destroyed table layout. Fix: scoped the grid rule to `.frn-scout-list
    .frn-scout-row`. RULE: never style a bare shared class that's used on both
    div and table-row elements.
  - H2 cut/sign feedback: release/street-FA-sign now toast (`_frnFlashToast`).
  - M2 post-game stale-LIVE HUD: `#fieldStatus` only updates per-snap, so FINAL
    kept showing "Q1 15:00 · 1st & 10" in live-green. renderStaticEnd now writes
    "FINAL · <winner> win" (+`.field-status--final` gold), clears the clock; the
    corner ◀ Return button promotes to a centered pulsing gold "Continue →
    Franchise ▶" (`_frnGameEndCTA`, reset in `_frnStartLivePlayback`).
  - H5 next-game CTA hierarchy: the four near-equal actions collapsed to ONE
    primary (CALL THE PLAYS) + a "⏩ Skip ahead ▾" menu (Watch/Sim/Sim-forward;
    `_renderHeroSkipCluster`, hands off to the existing sim-forward panel).
  - H3 player card Manage split: own-player cards now split evaluate
    (Compare/Watch) vs a labeled Manage group (Shop/Block/📝 Restructure/
    ✂ Release, danger-fenced at the far edge).
  - H4 "💰 Cap / Cuts" roster sub-tab (`renderFrnCapCuts`): plain 53-man cap
    ledger (Cap Hit / Dead / Frees) with inline Restructure + Cut. Frees =
    hit − this-year dead tick ONLY when dead is actually owed (deadCapOnRelease
    can report perYear>0 with years=0 on expiring deals → full relief).
- Cross-surface roster actions (H3/H4 plumbing, additive — legacy preseason/cap-
  sheet flows untouched): `_frnCommitRelease` (pure standard release),
  `frnReleaseFromManage` / `frnRestructureFromManage` (self-contained `_frnConfirm`
  modals → apply → refresh in place), `_frnRerenderRosterSurface`. RULES learned:
  - Re-render the ACTIVE surface by detecting the mounted shell (`.frn-bb-fnkey`
    = dashboard → `_frnRenderActiveTab()`, else preseason roster) — NEVER
    enumerate phases (free_agency/fa_cuts/… always misses one).
  - Two independent appliers of one mutation MUST disarm each other's pending
    state: the inline restructure clears a matching `_restructurePending`, else
    the cap sheet's stale ✓ row re-applies captured numbers on a zeroed base
    (phantom bonus, doubled dead — found by adversarial review, not testing).
  - Gate BUTTON VISIBILITY on the same eligibility the handler enforces
    (`_frnRestructureEconomics`) or you ship an enabled button that silently
    no-ops (sub-$2M bases).
  - `_frnConfirmModal` ignores backdrop clicks <250ms after mount (double-click's
    second click landed on the backdrop = instant self-cancel); the player-card
    Esc listener yields while a confirm modal is stacked on top.
- DS interaction-state layer: see "Design System" section above (skeleton/empty/
  error/spinner/busy/toast + keyboard hardening; `_ui_artifact_probe` font
  expectation updated IBM Plex Mono → Anton after the proportional --font-data
  migration — it false-flagged every run).
