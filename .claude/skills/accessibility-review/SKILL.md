---
name: accessibility-review
description: >-
  Use when reviewing or adding ANY DOM/UI change in the hashmark-heroes franchise UI to verify it
  stays accessible and responsive for regular, low-vision, keyboard-only, and multi-device users.
  Runs the four a11y probes (responsive / keyboard+focus / contrast+scaling / semantics) across the
  core paths at desktop/tablet/phone, checks visible focus, modal focus trap+restore, icon-button /
  form / image / status semantics, and confirms the change is determinism-neutral (gates green).
---

# Accessibility Review — hashmark-heroes

Review a UI diff (or a new screen) for accessibility + responsiveness. This is a DOM/CSS/ARIA
concern — the canvas/PIXI game render and the engine/determinism path are out of scope to EDIT,
but the chrome around them must be operable by everyone. Work through every step; output a
PASS/FAIL checklist with the failing items + how to fix.

## 0. Scope check (no-go)
Confirm the diff does NOT edit determinism/render files (play-engine/render/animation/sprites/
broadcast/fx/data/motion/sim, sprite art), the `#field`/`#field-pixi`/`.bspnlive-field-wrap`
canvas geometry, the broadcast layout grid, `@keyframes` structure, or the IPC play-clock DOM.
A11y fixes are ADDITIVE (attributes/styles), never a behavior change.

## 1. Automated probes (the gate) — run from the repo root
Each spins up its own http-server + headless Chromium and walks the core paths
(start screen → `startFranchise(1)` → tabs roster/frontoffice/league/replays/overview →
player card → `_frnEnterLiveGameScreen` / `frnPlayGame(1,2)` → `DS.modal`/`_frnConfirmModal`) at
desktop 1440 / tablet 820 / phone 390 / phone_small 360.

```
node tools/_a11y_responsive_probe.js   # overflow / overlap / truncation / offscreen / h-scroll
node tools/_a11y_keyboard_probe.js     # unreachable controls / focus ring / modal trap+restore / activation
node tools/_a11y_contrast_probe.js     # WCAG AA contrast / tiny-text (<11px) / 200% scaling reflow
node tools/_a11y_semantics_probe.js    # img alt / icon-button names / form labels / live regions / landmarks
```
PASS bar (vs the committed baseline these were brought to):
- responsive: no SEV1 (no page horizontal scroll, no clipped/offscreen interactive control) on any viewport.
- keyboard: 0 unreachable click targets; every interactive control has a visible `:focus-visible` ring;
  both modals trap Tab and restore focus to the trigger; buttons fire on Enter AND Space; no positive tabindex.
- contrast: 0 AA failures; no NEW tiny-text (<11px) on content; no NEW 200%-zoom clip/overflow.
- semantics: 0 nameless interactive elements; all form controls have a real label/aria-label; status text
  has role=status/aria-live; one <h1> + <main>/<nav> landmarks + skip link present.

## 2. Manual keyboard walkthrough (real path)
Tab from page load through a CORE ACTION (start franchise → open a player → sign/cut → sim a week →
play a game). Verify: skip link is the first Tab stop; focus is always visible; every actionable thing
is reachable and activates with Enter/Space; Esc closes modals; focus returns to the trigger after a modal;
focus never gets lost behind a backdrop.

## 3. Component / token discipline (reuse the design system)
New UI must route through `DS.*` / `.ds-*` + tokens (run `node tools/_ds_guard.js`, must exit 0).
Icon-only buttons → `DS.button({icon, ariaLabel})`. Reuse `.sr-only` for hidden labels/skip links,
the `:focus-visible` ring (outline LONGHANDS + box-shadow), and `prefers-reduced-motion` (all in ds.css).
New text colors must clear WCAG AA on their surface; new labels must hit the ≥11px floor.

## 4. Determinism-neutrality (must stay green)
A DOM/CSS/ARIA change must not move the sim or the field render:
```
node _audit_gate.js --fast        # sim drift
./_teleport_gate.sh               # canvas geometry (layout-sensitive)
node tools/_anim_pose_audit.js    # sprite render
node tools/_ds_component_test.js  # DS contract
node tools/_ds_e2e.js             # dashboard click-through, 0 page errors
```

## 5. Verdict
Emit a checklist: for each of (responsive, keyboard+focus, contrast+scaling, semantics, DS discipline,
determinism) → PASS or FAIL with the specific failing selector/path/viewport and the fix. List any
out-of-scope RISKS left.

NOTE: the live game's score/quarter ARE now announced to screen readers via a deduped sr-only
live region (`#a11yGameStatus`, `_bspnA11yAnnounce` in play-broadcast.js — score increases +
quarter advances + final only; the per-second clock is intentionally NOT auto-announced to avoid
chatter). When touching the broadcast scoreboard, keep that hook intact and determinism-neutral.
