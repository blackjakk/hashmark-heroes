---
name: design-system-review
description: Use when reviewing or adding any DOM/UI change in the hashmark-heroes franchise UI, to verify it routes through the Design System (DS.* factories + .ds-* classes + --ds-*/--font-*/--bspn-* tokens), adds no font/color/markup bypass, escapes interpolated text, and stays determinism-neutral.
---

# Design System Review

You are reviewing a UI diff in **hashmark-heroes** (vanilla HTML/CSS/JS franchise sim,
no build step). The Design System lives in `design-system/` (`tokens.css`, `ds.css`,
`ds.js` → `window.DS`). The golden rule under review: **all new franchise UI routes
through `DS.*` factories / `.ds-*` classes + tokens — never hand-roll markup, never
inline a font/color literal. The guard enforces it; this skill proves it.**

Work from the repo root (the worktree, e.g. `/home/user/hashmark-heroes-ds`). Run the
steps in order. Collect every failure; do not stop at the first one. End with the
PASS/FAIL checklist verdict (template at the bottom).

First, scope the diff so the later steps know what changed:

```
git diff --stat
git diff
```

The ratcheted UI surfaces (guard CONFIG.files — since the 2026-07 DS-unify pass this is
EVERY DOM UI file, not just the original four): `play-franchise-core.js`,
`play-franchise-season.js`, `play-franchise-offseason.js`, `play-franchise-stats.js`,
`play-franchise-fantasydraft.js`, `play-league-client.js`, `play-h2h-client.js`, and
`play.css` (font-family category only — its `:root` palette/type definitions are the
tokens themselves). A NEW UI file in the diff that is not in the guard's CONFIG.files is
itself a FAIL: coverage is part of the contract.

---

## Step 1 — Bypass gate (the ratchet)

The guard scans the franchise JS for new font/color/markup bypasses vs the committed
baseline. Read the deltas, then enforce.

```
node tools/_ds_guard.js --report
node tools/_ds_guard.js
```

- `--report` prints per-file, per-category deltas (font-family literals, raw hex/rgb
  color literals, hand-rolled component markup like `class="btn`, `class="badge`,
  `class="frn-modal`, `class="progress-bar`).
- The bare run **must exit 0**. Exit 1 = a count EXCEEDED baseline = a new bypass was
  introduced. FAIL Step 1; the report names the file + category. Migration that REMOVES
  bypasses (lowering the baseline) is fine and is the desired direction — never raise the
  baseline to make this pass (only `--update-baseline` after a verified migration, by the
  author, not the reviewer).

## Step 2 — Token check (no raw literals)

Inspect every changed CSS/JS hunk by eye against the diff from the scope step:

- New/changed **CSS** uses tokens, not raw values: `--ds-space-*`, `--ds-radius-*`,
  `--ds-shadow-*`, `--ds-z-*`, `--ds-dur-*`/`--ds-ease*`, the semantic colors
  (`--ds-bg/-surface/-surface-2/-border/-text/-text-muted/-primary/-primary-strong/
  -on-primary/-success/-danger/-info`), the type tokens (`--font-display/-num/-mono/
  -prose`), and the caption scale (`--bspn-cap/-lbl/-txt`). No raw hex/rgb, no inline
  font-family stack.
- New/changed **JS** template strings contain **no** inline `font-family:` and **no** raw
  `#hex`/`rgb()`/`rgba()` used for styling. Color/spacing/type come from classes + tokens.
- New components use `DS.*` factories or `.ds-*` classes — not hand-rolled `<button class="btn">`,
  `<div class="badge">`, `class="frn-modal"`, `class="progress-bar"`, etc.

To spot-check for stragglers the guard might not cover in changed lines:

```
git diff | grep -nE "font-family:|#[0-9a-fA-F]{3,6}\b|rgba?\(" || echo "no raw literals in diff"
```

Each hit must be justified. The LEGITIMATE survivor classes (colors that CANNOT use CSS
`var()` — leave them raw, never "migrate" them):

- canvas 2D fills/strokes (`ctx.fillStyle`), PIXI tints, SVG that is serialized to a
  `data:` URL or rasterized into canvas;
- team-color/data objects and values parsed as colors (`startsWith("#")`, hex math);
- fallback values inside existing `var(--x, #hex)` expressions;
- token DEFINITIONS in `tokens.css` / `play.css :root`;
- monospace font stacks (the `--font-mono` token is a deprecated proportional alias — a
  swap would change the look).

Everything else styling-related and raw in UI JS/CSS is a FAIL. Note the CLEAN forms the
guard recognizes: `font-family: var(--font-…)` does not count as debt, and a JS expression
returning `"var(--ds-…)"` strings (the tier-2 pattern for ternary/computed colors that
land in `style="…"` interpolations) is the correct migration for computed colors.

## Step 3 — Component test

Headless DOM test: calls each `DS.*` factory in-page and asserts class names, escaping, and
that mounted samples resolve the tokens (e.g. `.ds-modal` z-index `=== 4000`).

```
node tools/_ds_component_test.js
```

Must **exit 0**. A non-zero exit prints the failing factory/assertion — FAIL Step 3 with it.

## Step 4 — End-to-end

Loads `play.html`, starts a franchise, opens the dashboard, clicks ≥2 tabs, opens + dismisses
a modal, screenshots, and asserts `.ds-*` nodes are live in the DOM with **zero pageerror**.

```
node tools/_ds_e2e.js
```

Must **exit 0** with no `pageerror`. A console/page error or a missing `.ds-*` node = FAIL Step 4
(name the error and the surface).

## Step 5 — Determinism-neutrality gates

The DS is DOM chrome only, so the outcome path must be byte-identical and the layout-sensitive
gates must stay green.

```
node _audit_gate.js --fast
./_teleport_gate.sh
node tools/_anim_pose_audit.js
node tools/_ui_artifact_probe.js
```

- `_audit_gate.js --fast` — sim drift, **0 drift required** (3 metrics within tolerance).
- `./_teleport_gate.sh` — egregious ≤4, runaway ≤6, loop ≤0 (seed 1337, 4 games). This gate
  reads the canvas geometry via `projectBroadcast`, so a layout change can trip it.
- `tools/_anim_pose_audit.js` — 27 animation families, **0 flags required**.
- `tools/_ui_artifact_probe.js` — UI scanner: **0** white-control / tiny-text (<8px) / offscreen
  artifacts. A DS restyle that breaks a control surfaces here.

Any non-zero exit = FAIL Step 5 (name the gate). If the audit or teleport gate regresses on a
DOM-only diff, something touched a no-go file — go to Step 6.

## Step 6 — No-go check

Confirm the diff does **NOT** touch any determinism/layout-protected surface:

```
git diff --name-only
```

FAIL if the diff touches any of:

- Outcome/render path: `play-engine.js`, `play-render.js`, `play-animation.js`,
  `play-sprites.js`, `play-broadcast.js`, `play-fx.js`, `play-data.js`, `play-motion.js`,
  `play-sim*.js`, sprite art (`sprites/`, `sprites2/`), or the contract `.md` files.
- The field canvas geometry: `#field`, `#field-pixi`, `.bspnlive-field-wrap*` sizing.
- The broadcast layout grid spacing.
- `@keyframes` structure in any CSS.
- The IPC play-clock DOM (do not move/hide/restructure it).

Restyling these surfaces via classes/tokens only is allowed; changing geometry, keyframe
structure, or the listed JS files is a FAIL. The DS touches DOM chrome only.

## Step 7 — a11y / escaping

Verify in the diff:

- **Escaping**: every interpolated user/data string is escaped via `DS.esc(...)` (or a factory
  that escapes labels by default). The TRUSTED slots are `on`/`attrs`/raw `body`/`cells`/
  **`labelHtml`** (DS.button's rich-label slot) — confirm no unescaped user data lands in
  any of them. Raw concatenation of player names, team names, or any data field into a
  template string (or into `labelHtml`) without `DS.esc` is a FAIL.
- **Buttons** have a discernible label (text or `aria-label`); icon-only buttons set a title/label.
- **Modals** keep `role="dialog"` + `aria-modal="true"` and the full `DS.modal` contract:
  backdrop click = cancel (ignored <250ms after mount — the double-click guard), **Esc =
  cancel**, **Enter = confirm** (when enabled), focus trap + restore. A modal that drops any
  of these = FAIL. A hand-rolled modal in new code is a FAIL — delegate to `DS.modal`; legacy
  selectors that probes/theming need ride the `cls`/`backdropCls` hooks (the
  `_frnConfirmModal` pattern).

To audit escaping quickly:

```
git diff | grep -nE "\$\{[^}]*\}" | grep -viE "DS\.esc|esc\(|\.attrs|on:|onClick" || echo "review interpolations above for DS.esc"
```

(Heuristic — interpolations of literals/numbers/already-escaped values are fine; flag only
raw data/user strings.)

---

## Verdict — output this checklist

Report PASS/FAIL per step. For each FAIL, name the offending file/line/gate and the fix.

```
DESIGN SYSTEM REVIEW — <branch/diff>

[ ] Step 1  Bypass gate        node tools/_ds_guard.js exits 0 (no new bypass vs baseline)
[ ] Step 2  Token check        changed CSS/JS uses --ds-*/--font-*/--bspn-* + .ds-*, no raw literals
[ ] Step 3  Component test     node tools/_ds_component_test.js exits 0
[ ] Step 4  E2E                node tools/_ds_e2e.js exits 0, no pageerror, .ds-* live
[ ] Step 5  Determinism gates  audit --fast / teleport / anim-pose / ui-artifact all green
[ ] Step 6  No-go check        diff touches no engine/render/anim/sprite/canvas/keyframe/IPC surface
[ ] Step 7  a11y / escaping    DS.esc on interpolated data; button labels; modal role/aria + Esc/Enter/backdrop

VERDICT: PASS  (all steps ✓)   |   FAIL
Failing items:
  - <step>: <file:line or gate> — <how to fix>
```

A diff is mergeable only when all 7 steps PASS.
