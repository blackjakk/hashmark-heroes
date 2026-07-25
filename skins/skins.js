// skins.js — Skin Market Lab client (vanilla JS, no build).
// Talks to skins/server.js; analytics math is shared via analytics.js
// (window.SkinAnalytics — the exact module the server runs).
"use strict";
(function () {
  const A = window.SkinAnalytics;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // series palette (kept in sync with skins.css — validated for the dark surface)
  const css = getComputedStyle(document.documentElement);
  const COL = {
    price: css.getPropertyValue("--series-price").trim() || "#3987e5",
    sma7: css.getPropertyValue("--series-sma7").trim() || "#199e70",
    sma30: css.getPropertyValue("--series-sma30").trim() || "#d95926",
    skinport: css.getPropertyValue("--series-skinport").trim() || "#9085e9",
    vol: css.getPropertyValue("--vol-bar").trim() || "#4a4e5a",
    grid: "#23252d", text: "#7c7f88", cross: "#5a5e6a",
  };

  const state = { watch: [], selected: null, item: null, portfolio: null, range: "3M", hover: -1 };
  const RANGES = { "1M": 31, "3M": 92, "1Y": 366, "ALL": Infinity };

  // ── api ──────────────────────────────────────────────────────────────────
  // The dashboard also ships on a static host (GitHub Pages) where there is
  // no same-origin API — so the tracker address is DISCOVERED: same origin
  // first, then the last tracker that worked, then localhost. Browsers treat
  // http://localhost as a trustworthy origin, so the HTTPS Pages build may
  // call a local tracker directly (the API sends CORS headers for this).
  let API = "";
  function fetchTimeout(url, ms, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, Object.assign({ signal: ctl.signal }, opts || {})).finally(() => clearTimeout(t));
  }
  async function resolveApiBase() {
    const cands = [];
    if (location.protocol !== "file:") cands.push("");
    const saved = localStorage.getItem("skinlab_api");
    if (saved) cands.push(saved);
    cands.push("http://localhost:8790", "http://127.0.0.1:8790");
    for (const base of cands) {
      try {
        const r = await fetchTimeout(base + "/api/skins/health", 1600);
        if (r.ok && (await r.json()).ok === 1) {
          API = base;
          if (base) localStorage.setItem("skinlab_api", base);
          return true;
        }
      } catch (e) { /* next candidate */ }
    }
    return false;
  }
  async function api(p, body) {
    const r = await fetch(API + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    return j;
  }

  let toastT = null;
  function toast(msg, bad) {
    const el = $("toast");
    el.textContent = msg;
    el.className = bad ? "bad" : "";
    el.style.display = "block";
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.style.display = "none"; }, 3500);
  }

  const fmt$ = (v) => v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (v, dp) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(dp == null ? 1 : dp) + "%";
  const cls = (v) => v == null ? "" : v > 0.0005 ? "up" : v < -0.0005 ? "dn" : "";
  const ago = (t) => {
    if (!t) return "never";
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago";
  };

  // ── watchlist ────────────────────────────────────────────────────────────
  async function loadWatch() {
    state.watch = (await api("/api/skins/watchlist")).items;
    renderWatch();
  }
  function renderWatch() {
    const host = $("watchRows");
    if (!state.watch.length) {
      host.innerHTML = '<div class="hint">Nothing tracked yet — search above and click an item to start recording its price.</div>';
      return;
    }
    host.innerHTML = state.watch.map((w, i) =>
      '<div class="wrow' + (w.name === state.selected ? " sel" : "") + '" data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc(w.name) + '">' +
      '<span class="nm">' + esc(w.name) + '</span><span class="px">' + fmt$(w.latest) + '</span>' +
      '<span class="sub"><span class="chg ' + cls(w.mom7) + '">7d ' + fmtPct(w.mom7) + '</span>' +
      '<span class="chg ' + cls(w.mom30) + '">30d ' + fmtPct(w.mom30) + '</span>' +
      '<span>' + esc(w.verdict || "") + '</span></span></div>').join("");
    host.querySelectorAll(".wrow").forEach((el) => {
      const go = () => selectItem(state.watch[Number(el.dataset.i)].name);
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ── search ───────────────────────────────────────────────────────────────
  let searchT = null, searchResults = [];
  $("searchBox").addEventListener("input", () => {
    clearTimeout(searchT);
    searchT = setTimeout(runSearch, 180);
  });
  $("searchBox").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSearch();
    if (e.key === "Enter" && searchResults.length) { e.preventDefault(); pickResult(0); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".searchWrap")) closeSearch(); });
  async function runSearch() {
    const q = $("searchBox").value.trim();
    if (q.length < 2) return closeSearch();
    try {
      searchResults = (await api("/api/skins/search?q=" + encodeURIComponent(q))).results;
      const box = $("searchResults");
      box.innerHTML = searchResults.map((r, i) =>
        '<button class="sr-row" data-i="' + i + '" role="option"><span>' + esc(r.name) + '</span>' +
        '<span class="p">' + (r.watched ? '<span class="w">tracking</span> ' : "") + (r.price != null ? fmt$(r.price) : "") + "</span></button>").join("") ||
        '<div class="sr-row">No matches. Type the exact Steam market name to track anything.</div>';
      box.classList.add("open");
      box.querySelectorAll("button.sr-row").forEach((el) =>
        el.addEventListener("click", () => pickResult(Number(el.dataset.i))));
    } catch (e) { toast("search failed: " + e.message, true); }
  }
  function closeSearch() { $("searchResults").classList.remove("open"); }
  async function pickResult(i) {
    const r = searchResults[i];
    if (!r) return;
    closeSearch();
    $("searchBox").value = "";
    if (!r.watched) {
      await api("/api/skins/watch", { name: r.name });
      toast("Tracking " + r.name);
      refreshItem(r.name).catch(() => {});
    }
    await loadWatch();
    await selectItem(r.name);
  }

  // ── item view ────────────────────────────────────────────────────────────
  async function selectItem(name) {
    state.selected = name;
    state.item = await api("/api/skins/item?name=" + encodeURIComponent(name));
    renderWatch();
    renderItem();
    // stale (>60min) or missing quote → take a live snapshot automatically
    const q = state.item.quote;
    if (!q || Date.now() - q.t > 3600000) {
      $("netStatus").textContent = "snapshotting…";
      refreshItem(name).finally(() => { $("netStatus").textContent = "ready"; });
    }
  }
  async function refreshItem(name) {
    try {
      const r = await api("/api/skins/refresh", { name });
      const res = r.results && r.results[0];
      if (res && !res.ok) throw new Error(res.error || "refresh failed");
      if (state.selected === name) { state.item = await api("/api/skins/item?name=" + encodeURIComponent(name)); renderItem(); }
      await loadWatch();
    } catch (e) { toast("Snapshot failed: " + e.message, true); }
  }

  function renderItem() {
    const it = state.item;
    if (!it) return;
    const an = it.analytics, sig = an.signal || { score: 0, verdict: "—", reasons: [] };
    const sigCls = sig.score >= 12 ? "good" : sig.score <= -12 ? "bad" : "neutral";
    const sp = it.skinport || {};
    const spSales = sp.sales && (sp.sales.last24h || sp.sales.last7d);
    const cookieOn = !!(state.health && state.health.steamCookie);
    $("itemView").innerHTML =
      '<div class="panel">' +
        '<div class="itemTitle"><h2>' + esc(it.name) + '</h2>' +
        '<span class="hint">' + (it.quote ? "quote " + ago(it.quote.t) : "no snapshot yet") +
        " · " + an.days + " days of history" + (it.imported ? " (incl. imported)" : "") + "</span></div>" +
        '<div class="quoteRow">' +
          "<span>Steam median <b>" + fmt$(it.quote && it.quote.price) + "</b></span>" +
          "<span>lowest ask <b>" + fmt$(it.quote && it.quote.lowest) + "</b></span>" +
          "<span>sold 24h <b>" + (it.quote && it.quote.vol != null ? it.quote.vol : "—") + "</b></span>" +
          (sp.ask != null ? "<span>Skinport ask <b>" + fmt$(sp.ask) + "</b></span>" : "") +
        "</div>" +
        '<div class="tiles">' +
          tile("7D", fmtPct(an.mom7), cls(an.mom7)) +
          tile("30D", fmtPct(an.mom30), cls(an.mom30)) +
          tile("90D", fmtPct(an.mom90), cls(an.mom90)) +
          tile("SMA 7 / 30", fmt$(an.sma7) + " / " + fmt$(an.sma30), "") +
          tile("RSI 14", an.rsi14 == null ? "—" : Math.round(an.rsi14), "") +
          tile("VOLATILITY /YR", an.vol30 == null ? "—" : Math.round(an.vol30 * 100) + "%", "") +
          tile("OFF PEAK", an.curDD == null ? "—" : "−" + (an.curDD * 100).toFixed(1) + "%", "") +
          tile("SOLD/DAY (30D)", an.liq30 == null ? "—" : Math.round(an.liq30), "") +
        "</div>" +
        '<div class="sigCard">' +
          '<div class="sigBadge ' + sigCls + '"><span class="sc">' + (sig.score > 0 ? "+" : "") + sig.score + "</span>" + esc(sig.verdict) + "</div>" +
          '<div><ul class="sigReasons">' + sig.reasons.map((r) => "<li>" + esc(r) + "</li>").join("") +
          (sig.reasons.length ? "" : "<li>Not enough history yet — snapshots accrue daily.</li>") + "</ul>" +
          '<div class="sigNote">Heuristic score in [−100, +100] built only from the inputs above — not financial advice.</div></div>' +
        "</div>" +
      "</div>" +
      '<div class="panel">' +
        '<div class="chartHead"><div class="legend" id="legend"></div><div class="ranges" id="ranges">' +
          Object.keys(RANGES).map((r) => '<button class="btn' + (state.range === r ? " on" : "") + '" data-r="' + r + '">' + r + "</button>").join("") +
        "</div></div>" +
        '<div class="chartWrap"><canvas id="chart" role="img" aria-label="Price history chart for ' + esc(it.name) + '"></canvas></div>' +
        dataTableHtml(it) +
      "</div>" +
      '<div class="panel"><h2>WHERE TO SELL — NET PROCEEDS</h2><div class="cmpGrid">' +
        cmpBox("STEAM MARKET", it.compare.steam, "wallet funds only") +
        cmpBox("SKINPORT (REALIZED SALES)", it.compare.skinport, "cash out",
          spSales ? "median of actual sales · " + ((sp.sales.last24h && sp.sales.last24h.volume) || 0) + " sold in 24h" : "no sales data cached yet") +
      "</div></div>" +
      '<div class="panel"><div class="btnrow">' +
        '<button class="btn" id="snapBtn">⟳ Snapshot now</button>' +
        (cookieOn ? '<button class="btn" id="bootBtn" title="Pull full multi-year history from Steam using the configured cookie">⚡ Bootstrap full history</button>' : "") +
        '<button class="btn" id="importBtn">📋 Import history (paste)</button>' +
        '<a class="btn" target="_blank" rel="noopener" href="https://steamcommunity.com/market/listings/730/' + encodeURIComponent(it.name) + '">Steam page ↗</a>' +
        '<button class="btn danger" id="unwatchBtn">✕ Stop tracking</button>' +
      "</div></div>";

    $("ranges").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { state.range = b.dataset.r; renderItem(); }));
    $("snapBtn").addEventListener("click", () => { toast("Snapshotting…"); refreshItem(it.name); });
    if ($("bootBtn")) $("bootBtn").addEventListener("click", bootstrapItem);
    $("importBtn").addEventListener("click", openImport);
    $("unwatchBtn").addEventListener("click", async () => {
      await api("/api/skins/watch", { name: it.name, remove: true });
      state.selected = null; state.item = null;
      $("itemView").innerHTML = '<div class="panel"><div class="emptyChart">Pick another item from the watchlist.</div></div>';
      loadWatch();
    });
    drawChart();
  }
  const tile = (lb, v, c) => '<div class="tile"><div class="lb">' + lb + '</div><div class="v ' + c + '">' + v + "</div></div>";
  function cmpBox(title, c, cashNote, extra) {
    return '<div class="cmpBox"><h3>' + title + ' <span class="cash">' + cashNote + "</span></h3>" +
      '<div class="row"><span>Sale price</span><b>' + fmt$(c.gross) + "</b></div>" +
      '<div class="row"><span>You receive (after fees)</span><b>' + fmt$(c.net) + "</b></div>" +
      (extra ? '<div class="hint" style="margin-top:4px">' + esc(extra) + "</div>" : "") + "</div>";
  }
  function dataTableHtml(it) {
    const d = it.daily.slice(-30).reverse();
    if (!d.length) return "";
    return '<details class="dataTable"><summary>Data table (last 30 days)</summary><div class="scroll"><table class="dt">' +
      "<tr><th>Day</th><th>Price</th><th>Volume</th></tr>" +
      d.map((r) => "<tr><td>" + r.day + "</td><td>" + fmt$(r.price) + "</td><td>" + (r.vol == null ? "—" : r.vol) + "</td></tr>").join("") +
      "</table></div></details>";
  }

  async function bootstrapItem() {
    try {
      toast("Pulling full Steam history…");
      const r = await api("/api/skins/bootstrap", { name: state.selected });
      toast("Imported " + r.rows + " rows → " + r.daily + " days");
      selectItem(state.selected);
    } catch (e) { toast(e.message, true); }
  }

  // ── import modal ─────────────────────────────────────────────────────────
  function openImport() {
    const name = state.selected;
    $("importSnippet").textContent =
      'copy((await (await fetch("https://steamcommunity.com/market/pricehistory/?appid=730&market_hash_name=" + encodeURIComponent(' +
      JSON.stringify(name) + '))).json()).prices)';
    $("importText").value = "";
    $("importErr").textContent = "";
    $("importModal").classList.add("open");
    $("importText").focus();
  }
  $("importCancel").addEventListener("click", () => $("importModal").classList.remove("open"));
  $("importModal").addEventListener("click", (e) => { if (e.target === $("importModal")) $("importModal").classList.remove("open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("importModal").classList.remove("open"); });
  $("importGo").addEventListener("click", async () => {
    let rows;
    try { rows = JSON.parse($("importText").value); }
    catch (e) { $("importErr").textContent = "Not valid JSON — paste exactly what the console snippet copied."; return; }
    try {
      const r = await api("/api/skins/import", { name: state.selected, prices: rows });
      $("importModal").classList.remove("open");
      toast("Imported " + r.rows + " rows → " + r.daily + " days of history");
      selectItem(state.selected);
    } catch (e) { $("importErr").textContent = e.message; }
  });

  // ── chart (canvas, crosshair + tooltip) ──────────────────────────────────
  const PAD = { l: 52, r: 14, t: 10, b: 20, volH: 64, gap: 26 };
  let chartGeom = null;
  function visibleDaily() {
    const daily = state.item ? state.item.daily : [];
    if (!daily.length) return { rows: [], sma7: [], sma30: [] };
    const prices = daily.map((d) => d.price);
    const s7 = A.smaTrack(prices, 7), s30 = A.smaTrack(prices, 30);
    const days = RANGES[state.range];
    const cut = days === Infinity ? 0 : Math.max(0, daily.length - days);
    return { rows: daily.slice(cut), sma7: s7.slice(cut), sma30: s30.slice(cut) };
  }
  function drawChart() {
    const cv = $("chart");
    if (!cv) return;
    const { rows, sma7, sma30 } = visibleDaily();
    const wrap = cv.parentElement;
    const W = Math.max(320, wrap.clientWidth);
    const H = 300 + PAD.gap + PAD.volH + PAD.b;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.height = H + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (rows.length < 2) {
      wrap.querySelector(".emptyChart")?.remove();
      const div = document.createElement("div");
      div.className = "emptyChart";
      div.textContent = rows.length === 1
        ? "One snapshot recorded — a chart appears once there are two days of data. History accrues automatically while the tracker runs; use Import/Bootstrap for instant multi-year depth."
        : "No price history yet. Hit ⟳ Snapshot now, or Import/Bootstrap full Steam history.";
      wrap.appendChild(div);
      $("legend").innerHTML = "";
      chartGeom = null;
      return;
    }
    wrap.querySelector(".emptyChart")?.remove();

    const sp = (state.item.skinportDaily || []).filter((d) => d.t >= rows[0].t);
    const plotW = W - PAD.l - PAD.r, priceH = 300 - PAD.t;
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t || t0 + 1;
    const x = (t) => PAD.l + (t1 === t0 ? 0 : (t - t0) / (t1 - t0) * plotW);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      lo = Math.min(lo, rows[i].price); hi = Math.max(hi, rows[i].price);
      if (sma7[i] != null) { lo = Math.min(lo, sma7[i]); hi = Math.max(hi, sma7[i]); }
      if (sma30[i] != null) { lo = Math.min(lo, sma30[i]); hi = Math.max(hi, sma30[i]); }
    }
    for (const d of sp) { lo = Math.min(lo, d.price); hi = Math.max(hi, d.price); }
    const pad = (hi - lo) * 0.07 || hi * 0.05 || 1;
    lo = Math.max(0, lo - pad); hi = hi + pad;
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * priceH;

    // grid + y labels (recessive)
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = COL.text; ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (hi - lo) * i / ticks, yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : "$" + v.toFixed(v < 10 ? 2 : 0), PAD.l - 7, yy);
    }
    // x labels
    const spanD = (t1 - t0) / 86400000;
    const nLb = Math.min(6, rows.length);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = 0; i < nLb; i++) {
      const r = rows[Math.round(i * (rows.length - 1) / Math.max(1, nLb - 1))];
      const d = new Date(r.t);
      const lb = spanD > 400 ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      ctx.fillText(lb, x(r.t), H - PAD.b + 5);
    }

    // volume pane
    const volTop = 300 + PAD.gap, volMax = Math.max(1, ...rows.map((r) => r.vol || 0));
    const barW = Math.max(1, plotW / rows.length - 2);
    ctx.fillStyle = COL.vol;
    for (const r of rows) {
      if (r.vol == null) continue;
      const bh = Math.max(1, (r.vol / volMax) * PAD.volH);
      ctx.fillRect(x(r.t) - barW / 2, volTop + PAD.volH - bh, barW, bh);
    }
    ctx.fillStyle = COL.text; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("units sold / day", PAD.l, volTop - 14);

    // series lines
    const line = (pts, col, width, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.lineJoin = "round"; ctx.beginPath();
      let started = false;
      for (const p of pts) {
        if (p == null) { started = false; continue; }
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    line(rows.map((r, i) => sma30[i] == null ? null : [x(r.t), y(sma30[i])]), COL.sma30, 1.5);
    line(rows.map((r, i) => sma7[i] == null ? null : [x(r.t), y(sma7[i])]), COL.sma7, 1.5);
    line(rows.map((r) => [x(r.t), y(r.price)]), COL.price, 2);
    if (sp.length > 1) line(sp.map((d) => [x(d.t), y(d.price)]), COL.skinport, 1.5, [5, 4]);
    else if (sp.length === 1) {
      ctx.fillStyle = COL.skinport;
      ctx.beginPath(); ctx.arc(x(sp[0].t), y(sp[0].price), 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // crosshair
    if (state.hover >= 0 && state.hover < rows.length) {
      const r = rows[state.hover], xx = Math.round(x(r.t)) + 0.5;
      ctx.strokeStyle = COL.cross; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, volTop + PAD.volH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.price;
      ctx.beginPath(); ctx.arc(x(r.t), y(r.price), 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#15161a"; ctx.lineWidth = 2; ctx.stroke();
    }

    chartGeom = { rows, sma7, sma30, sp, x, y, W, H };
    renderLegend(sp.length > 0);
  }
  function renderLegend(hasSp) {
    $("legend").innerHTML =
      '<span><span class="sw" style="background:' + COL.price + '"></span>Steam price</span>' +
      '<span><span class="sw" style="background:' + COL.sma7 + '"></span>SMA 7</span>' +
      '<span><span class="sw" style="background:' + COL.sma30 + '"></span>SMA 30</span>' +
      (hasSp ? '<span><span class="sw" style="background:' + COL.skinport + '"></span>Skinport sold (median)</span>' : "");
  }

  document.addEventListener("mousemove", (e) => {
    const cv = $("chart");
    if (!cv || !chartGeom) return;
    const rc = cv.getBoundingClientRect();
    const inX = e.clientX >= rc.left && e.clientX <= rc.right;
    const inY = e.clientY >= rc.top && e.clientY <= rc.bottom;
    const tip = $("tooltip");
    if (!inX || !inY) {
      if (state.hover !== -1) { state.hover = -1; tip.style.display = "none"; drawChart(); }
      return;
    }
    const { rows, sma7, sma30, sp, x } = chartGeom;
    const px = e.clientX - rc.left;
    let best = 0, bd = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = Math.abs(x(rows[i].t) - px);
      if (d < bd) { bd = d; best = i; }
    }
    if (best !== state.hover) {
      state.hover = best;
      drawChart();
      const r = rows[best];
      const spRow = sp.find((d) => d.day === r.day);
      tip.innerHTML = '<div class="d">' + r.day + "</div>" +
        tipRow("Steam", fmt$(r.price), COL.price) +
        (sma7[best] != null ? tipRow("SMA 7", fmt$(A.round2(sma7[best])), COL.sma7) : "") +
        (sma30[best] != null ? tipRow("SMA 30", fmt$(A.round2(sma30[best])), COL.sma30) : "") +
        (spRow ? tipRow("Skinport", fmt$(spRow.price), COL.skinport) : "") +
        (r.vol != null ? tipRow("Sold", r.vol, COL.vol) : "");
      tip.style.display = "block";
    }
    const tw = tip.offsetWidth || 160;
    tip.style.left = Math.min(window.innerWidth - tw - 12, e.clientX + 16) + "px";
    tip.style.top = Math.max(8, e.clientY - 10) + "px";
  });
  const tipRow = (lb, v, col) => '<div class="r"><span><span class="sw" style="background:' + col + ';display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>' + lb + "</span><b>" + v + "</b></div>";
  window.addEventListener("resize", () => drawChart());

  // ── portfolio ────────────────────────────────────────────────────────────
  async function loadPortfolio() {
    state.portfolio = await api("/api/skins/portfolio");
    renderPortfolio();
  }
  function renderPortfolio() {
    const p = state.portfolio;
    if (!p) return;
    const t = p.totals;
    $("pfTotals").innerHTML =
      tile("COST BASIS", fmt$(t.cost), "") +
      tile("MARKET VALUE", fmt$(t.gross), "") +
      tile("NET IF SOLD (STEAM)", fmt$(t.netSteam), "") +
      tile("P/L AFTER FEES", fmt$(t.pl) + (t.cost ? " (" + fmtPct(t.pl / t.cost, 1) + ")" : ""), cls(t.pl));
    const tb = $("pfTable");
    if (!p.lots.length) { tb.innerHTML = ""; $("pfTotals").insertAdjacentHTML("beforeend", ""); return; }
    tb.innerHTML = "<tr><th>Item</th><th>Qty</th><th>Cost</th><th>Now</th><th>P/L</th><th></th></tr>" +
      p.lots.map((l, i) => "<tr><td class='nm' title='" + esc(l.name) + "'>" + esc(l.name) + "</td>" +
        "<td>" + l.qty + "</td><td>" + fmt$(l.unitCost) + "</td><td>" + fmt$(l.latest) + "</td>" +
        "<td class='chg " + cls(l.pl) + "'>" + fmt$(l.pl) + (l.plPct != null ? "<br><span class='hint'>" + fmtPct(l.plPct / 100) + "</span>" : "") + "</td>" +
        "<td><button class='xbtn' data-i='" + i + "' title='Remove lot' aria-label='Remove lot'>✕</button></td></tr>").join("");
    tb.querySelectorAll(".xbtn").forEach((b) => b.addEventListener("click", async () => {
      state.portfolio = await api("/api/skins/lot", { remove: p.lots[Number(b.dataset.i)].id });
      renderPortfolio();
    }));
  }
  $("lotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.selected) return toast("Select an item first", true);
    const qty = Number($("lotQty").value), unitCost = Number($("lotCost").value);
    try {
      state.portfolio = await api("/api/skins/lot", { name: state.selected, qty, unitCost });
      renderPortfolio();
      $("lotQty").value = ""; $("lotCost").value = "";
      toast("Lot added: " + qty + " × " + state.selected);
    } catch (err) { toast(err.message, true); }
  });

  $("refreshAllBtn").addEventListener("click", async () => {
    toast("Snapshotting whole watchlist…");
    try {
      const r = await api("/api/skins/refresh", {});
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? bad.length + " item(s) failed — Steam rate limits; retry in a minute" : "Snapshots recorded for " + r.results.length + " item(s)", !!bad.length);
      await loadWatch();
      if (state.selected) selectItem(state.selected);
      loadPortfolio();
    } catch (e) { toast(e.message, true); }
  });

  // ── boot ─────────────────────────────────────────────────────────────────
  function renderSetup() {
    $("netStatus").textContent = "tracker offline";
    $("itemView").innerHTML =
      '<div class="panel"><h2>CONNECT YOUR TRACKER</h2>' +
      '<div class="steps" style="color:var(--text-secondary);font-size:13px">' +
      "<p>This dashboard is a static page — prices are recorded by a tiny local tracker that keeps" +
      " your history and portfolio on <b>your</b> machine (Steam/Skinport block direct browser calls).</p>" +
      "<ol>" +
      "<li>Get the repo (once): <code>git clone https://github.com/blackjakk/hashmark-heroes</code></li>" +
      "<li>Start the tracker: <code>cd hashmark-heroes &amp;&amp; npm run skins</code></li>" +
      "<li>Leave it running and hit retry — this page finds it on <code>localhost:8790</code> automatically." +
      " (History accrues while it runs; it also serves this same dashboard at" +
      ' <code>http://localhost:8790</code> if your browser blocks the cross-origin hop.)</li>' +
      "</ol></div>" +
      '<div class="btnrow"><button class="btn primary" id="retryBtn">⟳ Retry connection</button>' +
      '<input id="apiAddr" placeholder="Custom tracker address (e.g. http://192.168.1.20:8790)" ' +
      'aria-label="Custom tracker address" style="flex:1;min-width:240px;padding:7px 10px;border-radius:8px;' +
      'border:1px solid var(--line);background:var(--surface-2);color:var(--text-primary)"></div></div>';
    $("retryBtn").addEventListener("click", () => {
      const v = $("apiAddr").value.trim().replace(/\/+$/, "");
      if (v) localStorage.setItem("skinlab_api", v);
      boot();
    });
  }
  async function boot() {
    $("netStatus").textContent = "connecting…";
    if (!(await resolveApiBase())) return renderSetup();
    try {
      state.health = await api("/api/skins/health");
      $("netStatus").textContent = "ready · " + (API ? API.replace(/^https?:\/\//, "") : "local") +
        (state.health.steamCookie ? " · steam cookie set" : "") +
        (state.health.snapHours ? " · auto-snap " + state.health.snapHours + "h" : "");
      await loadWatch();
      await loadPortfolio();
      if (state.watch.length) await selectItem(state.watch[0].name);
      else $("itemView").innerHTML = '<div class="panel"><div class="emptyChart">Search for an item and add it to the watchlist to begin.</div></div>';
    } catch (e) {
      renderSetup();
      toast("Tracker connection lost: " + e.message, true);
    }
  }
  boot();
})();
