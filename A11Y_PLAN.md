# Accessibility & Responsive Hardening — Master Plan & Progress

Branch: `claude/a11y` (worktree `/home/user/hashmark-heroes-a11y`, off `claude/wizardly-ride-h1ir1i`).

## END-TO-END /goal
Make regular, low-vision, keyboard-only, and different-device users all able to reliably
complete the CORE ACTIONS of the franchise sim. Start the app from the current commit, walk
the core paths at desktop/tablet/phone, and FIX: responsive defects (overlap / overflow /
truncation / horizontal scroll), color contrast (WCAG AA), font scaling (200% / browser zoom),
keyboard operability (Tab / Enter / Space / Esc), visible focus states, and the a11y semantics
of images / icon buttons / forms / status. Record issues, fixes, and remaining risks; add an
`accessibility-review` skill; validate the real end-to-end path in a browser (clicks + keyboard).
Keep all existing gates green (DOM/CSS/semantics only — determinism-neutral). Commit + summarize.

### Hard invariants (every agent)
1. DOM/CSS/ARIA only. Do NOT edit the determinism/render path: play-engine/render/animation/
   sprites/broadcast/fx/data/motion/sim, sprite art. Do NOT change the `#field`/`#field-pixi`
   canvas geometry or the broadcast layout grid or the IPC play-clock DOM (teleport + ipc gates).
2. Route fixes through the Design System where applicable: focus-visible styles on `.ds-*`,
   a `.sr-only` util + focus/contrast tokens in `design-system/`. Reuse `DS.*` + tokens; the
   `/design-system-review` rules still apply (no new font/color/markup bypass — `_ds_guard`).
3. No build step. Keep behavior identical; a11y is additive (attrs/styles), never a redesign.
4. All gates stay green (audit, teleport, anim-pose, ds guard/component/e2e).

## Core paths (walk these at every viewport)
1. Start screen — `renderFrnStartScreen()` (franchise create/pick).
2. Start/load franchise → dashboard — `startFranchise(1)` (preseason/dashboard).
3. Dashboard tabs — `frnSetTab('overview'|'roster'|'frontoffice'|'league'|'replays')`.
4. Roster action — open My Roster / a player card / sign a free agent.
5. Play/sim a game — playback controls (play/pause/speed), `_frnEnterLiveGameScreen` / `frnPlayGame(1,2)`.
6. A modal — confirm modal / `DS.modal`.
Viewports: desktop 1440×900 · tablet 820×1180 (+ landscape 1180×820) · phone 390×844 (+ 360×640).

## Baseline (recon)
- App starts at all 3 viewports, no page errors. Phone: 1px horizontal overflow (sw391/cw390).
- Phone hero screen: "START SEASON 1" CTA overlaps the team hero card (responsive overlap).
- a11y gaps: 0 `.sr-only` util; only 3 `aria-label` (many icon/emoji buttons unlabeled); 1 `alt`
  for 2 `<img>`; no skip-link / landmarks / h1 in play.html; focus styles sparse (23 `:focus`,
  11 `:focus-visible`); 73 ad-hoc breakpoints.

## Phased plan
- **Phase A — Audit (parallel, build-a-probe + run + report):**
  - A1 Responsive (tools/_a11y_responsive_probe.js): overlap/overflow/truncation/h-scroll at 3 vp.
  - A2 Keyboard+focus (tools/_a11y_keyboard_probe.js): tab order/reachability, visible focus,
    Enter/Space/Esc on buttons/tabs/modals, focus trap + restore.
  - A3 Contrast+font-scaling (tools/_a11y_contrast_probe.js): text contrast vs bg (AA 4.5/3.0),
    200% text zoom overflow, tiny-text.
  - A4 Semantics (tools/_a11y_semantics_probe.js): img alt, icon-button aria-label, form labels,
    status/live regions, landmarks/headings, lang.
- **Phase B — Synthesize → prioritized fix plan + a11y foundation spec (me).**
- **Phase C — Foundation (focus-visible + .sr-only + reduced-motion + tokens in design-system).**
- **Phase D — Fixes (parallel, partitioned): play.html chrome+landmarks · play.css responsive+
  contrast+focus · franchise JS semantics by file (core/season/offseason/stats) · DS ds.js aria).**
- **Phase E — Validation: re-run all 4 probes at 3 vp + keyboard walkthrough + determinism gates
  + ds guard/component/e2e + before/after screenshots.**
- **Phase F — accessibility-review skill + commit + summary.**

## Phase A findings
### A4 Semantics (DONE) — probe tools/_a11y_semantics_probe.js (103 findings)
- BLOCKERS: `#simManyClose` (× , no name → aria-label="Close"); 5 unlabeled form controls —
  `#homeTeam`/`#awayTeam` (adjacent <label> not associated → add for= or aria-label),
  `#speedSlider` (aria-label="Playback speed"), 2 franchise filter <select> (aria-label).
- FORM weak (49 title-only): depth-boost checkboxes, #simManyCount, #qbOvrInput, #h2hServer →
  promote title → real <label for>/aria-label.
- STRUCTURE: no <main>/<nav>/<header>, no skip-link, ZERO headings/no <h1>. (lang+title OK.)
- STATUS/live: #speedLabel, #h2hStatus, toast container, "✓ Saved" footer → role=status/aria-live.
  Live-game scoreboard/clock is in play-broadcast.js (OUT OF SCOPE render path — note as risk).
- ICON_PREFIX (42 emoji-led labels): add clean aria-label (mapping in agent report/JSON).
- DS layer already good (DS.card close aria-label, DS.modal text buttons) → new UI inherits it.

### A3 Contrast + font-scaling (DONE) — probe tools/_a11y_contrast_probe.js (7404 nodes)
- CONTRAST: 0 AA failures — theme already remediated. NO contrast work needed. (63 unresolved-bg
  gradient cases spot-checked safe; only manually verify gold/light text over light gradient stops
  if touching hero/banner panels.)
- TINY TEXT (HIGH): 159 nodes <11px (down to 8px). Raise the .5rem/.52rem floor to ≥11px on
  CONTENT labels: .frn-pulse-chip-* (play.css 11919-11936), .frn-dc-* (5771/6100/+badges),
  .frn-trade-stance (9169), .frn-inbox-section-title (11744), .frn-gauntlet-rsub (12283),
  .frn-xray-sub (12178). (Decorative kbd hints may stay.)
- FONT-SCALE @200% (HIGH): white-space:nowrap+overflow:hidden clips value chips
  (.frn-pulse-chip-value/-sub/-label — eats "$18.0M"), .livebio-name; schedule row
  "W1 Hawks @ Titans" + .bspnlive-ticker-item overflow viewport. Fix: relax nowrap/allow wrap.
  Phone 200% h-scroll = pre-existing responsive (A1 owns).

### A2 Keyboard + focus (DONE) — probe tools/_a11y_keyboard_probe.js
- P0 MODAL focus NOT trapped (DS.modal ds.js ~195-233 + _frnConfirmModal core ~4229-4296): Tab/
  Shift+Tab escape behind backdrop. Fix: keydown Tab handler cycling first/last focusable.
- P0 MODAL focus NOT restored: capture document.activeElement at open → prev.focus() on close. Both.
- P1 91 UNREACHABLE click targets: scout/pre-roster player rows (tr.frn-scout-row + name <span>
  onclick, no tabindex/role) → can't open player/select row keyboard-only. Fix: row = real button OR
  tabindex=0 + role=button + Enter/Space keydown; drop redundant inner span onclick. 1 <a> no href.
- P1 7 controls NO visible focus ring (.ds-btn/.btn-gold-big/.frn-cap-btn/.frn-ana-tab/.frn-pre-cut):
  existing `#franchiseHome button:focus-visible{outline:2px solid var(--blgold)}` (play.css ~13279)
  computes outline-width:0 (var()-in-outline-shorthand fails). Fix: outline LONGHANDS + box-shadow
  ring on .ds-btn:focus-visible (belt-and-suspenders).
- CLEAN: <button> Enter+Space OK, 5 tabs operable, no positive tabindex.

### A1 Responsive (DONE) — probe tools/_a11y_responsive_probe.js (9 paths × 5 vp)
- Worst = phone 390 / phone_small 360; desktop + tablet-landscape clean.
- SEV1 (h-scroll/clipped): D1 .frn-bb-fnstrip (12586) +153px every tab; D2 .bspnlive-mini-table
  (3725) league +170-200px; D3 .frn-team-banner (1367) START SEASON CTA overlap+clip; D4 .frn-dc-tabs
  (5789) 3rd tab clipped; D5 .frn-pre-roster-table (2025) +31px; D6 .ds-page-header action clipped 12px.
- SEV2: D7 scout rows overlap action btns; D8 preseason tabs overlap modal footer (→ modal focus
  trap also addresses); D9 .frn-dc-name vs snap-col overlap; D10 163 ellipsis-no-title (+2 clipped now
  .frn-trade-name). All in play.css except markup in season.js (D3 ~963).

## Phase B/C/D (synthesis + fixers)
- A11Y_FIX_SPEC.md written (shared conventions: focus ring longhands+box-shadow, .sr-only,
  reduced-motion, modal trap+restore, responsive breakpoint rules, tiny-text floor, icon/form/landmark
  aria mapping). OUT OF SCOPE risk: live-game scoreboard/clock live regions (play-broadcast.js render path).
- [~] Phase D dispatched (5 parallel fixers, disjoint files):
  - CSS: play.css (responsive D1-D9 + 200% + tiny-text + legacy focus longhands)
  - DS: design-system/ (ds.css focus ring/.sr-only/reduced-motion; ds.js DS.modal trap+restore + ariaLabel)
  - HTML: play.html (landmarks/skip/h1 + icon aria + form labels + live regions)
  - JS1: play-franchise-core.js (_frnConfirmModal trap+restore) + stats.js (rows keyboard, tab aria, toast/save status, ellipsis)
  - JS2: season.js + offseason.js (scout/pre-roster rows keyboard, START SEASON + dynamic aria, ellipsis)

## Phase E validation — RESULTS (post-fix, combined tree)
- KEYBOARD: unreachable 91→0 · missing focus-ring 4→0 · modals trap+restore PASS · Enter/Space PASS ·
  no positive tabindex · 0 page errors. (Orchestrator stragglers: 5 `<a>` no-href made operable;
  #franchiseHome focus-ring rule (box-shadow) beat the specificity bug.)
- SEMANTICS: ICON_BTN 0 · IMAGES 0 · STATUS 0 · STRUCTURE 0 · FORM no-name 0 (labeled 6 dynamic selects).
- CONTRAST: 0 AA fails (fixed the skip-link UA-blue regression → gold chip).
- RESPONSIVE: page hScroll 0 all viewports · overflow 0 · offscreen 0 · clipped 0 (team-banner collapse,
  wide-table scroll-in-container, dc-tabs wrap, page-header wrap). Probe refined to ignore .sr-only +
  scroll-container-reachable cells (honest "lost text" metric).
- DETERMINISM: audit --fast PASS · teleport PASS (egr 1/run 5/loop 0) · anim-pose 0/27 · ds component
  59/59 · ds guard PASS · ds e2e GREEN (0 page errors). Change is determinism-neutral.

## REMAINING RISKS / accepted residuals
- Live-game scoreboard/clock have NO live-region announcement — rendered by play-broadcast.js (render
  path, out of scope). SR users don't hear score/clock changes. (Biggest residual.)
- depth-boost checkbox ×46 = "weak name" (named via `title`, WCAG-OK; prefer aria-label). Rendered in
  play-render.js (no-go file) + it's a dev-panel control → left as-is.
- Tiny-text tail: 138 dense-data labels at ~9-10px. WCAG 1.4.4 doesn't mandate a min size; browser zoom
  is the accommodation (page reflows). Egregious 8px content labels were raised. Accepted aesthetic.
- ellipsis-risk ×95 (text-overflow:ellipsis, fits today, no title) + overlap ×29 (cosmetic scout/action
  overlaps, no h-scroll, all reachable) — advisory, non-blocking.
- 200% zoom: page-level reflow works; some dense table CELLS still clip at 200% (deep dense-data limit).

## Progress log
- [x] Phase A (4 audits) · Phase B (FIX_SPEC) · Phase C/D (5 fixers) all complete
- [x] Phase E validation ALL GREEN (probes + determinism gates + ds suite) + straggler fixes
- [x] Phase F accessibility-review skill authored (.claude/skills/accessibility-review/)
- [ ] stamp + commit + push + summary
