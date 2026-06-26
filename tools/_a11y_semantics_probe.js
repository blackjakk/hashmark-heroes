// _a11y_semantics_probe.js — headless accessibility SEMANTICS auditor for the
// franchise UI (screen-reader users). DOM-only; never touches the determinism /
// render / canvas path. It drives the app through the core screens, then for each
// rendered DOM snapshot it computes the ACCESSIBLE NAME of every relevant element
// (text content → aria-label → aria-labelledby → title → alt, in spec order) and
// flags elements that present no name (or no programmatic role) to assistive tech.
//
// Categories detected:
//   IMAGES   — <img> / role=img with no accessible name (alt/aria-*/title).
//   ICON_BTN — interactive controls (button / <a href> / role=button / tab /
//              [onclick]) whose visible text is empty or only emoji/symbol glyphs
//              AND have no aria-label / aria-labelledby / title. (Biggest bucket.)
//   FORM     — input / select / textarea with no <label for>, wrapping <label>,
//              aria-label, aria-labelledby, or title.
//   STATUS   — dynamic / live text (score, clock, toasts, "saving…", spinners,
//              status spans) lacking role=status|alert / aria-live. Heuristic list.
//   STRUCTURE— document-level: missing landmarks (main/nav/header), missing or
//              duplicate <h1>, heading-order jumps, document <title>/<html lang>.
//
// Output: per-category COUNTS + top examples to stdout, and a full JSON findings
// dump ({selector, category, screen, path, glyph?, suggestedName}) to
// /tmp/claude-*/.../a11y_semantics_findings.json (and echoed via --json).
//
//   node tools/_a11y_semantics_probe.js            (starts its own server :5344)
//   node tools/_a11y_semantics_probe.js --json     (also print full JSON to stdout)
//   node tools/_a11y_semantics_probe.js --selftest  (verify the name-computation
//                                                     core: labeled passes, bare × fails)

const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.A11Y_PORT || 5344);
const ARG_JSON = process.argv.includes("--json");
const ARG_SELFTEST = process.argv.includes("--selftest");
const OUT_DIR = process.env.SCRATCH_DIR || path.join(require("os").tmpdir(), "a11y-probe");
const OUT_FILE = path.join(OUT_DIR, "a11y_semantics_findings.json");

const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

// ---------------------------------------------------------------------------
// IN-PAGE LIBRARY (serialized into the browser). Pure DOM/ARIA logic, no app
// dependency. Returns findings for the CURRENT DOM. Keep this self-contained:
// page.evaluate sends the .toString() of this function across.
// ---------------------------------------------------------------------------
function PAGE_LIB() {
  // CSS-path for a node (best-effort, stable enough to locate the element).
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let sel = node.nodeName.toLowerCase();
      if (node.id) { sel += "#" + node.id; parts.unshift(sel); break; }
      const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) sel += "." + cls.join(".");
      const parent = node.parentNode;
      if (parent && parent.nodeType === 1) {
        const sibs = [...parent.children].filter(c => c.nodeName === node.nodeName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentNode;
    }
    return parts.join(" > ");
  }

  function visibleText(el) {
    // textContent minus content of nested labelled controls; trimmed.
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  // ACCESSIBLE NAME (simplified per WAI ARIA accname): aria-labelledby →
  // aria-label → (for img) alt / (for input) associated label/value/placeholder
  // → title → visible text content. Returns the first non-empty source.
  function accName(el) {
    const tag = el.nodeName.toLowerCase();
    // 1. aria-labelledby (resolve referenced ids' text)
    const lblBy = el.getAttribute("aria-labelledby");
    if (lblBy) {
      const txt = lblBy.split(/\s+/).map(id => {
        const r = document.getElementById(id);
        return r ? (r.textContent || "").replace(/\s+/g, " ").trim() : "";
      }).filter(Boolean).join(" ").trim();
      if (txt) return { name: txt, from: "aria-labelledby" };
    }
    // 2. aria-label
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return { name: al.trim(), from: "aria-label" };
    // 3a. <img> alt
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt !== null && alt.trim()) return { name: alt.trim(), from: "alt" };
      if (alt === "") return { name: "", from: "alt-empty-decorative" }; // alt="" = intentional decorative
    }
    // 3b. form control: <label for>, wrapping <label>, value (button), placeholder
    if (tag === "input" || tag === "select" || tag === "textarea") {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab && lab.textContent.trim()) return { name: lab.textContent.replace(/\s+/g, " ").trim(), from: "label[for]" };
      }
      const wrap = el.closest("label");
      if (wrap && wrap.textContent.trim()) return { name: wrap.textContent.replace(/\s+/g, " ").trim(), from: "wrapping-label" };
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (tag === "input" && (type === "button" || type === "submit" || type === "reset")) {
        const v = el.getAttribute("value");
        if (v && v.trim()) return { name: v.trim(), from: "value" };
      }
    }
    // 4. title
    const t = el.getAttribute("title");
    if (t && t.trim()) return { name: t.trim(), from: "title" };
    // 5. visible text content (for buttons/links/etc.)
    if (tag !== "img" && tag !== "input" && tag !== "select" && tag !== "textarea") {
      const vt = visibleText(el);
      if (vt) return { name: vt, from: "text" };
    }
    // 5b. placeholder is a LAST-RESORT accessible name for inputs (and a weak one)
    if (tag === "input" || tag === "textarea") {
      const ph = el.getAttribute("placeholder");
      if (ph && ph.trim()) return { name: ph.trim(), from: "placeholder" };
    }
    return { name: "", from: "none" };
  }

  // Is the element actually visible / part of the a11y tree right now?
  function isVisible(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("hidden")) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    // 0-size with no overflow content = not rendered. (sr-only utils are 1px;
    // we don't flag those for naming anyway since they ARE text.)
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  // Strip to the "glyph core" — remove whitespace and standard latin letters/
  // digits/common punctuation; what remains is symbol/emoji content. If after
  // removing emoji+symbols the string is empty, the visible label is icon-only.
  // Emoji-aware: use \p{Extended_Pictographic} and symbol categories.
  const EMOJI_SYMBOL_RE = /[\p{Extended_Pictographic}←-⇿⌀-➿⬀-⯿️‍⃣×•·…–—‹›«»]/gu;
  function isIconOnly(text) {
    if (!text) return true; // empty visible label
    // Remove emoji/symbol glyphs and whitespace; if nothing alphanumeric remains.
    const stripped = text.replace(EMOJI_SYMBOL_RE, "").replace(/\s+/g, "");
    return !/[a-zA-Z0-9]/.test(stripped);
  }
  function leadingGlyph(text) {
    const m = (text || "").match(EMOJI_SYMBOL_RE);
    return m ? m.slice(0, 3).join("") : (text || "").slice(0, 4);
  }

  // Intent guess from id / class / nearby attributes for icon-only controls.
  function guessIntent(el) {
    const hay = ((el.id || "") + " " + (el.getAttribute("class") || "") + " " +
      (el.getAttribute("onclick") || "") + " " + (el.getAttribute("title") || "")).toLowerCase();
    const map = [
      [/close|dismiss|×|^x$|sim-many-close|modal-close/, "Close"],
      [/play\b|playbtn/, "Play"],
      [/pause/, "Pause"],
      [/next.*play|nextplay/, "Next play"],
      [/end.*qtr|endqtr/, "Sim to end of quarter"],
      [/end.*half|endhalf/, "Sim to halftime"],
      [/endbtn|end\b/, "Sim to end of game"],
      [/return|back|◀/, "Back"],
      [/replay|↻|rewind/, "Replay"],
      [/sim|simulate|⚡/, "Simulate"],
      [/tactical/, "Tactical view"],
      [/cinema/, "Cinema view"],
      [/prev|◀|‹|←/, "Previous"],
      [/forward|fwd|⏭|›|→/, "Next"],
      [/edit|✎|pencil/, "Edit"],
      [/delete|trash|🗑/, "Delete"],
      [/cut|✂|release/, "Cut player"],
      [/expand|chevron|▾|▼|▸|►/, "Expand"],
      [/collapse|▴|▲/, "Collapse"],
    ];
    for (const [re, label] of map) if (re.test(hay)) return label;
    return null;
  }

  const findings = [];
  const add = (f) => findings.push(f);

  // --- IMAGES ---
  document.querySelectorAll('img, [role="img"]').forEach(el => {
    if (!isVisible(el)) return;
    const an = accName(el);
    if (an.from === "alt-empty-decorative") return; // alt="" = intentional, OK
    if (!an.name) {
      add({
        category: "IMAGES",
        selector: cssPath(el),
        tag: el.nodeName.toLowerCase(),
        glyph: el.getAttribute("src") ? "(img src=" + String(el.getAttribute("src")).slice(0, 40) + ")" : "(role=img)",
        suggestedName: el.getAttribute("src") ? "Describe the image" : "Describe the icon",
        nameFrom: an.from,
      });
    }
  });

  // --- ICON-ONLY BUTTONS / LINKS / INTERACTIVE ---
  const interactiveSel = 'button, a[href], [role="button"], [role="tab"], [role="link"], [onclick]';
  const seen = new Set();
  document.querySelectorAll(interactiveSel).forEach(el => {
    if (seen.has(el)) return; seen.add(el);
    if (!isVisible(el)) return;
    const tag = el.nodeName.toLowerCase();
    // skip form controls handled in FORM bucket
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    const an = accName(el);
    const visText = visibleText(el);
    const iconOnly = isIconOnly(visText);
    // It's a defect only if the visible label is icon-only AND there's no
    // programmatic name (aria-label / aria-labelledby / title).
    const hasProgName = ["aria-label", "aria-labelledby", "title"].includes(an.from);
    if (iconOnly && !hasProgName) {
      add({
        category: "ICON_BTN",
        selector: cssPath(el),
        tag,
        glyph: leadingGlyph(visText) || "(empty)",
        visibleText: visText.slice(0, 30),
        suggestedName: guessIntent(el) || "Describe the action",
        nameFrom: an.from,
      });
    } else if (!hasProgName && visText && visText.length <= 48 &&
               (tag === "button" || tag === "a" ||
                ["button", "tab", "link"].includes((el.getAttribute("role") || "").toLowerCase())) &&
               EMOJI_SYMBOL_RE.test(visText) && (visText.codePointAt(0) > 0x2000)) {
      EMOJI_SYMBOL_RE.lastIndex = 0; // reset the /g regex
      // Has a real text label, but it LEADS with an emoji/symbol glyph and there
      // is no aria-label to override it — a screen reader announces the glyph
      // literally (e.g. "black right-pointing triangle Play"). Informational:
      // the control IS named, but the name is noisy. Fix = add a clean aria-label.
      // Scoped to true single-line controls (≤48 chars, real button/link roles)
      // so rich multi-line composite buttons / data rows aren't false-flagged.
      const lead = leadingGlyph(visText);
      add({
        category: "ICON_PREFIX",
        selector: cssPath(el),
        tag,
        glyph: lead,
        visibleText: visText.slice(0, 30),
        suggestedName: visText.replace(EMOJI_SYMBOL_RE, "").replace(/\s+/g, " ").trim() || (guessIntent(el) || "Describe the action"),
        nameFrom: an.from,
      });
      EMOJI_SYMBOL_RE.lastIndex = 0;
    }
    EMOJI_SYMBOL_RE.lastIndex = 0;
  });

  // --- FORMS ---
  document.querySelectorAll("input, select, textarea").forEach(el => {
    if (!isVisible(el)) return;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "hidden") return;
    const an = accName(el);
    // Strong name: a real label / aria association. Weak name: title or
    // placeholder only (tooltip-grade; not announced consistently by SRs, and
    // placeholder disappears on input). No name: nothing at all.
    const strong = ["aria-label", "aria-labelledby", "label[for]", "wrapping-label"].includes(an.from);
    if (!strong) {
      const weak = an.from === "title" || an.from === "placeholder";
      add({
        category: "FORM",
        selector: cssPath(el),
        tag: el.nodeName.toLowerCase(),
        glyph: type ? `type=${type}` : (el.nodeName.toLowerCase() === "select" ? "select" : ""),
        visibleText: weak ? `(${an.from}: "${an.name.slice(0, 30)}")` : "(no name)",
        severity: weak ? "weak-name" : "no-name",
        suggestedName: weak
          ? `Promote the ${an.from} to a real label[for] / aria-label ("${an.name.slice(0, 30)}")`
          : "Label this field (label[for] or aria-label)",
        nameFrom: an.from,
      });
    }
  });

  // --- STATUS / LIVE candidates (heuristic; reported for review) ---
  // Elements whose id/class suggests text that UPDATES WITHOUT a user action
  // (score, game clock, status spans, toasts, spinners, "saving"/progress) and
  // that lack a live-region role. Scoped to genuinely dynamic hints — static
  // identity banners (team name/sub) are excluded so the list stays actionable.
  const liveHints = /\bscore\b|gamescore|game-?clock|playclock|\bclock\b|\btimer\b|countdown|toast|snackbar|spinner|loading|saving|sim-?progress|simstatus|h2h-status|speedlabel|notif|\balert\b|live-region/i;
  const liveSeen = new Set();
  document.querySelectorAll('[id], [class]').forEach(el => {
    if (liveSeen.has(el)) return;
    if (!isVisible(el)) return;
    const idc = (el.id || "") + " " + (el.getAttribute("class") || "");
    if (!liveHints.test(idc)) return;
    // already a live region?
    const role = (el.getAttribute("role") || "").toLowerCase();
    const live = (el.getAttribute("aria-live") || "").toLowerCase();
    if (role === "status" || role === "alert" || live === "polite" || live === "assertive") return;
    // skip if an ancestor already declares a live region (avoid double-reporting)
    if (el.closest('[aria-live], [role="status"], [role="alert"]')) return;
    // must have text content (or be a known text holder)
    const txt = visibleText(el);
    if (!txt && !/spinner|loading|progress/i.test(idc)) return;
    liveSeen.add(el);
    add({
      category: "STATUS",
      selector: cssPath(el),
      tag: el.nodeName.toLowerCase(),
      glyph: (el.id ? "#" + el.id : "." + (el.getAttribute("class") || "").split(/\s+/)[0]),
      visibleText: txt.slice(0, 40),
      suggestedName: /alert|error|toast|banner/i.test(idc) ? 'role="alert" / aria-live="assertive"' : 'role="status" / aria-live="polite"',
      nameFrom: "no-live-region",
    });
  });

  return findings;
}

// Document-level STRUCTURE checks (run once; needs page-level info).
function STRUCTURE_LIB() {
  const out = [];
  const add = (issue, detail, suggested) => out.push({
    category: "STRUCTURE", issue, detail, suggestedName: suggested,
  });
  if (!document.title || !document.title.trim()) add("missing-title", "<title> is empty", "Set a descriptive <title>");
  const lang = document.documentElement.getAttribute("lang");
  if (!lang || !lang.trim()) add("missing-lang", "<html> has no lang attribute", 'Add lang="en"');
  // landmarks
  const hasMain = document.querySelector('main, [role="main"]');
  const hasNav = document.querySelector('nav, [role="navigation"]');
  const hasHeader = document.querySelector('header, [role="banner"]');
  if (!hasMain) add("no-main-landmark", "No <main> / role=main", "Wrap primary content in <main> (or role=main)");
  if (!hasNav) add("no-nav-landmark", "No <nav> / role=navigation", "Mark the tab/nav rail as <nav> (or role=navigation)");
  if (!hasHeader) add("no-header-landmark", "No <header> / role=banner", "Mark the app shell header as <header> (or role=banner)");
  // skip link
  const skip = [...document.querySelectorAll('a[href^="#"]')].some(a => /skip|main content/i.test(a.textContent || ""));
  if (!skip) add("no-skip-link", "No skip-to-content link", 'Add a visually-hidden "Skip to main content" link as the first focusable element');
  // headings
  const h1s = document.querySelectorAll("h1");
  if (h1s.length === 0) add("no-h1", "No <h1> on the page", "Add a single <h1> naming the screen");
  else if (h1s.length > 1) add("multiple-h1", h1s.length + " <h1> elements", "Use exactly one <h1>; demote others to <h2>+");
  // heading-order jumps
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => ({
    level: Number(h.nodeName[1]), text: (h.textContent || "").trim().slice(0, 40),
  }));
  let prev = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) {
      add("heading-jump", `jump h${prev} → h${h.level} ("${h.text}")`, `Insert an h${prev + 1} or downgrade to keep the outline contiguous`);
    }
    prev = h.level;
  }
  return { issues: out, headingCount: headings.length, h1Count: h1s.length };
}

// ---------------------------------------------------------------------------
// SELF-TEST: verify the accessible-name core in isolation (no server needed).
// ---------------------------------------------------------------------------
async function selftest() {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.evaluate(`(${PAGE_LIB.toString()})`); // ensure it parses in-page
  const res = await page.evaluate((libSrc) => {
    // mount a controlled fixture
    const fix = document.createElement("div");
    fix.id = "__a11y_selftest__";
    const IMG = 'style="width:32px;height:32px;display:inline-block" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2732%27 height=%2732%27%3E%3C/svg%3E"';
    fix.innerHTML = [
      '<button id="t_labeled">Save Roster</button>',                              // PASS (text)
      '<button id="t_bareX">×</button>',                                          // FAIL icon-only
      '<button id="t_aria" aria-label="Close dialog">×</button>',                 // PASS (aria-label)
      '<button id="t_title" title="Play">▶</button>',                            // PASS (title)
      `<img id="t_imgnoalt" ${IMG}>`,                                             // FAIL no alt
      `<img id="t_imgalt" ${IMG} alt="Team logo">`,                              // PASS alt
      `<img id="t_imgdeco" ${IMG} alt="">`,                                       // OK decorative
      '<input id="t_input_nolabel" type="text">',                                // FAIL no label
      '<label for="t_input_lab">Name</label><input id="t_input_lab" type="text">',// PASS label[for]
      '<select id="t_select_aria" aria-label="Home team"></select>',             // PASS aria-label
    ].join("");
    document.body.appendChild(fix);
    const lib = eval("(" + libSrc + ")");
    const findings = lib().filter(f => (f.selector || "").includes("__a11y_selftest__") ||
      ["t_bareX", "t_imgnoalt", "t_input_nolabel"].some(id => (f.selector || "").includes(id)));
    fix.remove();
    return findings;
  }, PAGE_LIB.toString());

  // Assert expectations
  const flagged = new Set(res.map(f => (f.selector.match(/#(t_[a-z_]+)/) || [])[1]).filter(Boolean));
  const checks = [
    ["labeled button passes (not flagged)", !flagged.has("t_labeled")],
    ["bare × button FAILS (flagged ICON_BTN)", res.some(f => f.selector.includes("t_bareX") && f.category === "ICON_BTN")],
    ["aria-label button passes", !flagged.has("t_aria")],
    ["title button passes", !flagged.has("t_title")],
    ["img without alt FAILS (flagged IMAGES)", res.some(f => f.selector.includes("t_imgnoalt") && f.category === "IMAGES")],
    ["img with alt passes", !flagged.has("t_imgalt")],
    ["decorative alt=\"\" img passes", !flagged.has("t_imgdeco")],
    ["input without label FAILS (flagged FORM)", res.some(f => f.selector.includes("t_input_nolabel") && f.category === "FORM")],
    ["input with label[for] passes", !flagged.has("t_input_lab")],
    ["select with aria-label passes", !flagged.has("t_select_aria")],
  ];
  let pass = 0, fail = 0;
  console.log("— accessible-name core self-test —");
  for (const [label, cond] of checks) {
    if (cond) { pass++; console.log("  ✓ " + label); }
    else { fail++; console.log("  ✗ FAIL " + label); }
  }
  await browser.close();
  console.log(`\nSELFTEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------------------
// MAIN: drive the core screens, scan each, aggregate.
// ---------------------------------------------------------------------------
async function main() {
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch {}
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1600));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("dialog", d => d.accept());
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  const libSrc = PAGE_LIB.toString();
  const allFindings = [];
  const screensScanned = [];

  // helper: scan current DOM under a screen label, dedup by selector+category
  async function scan(screen) {
    try {
      const f = await page.evaluate((src) => eval("(" + src + ")")(), libSrc);
      f.forEach(x => { x.screen = screen; allFindings.push(x); });
      screensScanned.push({ screen, count: f.length });
    } catch (e) {
      screensScanned.push({ screen, error: String(e.message).slice(0, 100) });
    }
  }

  // Drive core paths. Each is wrapped so a failure on one screen doesn't abort.
  async function step(label, fn) {
    try { await fn(); await page.waitForTimeout(500); }
    catch (e) { console.error(`  ! step "${label}" error: ${String(e.message).slice(0, 120)}`); }
  }

  // 0. Start screen (as loaded — play.html default chrome + start screen)
  await step("start-screen render", () => page.evaluate(() => {
    if (typeof renderFrnStartScreen === "function") renderFrnStartScreen();
  }));
  await scan("start-screen");

  // testing/dev panel (icon buttons + selects live here)
  await step("dev tools panel", () => page.evaluate(() => {
    const t = document.getElementById("testingPanel"); if (t) t.style.display = "block";
    const f = document.getElementById("franchiseHome"); if (f) f.style.display = "none";
  }));
  await scan("dev-tools-panel");

  // sim-many results modal (legacy chrome — has the bare × close button)
  await step("sim-many modal", () => page.evaluate(() => {
    const m = document.getElementById("simManyModal"); if (m) m.style.display = "";
  }));
  await scan("sim-many-modal");
  await step("close sim-many", () => page.evaluate(() => {
    const m = document.getElementById("simManyModal"); if (m) m.style.display = "none";
  }));

  // playback controls + floating return button (static live-game chrome)
  await step("playback chrome", () => page.evaluate(() => {
    const c = document.getElementById("playbackControls"); if (c) c.style.display = "";
    const vt = document.querySelector(".view-toggle"); if (vt) vt.style.display = "";
    const rb = document.querySelector(".frn-return-btn"); if (rb) rb.style.display = "";
  }));
  await scan("playback-chrome");
  await step("hide playback chrome", () => page.evaluate(() => {
    const c = document.getElementById("playbackControls"); if (c) c.style.display = "none";
    const rb = document.querySelector(".frn-return-btn"); if (rb) rb.style.display = "none";
  }));

  await step("restore home", () => page.evaluate(() => {
    const t = document.getElementById("testingPanel"); if (t) t.style.display = "none";
    const f = document.getElementById("franchiseHome"); if (f) f.style.display = "";
  }));

  // 1. Start a franchise → dashboard
  await step("startFranchise(1)", () => page.evaluate(() => startFranchise(1)));
  await scan("dashboard-default");

  // 2. Tabs
  for (const tab of ["overview", "roster", "frontoffice", "league", "replays"]) {
    await step(`frnSetTab('${tab}')`, () => page.evaluate((t) => frnSetTab(t), tab));
    await scan(`tab-${tab}`);
  }

  // 3. Roster action — open a player card if a row is present
  await step("open player card", () => page.evaluate(() => {
    frnSetTab("roster");
    const row = document.querySelector('[onclick*="PlayerCard"], [onclick*="playerCard"], .frn-roster-row, [data-player]');
    if (row && typeof row.click === "function") row.click();
  }));
  await scan("roster-player-card");

  // 4. Play a game (interactive live screen) — playback controls + canvas chrome
  await step("enter live game", () => page.evaluate(() => {
    const ids = TEAMS.map(t => t.id);
    const me = (typeof franchise !== "undefined" && franchise.chosenTeamId) || ids[0];
    const opp = ids.find(i => i !== me) || ids[1];
    if (typeof _frnEnterLiveGameScreen === "function") _frnEnterLiveGameScreen(me, opp, false);
  }));
  await scan("live-game-screen");

  // 5. A modal (DS.modal)
  await step("open DS.modal", () => page.evaluate(() => {
    if (window.DS && typeof DS.modal === "function") {
      DS.modal({ title: "Confirm", body: "Proceed with this action?" });
    }
  }));
  await scan("ds-modal");
  await step("close modal", () => page.keyboard.press("Escape"));

  // STRUCTURE (document-level, scan on the dashboard which is the main app shell)
  await step("structure scan setup", () => page.evaluate(() => {
    const m = document.getElementById("simManyModal"); if (m) m.style.display = "none";
  }));
  const structure = await page.evaluate((src) => eval("(" + src + ")")(), STRUCTURE_LIB.toString());
  structure.issues.forEach(i => { i.screen = "document"; allFindings.push(i); });

  await browser.close();

  // ----- AGGREGATE / DEDUP -----
  // Dedup by category + selector (same control appears across many tab scans).
  const byKey = new Map();
  for (const f of allFindings) {
    const key = (f.category || "") + "|" + (f.selector || f.issue || JSON.stringify(f));
    if (!byKey.has(key)) byKey.set(key, { ...f, screens: new Set() });
    byKey.get(key).screens.add(f.screen);
  }
  const findings = [...byKey.values()].map(f => ({ ...f, screens: [...f.screens] }));

  const counts = {};
  for (const f of findings) counts[f.category] = (counts[f.category] || 0) + 1;

  // ----- REPORT -----
  console.log("\n========================================");
  console.log(" A11Y SEMANTICS PROBE — SUMMARY");
  console.log("========================================");
  console.log("Screens scanned:");
  screensScanned.forEach(s => console.log(`  · ${s.screen}: ${s.error ? "ERR " + s.error : s.count + " raw findings"}`));
  if (pageErrors.length) {
    console.log(`\nPAGE ERRORS (${pageErrors.length}):`);
    [...new Set(pageErrors)].slice(0, 5).forEach(e => console.log("  ! " + e));
  }
  console.log(`\nUNIQUE FINDINGS BY CATEGORY (${findings.length} total):`);
  const order = ["ICON_BTN", "ICON_PREFIX", "FORM", "IMAGES", "STATUS", "STRUCTURE"];
  for (const cat of order) console.log(`  ${cat.padEnd(12)} ${counts[cat] || 0}`);
  console.log("  (ICON_PREFIX = named control whose label LEADS with an emoji/symbol → SR reads the glyph literally; add a clean aria-label.)");

  const topN = (cat, n) => findings.filter(f => f.category === cat).slice(0, n);
  function printExamples(cat, n) {
    const ex = topN(cat, n);
    if (!ex.length) return;
    console.log(`\n— ${cat} (top ${ex.length}) —`);
    for (const f of ex) {
      if (cat === "STRUCTURE") {
        console.log(`  • ${f.issue}: ${f.detail}  → ${f.suggestedName}`);
      } else {
        const g = f.glyph ? `[${f.glyph}] ` : "";
        console.log(`  • ${g}${f.selector}`);
        console.log(`      from=${f.nameFrom}  suggest aria-label="${f.suggestedName}"`);
      }
    }
  }
  printExamples("ICON_BTN", 15);
  printExamples("ICON_PREFIX", 20);
  printExamples("FORM", 12);
  printExamples("IMAGES", 8);
  printExamples("STATUS", 12);
  printExamples("STRUCTURE", 20);

  // ----- JSON DUMP -----
  const payload = { generatedAt: new Date().toISOString(), counts, total: findings.length,
    screensScanned, structureMeta: { headingCount: structure.headingCount, h1Count: structure.h1Count },
    pageErrors: [...new Set(pageErrors)], findings };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`\nFull JSON findings → ${OUT_FILE}`);
  if (ARG_JSON) console.log("\n" + JSON.stringify(payload, null, 2));

  process.exit(0);
}

(ARG_SELFTEST ? selftest() : main()).catch(e => {
  console.error("PROBE CRASH:", e);
  process.exit(2);
});
