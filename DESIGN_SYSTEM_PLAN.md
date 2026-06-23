# Design System Refactor — Master Plan & Progress

Branch: `claude/design-system` (worktree at `/home/user/hashmark-heroes-ds`, off `claude/wizardly-ride-h1ir1i`).

## END-TO-END /goal (the whole job, not the next step)

Abstract the scattered UI components, style tokens, and repeated interactions of this
vanilla HTML/CSS/JS franchise sim into ONE unified, reusable, maintainable Design System
(`design-system/` = tokens + component library + docs). Replace hand-rolled one-off DOM
components with library components across the franchise UI surfaces, **route all new UI
through the library with no bypassing** (enforced by an automated guard wired into the
ship workflow), add component + end-to-end tests, author a design-system **review skill**,
validate the real end-to-end path in a headless browser (load, click tabs, open modals,
screenshot), and prove the change is **determinism-neutral** (all existing gates green).
Commit in the worktree, summarize, and ask before any push to a shared branch.

### Hard invariants (non-negotiable guardrails for EVERY sub-agent)
1. **Determinism / anti-cheat is sacred.** The DS touches **DOM chrome only**. Do NOT edit
   the outcome/render path: `play-engine.js`, `play-render.js`, `play-animation.js`,
   `play-sprites.js`, `play-broadcast.js`, `play-fx.js`, `play-data.js`, `play-motion.js`,
   `play-sim*.js`, sprite art, contracts. Prove neutrality by running the gates.
2. **No build step.** Vanilla JS + CSS only. The library ships as plain `<script>`/`<link>`
   includes. No bundler, no framework, no transpile.
3. **Match the existing idiom.** The franchise UI is built with template strings → innerHTML
   (≈1288 hardcoded hex, 148 inline font-family, 130 inline styles, only 28 createElement).
   The library leads with **HTML-string factories** (`DS.button({...}) -> "<button …>"`),
   with optional DOM-element helpers. Do not impose createElement everywhere.
4. **All gates stay green.** See Phase E.
5. **Keep the typography token rules** from CLAUDE.md (`--font-display/-num/-mono/-prose`,
   `--bspn-cap/-lbl/-txt`) — extend, don't replace.

## Phased fleet plan

- **Phase A — Inventory (parallel, read-only) [IN PROGRESS]**
  - A1 CSS & token inventory
  - A2 JS DOM component & interaction inventory
  - A3 build/gate/test/skill infra inventory
- **Phase B — Architecture (me):** synthesize A1–A3 → token spec + component API spec +
  migration map + guard rules. Write `design-system/README.md` (the contract).
- **Phase C — Foundation build (parallel, NEW files = low conflict):**
  - C1 `design-system/tokens.css` (single source of truth) + `design-system/ds.css` (component styles on tokens)
  - C2 `design-system/ds.js` (HTML-string component factories to the API spec)
  - C3 `tools/_ds_guard.js` (no-bypass linter) + `tools/_ds_component_test.js` (headless DOM tests)
  - C4 `.claude/skills/design-system-review/SKILL.md` (review skill) + `design-system/CONTRIBUTING.md`
- **Phase D — Migration (parallel, partitioned BY FILE = no conflict):**
  - D1 migrate play-franchise-core.js → DS
  - D2 migrate play-franchise-season.js → DS
  - D3 migrate play-franchise-offseason.js → DS
  - D4 migrate play-franchise-stats.js → DS
  (each: replace targeted one-off primitives with DS calls; keep behavior identical)
- **Phase E — Integration & validation (me):**
  - wire DS includes into play.html + career-lab.html (correct order), run `_stamp_build.sh`
  - `node --check` every edited JS
  - run guard + component tests
  - run ALL gates (audit, teleport, anim pose) → prove 0 drift / determinism-neutral
  - headless E2E: load dashboard, click tabs, open a modal, screenshot, assert DS classes present
- **Phase F — Review & finish (me):** run the new review skill on the diff, fix findings,
  commit in worktree, write final summary, ask before pushing to a shared branch.

## Integration facts (from A3 — infra inventory)
- **play.html includes** (order): `fonts/fonts.css` → `play.css` (NO `?v=`), then JS:
  data/player/audio/fx/sim/motion → field-pixi/engine/render/sprites/player-pixi →
  simtools/broadcast/animation → **franchise-core/season/stats/offseason** → h2h-client.
  - DS CSS insert: after `fonts/fonts.css`, before `play.css`, NO `?v=` stamp.
  - DS JS insert: immediately BEFORE `play-franchise-core.js`, WITH `?v=` stamp.
- **career-lab.html**: standalone, inline `<style>` + ES module — out of scope, do not touch.
- **Gates & determinism relevance to a DOM-only change:**
  - determinism-NEUTRAL (must still pass, won't be perturbed): `_audit_gate.js --fast`,
    `tools/_anim_pose_audit.js`, `tools/_playsheet_probe.js`, `tools/_bh_normal_probe.js`,
    `tools/_catch_matrix_probe.js`, `tools/_jersey_color_probe.js`.
  - SENSITIVE to DOM/layout: `_teleport_gate.sh` (reads canvas geometry via projectBroadcast)
    and `tools/_ipc_clock_probe.js` (if IPC clock elements move/hide). RULE: do not alter
    `#gameArea`/`#field` canvas size or the broadcast wrap, and don't restructure the IPC
    play-clock DOM. Restyle via classes/tokens only.
- **Playwright**: `/opt/node22/lib/node_modules/playwright` v1.56.1. Harness pattern: spawn
  `npx http-server -p <port> -s .`, `chromium.launch({headless:true})`, goto `play.html`,
  `page.evaluate`. Reuse for `_ds_component_test.js` + E2E click-through.
- **Stamp**: `./tools/_stamp_build.sh` rewrites play.html JS `?v=` + `window.GC_BUILD`.
  MUST run after adding the DS JS include. CSS not stamped.
- **Skill format**: `.claude/skills/<name>/SKILL.md`, YAML frontmatter (`name`, `description`)
  + markdown body. No `.claude/` dir yet — create it.
- **Reusable UI validators**: `tools/_ui_artifact_probe.js` (white-control/tiny-text/offscreen
  scanner), `tools/_ux_snapshot.js` (before/after screenshots), `tools/_morale_ux_audit.js`
  (locker-room e2e). Run these in Phase E.

## Component API spec (from A2 — JS components & interactions)
- **Return type = HTML STRING** (matches 145 innerHTML sites; 625 inline `onclick`). Each
  factory returns a string; callers splice into their own template/innerHTML. Provide an
  optional `DS.mount(parentSelectorOrEl, html)` for createElement-style sites.
- **Handlers stay inline** `onclick="frnFoo('arg')"` — factories take a `on`/`onClick` string
  (the JS expression) so existing global `frn*` wiring is preserved. Library never owns state.
- **Reuse/​subsume helpers**: `_escHtml` (escaping), `_teamInk`/`_hhTeamThemeVars` (team color),
  `playerLink`/`_playerLinkSmart`. DS exposes `DS.esc()` delegating to `_escHtml` when present.
- **Naming**: `DS.<component>()` namespace (e.g., `DS.button`, `DS.card`, `DS.tabBar`,
  `DS.modal`, `DS.chip`, `DS.statTile`, `DS.banner`, `DS.listRow`, `DS.progress`, `DS.table`,
  `DS.toggle`, `DS.toolbar`). Also expose bare aliases if convenient. Keep `frn*` callers intact.
- **Components to build (12, from the catalog)** with variants seen in-repo:
  1. `button` (variants: gold/primary, outline, danger; sizes; icon; disabled) — covers `.btn`/`.ipc-*`
  2. `card`/`panel` (eyebrow/title/body/close) — `frn-*-card`
  3. `tabBar` (active state, `--unit-color` accent, onclick dispatcher) — `frn-bb-fnkey`/`frn-subnav-btn`/`frn-dc-tab`
  4. `listRow`/`tableRow` + `table` (header + mapped rows, "mine" highlight) — leaders/roster tables
  5. `statTile`/`kpi` (label+value, elite state) — `meas-cell`/`frn-apb-leader-card`
  6. `chip`/`tag`/`badge`/`pill` (active state) — `frn-rpl-week-chip`/`tier-pill`/`frn-rpl-mine-tag`
  7. `modal`/`dialog` (Promise-based, backdrop+Esc/Enter, danger variant) — centralize on `_frnConfirmModal`
  8. `banner`/`callout` (accent left-border, title, icon) — streaks/decision-alert
  9. `toggle` (expand/collapse, ▴/▾) — `frn-pregame-toggle`
  10. `progress`/`meter` (pct width, color, tooltip) — `scheme-fit-bar`/`frn-hero-wpbar`
  11. `toolbar`/`nav` (dot-separated links, breadcrumb) — `_bspnNavHtml`/`frn-nav-bar`
  12. `select` wrapper (native `<select>` styled) — team selectors
- **Modal**: keep the existing Promise + backdrop-click + Esc/Enter contract; `DS.modal()`
  returns `{el, close, result}` or a Promise mirroring `_frnConfirmModal`. Do NOT change
  the IPC play-clock DOM (teleport/ipc gate sensitivity).
- **OUT OF SCOPE**: `play-broadcast.js` / `play-render.js` game overlays (determinism zone).

## Progress log
- [x] Worktree created (`claude/design-system`)
- [x] Phase A complete (A1 CSS/tokens, A2 JS components, A3 infra) — findings captured above
- [x] Phase B architecture — `design-system/CONTRACT.md` written (token names, `.ds-*` classes,
      `DS.*` API, guard rules, test/skill specs). Single source of truth for all builders.
- [x] Phase C complete (parallel, disjoint files):
  - [x] C1 tokens.css (42 tokens) + ds.css (47 classes, 0 raw literals) + 3 byte-identical play.css swaps
  - [x] C2 ds.js (window.DS factories) — 42/42 smoke pass, node --check clean
  - [x] C3 _ds_guard.js (+baseline=2038 bypasses) + _ds_component_test.js (55/55) + _ds_e2e.js
  - [x] C4 design-system-review skill + README + CONTRIBUTING
- [x] Integration: DS includes wired into play.html (tokens.css+ds.css before play.css; ds.js
      before franchise scripts). Verified: dashboard loads, tabs switch, modal opens/dismisses,
      ZERO page errors; baseline screenshots /tmp/ds_e2e_*.png. Dashboard visually unchanged.
- [x] Foundation fix (orchestrator): modalHtml now self-contained (.ds-modal-backdrop wrapper);
      modal() mounts its root. Component test 54→55 green (row = trusted-cells by contract).
### Phase D findings / follow-ups (from D1 core)
- **GAP: factories need a `class` passthrough.** `DS.button` etc. can't add a 2nd class, so
  components carrying a JS-queried/CSS-targeted class (e.g. `frn-modal-cancel`, `frn-slot-menu-btn`)
  had to be SKIPPED. FIX (after wave, backward-compatible): add optional `o.class` merged into the
  `cx(...)` of every factory + a component-test assertion. Then a focused 2nd pass captures these.
- **Leave `_frnConfirmModal` as-is** (do NOT force → DS.modal): probes (_ux_snapshot,
  _kb_offseason_probe, _ds_e2e) depend on `.frn-modal-backdrop`, and it sets team-color vars
  (`--team`/`--team-accent`) consumed by play.css `.frn-modal .btn-gold`. NEW modals use DS.modal;
  existing themed confirm modal is grandfathered in the guard baseline.
- D1 result: core component bypass 12→10 (2 plain gold buttons migrated; 8 are the frn-modal special case).
- D2 result: season component 51→10 (41 buttons migrated). Used a local `frnBtn()` wrapper that
  re-injects legacy `btn` as a NON-leading class token → keeps `#franchiseHome .btn` descendant
  overrides (parity) while dropping the guard count. Residual 10 = `btn-gold-big` (no DS equiv).
- ⚠️ COLLISION RISK (Phase E check): parallel agents may each define a global `frnBtn` (or similar)
  helper in their own file → load-time clash. Phase E MUST grep for duplicate global helper names
  across franchise files and reconcile. Preferred fix: add `class`/`cls` passthrough to DS factories
  (so the legacy-class re-injection is done by the factory, no per-file wrapper) + dedupe/rename.
- D4 result: stats component 67→3 (64 buttons migrated). Tab bar (frn-bb-fnkey w/ F-key spans +
  count badges) + dense tables SKIPPED (no DS equiv w/o regression) — frnSetTab intact.
- ⚠️ CONSISTENCY (Phase E check): D2 kept legacy `btn` class (→ inherits `#franchiseHome .btn`
  overrides: Bricolage/10px), D4 dropped to pure `.ds-btn` (ds.css base look). Both render in
  #franchiseHome → buttons could look different across season vs stats screens. Phase E: screenshot
  both, and if mismatched add `#franchiseHome .ds-btn` parity rules to ds.css (Bricolage face + radius).

- [~] Phase D dispatched (parallel, one agent per franchise file): core / season / offseason / stats.
      Guard ratchet: agents REDUCE bypasses, do NOT --update-baseline (orchestrator re-baselines centrally).
      Guardrails: preserve ids/queried-classes/handlers; avoid IPC/playcall/clock + broadcast DOM + canvas.
      Baseline bypass debt to reduce: core 26 / season 507 / offseason 1022 / stats 483 = 2038.
- [x] Phase D complete: component bypasses 235→60 (~170 buttons → DS.button). core 12→10,
      season 51→10, offseason 105→37, stats 67→3. font/color unchanged (not component-reducible).
      Integrity: all 4 files node --check clean; only one global helper (`frnBtn`, season); no collisions.
- [x] Foundation completion: `class`/`cls` passthrough added to factories (both D1+D3 hit the wall);
      `#franchiseHome .ds-btn` parity rule (fixes D4's mono/6px regression → Bricolage/10px);
      `_stamp_build.sh` now also stamps design-system/ds.js.
- [x] Phase E validation ALL GREEN:
      • component test 59/59 (incl. class passthrough)  • E2E green (live .ds-* nodes, 0 pageerror)
      • audit --fast PASS  • teleport PASS (egregious 1/runaway 5/loop 0)  • anim pose 0/27
      • _ui_artifact_probe CLEAN  • dashboard visually intact (screenshots)
      • guard re-baselined: debt 2038→1863 locked; ratchet green at new bar
      • build stamped (20260623113117)
- [x] Phase F review (design-system-review checklist): guard✓ tokens✓ component✓ e2e✓ gates✓
      no-go✓ (NO determinism/render file touched) escaping/a11y✓. CLAUDE.md documents the DS +
      guard gate + "route all new UI through DS" rule.
- [ ] COMMIT in worktree, then ASK before pushing to a shared branch.

## FINAL RESULT
Unified Design System delivered: token layer + `.ds-*` component CSS + `window.DS` factories +
no-bypass guard (ratchet) + component/E2E tests + `design-system-review` skill + README/CONTRIBUTING
+ CLAUDE.md invariant. ~170 hand-rolled buttons migrated; new UI is forced through the library by
the guard. Determinism-neutral (all gates green). DOM-chrome only; engine/render untouched.
- [ ] Phase C foundation
- [ ] Phase D migration
- [ ] Phase E validation
- [ ] Phase F review + commit
