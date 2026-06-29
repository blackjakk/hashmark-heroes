# Hashmark Heroes — DESIGN.md

> **Football-franchise sim. A broadcast-terminal aesthetic:** near-black canvas, gold + field-green,
> heavy condensed numerals over IBM Plex Mono data, ESPN-broadcast chrome, and a faint CRT phosphor
> glow. Think *Bloomberg terminal × ESPN broadcast × retro CRT*. Drop this into a project and a coding
> agent can generate a matching UI.

This is a vanilla HTML/CSS/JS app (no build step). The token names below are the real CSS custom
properties; the components are the real `.ds-*` classes (factory API `window.DS.*`). The on-field game
is a canvas/PIXI render and is out of scope here — this documents the **DOM chrome** (franchise UI).

---

## Personality

- **Dark, dense, data-first.** Information-rich like a trading terminal; every pixel earns its place.
- **Broadcast energy.** Big condensed numerals, team-colored accents, an ESPN-style scoreboard, a
  scrolling ticker + function-key strip (a "Bloomberg shell").
- **Retro warmth.** A subtle CRT vignette and a phosphor bloom on bright gold/green text so the screen
  reads like it's "punching through the glass." Never skeuomorphic, never loud.
- **Two-tone restraint.** Near-black + one warm gold accent, with field-green as the secondary. Color
  is reserved for meaning (sentiment/grades, team identity), not decoration.

---

## Color

Dark theme. Backgrounds are layered near-black; one gold accent; green secondary; a muted slate for
"broadcast" surfaces. Team colors are injected per-team at runtime via `--team*` vars.

### Core palette
| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0a0f0a` | Page background (near-black) |
| `--bg2` | `#111811` | Primary surface (cards, panels) |
| `--bg3` | `#1a221a` | Lifted surface (rows, chips) |
| `--card` | `#182018` | Card fill |
| `--border` | `#2e3d2e` | Hairline separators / outlines |
| `--white` | `#f0f0f0` | Foreground text |
| `--gray` | `#999999` | Muted / secondary text (6.8:1 on `--bg`) |
| `--gold` / `--gold-lt` | `#c8a900` / `#f0cc30` | Primary accent (CTAs, highlights) |
| `--green` / `--green-lt` / `--green-dk` | `#1a5c2e` / `#2e8b57` / `#0d3318` | Secondary (success, "play") |
| `--red` | `#c0392b` | Danger / destructive |

### Broadcast palette (the scoreboard / live-game chrome)
`--blgold #f5c542` · `--blwhite #f1f4f9` · `--blgray #9aa7b8` · `--blgreen #3ecf8e` · `--blred #ff5b5b`
· field grass `--field #1f6b34`.

### Sentiment / grade scale (single source of truth for "good→bad" coloring)
Positive `--ds-grade-pos #86e0a3` (soft `#cce8d6`) · Caution `--ds-grade-caution #e8a000` (tan
`#e0b078`) · Warn `--ds-grade-warn #ffc850` · Negative `--ds-grade-neg #ff8a8a` (soft `#ff9b9b`, mid
`#ff9090`, strong `#ff6b6b`, muted `#c08080`) · Info `--ds-accent-blue #86c8ff` · Slate
`--ds-slate #5d6b66` · Neutral `--ds-neutral #888888`.

### Semantic aliases (use these, not the raw palette)
`--ds-bg → --bg` · `--ds-surface → --bg2` · `--ds-surface-2 → --bg3` · `--ds-border → --border` ·
`--ds-text → --white` · `--ds-text-muted → --gray` · `--ds-primary → --gold` ·
`--ds-primary-strong → --gold-lt` · `--ds-on-primary → #0a0f0a` · `--ds-success → --green-lt` ·
`--ds-danger → --red` · `--ds-info → --blgold`.

### Team theming
At runtime each team sets `--team` (primary), `--team-ink` (legible text on it), `--team-accent`
(lifted for contrast), `--team-soft` (`color-mix` tint). UI that represents a team reads these, never a
hardcoded color. **All contrast meets WCAG AA on the dark surfaces.**

---

## Typography

Four roles. Never inline a font stack — use the role token.

| Token | Stack | Use |
| --- | --- | --- |
| `--font-display` | `"Bebas Neue","Anton","Arial Black",sans-serif` | Condensed caps — team names, section titles, logo |
| `--font-num` | `"Anton","Teko","Oswald","Arial Black",sans-serif` | Heavy condensed numerals — **scores, clock, big stats** |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` | All data — labels, chips, table rows, meta |
| `--font-prose` | `"Bricolage Grotesque","Inter",system-ui,sans-serif` | Narrative / body copy |

**Broadcast caption scale (pick one of three, don't invent sizes):**
`--bspn-cap .56rem` (chips, dense bio) · `--bspn-lbl .64rem` (field labels, records, nav) ·
`--bspn-txt .74rem` (list rows, table cells). Numerals use `font-variant-numeric: tabular-nums`.
Minimum content text ≈ 11px (`.7rem`); below that is decorative only.

---

## Spacing & layout

8-step rem scale (compact — this is a dense UI):
`--ds-space-1 .2rem` · `-2 .35rem` · `-3 .5rem` · `-4 .65rem` · `-5 .85rem` · `-6 1rem` · `-8 1.5rem`.

Layout language: a multi-row "terminal shell" — a scrolling **ticker**, a **function-key strip**
(F1–F6 tabs), an **identity row**, then a per-tab content body, with a persistent status footer. Data
lives in dense mono tables and small **stat tiles**; flex/grid rows with `min-width:0` so labels
ellipsize instead of overflowing.

---

## Radius
`--ds-radius-xs 2px` · `-sm 3px` · `-md 6px` (default control) · `-lg 10px` (cards) · `-xl 16px`
(modern franchise cards) · `-full 999px` (pills/chips).

## Elevation / shadow
`--ds-shadow-sm 0 1px 2px rgba(0,0,0,.3)` · `--ds-shadow-md 0 8px 24px -12px rgba(0,0,0,.7)` (cards) ·
`--ds-shadow-lg 0 16px 64px rgba(0,0,0,.85)` (modals) · `--ds-shadow-inset inset 0 1px 0 rgba(255,255,255,.05)`.
Bright gold/green text also carries a soft **phosphor glow** (`text-shadow: 0 0 4px currentColor, 0 0
12px rgba(240,204,48,.25)`) — the signature "broadcast" bloom. Use sparingly, on accent text only.

## Z-index
`--ds-z-base 1` · `-sticky 40` · `-dropdown 100` · `-modal 4000` · `-overlay 4200` · `-toast 5000` ·
`-top 9999` (CRT overlay).

## Motion
`--ds-dur-fast .1s` · `-normal .12s` · `-slow .2s`; easing `--ds-ease ease`,
`--ds-ease-out cubic-bezier(.2,.7,.3,1)`. Buttons lift `translateY(-1px)` on hover. **Honors
`prefers-reduced-motion`** (transitions/animations collapse to ~0).

---

## Components (`.ds-*` classes / `window.DS.*` factories)

Factories return HTML strings (matching the `innerHTML` idiom); inline handlers via `on:"fn('x')"`;
text auto-escaped; extra classes via `class:`. Every interactive element gets a gold `:focus-visible`
ring (outline longhands + box-shadow).

- **`DS.button({label, variant, size, icon, on, disabled, ariaLabel, class})`** — `--gold` (gradient
  CTA), `--primary` (green), `--outline` (default), `--danger`; sizes `--sm`. Gold = the one true CTA.
- **`DS.card({eyebrow, title, body, onClose, hero})`** — surface `--bg2`, radius `lg/xl`, `--md` shadow;
  `--hero` adds a team-accent top border + radial wash.
- **`DS.chip({label, active, variant})`** — pill, `border-radius:full`, mono; active = gold fill.
- **`DS.tabBar({tabs, activeId, on})` / `DS.tab(...)`** — function-key/segmented tabs; active = gold,
  supports a per-tab `--unit-color` accent.
- **`DS.modal({title, body, danger, okLabel, cancelLabel})`** — Promise-based; backdrop+Esc = cancel,
  Enter = confirm; **focus-trapped + restores focus**; backdrop `--ds-z-modal`.
- **`DS.banner({title, body, icon, variant})`** — left accent border; `--danger/--success/--gold`.
- **`DS.statTile({label, value, elite})`** — small KPI; numerals in `--font-num`; `--elite` highlights.
- **`DS.table({head, rows})` / `DS.row({cells, mine})`** — dense mono table; `--mine` = your-team row.
- **`DS.progress({pct, color, label})`** · **`DS.toggle({expanded, label, on})`** ·
  **`DS.toolbar({links})`** (dot-separated nav) · **`DS.select({options, value, on})`**.

---

## Signature aesthetic (what makes it *this* product)

1. **CRT vignette** — a fixed, full-screen, `pointer-events:none` darkened-edge overlay (no animation —
   a page-wide opacity flicker was removed for perf).
2. **Phosphor glow** on bright gold/green text (see Elevation).
3. **ESPN broadcast scoreboard** — heavy condensed numerals, team-color score panels, period + clock,
   a scrolling bottom ticker.
4. **Bloomberg shell** — ticker → function-key strip → identity row → body → status footer.
5. **Team-color injection** — surfaces tint to the active team via `--team*` while staying AA-legible.

---

## Responsive

Mobile-first-friendly down to 360px. Wide data tables scroll **inside a container** (never the page);
the team banner collapses to one column on phones; flex/grid children use `min-width:0` so labels wrap
or ellipsize. Layout must survive **200% zoom** without losing content. No horizontal page scroll at any
viewport.

## Accessibility (non-negotiable)

WCAG AA contrast on every surface · visible gold `:focus-visible` ring on all controls · full keyboard
operability (Tab/Enter/Space/Esc; modals trap + restore focus) · `.sr-only` skip link + landmarks
(`main`/`nav`/`banner`) + one `<h1>` · icon buttons carry `aria-label` · forms carry real labels ·
dynamic status (score/quarter, toasts, saves) announced via `role="status"`/`aria-live` regions ·
`prefers-reduced-motion` honored.

---

## Agent prompt guide

When generating UI for this product:

- **Default to dark.** Page `--bg #0a0f0a`; surfaces `--bg2`/`--bg3`; text `--white`/`--gray`.
- **One gold CTA per view** (`DS.button --gold`); everything else is `--outline`. Green = positive/"play".
- **Numerals in `--font-num`, data/labels in `--font-mono`, titles/team names in `--font-display`,
  prose in `--font-prose`.** Never inline a font stack or a raw hex — use a token.
- **Color = meaning:** green good / amber caution / red bad (`--ds-grade-*`); team identity via `--team*`.
- **Compose from `DS.*`**, not hand-rolled markup. Keep it dense: small radii, `--bspn-*` caption sizes,
  tabular numerals, tight spacing.
- **Always**: AA contrast, a visible focus ring, `aria-label` on icon buttons, labels on inputs, and a
  `role="status"` region for live-updating numbers.
- **Vibe check:** "ESPN broadcast graphic rendered on a 90s terminal." Restrained, data-rich, gold-on-black.

---

## Lineage / inspiration

Closest cousins in the `awesome-design-md` collection: **Linear** (precise dark dashboard chrome),
**Sentry** (data-dense dark, accent-on-near-black), **Warp** / **VoltAgent** (terminal-native mono +
void-black + a single accent), **Spotify** (bold accent + big type on dark), and the **retro-web**
entries (*Dell 1996*, *Nintendo 2001*) for the CRT/console-chrome nostalgia this product leans into.
