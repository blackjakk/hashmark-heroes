// _ui_artifact_probe.js — app-wide UI artifact scanner.
// Walks the major franchise surfaces + modals and flags:
//   • white-control — button/select/input whose computed background is
//     light in this dark app (the UA-default "buttonface" class of bug
//     that produced the blank Defer pill in the holdout center)
//   • tiny-text — computed font-size under 8px (illegible)
//   • offscreen-x — elements spilling past the viewport width (layout
//     artifacts from unwrapped flex rows)
// Exit 0 = clean, 1 = artifacts found (prints a per-surface report).
//
//   node tools/_ui_artifact_probe.js        (starts its own server :5186)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");

const PORT = 5186;
const ROOT = path.join(__dirname, "..");
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", ROOT], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on("dialog", d => d.accept());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  const SCANNER = `(surface) => {
    const out = [];
    const seen = new Set();
    const push = (rec) => {
      const key = rec.kind + "|" + rec.cls + "|" + rec.txt;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(rec);
    };
    for (const el of document.querySelectorAll("button, select, input, textarea")) {
      if (!el.offsetParent) continue;
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
      if (!m) continue;
      const lum = (+m[1]) * 0.299 + (+m[2]) * 0.587 + (+m[3]) * 0.114;
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      // Gold CTAs paint via background-image gradients (backgroundColor
      // stays transparent) so a lit backgroundColor here means an
      // explicitly-white control or a UA default.
      if (alpha > 0.5 && lum > 200 && !cs.backgroundImage.includes("gradient")) {
        push({ kind: "white-control", surface, tag: el.tagName,
          cls: String(el.className).slice(0, 70),
          txt: (el.textContent || el.value || el.placeholder || "").trim().replace(/\\s+/g, " ").slice(0, 50),
          bg: cs.backgroundColor });
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !el.offsetParent) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 8) push({ kind: "tiny-text", surface, fs: +fs.toFixed(1),
        cls: String(el.className).slice(0, 70),
        txt: n.textContent.trim().replace(/\\s+/g, " ").slice(0, 50) });
    }
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll("body *")) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.right > vw + 40 && getComputedStyle(el).position !== "fixed") {
        push({ kind: "offscreen-x", surface, over: Math.round(r.right - vw),
          cls: String(el.className).slice(0, 70),
          txt: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40) });
        if (out.filter(o => o.kind === "offscreen-x").length > 4) break;
      }
    }
    return out;
  }`;

  const findings = [];
  const scan = async (surface) => {
    const res = await page.evaluate(`(${SCANNER})(${JSON.stringify(surface)})`);
    findings.push(...res);
  };

  // Typography contract — the display/mono/prose faces must come from the
  // SELF-HOSTED files (fonts/fonts.css). When they fail, every surface
  // silently falls back to Courier New ("the dated look") and no styling
  // audit below would notice.
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    const out = {};
    for (const f of ["Bebas Neue", "IBM Plex Mono", "Bricolage Grotesque"]) {
      try { out[f] = (await document.fonts.load(`16px '${f}'`)).length > 0; }
      catch { out[f] = false; }
    }
    return out;
  });
  for (const [fam, ok] of Object.entries(fontsOk)) {
    if (!ok) findings.push({ kind: "font-missing", surface: "global", txt: fam });
  }

  // Boot franchise with deterministic RNG.
  await page.evaluate(() => {
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
  });
  await page.waitForTimeout(400);
  await scan("dashboard");

  // Static render surfaces — call when the function exists, skip otherwise.
  const SURFACES = [
    "renderFrnDepthChart", "renderFrnTrade", "renderFrnStandings",
    "renderFrnLeaders", "renderFrnAnalytics", "renderFrnCoachingStaff",
    "renderFrnNewsArchive", "renderFrnFrontOffice", "renderFrnPracticeSquad",
    "renderFrnLegacy", "renderFrnAlumni", "renderFrnChat",
  ];
  for (const fn of SURFACES) {
    const ran = await page.evaluate((f) => {
      if (typeof window[f] !== "function") return false;
      try { window[f](); return true; } catch (e) { return "ERR:" + e.message; }
    }, fn);
    if (ran === true) { await page.waitForTimeout(250); await scan(fn.replace("renderFrn", "")); }
    else if (ran !== false) findings.push({ kind: "render-error", surface: fn, txt: String(ran).slice(0, 80) });
  }

  // Player card modal.
  await page.evaluate(() => {
    showFranchiseDashboard();
    const p = franchise.rosters[franchise.chosenTeamId][0];
    frnOpenPlayerCard(p.name);
  });
  await page.waitForTimeout(350);
  await scan("player-card");
  await page.evaluate(() => frnClosePlayerModal());

  // Holdout center modal — EMPTY state first (the branch a seeded-only
  // walk never reaches; the vintage "all demands resolved" card hid here).
  await page.evaluate(() => {
    franchise.holdoutDemands = [];
    frnOpenHoldoutCenter();
  });
  await page.waitForTimeout(250);
  await scan("holdout-center-empty");
  await page.evaluate(() => frnCloseHoldoutCenter());

  // Holdout center modal (seeded).
  await page.evaluate(() => {
    const p = franchise.rosters[franchise.chosenTeamId].filter(x => (x.overall || 0) >= 80)[0];
    p.contract.remaining = 1;
    const cap = franchise.salaryCap || SALARY_CAP_BASE;
    const tagFloor = _franchiseTagAAV({ position: p.position, name: p.name }, cap);
    franchise.holdoutDemands = [{
      name: p.name, position: p.position, overall: p.overall, age: p.age,
      currentAAV: p.contract.aav || 5, currentRemaining: 1,
      marketValue: 20, marketAAV: 20, tagFloorAAV: tagFloor,
      demandedAAV: 22, demandedYears: 4, offer: 22, offerYears: 4,
      structure: "BALANCED", week: franchise.week, deadlineWeek: franchise.week + 4,
      defers: 0, rounds: 0, lastTalk: null, resolved: null,
    }];
    frnOpenHoldoutCenter();
  });
  await page.waitForTimeout(350);
  await scan("holdout-center");
  await page.evaluate(() => frnCloseHoldoutCenter());

  // ── Report ──────────────────────────────────────────────────────────
  const byKind = {};
  for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);
  let bad = 0;
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`\n── ${kind} (${list.length}) ──`);
    for (const f of list.slice(0, 30)) {
      console.log(`  [${f.surface}] ${f.tag || ""} ${f.cls ? "." + f.cls : ""} ${f.fs ? f.fs + "px" : ""} ${f.over ? "+" + f.over + "px" : ""} ${f.bg || ""} "${f.txt}"`);
    }
    bad += list.length;
  }
  if (errors.length) { console.log(`\n── page errors (${errors.length}) ──`); errors.slice(0, 10).forEach(e => console.log("  " + e)); bad += errors.length; }
  console.log(bad === 0 ? "\nCLEAN — no artifacts found" : `\n${bad} artifact(s) flagged`);
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
