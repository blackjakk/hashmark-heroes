#!/usr/bin/env node
// _ds_component_test.js — Design System component unit/DOM tests (Playwright).
//
// CONTRACT (design-system/CONTRACT.md §TESTS): load play.html, in-page CALL each
// `window.DS.*` string factory and assert:
//   • it returns a STRING carrying the correct `.ds-*` class,
//   • a malicious label is HTML-escaped (no raw `<img>`/`<script>` survives),
//   • a mounted sample's COMPUTED STYLE resolves the design tokens
//       - `.ds-modal-backdrop` z-index === "4000"  (var(--ds-z-modal))
//       - `.ds-btn`            non-empty background
//       - `.ds-progress__fill` width reflects the pct
//   • `DS.modal()` mounts a `.ds-modal-backdrop`, resolves TRUE on confirm and
//     FALSE on Escape (mirrors _frnConfirmModal: backdrop/Esc = cancel,
//     Enter/confirm = ok).
//
// Prints a pass/fail tally; exit 1 on any fail, 0 if all green, 2 on crash.
//
// EXPECTED-RED until integration: ds.js/ds.css are not yet wired into play.html.
// Until then `window.DS` is undefined and every assertion fails — that is the
// correct signal that wiring is missing. The test is written to the CONTRACT so
// it goes green the moment ds.js/ds.css are included.
//
//   node tools/_ds_component_test.js     (starts its own server :5199)

"use strict";
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");

const PORT = 5199;
const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }));

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ FAIL " + label); }
};

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);

  // ── 0. DS present? (the integration gate) ──────────────────────────────────
  const hasDS = await page.evaluate(() => typeof window.DS === "object" && window.DS !== null);
  ok(hasDS, "window.DS is wired into play.html (ds.js included)");
  if (!hasDS) {
    console.log("\n[ds-component] window.DS is undefined — EXPECTED-RED until ds.js/ds.css");
    console.log("[ds-component] are included in play.html (integration phase). Skipping the");
    console.log("[ds-component] remaining factory/mount/modal assertions.");
    console.log(`\n${fail} FAILURES / ${pass + fail} (expected-red: DS not yet integrated)`);
    await browser.close();
    process.exit(1);
  }

  // ── 1. String factories: return type + .ds-* class + escaping ──────────────
  console.log("— 1. string factories: type, .ds-* class, escaping —");
  const XSS = `"><img src=x onerror=alert(1)>`; // must never survive as a raw tag
  const factoryResults = await page.evaluate((xss) => {
    const D = window.DS;
    const out = {};
    const safe = (fn) => { try { return fn(); } catch (e) { return { __err: String(e.message) }; } };
    // Each entry: [returnedString, expectedClass]
    out.button   = safe(() => D.button({ label: xss, variant: "gold", on: "void 0" }));
    out.card     = safe(() => D.card({ title: xss, body: "ok" }));
    out.chip     = safe(() => D.chip({ label: xss, active: true }));
    out.tab      = safe(() => D.tab({ id: "t1", label: xss, on: "void" }));
    out.tabBar   = safe(() => D.tabBar({ tabs: [{ id: "a", label: xss }, { id: "b", label: "B" }], activeId: "a", on: "frnSetTab" }));
    out.banner   = safe(() => D.banner({ title: xss, body: "b", variant: "danger" }));
    out.statTile = safe(() => D.statTile({ label: xss, value: "42", elite: true }));
    out.row      = safe(() => D.row({ cells: [xss, "x"], mine: true }));
    out.table    = safe(() => D.table({ head: [xss, "H"], rows: [D.row ? D.row({ cells: ["a", "b"] }) : "<tr></tr>"] }));
    out.progress = safe(() => D.progress({ pct: 50, label: xss }));
    out.toggle   = safe(() => D.toggle({ expanded: true, label: xss, on: "void" }));
    out.toolbar  = safe(() => D.toolbar({ links: [{ label: xss, on: "void" }] }));
    out.select   = safe(() => D.select({ id: "s1", options: [{ value: "v", label: xss }], value: "v", on: "void" }));
    out.modalHtml = safe(() => D.modalHtml ? D.modalHtml({ title: xss, body: "b" }) : "<div class=\"ds-modal-backdrop\"></div>");
    out.spinner    = safe(() => D.spinner({ size: "sm", label: xss }));
    out.skeleton   = safe(() => D.skeleton({ variant: "text", lines: 2, label: xss }));
    out.emptyState = safe(() => D.emptyState({ icon: "🏈", title: xss, body: "b" }));
    out.errorState = safe(() => D.errorState({ title: xss, detail: xss, retry: "void 0" }));
    out.input      = safe(() => D.input({ id: "i1", placeholder: xss, value: xss }));
    out.checkbox   = safe(() => D.checkbox({ id: "c1", label: xss }));
    out.field      = safe(() => D.field({ id: "i1", label: xss, hint: xss, control: "<input id=\"i1\">" }));
    out.steps      = safe(() => D.steps({ steps: [{ id: "a", label: xss }, { id: "b", label: "B" }], activeIdx: 0 }));
    return out;
  }, XSS);

  // Expected .ds-* class fragment per factory.
  const expectClass = {
    button: "ds-btn",
    card: "ds-card",
    chip: "ds-chip",
    tab: "ds-tab",
    tabBar: "ds-tabbar",
    banner: "ds-banner",
    statTile: "ds-stat",
    row: "ds-row",
    table: "ds-table",
    progress: "ds-progress",
    toggle: "ds-toggle",
    toolbar: "ds-toolbar",
    select: "ds-select",
    // modalHtml returns the inner dialog markup (.ds-modal); DS.modal() wraps it
    // in the .ds-modal-backdrop at mount time (asserted live in §3).
    modalHtml: "ds-modal",
    spinner: "ds-spinner",
    skeleton: "ds-skeleton",
    emptyState: "ds-state--empty",
    errorState: "ds-state--error",
    input: "ds-input",
    checkbox: "ds-checkbox",
    field: "ds-field",
    steps: "ds-steps",
  };
  // The injected label `"><img ...>` carries a raw `<img`. ds.js escapes `<`→`&lt;`,
  // so a CORRECT factory output must NOT contain the injected opening tag. We test
  // ONLY for the dangerous, unescaped tag opener from the payload (`<img`/`<script`).
  // Escaped text like `&quot;&gt;&lt;img ... onerror=...&gt;` is inert and must NOT
  // be flagged. (Do NOT scan for a generic `"><tag` — the factories' OWN legitimate
  // markup contains `"><div>` etc.; that is real HTML structure, not injection.)
  const hasRawInjection = (s) => /<img\b/i.test(s) || /<script\b/i.test(s);
  // Per the CONTRACT trust model ("raw body/cells are TRUSTED — caller's
  // responsibility"), some factories pass content through verbatim by design so
  // nested DS markup (buttons, links) can be embedded. For those we assert the
  // TRUSTED-PASSTHROUGH contract instead of auto-escaping: DS.row cells and
  // DS.table rows are trusted HTML. (DS.table's HEAD cells ARE escaped, which is
  // what the XSS in this test targets, so table still asserts escaping.)
  const trustedContent = new Set(["row"]);
  for (const [name, expCls] of Object.entries(expectClass)) {
    const v = factoryResults[name];
    if (v && v.__err) { ok(false, `DS.${name} threw: ${v.__err}`); continue; }
    ok(typeof v === "string", `DS.${name}() returns a string`);
    if (typeof v === "string") {
      ok(v.includes(expCls), `DS.${name}() carries .${expCls}`);
      if (trustedContent.has(name)) {
        // contract: cells are trusted → the raw payload passes through untouched.
        ok(v.includes(XSS), `DS.${name}() passes TRUSTED cell HTML through verbatim (by contract)`);
      } else {
        ok(!hasRawInjection(v), `DS.${name}() escapes a malicious label (no raw <img>/tag)`);
      }
    }
  }

  // ── 1b. DS.esc / DS.cx / DS.attrs helpers ──────────────────────────────────
  const helpers = await page.evaluate((xss) => {
    const D = window.DS;
    const r = {};
    try { r.esc = D.esc(xss); } catch (e) { r.escErr = String(e.message); }
    try { r.cx = D.cx("a", false && "b", null, "c"); } catch (e) { r.cxErr = String(e.message); }
    try { r.attrs = D.attrs({ id: "x", title: xss }); } catch (e) { r.attrsErr = String(e.message); }
    return r;
  }, XSS);
  ok(typeof helpers.esc === "string" && !hasRawInjection(helpers.esc) && !/[<>]/.test(helpers.esc),
    "DS.esc() escapes < > & quotes");
  ok(typeof helpers.cx === "string" && /\ba\b/.test(helpers.cx) && /\bc\b/.test(helpers.cx) && !/false|null/.test(helpers.cx),
    "DS.cx() joins truthy class names, drops falsy");
  ok(typeof helpers.attrs === "string" && !hasRawInjection(helpers.attrs), "DS.attrs() escapes attribute values");

  // ── 1c. `class`/`cls` passthrough: extra hook classes merged after ds-* ─────
  const passthrough = await page.evaluate(() => {
    const D = window.DS;
    return {
      btn:  D.button({ label: "X", variant: "gold", class: "frn-hook-a" }),
      btn2: D.button({ label: "X", cls: "frn-hook-b" }),
      chip: D.chip({ label: "X", class: "frn-hook-c" }),
      card: D.card({ title: "X", class: "frn-hook-d" }),
    };
  });
  ok(/class="ds-btn ds-btn--gold[^"]*\bfrn-hook-a\b/.test(passthrough.btn),
    "DS.button({class}) merges a hook class AFTER the ds-* classes");
  ok(/\bds-btn\b/.test(passthrough.btn2) && /\bfrn-hook-b\b/.test(passthrough.btn2),
    "DS.button({cls}) alias also merges a hook class");
  ok(/\bds-chip\b/.test(passthrough.chip) && /\bfrn-hook-c\b/.test(passthrough.chip),
    "DS.chip({class}) merges a hook class");
  ok(/\bds-card\b/.test(passthrough.card) && /\bfrn-hook-d\b/.test(passthrough.card),
    "DS.card({class}) merges a hook class");

  // ── 1d. DS-unify additions: rich labels + modal delegation hooks ────────────
  const unify = await page.evaluate(() => {
    const D = window.DS;
    return {
      rich: D.button({ labelHtml: 'Trade<span class="sub">value</span>', on: "void 0" }),
      richEsc: D.button({ label: "<b>x</b>" }),
      modal: D.modalHtml({ title: "T", body: "B", cls: "frn-modal legacy-hook", backdropCls: "frn-modal-backdrop" }),
    };
  });
  ok(/Trade<span class="sub">value<\/span>/.test(unify.rich),
    "DS.button({labelHtml}) renders TRUSTED rich label markup unescaped");
  ok(/&lt;b&gt;x&lt;\/b&gt;/.test(unify.richEsc),
    "DS.button({label}) still escapes (labelHtml is the only trusted slot)");
  ok(/class="ds-modal-backdrop frn-modal-backdrop"/.test(unify.modal)
    && /class="ds-modal[^"]*\bfrn-modal\b[^"]*\blegacy-hook\b/.test(unify.modal),
    "DS.modalHtml({cls,backdropCls}) merges legacy hook classes on dialog + backdrop");
  // 250ms backdrop guard: an immediate backdrop click (double-click spill) must
  // NOT self-cancel the modal; a click after the guard window must cancel.
  const guardRes = await page.evaluate(async () => {
    const D = window.DS;
    let settled = null;
    const p = D.modal({ title: "G", body: "guard" });
    p.then((v) => { settled = v; });
    const backdrop = document.querySelector(".ds-modal-backdrop");
    backdrop.click();                       // immediate — inside the guard window
    await new Promise((r) => setTimeout(r, 60));
    const openDuringGuard = !!document.querySelector(".ds-modal-backdrop") && settled === null;
    await new Promise((r) => setTimeout(r, 260));
    document.querySelector(".ds-modal-backdrop").click();   // past the guard
    await new Promise((r) => setTimeout(r, 30));
    return { openDuringGuard, closedAfter: settled === false && !document.querySelector(".ds-modal-backdrop") };
  });
  ok(guardRes.openDuringGuard, "DS.modal ignores a backdrop click <250ms after mount (double-click guard)");
  ok(guardRes.closedAfter, "DS.modal backdrop click after the guard window cancels normally");

  // ── 2. Mount + computed style resolves tokens ──────────────────────────────
  console.log("— 2. DS.mount + computed style resolves tokens —");
  const styles = await page.evaluate(() => {
    const D = window.DS;
    const r = {};
    const host = document.createElement("div");
    host.id = "ds-test-host";
    document.body.appendChild(host);

    // Backdrop z-index === 4000 (var(--ds-z-modal)). The .ds-modal-backdrop is
    // produced by DS.modal() at mount (modalHtml is just the inner dialog), so
    // mount a real one, read it, then dismiss to avoid leaking into §3.
    const mp = D.modal({ title: "T", body: "B" });
    const backdrop = document.querySelector(".ds-modal-backdrop");
    r.backdropZ = backdrop ? getComputedStyle(backdrop).zIndex : "(none)";
    if (backdrop) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (mp && typeof mp.then === "function") mp.then(() => {}); // swallow

    // Button has a non-empty background.
    const btnRoot = D.mount(host, D.button({ label: "Go", variant: "gold", on: "void 0" }));
    const btn = (btnRoot && btnRoot.classList && btnRoot.classList.contains("ds-btn"))
      ? btnRoot : host.querySelector(".ds-btn");
    const bg = btn ? getComputedStyle(btn) : null;
    r.btnBg = bg ? (bg.backgroundColor + "|" + bg.backgroundImage) : "(none)";

    // Progress fill width reflects pct.
    const pgRoot = D.mount(host, D.progress({ pct: 50, label: "x" }));
    const fill = host.querySelector(".ds-progress__fill");
    if (fill) {
      // width can be reported as % (inline) or px (computed) — read both.
      r.fillInline = fill.style.width || "";
      const track = fill.closest(".ds-progress") || fill.parentElement;
      const tw = track ? track.getBoundingClientRect().width : 0;
      const fw = fill.getBoundingClientRect().width;
      r.fillRatio = tw > 0 ? fw / tw : -1;
    } else {
      r.fillInline = "(none)"; r.fillRatio = -1;
    }
    host.remove();
    return r;
  });
  ok(styles.backdropZ === "4000", `.ds-modal-backdrop z-index === 4000 (got ${styles.backdropZ})`);
  ok(styles.btnBg !== "(none)" && !/^rgba\(0, 0, 0, 0\)\|none$/.test(styles.btnBg),
    `.ds-btn has a non-empty background (${styles.btnBg})`);
  const fillPct = parseFloat(styles.fillInline);
  ok((styles.fillInline.includes("50") && fillPct === 50) || (styles.fillRatio > 0.4 && styles.fillRatio < 0.6),
    `.ds-progress__fill width reflects 50% (inline=${styles.fillInline}, ratio=${styles.fillRatio})`);

  // ── 3. DS.modal: mounts backdrop, confirm→true, Escape→false ───────────────
  console.log("— 3. DS.modal() promise contract —");

  // 3a. confirm resolves true
  const confirmRes = await page.evaluate(() => {
    return new Promise((resolve) => {
      const p = window.DS.modal({ title: "Confirm?", body: "body", okLabel: "OK" });
      const mounted = !!document.querySelector(".ds-modal-backdrop");
      // click the confirm button
      setTimeout(() => {
        const backdrop = document.querySelector(".ds-modal-backdrop");
        const okBtn = backdrop && (backdrop.querySelector(".ds-modal__confirm, .ds-btn--primary, .ds-btn--gold")
          || [...backdrop.querySelectorAll("button, .ds-btn")].find((b) => /ok|confirm/i.test(b.textContent)));
        if (okBtn) okBtn.click();
        p.then((v) => resolve({ mounted, value: v, stillMounted: !!document.querySelector(".ds-modal-backdrop") }));
      }, 50);
    });
  });
  ok(confirmRes.mounted, "DS.modal() mounts a .ds-modal-backdrop");
  ok(confirmRes.value === true, `DS.modal() confirm resolves true (got ${confirmRes.value})`);
  ok(confirmRes.stillMounted === false, "DS.modal() unmounts the backdrop after confirm");

  // 3b. Escape resolves false
  const escRes = await page.evaluate(() => {
    return new Promise((resolve) => {
      const p = window.DS.modal({ title: "Confirm?", body: "body" });
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        p.then((v) => resolve({ value: v, stillMounted: !!document.querySelector(".ds-modal-backdrop") }));
        // safety: if Escape wasn't wired, time out as a fail signal
        setTimeout(() => resolve({ value: "(timeout)", stillMounted: !!document.querySelector(".ds-modal-backdrop") }), 800);
      }, 50);
    });
  });
  ok(escRes.value === false, `DS.modal() Escape resolves false (got ${escRes.value})`);
  ok(escRes.stillMounted === false, "DS.modal() unmounts the backdrop after Escape");

  // ── 4. Interaction states: busy / skeleton / states / toast / keyboard ────
  console.log("— 4. interaction states (busy, skeleton, empty/error, toast, keyboard) —");
  const states = await page.evaluate(() => {
    const D = window.DS;
    const r = {};
    // busy button (factory form): disabled + aria-busy + spinner, label kept
    r.busyBtn = D.button({ label: "Save", variant: "gold", busy: true, on: "void 0" });
    // skeleton semantics: one polite status container, decorative bars hidden
    r.skel = D.skeleton({ variant: "table", rows: 2, cols: 3 });
    // error vs empty semantics
    r.err = D.errorState({ title: "Load failed", detail: "code 7", retry: "void 0" });
    r.empty = D.emptyState({ icon: "🏈", title: "Nothing here", action: { label: "Go", on: "void 0" } });
    // keyboard reachability: interactive chip/tab get role+tabindex; inert ones don't
    r.chipOn = D.chip({ label: "Filter", on: "void 0" });
    r.chipOff = D.chip({ label: "Badge" });
    r.chipDis = D.chip({ label: "Filter", on: "void 0", disabled: true });
    r.tabOn = D.tab({ id: "x", label: "Tab", on: "voidFn", active: true });
    r.navOn = D.toolbar({ links: [{ label: "Link", on: "void 0" }] });
    return r;
  });
  ok(/aria-busy="true"/.test(states.busyBtn) && /\bdisabled\b/.test(states.busyBtn)
     && /ds-spinner/.test(states.busyBtn) && /Save/.test(states.busyBtn),
    "DS.button({busy}) → aria-busy + disabled + spinner, label kept");
  ok(/role="status"/.test(states.skel) && /aria-busy="true"/.test(states.skel)
     && /aria-hidden="true"/.test(states.skel) && /sr-only/.test(states.skel),
    "DS.skeleton() → role=status + aria-busy container, aria-hidden bars, sr-only label");
  ok((states.skel.match(/ds-skeleton__row/g) || []).length === 2
     && (states.skel.match(/ds-skeleton__bar/g) || []).length === 6,
    "DS.skeleton({variant:'table',rows:2,cols:3}) renders 2 rows × 3 bars");
  ok(/role="alert"/.test(states.err) && /↻ Retry/.test(states.err) && /code 7/.test(states.err),
    "DS.errorState() → role=alert + retry action + escaped detail");
  ok(!/role="alert"/.test(states.empty) && /ds-state__action/.test(states.empty),
    "DS.emptyState() → no alert role, renders its action button");
  ok(/role="button"/.test(states.chipOn) && /tabindex="0"/.test(states.chipOn) && /onkeydown/.test(states.chipOn),
    "interactive DS.chip is keyboard-reachable (role=button + tabindex + key activation)");
  ok(!/tabindex/.test(states.chipOff) && !/role=/.test(states.chipOff),
    "decorative DS.chip stays inert (no role/tabindex)");
  ok(/aria-disabled="true"/.test(states.chipDis) && !/onclick/.test(states.chipDis),
    "disabled DS.chip → aria-disabled, handler dropped");
  ok(/role="button"/.test(states.tabOn) && /tabindex="0"/.test(states.tabOn) && /aria-current="true"/.test(states.tabOn),
    "interactive DS.tab is keyboard-reachable; active tab carries aria-current");
  ok(/role="button"/.test(states.navOn) && /tabindex="0"/.test(states.navOn),
    "DS.toolbar links are keyboard-reachable");

  // 4b. DS.toast — mount, semantics, auto-dismiss; DS.busy — live toggle
  const toastRes = await page.evaluate(() => {
    return new Promise((resolve) => {
      const D = window.DS;
      const el = D.toast({ message: "Saved ✓", kind: "success", duration: 250 });
      const out = {
        mounted: !!el && el.id === "dsToast",
        role: el ? el.getAttribute("role") : "",
        visible: el ? el.classList.contains("ds-toast--visible") : false,
        z: el ? getComputedStyle(el).zIndex : "",
        kindClass: el ? el.classList.contains("ds-toast--success") : false,
      };
      const err = D.toast({ message: "Boom", kind: "error", duration: 250 });
      out.errRole = err ? err.getAttribute("role") : "";
      setTimeout(() => {
        out.dismissed = !err.classList.contains("ds-toast--visible");
        resolve(out);
      }, 600);
    });
  });
  ok(toastRes.mounted && toastRes.visible && toastRes.kindClass,
    "DS.toast() mounts the singleton and shows the kind class");
  ok(toastRes.role === "status", `DS.toast(success) is polite role=status (got ${toastRes.role})`);
  ok(toastRes.errRole === "alert", `DS.toast(error) is assertive role=alert (got ${toastRes.errRole})`);
  ok(toastRes.z === "5000", `.ds-toast z-index === 5000 (var(--ds-z-toast)) (got ${toastRes.z})`);
  ok(toastRes.dismissed === true, "DS.toast() auto-dismisses after its duration");

  const busyRes = await page.evaluate(() => {
    const D = window.DS;
    const host = document.createElement("div");
    document.body.appendChild(host);
    D.mount(host, D.button({ label: "Go", variant: "gold", on: "void 0" }));
    const btn = host.querySelector(".ds-btn");
    D.busy(btn, true);
    const on = {
      disabled: btn.disabled, ariaBusy: btn.getAttribute("aria-busy"),
      spinner: !!btn.querySelector(".ds-spinner"), cls: btn.classList.contains("ds-btn--busy"),
    };
    D.busy(btn, true); // idempotent — must not stack a second spinner
    on.spinnerCount = btn.querySelectorAll(".ds-spinner").length;
    D.busy(btn, false);
    const off = {
      disabled: btn.disabled, ariaBusy: btn.getAttribute("aria-busy"),
      spinner: !!btn.querySelector(".ds-spinner"), cls: btn.classList.contains("ds-btn--busy"),
    };
    host.remove();
    return { on, off };
  });
  ok(busyRes.on.disabled && busyRes.on.ariaBusy === "true" && busyRes.on.spinner && busyRes.on.cls,
    "DS.busy(el, true) → disabled + aria-busy + spinner + class");
  ok(busyRes.on.spinnerCount === 1, "DS.busy is idempotent (no stacked spinners)");
  ok(!busyRes.off.disabled && !busyRes.off.ariaBusy && !busyRes.off.spinner && !busyRes.off.cls,
    "DS.busy(el, false) fully restores the control");

  // ── 5. Form layer: validation contract, submit states, stepper ────────────
  console.log("— 5. form layer (validation UX, submit states, stepper) —");
  const formRes = await page.evaluate(() => new Promise(async (resolve) => {
    const D = window.DS;
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<form>
      <div class="ds-form-error"></div>
      ${D.field({ id: "t-url", label: "Server", required: true, hint: "http(s) only",
                  control: D.input({ id: "t-url", name: "url", type: "url", required: true }) })}
      ${D.field({ id: "t-name", label: "Name",
                  control: D.input({ id: "t-name", name: "name" }) })}
      <button type="submit" class="ds-btn ds-btn--gold">Go</button>
    </form>`;
    const submits = [];
    let failNext = true;
    const ctl = D.form(host, {
      validate: { url: (v) => v && !/^https?:/.test(v) ? "http(s) only" : "" },
      onSubmit: async (vals) => {
        submits.push(vals);
        await new Promise(r => setTimeout(r, 60));
        if (failNext) { failNext = false; return { error: "server unreachable" }; }
      },
    });
    const url = host.querySelector("#t-url");
    const err = () => host.querySelector("#t-url").closest(".ds-field").querySelector(".ds-field__error").textContent;
    const r = {};
    // aria wiring at bind time
    r.describedby = url.getAttribute("aria-describedby") || "";
    // no error while typing pre-blur. "ftp://x" passes NATIVE type=url
    // (any scheme is a valid URL) — so the message we see on blur proves
    // the CUSTOM rule ran after native validation passed.
    url.focus(); url.value = "ftp://x"; url.dispatchEvent(new Event("input", { bubbles: true }));
    r.silentWhileTyping = err() === "";
    // blur → custom rule error + aria-invalid
    url.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    r.blurError = err();
    r.ariaInvalid = url.getAttribute("aria-invalid") === "true";
    // live re-validation clears as soon as it's fixed
    url.value = "http://ok:1234"; url.dispatchEvent(new Event("input", { bubbles: true }));
    r.liveCleared = err() === "" && !url.hasAttribute("aria-invalid");
    // required: empty + submit → focuses the field, no onSubmit call
    url.value = ""; url.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector("form").requestSubmit();
    await new Promise(res2 => setTimeout(res2, 30));
    r.submitBlocked = submits.length === 0;
    r.focusedFirstInvalid = document.activeElement === url;
    r.requiredMsg = err();
    // valid submit → busy during the await, failure lands in .ds-form-error
    url.value = "http://ok:1234"; url.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector("form").requestSubmit();
    await new Promise(res2 => setTimeout(res2, 20));
    const btn = host.querySelector('button[type="submit"]');
    r.busyDuring = btn.getAttribute("aria-busy") === "true" && btn.disabled;
    await new Promise(res2 => setTimeout(res2, 120));
    r.failureShown = host.querySelector(".ds-form-error").textContent;
    r.failureRole = host.querySelector(".ds-form-error").getAttribute("role");
    r.busyRestored = !btn.disabled && !btn.getAttribute("aria-busy");
    // second submit succeeds → error region cleared
    host.querySelector("form").requestSubmit();
    await new Promise(res2 => setTimeout(res2, 120));
    r.successClears = host.querySelector(".ds-form-error").textContent === "";
    r.values = submits[submits.length - 1];
    ctl.destroy(); host.remove();
    resolve(r);
  }));
  ok(/-hint/.test(formRes.describedby) && /-error/.test(formRes.describedby),
    "DS.form wires aria-describedby → hint + error slots at bind");
  ok(formRes.silentWhileTyping, "no error while typing before first blur (punish late)");
  ok(formRes.blurError === "http(s) only" && formRes.ariaInvalid,
    "blur runs the custom rule → inline error + aria-invalid");
  ok(formRes.liveCleared, "once erred, input re-validates live and clears on fix (reward early)");
  ok(formRes.submitBlocked && formRes.focusedFirstInvalid && formRes.requiredMsg === "Required.",
    "invalid submit: blocked, first invalid field focused, native message humanized");
  ok(formRes.busyDuring && formRes.busyRestored, "submit button goes busy during async onSubmit and restores");
  ok(formRes.failureShown === "server unreachable" && formRes.failureRole === "alert",
    "onSubmit failure renders in .ds-form-error with role=alert");
  ok(formRes.successClears, "a later successful submit clears the form error");
  ok(formRes.values && formRes.values.url === "http://ok:1234" && "name" in formRes.values,
    "values() collects named controls");

  const stepRes = await page.evaluate(() => {
    const D = window.DS;
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<form>
      <div data-steps-header></div>
      <section data-step-panel>${D.field({ id: "s-a", label: "A", control: D.input({ id: "s-a", name: "a", required: true }) })}
        <button type="button" data-step-next>Next</button></section>
      <section data-step-panel hidden>${D.field({ id: "s-b", label: "B", control: D.input({ id: "s-b", name: "b" }) })}
        <button type="button" data-step-back>Back</button></section>
    </form>`;
    const ctl = D.form(host, { onSubmit: () => {} });
    const steps = [{ id: "one", label: "One" }, { id: "two", label: "Two" }];
    const st = D.stepper(host, { steps, form: ctl });
    const r = {};
    r.headerRendered = !!host.querySelector(".ds-steps .ds-step--active");
    host.querySelector("[data-step-next]").click();
    r.gatedOnInvalid = st.index === 0 &&
      host.querySelector("#s-a").closest(".ds-field").querySelector(".ds-field__error").textContent === "Required.";
    host.querySelector("#s-a").value = "x";
    host.querySelector("[data-step-next]").click();
    r.advanced = st.index === 1 && !host.querySelectorAll("[data-step-panel]")[1].hidden;
    r.doneMark = host.querySelector(".ds-step--done") !== null;
    host.querySelector("[data-step-back]").click();
    r.backWorks = st.index === 0;
    st.destroy(); ctl.destroy(); host.remove();
    return r;
  });
  ok(stepRes.headerRendered, "DS.stepper renders the step header with an active step");
  ok(stepRes.gatedOnInvalid, "Next is gated: invalid field in the active panel blocks + errors inline");
  ok(stepRes.advanced, "Next advances once the panel is valid; new panel unhidden");
  ok(stepRes.doneMark, "completed step shows the ✓ done state");
  ok(stepRes.backWorks, "Back returns without validation");

  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "zero page errors");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("COMPONENT-TEST CRASH:", e); process.exit(2); });
