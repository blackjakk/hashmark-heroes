#!/usr/bin/env node
// _ds_e2e.js — Design System end-to-end click-through (Playwright).
//
// CONTRACT (design-system/CONTRACT.md §TESTS): load play.html, START a franchise,
// open the dashboard, programmatically trigger ≥2 tab switches, open + dismiss a
// modal if one is reachable, screenshot to /tmp/ds_e2e_<n>.png, then assert:
//   • `document.querySelectorAll('[class*=ds-]')` is NON-EMPTY (DS is live in the
//     rendered DOM — true only AFTER migration routes UI through window.DS), and
//   • ZERO pageerror was captured during the whole flow.
// Exit 1 on any pageerror OR an empty DS-node set; exit 0 when both hold; 2 crash.
//
// EXPECTED-RED until integration+migration: until ds.js/ds.css are included and
// the franchise screens render DS components, the `[class*=ds-]` set is empty and
// this exits 1 — the correct signal. The franchise-start / tab-switch / modal flow
// itself is real and exercises the same code paths the migration will touch.
//
//   node tools/_ds_e2e.js     (starts its own server :5200)

"use strict";
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");

const PORT = 5200;
const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }));

let shot = 0;
const SHOT = () => `/tmp/ds_e2e_${++shot}.png`;

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on("dialog", (d) => d.accept()); // never block on native dialogs

  // CONTRACT: assert ZERO `pageerror` (uncaught JS exceptions). We deliberately
  // do NOT fail on console 404s — the base app probes an optional /api/health
  // (h2h server, absent in this headless harness); that resource 404 is not a JS
  // error and is unrelated to the design system.
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));

  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  // ── 1. start a franchise + open dashboard ──────────────────────────────────
  console.log("— start franchise + open dashboard —");
  const started = await page.evaluate(() => {
    if (typeof startFranchise !== "function") return { ok: false, why: "startFranchise missing" };
    startFranchise(1);
    if (typeof showFranchiseDashboard === "function") showFranchiseDashboard();
    return { ok: true, team: (typeof franchise !== "undefined" && franchise) ? franchise.chosenTeamId : null };
  });
  if (!started.ok) { console.error("[ds-e2e] could not start franchise:", started.why); await browser.close(); process.exit(2); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOT(), fullPage: false });

  // ── 2. ≥2 tab switches ─────────────────────────────────────────────────────
  console.log("— tab switches (≥2) —");
  const tabFlow = ["roster", "overview"]; // both are stable, low-dependency tabs
  for (const t of tabFlow) {
    await page.evaluate((tab) => { if (typeof frnSetTab === "function") frnSetTab(tab); }, t);
    await page.waitForTimeout(450);
    await page.screenshot({ path: SHOT(), fullPage: false });
  }
  const tabOk = await page.evaluate(() => typeof _frnActiveTab !== "undefined" ? _frnActiveTab : "(unknown)");
  console.log(`  active tab after flow: ${tabOk}`);

  // ── 3. open + dismiss a modal if reachable ─────────────────────────────────
  console.log("— open + dismiss a modal (if reachable) —");
  const modalFlow = await page.evaluate(async () => {
    // Prefer the DS modal once migrated; fall back to the existing confirm modal.
    const openDS = window.DS && typeof window.DS.modal === "function";
    let mountedSel = null, opened = false;
    let p = null;
    if (openDS) {
      p = window.DS.modal({ title: "E2E", body: "reachable?", okLabel: "OK" });
      mountedSel = ".ds-modal-backdrop";
    } else if (typeof _frnConfirmModal === "function") {
      p = _frnConfirmModal({ title: "E2E", body: "reachable?" });
      mountedSel = ".frn-modal-backdrop";
    } else {
      return { opened: false, dismissed: false, why: "no modal fn" };
    }
    await new Promise((r) => setTimeout(r, 60));
    opened = !!document.querySelector(mountedSel);
    // dismiss via Escape (cancel) — mirrors both contracts
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    let result = await Promise.race([p, new Promise((r) => setTimeout(() => r("(timeout)"), 600))]);
    await new Promise((r) => setTimeout(r, 60));
    const dismissed = !document.querySelector(mountedSel);
    return { opened, dismissed, result, usedDS: openDS };
  });
  console.log(`  modal: opened=${modalFlow.opened} dismissed=${modalFlow.dismissed} result=${modalFlow.result} (DS=${modalFlow.usedDS})`);
  await page.screenshot({ path: SHOT(), fullPage: false });

  // ── 4. assertions: DS nodes present + zero pageerror ───────────────────────
  console.log("— assertions —");
  const dsCount = await page.evaluate(() => document.querySelectorAll('[class*="ds-"]').length);
  console.log(`  live DS nodes ([class*=ds-]): ${dsCount}`);
  console.log(`  screenshots: ${Array.from({ length: shot }, (_, i) => `/tmp/ds_e2e_${i + 1}.png`).join(", ")}`);

  let fail = 0;
  if (dsCount === 0) { fail++; console.log("  ✗ FAIL no DS nodes in live DOM (expected-red until migration)"); }
  else console.log(`  ✓ DS nodes present in live DOM (${dsCount})`);

  if (errors.length) { fail++; console.log("  ✗ FAIL page errors:\n      " + errors.slice(0, 5).join("\n      ")); }
  else console.log("  ✓ zero page errors during the flow");

  console.log(fail === 0 ? "\nE2E GREEN" : `\nE2E RED (${fail} failing assertion${fail === 1 ? "" : "s"})`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("E2E CRASH:", e); process.exit(2); });
