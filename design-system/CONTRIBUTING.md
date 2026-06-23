# Contributing to the Hashmark Design System

Practical guide for extending and migrating onto the DS. Read `README.md` for the token
reference + factory API and `CONTRACT.md` for the binding spec. The two rules that gate
everything:

1. **Route all new franchise UI through `DS.*` / `.ds-*` + tokens.** Never hand-roll a
   component, never inline a font/color literal. The guard ratchets against bypasses.
2. **DOM chrome only.** Never touch the determinism/render/layout surfaces (no-go list below),
   or the determinism gates break.

After **every** change here, run the `design-system-review` skill — it is the merge gate.

---

## No-go list (DOM chrome only)

Do **not** edit, and the review skill's Step 6 fails if the diff touches:

- Outcome/render path: `play-engine.js`, `play-render.js`, `play-animation.js`,
  `play-sprites.js`, `play-broadcast.js`, `play-fx.js`, `play-data.js`, `play-motion.js`,
  `play-sim*.js`, sprite art (`sprites/`, `sprites2/`), the `.md` contracts.
- The field canvas geometry (`#field`, `#field-pixi`, `.bspnlive-field-wrap*` sizing).
- Broadcast layout grid spacing.
- `@keyframes` structure in any CSS.
- The IPC play-clock DOM (don't move/hide/restructure it — teleport + IPC gates are
  layout-sensitive).

Restyling these surfaces via classes/tokens is fine; changing geometry/structure/the listed
JS is not.

---

## Adding a new component

A component is **three coordinated pieces** plus enforcement and review. Do all of them.

### 1. CSS class on tokens (`design-system/ds.css`)

Add a `.ds-<name>` class (+ `__part` / `--mod` per the BEM-ish convention already in the file).
Style it **only** with tokens — `--ds-*`, `--font-*`, `--bspn-*`. **No raw hex/rgb, no inline
font-family stack.** If you're matching an existing `play.css` look, copy its computed values
but express them through the equivalent tokens so migration is visually identical (zero
regression — the E2E screenshot verifies parity).

```css
.ds-foo {
  background: var(--ds-surface);
  color: var(--ds-text);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  padding: var(--ds-space-3) var(--ds-space-4);
  font-family: var(--font-mono);
  font-size: var(--bspn-txt);
  box-shadow: var(--ds-shadow-sm);
  transition: background var(--ds-dur-normal) var(--ds-ease);
}
.ds-foo--active { background: var(--ds-primary); color: var(--ds-on-primary); }
```

### 2. JS factory (`design-system/ds.js`)

Add `DS.foo(opts)` returning an HTML **string**. Follow the API conventions:

- **Escape labels/text by default** via `DS.esc()`. Treat `on`, `attrs`, and raw `body` as
  trusted (caller's responsibility) — document that in a comment if non-obvious.
- Handlers are inline string expressions: `on: "frnFoo('arg')"` → `onclick="frnFoo('arg')"`.
  The library never owns state.
- Build classes with `DS.cx(...)` and attributes with `DS.attrs(...)`.

```js
DS.foo = function ({ label, active, on, title }) {
  return `<div class="${DS.cx("ds-foo", active && "ds-foo--active")}"`
       + `${on ? ` onclick="${on}"` : ""}${title ? ` title="${DS.esc(title)}"` : ""}>`
       + `${DS.esc(label)}</div>`;
};
```

If a stateful/DOM component (like `modal`), mirror the existing contract precisely (backdrop =
cancel, Esc = cancel, Enter = confirm, `role="dialog"` + `aria-modal`) and return a Promise; also
expose a `*Html` string variant for callers who build their own markup.

### 3. Component-test assertion (`tools/_ds_component_test.js`)

Add an in-page assertion for the new factory:

- it **returns a string**,
- it carries the right `.ds-<name>` class,
- it **escapes a malicious label** (`"><img>` must not appear as a raw tag in the output),
- a mounted sample resolves the tokens (e.g. computed background non-empty, or a specific
  computed value like z-index for a layered component).

Keep the exit-0/1 pass/fail tally working.

### 4. Update the guard config (only if it replaces a legacy pattern)

If `.ds-<name>` subsumes a hand-rolled markup pattern (e.g. it replaces `class="frn-foo`), add
that legacy substring to the guard's hand-rolled-markup detection list in `tools/_ds_guard.js`,
so future hand-rolls of the old pattern in the franchise JS are flagged. Then re-baseline (see
ratchet below) to record the current legacy counts.

### 5. Document it

Add the class to the README class table and the factory to the README JS API with a one-line
usage example. The README must list **every** `DS.*` factory and class.

### 6. Verify

```
node --check design-system/ds.js
node tools/_ds_component_test.js
node tools/_ds_guard.js
node tools/_ds_e2e.js
```

Then run the **`design-system-review`** skill and clear all 7 steps.

---

## How the guard ratchet works

`tools/_ds_guard.js` scans `play-franchise-core/season/offseason/stats.js` for bypass patterns:

- (a) inline `font-family:` literals inside JS template strings,
- (b) raw hex/rgb color literals used for styling inside JS strings (`#abc`, `rgba(...)`),
- (c) hand-rolled component markup that should be a DS call (`class="btn`, `class="badge`,
  `class="frn-modal`, `class="progress-bar`, … — the configurable list).

It records current counts per file + category in `tools/_ds_guard_baseline.json`.

- **Ratchet:** `node tools/_ds_guard.js` exits **1 if any count EXCEEDS baseline** → a new
  bypass is blocked. Counts at or **below** baseline pass. Migration that removes bypasses
  drives counts down — the desired direction.
- `--report` prints per-file, per-category deltas (what went up/down) without enforcing.
- **`--update-baseline`** rewrites the baseline to the current counts. **Only lower it, only
  after a verified migration** (gates + tests green) — this locks in your progress so the new,
  lower count becomes the ceiling. **Never** raise the baseline to make a failing run pass;
  that defeats the whole point. The reviewer does not re-baseline — the migrating author does,
  as part of the migration commit.

Typical migration commit: remove N hand-rolled instances → counts drop by N →
`node tools/_ds_guard.js --report` confirms the drop → `--update-baseline` → commit the new
baseline alongside the migrated JS.

---

## Migration playbook (hand-rolled → DS)

Go one pattern / one file at a time. Behavior stays identical; only the markup source changes.

1. **Find a hand-rolled instance.** Use the guard report to see what's left, then locate it:

   ```
   node tools/_ds_guard.js --report
   grep -nE 'class="(btn|badge|frn-modal|progress-bar)' play-franchise-core.js
   ```

2. **Replace with the DS factory.** Swap the hand-rolled template for `DS.button({...})` /
   `DS.card({...})` / etc. Keep the inline `on:"frn…"` handler exactly as it was — the library
   doesn't own state. Escape any interpolated data with `DS.esc`.

3. **`node --check`** the file you edited:

   ```
   node --check play-franchise-core.js
   ```

4. **Run the guard** — the count for that file/category should DROP (never rise):

   ```
   node tools/_ds_guard.js --report
   node tools/_ds_guard.js
   ```

5. **E2E** — confirm the live surface still renders, behaves, and screenshots identically with
   zero pageerror:

   ```
   node tools/_ds_e2e.js
   ```

6. **Re-baseline** (after the migration is verified) and **run the review skill** before commit:

   ```
   node tools/_ds_guard.js --update-baseline
   ```

7. If you added the DS JS include or changed any stamped JS, run the build stamp before pushing:

   ```
   ./tools/_stamp_build.sh
   ```

8. **Determinism check.** The migration is DOM chrome only, so the gates must stay green —
   the review skill runs them, but you can spot-check:

   ```
   node _audit_gate.js --fast
   ./_teleport_gate.sh
   node tools/_anim_pose_audit.js
   node tools/_ui_artifact_probe.js
   ```

Commit per file (core / season / offseason / stats) so each migration is reviewable and the
baseline drop is traceable. **Always finish with the `design-system-review` skill** — a diff is
mergeable only when all 7 of its steps pass.
