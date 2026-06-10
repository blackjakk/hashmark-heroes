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
async function h2hCreateMatch() {
  const base = _h2hServerBase();
  const homeTeamId = +document.getElementById("homeTeam")?.value || 1;
  const awayTeamId = +document.getElementById("awayTeam")?.value || 2;
  if (homeTeamId === awayTeamId) { alert("Pick two different teams!"); return; }
  _h2hStatus("Creating match…");
  try {
    const r = await _h2hPost(base, "/api/match", { homeTeamId, awayTeamId });
    if (r.error) throw new Error(r.error);
    const link = location.origin + location.pathname
      + `#h2h=${r.matchId}.${r.joinCode}.${encodeURIComponent(base)}`;
    _h2hStatus(`Share this link with your opponent: <input class="h2h-link" readonly value="${link.replace(/"/g, "&quot;")}" onclick="this.select()" style="width:340px"> — waiting for them to join…`, "link");
    await _h2hEnter(base, r.matchId, r.token, "home");
  } catch (e) {
    _h2hStatus("");
    alert("Couldn't create the match — is the H2H server running at " + base + "? (" + e.message + ")");
  }
}

async function h2hJoinFromHash() {
  const m = /^#h2h=([a-f0-9]+)\.([a-f0-9]+)\.(.+)$/.exec(location.hash || "");
  if (!m) return false;
  const [, matchId, joinCode, encBase] = m;
  const base = decodeURIComponent(encBase);
  _h2hStatus("Joining match…");
  try {
    const r = await _h2hPost(base, "/api/join", { matchId, joinCode });
    if (r.error) throw new Error(r.error);
    await _h2hEnter(base, matchId, r.token, r.side);
    return true;
  } catch (e) {
    _h2hStatus("");
    alert("Couldn't join the match: " + e.message);
    return false;
  }
}

// ── session setup ───────────────────────────────────────────────────────────
async function _h2hEnter(base, matchId, token, side) {
  const setup = await (await fetch(`${base}/api/setup/${matchId}?token=${token}`)).json();
  if (setup.error) throw new Error(setup.error);
  const homeTeam = getTeam(setup.homeTeamId), awayTeam = getTeam(setup.awayTeamId);
  // Build the gameResult shell from the server's roster SNAPSHOTS — the
  // exact objects the server sims, so names/jerseys/ratings agree.
  const lookup = new Map();
  for (const p of setup.rosters.home) lookup.set(p.name, { ...p, team: "home" });
  for (const p of setup.rosters.away) lookup.set(p.name, { ...p, team: "away" });
  gameResult = {
    homeTeam, awayTeam,
    homeScore: 0, awayScore: 0,
    homeRatings: buildRatings(setup.rosters.home),
    awayRatings: buildRatings(setup.rosters.away),
    homeRoster: setup.rosters.home, awayRoster: setup.rosters.away,
    playerLookup: lookup,
    plays: [], drives: [], stats: null,
    weather: null, winner: null,
    _h2hNet: true,
  };
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
  el.querySelector("#ipcBadge").textContent = "⏳ WAITING FOR OPPONENT";
  el.querySelector("#ipcSit").textContent = _h2hClockText(_h2h?.waitDeadline);
  el.querySelector("#ipcLean").textContent = "their call is in — hidden until the snap";
  el.querySelector("#ipcBtns").innerHTML = "";
  el.style.display = "flex";
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

// ── plumbing ────────────────────────────────────────────────────────────────
function _h2hServerBase() {
  const inp = document.getElementById("h2hServer");
  const v = (inp && inp.value.trim()) || "http://localhost:8787";
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

// Host button + auto-join from a share link.
if (typeof document !== "undefined") {
  document.getElementById("h2hCreateBtn")?.addEventListener("click", () => h2hCreateMatch());
  if (location.hash.startsWith("#h2h=")) {
    // Defer past initial page setup so the game layout helpers exist.
    setTimeout(() => h2hJoinFromHash(), 0);
  }
}
