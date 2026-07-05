/* =============================================================================
 * play-league-client.js — browser client for the shared-dynasty league server
 * -----------------------------------------------------------------------------
 * The client half of server/league-server.js (M1 lifecycle + FANTASY_DRAFT_
 * DESIGN.md S2): create/join a league, sit in the lobby, and — for
 * rosterMode="fantasy_draft" — run the live league draft room. The room is
 * wire-driven: the server owns the tape; this client submits PICK INTENT only
 * and re-derives everything from (poolSeed + settings + tape) via the pure
 * fantasy-draft core (play-franchise-fantasydraft.js), exactly like the SP
 * room. After draft_complete it re-derives all 32 rosters locally, sha256s
 * them, and shows the VERIFIED badge only when its own hash matches the
 * server's resultHash — the anti-cheat contract, surfaced to the user.
 *
 * "Start my franchise" then builds a normal LOCAL franchise from the drafted
 * league (same seeded finish as SP), so every member plays the identical
 * verified league with their claimed team. Server-side shared-season sim is
 * the league server's next phase (M2) — this client is forward-compatible:
 * everything it knows arrives from snapshots + SSE.
 * ========================================================================== */

"use strict";

const LG_KEY = "hh_league_session_v1";
let _lg = null;          // {base, leagueId, token, adminToken?, teamId, displayName, leagueName}
let _lgES = null;        // EventSource
let _lgLeague = null;    // last publicLeague snapshot
let _lgDraft = null;     // {poolSeed, year, order, rounds, pickClockMs, tape, done, artifactHash, resultHash}
let _lgBuilt = null;     // cached pool build (seed-keyed)
let _lgSt = null;        // derived draft state (incremental over _lgDraft.tape)
let _lgApplied = 0;
let _lgScreen = null;    // "lobby" | "draft" | "done" — which screen is mounted
let _lgFilter = "ALL";
let _lgSearch = "";
let _lgOnClock = null;   // last on_clock event data
let _lgVerify = null;    // null | "pending" | "ok" | "mismatch"
let _lgSeason = null;    // M2: GET /api/league/season/:id payload (results + standings)
let _lgSeasonVerify = null;  // default-roster gen verify: null | "pending" | "ok" | "mismatch"
let _lgSeasonVerifyKey = null; // "<leagueId>|<leagueSeed>" the verdict belongs to — NEVER show a stale badge
let _lgSeasonBuilt = null;   // cached _fdBuildDefaultLeague result (verify ⇄ start-franchise reuse)

// ── session + api ───────────────────────────────────────────────────────────
function _lgLoad() {
  try { _lg = JSON.parse(localStorage.getItem(LG_KEY) || "null"); } catch { _lg = null; }
  return _lg;
}
function _lgSaveSession() { try { localStorage.setItem(LG_KEY, JSON.stringify(_lg)); } catch {} }
function _lgClearSession() {
  try { localStorage.removeItem(LG_KEY); } catch {}
  _lg = null; _lgLeague = null; _lgDraft = null; _lgBuilt = null; _lgSt = null; _lgApplied = 0;
  _lgSeason = null; _lgSeasonVerify = null; _lgSeasonVerifyKey = null; _lgSeasonBuilt = null;
  if (_lgES) { try { _lgES.close(); } catch {} _lgES = null; }
}
function _lgDefaultBase() {
  // Single-process deploy (league server with --static) → same origin. The
  // create form exposes an editable field for split dev setups, and invite
  // links carry the base explicitly (the H2H-link pattern), so no guessing.
  return /^https?:/.test(location.origin) ? location.origin : "http://localhost:8788";
}
async function _lgApi(path, body) {
  const base = (_lg && _lg.base) || _lgDefaultBase();
  const r = await fetch(base + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("league server error " + r.status));
  return j;
}
function _lgHost() { return $("frnHomeContent"); }
function _lgHideShell() {
  for (const id of ["frnNavBar", "frnAppShell", "frnAppFooter"]) {
    const el = document.getElementById(id); if (el) el.style.display = "none";
  }
}
function _lgTeam(id) { return TEAMS.find(t => t.id === id) || { city: "?", name: "Team " + id, primary: "#888" }; }
function _lgMemberFor(teamId) { return (_lgLeague?.members || []).find(m => m.teamId === teamId) || null; }

// ── entry: start-screen card + deep link ────────────────────────────────────
function frnLeagueHome() {
  _lgHideShell();
  _lgLoad();
  if (_lg && _lg.leagueId) { _lgResume(); return; }
  renderLeagueCreate();
}

function renderLeagueCreate() {
  _lgHideShell();
  const teamOpts = TEAMS.map(t => ({ value: t.id, label: `${t.city} ${t.name}` }));
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🌐</div>
      <div class="fps-hero-title">ONLINE LEAGUE</div>
      <div class="fps-hero-sub">One league, real people — a commissioner, a lobby, and (if you dare) a full fantasy draft</div>
    </div>
    <div style="max-width:34rem;margin:0 auto">
      <div class="fps-section-title">CREATE A LEAGUE</div>
      <div style="display:flex;flex-direction:column;gap:.6rem">
        <label style="font-size:.72rem;color:var(--gray)">League name
          <input id="lgName" type="text" value="Sunday Dynasty" maxlength="60" style="width:100%"></label>
        <label style="font-size:.72rem;color:var(--gray)">Your GM name
          <input id="lgGm" type="text" value="Commish" maxlength="40" style="width:100%"></label>
        <label style="font-size:.72rem;color:var(--gray)">Your team
          ${DS.select({ id: "lgTeam", options: teamOpts, value: TEAMS[0].id })}</label>
        <label style="font-size:.72rem;color:var(--gray)">League server
          <input id="lgBase" type="text" value="${_escHtml(_lgDefaultBase())}" style="width:100%"></label>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-top:.2rem">
          <span style="font-size:.68rem;color:var(--gray);letter-spacing:1px">ROSTERS:</span>
          ${DS.chip({ label: "Default rosters", active: !_lgCreateFantasy, on: "_lgSetCreateFantasy(false)" })}
          ${DS.chip({ label: "🧢 Fantasy draft", active: _lgCreateFantasy, on: "_lgSetCreateFantasy(true)" })}
        </div>
        <div id="lgDraftOpts" style="display:${_lgCreateFantasy ? "flex" : "none"};align-items:center;gap:.5rem;flex-wrap:wrap">
          <span style="font-size:.68rem;color:var(--gray);letter-spacing:1px">ROUNDS YOU CALL:</span>
          ${[12, 25, 51].map(r => DS.chip({ label: String(r), active: _lgCreateRounds === r, on: `_lgSetCreateRounds(${r})` })).join("")}
          <span style="font-size:.68rem;color:var(--gray);letter-spacing:1px;margin-left:.6rem">PICK CLOCK:</span>
          ${DS.select({ id: "lgClock", value: String(_lgCreateClock), options: [
            { value: "0", label: "No clock" }, { value: "60000", label: "1 minute" },
            { value: "3600000", label: "1 hour" }, { value: "86400000", label: "24 hours" },
          ] })}
        </div>
        ${DS.button({ label: "🌐 Create league", variant: "gold", on: "frnLeagueCreateSubmit(this)" })}
        <div style="text-align:center;color:var(--gray);font-size:.72rem">
          Joining instead? Open the commissioner's <b>#league=…</b> link — it lands you in the lobby.
        </div>
        ${DS.button({ label: "← Back", variant: "outline", on: "_lgLeaveScreens();renderFrnStartScreen()" })}
      </div>
    </div>`;
}
let _lgCreateFantasy = true, _lgCreateRounds = 12, _lgCreateClock = 86400000;
function _lgSetCreateFantasy(v) { _lgCreateFantasy = !!v; renderLeagueCreate(); }
function _lgSetCreateRounds(r) { _lgCreateRounds = r; renderLeagueCreate(); }

async function frnLeagueCreateSubmit(btn) {
  const base = (document.getElementById("lgBase")?.value || _lgDefaultBase()).replace(/\/+$/, "");
  const name = document.getElementById("lgName")?.value || "New Dynasty";
  const gm = document.getElementById("lgGm")?.value || "Commissioner";
  // DS.select puts the id on the <select> element itself.
  const teamId = Number(document.getElementById("lgTeam")?.value || TEAMS[0].id);
  const clock = Number(document.getElementById("lgClock")?.value ?? _lgCreateClock);
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    _lg = { base };
    const r = await _lgApi("/api/league", {
      name, adminTeamId: teamId, adminName: gm,
      settings: _lgCreateFantasy
        ? { rosterMode: "fantasy_draft", draftRounds: _lgCreateRounds, pickClockMs: clock }
        : { rosterMode: "default" },
    });
    _lg = { base, leagueId: r.leagueId, token: r.memberToken, adminToken: r.adminToken,
            teamId: r.teamId, displayName: gm, leagueName: name, joinCode: r.joinCode };
    _lgSaveSession();
    await _lgResume();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't create the league — " + e.message, kind: "error" });
  } finally {
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}

// Deep link: #league=<leagueId>.<inviteOrJoinCode>
async function frnLeagueJoinFromHash() {
  // #league=<id>.<token>[.<encodedServerBase>] — server-minted links omit the
  // base (same-origin deploy); lobby share links include it (h2h pattern).
  const m = /^#league=([a-z0-9]+)\.([A-Za-z0-9]+)(?:\.(.+))?$/.exec(location.hash || "");
  if (!m) return false;
  _lgLoad();
  if (_lg && _lg.leagueId === m[1]) { frnLeagueHome(); return true; } // already a member
  const base = m[3] ? decodeURIComponent(m[3]).replace(/\/+$/, "") : _lgDefaultBase();
  renderLeagueJoin(m[1], m[2], base);
  return true;
}
function renderLeagueJoin(leagueId, inviteToken, base) {
  _lgHideShell();
  const fh = document.getElementById("franchiseHome"); if (fh) fh.style.display = "block";
  _lg = { base };
  _lgApi(`/api/league/${leagueId}?token=${encodeURIComponent(inviteToken)}`).catch(() => null).then(snap => {
    // The invite token isn't a member token, so the snapshot may 403 — join
    // blind in that case (the server enforces seat availability anyway).
    const taken = new Set(snap?.league?.takenTeams || []);
    const cards = TEAMS.map(t => {
      const gone = taken.has(t.id);
      return `<button class="fps-start" ${gone ? "disabled style=\"opacity:.4;cursor:not-allowed\"" : ""}
        onclick="frnLeagueJoinSubmit('${_escHtml(leagueId)}','${_escHtml(inviteToken)}',${t.id},this)">
        <div class="fps-start-icon" aria-hidden="true" style="color:${t.primary}">⬢</div>
        <div class="fps-start-name">${_escHtml(t.city)} ${_escHtml(t.name)}</div>
        <div class="fps-start-desc">${gone ? "Taken" : "Claim this franchise"}</div>
      </button>`;
    }).join("");
    _lgHost().innerHTML = `
      <div class="fps-hero" style="margin-bottom:1rem">
        <div class="fps-hero-badge">🌐</div>
        <div class="fps-hero-title">JOIN ${_escHtml(snap?.league?.name || "LEAGUE")}</div>
        <div class="fps-hero-sub">Pick your GM name and claim a team</div>
      </div>
      <div style="max-width:34rem;margin:0 auto .8rem">
        <label style="font-size:.72rem;color:var(--gray)">Your GM name
          <input id="lgGm" type="text" value="GM" maxlength="40" style="width:100%"></label>
      </div>
      <div class="fps-starts">${cards}</div>`;
  });
}
async function frnLeagueJoinSubmit(leagueId, inviteToken, teamId, btn) {
  const gm = document.getElementById("lgGm")?.value || "GM";
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const r = await _lgApi("/api/league/join", { leagueId, token: inviteToken, teamId, displayName: gm });
    _lg = { base: _lg.base, leagueId, token: r.memberToken, teamId: r.teamId,
            displayName: gm, leagueName: r.league?.name || "League", joinCode: null };
    _lgSaveSession();
    history.replaceState(null, "", location.pathname + location.search); // drop the invite hash
    await _lgResume();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't join — " + e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}

// ── resume + SSE ────────────────────────────────────────────────────────────
async function _lgResume() {
  try {
    const snap = await _lgApi(`/api/league/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}`);
    _lgLeague = snap.league;
    _lg.leagueName = snap.league.name;
    _lgSaveSession();
    _lgConnectSSE();
    if (_lgLeague.phase === "drafting") return _lgEnterDraft();
    // M2: a started league lands on the shared-season screen (the draft-done
    // verify screen stays reachable from there for fantasy leagues).
    if (_lgLeague.phase === "active" || _lgLeague.phase === "season_complete") return _lgEnterSeason();
    renderLeagueLobby();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "League unreachable — " + e.message, kind: "error" });
    renderLeagueCreate();
  }
}
function _lgConnectSSE() {
  if (_lgES) { try { _lgES.close(); } catch {} }
  const url = `${_lg.base}/api/league/events/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}&since=${_lgLeague?.seq || 0}`;
  _lgES = new EventSource(url);
  const rerender = () => {
    if (_lgScreen === "lobby") renderLeagueLobby();
    else if (_lgScreen === "draft") renderLeagueDraftRoom();
  };
  _lgES.addEventListener("member_joined", (e) => {
    const d = JSON.parse(e.data);
    if (_lgLeague && !_lgLeague.members.some(m => m.teamId === d.teamId)) {
      _lgLeague.members.push({ teamId: d.teamId, displayName: d.displayName });
      _lgLeague.takenTeams = _lgLeague.members.map(m => m.teamId);
    }
    rerender();
  });
  _lgES.addEventListener("settings", (e) => { if (_lgLeague) _lgLeague.settings = JSON.parse(e.data); rerender(); });
  _lgES.addEventListener("draft_started", () => { _lgEnterDraft(); });
  _lgES.addEventListener("on_clock", (e) => { _lgOnClock = JSON.parse(e.data); if (_lgScreen === "draft") renderLeagueDraftRoom(); });
  _lgES.addEventListener("pick", (e) => { const d = JSON.parse(e.data); _lgApplyWirePicks(d.i, [[d.teamId, d.pid]]); });
  _lgES.addEventListener("picks", (e) => { const d = JSON.parse(e.data); _lgApplyWirePicks(d.from, d.picks); });
  _lgES.addEventListener("draft_complete", (e) => {
    const d = JSON.parse(e.data);
    if (_lgDraft) { _lgDraft.done = true; _lgDraft.artifactHash = d.artifactHash; _lgDraft.resultHash = d.resultHash; }
    _lgRefreshDraft().then(() => renderLeagueDone());
  });
  _lgES.addEventListener("started", (e) => {
    const d = JSON.parse(e.data);
    if (_lgLeague) {
      _lgLeague.phase = "active";
      if (d.leagueSeed != null) _lgLeague.leagueSeed = d.leagueSeed;
      if (d.rostersHash) _lgLeague.rostersHash = d.rostersHash;
    }
    // Members waiting in the LOBBY follow the commissioner into the season.
    // A client on the draft-done screen stays there — that's the verify moment.
    if (_lgScreen === "lobby") _lgEnterSeason();
  });
  // M2 shared season: the server sims the week and streams the ledger.
  _lgES.addEventListener("week_results", (e) => {
    const d = JSON.parse(e.data);
    if (_lgSeason) { _lgSeason.results[d.week] = d.results; _lgSeason.standings = d.standings; }
    if (_lgLeague) _lgLeague.standings = d.standings;
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("advanced", (e) => {
    const d = JSON.parse(e.data);
    for (const o of [_lgLeague, _lgSeason]) {
      if (!o) continue;
      if (d.season) o.season = d.season;
      if (d.week) o.week = d.week;
      if (d.phase) o.phase = d.phase;
    }
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.onerror = () => { /* EventSource auto-reconnects; snapshots resync on screen entry */ };
}

// ── lobby ───────────────────────────────────────────────────────────────────
function renderLeagueLobby() {
  _lgScreen = "lobby";
  _lgHideShell();
  const L = _lgLeague;
  const isAdmin = !!_lg.adminToken;
  const link = `${location.origin}${location.pathname}#league=${L.id}.${_lg.joinCode || L.joinCode || ""}.${encodeURIComponent(_lg.base)}`;
  const memberRows = L.members.map(m => {
    const t = _lgTeam(m.teamId);
    return `<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;border-left:3px solid ${t.primary}">
      <b style="min-width:11rem">${_escHtml(t.city)} ${_escHtml(t.name)}</b>
      <span style="color:var(--gray)">${_escHtml(m.displayName || "GM")}</span>
      ${m.isAdmin ? DS.chip({ label: "COMMISH", variant: "gold" }) : ""}
    </div>`;
  }).join("");
  const fd = L.settings.rosterMode === "fantasy_draft";
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🌐</div>
      <div class="fps-hero-title">${_escHtml(L.name)}</div>
      <div class="fps-hero-sub">LOBBY · ${L.members.length} GM${L.members.length === 1 ? "" : "s"} ·
        ${fd ? `🧢 fantasy draft (${L.settings.draftRounds} live rounds)` : "default rosters"}</div>
    </div>
    <div style="max-width:40rem;margin:0 auto;display:flex;flex-direction:column;gap:.5rem">
      ${memberRows}
      <div style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap">
        <input id="lgShare" type="text" readonly value="${_escHtml(link)}" style="flex:1;min-width:16rem;font-size:.7rem">
        ${DS.button({ label: "📋 Copy invite link", variant: "outline", size: "sm",
          on: "navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('lgShare').value);DS.toast('Invite link copied')" })}
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap">
        ${isAdmin ? DS.button({ label: fd ? "🧢 Start the league — draft night" : "▶ Start the league",
            variant: "gold", on: "frnLeagueStart(this)",
            title: fd ? "Locks the lobby, mints the pool seed, and opens the draft" : "Locks the lobby and starts season 1" }) : ""}
        ${DS.button({ label: "↻ Refresh", variant: "outline", on: "_lgResume()" })}
        ${DS.button({ label: "🚪 Leave league", variant: "outline", on: "frnLeagueLeave()" })}
        ${DS.button({ label: "⌂ Home", variant: "outline", on: "_lgLeaveScreens();renderFrnStartScreen()" })}
      </div>
      ${!isAdmin ? `<p style="color:var(--gray);font-size:.72rem">Waiting on the commissioner to start.</p>` : ""}
    </div>`;
}
async function frnLeagueStart(btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    await _lgApi("/api/league/start", { leagueId: _lg.leagueId, adminToken: _lg.adminToken });
    // fantasy leagues emit draft_started over SSE (handled); default leagues:
    const snap = await _lgApi(`/api/league/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}`);
    _lgLeague = snap.league;
    if (_lgLeague.phase === "drafting") _lgEnterDraft();
    else if (_lgLeague.phase === "active") _lgEnterSeason();
    else renderLeagueLobby();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}
async function frnLeagueLeave() {
  const ok = await _frnConfirm("Leave this league on this device? (Your seat stays claimed on the server — keep the link to come back.)",
    { title: "Leave league?", confirmLabel: "🚪 Leave" });
  if (!ok) return;
  _lgClearSession();
  renderFrnStartScreen();
}

// ── M2: the shared season (server-simmed weeks → standings, over SSE) ───────
// The server owns every result; this screen only renders the published ledger
// (season snapshot + week_results events) and — for default-roster leagues —
// re-derives the canonical rosters from the leagueSeed to pin the VERIFIED
// badge, the same anti-cheat moment the draft-done screen has.
async function _lgEnterSeason() {
  _lgScreen = "season";
  _lgHideShell();
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🌐</div>
      <div class="fps-hero-title">${_escHtml(_lg.leagueName || "LEAGUE")}</div>
      <div class="fps-hero-sub">Fetching the season ledger…</div>
    </div>
    ${DS.skeleton({ variant: "table", rows: 8, cols: 4, label: "Loading standings and results…" })}`;
  try {
    await _lgRefreshSeason();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Season unreachable — " + e.message, kind: "error" });
    renderLeagueLobby();
    return;
  }
  renderLeagueSeason();
  // Verdict is keyed to (leagueId, leagueSeed) — switching leagues (or a
  // server changing its published seed) forces a fresh comparison instead of
  // showing another league's VERIFIED badge.
  const vKey = `${_lg.leagueId}|${_lgSeason.leagueSeed}`;
  if (_lgSeason.rosterMode !== "fantasy_draft" && _lgSeasonVerifyKey !== vKey) _lgVerifySeasonRosters();
}
async function _lgRefreshSeason() {
  _lgSeason = await _lgApi(`/api/league/season/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}`);
}
// Re-derive the 32 default rosters from the published (leagueSeed, year) and
// compare hashes — proof the server didn't hand-craft anyone's roster.
async function _lgVerifySeasonRosters() {
  if (!_lgSeason || _lgSeason.leagueSeed == null || !_lgSeason.rostersHash) return;
  _lgSeasonVerify = "pending";
  _lgSeasonVerifyKey = `${_lg.leagueId}|${_lgSeason.leagueSeed}`;
  if (_lgScreen === "season") renderLeagueSeason();
  await new Promise(r => setTimeout(r, 30));   // paint the pending chip before the ~1s synchronous gen
  try {
    if (!_lgSeasonBuilt || _lgSeasonBuilt._seed !== _lgSeason.leagueSeed) {
      _lgSeasonBuilt = _fdBuildDefaultLeague(_lgSeason.leagueSeed, _lgSeason.year);
      _lgSeasonBuilt._seed = _lgSeason.leagueSeed;
    }
    const mine = await _lgSha256(_fdRosterIds(_lgSeasonBuilt.rosters));
    _lgSeasonVerify = mine === _lgSeason.rostersHash ? "ok" : "mismatch";
  } catch { _lgSeasonVerify = null; _lgSeasonVerifyKey = null; } // no crypto.subtle — skip, don't fake it (key cleared so re-entry retries)
  if (_lgScreen === "season") renderLeagueSeason();
}
// Server-sourced numbers are COERCED before hitting innerHTML — a malicious
// league server (the deep-link base is attacker-choosable) must not be able
// to smuggle markup through "numeric" fields (adversarial-review finding).
function _lgNum(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function _lgStandingsRows(conf) {
  const st = _lgSeason.standings || {};
  const rows = TEAMS.filter(t => t.conference === conf).map(t => {
    const raw = st[t.id] || {};
    const s = { w: _lgNum(raw.w), l: _lgNum(raw.l), t: _lgNum(raw.t), pf: _lgNum(raw.pf), pa: _lgNum(raw.pa) };
    const gp = s.w + s.l + s.t;
    return { t, s, pct: gp ? (s.w + s.t / 2) / gp : 0, diff: s.pf - s.pa };
  }).sort((a, b) => b.pct - a.pct || b.diff - a.diff || a.t.id - b.t.id);
  return rows.map(({ t, s, diff }) => {
    const gm = _lgMemberFor(t.id);
    const mine = t.id === _lg.teamId;
    return `<tr${mine ? ' style="background:rgba(212,175,55,.08)"' : ""}>
      <td style="text-align:left;white-space:nowrap"><b style="color:${t.primary}">⬢</b> ${_escHtml(t.city)} ${_escHtml(t.name)}
        ${gm ? `<span style="color:var(--gray);font-size:.62rem"> · ${_escHtml(gm.displayName)}</span>` : ""}</td>
      <td style="font-weight:700">${s.w}-${s.l}${s.t ? "-" + s.t : ""}</td>
      <td style="color:var(--gray)">${s.pf}</td>
      <td style="color:var(--gray)">${s.pa}</td>
      <td style="color:${diff > 0 ? "var(--ds-grade-pos)" : diff < 0 ? "var(--ds-grade-neg)" : "var(--gray)"}">${diff > 0 ? "+" : ""}${diff}</td>
    </tr>`;
  }).join("");
}
function renderLeagueSeason() {
  if (!_lgSeason) return;
  _lgScreen = "season";
  const S = _lgSeason;
  const done = S.phase === "season_complete";
  const fantasy = S.rosterMode === "fantasy_draft";
  const weeks = Object.keys(S.results || {}).map(Number).sort((a, b) => a - b);
  const lastWeek = weeks.length ? weeks[weeks.length - 1] : 0;
  const isAdmin = !!_lg.adminToken;

  const scoreRow = (g) => {
    const h = _lgTeam(_lgNum(g.homeId)), a = _lgTeam(_lgNum(g.awayId));
    const hs = _lgNum(g.homeScore), as = _lgNum(g.awayScore);
    const mine = _lgNum(g.homeId) === _lg.teamId || _lgNum(g.awayId) === _lg.teamId;
    const hWin = hs > as, aWin = as > hs;
    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.28rem .55rem;border:1px solid var(--border);border-radius:8px${mine ? ";border-color:var(--gold);background:rgba(212,175,55,.07)" : ""}"
      title="result hash ${_escHtml((g.resultHash || "").slice(0, 16))}…">
      <span style="flex:1;text-align:right${aWin ? ";font-weight:800" : ""}">${_escHtml((a.abbr || a.name.slice(0, 3)).toUpperCase())} ${as}</span>
      <span style="color:var(--gray);font-size:.6rem">@</span>
      <span style="flex:1${hWin ? ";font-weight:800" : ""}">${_escHtml((h.abbr || h.name.slice(0, 3)).toUpperCase())} ${hs}</span>
    </div>`;
  };
  const results = lastWeek ? (S.results[lastWeek] || []).map(scoreRow).join("") : "";
  const upcoming = !done ? generateFranchiseSchedule().filter(g => g.week === _lgNum(S.week)).map(g => {
    const h = _lgTeam(g.homeId), a = _lgTeam(g.awayId);
    const mine = g.homeId === _lg.teamId || g.awayId === _lg.teamId;
    return `<span class="ds-chip"${mine ? ' style="border-color:var(--gold);color:var(--gold-lt)"' : ""}>${_escHtml((a.abbr || a.name.slice(0, 3)).toUpperCase())} @ ${_escHtml((h.abbr || h.name.slice(0, 3)).toUpperCase())}</span>`;
  }).join(" ") : "";

  const verifyChip = fantasy
    ? (S.draft ? `<span class="ds-chip" title="Roster genesis = the finished draft — verified on the draft results screen">🧢 genesis: draft <code style="font-size:.6rem">${_escHtml((S.draft.artifactHash || "").slice(0, 10))}…</code></span>` : "")
    : _lgSeasonVerify === "ok"
      ? `<span class="ds-chip" style="color:var(--ds-grade-pos);border-color:var(--ds-grade-pos)" title="This client re-derived all 32 rosters from the published leagueSeed and matched the server's hash">✓ ROSTERS VERIFIED</span>`
      : _lgSeasonVerify === "mismatch"
        ? `<span class="ds-chip" style="color:var(--ds-grade-neg);border-color:var(--ds-grade-neg)" title="Locally derived rosters do NOT match the server's hash — do not trust this league">⚠ ROSTER HASH MISMATCH</span>`
        : _lgSeasonVerify === "pending"
          ? `<span class="ds-chip" style="color:var(--gray)">… verifying rosters</span>`
          : "";

  const confTable = (conf) => `
    <div>
      <div class="fps-section-title" style="margin-top:0">${conf}</div>
      <table class="frn-ana-table"><thead>
        <tr><th style="text-align:left">Team</th><th>W-L</th><th>PF</th><th>PA</th><th>+/-</th></tr>
      </thead><tbody>${_lgStandingsRows(conf)}</tbody></table>
    </div>`;

  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:.8rem">
      <div class="fps-hero-badge">🌐</div>
      <div class="fps-hero-title">${_escHtml(_lg.leagueName || "LEAGUE")}</div>
      <div class="fps-hero-sub">${done
        ? `<b style="color:var(--gold-lt)">SEASON ${_lgNum(S.season)} COMPLETE</b> · ${weeks.length} weeks in the books — playoffs land in the next milestone`
        : `SEASON ${_lgNum(S.season)} · WEEK ${_lgNum(S.week)} of ${_lgNum(S.weeks) || 18} · one shared season, simmed by the league server`}</div>
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:center;margin-bottom:1rem">${verifyChip}</div>
    ${isAdmin && !done ? `<div style="display:flex;justify-content:center;margin-bottom:1rem">
      ${DS.button({ label: `▶ Advance — sim week ${_lgNum(S.week)}`, variant: "gold", on: "frnLeagueAdvanceWeek(this)",
        title: "Sims every game of the current week on the server; results + hashes broadcast to all members" })}</div>` : ""}
    ${!isAdmin && !done ? `<p style="text-align:center;color:var(--gray);font-size:.72rem;margin-bottom:1rem">The commissioner advances the week — results arrive here live.</p>` : ""}
    ${lastWeek ? `
      <div class="fps-section-title">WEEK ${lastWeek} RESULTS</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:.4rem;max-width:56rem;margin:0 auto 1rem">${results}</div>` : ""}
    ${upcoming ? `
      <div class="fps-section-title">WEEK ${_lgNum(S.week)} MATCHUPS</div>
      <div style="display:flex;gap:.35rem;flex-wrap:wrap;justify-content:center;max-width:56rem;margin:0 auto 1rem">${upcoming}</div>` : ""}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:1rem;max-width:56rem;margin:0 auto 1rem">
      ${confTable("AFC")}${confTable("NFC")}
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-top:.4rem">
      ${fantasy
        ? DS.button({ label: "🧢 Draft results & verify", variant: "outline", on: "_lgEnterDraft()" })
        : DS.button({ label: "▶ Start my franchise from this league", variant: "gold", on: "frnLeagueStartLocalDefault(this)",
            disabled: _lgSeasonVerify === "mismatch",
            title: _lgSeasonVerify === "mismatch"
              ? "Roster hash mismatch — this league's genesis could not be verified; do not build from it"
              : "Creates a local franchise with the canonical 32-team league — every member derives the identical rosters" })}
      ${DS.button({ label: "↻ Refresh", variant: "outline", on: "_lgEnterSeason()" })}
      ${DS.button({ label: "🚪 Leave league", variant: "outline", on: "frnLeagueLeave()" })}
      ${DS.button({ label: "⌂ Home", variant: "outline", on: "_lgLeaveScreens();renderFrnStartScreen()" })}
    </div>`;
}
// Leaving the league surfaces for another screen (dashboard, start screen)
// MUST drop _lgScreen — SSE handlers re-render "the current league screen"
// and would otherwise stomp whatever replaced it (adversarial-review finding).
function _lgLeaveScreens() { _lgScreen = null; }
async function frnLeagueAdvanceWeek(btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const r = await _lgApi("/api/league/advance", { leagueId: _lg.leagueId, adminToken: _lg.adminToken });
    await _lgRefreshSeason();
    renderLeagueSeason();
    if (typeof DS !== "undefined") DS.toast({ message: `✓ Week simmed — ${r.simmed ?? ""} games final`, kind: "success", duration: 2400 });
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: e.message, kind: "warn" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}
// Default-roster twin of frnLeagueStartLocalFranchise: the canonical league
// comes straight from (leagueSeed, year); contracts sign under the derived
// seed exactly like _fdFinish, then the standard franchise boot.
async function frnLeagueStartLocalDefault(btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    await new Promise(r => setTimeout(r, 30));   // let the busy state paint before the gen
    if (!_lgSeasonBuilt || _lgSeasonBuilt._seed !== _lgSeason.leagueSeed) {
      _lgSeasonBuilt = _fdBuildDefaultLeague(_lgSeason.leagueSeed, _lgSeason.year);
      _lgSeasonBuilt._seed = _lgSeason.leagueSeed;
    }
    const meta = _readSlotsMeta();
    meta.activeSlotId = null; // fresh slot — never stomps an existing save
    _writeSlotsMeta(meta);
    franchise = {
      chosenTeamId: _lg.teamId,
      season: 1, week: 1,
      phase: "preseason",
      rosters: JSON.parse(JSON.stringify(_lgSeasonBuilt.rosters)),
      teamTiers: { ..._lgSeasonBuilt.teamTiers },
      salaryCap: SALARY_CAP_BASE,
      schedule: generateFranchiseSchedule(),
      standings: initStandings(),
      playoffBracket: null, history: [], pendingFranchiseGame: null,
      rngSeedBase: (Math.random() * 0xFFFFFFFF) >>> 0,
      _offChanges: null, seasonStats: {}, seasonHighlights: [],
      superBowlGame: null, ir: {}, _irReturnsUsed: {},
      leagueSeason: { id: _lg.leagueId, leagueSeed: _lgSeason.leagueSeed, year: _lgSeason.year, rostersHash: _lgSeason.rostersHash },
    };
    _fdSeededScope((_lgSeason.leagueSeed ^ 0x5eed5eed) >>> 0, () =>
      assignContracts(franchise.rosters, SALARY_CAP_BASE));
    _initFranchisePicks();
    _initCoachingStaff();
    _initFrontOffice();
    _seedPracticeSquads();
    if (typeof _seedCollegePipeline === "function") _seedCollegePipeline();
    saveFranchise();
    _lgLeaveScreens();   // SSE season events must not repaint over the dashboard
    showFranchiseDashboard();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't build the franchise — " + e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}

// ── league draft room ───────────────────────────────────────────────────────
async function _lgEnterDraft() {
  _lgScreen = "draft";
  _lgHideShell();
  // The pool build after the fetch is a genuinely-async gap → skeleton.
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🧢</div>
      <div class="fps-hero-title">DRAFT NIGHT</div>
      <div class="fps-hero-sub">Fetching the pool seed and rebuilding the board…</div>
    </div>
    ${DS.skeleton({ variant: "table", rows: 6, cols: 4, label: "Deriving the draft from the seed…" })}`;
  await _lgRefreshDraft();
  if (_lgDraft.done) { renderLeagueDone(); return; }
  renderLeagueDraftRoom();
}
async function _lgRefreshDraft() {
  const d = await _lgApi(`/api/league/draft/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}`);
  _lgDraft = d;
  if (!_lgBuilt || _lgBuilt._seed !== d.poolSeed) {
    _lgBuilt = _fdBuildPool(d.poolSeed, d.year);
    _lgBuilt.order = d.order;
    _lgBuilt._seed = d.poolSeed;
    _lgSt = null; _lgApplied = 0;
  }
  if (!_lgSt) { _lgSt = _fdNewState(_lgBuilt); _lgApplied = 0; }
  for (; _lgApplied < d.tape.length; _lgApplied++) _fdApplyPick(_lgSt, d.tape[_lgApplied]);
  _lgSt.pickIdx = d.tape.length;
}
function _lgApplyWirePicks(from, picks) {
  if (!_lgDraft || _lgDraft.done) return;
  // Index-deduped append: wire events can overlap a snapshot resync.
  let i = from;
  for (const [teamId, pid] of picks) {
    if (i >= _lgDraft.tape.length) {
      const e = { teamId, pid, auto: true };
      _lgDraft.tape.push(e);
      if (_lgSt) { _fdApplyPick(_lgSt, e); _lgSt.pickIdx = _lgDraft.tape.length; _lgApplied = _lgDraft.tape.length; }
    }
    i++;
  }
  if (_lgScreen === "draft") renderLeagueDraftRoom();
}
function _lgSetFilter(pos) { _lgFilter = pos; renderLeagueDraftRoom(); }
function _lgSetSearch(v) {
  _lgSearch = String(v || "");
  renderLeagueDraftRoom();
  const el = document.getElementById("lgSearch");
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
// Private pick queue: kept on the session (survives reload) and synced to the
// server, whose clock-timeout auto-pick honors it (queue head → BPA fallback).
function _lgQueueSync() {
  _lgSaveSession();
  _lgApi("/api/league/draft/queue", { leagueId: _lg.leagueId, token: _lg.token, pids: _lg.queue || [] })
    .catch(() => { if (typeof DS !== "undefined") DS.toast({ message: "Queue not synced — server unreachable (it still works locally)", kind: "warn" }); });
}
function frnLeagueQueueToggle(pid) {
  _lg.queue = _lg.queue || [];
  const i = _lg.queue.indexOf(pid);
  if (i >= 0) _lg.queue.splice(i, 1); else _lg.queue.push(pid);
  _lgQueueSync();
  renderLeagueDraftRoom();
}
function frnLeagueQueueMove(pid, dir) {
  const q = _lg.queue || [];
  const i = q.indexOf(pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  _lgQueueSync();
  renderLeagueDraftRoom();
}

function renderLeagueDraftRoom() {
  if (!_lgDraft || !_lgSt) return;
  _lgScreen = "draft";
  const st = _lgSt;
  const n = _lgDraft.order.length;
  const total = n * FD_PICKS_PER_TEAM;
  const interactive = _lgDraft.rounds * n;
  const round = Math.min(_lgDraft.rounds, Math.floor(st.pickIdx / n) + 1);
  const teamId = st.pickIdx < total ? _fdOnClock(st, st.pickIdx) : null;
  const mine = teamId === _lg.teamId;
  const clockTeam = teamId != null ? _lgTeam(teamId) : null;
  const clockGm = teamId != null ? _lgMemberFor(teamId) : null;
  const myCounts = st.counts[_lg.teamId] || {};
  const myRoster = st.rosters[_lg.teamId] || [];
  const clockMs = _lgDraft.pickClockMs || 0;

  const recent = _lgDraft.tape.slice(-8).map((e, i) => {
    const p = st.byPid.get(e.pid); const t = _lgTeam(e.teamId);
    const overall = _lgDraft.tape.length - Math.min(8, _lgDraft.tape.length) + i + 1;
    const gm = _lgMemberFor(e.teamId);
    return `<span class="ds-chip" title="${_escHtml(t.city + " " + t.name)}${gm ? " — " + _escHtml(gm.displayName) : ""}" style="border-color:${t.primary}">
      #${overall} ${_escHtml((t.abbr || t.name.slice(0, 3)).toUpperCase())} · ${p ? p.position + " " + _escHtml(p.name) : e.pid} ${p ? `<b style="color:var(--gold-lt)">${p.overall}</b>` : ""}</span>`;
  }).join(" ");

  const needChips = FD_POSITIONS.map(pos => {
    const have = myCounts[pos] || 0, floor = FD_FLOORS[pos] || 0, tgt = FD_TARGET[pos];
    const col = have < floor ? "var(--ds-grade-neg)" : have < tgt ? "var(--ds-grade-warn)" : "var(--ds-grade-pos)";
    return `<span class="ds-chip" style="color:${col};border-color:${col}">${pos} ${have}/${tgt}${have < floor ? " ⚠" : ""}</span>`;
  }).join(" ");

  const qs = _lgSearch.trim().toLowerCase();
  const queue = _lg.queue || [];
  const avail = st.pool.filter(p => !st.taken.has(p.pid)
    && (_lgFilter === "ALL" || p.position === _lgFilter)
    && (!qs || p.name.toLowerCase().includes(qs)));
  const shown = avail.slice(0, 60);
  const rows = shown.map(p => {
    const legal = mine && _fdLegal(st, _lg.teamId, p.position);
    const queued = queue.includes(p.pid);
    return `<tr>
      <td style="font-weight:800;color:var(--gold-lt)">${p.overall}</td>
      <td style="font-weight:700;text-align:left">${_escHtml(p.name)}</td>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="color:var(--gray)">${p.age || "?"}</td>
      <td style="white-space:nowrap">${DS.button({ label: queued ? "✓" : "＋", variant: "outline", size: "sm",
        on: `frnLeagueQueueToggle('${_escHtml(p.pid)}')`,
        title: queued ? `Remove ${p.name} from your queue` : `Queue ${p.name} — your clock timeouts draft from this list first`,
        ariaLabel: `${queued ? "Unqueue" : "Queue"} ${p.name}`,
        attrs: queued ? { style: "color:var(--gold-lt);border-color:var(--gold)" } : null })}${mine ? " " + DS.button({ label: "Draft", variant: legal ? "gold" : "outline", size: "sm", disabled: !legal,
        on: `frnLeaguePick('${_escHtml(p.pid)}', this)`, ariaLabel: `Draft ${p.name}` }) : ""}</td>
    </tr>`;
  }).join("");
  const queueRows = queue.map((pid, i) => {
    const p = st.byPid.get(pid);
    if (!p) return "";
    const gone = st.taken.has(pid);
    return `<div style="display:flex;align-items:center;gap:.35rem;padding:.12rem 0${gone ? ";opacity:.45;text-decoration:line-through" : ""}">
      <b style="color:var(--gray);min-width:1.2rem">${i + 1}.</b>
      <span style="flex:1"><b style="color:var(--gray)">${p.position}</b> ${_escHtml(p.name)} <b style="color:var(--gold-lt)">${p.overall}</b>${gone ? " (taken)" : ""}</span>
      ${DS.button({ label: "▲", variant: "outline", size: "sm", on: `frnLeagueQueueMove('${_escHtml(pid)}',-1)`, ariaLabel: `Move ${p.name} up`, disabled: i === 0 })}
      ${DS.button({ label: "▼", variant: "outline", size: "sm", on: `frnLeagueQueueMove('${_escHtml(pid)}',1)`, ariaLabel: `Move ${p.name} down`, disabled: i === queue.length - 1 })}
      ${DS.button({ label: "✕", variant: "outline", size: "sm", on: `frnLeagueQueueToggle('${_escHtml(pid)}')`, ariaLabel: `Remove ${p.name} from queue` })}
    </div>`;
  }).join("");
  const queueHead = mine ? (() => { for (const pid of queue) { if (!st.taken.has(pid)) { const p = st.byPid.get(pid); if (p && _fdLegal(st, _lg.teamId, p.position)) return p; } } return null; })() : null;
  const filters = ["ALL", ...FD_POSITIONS].map(pos =>
    DS.chip({ label: pos, active: _lgFilter === pos, on: `_lgSetFilter('${pos}')` })).join(" ");

  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:.8rem">
      <div class="fps-hero-badge">🧢</div>
      <div class="fps-hero-title">${_escHtml(_lg.leagueName || "LEAGUE")} DRAFT · ROUND ${round}/${_lgDraft.rounds}</div>
      <div class="fps-hero-sub">Pick ${st.pickIdx + 1} of ${interactive} called live (${total} total) ·
        ${mine
          ? `<b style="color:var(--gold-lt)">YOU'RE ON THE CLOCK</b>${clockMs ? ` · ⏱ ${clockMs >= 3600000 ? Math.round(clockMs / 3600000) + "h" : Math.round(clockMs / 1000) + "s"} clock` : ""}`
          : clockTeam
            ? `on the clock: ${_escHtml(clockTeam.city)} ${_escHtml(clockTeam.name)}${clockGm ? ` (${_escHtml(clockGm.displayName)})` : " (auto)"}`
            : "finishing…"}</div>
    </div>
    <div class="ds-progress" style="max-width:640px;margin:0 auto .9rem" title="${st.pickIdx} of ${total} picks made">
      <div class="ds-progress__fill" style="width:${(st.pickIdx / total * 100).toFixed(1)}%"></div>
    </div>
    ${recent ? `<div style="display:flex;gap:.35rem;flex-wrap:wrap;justify-content:center;margin-bottom:1rem">${recent}</div>` : ""}
    <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:1rem;align-items:start">
      <div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.6rem;align-items:center">${filters}
          <input id="lgSearch" type="search" value="${_escHtml(_lgSearch)}" placeholder="🔎 player name…"
            oninput="_lgSetSearch(this.value)" aria-label="Search players by name"
            style="margin-left:auto;min-width:11rem;font-size:.72rem;padding:.3rem .5rem"></div>
        <table class="frn-ana-table"><thead>
          <tr><th>OVR</th><th style="text-align:left">Player</th><th>Pos</th><th>Age</th><th></th></tr>
        </thead><tbody>${rows}</tbody></table>
        <div style="color:var(--gray);font-size:.65rem;margin-top:.4rem">showing ${shown.length} of ${avail.length} available</div>
      </div>
      <div>
        <div class="fps-section-title" style="margin-top:0">MY QUEUE · ${queue.length}</div>
        ${queueHead && mine ? DS.button({ label: `⭐ Draft #1 queued — ${queueHead.position} ${queueHead.name}`, variant: "gold", size: "sm", on: `frnLeaguePick('${_escHtml(queueHead.pid)}', this)`, attrs: { style: "margin-bottom:.4rem;width:100%" } }) : ""}
        <div style="border:1px solid var(--border);border-radius:8px;padding:.4rem .55rem;font-size:.72rem;margin-bottom:.8rem;max-height:180px;overflow-y:auto">
          ${queueRows || `<div style="color:var(--gray);font-style:italic">Empty — ＋ players from the board. If your clock runs out, the server drafts from this list first.</div>`}
        </div>
        <div class="fps-section-title" style="margin-top:0">MY ROSTER · ${myRoster.length}/${FD_PICKS_PER_TEAM}</div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.7rem">${needChips}</div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:.5rem .6rem;font-size:.75rem">
          ${myRoster.length ? myRoster.map(p => `<div style="display:flex;justify-content:space-between;padding:.12rem 0">
              <span><b style="color:var(--gray)">${p.position}</b> ${_escHtml(p.name)}</span><b style="color:var(--gold-lt)">${p.overall}</b>
            </div>`).join("") : `<div style="color:var(--gray);font-style:italic">No picks yet.</div>`}
        </div>
        <p style="color:var(--gray);font-size:.62rem;margin-top:.6rem">Live picks arrive from the league server;
          benches auto-fill after round ${_lgDraft.rounds}. Every client re-derives the same board from the seed.</p>
      </div>
    </div>`;
}
async function frnLeaguePick(pid, btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const r = await _lgApi("/api/league/draft/pick", { leagueId: _lg.leagueId, token: _lg.token, pid });
    // Apply own pick immediately at its index (SSE will no-op on the dupe).
    _lgApplyWirePicks(r.i, [[_lg.teamId, r.pid]]);
    const p = _lgSt.byPid.get(pid);
    if (typeof DS !== "undefined" && p) DS.toast({ message: `✓ Drafted ${p.position} ${p.name} (${p.overall} OVR)`, kind: "success", duration: 2200 });
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: e.message, kind: "warn" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
    renderLeagueDraftRoom();
  }
}

// ── done: verify + start the local franchise ────────────────────────────────
async function _lgSha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function _lgVerifyResult() {
  _lgVerify = "pending";
  try {
    const mine = await _lgSha256(JSON.stringify(_lgDraft.order.map(t => [t, _lgSt.rosters[t].map(p => p.pid)])));
    _lgVerify = mine === _lgDraft.resultHash ? "ok" : "mismatch";
  } catch { _lgVerify = null; } // no crypto.subtle (insecure context) — skip, don't fake it
}
function renderLeagueDone() {
  _lgScreen = "done";
  _lgHideShell();
  const badge = _lgVerify === "ok"
    ? DS.banner({ variant: "success", icon: "✓", title: "VERIFIED", body: "Your client re-derived all 32 rosters from the seed + tape and matched the server's result hash. Nobody — including the server — could have altered a pick." })
    : _lgVerify === "mismatch"
      ? DS.banner({ variant: "danger", icon: "⚠", title: "HASH MISMATCH", body: "Your locally derived rosters do NOT match the server's result hash. Do not trust this draft — compare clients before playing." })
      : DS.banner({ icon: "…", title: "Verifying", body: "Re-deriving the league from the seed + tape…" });
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🏁</div>
      <div class="fps-hero-title">DRAFT COMPLETE</div>
      <div class="fps-hero-sub">${_escHtml(_lg.leagueName || "League")} · ${_lgDraft.tape.length} picks ·
        artifact <code style="font-size:.62rem">${_escHtml((_lgDraft.artifactHash || "").slice(0, 16))}…</code></div>
    </div>
    <div style="max-width:40rem;margin:0 auto;display:flex;flex-direction:column;gap:.7rem">
      ${badge}
      ${DS.button({ label: "▶ Start my franchise from this draft", variant: "gold",
        on: "frnLeagueStartLocalFranchise(this)",
        title: "Creates a local franchise with the drafted 32-team league — every member derives the identical league" })}
      ${DS.button({ label: "📅 League season", variant: "outline", on: "_lgEnterSeason()",
        title: "The shared season — server-simmed weeks, live standings" })}
      ${DS.button({ label: "⌂ Home", variant: "outline", on: "_lgLeaveScreens();renderFrnStartScreen()" })}
    </div>`;
  if (_lgVerify == null || _lgVerify === "pending") {
    _lgVerifyResult().then(() => { if (_lgScreen === "done") renderLeagueDone(); });
  }
}
async function frnLeagueStartLocalFranchise(btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const meta = _readSlotsMeta();
    meta.activeSlotId = null; // fresh slot — never stomps an existing save
    _writeSlotsMeta(meta);
    franchise = {
      chosenTeamId: _lg.teamId,
      season: 1, week: 1,
      phase: "fantasy_draft",
      rosters: {}, teamTiers: {},
      salaryCap: SALARY_CAP_BASE,
      schedule: generateFranchiseSchedule(),
      standings: initStandings(),
      playoffBracket: null, history: [], pendingFranchiseGame: null,
      rngSeedBase: (Math.random() * 0xFFFFFFFF) >>> 0,
      _offChanges: null, seasonStats: {}, seasonHighlights: [],
      superBowlGame: null, ir: {}, _irReturnsUsed: {},
      fantasyDraft: {
        poolSeed: _lgDraft.poolSeed, year: _lgDraft.year,
        settings: { rounds: _lgDraft.rounds, snake: true },
        order: _lgDraft.order,
        tape: _lgDraft.tape.map(e => ({ teamId: e.teamId, pid: e.pid, auto: !!e.auto })),
        done: false, autoRest: true,
        league: { id: _lg.leagueId, artifactHash: _lgDraft.artifactHash, resultHash: _lgDraft.resultHash },
      },
    };
    _fdCache = null;   // shared top-level binding with the fantasy-draft module
    _lgLeaveScreens(); // SSE league events must not repaint over the dashboard
    _fdFinish();       // derives rosters + seeded contracts + boots preseason
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't build the franchise — " + e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}

// Deep-link hook (same pattern as #h2h=): defer past initial page setup.
if (typeof document !== "undefined" && typeof location !== "undefined") {
  if (location.hash.startsWith("#league=")) {
    setTimeout(() => { try { frnLeagueJoinFromHash(); } catch (e) { console.warn("[league] join-from-hash failed:", e); } }, 0);
  }
}
