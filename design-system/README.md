# Hashmark Design System

The unified, reusable UI library for the **hashmark-heroes** franchise sim. One source of
truth for **tokens** (color, type, spacing, radius, shadow, z-index, motion), **components**
(`.ds-*` CSS classes), and **factories** (`window.DS.*` that return HTML strings).

> **Golden rule:** route **ALL** new franchise UI through `DS.*` / `.ds-*` + the tokens —
> **never hand-roll** a button, badge, card, modal, progress bar, etc., and never inline a
> font or color literal. The guard (`tools/_ds_guard.js`) ratchets against bypasses, and the
> `design-system-review` skill is the review procedure that proves compliance on every diff.

The binding spec — exact token values, the class catalog with `play.css` line refs, and the
factory API — is `design-system/CONTRACT.md`. This README is the human-facing reference; if
the two ever disagree, the CONTRACT wins.

---

## What it is — and the no-build philosophy

hashmark-heroes is **vanilla HTML/CSS/JS with no build step, no framework, no bundler**. The
franchise UI is built with template strings → `innerHTML`, with inline `onclick="frnFoo(...)"`
handlers. The Design System matches that idiom instead of fighting it:

- **CSS** ships as a plain `<link>` (`tokens.css` + `ds.css`). No PostCSS, no Sass.
- **JS** ships as a plain `<script>` exposing `window.DS`. Factories **return HTML strings**
  so callers splice them straight into their existing templates. Handlers stay inline strings
  (`on: "frnSetTab('roster')"`) — the library **never owns state** and never replaces the
  global `frn*` wiring. A `DS.mount()` helper covers the handful of `createElement` sites.
- **Tokens are additive.** `tokens.css` extends `:root` — it aliases the existing palette
  (`--gold`, `--bg2`, `--border`, …) and the existing type tokens (`--font-display/-num/-mono/
  -prose`, `--bspn-*`) into semantic names. It never redefines the raw palette, so nothing
  existing breaks.
- **DOM chrome only.** The DS never touches the determinism/render path (engine, render,
  animation, sprites, broadcast, the field canvas, the IPC play-clock). That keeps every
  determinism gate green. See CONTRIBUTING for the no-go list.

## File map

| File | Role |
| --- | --- |
| `design-system/tokens.css` | The token layer. Additive `:root` block: semantic color aliases over the existing palette, plus the spacing / radius / shadow / z-index / motion scales. **Single source of truth** for design values. |
| `design-system/ds.css` | The `.ds-*` component classes. Styled **only** via tokens above — never raw literals. Reproduces the existing component looks (line refs in CONTRACT) so migration is zero-regression. |
| `design-system/ds.js` | `window.DS` — the factories. Each returns an HTML **string** (a few DOM helpers excepted). All escape labels/text by default. |
| `design-system/CONTRACT.md` | Binding spec (token values, class catalog with `play.css` line refs, full JS API, guard/test/skill specs). |
| `design-system/CONTRIBUTING.md` | How to add a component, how the guard ratchet works, the migration playbook. |

**Include order** (in `play.html`): DS CSS goes **after** `fonts/fonts.css`, **before**
`play.css` (no `?v=` stamp — CSS isn't stamped). DS JS goes immediately **before**
`play-franchise-core.js` (**with** a `?v=` stamp; run `./tools/_stamp_build.sh` after adding it).

---

## Token reference

All values from `CONTRACT.md`. Use these tokens — do not inline the raw values.

### Spacing

| Token | Value |
| --- | --- |
| `--ds-space-0` | `0` |
| `--ds-space-1` | `.2rem` |
| `--ds-space-2` | `.35rem` |
| `--ds-space-3` | `.5rem` |
| `--ds-space-4` | `.65rem` |
| `--ds-space-5` | `.85rem` |
| `--ds-space-6` | `1rem` |
| `--ds-space-8` | `1.5rem` |

### Radius

| Token | Value |
| --- | --- |
| `--ds-radius-xs` | `2px` |
| `--ds-radius-sm` | `3px` |
| `--ds-radius-md` | `6px` |
| `--ds-radius-lg` | `10px` |
| `--ds-radius-xl` | `16px` |
| `--ds-radius-full` | `999px` |

### Shadow

| Token | Value |
| --- | --- |
| `--ds-shadow-sm` | `0 1px 2px rgba(0,0,0,.3)` |
| `--ds-shadow-md` | `0 8px 24px -12px rgba(0,0,0,.7)` |
| `--ds-shadow-lg` | `0 16px 64px rgba(0,0,0,.85)` |
| `--ds-shadow-inset` | `inset 0 1px 0 rgba(255,255,255,.05)` |

### Z-index

| Token | Value |
| --- | --- |
| `--ds-z-base` | `1` |
| `--ds-z-sticky` | `40` |
| `--ds-z-dropdown` | `100` |
| `--ds-z-modal` | `4000` |
| `--ds-z-overlay` | `4200` |
| `--ds-z-toast` | `5000` |
| `--ds-z-top` | `9999` |

### Motion

| Token | Value |
| --- | --- |
| `--ds-dur-fast` | `.1s` |
| `--ds-dur-normal` | `.12s` |
| `--ds-dur-slow` | `.2s` |
| `--ds-ease` | `ease` |
| `--ds-ease-out` | `cubic-bezier(.2,.7,.3,1)` |

### Semantic colors (aliases over the existing palette — do not redefine the raw palette)

| Token | Aliases | Meaning |
| --- | --- | --- |
| `--ds-bg` | `var(--bg)` | App background |
| `--ds-surface` | `var(--bg2)` | Panel/surface |
| `--ds-surface-2` | `var(--bg3)` | Raised surface |
| `--ds-border` | `var(--border)` | Borders/dividers |
| `--ds-text` | `var(--white)` | Default text |
| `--ds-text-muted` | `var(--gray)` | Secondary/muted text |
| `--ds-primary` | `var(--gold)` | Primary accent |
| `--ds-primary-strong` | `var(--gold-lt)` | Stronger primary |
| `--ds-on-primary` | `var(--bg1)` | Text/icon on primary |
| `--ds-success` | `var(--green-lt)` | Success |
| `--ds-danger` | `var(--red)` | Danger/destructive |
| `--ds-info` | `var(--blgold)` | Info |

### Sentiment / grade palette (raw values — the single source of truth for the scattered grade colors)

Byte-identical captures of the recurring sentiment/grade literals (positive → caution → negative).
Use these in inline `style="…"` / CSS. **Do NOT** use them for canvas/PIXI/SVG/data colors — those
need a literal hex (CSS `var()` doesn't resolve there).

| Token | Value | Meaning |
| --- | --- | --- |
| `--ds-grade-pos` | `#86e0a3` | Positive / good |
| `--ds-grade-pos-soft` | `#cce8d6` | Positive, soft |
| `--ds-grade-caution` | `#e8a000` | Caution / amber |
| `--ds-grade-caution-soft` | `#e0b078` | Caution, tan |
| `--ds-grade-warn` | `#ffc850` | Warning gold |
| `--ds-grade-neg` | `#ff8a8a` | Negative / bad |
| `--ds-grade-neg-soft` | `#ff9b9b` | Negative, soft |
| `--ds-grade-neg-mid` | `#ff9090` | Negative, mid |
| `--ds-grade-neg-strong` | `#ff6b6b` | Negative, strong |
| `--ds-grade-neg-muted` | `#c08080` | Negative, muted |
| `--ds-gold-dim` | `#a98a2e` | Dim gold label |
| `--ds-accent-blue` | `#86c8ff` | Info / accent blue |
| `--ds-slate` | `#5d6b66` | Muted slate border |
| `--ds-neutral` | `#888` | Neutral gray placeholder |
| `--ds-skeleton-base` | `var(--bg3)` | Skeleton resting bar |
| `--ds-skeleton-sheen` | `rgba(255,255,255,.07)` | Skeleton moving sheen |

### Type (already exist — DS references them directly)

| Token | Use |
| --- | --- |
| `--font-display` | Bebas Neue / Anton condensed caps — team names, section titles, logo |
| `--font-num` | Anton / Teko heavy condensed numerals — scores, clock, big stats (one stack) |
| `--font-data` | Bricolage Grotesque (proportional) — all data, labels, chips, list rows |
| `--font-prose` | Bricolage — body copy / prose |

### Caption scale (bspnlive)

| Token | Value | Use |
| --- | --- | --- |
| `--bspn-cap` | `.56rem` | Chips, dense bio text |
| `--bspn-lbl` | `.64rem` | Field labels, records, meta, nav |
| `--bspn-txt` | `.74rem` | List rows, table cells |

New text picks one of these three steps — not a fresh px/rem value.

---

## Component classes (`ds.css`)

`.ds-*` classes you can drop into a template directly (or get from the factories below). Each
reproduces an existing `play.css` look (line refs in CONTRACT) for zero-regression migration.

| Class | Modifiers / parts | Replaces |
| --- | --- | --- |
| `.ds-btn` | `--gold --primary --outline --danger --sm --lg`, `[disabled]`, `.ds-btn__icon` | `.btn`, `.btn-gold/-primary/-outline/-sm/-danger` |
| `.ds-card` | `.ds-card__eyebrow/__title/__body/__close`, mod `--hero` | `.card`, `.frn-card-box`, `.frn-hero-card` |
| `.ds-chip` | `--active --gold --afc --nfc` | `.badge`, `.ovr-pill`, `.frn-pulse-chip`, week/tier chips |
| `.ds-tabbar` > `.ds-tab` | `--active`, inline `style="--unit-color:…"` | `.boxscore-tab`, `.frn-bb-fnkey` |
| `.ds-modal-backdrop` > `.ds-modal` | `--danger`, `.ds-modal__title/__body/__footer` | `.frn-modal-backdrop`, `.frn-modal` (z-index `--ds-z-modal`) |
| `.ds-banner` | `--danger --success --gold`, `.ds-banner__icon` | `.play-caption`, `.frn-delete-warn` |
| `.ds-stat` | `.ds-stat__label/__value`, `--elite` | `meas-cell`, apb leader card |
| `.ds-table` (thead/tbody) > `.ds-row` | `--mine` | leaders table, roster tables |
| `.ds-progress` > `.ds-progress__fill` | — | `.progress-bar/.progress-fill`, scheme-fit-bar |
| `.ds-toggle` | `[disabled]` | `.frn-pregame-toggle` |
| `.ds-toolbar` / `.ds-nav` > `.ds-nav__link` | `--active`, `[aria-disabled]` | `_bspnNavHtml`, `.frn-nav-bar` |
| `.ds-select` | wrapper for native `<select>` | `select,input` |
| `.ds-spinner` | `--sm --lg` | (new) inline activity ring |
| `.ds-btn--busy` | on `.ds-btn` | (new) in-flight action state |
| `.ds-skeleton` | `--text --block --tile --table`, `.ds-skeleton__bar/__row` | (new) loading shimmer |
| `.ds-state` | `--empty --error --compact`, `.ds-state__icon/__title/__body/__detail/__action` | hand-rolled empty/error blocks |
| `.ds-toast` | `--success --warn --error --info`, `--visible` | `#frn-flash-toast` (inline-styled) |

**Interaction states (all interactive classes):** hover + `:active` pressed feedback +
keyboard-only `:focus-visible` double ring (btn / chip / tab / toggle / card-close / nav link /
select / modal type-input) + disabled (`:disabled` at .4 opacity; `aria-disabled` for
span/div/a controls; busy at .75 + `cursor:progress`). Transitions ride `--ds-dur-*` /
`--ds-ease*` and collapse under `prefers-reduced-motion`.

---

## JS API — `window.DS`

Every factory returns an **HTML string** unless noted. Splice the string into your template /
`innerHTML`. All factories **HTML-escape labels and text by default**. The fields `on`,
`attrs`, and raw `body` are **trusted** — the caller is responsible for their safety (so pass
escaped HTML into `body`, and only known-safe JS into `on`).

### `DS.esc(s)` → escaped string

Delegates to the global `_escHtml` when present, else a built-in. Escape **all** interpolated
user/data strings.

```js
const safe = DS.esc(player.name); // "O'Neil <DT>" → "O&#39;Neil &lt;DT&gt;"
```

### `DS.attrs(obj)` → ` key="val"` string · `DS.cx(...names)` → class string

Helpers. `attrs` escapes values; `cx` joins truthy class names.

```js
const a = DS.attrs({ id: "row-3", "data-team": team }); // ` id="row-3" data-team="..."`
const cls = DS.cx("ds-row", isMine && "ds-row--mine");  // "ds-row ds-row--mine"
```

### `DS.button({ label, variant='outline', size, icon, on, disabled, busy, title, type, attrs })`

`variant`: `gold`/`primary`/`outline`/`danger`. `size`: `sm`/`lg`. `on` is the inline onclick
JS expression string. `busy` renders the in-flight state (spinner + `disabled` +
`aria-busy="true"`, label kept so the width doesn't jump).

```js
DS.button({ label: "Advance Week", variant: "gold", on: "frnAdvanceWeek()" });
DS.button({ label: "Release", variant: "danger", size: "sm", on: `frnRelease('${DS.esc(p.id)}')`, title: "Cut player" });
DS.button({ label: "Saving…", variant: "gold", busy: true });   // re-render form of DS.busy
```

### `DS.card({ eyebrow, title, body, onClose, hero, accent, attrs })`

`body` is trusted raw HTML; `hero` → `--hero` mod; `onClose` adds a `.ds-card__close`.

```js
DS.card({ eyebrow: "WEEK 7", title: "Trade Block", body: rowsHtml, hero: true, onClose: "frnCloseCard()" });
```

### `DS.chip({ label, active, variant, on, title, disabled })`

`variant`: `gold`/`afc`/`nfc`. `active` → `--active`. Interactive chips (`on` set) emit
`role="button" tabindex="0"` + Enter/Space activation automatically; `disabled` →
`aria-disabled="true"` with the handler dropped.

```js
DS.chip({ label: "AFC", variant: "afc", active: conf === "AFC", on: "frnSetConf('AFC')" });
```

### `DS.tab({ id, label, color, active, on })` and `DS.tabBar({ tabs:[{id,label,color}], activeId, on })`

`DS.tabBar` renders `<div class="ds-tabbar">…</div>`; `on` is a **function-name string**
called as `on('id')`. `color` sets the inline `--unit-color` accent.

```js
DS.tabBar({
  tabs: [{ id:"roster", label:"ROSTER" }, { id:"depth", label:"DEPTH", color:"#c8a900" }],
  activeId: currentTab,
  on: "frnSetTab",   // → onclick="frnSetTab('roster')"
});
```

### `DS.modal({ title, body, danger, okLabel='OK', cancelLabel='Cancel', requireType })` → `Promise<boolean>`

The only stateful factory. **Mounts to `document.body`** and returns a Promise. Mirrors
`_frnConfirmModal`: **backdrop click = cancel, Esc = cancel, Enter = confirm** (when enabled),
`role="dialog"` + `aria-modal`. `requireType` gates confirm behind typing a string (e.g.
team name). `danger` → `--danger`. For callers that build their own string, use
`DS.modalHtml(opts)`.

```js
if (await DS.modal({ title: "Release Player?", body: "Dead money: $4.2M", danger: true, okLabel: "Release" })) {
  frnReleaseConfirmed();
}
```

### `DS.banner({ title, body, icon, variant })`

`variant`: `danger`/`success`/`gold`. Left accent border + optional `.ds-banner__icon`.

```js
DS.banner({ icon: "🔥", title: "3-game win streak", body: "Morale +12 across the locker room.", variant: "success" });
```

### `DS.statTile({ label, value, elite })`

`elite` → `--elite` highlight.

```js
DS.statTile({ label: "PASSER RTG", value: "118.4", elite: rtg > 110 });
```

### `DS.row({ cells:[...], mine })` and `DS.table({ head:[...], rows:[htmlString...], attrs })`

`DS.table` builds `thead`/`tbody`; `rows` is an array of pre-built row strings (use `DS.row`).
`mine` → `--mine` highlight for the user's team.

```js
const rows = leaders.map(p => DS.row({ cells: [DS.esc(p.name), p.yds, p.td], mine: p.team === myTeam }));
DS.table({ head: ["PLAYER", "YDS", "TD"], rows });
```

### `DS.progress({ pct, color, label, title })`

```js
DS.progress({ pct: 72, label: "Scheme fit", title: "72% fit", color: "var(--ds-success)" });
```

### `DS.toggle({ expanded, label, on })`

Expand/collapse control (▴/▾).

```js
DS.toggle({ expanded: open, label: "Pregame report", on: "frnTogglePregame()" });
```

### `DS.toolbar({ links:[{label, on}] })`

Dot-separated nav / breadcrumb.

```js
DS.toolbar({ links: [{ label: "Roster", on: "frnSetTab('roster')" }, { label: "Depth", on: "frnSetTab('depth')" }] });
```

### `DS.select({ id, options:[{value,label,selected}], value, on, attrs })`

Native `<select>` styled via `.ds-select`.

```js
DS.select({ id: "teamPick", value: sel, on: "frnPickTeam(this.value)",
  options: teams.map(t => ({ value: t.id, label: t.name })) });
```

### `DS.spinner({ size, label })`

`size`: `sm`/`lg`. With `label` → standalone `role="status"` + sr-only text (announced once).
Without → `aria-hidden` decoration for use inside a control that carries `aria-busy` itself.

```js
DS.spinner({ label: "Loading league…" });
```

### `DS.skeleton({ variant='text', lines, rows, cols, width, height, label='Loading…' })`

`variant`: `text`/`block`/`tile`/`table`. Loading placeholder for **genuinely-async** content
(an IDB read, a network call) — never for instant renders (almost everything in this app
renders from memory in one frame; a skeleton there is worse than none). Container =
`role="status" aria-busy` + ONE sr-only announcement; the shimmer bars are `aria-hidden`.
Swap it out by re-rendering the region when the data lands.

```js
host.innerHTML = DS.skeleton({ variant: "table", rows: 3, cols: 4, label: "Loading standings…" });
```

### `DS.emptyState({ icon, title, body, action, compact })` · `DS.errorState({ icon='⚠', title, body, detail, retry, action, compact })`

Shared centered `.ds-state` layout. `body` is trusted HTML; icon/title/detail are escaped.
`action` = a `DS.button` opts object (or trusted HTML string). `errorState` carries
`role="alert"` (announced when injected) + `retry` sugar (a trusted handler string → a gold
"↻ Retry"). `compact` for table cells / side panels.

```js
DS.emptyState({ icon: "📂", title: "No franchises yet", body: "Start one below.",
  action: { label: "🚀 Quick start", variant: "gold", on: "frnQuickStart()" } });
DS.errorState({ title: "Couldn't reach the server", detail: e.message, retry: "frnRetryLoad()" });
```

### `DS.toast({ message, kind='success', duration=3500 })` → element (DOM helper)

Singleton top-center feedback strip (also accepts a plain string). `kind`:
`success`/`warn`/`error`/`info` — success/warn/info are polite (`role="status"`), errors
assertive (`role="alert"`). Auto-dismisses; re-calling replaces the message and restarts the
timer; `pointer-events:none` so it never blocks clicks. `_frnFlashToast` delegates here —
new code calls `DS.toast` directly.

```js
DS.toast({ message: `✓ Released ${p.name} · $${dead}M dead cap`, kind: "success" });
```

### `DS.busy(elOrSelector, on)` → element (DOM helper)

Toggle the in-flight state on a **mounted** control around an `await`: leading spinner +
`disabled` + `aria-busy` + `.ds-btn--busy`. Idempotent (no stacked spinners); also a cheap
double-click guard since the control disables synchronously.

```js
const btn = DS.busy("#h2hCreateBtn", true);
try { await createMatch(); } finally { DS.busy(btn, false); }
```

### `DS.mount(parentElOrSelector, html, { replace=false })` → inserted root element (DOM helper)

For `createElement`-style sites: parses `html`, appends (or replaces children when
`replace:true`), and returns the inserted root element.

```js
const el = DS.mount("#franchiseHome", DS.card({ title: "News", body: feedHtml }));
```

---

## Compliance — the guard, the tests, the review skill

- **Guard** — `node tools/_ds_guard.js` ratchets against new bypasses (inline font-family,
  raw hex/rgb, hand-rolled component markup) vs `tools/_ds_guard_baseline.json`. Exit 1 if any
  count exceeds baseline. `--report` shows deltas; `--update-baseline` lowers it after a
  verified migration. This is what enforces "all new UI routes through the library."
- **Tests** — `node tools/_ds_component_test.js` (factory contracts + token resolution),
  `node tools/_ds_e2e.js` (live click-through, screenshot, zero pageerror).
- **Review skill** — invoke `design-system-review` (in `.claude/skills/`) on any UI diff. It
  runs the guard, token check, component test, E2E, the determinism-neutrality gates, the
  no-go check, and the a11y/escaping check, then emits a PASS/FAIL verdict.

To add a component or migrate a hand-rolled one, see `CONTRIBUTING.md`.
