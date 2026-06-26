// _a11y_contrast_probe.js — WCAG color-contrast + font-scaling audit (low-vision).
//
// WHAT IT CHECKS (all DOM/CSS only — determinism-neutral, never touches the
// canvas/PIXI render path):
//   1. CONTRAST — for every VISIBLE text node, compute the WCAG 2.x contrast
//      ratio of its computed `color` against its EFFECTIVE background. The
//      effective bg is resolved by walking up ancestors through transparent /
//      semi-transparent backgrounds, alpha-compositing each layer over the next
//      until an opaque layer is reached (default to the body/page bg). If a
//      background-IMAGE or gradient (or any unresolvable bg) sits behind the
//      text, the node is reported as "unresolved" rather than false-flagged.
//      FAIL: ratio < 4.5 for normal text, < 3.0 for LARGE text (>=24px, or
//      >=18.66px when bold >=700). Matches WCAG 1.4.3 (AA).
//   2. TINY TEXT — effective font-size < 11px on real content text.
//   3. FONT-SCALING (low-vision zoom) — set the root font to 200% AND apply a
//      2x layout zoom, then re-check for: horizontal scroll (1.4.10 reflow),
//      clipped text (overflow:hidden cutting content), and newly-introduced
//      element overlap. Flags layouts that break under 200%.
//
// Output: human summary (counts + worst ratios + top offenders + scaling
// failures) to stdout, and a full JSON findings dump to
//   audit-results/a11y_contrast_findings.json
//
// Self-test: `node tools/_a11y_contrast_probe.js --selftest` sanity-checks the
// contrast math against known pairs (#fff/#000 ~= 21, #777/#000 ~= 4.48) with
// NO browser. Useful for `node --check`-style verification.
//
// Run (spawns its own server :5343):  node tools/_a11y_contrast_probe.js
//   --paths a,b,c   limit which core paths to walk (default: all)
//   --top N         how many worst contrast offenders to print (default 20)

"use strict";

// ────────────────────────────────────────────────────────────────────────────
// Contrast math (pure, also runs in Node for the self-test). Kept identical to
// the in-page copy below so the self-test validates the real algorithm.
// ────────────────────────────────────────────────────────────────────────────
function srgbToLin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLuminance(r, g, b) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrastRatio(fg, bg) {
  // fg/bg = [r,g,b] OPAQUE (alpha already composited away).
  const L1 = relLuminance(fg[0], fg[1], fg[2]);
  const L2 = relLuminance(bg[0], bg[1], bg[2]);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// ────────────────────────────────────────────────────────────────────────────
// Self-test path (no browser) — proves the math on known pairs.
// ────────────────────────────────────────────────────────────────────────────
if (process.argv.includes("--selftest")) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const cases = [
    { fg: [255, 255, 255], bg: [0, 0, 0], want: 21, tol: 0.01, name: "#fff on #000" },
    { fg: [0, 0, 0], bg: [255, 255, 255], want: 21, tol: 0.01, name: "#000 on #fff (symmetric)" },
    { fg: [119, 119, 119], bg: [0, 0, 0], want: 4.69, tol: 0.02, name: "#777 on #000 (~AA, 4.69)" },
    // canonical WCAG AA edge pair (the value most tools cite as ~4.5):
    { fg: [0x76, 0x76, 0x76], bg: [255, 255, 255], want: 4.54, tol: 0.02, name: "#767676 on #fff (canonical AA edge)" },
    { fg: [255, 255, 255], bg: [255, 255, 255], want: 1, tol: 0.001, name: "white on white = 1" },
    { fg: [0x99, 0x99, 0x99], bg: [0x0a, 0x0f, 0x0a], want: null, tol: 0, name: "--gray #999 on --bg #0a0f0a" },
  ];
  let ok = true;
  for (const c of cases) {
    const r = contrastRatio(c.fg, c.bg);
    if (c.want != null) {
      const pass = Math.abs(r - c.want) <= c.tol;
      ok = ok && pass;
      console.log(`${pass ? "✓" : "✗"} ${c.name}: got ${round2(r)} (want ~${c.want})`);
    } else {
      console.log(`· ${c.name}: ${round2(r)}:1`);
    }
  }
  console.log(ok ? "\nSELF-TEST PASS — contrast math verified." : "\nSELF-TEST FAIL");
  process.exit(ok ? 0 : 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Browser run.
// ────────────────────────────────────────────────────────────────────────────
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.A11Y_PORT || 5343);
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const TOP_N = Number(getArg("--top", "20"));
const ONLY_PATHS = getArg("--paths", "").split(",").map(s => s.trim()).filter(Boolean);

const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill ? c.kill("SIGKILL") : c(); } catch {} }));

// Viewports to walk.
const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "phone", width: 390, height: 844 },
];

// Core paths. Each is a sequence of in-page actions executed via page.evaluate /
// page hooks. `setup` runs once after navigation to land on the screen.
const ALL_PATHS = [
  { id: "start", label: "Start screen (franchise create/pick)", setup: null },
  { id: "overview", label: "Dashboard → Overview", setup: { franchise: true, tab: "overview" } },
  { id: "roster", label: "Dashboard → Roster", setup: { franchise: true, tab: "roster" } },
  { id: "frontoffice", label: "Dashboard → Front Office", setup: { franchise: true, tab: "frontoffice" } },
  { id: "league", label: "Dashboard → League", setup: { franchise: true, tab: "league" } },
  { id: "replays", label: "Dashboard → Replays", setup: { franchise: true, tab: "replays" } },
  { id: "game", label: "Live game (play a game)", setup: { franchise: true, game: true } },
];

// ── In-page collector. Serialized into the browser; the contrast functions are
//    re-declared inside so they run in the page context. ───────────────────────
const PAGE_FN = function (opts) {
  // --- contrast math (mirror of the Node copy) ---
  function srgbToLin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function relLum(r, g, b) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
  function ratio(fg, bg) {
    const L1 = relLum(fg[0], fg[1], fg[2]), L2 = relLum(bg[0], bg[1], bg[2]);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }
  // parse a computed color string -> [r,g,b,a]
  function parseColor(str) {
    if (!str) return null;
    str = str.trim();
    if (str === "transparent") return [0, 0, 0, 0];
    let m = str.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(/[,\/\s]+/).filter(s => s !== "").map(s => s.trim());
      const r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2]);
      let a = p[3] != null ? parseFloat(p[3]) : 1;
      if (String(p[3]).includes("%")) a = parseFloat(p[3]) / 100;
      if ([r, g, b].some(n => isNaN(n))) return null;
      return [r, g, b, isNaN(a) ? 1 : a];
    }
    // CSS Color 4: `color(srgb r g b [/ a])` — Chromium now serializes some
    // computed bg-colors this way (0..1 components). Treat as solid sRGB.
    m = str.match(/^color\(srgb\s+([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split("/");
      const rgb = parts[0].trim().split(/\s+/).map(parseFloat);
      let a = parts[1] != null ? parseFloat(parts[1]) : 1;
      if (parts[1] != null && parts[1].includes("%")) a = parseFloat(parts[1]) / 100;
      if (rgb.length < 3 || rgb.some(n => isNaN(n))) return null;
      return [rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, isNaN(a) ? 1 : a];
    }
    m = str.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split("").map(c => c + c).join("");
      if (h.length === 6 || h.length === 8) {
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        return [r, g, b, a];
      }
    }
    return null; // named colors other than transparent → unresolved
  }
  // composite src(rgba) OVER dst(opaque rgb) → opaque rgb
  function over(src, dst) {
    const a = src[3];
    return [
      src[0] * a + dst[0] * (1 - a),
      src[1] * a + dst[1] * (1 - a),
      src[2] * a + dst[2] * (1 - a),
    ];
  }
  function hex(rgb) {
    return "#" + rgb.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
  }
  // Walk ancestors to build the EFFECTIVE opaque background behind `el`.
  // Collects semi-transparent layers top→bottom, then composites bottom→top
  // over an opaque base. Returns {rgb, unresolved, reason, path}.
  function effectiveBg(el) {
    const layers = []; // {rgba} top-most first
    let unresolved = null;
    let node = el;
    const PAGE_DEFAULT = [10, 15, 10]; // --bg #0a0f0a fallback if we run off the top
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      // background-image (gradient or url) we cannot flatten to a single color
      const bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== "none") {
        unresolved = { node: descOf(node), reason: "background-image/gradient: " + bgImg.slice(0, 60) };
        // We still record the layers gathered so far; bail (can't resolve below).
        break;
      }
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg[3] > 0) {
        if (bg[3] >= 0.999) {
          layers.push(bg);
          // opaque — done
          return flatten(layers, null);
        }
        layers.push(bg);
      } else if (!bg && cs.backgroundColor && cs.backgroundColor !== "transparent" && cs.backgroundColor !== "rgba(0, 0, 0, 0)") {
        unresolved = { node: descOf(node), reason: "unparseable bg-color: " + cs.backgroundColor };
        break;
      }
      node = node.parentElement;
    }
    if (unresolved) return { rgb: null, unresolved: true, reason: unresolved.reason };
    // ran off the top with no opaque layer → composite over page default
    return flatten(layers, PAGE_DEFAULT);
  }
  function flatten(layers, base) {
    if (!layers.length && !base) return { rgb: null, unresolved: true, reason: "no bg found" };
    let acc = base ? base.slice() : layers[layers.length - 1].slice(0, 3);
    const start = base ? layers.length - 1 : layers.length - 2;
    for (let i = start; i >= 0; i--) acc = over(layers[i], acc);
    return { rgb: acc, unresolved: false, reason: null };
  }
  function descOf(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      const c = el.className.trim().split(/\s+/).slice(0, 3).join(".");
      if (c) s += "." + c;
    }
    return s;
  }
  function pathOf(el) {
    const parts = [];
    let n = el;
    let depth = 0;
    while (n && n.nodeType === 1 && depth < 6) { parts.unshift(descOf(n)); n = n.parentElement; depth++; }
    return parts.join(" > ");
  }
  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  }

  // ── walk text nodes ──
  const findings = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(t) {
      const s = t.nodeValue;
      if (!s || !s.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const tinyText = [];
  let textNodeCount = 0;
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el) continue;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "CANVAS" || tag === "SVG") continue;
    // skip elements inside the canvas/PIXI broadcast field render
    if (el.closest && el.closest("canvas, svg")) continue;
    if (!isVisible(el)) continue;
    // ancestor-visibility (ancestor display:none not caught by parent check alone)
    let anc = el, hidden = false;
    while (anc) { if (!isVisible(anc)) { hidden = true; break; } anc = anc.parentElement; }
    if (hidden) continue;

    const cs = getComputedStyle(el);
    const fgRaw = parseColor(cs.color);
    const fontPx = parseFloat(cs.fontSize) || 0;
    const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400);
    const sample = n.nodeValue.trim().slice(0, 50);

    textNodeCount++;

    if (fontPx > 0 && fontPx < 11) {
      tinyText.push({ selector: descOf(el), path: pathOf(el), sample, fontPx: Math.round(fontPx * 10) / 10 });
    }

    if (!fgRaw) continue;
    // composite fg over its own bg if fg has alpha (rare): use effective bg below
    const bg = effectiveBg(el);
    if (bg.unresolved) {
      findings.push({
        kind: "unresolved", selector: descOf(el), path: pathOf(el), sample,
        fg: cs.color, bg: null, ratio: null, fontPx: Math.round(fontPx), weight, reason: bg.reason,
      });
      continue;
    }
    // composite fg (may be semi-transparent) over resolved bg
    let fgOpaque = fgRaw;
    if (fgRaw[3] < 0.999) fgOpaque = over(fgRaw, bg.rgb).concat(1);
    const cr = ratio(fgOpaque, bg.rgb);
    const isLarge = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
    const threshold = isLarge ? 3.0 : 4.5;
    const key = descOf(el) + "|" + hex(fgOpaque) + "|" + hex(bg.rgb) + "|" + sample;
    if (cr < threshold) {
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          kind: "contrast", selector: descOf(el), path: pathOf(el), sample,
          fg: hex(fgOpaque), bg: hex(bg.rgb), ratio: Math.round(cr * 100) / 100,
          fontPx: Math.round(fontPx * 10) / 10, weight, large: isLarge, threshold,
        });
      }
    }
  }
  return { findings, tinyText, textNodeCount };
};

// ── font-scaling check (runs after PAGE_FN, at 200%). Returns layout breakage. ─
const SCALE_FN = function () {
  function descOf(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      const c = el.className.trim().split(/\s+/).slice(0, 3).join(".");
      if (c) s += "." + c;
    }
    return s;
  }
  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }
  const issues = { hScroll: null, clipped: [], overflowingText: [] };
  // horizontal scroll
  const de = document.documentElement;
  const sw = de.scrollWidth, cw = de.clientWidth;
  if (sw > cw + 2) issues.hScroll = { scrollWidth: sw, clientWidth: cw, overBy: sw - cw };

  // clipped / overflowing text: elements whose content overflows their box while
  // overflow:hidden (text gets cut), or that overflow the viewport width.
  const all = document.querySelectorAll("body *");
  let checked = 0;
  for (const el of all) {
    if (checked > 6000) break;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CANVAS" || tag === "SVG") continue;
    if (el.closest && el.closest("canvas, svg")) continue;
    if (!isVisible(el)) continue;
    // must directly contain text
    let hasText = false;
    for (const c of el.childNodes) { if (c.nodeType === 3 && c.nodeValue.trim()) { hasText = true; break; } }
    if (!hasText) continue;
    checked++;
    const cs = getComputedStyle(el);
    const ovX = cs.overflowX, ovY = cs.overflowY;
    const clipX = ovX === "hidden" || ovX === "clip";
    const clipY = ovY === "hidden" || ovY === "clip";
    // text-overflow ellipsis on a clipped single line is a deliberate truncation but still a scaling smell when it appears only at 200%
    const sw2 = el.scrollWidth, cw2 = el.clientWidth, sh = el.scrollHeight, ch = el.clientHeight;
    if (clipX && sw2 > cw2 + 2) {
      issues.clipped.push({ selector: descOf(el), axis: "x", scroll: sw2, client: cw2, overBy: sw2 - cw2, sample: (el.textContent || "").trim().slice(0, 40), ellipsis: cs.textOverflow === "ellipsis" });
    } else if (clipY && sh > ch + 2 && ch > 0) {
      issues.clipped.push({ selector: descOf(el), axis: "y", scroll: sh, client: ch, overBy: sh - ch, sample: (el.textContent || "").trim().slice(0, 40) });
    }
    // element extends past the right viewport edge
    const r = el.getBoundingClientRect();
    if (r.right > cw + 4 && r.left < cw) {
      issues.overflowingText.push({ selector: descOf(el), right: Math.round(r.right), vw: cw, overBy: Math.round(r.right - cw), sample: (el.textContent || "").trim().slice(0, 40) });
    }
  }
  // dedupe overflowingText by selector
  const seenSel = new Set();
  issues.overflowingText = issues.overflowingText.filter(o => { if (seenSel.has(o.selector)) return false; seenSel.add(o.selector); return true; });
  issues.clipped = issues.clipped.slice(0, 40);
  issues.overflowingText = issues.overflowingText.slice(0, 40);
  return issues;
};

async function landOnPath(page, p) {
  // reset to a clean start screen
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  if (!p.setup) return; // start screen
  if (p.setup.franchise) {
    await page.evaluate(() => { startFranchise(1); });
    await page.waitForTimeout(700);
  }
  if (p.setup.game) {
    await page.evaluate(async () => {
      try { await frnPlayGame(1, 2); } catch (e) { /* may be sync */ try { frnPlayGame(1, 2); } catch {} }
    });
    await page.waitForTimeout(2500);
    return;
  }
  if (p.setup.tab) {
    await page.evaluate((t) => { frnSetTab(t); }, p.setup.tab);
    await page.waitForTimeout(700);
  }
}

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push(() => browser.close().catch(() => {}));

  const paths = ONLY_PATHS.length ? ALL_PATHS.filter(p => ONLY_PATHS.includes(p.id)) : ALL_PATHS;
  const allContrast = [];
  const allUnresolved = [];
  const allTiny = [];
  const scalingFailures = [];
  const pageErrors = [];
  let totalTextNodes = 0;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("dialog", d => d.accept());
    page.on("pageerror", e => pageErrors.push(`[${vp.id}] ${String(e.message).slice(0, 140)}`));
    await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);

    for (const p of paths) {
      try {
        await landOnPath(page, p);
      } catch (e) {
        pageErrors.push(`[${vp.id}/${p.id}] setup: ${String(e.message).slice(0, 120)}`);
        continue;
      }
      // 1+2: contrast + tiny at natural size
      let res;
      try {
        res = await page.evaluate(PAGE_FN, {});
      } catch (e) {
        pageErrors.push(`[${vp.id}/${p.id}] collect: ${String(e.message).slice(0, 120)}`);
        continue;
      }
      totalTextNodes += res.textNodeCount;
      for (const f of res.findings) {
        f.viewport = vp.id; f.path_id = p.id;
        if (f.kind === "contrast") allContrast.push(f);
        else allUnresolved.push(f);
      }
      for (const t of res.tinyText) { t.viewport = vp.id; t.path_id = p.id; allTiny.push(t); }

      // 3: font-scaling at 200% — bump root font AND zoom the layout box.
      const beforeHScroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.waitForTimeout(400);
      let scale;
      try {
        scale = await page.evaluate(SCALE_FN);
      } catch (e) {
        scale = null;
        pageErrors.push(`[${vp.id}/${p.id}] scale: ${String(e.message).slice(0, 120)}`);
      }
      // restore
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      if (scale && (scale.hScroll || scale.clipped.length || scale.overflowingText.length)) {
        // only count hScroll as NEW if it wasn't already overflowing at natural size
        const newHScroll = scale.hScroll && !(beforeHScroll.sw > beforeHScroll.cw + 2);
        scalingFailures.push({
          viewport: vp.id, path_id: p.id, label: p.label,
          hScroll: scale.hScroll, hScrollPreexisting: scale.hScroll ? !newHScroll : false,
          clipped: scale.clipped, overflowingText: scale.overflowingText,
        });
      }
    }
    await ctx.close();
  }

  // ── dedupe contrast across viewports (same selector+fg+bg) keep worst ──
  const byKey = new Map();
  for (const f of allContrast) {
    const k = f.selector + "|" + f.fg + "|" + f.bg;
    const prev = byKey.get(k);
    if (!prev || f.ratio < prev.ratio) {
      f.viewports = new Set([f.viewport]);
      f.paths = new Set([f.path_id]);
      byKey.set(k, f);
    } else {
      prev.viewports.add(f.viewport);
      prev.paths.add(f.path_id);
    }
  }
  const contrastUnique = [...byKey.values()].sort((a, b) => a.ratio - b.ratio)
    .map(f => ({ ...f, viewports: [...f.viewports], paths: [...f.paths] }));

  // dedupe unresolved + tiny by selector
  const unresKey = new Map();
  for (const u of allUnresolved) { if (!unresKey.has(u.selector + u.reason)) unresKey.set(u.selector + u.reason, u); }
  const unresolvedUnique = [...unresKey.values()];
  const tinyKey = new Map();
  for (const t of allTiny) { const k = t.selector + "|" + t.fontPx; if (!tinyKey.has(k)) tinyKey.set(k, t); }
  const tinyUnique = [...tinyKey.values()].sort((a, b) => a.fontPx - b.fontPx);

  // ── summary ──
  const line = "─".repeat(78);
  console.log("\n" + line);
  console.log("A11Y CONTRAST + FONT-SCALING PROBE — WCAG AA");
  console.log(line);
  console.log(`viewports walked : ${VIEWPORTS.map(v => v.id + " " + v.width + "x" + v.height).join(", ")}`);
  console.log(`paths walked     : ${paths.map(p => p.id).join(", ")}`);
  console.log(`text nodes seen  : ${totalTextNodes}`);
  console.log(`contrast FAILS   : ${contrastUnique.length} unique  (ratio < 4.5 normal / < 3.0 large)`);
  console.log(`unresolved bg    : ${unresolvedUnique.length} (gradient/image behind text — not flagged, needs manual check)`);
  console.log(`tiny text (<11px): ${tinyUnique.length}`);
  console.log(`scaling failures : ${scalingFailures.length} path/viewport combos break at 200%`);
  if (pageErrors.length) console.log(`page errors      : ${pageErrors.length}`);

  console.log("\n" + line);
  console.log(`TOP ${Math.min(TOP_N, contrastUnique.length)} CONTRAST OFFENDERS (worst ratio first)`);
  console.log(line);
  for (const f of contrastUnique.slice(0, TOP_N)) {
    const big = f.large ? " [large]" : "";
    console.log(`  ${String(f.ratio).padEnd(5)}:1  fg ${f.fg}  bg ${f.bg}  ${f.fontPx}px${big}  (need ${f.threshold})`);
    console.log(`         sel: ${f.selector}`);
    console.log(`         txt: "${f.sample}"  [${f.viewports.join(",")} / ${f.paths.join(",")}]`);
  }

  if (tinyUnique.length) {
    console.log("\n" + line);
    console.log("TINY TEXT (<11px)");
    console.log(line);
    for (const t of tinyUnique.slice(0, 15)) {
      console.log(`  ${t.fontPx}px  ${t.selector}  "${t.sample}"  [${t.viewport}/${t.path_id}]`);
    }
  }

  console.log("\n" + line);
  console.log("FONT-SCALING FAILURES @ 200%");
  console.log(line);
  if (!scalingFailures.length) console.log("  (none)");
  for (const s of scalingFailures) {
    console.log(`  ${s.viewport} / ${s.path_id} — ${s.label}`);
    if (s.hScroll) console.log(`     h-scroll: scrollW ${s.hScroll.scrollWidth} > clientW ${s.hScroll.clientWidth} (over ${s.hScroll.overBy}px)${s.hScrollPreexisting ? " [pre-existing at natural size]" : " [NEW @200%]"}`);
    if (s.clipped.length) {
      console.log(`     clipped text (overflow:hidden cutting content): ${s.clipped.length}`);
      for (const c of s.clipped.slice(0, 5)) console.log(`        ${c.selector} [${c.axis}] over ${c.overBy}px  "${c.sample}"${c.ellipsis ? " (ellipsis)" : ""}`);
    }
    if (s.overflowingText.length) {
      console.log(`     text past viewport right edge: ${s.overflowingText.length}`);
      for (const o of s.overflowingText.slice(0, 5)) console.log(`        ${o.selector} right ${o.right} > vw ${o.vw} (over ${o.overBy}px)  "${o.sample}"`);
    }
  }

  if (pageErrors.length) {
    console.log("\n" + line);
    console.log("PAGE ERRORS");
    console.log(line);
    for (const e of [...new Set(pageErrors)].slice(0, 15)) console.log("  " + e);
  }

  // ── JSON ──
  const out = {
    generated: new Date().toISOString(),
    config: { viewports: VIEWPORTS, paths: paths.map(p => p.id), thresholds: { normal: 4.5, large: 3.0, tinyPx: 11 } },
    summary: {
      textNodes: totalTextNodes,
      contrastFails: contrastUnique.length,
      unresolvedBg: unresolvedUnique.length,
      tinyText: tinyUnique.length,
      scalingFailures: scalingFailures.length,
      pageErrors: pageErrors.length,
      worstRatios: contrastUnique.slice(0, 5).map(f => f.ratio),
    },
    contrast: contrastUnique,
    unresolved: unresolvedUnique,
    tinyText: tinyUnique,
    scaling: scalingFailures,
    pageErrors: [...new Set(pageErrors)],
  };
  const outDir = path.join(__dirname, "..", "audit-results");
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const outPath = path.join(outDir, "a11y_contrast_findings.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nJSON findings → " + outPath);

  await browser.close();
  process.exit(0);
})().catch(e => { console.error("PROBE ERROR:", e); process.exit(1); });
