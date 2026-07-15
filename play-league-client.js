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
let _lgChallenge = null;     // M4: last h2h_challenge event {week, homeId, awayId, link, by}
let _lgFixtureCtx = null;    // M4: the league fixture the CURRENT h2h match settles {leagueId, week, homeId, awayId, matchId, base, token}
let _lgH2HArt = {};          // M4: fetched match artifacts by "homeIdvAwayId" (resubmit safety net)

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
function _lgTeam(id) { return TEAMS.find(t => t.id === id) || { city: "?", name: "Team " + id, primary: "var(--ds-neutral)" }; }
function _lgMemberFor(teamId) { return (_lgLeague?.members || []).find(m => m.teamId === teamId) || null; }

// ── entry: start-screen card + deep link ────────────────────────────────────
function frnLeagueHome() {
  _lgHideShell();
  _lgLoad();
  if (_lg && _lg.leagueId) { _lgResume(); return; }
  renderLeagueCreate();
}

// ── create-a-league: a 3-step DS.form wizard ────────────────────────────────
// The normie contract (mirrors the H2H host modal): the form finds the league
// server ITSELF; the address lives folded under Advanced and only opens when
// discovery fails or create errors. Validation is blur-then-live (DS.form),
// errors render inline in the field slots, failure lands in the form-level
// .ds-form-error with the form still OPEN. Chip toggles update IN PLACE —
// they must never re-render the form and eat what the user already typed.
// PROBE CONTRACT: #lgName/#lgGm/#lgTeam/#lgBase/#lgClock keep their ids and
// frnLeagueCreateSubmit() stays directly callable — the two-browser probe
// fills fields by id and submits without driving the wizard.
const _LG_LAST_SERVER_KEY = "hh_lg_last_server";
const _LG_LAST_GM_KEY = "hh_lg_last_gm";
let _lgCreateFantasy = true, _lgCreateRounds = 12, _lgCreateClock = 86400000;
let _lgCreateCtl = null;      // DS.form controller for the mounted create form
let _lgCreateStepper = null;  // DS.stepper controller
let _lgSrvFound = null;       // discovery result {base, health} | null
let _lgDiscovery = null;      // in-flight discovery promise

async function _lgPing(base) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1300);
    const r = await fetch(base.replace(/\/+$/, "") + "/api/health", { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    // A LEAGUE server's health reports a leagues count — that's how we tell
    // it apart from the h2h match server on the same box.
    if (j && j.ok && "leagues" in j) return j;
  } catch (_) { /* not a league server */ }
  return null;
}
async function _lgFindServer() {
  const candidates = [];
  if (/^https?:$/.test(location.protocol)) candidates.push(location.origin);
  try { const last = localStorage.getItem(_LG_LAST_SERVER_KEY); if (last) candidates.push(last); } catch (_) {}
  candidates.push("http://localhost:8788");
  const seen = new Set();
  for (const c of candidates) {
    const base = String(c).replace(/\/+$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    const health = await _lgPing(base);
    if (health) { _lgSrvFound = { base, health }; return _lgSrvFound; }
  }
  return null;
}

function _lgRosterChipsHtml() {
  return `${DS.chip({ label: "Default rosters", active: !_lgCreateFantasy, on: "_lgSetCreateFantasy(false)" })}
    ${DS.chip({ label: "🧢 Fantasy draft", active: _lgCreateFantasy, on: "_lgSetCreateFantasy(true)" })}`;
}
function _lgRoundsChipsHtml() {
  return [12, 25, 51].map(r => DS.chip({ label: String(r), active: _lgCreateRounds === r, on: `_lgSetCreateRounds(${r})` })).join(" ");
}
// IN-PLACE updates: swap only the chip rows and the fantasy-options fold —
// never the form — so step position and typed values survive the toggle.
function _lgSetCreateFantasy(v) {
  _lgCreateFantasy = !!v;
  const chips = document.getElementById("lgRosterChips");
  const opts = document.getElementById("lgDraftOpts");
  if (chips) chips.innerHTML = _lgRosterChipsHtml();
  if (opts) opts.hidden = !_lgCreateFantasy;
}
function _lgSetCreateRounds(r) {
  _lgCreateRounds = r;
  const chips = document.getElementById("lgRoundsChips");
  if (chips) chips.innerHTML = _lgRoundsChipsHtml();
}

function renderLeagueCreate() {
  _lgHideShell();
  const teamOpts = TEAMS.map(t => ({ value: t.id, label: `${t.city} ${t.name}` }));
  let lastGm = "", lastServer = "";
  try {
    lastGm = localStorage.getItem(_LG_LAST_GM_KEY) || "";
    lastServer = localStorage.getItem(_LG_LAST_SERVER_KEY) || "";
  } catch (_) {}
  const stepDefs = [
    { id: "league", label: "Your league" },
    { id: "rosters", label: "Rosters" },
    { id: "create", label: "Create" },
  ];
  _lgHost().innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🌐</div>
      <div class="fps-hero-title">ONLINE LEAGUE</div>
      <div class="fps-hero-sub">One league, real people — a commissioner, a lobby, and (if you dare) a full fantasy draft</div>
    </div>
    <div id="lgCreateRoot" style="max-width:34rem;margin:0 auto">
      <div data-steps-header></div>
      <form autocomplete="on" style="margin-top:1rem">
        <div class="ds-form-error"></div>

        <div data-step-panel>
          ${DS.field({
            id: "lgName", label: "League name", required: true,
            hint: "What your group calls this dynasty — it's on every invite.",
            control: DS.input({
              id: "lgName", name: "leagueName", value: "Sunday Dynasty",
              required: true, maxlength: 60, enterkeyhint: "next",
              autocomplete: "off", spellcheck: "false",
            }),
          })}
          ${DS.field({
            id: "lgGm", label: "Your GM name", required: true,
            control: DS.input({
              id: "lgGm", name: "gmName", value: lastGm || "Commish",
              required: true, maxlength: 40, enterkeyhint: "next",
              autocomplete: "nickname",
            }),
          })}
          ${DS.field({
            id: "lgTeam", label: "Your team",
            control: DS.select({ id: "lgTeam", options: teamOpts, value: TEAMS[0].id, attrs: { name: "team" } }),
          })}
          <div style="display:flex;justify-content:flex-end;margin-top:.4rem">
            ${DS.button({ label: "Next →", variant: "gold", type: "button", attrs: { "data-step-next": true } })}
          </div>
        </div>

        <div data-step-panel hidden>
          <div class="ds-field">
            <span class="ds-field__label" id="lgRosterLbl">Rosters</span>
            <div id="lgRosterChips" role="group" aria-labelledby="lgRosterLbl"
              style="display:flex;gap:.5rem;flex-wrap:wrap">${_lgRosterChipsHtml()}</div>
            <div class="ds-field__hint">Default = everyone starts from the same generated 32-team league.
              Fantasy draft = draft night — every roster built from scratch, live with your friends.</div>
            <div class="ds-field__error"></div>
          </div>
          <div id="lgDraftOpts" ${_lgCreateFantasy ? "" : "hidden"}>
            <div class="ds-field">
              <span class="ds-field__label" id="lgRoundsLbl">Rounds you call live</span>
              <div id="lgRoundsChips" role="group" aria-labelledby="lgRoundsLbl"
                style="display:flex;gap:.5rem;flex-wrap:wrap">${_lgRoundsChipsHtml()}</div>
              <div class="ds-field__hint">After your live rounds, benches auto-fill — 12 is a tight draft night, 51 is the full grind.</div>
              <div class="ds-field__error"></div>
            </div>
            ${DS.field({
              id: "lgClock", label: "Pick clock",
              hint: "A stalled pick auto-drafts from that GM's queue when the clock runs out.",
              control: DS.select({
                id: "lgClock", value: String(_lgCreateClock), attrs: { name: "clock" },
                options: [
                  { value: "0", label: "No clock — picks wait" }, { value: "60000", label: "1 minute (live draft)" },
                  { value: "3600000", label: "1 hour" }, { value: "86400000", label: "24 hours (async league)" },
                ],
              }),
            })}
          </div>
          <div class="ds-field">
            ${DS.checkbox({ id: "lgH2H", label: "🎮 Head-to-head fixtures — when two GMs' teams meet, they play the game LIVE instead of a sim" })}
            <div class="ds-field__hint">The league only accepts a live result it can re-verify (fixture seed + canonical rosters + full replay), and both players must submit it. The commissioner's next advance force-sims any fixture left unplayed.</div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:.4rem">
            ${DS.button({ label: "← Back", variant: "outline", type: "button", attrs: { "data-step-back": true } })}
            ${DS.button({ label: "Next →", variant: "gold", type: "button", attrs: { "data-step-next": true } })}
          </div>
        </div>

        <div data-step-panel hidden>
          <div id="lgRecap" style="font-size:.75rem;color:var(--gray);margin-bottom:.7rem"></div>
          <div id="lgSrvStatus" role="status" style="font-size:.72rem;margin-bottom:.8rem;color:var(--gray)">
            ${DS.spinner({ size: "sm" })} Looking for a league server…
          </div>
          <details id="lgAdvanced" style="margin-bottom:.8rem">
            <summary style="cursor:pointer;font-size:.68rem;color:var(--gray);letter-spacing:.5px">Advanced — league server address</summary>
            <div style="margin-top:.6rem">
              ${DS.field({
                id: "lgBase", label: "League server", required: true,
                hint: "Usually found automatically. Enter an address only if someone is hosting a server for your group.",
                control: DS.input({
                  id: "lgBase", name: "server", type: "url", required: true,
                  value: lastServer || _lgDefaultBase(), placeholder: "http://localhost:8788",
                  autocomplete: "url", inputmode: "url", enterkeyhint: "go", spellcheck: "false",
                }),
              })}
            </div>
          </details>
          <div style="display:flex;justify-content:space-between;margin-top:.4rem">
            ${DS.button({ label: "← Back", variant: "outline", type: "button", attrs: { "data-step-back": true } })}
            ${DS.button({ label: "🌐 Create league", variant: "gold", type: "submit" })}
          </div>
        </div>
      </form>
      <div style="text-align:center;color:var(--gray);font-size:.72rem;margin-top:1rem">
        Joining instead? Open the commissioner's <b>#league=…</b> link — it lands you in the lobby.
      </div>
      <div style="display:flex;justify-content:center;margin-top:.6rem">
        ${DS.button({ label: "← Back to start screen", variant: "outline", on: "_lgLeaveScreens();renderFrnStartScreen()" })}
      </div>
    </div>`;

  const root = document.getElementById("lgCreateRoot");
  const srvInput = document.getElementById("lgBase");
  const advanced = document.getElementById("lgAdvanced");
  const status = document.getElementById("lgSrvStatus");
  let userTouchedServer = false;
  srvInput.addEventListener("input", () => { userTouchedServer = true; });

  // Silent discovery, kicked off at mount so it's usually resolved before the
  // user reaches step 3. Found → green check, address stays folded. Not
  // found → plain words + the fold opens itself.
  _lgSrvFound = null;
  _lgDiscovery = _lgFindServer().then((found) => {
    if (!document.getElementById("lgCreateRoot")) return found; // screen left
    if (found) {
      if (!userTouchedServer) srvInput.value = found.base;
      status.innerHTML = `<span style="color:var(--ds-success)">✓ League server found</span>` +
        ` <span style="opacity:.7">(${DS.esc(found.base)})</span>`;
    } else {
      status.innerHTML = `<span style="color:var(--ds-grade-warn)">No league server found.</span>` +
        ` If someone hosts one for your group, put their address under Advanced.` +
        `<span style="display:block;opacity:.7;margin-top:.2rem">Hosting it yourself is one command: <code>node server/league-server.js</code></span>`;
      advanced.open = true;
    }
    return found;
  });

  _lgCreateCtl = DS.form(root, {
    validate: {
      leagueName: (v) => String(v).trim() ? "" : "Give the league a name.",
      gmName: (v) => String(v).trim() ? "" : "Your fellow GMs need to know who you are.",
      server: (v) => /^https?:\/\//i.test(String(v).trim()) ? "" : "Must start with http:// or https://",
    },
    onSubmit: async () => {
      await _lgDiscovery; // let a still-running probe fill the address first
      // The field may be folded (validation skips hidden fields) — re-check
      // here and unfold with the error rather than firing a doomed request.
      const base = String(srvInput.value || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(base)) {
        advanced.open = true;
        _lgCreateCtl.setError("server", "Must start with http:// or https://");
        srvInput.focus();
        return;
      }
      const r = await frnLeagueCreateSubmit(null, { quiet: true });
      if (r && r.error) {
        advanced.open = true; // the address is the usual culprit — show it
        return { error: r.error };
      }
    },
  });
  _lgCreateStepper = DS.stepper(root, { steps: stepDefs, form: _lgCreateCtl });

  // Keyboard contract: Enter on a non-final step means "Next", not "submit
  // the whole thing with steps unseen". (Implicit submission would otherwise
  // fire the create from step 1.)
  root.querySelector("form").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || t.tagName === "BUTTON" || t.tagName === "TEXTAREA") return;
    if (_lgCreateStepper && _lgCreateStepper.index < 2) { e.preventDefault(); _lgCreateStepper.next(); }
  });
  // Live recap when the final panel shows (registered after the stepper's own
  // click handler, so the step has already advanced when this runs).
  root.addEventListener("click", (e) => {
    if (!e.target.closest("[data-step-next], [data-step-back]")) return;
    if (_lgCreateStepper && _lgCreateStepper.index === 2) {
      const team = TEAMS.find(t => String(t.id) === String(document.getElementById("lgTeam")?.value)) || TEAMS[0];
      const recap = `${document.getElementById("lgName")?.value || "League"} · ` +
        `${document.getElementById("lgGm")?.value || "GM"} · ${team.city} ${team.name} · ` +
        (_lgCreateFantasy ? `🧢 fantasy draft, ${_lgCreateRounds} live rounds` : "default rosters");
      const el = document.getElementById("lgRecap");
      if (el) el.textContent = recap;
    }
  });
  setTimeout(() => { document.getElementById("lgName")?.focus(); }, 30);
}

// Creates the league on the server. Directly callable (the probes do) — reads
// live field values by id. With {quiet} it returns {ok}/{error} for the
// DS.form inline-error path instead of toasting.
async function frnLeagueCreateSubmit(btn, opts) {
  const quiet = !!(opts && opts.quiet);
  const base = (document.getElementById("lgBase")?.value || _lgDefaultBase()).replace(/\/+$/, "");
  const name = (document.getElementById("lgName")?.value || "New Dynasty").trim() || "New Dynasty";
  const gm = (document.getElementById("lgGm")?.value || "Commissioner").trim() || "Commissioner";
  // DS.select puts the id on the <select> element itself.
  const teamId = Number(document.getElementById("lgTeam")?.value || TEAMS[0].id);
  const clock = Number(document.getElementById("lgClock")?.value ?? _lgCreateClock);
  const humanGamesH2H = !!document.getElementById("lgH2H")?.checked;
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    _lg = { base };
    const sigKeys = (typeof _h2hGetKeys === "function") ? await _h2hGetKeys() : null;
    const r = await _lgApi("/api/league", {
      name, adminTeamId: teamId, adminName: gm,
      pubKey: sigKeys ? sigKeys.pubJwk : undefined,
      settings: _lgCreateFantasy
        ? { rosterMode: "fantasy_draft", draftRounds: _lgCreateRounds, pickClockMs: clock, humanGamesH2H }
        : { rosterMode: "default", humanGamesH2H },
    });
    _lg = { base, leagueId: r.leagueId, token: r.memberToken, adminToken: r.adminToken,
            teamId: r.teamId, displayName: gm, leagueName: name, joinCode: r.joinCode };
    _lgSaveSession();
    try {
      localStorage.setItem(_LG_LAST_SERVER_KEY, base);
      localStorage.setItem(_LG_LAST_GM_KEY, gm);
    } catch (_) {}
    if (typeof DS !== "undefined") DS.toast({ message: `✓ ${name} is live — invite your GMs from the lobby`, kind: "success", duration: 3200 });
    await _lgResume();
    return { ok: true };
  } catch (e) {
    if (!quiet && typeof DS !== "undefined") DS.toast({ message: "Couldn't create the league — " + e.message, kind: "error" });
    return { ok: false, error: "Couldn't create the league — " + e.message };
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
    let lastGm = "";
    try { lastGm = localStorage.getItem(_LG_LAST_GM_KEY) || ""; } catch (_) {}
    _lgHost().innerHTML = `
      <div class="fps-hero" style="margin-bottom:1rem">
        <div class="fps-hero-badge">🌐</div>
        <div class="fps-hero-title">JOIN ${_escHtml(snap?.league?.name || "LEAGUE")}</div>
        <div class="fps-hero-sub">Pick your GM name and claim a team</div>
      </div>
      <div style="max-width:34rem;margin:0 auto .8rem">
        ${DS.field({
          id: "lgGm", label: "Your GM name", required: true,
          control: DS.input({
            id: "lgGm", name: "gmName", value: lastGm || "GM",
            required: true, maxlength: 40, autocomplete: "nickname", enterkeyhint: "done",
            on: "this.removeAttribute('aria-invalid');this.closest('.ds-field').querySelector('.ds-field__error').textContent=''",
          }),
        })}
      </div>
      <div class="fps-starts">${cards}</div>`;
  });
}
async function frnLeagueJoinSubmit(leagueId, inviteToken, teamId, btn) {
  const gmInput = document.getElementById("lgGm");
  const gm = (gmInput?.value || "").trim();
  if (!gm) {
    // Inline, next to the field — not a toast the user has to chase.
    if (gmInput) {
      gmInput.setAttribute("aria-invalid", "true");
      const slot = gmInput.closest(".ds-field")?.querySelector(".ds-field__error");
      if (slot) slot.textContent = "Pick a GM name first — it's how the league knows you.";
      gmInput.focus();
    }
    return;
  }
  try { localStorage.setItem(_LG_LAST_GM_KEY, gm); } catch (_) {}
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const r = await _lgApi("/api/league/join", { leagueId, token: inviteToken, teamId, pubKey: (typeof _h2hGetKeys === "function" && (await _h2hGetKeys())?.pubJwk) || undefined, displayName: gm });
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
    if (_lgSeason) { _lgSeason.results[d.week] = d.results; _lgSeason.standings = d.standings; _lgSeason.pendingWeek = null; }
    if (_lgLeague) _lgLeague.standings = d.standings;
    if (_lgScreen === "season") renderLeagueSeason();
  });
  // M4 humanGamesH2H: a week can stay OPEN on live fixtures. week_partial is
  // the full open-week snapshot (AI results + waiting fixtures + proposals).
  _lgES.addEventListener("week_partial", (e) => {
    const d = JSON.parse(e.data);
    if (_lgSeason) _lgSeason.pendingWeek = d;
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("h2h_challenge", (e) => {
    const d = JSON.parse(e.data);
    _lgChallenge = d;
    if ((_lgNum(d.homeId) === _lg.teamId || _lgNum(d.awayId) === _lg.teamId) && typeof DS !== "undefined") {
      DS.toast({ message: `🎮 ${d.by || "Your opponent"} opened your league fixture as a live match — join from the season screen`, kind: "info", duration: 5200 });
    }
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("h2h_proposed", (e) => {
    const d = JSON.parse(e.data);
    const pw = _lgSeason?.pendingWeek;
    if (pw) {
      pw.proposed = pw.proposed || {};
      pw.proposed[_lgNum(d.homeId) + "v" + _lgNum(d.awayId)] = {
        resultHash: d.resultHash, homeScore: _lgNum(d.homeScore), awayScore: _lgNum(d.awayScore),
        byName: d.by || null, byTeam: _lgNum(d.awaitingTeamId) === _lgNum(d.homeId) ? _lgNum(d.awayId) : _lgNum(d.homeId),
      };
    }
    if (_lgNum(d.awaitingTeamId) === _lg.teamId && typeof DS !== "undefined") {
      DS.toast({ message: "Your fixture result was verified & proposed — it enters the ledger once you confirm (auto after your FINAL)", kind: "info", duration: 5200 });
    }
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("h2h_result", (e) => {
    const d = JSON.parse(e.data);
    const pw = _lgSeason?.pendingWeek;
    if (pw && d.result) {
      pw.results.push(d.result);
      pw.pending = (pw.pending || []).filter(g => !(_lgNum(g.homeId) === _lgNum(d.result.homeId) && _lgNum(g.awayId) === _lgNum(d.result.awayId)));
      if (pw.proposed) delete pw.proposed[_lgNum(d.result.homeId) + "v" + _lgNum(d.result.awayId)];
    }
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("h2h_disputed", (e) => {
    const d = JSON.parse(e.data);
    const pw = _lgSeason?.pendingWeek;
    const key = _lgNum(d.homeId) + "v" + _lgNum(d.awayId);
    if (pw && pw.proposed && pw.proposed[key]) pw.proposed[key].disputed = true;
    if ((_lgNum(d.homeId) === _lg.teamId || _lgNum(d.awayId) === _lg.teamId) && typeof DS !== "undefined") {
      DS.toast({ message: "⚠ Conflicting verified artifacts on your fixture — the commissioner's deadline advance will settle it", kind: "warn", duration: 6000 });
    }
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
  // M3: bracket rounds + the season rollover, live.
  _lgES.addEventListener("playoff_results", (e) => {
    const d = JSON.parse(e.data);
    if (_lgSeason) _lgSeason.playoffs = d.playoffs || _lgSeason.playoffs;
    if (_lgScreen === "season") renderLeagueSeason();
  });
  _lgES.addEventListener("rollover", (e) => {
    const d = JSON.parse(e.data);
    if (typeof DS !== "undefined") DS.toast({ message: `🏁 Season ${_lgNum(d.season)} is live — same league, fresh slate`, kind: "success", duration: 3200 });
    if (_lgScreen === "season") _lgEnterSeason(); // full resync — results/standings reset
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
    return `<tr${mine ? ' style="background:var(--ds-tint-royal-08)"' : ""}>
      <td style="text-align:left;white-space:nowrap"><b style="color:${t.primary}">⬢</b> ${_escHtml(t.city)} ${_escHtml(t.name)}
        ${gm ? `<span style="color:var(--gray);font-size:.62rem"> · ${_escHtml(gm.displayName)}</span>` : ""}</td>
      <td style="font-weight:700">${s.w}-${s.l}${s.t ? "-" + s.t : ""}</td>
      <td style="color:var(--gray)">${s.pf}</td>
      <td style="color:var(--gray)">${s.pa}</td>
      <td style="color:${diff > 0 ? "var(--ds-grade-pos)" : diff < 0 ? "var(--ds-grade-neg)" : "var(--gray)"}">${diff > 0 ? "+" : ""}${diff}</td>
    </tr>`;
  }).join("");
}
// M3 bracket — played rounds by conference + who's still alive + champion.
// Renders only server-published data (playoffs snapshot from SSE/season
// endpoint); scores/ids coerced via _lgNum like every season surface.
function _lgBracketHtml(S) {
  const P = S.playoffs;
  if (!P) return "";
  const roundNames = S.roundNames || ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"];
  const gameRow = (g) => {
    const h = _lgTeam(_lgNum(g.homeId)), a = _lgTeam(_lgNum(g.awayId));
    const hs = _lgNum(g.homeScore), as = _lgNum(g.awayScore);
    const win = _lgNum(g.winnerId);
    const nm = (t, id, sc, won) => `<span style="${won ? "font-weight:800" : "color:var(--gray)"}">${_escHtml((t.abbr || t.name.slice(0, 3)).toUpperCase())} ${sc}${won ? " ✓" : ""}</span>`;
    return `<div style="display:flex;gap:.5rem;justify-content:center;padding:.14rem 0" title="result hash ${_escHtml((g.resultHash || "").slice(0, 16))}…">
      ${g.conf && g.conf !== "SB" ? `<span style="color:var(--gray);font-size:.58rem;min-width:2rem">${_escHtml(String(g.conf))}</span>` : `<span style="color:var(--gold-lt);font-size:.58rem;min-width:2rem">SB</span>`}
      ${nm(a, g.awayId, as, win === _lgNum(g.awayId))}
      <span style="color:var(--gray);font-size:.6rem">@</span>
      ${nm(h, g.homeId, hs, win === _lgNum(g.homeId))}
    </div>`;
  };
  const rounds = (P.rounds || []).map((games, i) => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:.45rem .7rem;min-width:13rem">
      <div class="fps-section-title" style="margin:0 0 .3rem;font-size:.62rem">${_escHtml(roundNames[i] || `Round ${i + 1}`)}</div>
      ${games.map(gameRow).join("")}
    </div>`).join("");
  const aliveChips = P.champion == null ? ["AFC", "NFC"].map(conf =>
    `<div style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:center;justify-content:center">
      <span style="color:var(--gray);font-size:.6rem;letter-spacing:1px">${conf} ALIVE:</span>
      ${(P.alive?.[conf] || []).map(id => {
        const t = _lgTeam(_lgNum(id));
        return `<span class="ds-chip" style="border-color:${t.primary}">${_escHtml((t.abbr || t.name.slice(0, 3)).toUpperCase())}</span>`;
      }).join(" ")}
    </div>`).join("") : "";
  const champ = P.champion != null ? (() => {
    const t = _lgTeam(_lgNum(P.champion));
    return `<div style="text-align:center;margin:.6rem 0 .2rem">
      <span class="ds-chip" style="border-color:var(--gold);color:var(--gold-lt);font-size:.85rem;padding:.4rem .9rem">
        🏆 SEASON ${_lgNum(P.season)} CHAMPIONS — ${_escHtml(t.city)} ${_escHtml(t.name)}</span>
    </div>`;
  })() : "";
  return `
    <div class="fps-section-title">PLAYOFFS</div>
    ${champ}
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;max-width:60rem;margin:0 auto .6rem">${rounds}</div>
    <div style="display:flex;flex-direction:column;gap:.3rem;margin-bottom:1rem">${aliveChips}</div>`;
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
    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.28rem .55rem;border:1px solid var(--border);border-radius:8px${mine ? ";border-color:var(--gold);background:var(--ds-tint-royal-07)" : ""}"
      title="result hash ${_escHtml((g.resultHash || "").slice(0, 16))}…">
      <span style="flex:1;text-align:right${aWin ? ";font-weight:800" : ""}">${_escHtml((a.abbr || a.name.slice(0, 3)).toUpperCase())} ${as}</span>
      <span style="color:var(--gray);font-size:.6rem">@</span>
      <span style="flex:1${hWin ? ";font-weight:800" : ""}">${_escHtml((h.abbr || h.name.slice(0, 3)).toUpperCase())} ${hs}</span>
    </div>`;
  };
  const results = lastWeek ? (S.results[lastWeek] || []).map(scoreRow).join("") : "";
  // M4: the current week can be OPEN on live human fixtures.
  const pw = S.phase === "active" && S.pendingWeek && _lgNum(S.pendingWeek.week) === _lgNum(S.week) ? S.pendingWeek : null;
  const fixturesHtml = pw && (pw.pending || []).length
    ? `<div class="fps-section-title">LIVE FIXTURES — WEEK ${_lgNum(pw.week)}</div>
       <p style="text-align:center;color:var(--gray);font-size:.68rem;max-width:40rem;margin:0 auto .5rem">
         These matchups are played head-to-head, not simmed. The league only accepts a result it can
         re-verify (fixture seed + canonical rosters + full replay) and both players must submit it.</p>
       <div style="display:flex;flex-direction:column;gap:.4rem;max-width:34rem;margin:0 auto 1rem">
         ${pw.pending.map(g => _lgFixtureCardHtml(g, pw)).join("")}</div>`
    : "";
  const upcoming = S.phase === "active" ? generateFranchiseSchedule().filter(g => g.week === _lgNum(S.week)).map(g => {
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
      <div class="fps-hero-sub">${(() => {
        const roundNames = S.roundNames || ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"];
        if (S.phase === "season_over") {
          const t = _lgTeam(_lgNum(S.playoffs?.champion));
          return `<b style="color:var(--gold-lt)">SEASON ${_lgNum(S.season)} COMPLETE</b> · 🏆 ${_escHtml(t.city)} ${_escHtml(t.name)} are champions`;
        }
        if (S.phase === "playoffs") {
          const next = roundNames[_lgNum(S.playoffs?.roundIdx)] || "next round";
          return `<b style="color:var(--gold-lt)">PLAYOFFS</b> · SEASON ${_lgNum(S.season)} · up next: ${_escHtml(next)}`;
        }
        if (done) return `<b style="color:var(--gold-lt)">REGULAR SEASON COMPLETE</b> · ${weeks.length} weeks in the books — the bracket awaits`;
        return `SEASON ${_lgNum(S.season)} · WEEK ${_lgNum(S.week)} of ${_lgNum(S.weeks) || 18} · one shared season, simmed by the league server`;
      })()}</div>
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;justify-content:center;margin-bottom:1rem">${verifyChip}</div>
    ${isAdmin ? (() => {
      const roundNames = S.roundNames || ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"];
      const label = S.phase === "season_complete" ? "🏈 Seed the bracket — sim the Wild Card round"
        : S.phase === "playoffs" ? `▶ Sim the ${roundNames[_lgNum(S.playoffs?.roundIdx)] || "next round"}`
        : S.phase === "season_over" ? `🏁 Start season ${_lgNum(S.season) + 1}`
        : pw ? `⏱ Deadline — force-sim ${(pw.pending || []).length} waiting fixture(s) & close week ${_lgNum(S.week)}`
        : `▶ Advance — sim week ${_lgNum(S.week)}`;
      return `<div style="display:flex;justify-content:center;margin-bottom:1rem">
        ${DS.button({ label, variant: "gold", on: "frnLeagueAdvanceWeek(this)",
          title: pw ? "Any fixture still unplayed sims as an AI game — the commissioner's deadline hammer"
                    : "Sims on the server; results + hashes broadcast to every member" })}</div>`;
    })() : `<p style="text-align:center;color:var(--gray);font-size:.72rem;margin-bottom:1rem">The commissioner advances the league — results arrive here live.</p>`}
    ${fixturesHtml}
    ${_lgBracketHtml(S)}
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
// ── M4: humanGamesH2H — play your league fixture live ───────────────────────
// A pending fixture between two members is played on an H2H match server with
// the CANONICAL league rosters and the league's own per-game seed; at FINAL
// both clients fetch the artifact and submit it to the league server, which
// re-verifies everything (seed derivation, rosters, full tape re-sim) before
// the scores enter the week. Two-party attestation: first submission
// proposes, the opponent's matching one confirms.
async function _lgGameSeed(leagueSeed, season, week, homeId, awayId) {
  const buf = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(`hh-league-game|${leagueSeed}|${season}|${week}|${homeId}|${awayId}`));
  return new DataView(buf).getUint32(0, true);   // first 4 bytes, LE — the server's derivation
}
// Canonical rosters for THIS league's genesis — default: (leagueSeed, year)
// gen; fantasy: the finished draft's (poolSeed + tape). Same derivations the
// verify badges already prove against the server's published hashes.
async function _lgCanonicalRosters() {
  const S = _lgSeason;
  if (S.rosterMode === "fantasy_draft") {
    if (!_lgDraft || !_lgDraft.done) {
      _lgDraft = await _lgApi(`/api/league/draft/${_lg.leagueId}?token=${encodeURIComponent(_lg.token)}`);
    }
    const built = _fdBuildPool(_lgDraft.poolSeed, _lgDraft.year);
    built.order = _lgDraft.order;
    return _fdApplyTape(built, _lgDraft.tape).rosters;   // tape entries are {teamId, pid}
  }
  if (!_lgSeasonBuilt || _lgSeasonBuilt._seed !== S.leagueSeed) {
    _lgSeasonBuilt = _fdBuildDefaultLeague(S.leagueSeed, S.year);
    _lgSeasonBuilt._seed = S.leagueSeed;
  }
  return _lgSeasonBuilt.rosters;
}
// Per-pick signature: hh-pick|leagueId|pickIdx|teamId|pid, signed with the
// same seat key registered at league join (shared store with the h2h client).
// Null when the browser has no crypto.subtle (legacy unsigned member).
async function _lgPickSig(pid) {
  try {
    if (typeof _h2hGetKeys !== "function") return undefined;
    const keys = await _h2hGetKeys();
    if (!keys) return undefined;
    const i = _lgSt ? _lgSt.pickIdx : 0;
    return await keys.sign(new TextEncoder().encode(`hh-pick|${_lg.leagueId}|${i}|${_lg.teamId}|${pid}`));
  } catch (_) { return undefined; }
}
// HOME member hosts: create the match seed-bound to the league fixture, relay
// the invite to the opponent over league SSE, enter the match as home.
async function frnLgHostFixture(homeId, awayId, btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const S = _lgSeason;
    const rosters = await _lgCanonicalRosters();
    const seed = await _lgGameSeed(S.leagueSeed, _lgNum(S.season), _lgNum(S.week), homeId, awayId);
    const found = await _h2hFindServer();
    if (!found) throw new Error("no H2H match server reachable — run one (node server/h2h-server.js) or host a friendly once to teach me the address");
    const base = found.base;
    const sigKeys = (typeof _h2hGetKeys === "function") ? await _h2hGetKeys() : null;
    const r = await _h2hPost(base, "/api/match", {
      homeTeamId: homeId, awayTeamId: awayId,
      homeRoster: JSON.parse(JSON.stringify(rosters[homeId])), seed,
      pubKey: sigKeys ? sigKeys.pubJwk : undefined });
    if (r.error) throw new Error(r.error);
    const link = location.origin + location.pathname + `#h2h=${r.matchId}.${r.joinCode}.${encodeURIComponent(base)}`;
    await _lgApi("/api/league/h2h-challenge", { leagueId: _lg.leagueId, token: _lg.token, link });
    _lgFixtureCtx = { leagueId: _lg.leagueId, week: _lgNum(S.week), homeId, awayId, matchId: r.matchId, base, token: r.token };
    _lgLeaveScreens();
    await _h2hEnter(base, r.matchId, r.token, "home");
    _h2h.sigKeys = sigKeys;   // per-call signing — the league solo-accepts fully-attested artifacts
    _h2h.shareLink = link;
    _h2hShowWaiting();
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't start the fixture — " + e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}
// AWAY member joins from the league-relayed challenge. The link is
// server-relayed member data — parse strictly, join with the CANONICAL away
// roster (never the local franchise squad; the league would reject it).
async function frnLgJoinFixture(btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const d = _lgChallenge;
    if (!d) throw new Error("no live-match invite on record");
    const m = /#h2h=([a-f0-9]+)\.([a-f0-9]+)\.([^#\s]+)$/.exec(String(d.link || ""));
    if (!m) throw new Error("the invite link is malformed");
    const base = decodeURIComponent(m[3]);
    if (!/^https?:\/\//.test(base)) throw new Error("the invite link's server address is not http(s)");
    const rosters = await _lgCanonicalRosters();
    const awayId = _lgNum(d.awayId);
    const sigKeys = (typeof _h2hGetKeys === "function") ? await _h2hGetKeys() : null;
    const r = await _h2hPost(base, "/api/join", {
      matchId: m[1], joinCode: m[2],
      awayTeamId: awayId, awayRoster: JSON.parse(JSON.stringify(rosters[awayId])),
      pubKey: sigKeys ? sigKeys.pubJwk : undefined });
    if (r.error) throw new Error(r.error);
    _lgFixtureCtx = { leagueId: _lg.leagueId, week: _lgNum(d.week), homeId: _lgNum(d.homeId), awayId, matchId: m[1], base, token: r.token };
    _lgLeaveScreens();
    await _h2hEnter(base, m[1], r.token, r.side);
    _h2h.sigKeys = sigKeys;
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "Couldn't join the fixture — " + e.message, kind: "error" });
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}
// FINAL hook (called from _h2hOnFinal): fetch the artifact and submit it to
// the league. Both sides do this — first = propose, second = confirm.
async function _lgOnH2HFinal() {
  const ctx = _lgFixtureCtx;
  if (!ctx || !_h2h || _h2h.matchId !== ctx.matchId) return;
  try {
    const art = await (await fetch(`${ctx.base}/api/artifact/${ctx.matchId}?token=${ctx.token}`)).json();
    if (art.error) throw new Error(art.error);
    _lgH2HArt[ctx.homeId + "v" + ctx.awayId] = art;
    await _lgSubmitFixtureArtifact(ctx.homeId, ctx.awayId);
  } catch (e) {
    if (typeof DS !== "undefined") DS.toast({ message: "League submission failed — " + e.message + ". Resubmit from the season screen.", kind: "warn", duration: 6000 });
  }
}
async function _lgSubmitFixtureArtifact(homeId, awayId, btn) {
  if (btn && typeof DS !== "undefined") DS.busy(btn, true);
  try {
    const art = _lgH2HArt[homeId + "v" + awayId];
    if (!art) throw new Error("no artifact held for that fixture (finish the match in this tab first)");
    const r = await _lgApi("/api/league/h2h-result", { leagueId: _lg.leagueId, token: _lg.token, artifact: art });
    if (typeof DS !== "undefined") {
      DS.toast(r.confirmed
        ? { message: "✓ Result confirmed & verified — it's in the league ledger", kind: "success", duration: 4200 }
        : { message: "✓ Result verified & proposed — your opponent's submission confirms it", kind: "success", duration: 4800 });
    }
    if (_lgScreen === "season") { await _lgRefreshSeason(); renderLeagueSeason(); }
  } catch (e) {
    // Fully-attested artifacts SOLO-ACCEPT on the first submission — the
    // opponent's auto-submit then finds the fixture already settled. That is
    // success, not an error.
    if (/no fixtures are waiting|not a pending fixture/.test(e.message || "") && typeof DS !== "undefined") {
      DS.toast({ message: "✓ Result already settled — your opponent's attested submission closed it", kind: "success", duration: 4200 });
    } else if (typeof DS !== "undefined") {
      DS.toast({ message: "League rejected the submission — " + e.message, kind: "error", duration: 6000 });
    }
  } finally {
    if (btn && typeof DS !== "undefined") DS.busy(btn, false);
  }
}
// The season-HQ card row for one waiting fixture.
function _lgFixtureCardHtml(g, pw) {
  const homeId = _lgNum(g.homeId), awayId = _lgNum(g.awayId);
  const key = homeId + "v" + awayId;
  const h = _lgTeam(homeId), a = _lgTeam(awayId);
  const prop = pw.proposed?.[key];
  const iAmHome = _lg.teamId === homeId, iAmAway = _lg.teamId === awayId;
  const mine = iAmHome || iAmAway;
  const names = `${_escHtml((a.abbr || a.name.slice(0, 3)).toUpperCase())} @ ${_escHtml((h.abbr || h.name.slice(0, 3)).toUpperCase())}`;
  let body;
  if (prop?.disputed) {
    body = `<span style="color:var(--ds-grade-neg);font-size:.68rem">⚠ disputed — conflicting verified artifacts; the commissioner's deadline advance settles it</span>`;
  } else if (prop) {
    const waiting = prop.byTeam === _lg.teamId ? "waiting for your opponent to confirm" : (mine ? "waiting for YOUR confirmation" : "awaiting confirmation");
    body = `<span style="font-size:.72rem"><b>${_lgNum(prop.awayScore)}–${_lgNum(prop.homeScore)}</b> verified · ${waiting}</span>
      ${mine && prop.byTeam !== _lg.teamId && _lgH2HArt[key]
        ? DS.button({ label: "✓ Confirm result", variant: "gold", size: "sm", on: `_lgSubmitFixtureArtifact(${homeId},${awayId},this)` }) : ""}`;
  } else if (iAmHome) {
    body = DS.button({ label: "▶ Host this fixture live", variant: "gold", size: "sm", on: `frnLgHostFixture(${homeId},${awayId},this)`,
      title: "Creates the live match with the league's canonical rosters + fixture seed and invites your opponent" });
  } else if (iAmAway) {
    const ch = _lgChallenge && _lgNum(_lgChallenge.homeId) === homeId && _lgNum(_lgChallenge.awayId) === awayId ? _lgChallenge : null;
    body = ch
      ? DS.button({ label: "🎮 Join the live match", variant: "gold", size: "sm", on: "frnLgJoinFixture(this)" })
      : (_lgH2HArt[key]
        ? DS.button({ label: "↻ Resubmit my result", variant: "outline", size: "sm", on: `_lgSubmitFixtureArtifact(${homeId},${awayId},this)` })
        : `<span style="color:var(--gray);font-size:.68rem">your opponent hosts this one — their invite lands here</span>`);
  } else {
    const gmH = _lgMemberFor(homeId), gmA = _lgMemberFor(awayId);
    body = `<span style="color:var(--gray);font-size:.68rem">waiting on ${_escHtml(gmA?.displayName || "?")} & ${_escHtml(gmH?.displayName || "?")}</span>`;
  }
  return `<div style="display:flex;align-items:center;gap:.7rem;justify-content:center;padding:.4rem .7rem;border:1px solid ${mine ? "var(--gold)" : "var(--border)"};border-radius:8px${mine ? ";background:var(--ds-tint-royal-07)" : ""}">
    <span style="font-weight:700;font-size:.74rem">${names}</span>${body}</div>`;
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
    const r = await _lgApi("/api/league/draft/pick", { leagueId: _lg.leagueId, token: _lg.token, pid, sig: await _lgPickSig(pid) });
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
