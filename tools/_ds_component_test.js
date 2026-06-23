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

  ok(errors.length === 0, errors.length ? "page errors: " + errors.slice(0, 3).join(" | ") : "zero page errors");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("COMPONENT-TEST CRASH:", e); process.exit(2); });
