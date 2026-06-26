# A11Y Fix Spec — shared conventions (every fixer follows this)

Findings live in the agent reports + on disk: `/tmp/a11y_resp_findings.json`,
`audit-results/a11y_contrast_findings.json`, semantics JSON, and each `tools/_a11y_*_probe.js`
(re-runnable). Invariants: DOM/CSS/ARIA only; no determinism/render/canvas/IPC-clock edits;
keep behavior identical (a11y is additive); keep `_ds_guard` + all gates green.

## 1. Focus ring (FOUNDATION — fixes A2 P1 "outline computes 0")
Root cause: `outline: 2px solid var(--blgold)` shorthand computes `outline-width:0`. Use LONGHANDS
everywhere + a box-shadow belt-and-suspenders on DS buttons.
- DS (`design-system/ds.css`): 
  `.ds-btn:focus-visible, .ds-chip:focus-visible, .ds-tab:focus-visible, .ds-toggle:focus-visible {
     outline-width:2px; outline-style:solid; outline-color:var(--ds-info); outline-offset:2px;
     box-shadow:0 0 0 2px var(--ds-bg), 0 0 0 4px var(--ds-info); }`
- Legacy (`play.css`): replace the broken `#franchiseHome button:focus-visible {outline:2px solid var(--blgold)}`
  with longhands; add the same to `.btn-gold-big`, `.frn-cap-btn`, `.frn-ana-tab`, `.frn-pre-cut`,
  and a global `:focus-visible` longhand fallback for links/inputs/[tabindex]/[role=button].
  Keep `:focus:not(:focus-visible){outline:none}` so mouse clicks don't show the ring.

## 2. .sr-only utility (FOUNDATION — used by skip link + hidden labels)
Add to `design-system/ds.css`:
`.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}`
`.sr-only-focusable:focus,.sr-only-focusable:focus-within{position:static;width:auto;height:auto;
  margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal;}` (for the skip link).

## 3. prefers-reduced-motion (FOUNDATION, DOM chrome only)
Add to `design-system/ds.css`: `@media (prefers-reduced-motion: reduce){ *,*::before,*::after{
  animation-duration:.001ms!important;animation-iteration-count:1!important;
  transition-duration:.001ms!important;scroll-behavior:auto!important;} }`
(Does NOT affect the canvas/PIXI game render — that's JS-driven, not CSS.)

## 4. Modal focus trap + restore (fixes A2 P0 — apply to BOTH)
`DS.modal` (`design-system/ds.js`) and `_frnConfirmModal` (`play-franchise-core.js`): on open,
`const prevFocus = document.activeElement`; focus the first focusable in the modal; add a `keydown`
Tab handler that cycles focus within the modal's focusables (Tab on last→first, Shift+Tab on
first→last); on close (Esc / confirm / cancel / backdrop), call `prevFocus && prevFocus.focus()`.

## 5. Responsive (play.css — fixes A1 D1-D9 + A3 200%) — add a phone breakpoint
General rule: give flex/grid children `min-width:0` so they can shrink; wrap wide TABLES in an
`overflow-x:auto` container instead of scrolling the page. Specific:
- D1 `.frn-bb-fnstrip` (12586): @≤640px `overflow-x:auto;flex-wrap:nowrap` (scroll inside itself) or hide
  (it duplicates the tab nav); collapse `.frn-bb-fnkey-cmd`.
- D2 `.bspnlive-mini-table` (3725) in `.bspn-panel`: @phone wrap in `overflow-x:auto` (or the panel gets it).
- D3 `.frn-team-banner` (1367): @≤640px `grid-template-columns:1fr` (CTA stacks full-width below). KNOWN baseline overlap.
- D4 `.frn-dc-tabs` (5789): grid items `min-width:0`; reduce `.frn-dc-tab` padding/letter-spacing; ellipsize titles.
- D5 `.frn-pre-roster-table` (2025): @phone `overflow-x:auto` wrapper.
- D6 `.ds-page-header` actions: allow wrap on phones (route via DS — it's a ds-* class).
- D7 scout rows overlap action btns / D9 `.frn-dc-name` vs `.frn-dc-snap-col`: `min-width:0`+ellipsis on name, fixed action/snap track.
- A3 200%: relax `white-space:nowrap;overflow:hidden` on `.frn-pulse-chip-value/-sub/-label` (let value chips wrap);
  let schedule row + `.bspnlive-ticker-item` wrap.
- TINY TEXT floor (A3): bump `.5rem`/`.52rem` CONTENT labels to ≥`.7rem` (~11px): `.frn-pulse-chip-*` (11919-11936),
  `.frn-dc-*` (5771/6100/badges), `.frn-trade-stance` (9169), `.frn-inbox-section-title` (11744),
  `.frn-gauntlet-rsub` (12283), `.frn-xray-sub` (12178). (Decorative kbd hints may stay.)
Do NOT touch `#field`/`#field-pixi`/`.bspnlive-field-wrap` geometry or the IPC play-clock.

## 6. Semantics (fixes A4) — accessible names, labels, landmarks, live regions
- play.html STRUCTURE: add skip link (`<a class="sr-only sr-only-focusable" href="#mainContent">Skip to main content</a>`
  as first body child); wrap primary content area as `<main id="mainContent">` (or role=main on #franchiseHome);
  `role="navigation"` on the tab strip/nav; `role="banner"` on the identity row; ensure one `<h1>` per screen.
- play.html ICON BUTTONS → aria-label: `#simManyClose`="Close"; `#playBtn`="Play"; `#pauseBtn`="Pause";
  `#nextPlayBtn`="Next play"; `#endQtrBtn`="Sim to end of quarter"; `#endHalfBtn`="Sim to halftime";
  `#endBtn`="Sim to end of game"; `#viewTacticalBtn`="Tactical view"; `#viewCinemaBtn`="Cinema view";
  `#simBtn`="Simulate game"; `#simManyBtn`="Sim many"; `#testingBackBtn`="Back to franchise";
  `#devToolsLink`="Dev tools"; `#h2hFooterLink`="Live H2H match"; export/import="Export/Import franchise".
- play.html FORMS: `#homeTeam`/`#awayTeam` → wire `<label for>` (or aria-label "Home team"/"Away team");
  `#speedSlider` aria-label="Playback speed"; `#simManyCount` aria-label="Games to simulate";
  `#qbOvrInput` aria-label="Target QB overall"; `#h2hServer` aria-label="H2H server URL";
  depth-boost checkboxes aria-label="Force elite tier".
- play.html LIVE: `#speedLabel` role="status" aria-live="polite"; `#h2hStatus` role="status" aria-live="polite".
- franchise JS: dynamic icon/emoji buttons → clean `aria-label`; clickable `div/span/tr` (player/scout rows)
  → make keyboard-operable: `role="button" tabindex="0"` + Enter/Space keydown (or a real <button>), drop
  redundant inner onclick; toast container + "✓ Saved" footer → `role="status"`; `text-overflow:ellipsis`
  content → add `title`/`aria-label` with the full text (esp. `.frn-trade-name`, `.frn-pulse-chip-*`).
- DS (`ds.js`): icon-only `DS.button({icon, ariaLabel})` should set aria-label (add an `ariaLabel`/`label`-fallback).

## 7. Out of scope (record as RISK, do not edit)
- Live-game scoreboard/clock live regions: rendered by `play-broadcast.js` (render path) — note as a known gap.
- The canvas/PIXI field is not screen-reader content (visual sim).
