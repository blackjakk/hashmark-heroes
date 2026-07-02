// ─── H2H network client (Workstream C.3 — browser ↔ h2h-server) ────────────
// Points the EXISTING interactive-playcalling UI at a network match: the
// server's `decision` events land in `_ipc.pending` (so `_ipcShowPanel`,
// the 1-6/R/P/G/F/K/O keys, and the panel buttons all work unchanged), and
// `frnPlaycall` routes the answer to POST /api/call instead of the local
// tape (the `_ipc.mode === "net"` branch). Resolved plays stream in over
// SSE and feed the normal playback loop; hidden information holds because
// the server never broadcasts calls — each side only ever sees its own
// prompts and the resolved plays.
//
// Flow:  HOST — pick teams, 🌐 Host H2H → share the join link.
//        JOIN — open the link (play.html#h2h=matchId.joinCode.server).
// Reconnects are native: EventSource auto-reconnects and the server replays
// missed events from Last-Event-ID.
//
// v1 scope notes (see INGAME_CLOCK_AND_MULTIPLAYER.md §C.3): exhibition
// matches with server-generated rosters; no accounts (identity = token);
// wire plays still carry statsSnap (slimming is a listed follow-up).

let _h2h = null; // { base, matchId, token, side, es, settings, clockTimer }

// ── entry points ────────────────────────────────────────────────────────────
// opts: { base?, homeTeamId?, awayTeamId?, useFranchiseRoster? }. The dev-
// panel button reads the page's team selects; the modal passes its own.
async function h2hCreateMatch(opts) {
  const o = opts || {};
  const base = o.base || _h2hServerBase();
  let homeTeamId = o.homeTeamId ?? (+document.getElementById("homeTeam")?.value || 1);
  let awayTeamId = o.awayTeamId ?? (+document.getElementById("awayTeam")?.value || null);
  let homeRoster = null;
  // Franchise-roster match: host plays as their franchise team with the
  // CURRENT roster (the snapshot ships to the server and becomes part of
  // the deterministic artifact).
  const fr = _h2hFranchiseRoster();
  if (o.useFranchiseRoster && fr) { homeTeamId = fr.teamId; homeRoster = fr.roster; }
  if (awayTeamId === homeTeamId) awayTeamId = null;   // joiner picks their own seat anyway
  _h2hStatus("Creating match…");
  // In-flight feedback on the trigger button — a real network wait. DS.busy
  // adds spinner + disabled + aria-busy and also guards a double-click from
  // firing two match creations.
  const _busyBtn = (typeof DS !== "undefined" && DS.busy) ? DS.busy("#h2hCreateBtn", true) : null;
  try {
    const r = await _h2hPost(base, "/api/match", { homeTeamId, awayTeamId, homeRoster });
    if (r.error) throw new Error(r.error);
    let link = location.origin + location.pathname
      + `#h2h=${r.matchId}.${r.joinCode}.${encodeURIComponent(base)}`;
    // Couch-multiplayer fix: a "localhost" link is dead on arrival on the
    // friend's phone. When the server also serves the game files (static
    // deployment) and reports LAN addresses, rewrite the WHOLE link onto the
    // LAN address so anyone on the same Wi-Fi can just tap it.
    const isLocal = (u) => /\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(String(u));
    if (isLocal(link) || isLocal(base)) {
      const health = (_h2hFound && _h2hFound.base === base) ? _h2hFound.health : await _h2hPing(base);
      if (health && health.static && Array.isArray(health.lanHosts) && health.lanHosts.length) {
        const lanBase = `http://${health.lanHosts[0]}:${health.port || 8787}`;
        link = `${lanBase}/play.html#h2h=${r.matchId}.${r.joinCode}.${encodeURIComponent(lanBase)}`;
      }
    }
    await _h2hEnter(base, r.matchId, r.token, "home");
    // The home panels are hidden now — the share link lives in the
    // waiting banner until the opponent joins.
    _h2h.shareLink = link;
    _h2hShowWaiting();
    return { ok: true };
  } catch (e) {
    _h2hStatus("");
    const error = "Couldn't create the match — is the H2H server running at " + base + "? (" + e.message + ")";
    // quiet: the caller renders the failure inline (the host-modal form);
    // default: the legacy dev-panel path keeps its alert.
    if (!o.quiet) alert(error);
    return { ok: false, error };
  } finally {
    if (_busyBtn) DS.busy(_busyBtn, false);
  }
}

async function h2hJoinFromHash() {
  const m = /^#h2h=([a-f0-9]+)\.([a-f0-9]+)\.(.+)$/.exec(location.hash || "");
  if (!m) return false;
  const [, matchId, joinCode, encBase] = m;
  const base = decodeURIComponent(encBase);
  _h2hStatus("Joining match…");
  try {
    // Joining from inside a franchise save: offer to bring your team.
    // DS.modal reads far friendlier than a native confirm() for the invited
    // player (often their very first moment in the game).
    const body = { matchId, joinCode };
    const fr = _h2hFranchiseRoster();
    if (fr) {
      const useFr = (typeof DS !== "undefined" && DS.modal)
        ? await DS.modal({
            title: "You're invited! 🏈",
            body: `Play as your franchise team — <b>${DS.esc(fr.name)}</b>, current roster — or grab a fresh exhibition squad?`,
            okLabel: `Use my ${fr.name}`,
            cancelLabel: "Fresh squad",
          })
        : confirm(`Join with your franchise team (${fr.name}) and its current roster?\n(Cancel = play a fresh exhibition roster instead.)`);
      if (useFr) {
        body.awayTeamId = fr.teamId;
        body.awayRoster = fr.roster;
      }
    }
    const r = await _h2hPost(base, "/api/join", body);
    if (r.error) throw new Error(r.error);
    await _h2hEnter(base, matchId, r.token, r.side);
    return true;
  } catch (e) {
    _h2hStatus("");
    alert("Couldn't join the match: " + e.message);
    return false;
  }
}

// Your franchise team's live roster, if a franchise save is loaded.
function _h2hFranchiseRoster() {
  try {
    if (typeof franchise === "undefined" || !franchise?.chosenTeamId) return null;
    const roster = franchise.rosters?.[franchise.chosenTeamId];
    if (!Array.isArray(roster) || roster.length < 20) return null;
    const team = getTeam(franchise.chosenTeamId);
    return { teamId: franchise.chosenTeamId, roster: JSON.parse(JSON.stringify(roster)), name: team?.name || "your team" };
  } catch (_) { return null; }
}

// ── session setup ───────────────────────────────────────────────────────────
// Builds/refreshes the gameResult shell from the server's roster SNAPSHOTS —
// the exact objects the server sims, so names/jerseys/ratings agree. The
// host enters BEFORE the away seat is finalized (the joiner may bring their
// own team); the server's "start" event triggers a re-apply.
function _h2hApplySetup(setup) {
  const homeTeam = getTeam(setup.homeTeamId);
  // Pre-join the away seat may be empty — use a placeholder behind the
  // waiting banner; the start event re-applies with the real seat.
  const awayTeam = getTeam(setup.awayTeamId)
    || TEAMS.find(t => t.id !== setup.homeTeamId);
  const awayRoster = setup.rosters.away || [];
  const lookup = new Map();
  for (const p of setup.rosters.home) lookup.set(p.name, { ...p, team: "home" });
  for (const p of awayRoster) lookup.set(p.name, { ...p, team: "away" });
  let awayRatings;
  try { awayRatings = buildRatings(awayRoster); } catch (_) { awayRatings = { starters: {} }; }
  gameResult = {
    homeTeam, awayTeam,
    homeScore: gameResult?._h2hNet ? gameResult.homeScore : 0,
    awayScore: gameResult?._h2hNet ? gameResult.awayScore : 0,
    homeRatings: buildRatings(setup.rosters.home),
    awayRatings,
    homeRoster: setup.rosters.home, awayRoster,
    playerLookup: lookup,
    plays: gameResult?._h2hNet ? gameResult.plays : [],
    drives: [], stats: null,
    weather: null, winner: null,
    _h2hNet: true,
    _h2hAwaitingAway: !setup.rosters.away,
  };
}

async function _h2hEnter(base, matchId, token, side) {
  const setup = await (await fetch(`${base}/api/setup/${matchId}?token=${token}`)).json();
  if (setup.error) throw new Error(setup.error);
  gameResult = null;
  _h2hApplySetup(setup);
  // The network session wears the _ipc interface so the panel, keyboard,
  // and playback hooks work unchanged. `tape` exists only for shape-compat.
  _ipc = {
    mode: "net", userSide: side,
    homeId: setup.homeTeamId, awayId: setup.awayTeamId,
    tape: [], pending: null,
    status: "running", coachMode: false,
  };
  _h2h = { base, matchId, token, side, es: null, settings: setup.settings, clockTimer: null };
  window._replayMode = false;

  // Show the live-game shell (mirrors _frnEnterLiveGameScreen: the game
  // area lives outside both home panels, so hide them and take over).
  const _fh = document.getElementById("franchiseHome");
  if (_fh) _fh.style.display = "none";
  const _tp = document.getElementById("testingPanel");
  if (_tp) _tp.style.display = "none";
  if (typeof gameArea !== "undefined") gameArea.classList.remove("empty");
  const pc = document.getElementById("playbackControls");
  if (pc) pc.style.display = "flex";
  renderGameLayout();
  playHead = 0;
  animState = null;
  playing = true;
  if (typeof updateButtons === "function") updateButtons();
  if (typeof _ipcInstallKeys === "function") _ipcInstallKeys();
  startNextPlay();   // 0 plays → parks on the waiting banner until events land

  _h2hConnect();
  _h2hStartClock();
}

function _h2hConnect() {
  if (!_h2h) return;
  const url = `${_h2h.base}/api/events/${_h2h.matchId}?token=${_h2h.token}`;
  const es = new EventSource(url);
  _h2h.es = es;
  es.addEventListener("start",   () => _h2hOnStart());
  es.addEventListener("decision", (e) => _h2hOnDecision(JSON.parse(e.data)));
  es.addEventListener("waiting", (e) => _h2hOnWaiting(JSON.parse(e.data)));
  es.addEventListener("plays",   (e) => _h2hOnPlays(JSON.parse(e.data)));
  es.addEventListener("final",   (e) => _h2hOnFinal(JSON.parse(e.data)));
  es.onerror = () => { if (_h2h) _h2hStatus("Reconnecting…", "conn"); };
  // hello only clears a transient connection message — the host's share
  // link stays up until the match actually starts moving.
  es.addEventListener("hello", () => { if (_h2hStatusKind === "conn") _h2hStatus(""); });
}

// ── event handlers ──────────────────────────────────────────────────────────
// The away seat just got finalized (the joiner may have brought their own
// team/roster) — refetch setup and rebuild the shell + layout around it.
async function _h2hOnStart() {
  if (_h2h) _h2h.shareLink = null;   // opponent is in — retire the link banner
  if (!_h2h || !gameResult?._h2hAwaitingAway) return;
  try {
    const setup = await (await fetch(`${_h2h.base}/api/setup/${_h2h.matchId}?token=${_h2h.token}`)).json();
    if (setup.error || !setup.rosters.away) return;
    _h2hApplySetup(setup);
    renderGameLayout();
    if (!playing) startNextPlay();   // re-park on the waiting banner with real teams
  } catch (e) { console.warn("[h2h] start refetch failed:", e.message); }
}

function _h2hOnDecision(d) {
  if (!_ipc || _ipc.mode !== "net") return;
  if (_h2hStatusKind === "link") _h2hStatus("");   // opponent is in — drop the share banner
  _ipc.pending = { ...d.ctx, kind: d.kind, seq: d.seq, deadline: d.deadline };
  _ipc.status = "pending";
  if (_ipc.coachMode) { _h2hSubmitCall(null); return; }
  // If playback already caught up (parked on the waiting banner), prompt
  // now; otherwise the panel appears when the animation reaches the end
  // (the normal _ipcMaybePrompt path).
  if (!playing && playHead >= gameResult.plays.length) _ipcMaybePrompt();
}

function _h2hOnWaiting(d) {
  if (!_ipc || _ipc.mode !== "net" || _ipc.status === "final") return;
  _h2h.waitDeadline = d.deadline;
  if (!playing && playHead >= gameResult.plays.length && !_ipc.pending) _h2hShowWaiting();
}

function _h2hOnPlays(d) {
  if (!gameResult || !gameResult._h2hNet) return;
  // Slices are contiguous (determinism makes re-sim prefixes identical),
  // but guard against replayed events after a reconnect.
  if (d.from > gameResult.plays.length) return;            // gap — shouldn't happen
  const fresh = d.plays.slice(gameResult.plays.length - d.from);
  if (!fresh.length) return;
  gameResult.plays.push(...fresh);
  gameResult.homeScore = d.score.home;
  gameResult.awayScore = d.score.away;
  // Parked (waiting banner / just answered) with unplayed plays? Resume.
  // A live prompt can't be open here — the server doesn't resolve plays
  // while a decision is pending, so any visible panel is the waiting one.
  if (!playing && playHead < gameResult.plays.length && !_ipc?.pending) {
    _ipcHidePanel();
    playing = true;
    if (typeof updateButtons === "function") updateButtons();
    startNextPlay();
  }
}

function _h2hOnFinal(d) {
  if (!_ipc || _ipc.mode !== "net") return;
  _ipc.status = "final";
  _ipc.pending = null;
  gameResult.homeScore = d.result.homeScore;
  gameResult.awayScore = d.result.awayScore;
  gameResult.winner = d.result.winner;
  _h2hStatus(`Final. Match artifact hash <code>${String(d.artifactHash).slice(0, 16)}…</code>`);
  _h2hStopClock();
  // If parked, resume so the remaining plays animate into the FINAL screen.
  if (!playing && playHead < gameResult.plays.length) {
    _ipcHidePanel();
    playing = true;
    startNextPlay();
  } else if (!playing) {
    _ipcHidePanel();
    startNextPlay();   // falls through to the FINAL render
  }
}

// ── submitting calls (frnPlaycall's net branch lands here) ─────────────────
async function _h2hSubmitCall(call) {
  if (!_h2h || !_ipc || _ipc.mode !== "net") return;
  const seq = _ipc.pending ? _ipc.pending.seq : null;
  _ipc.pending = null;
  _ipc.status = "running";
  _ipcHidePanel();
  _h2hShowWaiting();
  try {
    const r = await _h2hPost(_h2h.base, "/api/call", {
      matchId: _h2h.matchId, token: _h2h.token, seq, call,
    });
    if (r.error && r.error !== "stale seq") console.warn("[h2h] call rejected:", r.error);
  } catch (e) {
    console.warn("[h2h] call failed (will retry on next prompt):", e.message);
  }
}

// ── waiting banner + play clock ─────────────────────────────────────────────
// Reuses the ipc panel chrome with no buttons; a 1s ticker keeps the
// countdown (yours or the opponent's) fresh in the situation line.
function _h2hShowWaiting() {
  if (typeof _ipcEnsurePanel !== "function") return;
  const el = _ipcEnsurePanel();
  if (!el || !_ipc || _ipc.mode !== "net" || _ipc.status === "final") return;
  if (_ipc.pending) return;   // a real prompt owns the panel
  const preJoin = _h2h?.shareLink && gameResult?._h2hAwaitingAway;
  el.querySelector("#ipcBadge").textContent = preJoin
    ? "🎉 GAME CREATED — INVITE YOUR FRIEND" : "⏳ WAITING FOR OPPONENT";
  el.querySelector("#ipcSit").textContent = preJoin ? "" : _h2hClockText(_h2h?.waitDeadline);
  el.querySelector("#ipcLean").textContent = preJoin
    ? "Send them this link — when they open it, it's kickoff. Nothing to install."
    : "their call is in — hidden until the snap";
  // Invite kit: the link itself (kept selectable — probes read .h2h-link),
  // one-tap Copy with toast feedback, and the native share sheet on devices
  // that have one (phones — the couch-multiplayer case).
  el.querySelector("#ipcBtns").innerHTML = preJoin
    ? `<input class="h2h-link" readonly value="${_h2h.shareLink.replace(/"/g, "&quot;")}" onclick="this.select()" style="width:min(420px,80%)">
       <button class="ds-btn ds-btn--gold" onclick="_h2hCopyShareLink()">📋 Copy link</button>` +
      (typeof navigator !== "undefined" && navigator.share
        ? `<button class="ds-btn ds-btn--outline" onclick="_h2hNativeShare()">📤 Share…</button>` : "")
    : "";
  el.style.display = "flex";
}
async function _h2hCopyShareLink() {
  const link = _h2h?.shareLink;
  if (!link) return;
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; }
  catch (e) {
    // Clipboard API needs a secure context — fall back to select+execCommand.
    try {
      const inp = document.querySelector(".h2h-link");
      if (inp) { inp.select(); ok = document.execCommand("copy"); }
    } catch (e2) {}
  }
  if (typeof DS !== "undefined" && DS.toast) {
    DS.toast(ok
      ? { message: "✓ Link copied — send it to your friend", kind: "success" }
      : { message: "Couldn't copy automatically — tap the link and copy it", kind: "warn" });
  }
}
function _h2hNativeShare() {
  const link = _h2h?.shareLink;
  if (!link || typeof navigator === "undefined" || !navigator.share) return;
  navigator.share({ title: "Hashmark Heroes — play me!", text: "Join my football match:", url: link })
    .catch(() => {}); // user closed the sheet — fine
}
function _h2hClockText(deadline) {
  if (!deadline) return "";
  const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `⏱ ${s}s`;
}
function _h2hStartClock() {
  _h2hStopClock();
  _h2h.clockTimer = setInterval(() => {
    if (!_h2h || !_ipc || _ipc.mode !== "net") return _h2hStopClock();
    const el = document.getElementById("ipcPanel");
    if (!el || el.style.display === "none") return;
    const sit = el.querySelector("#ipcSit");
    if (_ipc.pending && _ipc.pending.deadline) {
      // Append/refresh the play-clock chip on a live prompt.
      const base = sit.textContent.replace(/ · ⏱ \d+s$/, "");
      sit.textContent = `${base} · ${_h2hClockText(_ipc.pending.deadline)}`;
    } else if (!_ipc.pending && _ipc.status !== "final") {
      sit.textContent = _h2hClockText(_h2h.waitDeadline);
    }
  }, 1000);
}
function _h2hStopClock() {
  if (_h2h?.clockTimer) { clearInterval(_h2h.clockTimer); _h2h.clockTimer = null; }
}

// ── Host modal — the player-facing entry (the dev panel keeps its own) ─────
// ── Server auto-discovery ────────────────────────────────────────────────
// Normies should never see a URL. Probe the likely servers silently —
// same-origin (static deployment), last-used, localhost — and only surface
// an address field behind "Advanced" when nothing answers.
const _H2H_LAST_SERVER_KEY = "h2h_last_server";
let _h2hFound = null; // { base, health } from the most recent successful probe
async function _h2hPing(base, timeoutMs = 1300) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(String(base).replace(/\/+$/, "") + "/api/health", { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j && j.h2h) return j;
  } catch (e) { /* not a game server */ }
  return null;
}
async function _h2hFindServer() {
  const candidates = [];
  if (/^https?:$/.test(location.protocol)) candidates.push(location.origin);
  try {
    const last = localStorage.getItem(_H2H_LAST_SERVER_KEY);
    if (last) candidates.push(last);
  } catch (e) {}
  candidates.push("http://localhost:8787");
  const seen = new Set();
  for (const c of candidates) {
    const base = String(c).replace(/\/+$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    const health = await _h2hPing(base);
    if (health) { _h2hFound = { base, health }; return _h2hFound; }
  }
  return null;
}

// Host-a-match form modal, built on the DS form layer. The normie contract:
// the modal finds the server ITSELF (spinner → "✓ found"); the address field
// lives folded under "Advanced" and only opens itself when discovery fails.
// One gold button; failure renders INLINE with the modal still open; success
// hands off to the invite panel (big copy/share link).
function h2hShowModal() {
  const prev = document.getElementById("h2hModal");
  if (prev) prev.remove(); // rebuild fresh — defaults may have changed
  const fr = _h2hFranchiseRoster();
  const trigger = (document.activeElement instanceof HTMLElement) ? document.activeElement : null;

  let lastServer = "";
  try { lastServer = localStorage.getItem(_H2H_LAST_SERVER_KEY) || ""; } catch (e) {}
  const serverDefault = lastServer || _h2hDefaultBase || "http://localhost:8787";

  const el = document.createElement("div");
  el.id = "h2hModal";
  el.className = "ds-modal-backdrop";
  el.innerHTML = `
    <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="h2hModalTitle">
      <div class="ds-modal__title" id="h2hModalTitle">🎮 Play a friend</div>
      <div class="ds-modal__body">
        <p style="margin:0 0 .8rem;font-size:.75rem;color:var(--ds-text-muted);line-height:1.5">
          You host, they join — send one link. Nothing to install.
        </p>
        <div id="h2hSrvStatus" style="font-size:.72rem;margin-bottom:.8rem;color:var(--ds-text-muted)">
          ${DS.spinner({ size: "sm" })} Looking for a game server…
        </div>
        <form>
          <div class="ds-form-error"></div>
          ${DS.field({
            id: "h2hModalTeam", label: "Your team",
            control: DS.select({
              id: "h2hModalTeam",
              attrs: { name: "team", autocomplete: "off" },
              value: fr ? String(fr.teamId) : undefined,
              options: TEAMS.map(t => ({ value: t.id, label: `${t.city} ${t.name}` })),
            }),
          })}
          ${fr ? `<div class="ds-field">${DS.checkbox({
            id: "h2hModalFranchise", name: "useFranchiseRoster",
            label: `Bring my franchise roster (${fr.name})`, checked: true,
          })}</div>` : ""}
          <details id="h2hAdvanced" style="margin-bottom:.8rem">
            <summary style="cursor:pointer;font-size:.68rem;color:var(--ds-text-muted);letter-spacing:.5px">Advanced — game server address</summary>
            <div style="margin-top:.6rem">
              ${DS.field({
                id: "h2hModalServer", label: "Match server", required: true,
                hint: "Usually found automatically. Enter an address only if a friend is hosting one for you.",
                control: DS.input({
                  id: "h2hModalServer", name: "server", type: "url", required: true,
                  value: serverDefault, placeholder: "http://localhost:8787",
                  autocomplete: "url", inputmode: "url", enterkeyhint: "go",
                  spellcheck: "false",
                }),
              })}
            </div>
          </details>
          <div class="ds-modal__footer">
            <button type="button" class="ds-btn ds-btn--outline" id="h2hModalCancel">Cancel</button>
            <button type="submit" class="ds-btn ds-btn--gold">Create game &amp; get link</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(el);

  const untrap = (typeof DS !== "undefined" && DS.trapFocus)
    ? DS.trapFocus(el.querySelector(".ds-modal")) : () => {};
  const close = () => {
    untrap();
    document.removeEventListener("keydown", onKey);
    el.remove();
    if (trigger && typeof trigger.focus === "function") { try { trigger.focus(); } catch (e) {} }
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  el.querySelector("#h2hModalCancel").addEventListener("click", close);

  const srvInput = el.querySelector("#h2hModalServer");
  const advanced = el.querySelector("#h2hAdvanced");
  const status = el.querySelector("#h2hSrvStatus");
  let userTouchedServer = false;
  srvInput.addEventListener("input", () => { userTouchedServer = true; });

  // Silent discovery — the whole point. Found: green check, address stays
  // folded away. Not found: explain in plain words and unfold Advanced.
  let discovery = _h2hFindServer().then((found) => {
    if (!document.getElementById("h2hModal")) return found; // modal closed
    if (found) {
      if (!userTouchedServer) srvInput.value = found.base;
      status.innerHTML = `<span style="color:var(--ds-success)">✓ Game server found</span>` +
        ` <span style="opacity:.7">(${DS.esc(found.base)})</span>`;
    } else {
      status.innerHTML = `<span style="color:var(--ds-grade-warn)">No game server found.</span>` +
        ` If a friend is hosting one, put their address under Advanced.` +
        `<span style="display:block;opacity:.7;margin-top:.2rem">Hosting it yourself is one command: <code>node server/h2h-server.js</code></span>`;
      advanced.open = true;
    }
    return found;
  });

  const ctl = DS.form(el, {
    validate: {
      server: (v) => {
        if (!/^https?:\/\//i.test(String(v).trim())) return "Must start with http:// or https://";
        return "";
      },
    },
    onSubmit: async (v) => {
      await discovery; // let a still-running probe fill the address first
      const base = String(el.querySelector("#h2hModalServer").value || "").trim().replace(/\/+$/, "");
      // The field may be folded (validation skips hidden fields) — re-check
      // here and unfold with the error rather than firing a doomed request.
      if (!/^https?:\/\//i.test(base)) {
        advanced.open = true;
        ctl.setError("server", "Must start with http:// or https://");
        el.querySelector("#h2hModalServer").focus();
        return;
      }
      const r = await h2hCreateMatch({
        base,
        homeTeamId: +v.team,
        useFranchiseRoster: !!v.useFranchiseRoster,
        quiet: true,
      });
      if (!r || !r.ok) {
        advanced.open = true; // the address is the usual culprit — show it
        return { error: (r && r.error) || "Couldn't create the game." };
      }
      try { localStorage.setItem(_H2H_LAST_SERVER_KEY, base); } catch (e) {}
      close(); // success — the invite panel (copy/share link) takes over
    },
  });

  // Initial focus: the first field, not the cancel button — this is a form.
  setTimeout(() => { el.querySelector("#h2hModalTeam")?.focus(); }, 30);
}

// ── plumbing ────────────────────────────────────────────────────────────────
let _h2hDefaultBase = "http://localhost:8787";
// If the page itself was served by the h2h-server (deployment mode:
// H2H_STATIC=1 → same origin), the server field can default to here.
async function _h2hProbeSameOrigin() {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const r = await fetch(location.origin + "/api/health");
    const j = await r.json();
    if (j && j.h2h) {
      _h2hDefaultBase = location.origin;
      const inp = document.getElementById("h2hServer");
      if (inp && inp.value === "http://localhost:8787") inp.value = location.origin;
    }
  } catch (_) { /* not served by the h2h server — keep the localhost default */ }
}

function _h2hServerBase() {
  const inp = document.getElementById("h2hServer");
  const v = (inp && inp.value.trim()) || _h2hDefaultBase || "http://localhost:8787";
  return v.replace(/\/+$/, "");
}
async function _h2hPost(base, path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
let _h2hStatusKind = null;
function _h2hStatus(html, kind) {
  _h2hStatusKind = html ? (kind || null) : null;
  const el = document.getElementById("h2hStatus");
  if (el) el.innerHTML = html || "";
}

// Host entries (dev-panel button + footer link) + auto-join from a link.
if (typeof document !== "undefined") {
  document.getElementById("h2hCreateBtn")?.addEventListener("click", () => h2hCreateMatch());
  document.getElementById("h2hFooterLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    h2hShowModal();
  });
  _h2hProbeSameOrigin();
  if (location.hash.startsWith("#h2h=")) {
    // Defer past initial page setup so the game layout helpers exist.
    setTimeout(() => h2hJoinFromHash(), 0);
  }
}
