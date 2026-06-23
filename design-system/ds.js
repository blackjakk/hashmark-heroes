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

  // ── button ─────────────────────────────────────────────────────────────────
  // { label, variant='outline', size, icon, on, disabled, title, type, attrs }
  function button(opts) {
    const o = opts || {};
    const cls = cx(
      "ds-btn",
      o.variant && ("ds-btn--" + o.variant),
      o.size && ("ds-btn--" + o.size),
      o.class || o.cls
    );
    const icon = o.icon ? `<span class="ds-btn__icon">${esc(o.icon)}</span>` : "";
    const type = o.type ? ` type="${esc(o.type)}"` : "";
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    const dis = o.disabled ? " disabled" : "";
    return `<button class="${cls}"${type}${title}${dis}${_on(o.on)}${attrs(o.attrs)}>${icon}${esc(o.label)}</button>`;
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
  // { label, active, variant, on, title }
  function chip(opts) {
    const o = opts || {};
    const cls = cx(
      "ds-chip",
      o.active && "ds-chip--active",
      o.variant && ("ds-chip--" + o.variant),
      o.class || o.cls
    );
    const title = o.title ? ` title="${esc(o.title)}"` : "";
    return `<span class="${cls}"${title}${_on(o.on)}>${esc(o.label)}</span>`;
  }

  // ── tab / tabBar ───────────────────────────────────────────────────────────
  // tab: { id, label, color, active, on }  — `on` is a fn-name called on('id')
  function tab(opts) {
    const o = opts || {};
    const cls = cx("ds-tab", o.active && "ds-tab--active", o.class || o.cls);
    const style = o.color ? ` style="--unit-color:${esc(o.color)}"` : "";
    const click = o.on ? ` onclick="${o.on}('${esc(o.id)}')"` : "";
    return `<div class="${cls}"${style} data-tab="${esc(o.id)}"${click}>${esc(o.label)}</div>`;
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
      const tmp = document.createElement("div");
      tmp.innerHTML = modalHtml(o);
      const wrap = tmp.firstElementChild; // the .ds-modal-backdrop root
      wrap.id = "dsModal_" + Date.now();
      document.body.appendChild(wrap);

      const cancelBtn = wrap.querySelector(".ds-modal__cancel");
      const okBtn = wrap.querySelector(".ds-modal__confirm");
      const typeInp = wrap.querySelector(".ds-modal__type-input");
      const typeName = o.requireType || "";

      const close = (result) => {
        wrap.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") close(false);
        if (e.key === "Enter" && okBtn && !okBtn.disabled) close(true);
      };

      if (cancelBtn) cancelBtn.addEventListener("click", () => close(false));
      if (okBtn) okBtn.addEventListener("click", () => { if (!okBtn.disabled) close(true); });
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); }); // backdrop = cancel

      if (typeInp) {
        typeInp.addEventListener("input", () => {
          if (okBtn) okBtn.disabled = typeInp.value.trim() !== typeName;
        });
        setTimeout(() => typeInp.focus(), 30);
      } else if (cancelBtn) {
        setTimeout(() => cancelBtn.focus(), 30); // default focus on Cancel (safer)
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
  // { expanded, label, on }
  function toggle(opts) {
    const o = opts || {};
    const cls = cx("ds-toggle", o.expanded && "ds-toggle--expanded", o.class || o.cls);
    const caret = o.expanded ? "▾" : "▸";
    return `<button class="${cls}" aria-expanded="${o.expanded ? "true" : "false"}"${_on(o.on)}>` +
      `<span class="ds-toggle__caret">${caret}</span>` +
      `<span class="ds-toggle__label">${esc(o.label)}</span>` +
      `</button>`;
  }

  // ── toolbar ──────────────────────────────────────────────────────────────
  // { links:[{label, on}] }  — dot-separated nav
  function toolbar(opts) {
    const o = opts || {};
    const links = (o.links || []).map(l =>
      `<a class="ds-nav__link"${_on(l.on)}>${esc(l.label)}</a>`
    ).join(`<span class="ds-nav__sep">·</span>`);
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
    mount
  };

  if (typeof window !== "undefined") window.DS = DS;
  if (typeof module !== "undefined" && module.exports) module.exports = DS;
})();
