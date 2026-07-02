# Hashmark Design System — CONTRACT (single source of truth)

Every foundation builder and migration agent implements EXACTLY this. It lets parallel
agents agree without reading each other's output. Vanilla CSS/JS, no build step.

## Files
- `design-system/tokens.css` — token layer (ADDITIVE :root; never breaks existing vars).
- `design-system/ds.css` — `.ds-*` component classes, styled ONLY via tokens below.
- `design-system/ds.js` — `window.DS` factories returning HTML strings (+ a few DOM helpers).
- Includes: DS CSS after `fonts/fonts.css`, before `play.css` (NO `?v=`). DS JS immediately
  before `play-franchise-core.js` (WITH `?v=` stamp).

## Hard rules (every agent)
1. Do NOT edit determinism/render files: play-engine/render/animation/sprites/broadcast/fx/
   data/motion/sim, sprite art, contracts. DOM chrome only.
2. Do NOT change the field canvas (`#field`,`#field-pixi`,`.bspnlive-field-wrap*`) geometry,
   broadcast layout grid spacing, animation @keyframes structure, or the IPC play-clock DOM.
   (teleport + ipc gates are layout-sensitive.) Restyle via classes/tokens only.
3. No build step, no framework. Escape all interpolated user/data strings with `DS.esc()`.
4. Visual parity: `.ds-*` classes must reproduce the existing component look (line refs in
   play.css given below) so migration is zero-regression. Verified by screenshot E2E.

## TOKENS (design-system/tokens.css) — additive :root block
Reuse existing color/font tokens; ADD the missing scales + semantic aliases.

Spacing:  --ds-space-0:0; --ds-space-1:.2rem; --ds-space-2:.35rem; --ds-space-3:.5rem;
          --ds-space-4:.65rem; --ds-space-5:.85rem; --ds-space-6:1rem; --ds-space-8:1.5rem;
Radius:   --ds-radius-xs:2px; --ds-radius-sm:3px; --ds-radius-md:6px; --ds-radius-lg:10px;
          --ds-radius-xl:16px; --ds-radius-full:999px;
Shadow:   --ds-shadow-sm:0 1px 2px rgba(0,0,0,.3); --ds-shadow-md:0 8px 24px -12px rgba(0,0,0,.7);
          --ds-shadow-lg:0 16px 64px rgba(0,0,0,.85); --ds-shadow-inset:inset 0 1px 0 rgba(255,255,255,.05);
Z-index:  --ds-z-base:1; --ds-z-sticky:40; --ds-z-dropdown:100; --ds-z-modal:4000;
          --ds-z-overlay:4200; --ds-z-toast:5000; --ds-z-top:9999;
Motion:   --ds-dur-fast:.1s; --ds-dur-normal:.12s; --ds-dur-slow:.2s; --ds-ease:ease;
          --ds-ease-out:cubic-bezier(.2,.7,.3,1);
Semantic colors (alias existing — do NOT redefine the raw palette):
          --ds-bg:var(--bg); --ds-surface:var(--bg2); --ds-surface-2:var(--bg3);
          --ds-border:var(--border); --ds-text:var(--white); --ds-text-muted:var(--gray);
          --ds-primary:var(--gold); --ds-primary-strong:var(--gold-lt); --ds-on-primary:var(--bg1);
          --ds-success:var(--green-lt); --ds-danger:var(--red); --ds-info:var(--blgold);
Type (already exist — DS references directly): --font-display, --font-num, --font-data,
          --font-prose; caption scale --bspn-cap (.56rem), --bspn-lbl (.64rem), --bspn-txt (.74rem).

Also (C1): a SAFE, computed-identical tokenization pass in play.css — replace hardcoded
literals with the var that has the IDENTICAL value: `"Bebas Neue","Anton",...`→var(--font-display),
`"Anton","Teko",...`→var(--font-num), IBM Plex Mono stacks→var(--font-mono), Bricolage stacks→
var(--font-prose). Only replace when the value is byte-equal to the token value. Skip the
canvas/broadcast-layout/keyframe rules listed in "Hard rules".

## COMPONENT CLASSES (design-system/ds.css) — match these existing looks
- `.ds-btn` + mods `--gold --primary --outline --danger --sm --lg` and `[disabled]`,
  optional `.ds-btn__icon`. Match play.css `.btn` (88-95,189-212), `.btn-gold` (197-206),
  `.btn-primary` (207), `.btn-outline` (209), `.btn-sm` (212), `.btn-danger` (1253).
- `.ds-card` with `.ds-card__eyebrow .ds-card__title .ds-card__body .ds-card__close`,
  mod `--hero`. Match `.card` (387-390), `.frn-card-box` (12755), `.frn-hero-card` (12773).
- `.ds-chip` + `--active --gold --afc --nfc`. Match `.badge` (447-457), `.ovr-pill` (472),
  `.frn-pulse-chip` (12901), week/tier chips.
- `.ds-tabbar` > `.ds-tab` + `--active`, supports inline `style="--unit-color:..."`.
  Match `.boxscore-tab` (400-408), `.frn-bb-fnkey` (12861).
- `.ds-modal-backdrop` > `.ds-modal` + `--danger`, with `.ds-modal__title/__body/__footer`.
  Match `.frn-modal-backdrop` (1179), `.frn-modal` (1208-1223). Keep z-index = --ds-z-modal.
- `.ds-banner` + `--danger --success --gold`, left accent border + optional `.ds-banner__icon`.
  Match `.play-caption` (311-325), `.frn-delete-warn` (1246).
- `.ds-stat` with `.ds-stat__label .ds-stat__value` + `--elite`. Match `meas-cell`, apb leader card.
- `.ds-table` (thead/tbody) + `.ds-row` + `--mine`. Match leaders table (3038-3064), roster tables.
- `.ds-progress` > `.ds-progress__fill`. Match `.progress-bar/.progress-fill` (350-353), scheme-fit-bar.
- `.ds-toggle`. Match `.frn-pregame-toggle`.
- `.ds-toolbar`/`.ds-nav` > `.ds-nav__link`. Match `_bspnNavHtml`, `.frn-nav-bar` (1126).
- `.ds-select` wrapper for native `<select>`. Match `select,input` (181-186).

## JS API (design-system/ds.js) — window.DS, returns HTML STRING unless noted
- `DS.esc(s)` → escaped string (delegate to global `_escHtml` if present, else built-in).
- `DS.attrs(obj)` → ` key="val"` string helper (escaped). `DS.cx(...names)` → class string.
- `DS.button({label, variant='outline', size, icon, on, disabled, busy, title, type, attrs})`.
  `on` is a JS expression string for inline onclick, e.g. `"frnSetTab('roster')"`.
  `busy` = in-flight state: spinner + `disabled` + `aria-busy="true"`, label kept.
- `DS.card({eyebrow, title, body, onClose, hero, accent, attrs})`.
- `DS.chip({label, active, variant, on, title, disabled})`. Interactive chips (`on` set) emit
  `role="button" tabindex="0"` + Enter/Space activation; `disabled` → `aria-disabled`, handler dropped.
- `DS.tab({id, label, color, active, on, disabled})` and
  `DS.tabBar({tabs:[{id,label,color}], activeId, on})` where `on` is a fn-name string called
  as `on('id')` (e.g. `"frnSetTab"`). Renders `<div class="ds-tabbar">…</div>`. Interactive tabs
  are keyboard-reachable like chips; the active tab carries `aria-current="true"`.
- `DS.modal({title, body, danger, okLabel='OK', cancelLabel='Cancel', requireType})` →
  RETURNS A Promise<boolean> and MOUNTS to document.body. MUST mirror `_frnConfirmModal`'s
  contract: backdrop click = cancel, Esc = cancel, Enter = confirm (if enabled), focus trap
  optional. Also expose `DS.modalHtml(opts)` for callers that build their own string.
- `DS.banner({title, body, icon, variant})`.
- `DS.statTile({label, value, elite})`.
- `DS.row({cells:[...], mine})`, `DS.table({head:[...], rows:[htmlString...], attrs})`.
- `DS.progress({pct, color, label, title})`.
- `DS.toggle({expanded, label, on, disabled, title})`.
- `DS.toolbar({links:[{label, on, active, disabled}]})` (dot-separated nav; interactive links
  are keyboard-reachable, active carries `aria-current`).
- `DS.select({id, options:[{value,label,selected}], value, on, attrs})`.
- FORM LAYER:
  - `DS.input({id, name=id, type, value, placeholder, autocomplete, inputmode, enterkeyhint,
    required, min, max, step, minlength, maxlength, pattern, disabled, spellcheck, ariaLabel,
    on, attrs})` — pass real `name`/`autocomplete`/`inputmode` (autofill + mobile keyboards
    key off exactly these).
  - `DS.checkbox({id, name=id, label, checked, disabled})` — label WRAPS the input (whole row
    is the target, no for/id wiring needed).
  - `DS.field({id, label, control, hint, error, required})` — label(for=id) + TRUSTED control +
    hint + an ALWAYS-PRESENT `.ds-field__error` slot; DS.form wires `aria-describedby` →
    hint/error at bind time.
  - `DS.form(root, {validate:{name:(v,el,values)=>""|msg}, onSubmit:async(values,ctl)})` →
    controller `{values, validate(scope?), validateField, setError, setFormError, destroy}`.
    THE VALIDATION UX CONTRACT: native constraint validation first (humanized messages), then
    the custom rule; a field is silent until first BLUR, then re-validates on every INPUT so
    the error clears as soon as it's fixed; submit validates visible fields, focuses the first
    invalid one, busies the submitter around the async work, and renders a thrown Error /
    `{error}` return into the form's `.ds-form-error` (role="alert"). Enter submits (real
    `<form>`, novalidate).
  - `DS.steps({steps:[{id,label}], activeIdx, doneIdx})` (header string; active =
    `aria-current="step"`, done = ✓) + `DS.stepper(root, {steps, form, onFinish})` — panels are
    `[data-step-panel]` in order, header renders into `[data-steps-header]`,
    `[data-step-next]` validates ONLY the active panel via the DS.form controller before
    advancing, `[data-step-back]` never blocks; focus moves to the new panel.
  - `DS.trapFocus(dialogEl)` → dispose fn — the DS.modal Tab-cycle for custom dialogs (form
    modals). Focus RESTORE stays the caller's job.
- `DS.spinner({size:'sm'|'lg', label})` — with `label` → standalone `role="status"` + sr-only
  text; without → `aria-hidden` decoration for use inside an `aria-busy` control.
- `DS.skeleton({variant:'text'|'block'|'tile'|'table', lines, rows, cols, width, height, label})`
  — loading placeholder for genuinely-async content (IDB/network), never instant renders.
  Container = `role="status" aria-busy` + ONE sr-only label; bars are `aria-hidden`.
- `DS.emptyState({icon, title, body, action, compact})` / `DS.errorState({icon='⚠', title,
  body, detail, retry, action, compact})` — shared `.ds-state` layout. `body` TRUSTED,
  icon/title/detail escaped; `action` = DS.button opts (or trusted HTML). errorState carries
  `role="alert"` (announced on injection) and `retry` sugar → a gold "↻ Retry" action.
- `DS.toast({message, kind:'success'|'warn'|'error'|'info', duration=3500})` → DOM helper,
  RETURNS the element. Singleton top-center feedback strip; success/warn/info = `role="status"`
  (polite), error = `role="alert"` (assertive); auto-dismisses; `pointer-events:none`.
  `_frnFlashToast` delegates here — new code should call `DS.toast` directly.
- `DS.busy(elOrSelector, on)` → DOM helper for async handlers: toggles spinner + `disabled` +
  `aria-busy` + `.ds-btn--busy` on a mounted control around an await. Idempotent.
- `DS.mount(parentElOrSelector, html, {replace=false})` → DOM helper for createElement sites:
  parses html and appends (or replaces children). Returns the inserted root element.
All factories must HTML-escape labels/text by default. `on`/`attrs`/raw `body` are trusted
(caller's responsibility) — document this clearly.

## GUARD (tools/_ds_guard.js) — enforce "no bypassing"
Scan play-franchise-core/season/offseason/stats.js for bypass patterns:
  (a) inline `font-family:` literals inside JS template strings,
  (b) raw hex/rgb color literals used for styling inside JS strings (`#abc`, `rgba(...)`),
  (c) hand-rolled component markup that should be a DS call: `class="btn`, `class="badge`,
      `class="frn-modal`, `class="progress-bar`, etc. (configurable list).
Record current counts per file+category in `tools/_ds_guard_baseline.json`. RATCHET: exit 1 if
any count EXCEEDS baseline (new bypasses blocked); migration LOWERS the baseline. Flag
`--update-baseline` rewrites the baseline (run after a verified migration). `--report` prints
per-file deltas. This is the enforcement that "all new UI routes through the library."

## TESTS
- `tools/_ds_component_test.js` (playwright, port 5199): load play.html, in-page call each
  `DS.*` factory, assert: returns a string, has the right `.ds-*` class, escapes a malicious
  label (`"><img>` → no raw tag), computed style of a mounted sample resolves the token (e.g.
  `.ds-btn` background non-empty, `.ds-modal` z-index === 4000). Assert `DS.modal` mounts +
  resolves on confirm/cancel. Exit 0/1 with a pass/fail tally.
- `tools/_ds_e2e.js` (playwright, port 5200): load play.html, start a franchise, open the
  dashboard, click ≥2 tabs, open + dismiss a modal, screenshot to /tmp/ds_e2e_*.png, assert
  `.ds-*` nodes present in the live DOM and ZERO pageerror. Exit 0/1.

## REVIEW SKILL
`.claude/skills/design-system-review/SKILL.md` (YAML frontmatter name+description, markdown
body): given a diff, verify (1) tokens used not literals, (2) DS components used not hand-rolled,
(3) `node tools/_ds_guard.js` passes (no new bypass), (4) escaping present, (5) determinism
gates green (`node _audit_gate.js --fast`, `./_teleport_gate.sh`, `node tools/_anim_pose_audit.js`),
(6) no edits to no-go files/DOM. Output a checklist verdict.
