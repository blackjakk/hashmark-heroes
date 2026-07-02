/* =============================================================================
 * design-system/ds.js — Hashmark Design System component factory library
 * -----------------------------------------------------------------------------
 * PURPOSE
 *   A vanilla, no-build `window.DS` namespace of component factories. Each
 *   factory returns a well-formed HTML *string* built from the `.ds-*` classes
 *   defined in design-system/ds.css (single source of truth: design-system/
 *   CONTRACT.md). A handful of helpers (DS.modal / DS.mount) touch the DOM.
 *
 * IDIOM (matches the rest of the codebase)
 *   This game is a no-framework, no-build vanilla HTML/CSS/JS app. UI is built
 *   by concatenating HTML strings and assigning to innerHTML, with behavior
 *   wired through inline `onclick="..."` expressions. DS factories produce the
 *   same kind of strings so they drop straight into existing innerHTML sites,
 *   e.g.  el.innerHTML = DS.button({label:'Save', on:"frnSave()"});
 *
 * TRUSTED vs ESCAPED ARGUMENT POLICY  (READ THIS)
 *   ESCAPED by default — every human/data-facing text field (label, title,
 *   eyebrow, value, cell text, option label, etc.) is run through DS.esc()
 *   before interpolation, so passing untrusted strings is SAFE.
 *   TRUSTED (the CALLER is responsible for safety, NOT escaped):
 *     - `on`    : inline JS expression string for onclick/handlers
 *                 (e.g. "frnSetTab('roster')"). Never pass user input here.
 *     - `attrs` : extra attribute pairs — keys/values ARE escaped by DS.attrs,
 *                 but you control which attributes exist; do not inject events
 *                 sourced from user data.
 *     - `class` / `cls` : extra CSS class(es) merged AFTER the ds-* classes (e.g.
 *                 a JS-queried hook class or a legacy class kept for visual parity).
 *                 Trusted (pass class names only, not user data).
 *     - `body`  : raw HTML body (card/modal/banner) and `cells` rows that you
 *                 pass as pre-built HTML strings (e.g. nested DS.* output).
 *                 These are inserted verbatim — escape their contents yourself
 *                 (typically by composing them from other DS factories).
 *   DS.esc delegates to the app-global `_escHtml` when present at call time,
 *   else uses a built-in equivalent escaper.
 *
 * USAGE EXAMPLE
 *   container.innerHTML =
 *     DS.card({
 *       eyebrow: 'WEEK 7', title: 'Matchup',
 *       body:
 *         DS.tabBar({ tabs:[{id:'off',label:'OFFENSE'},{id:'def',label:'DEFENSE'}],
 *                     activeId:'off', on:'frnSetTab' }) +
 *         DS.statTile({ label:'YDS', value:412, elite:true }) +
 *         DS.button({ label:'Sim Week', variant:'gold', on:'frnSim()' })
 *     });
 *   const ok = await DS.modal({ title:'Delete?', body:'Cannot be undone.',
 *                               danger:true, okLabel:'Delete' });
 * ========================================================================== */
(function () {
  "use strict";

  // ── esc ────────────────────────────────────────────────────────────────────
  // Delegate to the app's _escHtml when available (resolved per-call so load
  // order doesn't matter), else use a built-in escaper with identical output.
  function esc(s) {
    if (typeof _escHtml === "function") return _escHtml(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── attrs ────────────────────────────────────────────────────────────────
  // Build a ` key="val"` string from an object. Keys & values are escaped.
  // Boolean true → bare attribute; false/null/undefined → omitted.
  function attrs(obj) {
    if (!obj) return "";
    let out = "";
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];
      if (v == null || v === false) continue;
      const key = esc(k);
      if (v === true) { out += ` ${key}`; continue; }
      out += ` ${key}="${esc(v)}"`;
    }
    return out;
  }

  // ── cx ─────────────────────────────────────────────────────────────────────
  // Join class-name fragments, skipping falsy ones. Returns a single string.
  function cx() {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i];
      if (!a) continue;
      if (Array.isArray(a)) { const inner = cx.apply(null, a); if (inner) parts.push(inner); }
      else parts.push(String(a));
    }
    return parts.join(" ");
  }

  // Inline-handler attribute helper (trusted expr string).
  function _on(expr) { return expr ? ` onclick="${expr}"` : ""; }

  // Inline Enter/Space activation for non-<button> interactive elements
  // (chips/tabs/nav links are span/div/a). Static trusted string — no
  // interpolation ever lands inside it.
  const _KEY_ACTIVATE =
    ` onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"`;

  // ── button ─────────────────────────────────────────────────────────────────
  // { label, variant='outline', size, icon, on, disabled, busy, title, type,
  //   attrs, ariaLabel }
  // ariaLabel → emits aria-label="…" (escaped). Essential for icon-only buttons
  // (icon set, no label text) so screen readers announce a name.
  // busy → in-flight action state: spinner + disabled + aria-busy (label kept,
  // so the button doesn't change width). For toggling an already-mounted
  // button around an await, use DS.busy(el, on) instead of re-rendering.
  function button(opts) {
    const o = opts || {};
    const busy = !!o.busy;
    const cls = cx(
      "ds-btn",
      o.variant && ("ds-btn--" + o.variant),
      o.size && ("ds-btn--" + o.size),
      busy && "ds-btn--busy",
      o.class || o.cls
    );
    const spin = busy ? `<span class="ds-spinner ds-spinner--sm" aria-hidden="true"></span>` : "";
    const icon = o.icon ? `<span class="ds-btn__icon">${esc(o.icon)}</span>` : "";
    const type = o.type ? ` type="${esc(o.type)}"` : "";
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    const aria = o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : "";
    const dis = (o.disabled || busy) ? " disabled" : "";
    const busyAttr = busy ? ` aria-busy="true"` : "";
    return `<button class="${cls}"${type}${title}${aria}${busyAttr}${dis}${_on(o.on)}${attrs(o.attrs)}>${spin}${icon}${esc(o.label)}</button>`;
  }

  // ── card ─────────────────────────────────────────────────────────────────
  // { eyebrow, title, body, onClose, hero, accent, attrs }  (body is TRUSTED)
  function card(opts) {
    const o = opts || {};
    const cls = cx("ds-card", o.hero && "ds-card--hero", o.class || o.cls);
    const style = o.accent ? ` style="--ds-accent:${esc(o.accent)}"` : "";
    const eyebrow = o.eyebrow ? `<div class="ds-card__eyebrow">${esc(o.eyebrow)}</div>` : "";
    const title = o.title ? `<div class="ds-card__title">${esc(o.title)}</div>` : "";
    const close = o.onClose ? `<button class="ds-card__close" aria-label="Close"${_on(o.onClose)}>×</button>` : "";
    const body = o.body != null ? `<div class="ds-card__body">${o.body}</div>` : "";
    return `<div class="${cls}"${style}${attrs(o.attrs)}>${close}${eyebrow}${title}${body}</div>`;
  }

  // ── chip ─────────────────────────────────────────────────────────────────
  // { label, active, variant, on, title, disabled }
  // Interactive chips (`on` set, not disabled) are real controls: they get
  // role="button" + tabindex="0" + Enter/Space activation so keyboard users
  // can reach them. Decorative chips (no `on`) stay inert spans.
  function chip(opts) {
    const o = opts || {};
    const interactive = !!o.on && !o.disabled;
    const cls = cx(
      "ds-chip",
      o.active && "ds-chip--active",
      o.variant && ("ds-chip--" + o.variant),
      o.class || o.cls
    );
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    const a11y = interactive
      ? ` role="button" tabindex="0"${_KEY_ACTIVATE}`
      : (o.disabled ? ` aria-disabled="true"` : "");
    return `<span class="${cls}"${title}${a11y}${interactive ? _on(o.on) : ""}>${esc(o.label)}</span>`;
  }

  // ── tab / tabBar ───────────────────────────────────────────────────────────
  // tab: { id, label, color, active, on, disabled } — `on` is a fn-name called
  // on('id'). Interactive tabs are keyboard-reachable (role="button" +
  // tabindex + Enter/Space); the active one carries aria-current="true".
  function tab(opts) {
    const o = opts || {};
    const interactive = !!o.on && !o.disabled;
    const cls = cx("ds-tab", o.active && "ds-tab--active", o.class || o.cls);
    const style = o.color ? ` style="--unit-color:${esc(o.color)}"` : "";
    const click = interactive ? ` onclick="${o.on}('${esc(o.id)}')"` : "";
    const a11y = interactive
      ? ` role="button" tabindex="0"${_KEY_ACTIVATE}`
      : (o.disabled ? ` aria-disabled="true"` : "");
    const cur = o.active ? ` aria-current="true"` : "";
    return `<div class="${cls}"${style} data-tab="${esc(o.id)}"${a11y}${cur}${click}>${esc(o.label)}</div>`;
  }
  // tabBar: { tabs:[{id,label,color}], activeId, on }
  function tabBar(opts) {
    const o = opts || {};
    const tabs = o.tabs || [];
    const inner = tabs.map(t => tab({
      id: t.id, label: t.label, color: t.color,
      active: t.id === o.activeId, on: o.on
    })).join("");
    return `<div class="ds-tabbar">${inner}</div>`;
  }

  // ── modalHtml (string form) ──────────────────────────────────────────────
  // { title, body, danger, okLabel='OK', cancelLabel='Cancel', requireType }
  // body is TRUSTED (raw HTML). Returns the backdrop+modal markup string.
  function modalHtml(opts) {
    const o = opts || {};
    const title = o.title != null ? o.title : "Confirm";
    const body = o.body != null ? o.body : "";
    const okLabel = o.okLabel != null ? o.okLabel : "OK";
    const cancelLabel = o.cancelLabel != null ? o.cancelLabel : "Cancel";
    const danger = !!o.danger;
    const typeName = o.requireType || "";
    const typeGate = typeName
      ? `<div class="ds-modal__type-gate">
           <label class="ds-modal__type-label">Type <b>${esc(typeName)}</b> to confirm:</label>
           <input type="text" class="ds-modal__type-input" autocomplete="off" />
         </div>`
      : "";
    const okCls = cx("ds-btn", danger ? "ds-btn--danger" : "ds-btn--gold", "ds-modal__confirm");
    // Self-contained: includes the .ds-modal-backdrop wrapper so callers can mount
    // it directly (and DS.modal() reuses this exact markup, mounting its root).
    return `<div class="ds-modal-backdrop"><div class="${cx("ds-modal", danger && "ds-modal--danger")}" role="dialog" aria-modal="true">
        <div class="ds-modal__title">${esc(title)}</div>
        <div class="ds-modal__body">${body}</div>
        ${typeGate}
        <div class="ds-modal__footer">
          <button class="ds-btn ds-btn--outline ds-modal__cancel">${esc(cancelLabel)}</button>
          <button class="${okCls}"${typeName ? " disabled" : ""}>${esc(okLabel)}</button>
        </div>
      </div></div>`;
  }

  // ── modal (DOM, Promise<boolean>) ──────────────────────────────────────────
  // Mounts to document.body and resolves true=confirm / false=cancel. Mirrors
  // _frnConfirmModal: backdrop click = cancel, Esc = cancel, Enter = confirm
  // (when not gated), optional requireType gating.
  function modal(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      if (typeof document === "undefined") { resolve(false); return; }
      // Save what had focus before the modal opened so we can restore it on
      // every close path (a11y: focus must not be lost behind a closed dialog).
      const prevFocus = (document.activeElement instanceof HTMLElement)
        ? document.activeElement : null;

      const tmp = document.createElement("div");
      tmp.innerHTML = modalHtml(o);
      const wrap = tmp.firstElementChild; // the .ds-modal-backdrop root
      wrap.id = "dsModal_" + Date.now();
      document.body.appendChild(wrap);
      const dialog = wrap.querySelector(".ds-modal") || wrap;

      const cancelBtn = wrap.querySelector(".ds-modal__cancel");
      const okBtn = wrap.querySelector(".ds-modal__confirm");
      const typeInp = wrap.querySelector(".ds-modal__type-input");
      const typeName = o.requireType || "";

      // Tabbable elements currently inside the dialog (skip disabled/hidden).
      const FOCUSABLE = 'a[href],area[href],button:not([disabled]),' +
        'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),' +
        '[tabindex]:not([tabindex="-1"])';
      const focusables = () => Array.prototype.filter.call(
        dialog.querySelectorAll(FOCUSABLE),
        (el) => el.offsetParent !== null || el === document.activeElement
      );

      const close = (result) => {
        wrap.remove();
        document.removeEventListener("keydown", onKey);
        // Restore focus to whatever was focused before the modal opened.
        if (prevFocus && typeof prevFocus.focus === "function") {
          try { prevFocus.focus(); } catch (e) { /* element gone — ignore */ }
        }
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { close(false); return; }
        if (e.key === "Enter" && okBtn && !okBtn.disabled) { close(true); return; }
        // Focus trap: cycle Tab/Shift+Tab within the dialog's focusables.
        if (e.key === "Tab") {
          const items = focusables();
          if (!items.length) { e.preventDefault(); return; }
          const first = items[0];
          const last = items[items.length - 1];
          const active = document.activeElement;
          if (e.shiftKey) {
            if (active === first || !dialog.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (active === last || !dialog.contains(active)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      if (cancelBtn) cancelBtn.addEventListener("click", () => close(false));
      if (okBtn) okBtn.addEventListener("click", () => { if (!okBtn.disabled) close(true); });
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); }); // backdrop = cancel

      // Move focus into the dialog after mount: type-gate input first, else the
      // first focusable (falls back to Cancel — the historical default).
      if (typeInp) {
        typeInp.addEventListener("input", () => {
          if (okBtn) okBtn.disabled = typeInp.value.trim() !== typeName;
        });
        setTimeout(() => typeInp.focus(), 30);
      } else {
        setTimeout(() => {
          const items = focusables();
          const target = cancelBtn || items[0];
          if (target) target.focus();
        }, 30);
      }
      document.addEventListener("keydown", onKey);
    });
  }

  // ── banner ─────────────────────────────────────────────────────────────────
  // { title, body, icon, variant }   (body is TRUSTED)
  function banner(opts) {
    const o = opts || {};
    const cls = cx("ds-banner", o.variant && ("ds-banner--" + o.variant), o.class || o.cls);
    const icon = o.icon ? `<span class="ds-banner__icon">${esc(o.icon)}</span>` : "";
    const title = o.title ? `<div class="ds-banner__title">${esc(o.title)}</div>` : "";
    const body = o.body != null ? `<div class="ds-banner__body">${o.body}</div>` : "";
    return `<div class="${cls}">${icon}<div class="ds-banner__content">${title}${body}</div></div>`;
  }

  // ── statTile ─────────────────────────────────────────────────────────────
  // { label, value, elite }
  function statTile(opts) {
    const o = opts || {};
    const cls = cx("ds-stat", o.elite && "ds-stat--elite", o.class || o.cls);
    return `<div class="${cls}">` +
      `<div class="ds-stat__label">${esc(o.label)}</div>` +
      `<div class="ds-stat__value">${esc(o.value)}</div>` +
      `</div>`;
  }

  // ── row / table ────────────────────────────────────────────────────────────
  // row: { cells:[...], mine }   — cells are TRUSTED HTML strings
  function row(opts) {
    const o = opts || {};
    const cls = cx("ds-row", o.mine && "ds-row--mine");
    const cells = (o.cells || []).map(c => `<td>${c == null ? "" : c}</td>`).join("");
    return `<tr class="${cls}">${cells}</tr>`;
  }
  // table: { head:[...], rows:[htmlString...], attrs }   — head cells ESCAPED,
  // rows are TRUSTED HTML strings (typically DS.row output).
  function table(opts) {
    const o = opts || {};
    const head = (o.head || []).length
      ? `<thead><tr>${o.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
      : "";
    const body = `<tbody>${(o.rows || []).join("")}</tbody>`;
    return `<table class="ds-table"${attrs(o.attrs)}>${head}${body}</table>`;
  }

  // ── progress ─────────────────────────────────────────────────────────────
  // { pct, color, label, title }
  function progress(opts) {
    const o = opts || {};
    let pct = Number(o.pct);
    if (!isFinite(pct)) pct = 0;
    pct = Math.max(0, Math.min(100, pct));
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    const fillStyle = `width:${pct}%` + (o.color ? `;background:${esc(o.color)}` : "");
    const label = o.label != null ? `<span class="ds-progress__label">${esc(o.label)}</span>` : "";
    return `<div class="ds-progress"${title}><div class="ds-progress__fill" style="${fillStyle}"></div>${label}</div>`;
  }

  // ── toggle ─────────────────────────────────────────────────────────────────
  // { expanded, label, on, disabled, title }
  function toggle(opts) {
    const o = opts || {};
    const cls = cx("ds-toggle", o.expanded && "ds-toggle--expanded", o.class || o.cls);
    const caret = o.expanded ? "▾" : "▸";
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    const dis = o.disabled ? " disabled" : "";
    return `<button class="${cls}" aria-expanded="${o.expanded ? "true" : "false"}"${title}${dis}${_on(o.on)}>` +
      `<span class="ds-toggle__caret">${caret}</span>` +
      `<span class="ds-toggle__label">${esc(o.label)}</span>` +
      `</button>`;
  }

  // ── toolbar ──────────────────────────────────────────────────────────────
  // { links:[{label, on, active, disabled}] }  — dot-separated nav. Links are
  // href-less <a>, so interactive ones need role/tabindex/key activation to
  // be reachable at all from a keyboard.
  function toolbar(opts) {
    const o = opts || {};
    const links = (o.links || []).map(l => {
      const interactive = !!l.on && !l.disabled;
      const cls = cx("ds-nav__link", l.active && "ds-nav__link--active");
      const a11y = interactive
        ? ` role="button" tabindex="0"${_KEY_ACTIVATE}`
        : (l.disabled ? ` aria-disabled="true"` : "");
      const cur = l.active ? ` aria-current="true"` : "";
      return `<a class="${cls}"${a11y}${cur}${interactive ? _on(l.on) : ""}>${esc(l.label)}</a>`;
    }).join(`<span class="ds-nav__sep">·</span>`);
    return `<div class="ds-toolbar ds-nav">${links}</div>`;
  }

  // ── select ─────────────────────────────────────────────────────────────────
  // { id, options:[{value,label,selected}], value, on, attrs }
  function select(opts) {
    const o = opts || {};
    const id = o.id ? ` id="${esc(o.id)}"` : "";
    const onCh = o.on ? ` onchange="${o.on}"` : "";
    const cur = o.value;
    const options = (o.options || []).map(op => {
      const sel = (op.selected || (cur != null && String(op.value) === String(cur))) ? " selected" : "";
      return `<option value="${esc(op.value)}"${sel}>${esc(op.label)}</option>`;
    }).join("");
    return `<div class="ds-select"><select${id}${onCh}${attrs(o.attrs)}>${options}</select></div>`;
  }

  // ── input ────────────────────────────────────────────────────────────────
  // { id, name=id, type='text', value, placeholder, autocomplete, inputmode,
  //   enterkeyhint, required, min, max, step, minlength, maxlength, pattern,
  //   disabled, spellcheck, ariaLabel, on, attrs }
  // Keyboard/autofill-friendly by construction: pass the real `name`,
  // `autocomplete`, `inputmode`, and `type` — browsers key autofill and the
  // right mobile keyboard off exactly these. `on` = inline oninput expression.
  function input(opts) {
    const o = opts || {};
    const cls = cx("ds-input", o.class || o.cls);
    const passthrough = attrs({
      id: o.id, name: o.name != null ? o.name : o.id,
      type: o.type || "text",
      value: o.value, placeholder: o.placeholder,
      autocomplete: o.autocomplete, inputmode: o.inputmode,
      enterkeyhint: o.enterkeyhint,
      required: !!o.required, disabled: !!o.disabled,
      min: o.min, max: o.max, step: o.step,
      minlength: o.minlength, maxlength: o.maxlength, pattern: o.pattern,
      spellcheck: o.spellcheck, "aria-label": o.ariaLabel,
    });
    const onInput = o.on ? ` oninput="${o.on}"` : "";
    return `<input class="${cls}"${passthrough}${onInput}${attrs(o.attrs)}>`;
  }

  // ── checkbox ─────────────────────────────────────────────────────────────
  // { id, name=id, label, checked, disabled, attrs } — label wraps the input,
  // so the whole row is the click/tap target and no for/id wiring is needed.
  function checkbox(opts) {
    const o = opts || {};
    const cls = cx("ds-checkbox", o.class || o.cls);
    const passthrough = attrs({
      id: o.id, name: o.name != null ? o.name : o.id,
      checked: !!o.checked, disabled: !!o.disabled,
    });
    return `<label class="${cls}"><input type="checkbox"${passthrough}${attrs(o.attrs)}>` +
      `<span>${esc(o.label)}</span></label>`;
  }

  // ── field ────────────────────────────────────────────────────────────────
  // { id, label, control, hint, error, required, class, attrs }
  // Label + control + hint + an ALWAYS-PRESENT error slot, so validation can
  // write into it without re-rendering. `control` is TRUSTED HTML (compose
  // from DS.input/DS.select/DS.checkbox). `id` should match the control's id
  // so the label binds (for/id); DS.form wires aria-describedby → hint/error
  // at bind time.
  function field(opts) {
    const o = opts || {};
    const cls = cx("ds-field", o.class || o.cls);
    const req = o.required ? `<span class="ds-field__req" aria-hidden="true">*</span>` : "";
    const label = o.label != null
      ? `<label class="ds-field__label"${o.id ? ` for="${esc(o.id)}"` : ""}>${esc(o.label)}${req}</label>`
      : "";
    const hint = o.hint != null
      ? `<div class="ds-field__hint"${o.id ? ` id="${esc(o.id)}-hint"` : ""}>${esc(o.hint)}</div>`
      : "";
    const error = `<div class="ds-field__error"${o.id ? ` id="${esc(o.id)}-error"` : ""}>${o.error != null ? esc(o.error) : ""}</div>`;
    return `<div class="${cls}"${attrs(o.attrs)}>${label}${o.control != null ? o.control : ""}${hint}${error}</div>`;
  }

  // ── form (DOM controller) ────────────────────────────────────────────────
  // DS.form(rootOrSelector, { validate, onSubmit }) → controller
  //   validate : { fieldNameOrId: (value, el, values) => "" | "error msg" }
  //              (runs AFTER native constraint validation passes)
  //   onSubmit : async (values, ctl) — throw an Error or return { error }
  //              to fail (message lands in the form-level .ds-form-error,
  //              role="alert"); anything else = success (caller handles it).
  //
  // The validation UX contract ("reward early, punish late"):
  //   • a field is first validated on BLUR — no yelling mid-typing;
  //   • once a field has shown an error, it re-validates on every INPUT so
  //     the error clears the moment it's fixed;
  //   • submit validates everything VISIBLE, focuses the first invalid
  //     field, and busies the submit button around the async work.
  // Native constraint validation (required/type/min/max/pattern) is the
  // first pass — mapped to human messages — then the custom rule runs.
  // Errors render into the field's .ds-field__error slot with aria-invalid
  // + aria-describedby wired here, textContent only (no HTML injection).
  function form(rootOrSelector, opts) {
    if (typeof document === "undefined") return null;
    const o = opts || {};
    const root = typeof rootOrSelector === "string"
      ? document.querySelector(rootOrSelector) : rootOrSelector;
    if (!root) return null;
    const formEl = root.tagName === "FORM" ? root : root.querySelector("form");
    if (!formEl) return null;
    formEl.setAttribute("novalidate", "");

    const controls = () => Array.prototype.filter.call(
      formEl.querySelectorAll("input, select, textarea"),
      (el) => el.type !== "hidden" && el.type !== "submit" && el.type !== "button"
    );
    const keyOf = (el) => el.name || el.id || "";
    const visible = (el) => !el.disabled && !el.closest("[hidden]");

    // Human messages for the native validity states we actually use.
    function nativeMsg(el) {
      const v = el.validity;
      if (v.valid) return "";
      if (v.valueMissing) return "Required.";
      if (v.typeMismatch) {
        if (el.type === "url") return "Enter a full URL, like http://localhost:8787";
        if (el.type === "email") return "Enter a valid email address.";
        return "Doesn't look right for this field.";
      }
      if (v.rangeUnderflow) return `Must be at least ${el.min}.`;
      if (v.rangeOverflow) return `Must be at most ${el.max}.`;
      if (v.tooShort) return `Needs at least ${el.minLength} characters.`;
      if (v.tooLong) return `Keep it under ${el.maxLength} characters.`;
      if (v.patternMismatch) return el.getAttribute("data-pattern-msg") || "Doesn't match the expected format.";
      if (v.badInput) return "Enter a number.";
      return el.validationMessage || "Invalid value.";
    }

    function errorSlot(el) {
      const fieldEl = el.closest(".ds-field");
      return fieldEl ? fieldEl.querySelector(".ds-field__error") : null;
    }
    function wireAria(el) {
      const fieldEl = el.closest(".ds-field");
      if (!fieldEl) return;
      const ids = [];
      const hint = fieldEl.querySelector(".ds-field__hint");
      const err = fieldEl.querySelector(".ds-field__error");
      const base = el.id || keyOf(el) || ("f" + Math.abs([...(keyOf(el) || "x")].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)));
      if (hint) { if (!hint.id) hint.id = base + "-hint"; ids.push(hint.id); }
      if (err) { if (!err.id) err.id = base + "-error"; ids.push(err.id); }
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    }

    function values() {
      const out = {};
      controls().forEach((el) => {
        const k = keyOf(el);
        if (!k) return;
        out[k] = el.type === "checkbox" ? el.checked : el.value;
      });
      return out;
    }

    function showError(el, msg) {
      const slot = errorSlot(el);
      if (slot) slot.textContent = msg;
      el.setAttribute("aria-invalid", "true");
      el._dsErred = true; // live re-validation from here on
    }
    function clearError(el) {
      const slot = errorSlot(el);
      if (slot) slot.textContent = "";
      el.removeAttribute("aria-invalid");
    }

    function validateField(el) {
      if (!visible(el)) { clearError(el); return true; }
      let msg = nativeMsg(el);
      if (!msg && o.validate) {
        const rule = o.validate[keyOf(el)] || (el.id && o.validate[el.id]);
        if (typeof rule === "function") msg = rule(el.type === "checkbox" ? el.checked : el.value, el, values()) || "";
      }
      if (msg) { showError(el, msg); return false; }
      clearError(el);
      return true;
    }

    // scope: optional container — validate only the fields inside it
    // (the stepper validates one panel at a time).
    function validate(scope) {
      let firstBad = null;
      controls().forEach((el) => {
        if (scope && !scope.contains(el)) return;
        if (!validateField(el) && !firstBad) firstBad = el;
      });
      if (firstBad) firstBad.focus();
      return !firstBad;
    }

    const formErrEl = () => formEl.querySelector(".ds-form-error");
    function setFormError(msg) {
      const el = formErrEl();
      if (!el) return;
      el.textContent = msg || "";
      if (msg) el.setAttribute("role", "alert");
      else el.removeAttribute("role");
    }

    const onBlur = (e) => {
      const el = e.target;
      if (el && el.matches && el.matches("input, select, textarea") && visible(el)) validateField(el);
    };
    const onInput = (e) => {
      const el = e.target;
      if (el && el._dsErred) validateField(el);
    };
    const onSubmit = async (e) => {
      e.preventDefault();
      setFormError("");
      if (!validate()) return;
      const btn = e.submitter || formEl.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) busy(btn, true);
      try {
        const res = o.onSubmit ? await o.onSubmit(values(), ctl) : null;
        if (res && res.error) setFormError(String(res.error));
      } catch (err) {
        setFormError(err && err.message ? err.message : "Something went wrong — try again.");
      } finally {
        if (btn) busy(btn, false);
      }
    };

    controls().forEach(wireAria);
    formEl.addEventListener("blur", onBlur, true);
    formEl.addEventListener("input", onInput);
    formEl.addEventListener("change", onInput);
    formEl.addEventListener("submit", onSubmit);

    const ctl = {
      form: formEl, values, validate, validateField,
      setError: (nameOrEl, msg) => {
        const el = typeof nameOrEl === "string"
          ? controls().find((c) => keyOf(c) === nameOrEl || c.id === nameOrEl) : nameOrEl;
        if (el) { if (msg) showError(el, msg); else clearError(el); }
      },
      setFormError,
      destroy: () => {
        formEl.removeEventListener("blur", onBlur, true);
        formEl.removeEventListener("input", onInput);
        formEl.removeEventListener("change", onInput);
        formEl.removeEventListener("submit", onSubmit);
      },
    };
    return ctl;
  }

  // ── steps / stepper (multi-step forms) ──────────────────────────────────
  // DS.steps({ steps:[{id,label}], activeIdx=0, doneIdx=-1 }) → header string.
  // DS.stepper(root, { steps, form, onFinish }) → controller. Panels are
  // [data-step-panel] elements inside `root`, in step order; the header
  // renders into [data-steps-header]. "Next" ([data-step-next]) validates
  // ONLY the active panel's fields via the DS.form controller before
  // advancing; "Back" ([data-step-back]) never blocks. Focus moves to the
  // new panel (tabindex=-1) so keyboard/SR users land where the action is.
  function steps(opts) {
    const o = opts || {};
    const list = o.steps || [];
    const active = o.activeIdx | 0;
    const done = o.doneIdx != null ? o.doneIdx : active - 1;
    const items = list.map((s, i) => {
      const state = i <= done ? "done" : i === active ? "active" : "todo";
      const cls = cx("ds-step", state === "done" && "ds-step--done", state === "active" && "ds-step--active");
      const dot = state === "done" ? "✓" : String(i + 1);
      const cur = state === "active" ? ` aria-current="step"` : "";
      return `<span class="${cls}"${cur}><span class="ds-step__dot" aria-hidden="true">${dot}</span>` +
        `<span class="ds-step__label">${esc(s.label)}</span></span>`;
    });
    return `<div class="ds-steps" role="list" aria-label="Steps">${items.join(`<span class="ds-step__bar" aria-hidden="true"></span>`)}</div>`;
  }
  function stepper(rootOrSelector, opts) {
    if (typeof document === "undefined") return null;
    const o = opts || {};
    const root = typeof rootOrSelector === "string"
      ? document.querySelector(rootOrSelector) : rootOrSelector;
    if (!root) return null;
    const panels = Array.prototype.slice.call(root.querySelectorAll("[data-step-panel]"));
    const header = root.querySelector("[data-steps-header]");
    let idx = 0;

    function render() {
      panels.forEach((p, i) => { p.hidden = i !== idx; });
      if (header && o.steps) header.innerHTML = steps({ steps: o.steps, activeIdx: idx });
      const panel = panels[idx];
      if (panel) {
        if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
        panel.focus({ preventScroll: false });
      }
    }
    function next() {
      // Gate on the ACTIVE panel's fields only.
      if (o.form && panels[idx] && !o.form.validate(panels[idx])) return false;
      if (idx < panels.length - 1) { idx++; render(); return true; }
      if (typeof o.onFinish === "function") o.onFinish();
      return true;
    }
    function back() { if (idx > 0) { idx--; render(); } }

    const onClick = (e) => {
      const nextBtn = e.target.closest("[data-step-next]");
      const backBtn = e.target.closest("[data-step-back]");
      if (nextBtn && root.contains(nextBtn)) { e.preventDefault(); next(); }
      else if (backBtn && root.contains(backBtn)) { e.preventDefault(); back(); }
    };
    root.addEventListener("click", onClick);
    render();
    return {
      next, back, render,
      get index() { return idx; },
      goTo: (i) => { idx = Math.max(0, Math.min(panels.length - 1, i | 0)); render(); },
      destroy: () => root.removeEventListener("click", onClick),
    };
  }

  // ── trapFocus (DOM helper) ───────────────────────────────────────────────
  // DS.trapFocus(dialogEl) → dispose(). Tab/Shift+Tab cycle inside dialogEl
  // (same contract as DS.modal's built-in trap) for custom dialogs like form
  // modals. Focus restore is the caller's job (they know the trigger).
  function trapFocus(dialogEl) {
    if (typeof document === "undefined" || !dialogEl) return () => {};
    const FOCUSABLE = 'a[href],area[href],button:not([disabled]),' +
      'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),' +
      '[tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = Array.prototype.filter.call(
        dialogEl.querySelectorAll(FOCUSABLE),
        (el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogEl.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last || !dialogEl.contains(active)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }

  // ── spinner ─────────────────────────────────────────────────────────────
  // { size:'sm'|'lg', label, class }
  // With `label` → standalone status indicator (role="status" + sr-only text,
  // announced once). Without → decorative (aria-hidden): use inside a control
  // that itself carries aria-busy (DS.button{busy} / DS.busy do this).
  function spinner(opts) {
    const o = opts || {};
    const cls = cx("ds-spinner", o.size && ("ds-spinner--" + o.size), o.class || o.cls);
    if (o.label) {
      return `<span role="status"><span class="${cls}" aria-hidden="true"></span>` +
        `<span class="sr-only">${esc(o.label)}</span></span>`;
    }
    return `<span class="${cls}" aria-hidden="true"></span>`;
  }

  // ── skeleton ─────────────────────────────────────────────────────────────
  // { variant:'text'|'block'|'tile'|'table', lines=3, rows=4, cols=4, width,
  //   height, label='Loading…', class }
  // Loading placeholder for content that is genuinely in flight (an IDB read,
  // a network call) — never for instant renders. Container announces ONCE
  // (role="status" aria-busy + sr-only label); the shimmer bars are
  // aria-hidden decoration. Swap it out by re-rendering the region.
  function skeleton(opts) {
    const o = opts || {};
    const variant = o.variant || "text";
    const cls = cx("ds-skeleton", "ds-skeleton--" + variant, o.class || o.cls);
    let style = "";
    if (o.width) style += `width:${esc(o.width)};`;
    if (o.height) style += `height:${esc(o.height)};`;
    const styleAttr = style ? ` style="${style}"` : "";
    let bars = "";
    if (variant === "table") {
      const rows = Math.max(1, (o.rows | 0) || 4);
      const cols = Math.max(1, (o.cols | 0) || 4);
      for (let r = 0; r < rows; r++) {
        let cells = "";
        for (let c = 0; c < cols; c++) cells += `<span class="ds-skeleton__bar"></span>`;
        bars += `<span class="ds-skeleton__row">${cells}</span>`;
      }
    } else if (variant === "tile") {
      bars = `<span class="ds-skeleton__bar" style="width:45%"></span>` +
             `<span class="ds-skeleton__bar ds-skeleton__bar--lg"></span>`;
    } else if (variant === "block") {
      bars = `<span class="ds-skeleton__bar ds-skeleton__bar--block"></span>`;
    } else { // text
      const n = Math.max(1, (o.lines | 0) || 3);
      for (let i = 0; i < n; i++) {
        const short = (i === n - 1 && n > 1) ? ` style="width:60%"` : "";
        bars += `<span class="ds-skeleton__bar"${short}></span>`;
      }
    }
    const label = o.label != null ? o.label : "Loading…";
    return `<div class="${cls}"${styleAttr} role="status" aria-busy="true" aria-live="polite">` +
      `<span class="sr-only">${esc(label)}</span>` +
      `<span class="ds-skeleton__frame" aria-hidden="true">${bars}</span></div>`;
  }

  // ── emptyState / errorState ──────────────────────────────────────────────
  // Shared layout (.ds-state), two semantics. body is TRUSTED (compose links/
  // markup yourself); icon/title/detail are escaped. `action` is either a
  // DS.button opts object or a pre-built TRUSTED HTML string.
  function _stateBlock(kind, o) {
    const cls = cx("ds-state", "ds-state--" + kind, o.compact && "ds-state--compact", o.class || o.cls);
    const icon = o.icon ? `<div class="ds-state__icon" aria-hidden="true">${esc(o.icon)}</div>` : "";
    const title = o.title ? `<div class="ds-state__title">${esc(o.title)}</div>` : "";
    const body = o.body != null ? `<div class="ds-state__body">${o.body}</div>` : "";
    const detail = o.detail ? `<div class="ds-state__detail">${esc(o.detail)}</div>` : "";
    const act = o.action == null ? "" : (typeof o.action === "string" ? o.action : button(o.action));
    const action = act ? `<div class="ds-state__action">${act}</div>` : "";
    // Errors announce when injected (role="alert"); empty states are plain
    // content — no live region, no announcement.
    const aria = kind === "error" ? ` role="alert"` : "";
    return `<div class="${cls}"${aria}${attrs(o.attrs)}>${icon}${title}${body}${detail}${action}</div>`;
  }
  // { icon, title, body, action, compact, class, attrs }
  function emptyState(opts) { return _stateBlock("empty", opts || {}); }
  // { icon='⚠', title, body, detail, retry, action, compact, class, attrs }
  // `retry` sugar: a trusted handler-expression string (or button opts) that
  // becomes the gold "↻ Retry" action — every error state should offer a way
  // forward.
  function errorState(opts) {
    const o = Object.assign({}, opts || {});
    if (o.action == null && o.retry != null) {
      o.action = typeof o.retry === "string"
        ? { label: "↻ Retry", variant: "gold", on: o.retry }
        : o.retry;
    }
    if (o.icon == null) o.icon = "⚠";
    return _stateBlock("error", o);
  }

  // ── toast (DOM helper) ────────────────────────────────────────────────────
  // DS.toast({message, kind:'success'|'warn'|'error'|'info', duration=3500})
  // (or DS.toast("message")). Singleton feedback strip, top-center, auto-
  // dismissing. success/warn/info are polite (role="status"); errors are
  // assertive (role="alert"). Re-calling replaces the message and restarts
  // the timer. pointer-events:none — it never blocks clicks. Returns the
  // element (null outside a DOM).
  function toast(opts) {
    if (typeof document === "undefined") return null;
    const o = typeof opts === "string" ? { message: opts } : (opts || {});
    const kind = (o.kind === "warn" || o.kind === "error" || o.kind === "info") ? o.kind : "success";
    let el = document.getElementById("dsToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "dsToast";
      document.body.appendChild(el);
    }
    el.className = cx("ds-toast", "ds-toast--" + kind);
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    el.textContent = o.message == null ? "" : String(o.message);
    void el.offsetWidth; // reflow so a replaced toast re-runs its entrance
    el.classList.add("ds-toast--visible");
    clearTimeout(el._dsDismiss);
    const dur = Number.isFinite(o.duration) ? o.duration : 3500;
    if (dur > 0) {
      el._dsDismiss = setTimeout(() => el.classList.remove("ds-toast--visible"), dur);
    }
    return el;
  }

  // ── busy (DOM helper) ─────────────────────────────────────────────────────
  // DS.busy(elOrSelector, on) — toggle the in-flight state on a mounted
  // control around an await:  DS.busy(btn, true); try { await work(); }
  // finally { DS.busy(btn, false); }
  // Adds/removes: leading spinner, disabled, aria-busy, .ds-btn--busy.
  // Idempotent; returns the element (null if not found / no DOM).
  function busy(target, on) {
    if (typeof document === "undefined") return null;
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return null;
    const isBusy = el.getAttribute("aria-busy") === "true";
    if (on && !isBusy) {
      el.setAttribute("aria-busy", "true");
      el.classList.add("ds-btn--busy");
      if ("disabled" in el) el.disabled = true; else el.setAttribute("aria-disabled", "true");
      const sp = document.createElement("span");
      sp.className = "ds-spinner ds-spinner--sm ds-busy__spinner";
      sp.setAttribute("aria-hidden", "true");
      el.insertBefore(sp, el.firstChild);
    } else if (!on && isBusy) {
      el.removeAttribute("aria-busy");
      el.classList.remove("ds-btn--busy");
      if ("disabled" in el) el.disabled = false; else el.removeAttribute("aria-disabled");
      const sp = el.querySelector(":scope > .ds-busy__spinner");
      if (sp) sp.remove();
    }
    return el;
  }

  // ── mount (DOM helper) ──────────────────────────────────────────────────────
  // Parse html (via a <template>) and append into parent (selector or element),
  // or replace its children when {replace:true}. Returns the inserted root.
  function mount(parentElOrSelector, html, options) {
    if (typeof document === "undefined") return null;
    const opt = options || {};
    const parent = typeof parentElOrSelector === "string"
      ? document.querySelector(parentElOrSelector)
      : parentElOrSelector;
    if (!parent) return null;
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html == null ? "" : html).trim();
    const frag = tpl.content;
    const root = frag.firstElementChild || null;
    if (opt.replace) parent.innerHTML = "";
    parent.appendChild(frag);
    return root;
  }

  // ── export ─────────────────────────────────────────────────────────────────
  const DS = {
    esc, attrs, cx,
    button, card, chip, tab, tabBar,
    modal, modalHtml, banner, statTile,
    row, table, progress, toggle, toolbar, select,
    input, checkbox, field, form, steps, stepper, trapFocus,
    spinner, skeleton, emptyState, errorState,
    toast, busy,
    mount
  };

  if (typeof window !== "undefined") window.DS = DS;
  if (typeof module !== "undefined" && module.exports) module.exports = DS;
})();
