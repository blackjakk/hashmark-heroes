#!/usr/bin/env node
// _ds_guard.js — Design System "no-bypass" enforcement guard.
//
// CONTRACT (design-system/CONTRACT.md §GUARD): scan the franchise UI files for
// patterns that BYPASS the design system, count them per file+category, and
// RATCHET against a committed baseline so new bypasses are blocked while a
// migration can only LOWER the debt.
//
// Bypass categories:
//   (a) font-family : inline `font-family:` literals inside JS template/string
//       UI — should be a --font-* token.
//   (b) color       : raw hex (`#abc`/`#aabbcc`/8-digit) or `rgb(a)(...)` color
//       literals used for styling inside JS strings — should be a token var().
//   (c) component   : hand-rolled component markup that should be a DS factory
//       call: `class="btn`, `class="badge`, `class="frn-modal`,
//       `class="progress-bar` (editable list in CONFIG.componentMarkers).
//
// Usage:
//   node tools/_ds_guard.js                 ratchet check (creates baseline on 1st run)
//   node tools/_ds_guard.js --report        print per-file/category counts + deltas
//   node tools/_ds_guard.js --update-baseline   rewrite baseline from current counts
//
// Exit: 1 if ANY count EXCEEDS its baseline (new bypass introduced); else 0.
//       2 on a crash. `--report` and `--update-baseline` always exit 0 (unless
//       --report is combined with the ratchet — see below). node --check clean.

"use strict";
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — edit here to tune the scan. The component marker list is intentionally
// a plain array so it can be extended as the DS grows.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  repoRoot: path.join(__dirname, ".."),
  baselineFile: path.join(__dirname, "_ds_guard_baseline.json"),
  files: [
    "play-franchise-core.js",
    "play-franchise-season.js",
    "play-franchise-offseason.js",
    "play-franchise-stats.js",
    // DS-unify pass (2026-07): EVERY UI surface is ratcheted, not just the
    // original four franchise files. New UI files must be added here.
    "play-franchise-fantasydraft.js",
    "play-league-client.js",
    "play-h2h-client.js",
    "play.css",
  ],
  // Category order is the report column order.
  categories: ["font-family", "color", "component"],
  // Per-file category OPT-IN (default: all categories). play.css is the
  // legacy stylesheet — its :root PALETTE DEFINITIONS are legitimately raw
  // hex (they ARE the tokens) and its component classes are the legacy look
  // the DS mirrors, so only the font-family debt is ratcheted there (inline
  // stacks that should be var(--font-*); the token DEFINITIONS themselves
  // sit permanently in the baseline).
  fileCategories: {
    "play.css": ["font-family"],
  },
  // (c) hand-rolled component markup. A bypass is a `class="<marker>` opener
  // (covers `class="btn"`, `class="btn btn-gold"`, `class='badge ...'`).
  componentMarkers: ["btn", "badge", "frn-modal", "progress-bar"],
};

// ─────────────────────────────────────────────────────────────────────────────
// DETECTORS — each returns a count for one source string.
// We work line-by-line (the franchise files are template-string UI), which keeps
// counts stable and the report actionable (a count maps to grep-able lines).
// ─────────────────────────────────────────────────────────────────────────────

// (a) inline font-family literals. Matches `font-family:` as it appears in
// inline style strings / injected <style> blocks — EXCEPT declarations whose
// value is already a token (`font-family: var(--font-…)`), which are the
// DS-clean form and must not count as debt (else tokenizing never lowers the
// ratchet and every clean declaration reads as a bypass). NOTE the optional
// whitespace lives INSIDE the lookahead: a trailing `\s*` before `(?!var\()`
// can backtrack to zero and sneak `: var(` past the guard (found during the
// 2026-07 unify pass).
const RE_FONT_FAMILY = /font-family\s*:(?!\s*var\()/gi;

// (b) color literals used for styling.
//   - hex: #RGB / #RRGGBB / #RRGGBBAA / #RGBA (3,4,6,8 hex digits), word-bounded
//     so we don't catch URL fragments mid-token.
//   - rgb()/rgba() functional notation.
const RE_HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
const RE_RGB = /\brgba?\([^)]*\)/gi;

// (c) component markup openers, built from CONFIG.componentMarkers. Per the
// CONTRACT the markers are PREFIX patterns on the class attribute opener:
// `class="btn` (also catches `class="btn btn-gold"`, `class="btn-sm"`),
// `class="badge`, `class="frn-modal` (the hand-rolled confirm modal),
// `class="progress-bar`. The marker must sit at the START of the class value
// (first token), which is where hand-rolled components are introduced. Sub-
// element classes built as their own attribute (e.g. `class="frn-modal-title"`)
// are themselves prefix-matched by `frn-modal`, intentionally — they are part of
// the same hand-rolled component that a DS.modal() factory would subsume.
function buildComponentRegex(markers) {
  const alt = markers
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // class\s*=\s*["']  the class attribute opener (quote = left boundary), then
  // the marker as a PREFIX of the class value.
  return new RegExp(`class\\s*=\\s*["'](?:${alt})`, "g");
}
const RE_COMPONENT = buildComponentRegex(CONFIG.componentMarkers);

function countMatches(re, s) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s) !== null) {
    n++;
    if (re.lastIndex === 0) break; // safety against zero-width loops
  }
  return n;
}

function scanFile(absPath, rel) {
  const src = fs.readFileSync(absPath, "utf8");
  const cats = (CONFIG.fileCategories && CONFIG.fileCategories[rel]) || CONFIG.categories;
  const on = (c) => cats.includes(c);
  return {
    "font-family": on("font-family") ? countMatches(RE_FONT_FAMILY, src) : 0,
    // hex + rgb both count toward the single "color" category.
    color: on("color") ? countMatches(RE_HEX, src) + countMatches(RE_RGB, src) : 0,
    component: on("component") ? countMatches(RE_COMPONENT, src) : 0,
  };
}

function scanAll() {
  const counts = {};
  for (const rel of CONFIG.files) {
    const abs = path.join(CONFIG.repoRoot, rel);
    if (!fs.existsSync(abs)) {
      console.error(`[ds-guard] WARNING: missing file ${rel} (counted as 0)`);
      counts[rel] = { "font-family": 0, color: 0, component: 0 };
      continue;
    }
    counts[rel] = scanFile(abs, rel);
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE I/O
// ─────────────────────────────────────────────────────────────────────────────
function readBaseline() {
  if (!fs.existsSync(CONFIG.baselineFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG.baselineFile, "utf8")).counts || null;
  } catch (e) {
    console.error(`[ds-guard] baseline parse error: ${e.message}`);
    return null;
  }
}

function writeBaseline(counts) {
  const out = {
    _comment:
      "DS no-bypass ratchet baseline. Generated by tools/_ds_guard.js. " +
      "Counts are per-file bypass debt; the guard fails if any count EXCEEDS " +
      "these. Lower via migration + `node tools/_ds_guard.js --update-baseline`.",
    generated: new Date().toISOString().slice(0, 10),
    categories: CONFIG.categories,
    componentMarkers: CONFIG.componentMarkers,
    fileCategories: CONFIG.fileCategories,
    counts,
  };
  fs.writeFileSync(CONFIG.baselineFile, JSON.stringify(out, null, 2) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
function fileTotals(fileCounts) {
  return CONFIG.categories.reduce((a, c) => a + (fileCounts[c] || 0), 0);
}

function printReport(counts, baseline) {
  const cats = CONFIG.categories;
  const pad = (s, w) => String(s).padEnd(w);
  const padN = (s, w) => String(s).padStart(w);
  const fileW = Math.max(28, ...CONFIG.files.map((f) => f.length)) + 2;
  console.log("\nDS GUARD — bypass scan" + (baseline ? " (Δ vs baseline)" : " (no baseline yet)"));
  console.log("─".repeat(fileW + cats.length * 14 + 14));
  let header = pad("file", fileW);
  for (const c of cats) header += padN(c, 14);
  header += padN("TOTAL", 14);
  console.log(header);
  console.log("─".repeat(fileW + cats.length * 14 + 14));

  const totals = {};
  const baseTotals = {};
  cats.forEach((c) => { totals[c] = 0; baseTotals[c] = 0; });

  for (const f of CONFIG.files) {
    const fc = counts[f] || {};
    const bc = (baseline && baseline[f]) || null;
    let line = pad(f, fileW);
    for (const c of cats) {
      const n = fc[c] || 0;
      totals[c] += n;
      let cell = String(n);
      if (bc) {
        const b = bc[c] || 0;
        baseTotals[c] += b;
        const d = n - b;
        const dStr = d === 0 ? "·" : (d > 0 ? "+" + d : String(d));
        cell = `${n} (${dStr})`;
      }
      line += padN(cell, 14);
    }
    const ft = fileTotals(fc);
    line += padN(String(ft), 14);
    console.log(line);
  }
  console.log("─".repeat(fileW + cats.length * 14 + 14));
  let tline = pad("ALL FILES", fileW);
  let grand = 0;
  for (const c of cats) {
    let cell = String(totals[c]);
    if (baseline) {
      const d = totals[c] - baseTotals[c];
      const dStr = d === 0 ? "·" : (d > 0 ? "+" + d : String(d));
      cell = `${totals[c]} (${dStr})`;
    }
    tline += padN(cell, 14);
    grand += totals[c];
  }
  tline += padN(String(grand), 14);
  console.log(tline);
  console.log("─".repeat(fileW + cats.length * 14 + 14));
  console.log(`GRAND TOTAL bypasses: ${grand}` + (baseline ? "" : "  (this becomes the baseline)"));
}

// ─────────────────────────────────────────────────────────────────────────────
// RATCHET — exit 1 if any count exceeds baseline.
// ─────────────────────────────────────────────────────────────────────────────
function ratchet(counts, baseline) {
  const violations = [];
  for (const f of CONFIG.files) {
    const fc = counts[f] || {};
    const bc = baseline[f] || {};
    for (const c of CONFIG.categories) {
      const cur = fc[c] || 0;
      const base = bc[c] || 0;
      if (cur > base) violations.push({ file: f, cat: c, cur, base, delta: cur - base });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const wantReport = args.includes("--report");
  const wantUpdate = args.includes("--update-baseline");

  const counts = scanAll();

  if (wantUpdate) {
    writeBaseline(counts);
    console.log(`[ds-guard] baseline rewritten → ${path.relative(CONFIG.repoRoot, CONFIG.baselineFile)}`);
    if (wantReport) printReport(counts, counts);
    return 0;
  }

  let baseline = readBaseline();

  // First run with no baseline: create it and print the starting totals.
  if (!baseline) {
    writeBaseline(counts);
    baseline = counts;
    console.log(`[ds-guard] no baseline found — created ${path.relative(CONFIG.repoRoot, CONFIG.baselineFile)} from current counts.`);
    printReport(counts, null);
    console.log("\n[ds-guard] baseline established. Re-run the guard to ratchet against it.");
    return 0;
  }

  if (wantReport) printReport(counts, baseline);

  const violations = ratchet(counts, baseline);
  if (violations.length) {
    console.log("\n[ds-guard] ✗ NEW BYPASSES introduced (count exceeds baseline):");
    for (const v of violations) {
      console.log(`    ${v.file} · ${v.cat}: ${v.cur} > ${v.base} (+${v.delta})`);
    }
    console.log("\nRoute new UI through window.DS.* (see design-system/CONTRACT.md), or if this");
    console.log("was a verified migration that legitimately RAISED a count, justify and run");
    console.log("`node tools/_ds_guard.js --update-baseline`.");
    return 1;
  }

  // Note when the debt has dropped below baseline (migration progress).
  let totalCur = 0, totalBase = 0;
  for (const f of CONFIG.files) {
    totalCur += fileTotals(counts[f] || {});
    totalBase += fileTotals(baseline[f] || {});
  }
  if (totalCur < totalBase) {
    console.log(`[ds-guard] ✓ no new bypasses. Debt LOWERED ${totalBase} → ${totalCur} ` +
      `(run --update-baseline to lock the gain).`);
  } else if (!wantReport) {
    console.log(`[ds-guard] ✓ no new bypasses (debt ${totalCur} == baseline).`);
  }
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error("[ds-guard] CRASH:", e && e.stack ? e.stack : e);
  process.exit(2);
}
