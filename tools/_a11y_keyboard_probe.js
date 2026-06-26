// _a11y_keyboard_probe.js — Keyboard operability + focus-state audit (A2).
// ---------------------------------------------------------------------------
// A reusable headless probe for the franchise UI's KEYBOARD accessibility.
// It walks the core paths (start screen → dashboard → tabs → roster → live
// game → modal) and detects, per WCAG 2.1 keyboard criteria:
//
//   1. UNREACHABLE  — elements with a click handler (onclick / [data has handler])
//      that are NOT natively focusable (div / span / a-without-href / etc.) and
//      lack tabindex="0" + role="button". A keyboard user can't reach OR activate
//      them. (2.1.1 Keyboard)
//   2. NO-FOCUS-RING — focusable elements that show NO visible focus indicator
//      when focused (outline / box-shadow / border / bg all unchanged vs the
//      un-focused state). Accounts for :focus-visible by focusing via keyboard
//      semantics (we set a real focus + the :focus-visible heuristic). (2.4.7)
//   3. ACTIVATION   — native <button>s must fire on BOTH Enter and Space; tabs
//      (.frn-bb-fnkey / .ds-tab) must be reachable AND operable by keyboard.
//   4. MODAL        — DS.modal (and the legacy confirm modal if reachable):
//      focus MOVES into the modal, Tab is TRAPPED inside it, Esc closes it, and
//      focus RESTORES to the trigger element afterward. (2.4.3, 2.1.2)
//   5. POSITIVE-TABINDEX — any tabindex > 0 anywhere (tab-order anti-pattern).
//
// Determinism-neutral: read-only DOM inspection + synthetic key events; never
// touches the sim/render/canvas path. Creates no app files.
//
//   npx http-server -p 5342 -s .          # serve the game first
//   node tools/_a11y_keyboard_probe.js    # then run the probe
//   node tools/_a11y_keyboard_probe.js --json   # JSON only (machine-readable)
//
// Exit code: 0 always (this is an AUDIT, not a gate) unless it cannot run.
// ---------------------------------------------------------------------------
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);

const PORT = process.env.A11Y_PORT || 5342;
const URL = `http://localhost:${PORT}/play.html`;
const JSON_ONLY = process.argv.includes("--json");
const log = (...a) => { if (!JSON_ONLY) console.log(...a); };

// ── shared in-page helpers (installed once into the page) ───────────────────
// These run in the browser. Kept as a string so we can re-install after
// navigation if needed.
const PAGE_HELPERS = () => {
  // Build a short, stable CSS-ish path for an element (id > classes > nth-of-type).
  window.__a11yPath = function (el) {
    if (!el || el.nodeType !== 1) return "(none)";
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 6) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(seg + "#" + cur.id); break; }
      const cls = (cur.className && typeof cur.className === "string")
        ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
        : "";
      if (cls) seg += "." + cls;
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  };

  // Short selector for de-dup / human ID (tag + id + first classes).
  window.__a11ySel = function (el) {
    if (!el || el.nodeType !== 1) return "(none)";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = (el.className && typeof el.className === "string")
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".")
      : "";
    if (cls) s += "." + cls;
    return s;
  };

  // Visible (laid out) check.
  window.__a11yVisible = function (el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null) {
      // offsetParent is null for position:fixed too — fall back to rect.
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Is the element NATIVELY focusable / keyboard-operable by default?
  window.__a11yNativelyFocusable = function (el) {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") return true;
    if (tag === "INPUT") return el.type !== "hidden";
    if (tag === "A" || tag === "AREA") return el.hasAttribute("href");
    // [contenteditable] is also focusable
    if (el.isContentEditable) return true;
    return false;
  };

  // Does the element carry a click handler? (inline onclick attr, or assigned
  // .onclick, or a role=button hint). We can't see addEventListener handlers,
  // so we use onclick attribute + onclick property + cursor:pointer + role.
  window.__a11yHasClick = function (el) {
    if (el.hasAttribute && el.hasAttribute("onclick")) return true;
    if (typeof el.onclick === "function") return true;
    return false;
  };
};

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.error("Could not launch chromium:", e.message);
    process.exit(2);
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept().catch(() => {}));
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e.message).slice(0, 140)));

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  } catch (e) {
    console.error(`Could not load ${URL} — is the server running? (npx http-server -p ${PORT} -s .)`);
    console.error(e.message);
    await browser.close();
    process.exit(2);
  }
  await page.addInitScript(PAGE_HELPERS);
  await page.evaluate(PAGE_HELPERS);
  await page.waitForTimeout(600);

  // Findings accumulator.
  const findings = {
    unreachable: [],      // {sel, path, tag, reason, screen}
    noFocusRing: [],      // {sel, path, tag, screen, before, after}
    activation: [],       // {sel, path, tag, key, screen, note}
    tabsOperable: [],     // {sel, path, ok, reachable, activated}
    positiveTabindex: [], // {sel, path, tabindex, screen}
    modal: [],            // {name, focusMovesIn, tabTrapped, escCloses, focusRestores, notes:[]}
  };
  const seenUnreachable = new Set();
  const seenNoRing = new Set();
  const seenPosIdx = new Set();

  // ── Scan the CURRENT DOM for the static defects (unreachable / +tabindex) ──
  async function scanStatic(screen) {
    const res = await page.evaluate((screen) => {
      const out = { unreachable: [], positiveTabindex: [] };
      const all = [...document.querySelectorAll("*")];
      for (const el of all) {
        if (!window.__a11yVisible(el)) continue;
        // positive tabindex anti-pattern
        const ti = el.getAttribute("tabindex");
        if (ti != null && Number(ti) > 0) {
          out.positiveTabindex.push({
            sel: window.__a11ySel(el), path: window.__a11yPath(el),
            tag: el.tagName.toLowerCase(), tabindex: Number(ti), screen,
          });
        }
        // unreachable click handlers
        if (window.__a11yHasClick(el)) {
          const nativelyFocusable = window.__a11yNativelyFocusable(el);
          const hasTabindex0 = ti != null && Number(ti) >= 0;
          const role = (el.getAttribute("role") || "").toLowerCase();
          const roleButtonish = role === "button" || role === "link" || role === "tab"
            || role === "menuitem" || role === "checkbox" || role === "switch";
          // Reachable if natively focusable OR (tabindex>=0). Operable by
          // keyboard needs role too (so AT announces it + Enter/Space fire),
          // but reachability is the hard blocker.
          const reachable = nativelyFocusable || hasTabindex0;
          if (!reachable) {
            const tag = el.tagName.toLowerCase();
            let reason;
            if (tag === "a" && !el.hasAttribute("href")) reason = "<a> without href (not focusable)";
            else if (tag === "div" || tag === "span") reason = `<${tag}> with onclick, no tabindex/role`;
            else reason = `<${tag}> with click handler, not focusable, no tabindex`;
            out.unreachable.push({
              sel: window.__a11ySel(el), path: window.__a11yPath(el), tag,
              role: role || null, reason, screen,
              text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
              missingRole: !roleButtonish,
            });
          }
        }
      }
      return out;
    }, screen);

    for (const u of res.unreachable) {
      const key = u.sel + "|" + u.text;
      if (seenUnreachable.has(key)) continue;
      seenUnreachable.add(key);
      findings.unreachable.push(u);
    }
    for (const p of res.positiveTabindex) {
      const key = p.sel + "|" + p.tabindex;
      if (seenPosIdx.has(key)) continue;
      seenPosIdx.add(key);
      findings.positiveTabindex.push(p);
    }
  }

  // ── Visible focus indicator: TAB through the live DOM and check each stop ───
  // Programmatic .focus() does NOT trigger :focus-visible in Chromium, and
  // :focus-visible is exactly how the app gates its focus rings — so we drive
  // REAL keyboard Tab navigation (which sets the focus-visible heuristic) and,
  // for each focused element, measure whether ANY visible indicator is present
  // (outline width>0, a box-shadow, or a border/bg delta vs its blurred state).
  // An element that matches :focus-visible but shows nothing = a keyboard user
  // can't see where they are = a defect.
  async function scanFocusRing(screen, maxStops = 90) {
    // Reset focus to the top of the page.
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.keyboard.press("Tab"); // first stop
    let firstSig = null;
    for (let stop = 0; stop < maxStops; stop++) {
      const data = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return { body: true };
        const sig = (el.id || "") + "|" + (el.className && typeof el.className === "string" ? el.className : "") + "|" + el.tagName;
        // Measure FOCUSED (keyboard) styles.
        const sf = getComputedStyle(el);
        let fv = false; try { fv = el.matches(":focus-visible"); } catch (e) {}
        const focused = {
          outlineWidth: parseFloat(sf.outlineWidth) || 0,
          outlineStyle: sf.outlineStyle,
          outline: sf.outlineStyle + " " + sf.outlineWidth + " " + sf.outlineColor,
          boxShadow: sf.boxShadow,
          border: sf.borderTopWidth + " " + sf.borderTopStyle + " " + sf.borderTopColor
            + "/" + sf.borderBottomColor + "/" + sf.borderLeftColor + "/" + sf.borderRightColor,
          bg: sf.backgroundColor,
        };
        return {
          sig, fv, focused,
          info: { sel: window.__a11ySel(el), path: window.__a11yPath(el), tag: el.tagName.toLowerCase() },
          // a stable marker so we can blur+measure the un-focused state
          mark: (el.setAttribute("data-a11yfr", "1"), true),
        };
      });
      if (data && data.body) {
        // hit body; advance once more in case of a transient gap
        await page.keyboard.press("Tab");
        continue;
      }
      if (!data) { await page.keyboard.press("Tab"); continue; }
      // Detect a full cycle (wrapped back to the first element).
      if (firstSig === null) firstSig = data.sig;
      else if (data.sig === firstSig && stop > 3) break;

      // Measure the BLURRED baseline for the same element to get a delta.
      const baseline = await page.evaluate(() => {
        const el = document.querySelector('[data-a11yfr="1"]');
        if (!el) return null;
        el.blur();
        const sb = getComputedStyle(el);
        const out = {
          outline: sb.outlineStyle + " " + sb.outlineWidth + " " + sb.outlineColor,
          boxShadow: sb.boxShadow,
          border: sb.borderTopWidth + " " + sb.borderTopStyle + " " + sb.borderTopColor
            + "/" + sb.borderBottomColor + "/" + sb.borderLeftColor + "/" + sb.borderRightColor,
          bg: sb.backgroundColor,
        };
        el.removeAttribute("data-a11yfr");
        return out;
      });

      const f = data.focused;
      const hasOutline = f.outlineWidth > 0 && f.outlineStyle !== "none";
      const shadowVisible = f.boxShadow && f.boxShadow !== "none"
        && (!baseline || f.boxShadow !== baseline.boxShadow);
      const borderChanged = baseline && f.border !== baseline.border;
      const bgChanged = baseline && f.bg !== baseline.bg;
      const visibleIndicator = hasOutline || shadowVisible || borderChanged || bgChanged;

      // Only flag elements that DO take focus-visible (keyboard focus) yet show
      // nothing — that's the real keyboard-user defect. (If fv is false the
      // element wasn't keyboard-focused this stop; skip rather than false-flag.)
      if (data.fv && !visibleIndicator) {
        const key = data.info.sel + "|" + screen;
        if (!seenNoRing.has(key)) {
          seenNoRing.add(key);
          findings.noFocusRing.push({
            ...data.info, screen,
            after: { outline: f.outline, boxShadow: f.boxShadow },
            note: ":focus-visible matched on keyboard focus but no outline/box-shadow/border/bg indicator",
          });
        }
      }
      await page.keyboard.press("Tab");
    }
    // tidy any stray marker
    await page.evaluate(() => document.querySelector('[data-a11yfr="1"]')?.removeAttribute("data-a11yfr"));
  }

  // ── Button activation: Enter AND Space fire a handler ──────────────────────
  // We pick a few representative real buttons and verify their onclick fires
  // for both keys. We instrument by wrapping each candidate's onclick.
  async function scanActivation(screen, limit = 8) {
    const cands = await page.evaluate((limit) => {
      const btns = [...document.querySelectorAll("button")]
        .filter(el => window.__a11yVisible(el) && !el.disabled);
      // sample variety by class signature
      const bySig = new Map();
      for (const b of btns) {
        const sig = (b.className && typeof b.className === "string")
          ? b.className.trim().split(/\s+/).slice(0, 2).join(".") : (b.id || "btn");
        if (!bySig.has(sig)) bySig.set(sig, b);
      }
      const picked = [...bySig.values()].slice(0, limit);
      picked.forEach((b, i) => b.setAttribute("data-a11yact", String(i)));
      return picked.map((b, i) => ({
        i, sel: window.__a11ySel(b), path: window.__a11yPath(b),
        hasInline: b.hasAttribute("onclick"),
      }));
    }, limit);

    for (const c of cands) {
      const sel = `[data-a11yact="${c.i}"]`;
      // instrument: count clicks via a flag we set in the page
      const setup = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.__a11yEnter = 0; el.__a11ySpace = 0;
        // count real click events (Enter/Space on a button both dispatch click)
        el.__a11yClickHandler = () => { el.__a11yClicks = (el.__a11yClicks || 0) + 1; };
        el.addEventListener("click", el.__a11yClickHandler, true);
        return true;
      }, sel);
      if (!setup) continue;

      // pressKey: focus the candidate, fire `key`, and report whether it
      // activated. CRUCIAL: pressing Enter on a NAV button re-renders/replaces
      // the DOM — if the element is GONE afterward, the key plainly activated
      // it (it navigated), so that counts as fired (avoids a false negative).
      const pressKey = async (key) => {
        const ready = await page.evaluate((sel) => {
          const e = document.querySelector(sel);
          if (!e) return false;
          e.__a11yClicks = 0; e.focus();
          return document.activeElement === e;
        }, sel);
        if (!ready) return { fired: null, vanished: true };
        await page.keyboard.press(key);
        await page.waitForTimeout(50);
        const r = await page.evaluate((sel) => {
          const e = document.querySelector(sel);
          return { present: !!e, clicks: e ? (e.__a11yClicks || 0) : 0 };
        }, sel);
        // dismiss any opened modal/alert so the page is clean for the next test
        const modalUp = await page.evaluate(() =>
          !!document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop"));
        if (modalUp) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(40); }
        return { fired: r.clicks > 0 || !r.present, vanished: !r.present };
      };

      const enter = await pressKey("Enter");
      // re-instrument for Space (element may have been re-created identical)
      await page.evaluate((sel) => {
        const e = document.querySelector(sel);
        if (e && !e.__a11yClickHandler) {
          e.__a11yClickHandler = () => { e.__a11yClicks = (e.__a11yClicks || 0) + 1; };
          e.addEventListener("click", e.__a11yClickHandler, true);
        }
      }, sel);
      const space = await pressKey("Space");

      const enterFired = enter.fired === true || enter.fired === null;
      const spaceFired = space.fired === true || space.fired === null;
      // Only a CONFIRMED non-fire (element present, 0 clicks) is a defect.
      const enterBad = enter.fired === false;
      const spaceBad = space.fired === false;
      if (enterBad || spaceBad) {
        findings.activation.push({
          sel: c.sel, path: c.path, tag: "button", screen,
          enter: enterFired, space: spaceFired,
          note: (enterBad ? "Enter did not activate" : "") +
                (enterBad && spaceBad ? "; " : "") +
                (spaceBad ? "Space did not activate" : ""),
        });
      }
      await page.evaluate((sel) => {
        const e = document.querySelector(sel);
        if (e) { if (e.__a11yClickHandler) e.removeEventListener("click", e.__a11yClickHandler, true); e.removeAttribute("data-a11yact"); }
      }, sel);
    }
  }

  // ── Tabs reachable + operable by keyboard ──────────────────────────────────
  async function scanTabs(screen) {
    const tabSel = ".frn-bb-fnkey, .ds-tab, [role=tab]";
    const tabs = await page.evaluate((tabSel) => {
      const els = [...document.querySelectorAll(tabSel)].filter(el => window.__a11yVisible(el));
      return els.slice(0, 6).map((el, i) => {
        el.setAttribute("data-a11ytab", String(i));
        const ti = el.getAttribute("tabindex");
        return {
          i, sel: window.__a11ySel(el), path: window.__a11yPath(el),
          tag: el.tagName.toLowerCase(),
          nativelyFocusable: window.__a11yNativelyFocusable(el),
          hasTabindex0: ti != null && Number(ti) >= 0,
          role: el.getAttribute("role") || null,
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24),
        };
      });
    }, tabSel);

    for (const t of tabs) {
      const sel = `[data-a11ytab="${t.i}"]`;
      const reachable = t.nativelyFocusable || t.hasTabindex0;
      let activated = null;
      if (reachable) {
        // try Enter activation: did the tab change active state / fire?
        const setup = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.__a11yClicks = 0;
          el.__h = () => { el.__a11yClicks++; };
          el.addEventListener("click", el.__h, true);
          el.focus();
          return document.activeElement === el;
        }, sel);
        if (setup) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(60);
          activated = await page.evaluate((sel) => (document.querySelector(sel)?.__a11yClicks || 0) > 0, sel);
        } else {
          activated = false;
        }
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el && el.__h) el.removeEventListener("click", el.__h, true);
        }, sel);
      }
      findings.tabsOperable.push({
        sel: t.sel, path: t.path, tag: t.tag, screen, text: t.text,
        reachable, role: t.role,
        nativelyFocusable: t.nativelyFocusable, hasTabindex0: t.hasTabindex0,
        activated,
        ok: reachable && activated !== false,
      });
      await page.evaluate((sel) => document.querySelector(sel)?.removeAttribute("data-a11ytab"), sel);
    }
  }

  // ── MODAL: focus moves in, Tab trapped, Esc closes, focus restored ─────────
  async function probeModal(name, openExpr, closeIsEsc = true) {
    const r = { name, opened: false, focusMovesIn: null, tabTrapped: null,
                escCloses: null, focusRestores: null, notes: [] };

    // Create + focus a known trigger element so we can verify focus restore.
    await page.evaluate(() => {
      let t = document.getElementById("__a11yTrigger");
      if (!t) {
        t = document.createElement("button");
        t.id = "__a11yTrigger";
        t.textContent = "trigger";
        t.style.cssText = "position:fixed;left:8px;top:8px;z-index:1";
        document.body.appendChild(t);
      }
      t.focus();
    });
    const triggerFocused = await page.evaluate(() => document.activeElement?.id === "__a11yTrigger");
    if (!triggerFocused) r.notes.push("could not focus a baseline trigger element");

    // Open the modal.
    try {
      await page.evaluate((expr) => { window.__a11yModalP = eval(expr); }, openExpr);
    } catch (e) {
      r.notes.push("open expression threw: " + e.message);
      findings.modal.push(r);
      return r;
    }
    await page.waitForTimeout(120);

    const modalState = await page.evaluate(() => {
      const m = document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop");
      if (!m) return { present: false };
      const focusables = [...m.querySelectorAll(
        'button, a[href], select, textarea, input:not([type=hidden]), [tabindex]'
      )].filter(el => el.offsetParent !== null || el.getBoundingClientRect().width > 0);
      return {
        present: true,
        cls: m.className,
        focusInside: m.contains(document.activeElement),
        active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
        focusableCount: focusables.length,
        firstSel: focusables[0] ? (focusables[0].className || focusables[0].tagName) : null,
        lastSel: focusables[focusables.length - 1] ? (focusables[focusables.length - 1].className || focusables[focusables.length - 1].tagName) : null,
      };
    });

    if (!modalState.present) {
      r.notes.push("modal did not appear after open");
      findings.modal.push(r);
      return r;
    }
    r.opened = true;
    r.focusMovesIn = modalState.focusInside;
    if (!modalState.focusInside) {
      r.notes.push(`focus did NOT move into the modal (activeElement=${modalState.active})`);
    } else {
      r.notes.push(`focus moved into modal (activeElement=${modalState.active}); ${modalState.focusableCount} focusable inside`);
    }

    // TAB TRAP: Tab through more times than there are focusables; focus must
    // stay inside the modal (never escape to body / page chrome behind it).
    const trapSteps = Math.max(6, (modalState.focusableCount || 2) + 3);
    let escaped = false;
    let outsideAt = -1;
    for (let i = 0; i < trapSteps; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(15);
      const inside = await page.evaluate(() => {
        const m = document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop");
        if (!m) return null;
        const a = document.activeElement;
        return { inside: m.contains(a), tag: a ? (a.className || a.tagName) : "(body)" };
      });
      if (inside === null) break;
      if (!inside.inside) { escaped = true; outsideAt = i; break; }
    }
    // Also test Shift+Tab from the first element (should wrap to last, not escape).
    if (!escaped) {
      await page.evaluate(() => {
        const m = document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop");
        const f = m && m.querySelector('button, a[href], select, textarea, input:not([type=hidden]), [tabindex]');
        f && f.focus();
      });
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(15);
      const afterShift = await page.evaluate(() => {
        const m = document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop");
        const a = document.activeElement;
        return m ? m.contains(a) : null;
      });
      if (afterShift === false) { escaped = true; outsideAt = -2; }
    }
    r.tabTrapped = !escaped;
    if (escaped) {
      r.notes.push(outsideAt === -2
        ? "Shift+Tab from first element ESCAPED the modal (no wrap)"
        : `Tab escaped the modal to page content behind it (after ${outsideAt + 1} tab(s))`);
    } else {
      r.notes.push("Tab stayed within the modal");
    }

    // ESC closes.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    const stillOpen = await page.evaluate(() =>
      !!document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop"));
    r.escCloses = !stillOpen;
    if (stillOpen) {
      r.notes.push("Esc did NOT close the modal");
      // force-close so the page is usable for the next probe
      await page.evaluate(() => {
        const m = document.querySelector(".ds-modal-backdrop, .frn-modal-backdrop");
        m && m.remove();
      });
    } else {
      r.notes.push("Esc closed the modal");
    }

    // FOCUS RESTORE: after close, focus should return to the trigger.
    await page.waitForTimeout(40);
    const restored = await page.evaluate(() => document.activeElement?.id === "__a11yTrigger");
    r.focusRestores = restored;
    r.notes.push(restored
      ? "focus restored to the trigger element"
      : "focus NOT restored to trigger after close (landed on " +
        (await page.evaluate(() => document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : "(none)")) + ")");

    findings.modal.push(r);
    return r;
  }

  // ===========================================================================
  // WALK THE CORE PATHS
  // ===========================================================================

  // Screen 1: Start screen (renders on load).
  log("• scanning: start-screen");
  await scanStatic("start-screen");
  await scanFocusRing("start-screen");
  await scanActivation("start-screen");

  // Screen 2: start a franchise → dashboard.
  log("• scanning: dashboard (startFranchise)");
  const started = await page.evaluate(() => {
    try {
      // seed Math.random for stable generation (determinism-neutral here)
      let s = 0xABCD;
      Math.random = function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      if (typeof startFranchise === "function") { startFranchise(1); return true; }
    } catch (e) { return "err:" + e.message; }
    return false;
  });
  log("  startFranchise →", started);
  await page.waitForTimeout(700);
  await scanStatic("dashboard");
  await scanFocusRing("dashboard");
  await scanActivation("dashboard");
  await scanTabs("dashboard");

  // Screen 3: dashboard tabs.
  for (const tab of ["roster", "frontoffice", "league", "replays", "overview"]) {
    const ok = await page.evaluate((t) => {
      try { if (typeof frnSetTab === "function") { frnSetTab(t); return true; } } catch (e) { return "err:" + e.message; }
      return false;
    }, tab);
    await page.waitForTimeout(350);
    log(`  frnSetTab('${tab}') →`, ok);
    await scanStatic("tab:" + tab);
    if (tab === "roster") { await scanFocusRing("tab:roster"); await scanTabs("tab:roster"); }
  }

  // Screen 4: live game screen + playback controls. _frnEnterLiveGameScreen
  // needs team ids (it sets franchise.pendingFranchiseGame = {homeId,awayId}).
  log("• scanning: live-game (_frnEnterLiveGameScreen / playback controls)");
  const liveOk = await page.evaluate(() => {
    try {
      // earlier activation tests press Enter on chrome buttons, which can
      // exit/abandon the franchise — re-establish it so the live screen exists.
      if ((typeof franchise === "undefined" || !franchise) && typeof startFranchise === "function") {
        startFranchise(1);
      }
      if (typeof frnSetTab === "function") frnSetTab("overview");
      if (typeof _frnEnterLiveGameScreen === "function" && typeof franchise !== "undefined" && franchise) {
        _frnEnterLiveGameScreen(1, 2);
        return "enter";
      }
    } catch (e) { return "err:" + e.message; }
    return false;
  });
  await page.waitForTimeout(500);
  log("  live screen →", liveOk,
    "playbackControls visible:",
    await page.evaluate(() => { const e = document.getElementById("playbackControls"); return e ? getComputedStyle(e).display !== "none" : false; }));
  await scanStatic("live-game");
  await scanFocusRing("live-game");

  // restore the dashboard surface for the modal tests
  await page.evaluate(() => {
    try {
      const pc = document.getElementById("playbackControls"); if (pc) pc.style.display = "none";
      const fh = document.getElementById("franchiseHome"); if (fh) fh.style.display = "";
      typeof frnSetTab === "function" && frnSetTab("overview");
    } catch (e) {}
  });
  await page.waitForTimeout(300);

  // Screen 5: MODALS.
  log("• scanning: modal (DS.modal)");
  await probeModal("DS.modal",
    "DS.modal({title:'A11Y Test', body:'Body text', okLabel:'OK', cancelLabel:'Cancel'})");

  // legacy confirm modal, if available
  const hasConfirm = await page.evaluate(() => typeof _frnConfirmModal === "function");
  if (hasConfirm) {
    log("• scanning: modal (_frnConfirmModal)");
    await probeModal("_frnConfirmModal",
      "_frnConfirmModal({title:'A11Y Confirm', body:'Body', okLabel:'OK'})");
  } else {
    log("  _frnConfirmModal not reachable as a global — skipped");
  }

  // cleanup trigger
  await page.evaluate(() => document.getElementById("__a11yTrigger")?.remove());

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  const unreachableMissingRole = findings.unreachable.filter(u => u.missingRole).length;
  const tabsBad = findings.tabsOperable.filter(t => !t.ok);
  const summary = {
    unreachable: findings.unreachable.length,
    unreachable_missing_role: unreachableMissingRole,
    noFocusRing: findings.noFocusRing.length,
    activationFailures: findings.activation.length,
    tabsTested: findings.tabsOperable.length,
    tabsNotOperable: tabsBad.length,
    positiveTabindex: findings.positiveTabindex.length,
    modalsTested: findings.modal.length,
    modalDefects: findings.modal.reduce((n, m) =>
      n + (m.focusMovesIn === false ? 1 : 0) + (m.tabTrapped === false ? 1 : 0)
        + (m.escCloses === false ? 1 : 0) + (m.focusRestores === false ? 1 : 0), 0),
    pageErrors: pageErrors.length,
  };

  if (!JSON_ONLY) {
    const line = "─".repeat(64);
    console.log("\n" + line);
    console.log("  KEYBOARD + FOCUS ACCESSIBILITY PROBE — SUMMARY");
    console.log(line);
    console.log(`  UNREACHABLE click targets (not keyboard-reachable):  ${summary.unreachable}`);
    console.log(`     …also missing role=button/etc:                     ${summary.unreachable_missing_role}`);
    console.log(`  MISSING visible focus ring (sampled):                ${summary.noFocusRing}`);
    console.log(`  BUTTON Enter/Space activation failures:              ${summary.activationFailures}`);
    console.log(`  TABS tested / not keyboard-operable:                 ${summary.tabsTested} / ${summary.tabsNotOperable}`);
    console.log(`  POSITIVE tabindex (>0) anti-pattern:                 ${summary.positiveTabindex}`);
    console.log(`  MODALS tested / total modal defects:                 ${summary.modalsTested} / ${summary.modalDefects}`);
    console.log(`  page errors during walk:                             ${summary.pageErrors}`);
    console.log(line);

    if (findings.modal.length) {
      console.log("\n  MODAL DETAIL:");
      for (const m of findings.modal) {
        const flag = (v) => v === true ? "PASS" : v === false ? "FAIL" : "  ? ";
        console.log(`   ${m.name}:`);
        console.log(`     focus moves in : ${flag(m.focusMovesIn)}`);
        console.log(`     Tab trapped    : ${flag(m.tabTrapped)}`);
        console.log(`     Esc closes     : ${flag(m.escCloses)}`);
        console.log(`     focus restored : ${flag(m.focusRestores)}`);
        m.notes.forEach(n => console.log(`       - ${n}`));
      }
    }

    if (findings.unreachable.length) {
      console.log("\n  TOP UNREACHABLE CONTROLS (max 15):");
      findings.unreachable.slice(0, 15).forEach(u =>
        console.log(`   [${u.screen}] ${u.sel}  "${u.text}"  — ${u.reason}\n       ${u.path}`));
    }
    if (findings.noFocusRing.length) {
      console.log("\n  ELEMENTS WITH NO VISIBLE FOCUS RING (max 15):");
      findings.noFocusRing.slice(0, 15).forEach(f =>
        console.log(`   [${f.screen}] ${f.sel}\n       ${f.path}`));
    }
    if (findings.activation.length) {
      console.log("\n  ACTIVATION FAILURES:");
      findings.activation.forEach(a =>
        console.log(`   [${a.screen}] ${a.sel} — ${a.note}\n       ${a.path}`));
    }
    if (tabsBad.length) {
      console.log("\n  TABS NOT KEYBOARD-OPERABLE:");
      tabsBad.forEach(t =>
        console.log(`   [${t.screen}] ${t.sel} "${t.text}" — reachable=${t.reachable} activated=${t.activated} (tag=${t.tag}, role=${t.role}, tabindex0=${t.hasTabindex0})\n       ${t.path}`));
    }
    if (findings.positiveTabindex.length) {
      console.log("\n  POSITIVE TABINDEX:");
      findings.positiveTabindex.slice(0, 15).forEach(p =>
        console.log(`   [${p.screen}] ${p.sel} tabindex=${p.tabindex}\n       ${p.path}`));
    }
    console.log("\n  (full machine-readable findings below as JSON)\n");
  }

  console.log(JSON.stringify({ summary, findings, pageErrors }, null, JSON_ONLY ? 0 : 2));

  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
