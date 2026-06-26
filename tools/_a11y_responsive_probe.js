#!/usr/bin/env node
// _a11y_responsive_probe.js — RESPONSIVE layout audit (Playwright, DOM/CSS only).
//
// WHAT IT DOES
// For each (CORE PATH × VIEWPORT) it walks the franchise UI in a headless
// Chromium and detects four classes of responsive defect, then reports each as a
// structured finding {kind, path, viewport, selector, text, box, detail}:
//
//   1. OVERFLOW  — the document scrolls horizontally (scrollWidth > clientWidth+1).
//      For each offender, the element(s) whose right edge exceeds the viewport
//      (getBoundingClientRect().right > innerWidth+1) are reported by selector +
//      text, deepest-leaf-first (the actual culprit, not its scrolling ancestor).
//   2. OVERLAP   — two INTERACTIVE elements (button/a/input/select/textarea/
//      [role=button]/[tabindex>=0]/[onclick]) whose visible boxes intersect by a
//      meaningful area. The phone "START SEASON" CTA over the hero card is the
//      canonical example. Ancestor↔descendant pairs are ignored (legit nesting).
//   3. TRUNCATION— text clipped by its box (scrollWidth > clientWidth) OR an
//      element styled `text-overflow:ellipsis` with NO title/aria-label (the user
//      can never recover the hidden text). Reported with the clipped text.
//   4. OFFSCREEN — an INTERACTIVE element rendered partly/fully off the viewport
//      horizontally (right < 0 or left > innerWidth) — unreachable by pointer.
//
// It screenshots every path×viewport to /tmp/a11y_resp_<path>_<vp>.png, prints a
// per-path/per-viewport summary, and emits a JSON findings array. Determinism-
// neutral: pure DOM/CSS measurement, never touches engine/render/canvas.
//
//   node tools/_a11y_responsive_probe.js              # all paths × all viewports
//   node tools/_a11y_responsive_probe.js --json out.json
//   PROBE_PORT=5351 node tools/_a11y_responsive_probe.js
//
// Exit 0 always after a clean run (this is a REPORTER, not a pass/fail gate);
// exit 2 only on a harness crash (server/browser/entry-point failure).

"use strict";

const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.PROBE_PORT || 5341);
const ROOT = path.join(__dirname, "..");
const OUT_DIR = "/tmp";
const SHOT = (p, vp) => path.join(OUT_DIR, `a11y_resp_${p}_${vp}.png`);

const http = require("http");
const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }));

// ── resilient static server ───────────────────────────────────────────────────
// `npx http-server -s` has been observed to die partway through a long sweep
// (45 sequential loads of a ~5MB JS app), which left the last viewports
// CONNECTION_REFUSED. We keep a single server BUT health-check it before every
// navigation and respawn if it stopped answering, plus retry the goto.
let serverProc = null;
function spawnServer() {
  serverProc = spawn("npx", ["http-server", "-p", String(PORT), "-s", "-c-1", ROOT], { stdio: "ignore" });
  children.push(serverProc);
}
function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: "localhost", port: PORT, path: "/play.html", timeout: 2500 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}
async function ensureServer() {
  for (let i = 0; i < 30; i++) {
    if (await ping()) return true;
    // dead or not-yet-up — (re)spawn and wait
    if (!serverProc || serverProc.exitCode !== null || serverProc.killed) spawnServer();
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// ── viewports ───────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { id: "desktop",      width: 1440, height: 900  },
  { id: "tablet",       width: 820,  height: 1180 },
  { id: "tablet_land",  width: 1180, height: 820  },
  { id: "phone",        width: 390,  height: 844  },
  { id: "phone_small",  width: 360,  height: 640  },
];

// ── core paths ──────────────────────────────────────────────────────────────
// Each path = a name + an async (page) => void that leaves the relevant screen
// mounted + visible. Hooks per the task brief. Defensive: every step is guarded
// so one path's failure does not abort the run.
const PATHS = [
  {
    id: "start",
    label: "Start screen (franchise create/pick)",
    setup: async (page) => {
      // Fresh load already shows the start screen; re-render to be explicit.
      await page.evaluate(() => { if (typeof renderFrnStartScreen === "function") renderFrnStartScreen(); });
      await page.waitForTimeout(400);
    },
  },
  {
    id: "dashboard",
    label: "Dashboard (preseason, default tab)",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(700);
    },
  },
  {
    id: "overview",
    label: "Dashboard › Overview tab",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { if (typeof frnSetTab === "function") frnSetTab("overview"); });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "roster",
    label: "Dashboard › Roster tab",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { if (typeof frnSetTab === "function") frnSetTab("roster"); });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "frontoffice",
    label: "Dashboard › Front Office tab",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { if (typeof frnSetTab === "function") frnSetTab("frontoffice"); });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "league",
    label: "Dashboard › League tab",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { if (typeof frnSetTab === "function") frnSetTab("league"); });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "replays",
    label: "Dashboard › Replays tab",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { if (typeof frnSetTab === "function") frnSetTab("replays"); });
      await page.waitForTimeout(500);
    },
  },
  {
    id: "livegame",
    label: "Live game screen (playback controls)",
    setup: async (page) => {
      await page.evaluate(() => {
        if (typeof startFranchise === "function") startFranchise(1);
      });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        if (typeof _frnEnterLiveGameScreen === "function") {
          const fr = (typeof franchise !== "undefined" && franchise) ? franchise : null;
          const myId = (fr && typeof fr.chosenTeamId === "number") ? fr.chosenTeamId : 1;
          const oppId = (myId === 2) ? 3 : 2;
          _frnEnterLiveGameScreen(myId, oppId, false);
        }
      });
      await page.waitForTimeout(900);
    },
  },
  {
    id: "modal",
    label: "Confirm modal",
    setup: async (page) => {
      await page.evaluate(() => { if (typeof startFranchise === "function") startFranchise(1); });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        if (typeof _frnConfirmModal === "function") {
          // Fire-and-forget: leaves the modal mounted for measurement.
          _frnConfirmModal({ title: "Confirm Action", body: "Are you sure you want to proceed with this action? This cannot be undone." });
        }
      });
      await page.waitForTimeout(400);
    },
  },
];

// ── the in-page detector ──────────────────────────────────────────────────────
// Runs in the browser; returns a plain-data findings list for the current
// path×viewport. Self-contained (no closures over Node scope).
function detectInPage() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const EPS = 1; // 1px slack — sub-pixel rounding is not a defect
  const findings = [];

  // ---- helpers ----
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + el.id;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let seg = node.tagName.toLowerCase();
      if (node.id) { parts.unshift("#" + node.id); break; }
      const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
      if (cls.length) seg += "." + cls.join(".");
      // positional index among same-tag siblings (disambiguate)
      const parent = node.parentElement;
      if (parent) {
        const sib = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sib.length > 1) seg += `:nth-of-type(${sib.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  };

  const txt = (el) => {
    const t = (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"))) || el.textContent || "";
    return t.replace(/\s+/g, " ").trim().slice(0, 60);
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.02) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // must be within the vertical band that could plausibly be on screen
    // (we still want elements scrolled below the fold; only skip zero-area)
    return true;
  };

  const inViewportVert = (r) => r.bottom > 0 && r.top < H * 4; // generous; vertical scroll is fine

  // Skip the canvas / pixi field + their wrappers entirely (not DOM chrome;
  // determinism-owned geometry — never a responsive-CSS defect we may touch).
  const isCanvasZone = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      const id = n.id || "";
      if (id === "field" || id === "field-pixi" || id === "gameArea") return true;
      if (n.tagName === "CANVAS") return true;
      n = n.parentElement;
    }
    return false;
  };

  // True if an ANCESTOR clips/scrolls horizontally (overflow-x hidden/auto/scroll).
  // Content inside such a box (marquees, internal carousels, scrollable tables)
  // does NOT extend the document — so it is never the doc-horizontal-scroll cause.
  const inClippedScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const ox = cs.overflowX;
      if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true;
      n = n.parentElement;
    }
    return false;
  };

  // ---- 1. OVERFLOW (document horizontal scroll + offending elements) ----
  const docEl = document.documentElement;
  const docOverflow = docEl.scrollWidth - docEl.clientWidth;
  if (docOverflow > EPS) {
    // Find elements whose right edge pokes past the viewport AND that actually
    // contribute to the document's horizontal extent — i.e. NOT inside a box that
    // clips/scrolls horizontally (those are intentional marquees/carousels/tables
    // and never cause the PAGE to scroll). No width cap: a fixed-width nav row
    // wider than the viewport is exactly the kind of culprit we want to surface.
    const all = Array.from(document.body.querySelectorAll("*"));
    const offenders = [];
    for (const el of all) {
      if (!visible(el) || isCanvasZone(el) || inClippedScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > W + EPS) {
        // Prefer leaves: only report if no visible child also pokes out at >= this right.
        offenders.push({ el, r });
      }
    }
    // Deepest-first: keep elements that have NO descendant in the offender set
    // (the descendant is the truer/innermost culprit).
    const offSet = new Set(offenders.map((o) => o.el));
    const leaves = offenders.filter((o) => {
      for (const child of o.el.querySelectorAll("*")) {
        if (offSet.has(child)) return false;
      }
      return true;
    });
    // Also surface the single WIDEST offending container (the structural row/grid
    // that actually defines the over-wide extent) — its leaves alone can read as
    // "just some text" when the real fix is on the parent row's layout.
    const widest = offenders.slice().sort((a, b) => b.r.right - a.r.right)[0];
    const report = [];
    if (widest && !leaves.includes(widest)) report.push({ ...widest, role: "container" });
    leaves.sort((a, b) => b.r.right - a.r.right);
    for (const l of leaves) report.push({ ...l, role: "leaf" });
    const top = report.slice(0, 12);
    if (top.length === 0) {
      // No single element identified (e.g. text node / pseudo) — still report doc overflow.
      findings.push({
        kind: "overflow", selector: "html", text: "", detail: `document scrollWidth ${docEl.scrollWidth} > clientWidth ${docEl.clientWidth} (+${docOverflow}px) — no element offender isolated`,
        box: { right: docEl.scrollWidth, width: docEl.scrollWidth, overshoot: docOverflow },
      });
    }
    for (const { el, r, role } of top) {
      findings.push({
        kind: "overflow",
        role,
        selector: cssPath(el),
        text: txt(el),
        detail: `${role === "container" ? "[widest container] " : ""}right=${Math.round(r.right)} > innerWidth ${W} (+${Math.round(r.right - W)}px); doc overflow +${docOverflow}px`,
        box: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), top: Math.round(r.top), overshoot: Math.round(r.right - W) },
      });
    }
  }

  // ---- collect interactive elements (for overlap + offscreen) ----
  const INTERACTIVE_SEL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"]), [onclick]';
  const interactives = Array.from(document.querySelectorAll(INTERACTIVE_SEL)).filter((el) => {
    if (!visible(el) || isCanvasZone(el)) return false;
    const r = el.getBoundingClientRect();
    return inViewportVert(r);
  });

  // ---- 2. OVERLAP of interactive elements ----
  const isAncestor = (a, b) => a !== b && a.contains(b);
  const rectOf = (el) => el.getBoundingClientRect();
  // Only consider pairs roughly in the same vertical neighborhood for perf.
  const items = interactives.map((el) => ({ el, r: rectOf(el) }));
  const seenPair = new Set();
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const B = items[j];
      // ignore nesting (legit: a button inside a card that is also a link, etc.)
      if (isAncestor(A.el, B.el) || isAncestor(B.el, A.el)) continue;
      const ix = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
      const iy = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
      const interArea = ix * iy;
      if (interArea <= 4) continue;
      // require the overlap to be a meaningful fraction of the smaller element
      const minArea = Math.min(A.r.width * A.r.height, B.r.width * B.r.height) || 1;
      const frac = interArea / minArea;
      if (frac < 0.18) continue; // < 18% overlap ≈ borders kissing; not a defect
      const key = cssPathKey(A.el) + "|" + cssPathKey(B.el);
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      findings.push({
        kind: "overlap",
        selector: cssPath(A.el),
        selector2: cssPath(B.el),
        text: txt(A.el),
        text2: txt(B.el),
        detail: `interactive elements overlap by ${Math.round(frac * 100)}% of the smaller (≈${Math.round(interArea)}px²)`,
        box: { a: rRound(A.r), b: rRound(B.r), interArea: Math.round(interArea), frac: +frac.toFixed(2) },
      });
    }
  }
  function cssPathKey(el) { return cssPath(el); }
  function rRound(r) { return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; }

  // ---- 3. TEXT TRUNCATION ----
  const textCandidates = Array.from(document.body.querySelectorAll("*"));
  let truncCount = 0;
  for (const el of textCandidates) {
    if (truncCount > 200) break;
    if (!visible(el) || isCanvasZone(el)) continue;
    // Only leaf-ish text holders (no element children) to avoid container false-positives.
    const hasElChild = Array.from(el.children).some((c) => c.nodeType === 1);
    const directText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length);
    if (hasElChild || !directText) continue;
    const cs = getComputedStyle(el);
    // Skip visually-hidden (.sr-only) — intentionally clipped to ~1px and read by AT,
    // not shown visually; flagging it as "clipped text" is a false positive.
    if (el.clientWidth <= 1 || el.clientHeight <= 1 ||
        (cs.clipPath && cs.clipPath.includes("inset(50%)")) || cs.clip === "rect(0px, 0px, 0px, 0px)") continue;
    // Text inside a horizontal scroll container (overflow-x auto/scroll) is REACHABLE by
    // scrolling — wide data tables on phone use this on purpose, so it is NOT lost content.
    const inScrollX = (() => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    })();
    const ellipsis = cs.textOverflow === "ellipsis" && (cs.overflow === "hidden" || cs.overflowX === "hidden");
    const clipped = el.scrollWidth > el.clientWidth + 1 && !inScrollX && (cs.overflow !== "visible" || cs.overflowX === "hidden" || cs.whiteSpace === "nowrap");
    if (!ellipsis && !clipped) continue;
    const hasAccessibleName = !!(el.getAttribute("title") || el.getAttribute("aria-label"));
    const actuallyClipped = el.scrollWidth > el.clientWidth + 1; // text really lost
    // Two grades:
    //   "clipped"        — text IS being cut off right now (scrollWidth>clientWidth) and
    //                      not recoverable (no title/aria-label) — real lost content.
    //   "ellipsis-risk"  — text-overflow:ellipsis with no title/aria-label, fits today
    //                      but will silently truncate at narrower width / longer text.
    if (actuallyClipped && !hasAccessibleName) {
      truncCount++;
      const r = el.getBoundingClientRect();
      findings.push({
        kind: "truncation", subkind: "clipped",
        selector: cssPath(el),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        detail: `text clipped: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth} (+${el.scrollWidth - el.clientWidth}px hidden) — no title/aria-label to recover it`,
        box: { ...rRound(r), scrollW: el.scrollWidth, clientW: el.clientWidth, hasName: hasAccessibleName },
      });
    } else if (ellipsis && !hasAccessibleName) {
      truncCount++;
      const r = el.getBoundingClientRect();
      findings.push({
        kind: "truncation", subkind: "ellipsis-risk",
        selector: cssPath(el),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        detail: `text-overflow:ellipsis with no title/aria-label (fits now: scrollWidth ${el.scrollWidth} ≈ clientWidth ${el.clientWidth}); will silently truncate if narrower/longer`,
        box: { ...rRound(r), scrollW: el.scrollWidth, clientW: el.clientWidth, hasName: hasAccessibleName },
      });
    }
  }

  // ---- 4. OFFSCREEN interactive ----
  for (const { el, r } of items) {
    // An element legitimately scrolled out of a horizontal scroller/marquee is
    // NOT an off-screen defect (the user scrolls/the marquee animates to it).
    if (inClippedScroller(el)) continue;
    const offRight = r.left > W + EPS;
    const offLeft = r.right < -EPS;
    const partLeft = r.left < -2 && r.right > 0;       // partly clipped off the left
    const partRight = r.right > W + 2 && r.left < W;   // partly clipped off the right (interactive)
    if (offRight || offLeft) {
      findings.push({
        kind: "offscreen",
        selector: cssPath(el),
        text: txt(el),
        detail: `fully off-screen horizontally: left=${Math.round(r.left)} right=${Math.round(r.right)} (innerWidth ${W}) — unreachable`,
        box: rRound(r),
      });
    } else if (partRight && r.right - W > 8) {
      findings.push({
        kind: "offscreen",
        selector: cssPath(el),
        text: txt(el),
        detail: `interactive element clipped off the right edge by ${Math.round(r.right - W)}px (right=${Math.round(r.right)} > ${W})`,
        box: rRound(r),
      });
    } else if (partLeft && -r.left > 8) {
      findings.push({
        kind: "offscreen",
        selector: cssPath(el),
        text: txt(el),
        detail: `interactive element clipped off the left edge by ${Math.round(-r.left)}px (left=${Math.round(r.left)})`,
        box: rRound(r),
      });
    }
  }

  return {
    docOverflow,
    scrollWidth: docEl.scrollWidth,
    clientWidth: docEl.clientWidth,
    innerWidth: W,
    interactiveCount: interactives.length,
    findings,
  };
}

// ── runner ────────────────────────────────────────────────────────────────────
(async () => {
  // start a static server rooted at the repo (health-checked + auto-respawned)
  spawnServer();
  if (!(await ensureServer())) { console.error("PROBE CRASH: static server never came up on port " + PORT); process.exit(2); }

  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });

  const allFindings = [];
  const summary = []; // {path, viewport, docOverflow, counts}

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    for (const P of PATHS) {
      const page = await context.newPage();
      page.on("dialog", (d) => d.accept().catch(() => {}));
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 140)));
      let res = null;
      try {
        await ensureServer(); // verify the server is alive (respawn if it died mid-sweep)
        let navOk = false, lastErr = null;
        for (let attempt = 0; attempt < 3 && !navOk; attempt++) {
          try {
            await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
            navOk = true;
          } catch (ne) { lastErr = ne; await ensureServer(); await page.waitForTimeout(500); }
        }
        if (!navOk) throw lastErr;
        await page.waitForTimeout(1300);
        await P.setup(page);
        await page.waitForTimeout(250);
        res = await page.evaluate(detectInPage);
        // screenshot (viewport only — fullPage would capture below-fold canvas noise)
        await page.screenshot({ path: SHOT(P.id, vp.id), fullPage: false }).catch(() => {});
      } catch (e) {
        res = { error: String(e).slice(0, 160), findings: [] };
      }
      const counts = { overflow: 0, overlap: 0, truncation: 0, offscreen: 0 };
      for (const f of (res.findings || [])) {
        counts[f.kind] = (counts[f.kind] || 0) + 1;
        allFindings.push({ ...f, path: P.id, viewport: vp.id });
      }
      summary.push({
        path: P.id, label: P.label, viewport: vp.id,
        vpDim: `${vp.width}x${vp.height}`,
        docOverflow: res.docOverflow != null ? res.docOverflow : "?",
        scrollWidth: res.scrollWidth, clientWidth: res.clientWidth,
        interactives: res.interactiveCount,
        counts, error: res.error || null, pageErrors: pageErrors.slice(0, 3),
      });
      await page.close();
    }
    await context.close();
  }

  await browser.close();

  // ── print summary ──
  console.log("\n=================== A11Y RESPONSIVE PROBE ===================");
  console.log(`viewports: ${VIEWPORTS.map((v) => `${v.id}(${v.width}x${v.height})`).join(", ")}`);
  console.log(`paths:     ${PATHS.map((p) => p.id).join(", ")}`);
  console.log("findings kinds: overflow | overlap | truncation | offscreen\n");

  // group by viewport
  for (const vp of VIEWPORTS) {
    console.log(`\n── viewport ${vp.id}  (${vp.width}x${vp.height}) ──`);
    const rows = summary.filter((s) => s.viewport === vp.id);
    for (const s of rows) {
      const c = s.counts;
      const flag = (s.docOverflow !== "?" && s.docOverflow > 1) ? `H-SCROLL +${s.docOverflow}px` : "ok";
      const errStr = s.error ? `  ERR:${s.error}` : (s.pageErrors.length ? `  pageerr:${s.pageErrors.length}` : "");
      console.log(
        `  ${s.path.padEnd(13)} ${String(flag).padEnd(14)} ` +
        `ovf:${c.overflow}  ovl:${c.overlap}  trunc:${c.truncation}  off:${c.offscreen}` +
        `   (sw${s.scrollWidth}/cw${s.clientWidth}, ${s.interactives} interactive)${errStr}`
      );
    }
  }

  // worst-offender list (by total findings per path×vp)
  console.log("\n── worst path×viewport (by finding count) ──");
  const ranked = summary
    .map((s) => ({ key: `${s.path} @ ${s.viewport}`, total: Object.values(s.counts).reduce((a, b) => a + b, 0), docOverflow: s.docOverflow, shot: SHOT(s.path, s.viewport) }))
    .sort((a, b) => b.total - a.total || (Number(b.docOverflow) || 0) - (Number(a.docOverflow) || 0));
  for (const r of ranked.slice(0, 12)) {
    console.log(`  ${String(r.total).padStart(3)} findings  ${r.key.padEnd(28)} hscroll=${r.docOverflow}  ${path.basename(r.shot)}`);
  }

  // totals
  const totals = { overflow: 0, overlap: 0, truncation: 0, offscreen: 0 };
  for (const f of allFindings) totals[f.kind] = (totals[f.kind] || 0) + 1;
  console.log(`\nTOTAL findings: ${allFindings.length}  (overflow ${totals.overflow}, overlap ${totals.overlap}, truncation ${totals.truncation}, offscreen ${totals.offscreen})`);
  console.log(`screenshots: ${OUT_DIR}/a11y_resp_<path>_<viewport>.png`);

  // ── write JSON ──
  const jsonArgIdx = process.argv.indexOf("--json");
  const jsonPath = jsonArgIdx >= 0 ? process.argv[jsonArgIdx + 1] : path.join(OUT_DIR, "a11y_resp_findings.json");
  const payload = { generatedAt: new Date().toISOString(), viewports: VIEWPORTS, paths: PATHS.map((p) => ({ id: p.id, label: p.label })), summary, findings: allFindings, totals };
  try { fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2)); console.log(`JSON findings: ${jsonPath}`); } catch (e) { console.error("could not write JSON:", e.message); }

  // Print the JSON findings array to stdout as well (task requirement).
  console.log("\n----- JSON FINDINGS (array) -----");
  console.log(JSON.stringify(allFindings, null, 1));

  process.exit(0);
})().catch((e) => { console.error("PROBE CRASH:", e); process.exit(2); });
