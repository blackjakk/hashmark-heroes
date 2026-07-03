// ─── Hashmark Heroes — shared-DYNASTY (league) server ────────────────────────
// Authoritative server for MULTIPLAYER DYNASTIES: a group runs one league
// together, each member controlling a team, with a commissioner (admin) who
// invites people (email or link), starts the dynasty, and controls advancement
// (manual or on a schedule). Plain Node, ZERO npm dependencies, no build step —
// same discipline as the H2H match server (server/h2h-server.js). Companion
// design: INGAME_CLOCK_AND_MULTIPLAYER.md.
//
// Phase M1 = lifecycle + membership + invites + commissioner controls +
// advancement MODE (manual | scheduled). Running the franchise sim server-side
// on each advance is the next phase; M1's `advance` progresses the league clock
// and broadcasts, which is the substrate the client + sim integration ride on.
//
// API (all JSON; auth = admin token or per-member token):
//   POST /api/league            {name, adminTeamId, adminName, settings}
//        → {leagueId, adminToken, memberToken, joinCode, link}
//   POST /api/league/invite     {leagueId, adminToken, emails:[...] , count?}
//        → {invites:[{email, token, link}]}            (links to send; see EMAIL note)
//   POST /api/league/join       {leagueId, token, teamId, displayName}
//        → {memberToken, teamId}                       (token = invite token OR joinCode)
//   GET  /api/league/:id?token=T                       league snapshot
//   POST /api/league/start      {leagueId, adminToken}      lobby → active
//   POST /api/league/settings   {leagueId, adminToken, advanceMode, advanceIntervalMs, deadlineLabel}
//   POST /api/league/advance    {leagueId, adminToken}      manual advance (scheduled fires internally)
//   POST /api/league/draft/pick {leagueId, token, pid}       fantasy draft: pick intent (your turn only)
//   GET  /api/league/draft/:id?token=T                       full draft state (seed/order/tape) for resync
//   GET  /api/league/events/:id?token=T&since=N             SSE; event ids = seq
//   GET  /api/health
//
// FANTASY DRAFT (settings.rosterMode="fantasy_draft" — FANTASY_DRAFT_DESIGN.md
// S2): commissioner START mints the pool seed and enters phase "drafting".
// The whole draft is (poolSeed + settings + tape) → rosters; clients submit
// pick INTENT only and re-derive everything (server/draft-host.js hosts the
// same generator + draft core the browser runs). AI/unclaimed teams and
// post-round benches auto-pick server-side; settings.pickClockMs (0 = off)
// auto-picks a stalled human turn. draft_complete carries artifactHash
// (sha256 of seed/year/rounds/order/tape) + resultHash (derived rosters) so
// any participant can re-derive and verify — nobody types in a draft result.
//
// EMAIL note: zero-dep server can't send mail without a provider. /invite always
// returns a copy-ready join link per email; if HH_MAIL_CMD is set (a shell
// command template with {to}/{link}), the server pipes the invite through it.
// Otherwise the admin sends the links (UI surfaces them). True SMTP/API mail is
// a pluggable bolt-on — the link IS the invite.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.argv[2] || process.env.HH_LEAGUE_PORT || 8788);
const DATA_DIR = process.env.HH_LEAGUE_DATA || path.join(__dirname, "data-leagues");
const STATIC = process.env.HH_STATIC === "1" || process.argv.includes("--static");
const MAX_TEAMS = 32;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const leagues = new Map();   // leagueId → league

// ── helpers ──────────────────────────────────────────────────────────────────
const rid = (n = 10) => crypto.randomBytes(n).toString("hex");
const code6 = () => crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
const now = () => Date.now();

function leagueFile(id) { return path.join(DATA_DIR, id + ".jsonl"); }
function persistHeader(L) {
  fs.writeFileSync(leagueFile(L.id), JSON.stringify({
    t: "header", id: L.id, name: L.name, createdAt: L.createdAt,
    adminToken: L.adminToken, joinCode: L.joinCode, settings: L.settings,
  }) + "\n");
  // members/invites/events re-appended below for a clean single-file snapshot
  for (const m of L.members) fs.appendFileSync(leagueFile(L.id), JSON.stringify({ t: "member", ...m }) + "\n");
  for (const iv of L.invites) fs.appendFileSync(leagueFile(L.id), JSON.stringify({ t: "invite", ...iv }) + "\n");
  fs.appendFileSync(leagueFile(L.id), JSON.stringify({ t: "phase", phase: L.phase, season: L.season, week: L.week }) + "\n");
}
function persistAppend(L, rec) { fs.appendFileSync(leagueFile(L.id), JSON.stringify(rec) + "\n"); }

function publicLeague(L) {
  return {
    id: L.id, name: L.name, phase: L.phase, season: L.season, week: L.week,
    settings: L.settings, joinCode: L.joinCode,
    members: L.members.map(m => ({ teamId: m.teamId, displayName: m.displayName, isAdmin: m.isAdmin, joinedAt: m.joinedAt })),
    pendingInvites: L.invites.filter(iv => !iv.used).map(iv => ({ email: iv.email || null })),
    takenTeams: L.members.map(m => m.teamId),
    seq: L.seq,
    // Draft summary (full tape via GET /api/league/draft/:id — too big for
    // every snapshot).
    draft: L.draft ? {
      poolSeed: L.draft.poolSeed, year: L.draft.year,
      rounds: L.settings.draftRounds, picks: L.draft.tape.length,
      done: L.draft.done, artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash,
    } : null,
  };
}

// ── SSE ──────────────────────────────────────────────────────────────────────
function writeSse(res, ev) { res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`); }
function pushEvent(L, type, data) {
  const ev = { seq: ++L.seq, type, data, t: now() };
  L.eventLog.push(ev);
  if (L.eventLog.length > 500) L.eventLog.shift();
  for (const res of L.subscribers) { try { writeSse(res, ev); } catch (_) {} }
  return ev;
}

// ── core ops ─────────────────────────────────────────────────────────────────
function newLeagueShell(h) {
  return {
    id: h.id, name: h.name, createdAt: h.createdAt,
    adminToken: h.adminToken, joinCode: h.joinCode,
    settings: h.settings || { teamCount: MAX_TEAMS, advanceMode: "manual", advanceIntervalMs: 0, deadlineLabel: "" },
    members: [], invites: [], phase: "lobby", season: 1, week: 1,
    seq: 0, eventLog: [], subscribers: new Set(), timer: null,
  };
}

function createLeague({ name, adminTeamId, adminName, settings }) {
  const L = newLeagueShell({
    id: rid(8), name: String(name || "New Dynasty").slice(0, 60), createdAt: now(),
    adminToken: rid(), joinCode: code6(),
    settings: sanitizeSettings(settings),
  });
  L.members.push({ token: rid(), teamId: Number(adminTeamId), displayName: String(adminName || "Commissioner").slice(0, 40), isAdmin: true, joinedAt: now() });
  leagues.set(L.id, L);
  persistHeader(L);
  return L;
}

function sanitizeSettings(s) {
  s = s || {};
  const mode = s.advanceMode === "scheduled" ? "scheduled" : "manual";
  let iv = Number(s.advanceIntervalMs) || 0;
  const floor = process.env.HH_LEAGUE_TEST ? 100 : 60 * 1000;   // 1 min min in prod; tiny in tests
  if (mode === "scheduled") iv = Math.max(floor, Math.min(iv || 24 * 3600 * 1000, 30 * 24 * 3600 * 1000)); // … 30 days
  // Fantasy-draft settings (FANTASY_DRAFT_DESIGN.md S2). pickClockMs = 0 means
  // no clock (picks wait indefinitely); when set, prod floors it at 30s so a
  // fat-fingered 50ms clock can't instantly auto-draft a whole human league.
  const clockFloor = process.env.HH_LEAGUE_TEST ? 50 : 30 * 1000;
  let pc = Number(s.pickClockMs) || 0;
  if (pc > 0) pc = Math.max(clockFloor, Math.min(pc, 7 * 24 * 3600 * 1000));
  return {
    teamCount: Math.max(2, Math.min(Number(s.teamCount) || MAX_TEAMS, MAX_TEAMS)),
    advanceMode: mode,
    advanceIntervalMs: mode === "scheduled" ? iv : 0,
    deadlineLabel: String(s.deadlineLabel || "").slice(0, 80),
    humanGamesH2H: !!s.humanGamesH2H,   // (later) human-vs-human matchups play live H2H
    rosterMode: s.rosterMode === "fantasy_draft" ? "fantasy_draft" : "default",
    draftRounds: [12, 25, 51].includes(Number(s.draftRounds)) ? Number(s.draftRounds) : 12,
    pickClockMs: pc,
  };
}

function addInvites(L, emails, count) {
  const out = [];
  const list = Array.isArray(emails) && emails.length ? emails.map(e => String(e).trim().slice(0, 120)).filter(Boolean)
             : Array.from({ length: Math.max(0, Math.min(Number(count) || 0, MAX_TEAMS)) }, () => null);
  for (const email of list) {
    const iv = { token: rid(), email: email || null, used: false, createdAt: now() };
    L.invites.push(iv);
    persistAppend(L, { t: "invite", ...iv });
    out.push(iv);
    if (email && process.env.HH_MAIL_CMD) trySendMail(email, iv.token, L);
  }
  pushEvent(L, "invites", { count: out.length });
  return out;
}

function trySendMail(to, token, L) {
  // Pluggable: HH_MAIL_CMD is a template, e.g. "/usr/local/bin/sendmail.sh {to} {link}".
  const link = `#league=${L.id}.${token}`;
  const parts = process.env.HH_MAIL_CMD.split(" ").map(p => p.replace("{to}", to).replace("{link}", link).replace("{league}", L.name));
  try { execFile(parts[0], parts.slice(1), () => {}); } catch (_) {}
}

function joinLeague(L, { token, teamId, displayName }) {
  if (L.phase !== "lobby") return { error: "dynasty already started" };
  teamId = Number(teamId);
  if (L.members.some(m => m.teamId === teamId)) return { error: "team already taken" };
  if (L.members.length >= L.settings.teamCount) return { error: "league full" };
  // token may be a single-use invite OR the open joinCode
  let invite = null;
  if (token !== L.joinCode) {
    invite = L.invites.find(iv => iv.token === token && !iv.used);
    if (!invite) return { error: "invalid or used invite" };
  }
  const m = { token: rid(), teamId, displayName: String(displayName || "GM").slice(0, 40), isAdmin: false, joinedAt: now(), email: invite ? invite.email : null };
  L.members.push(m);
  if (invite) { invite.used = true; }
  persistAppend(L, { t: "member", ...m });
  if (invite) persistAppend(L, { t: "invite-used", token: invite.token });
  pushEvent(L, "member_joined", { teamId, displayName: m.displayName, count: L.members.length });
  return { member: m };
}

function startLeague(L) {
  if (L.phase !== "lobby") return { error: "already started" };
  // Commissioner clicked START. Fantasy-draft leagues route through the
  // drafting phase first; default leagues go straight to active as before.
  if (L.settings.rosterMode === "fantasy_draft") return beginDraft(L);
  L.phase = "active";
  persistAppend(L, { t: "phase", phase: L.phase, season: L.season, week: L.week });
  pushEvent(L, "started", { season: L.season, week: L.week, members: L.members.length });
  armSchedule(L);
  return { ok: true };
}

// ── Fantasy draft (FANTASY_DRAFT_DESIGN.md S2 — the server is the authority) ─
// The draft is the pure function (poolSeed + settings + tape) → 32 rosters.
// The server owns the seed and the tape; clients submit PICK INTENT only and
// re-derive everything else. Cheat surfaces closed here:
//   • seed re-roll: minted ONCE inside beginDraft, after the commissioner's
//     settings are frozen for the draft (recorded in the draft-start record);
//   • out-of-turn / duplicate / illegal picks: validated against the derived
//     state before anything is appended;
//   • roster tampering: rosters are never uploaded — artifactHash covers
//     (seed, year, rounds, order, tape) and resultHash the derived rosters,
//     so any participant can re-derive and verify.
let _draftKit = null;
function draftKit() {
  // Lazy: a league server that never hosts a fantasy draft never loads the
  // generator bundle (~150ms first build, cached after).
  if (!_draftKit) _draftKit = require("./draft-host.js").loadDraftKit();
  return _draftKit;
}
function liveDraftState(L) {
  const kit = draftKit();
  if (!L._built || L._builtSeed !== L.draft.poolSeed) {
    L._built = kit._fdBuildPool(L.draft.poolSeed, L.draft.year);
    L._built.order = L.draft.order; // persisted order is the artifact input
    L._builtSeed = L.draft.poolSeed;
    L._dst = null;
  }
  if (!L._dst) {
    L._dst = kit._fdApplyTape(L._built, L.draft.tape);
  } else {
    for (; L._dst.pickIdx < L.draft.tape.length; L._dst.pickIdx++) {
      kit._fdApplyPick(L._dst, L.draft.tape[L._dst.pickIdx]);
    }
  }
  return L._dst;
}
function appendDraftPick(L, teamId, pid, auto) {
  L.draft.tape.push({ teamId, pid, auto: !!auto });
  persistAppend(L, { t: "draft-pick", teamId, pid, auto: !!auto });
}
function beginDraft(L) {
  const kit = draftKit();
  L.phase = "drafting";
  L.draft = {
    poolSeed: crypto.randomBytes(4).readUInt32LE(0),
    year: new Date().getFullYear(),
    order: null, tape: [], done: false, artifactHash: null, resultHash: null,
  };
  L.draft.order = kit._fdBuildPool(L.draft.poolSeed, L.draft.year).order;
  persistAppend(L, { t: "phase", phase: L.phase, season: L.season, week: L.week });
  persistAppend(L, {
    t: "draft-start", poolSeed: L.draft.poolSeed, year: L.draft.year,
    order: L.draft.order, draftRounds: L.settings.draftRounds,
  });
  pushEvent(L, "draft_started", {
    poolSeed: L.draft.poolSeed, year: L.draft.year, order: L.draft.order,
    rounds: L.settings.draftRounds, poolSize: L.draft.order.length * kit.FD_PICKS_PER_TEAM,
  });
  draftPump(L);
  return { ok: true, drafting: true };
}
// Advance the draft: auto-pick every AI turn (and every turn past the
// interactive rounds); stop and arm the clock when a HUMAN is on the clock.
function draftPump(L) {
  if (L.phase !== "drafting") return;
  if (L.draftTimer) { clearTimeout(L.draftTimer); L.draftTimer = null; }
  const kit = draftKit();
  const st = liveDraftState(L);
  const n = L.draft.order.length;
  const total = n * kit.FD_PICKS_PER_TEAM;
  const interactive = L.settings.draftRounds * n;
  const batch = [];
  const flush = () => {
    // Auto-picks stream as batched events (a full auto-fill is ~1,600 picks —
    // one event per pick would churn the 500-entry event log to nothing).
    for (let i = 0; i < batch.length; i += 120) {
      pushEvent(L, "picks", { from: batch[i].i, picks: batch.slice(i, i + 120).map(e => [e.teamId, e.pid]) });
    }
    batch.length = 0;
  };
  for (;;) {
    if (st.pickIdx >= total) { flush(); return finalizeDraft(L); }
    const teamId = kit._fdOnClock(st, st.pickIdx);
    const human = L.members.find(m => m.teamId === teamId);
    if (human && st.pickIdx < interactive) {
      flush();
      pushEvent(L, "on_clock", { i: st.pickIdx, teamId, displayName: human.displayName, clockMs: L.settings.pickClockMs || 0 });
      return armPickClock(L, st.pickIdx);
    }
    const p = kit._fdAutoPick(st, teamId);
    if (!p) { flush(); pushEvent(L, "draft_error", { i: st.pickIdx }); return; } // unreachable (feasibility rule)
    batch.push({ i: st.pickIdx, teamId, pid: p.pid });
    appendDraftPick(L, teamId, p.pid, true);
    kit._fdApplyPick(st, { teamId, pid: p.pid });
    st.pickIdx = L.draft.tape.length;
  }
}
function armPickClock(L, pickIdx) {
  const ms = L.settings.pickClockMs;
  if (!ms) return; // no clock — the human pick can wait indefinitely
  L.draftTimer = setTimeout(() => {
    L.draftTimer = null;
    if (L.phase !== "drafting") return;
    const kit = draftKit();
    const st = liveDraftState(L);
    if (st.pickIdx !== pickIdx) return; // pick already made — stale timer
    const teamId = kit._fdOnClock(st, st.pickIdx);
    const p = kit._fdAutoPick(st, teamId);
    if (!p) return;
    appendDraftPick(L, teamId, p.pid, true);
    kit._fdApplyPick(st, { teamId, pid: p.pid });
    st.pickIdx = L.draft.tape.length;
    pushEvent(L, "pick", { i: pickIdx, teamId, pid: p.pid, auto: true, timeout: true });
    draftPump(L);
  }, ms);
  if (L.draftTimer.unref) L.draftTimer.unref();
}
function submitDraftPick(L, m, pid) {
  if (L.phase !== "drafting") return { error: "no draft in progress" };
  if (m.teamId == null) return { error: "commissioner token has no team seat — use your member token" };
  const kit = draftKit();
  const st = liveDraftState(L);
  const n = L.draft.order.length;
  if (st.pickIdx >= L.settings.draftRounds * n) return { error: "interactive rounds are over — benches auto-fill" };
  const onClock = kit._fdOnClock(st, st.pickIdx);
  if (onClock !== m.teamId) return { error: "not your pick" };
  const p = st.byPid.get(String(pid));
  if (!p) return { error: "no such player" };
  if (st.taken.has(p.pid)) return { error: "player already drafted" };
  if (!kit._fdLegal(st, m.teamId, p.position)) return { error: "pick blocked by position rules" };
  if (L.draftTimer) { clearTimeout(L.draftTimer); L.draftTimer = null; }
  const i = st.pickIdx;
  appendDraftPick(L, m.teamId, p.pid, false);
  kit._fdApplyPick(st, { teamId: m.teamId, pid: p.pid });
  st.pickIdx = L.draft.tape.length;
  pushEvent(L, "pick", { i, teamId: m.teamId, pid: p.pid, auto: false, by: m.displayName });
  draftPump(L);
  return { ok: true, i, pid: p.pid };
}
function finalizeDraft(L) {
  const kit = draftKit();
  const st = liveDraftState(L);
  const canonical = JSON.stringify({
    poolSeed: L.draft.poolSeed, year: L.draft.year,
    draftRounds: L.settings.draftRounds, order: L.draft.order,
    tape: L.draft.tape.map(e => [e.teamId, e.pid, e.auto ? 1 : 0]),
  });
  L.draft.artifactHash = crypto.createHash("sha256").update(canonical).digest("hex");
  L.draft.resultHash = crypto.createHash("sha256")
    .update(JSON.stringify(L.draft.order.map(t => [t, st.rosters[t].map(p => p.pid)])))
    .digest("hex");
  L.draft.done = true;
  L.phase = "active";
  persistAppend(L, { t: "draft-complete", artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash });
  persistAppend(L, { t: "phase", phase: L.phase, season: L.season, week: L.week });
  pushEvent(L, "draft_complete", { artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash, picks: L.draft.tape.length });
  pushEvent(L, "started", { season: L.season, week: L.week, members: L.members.length });
  armSchedule(L);
  return { ok: true };
}

function updateSettings(L, patch) {
  const next = sanitizeSettings({ ...L.settings, ...patch });
  // teamCount can't drop below current members
  next.teamCount = Math.max(next.teamCount, L.members.length);
  L.settings = next;
  persistAppend(L, { t: "settings", settings: L.settings });
  pushEvent(L, "settings", L.settings);
  armSchedule(L);
  // Mid-draft settings change (e.g. the commissioner turns the pick clock on
  // for an absent GM): re-pump so the new clock arms on the current pick.
  if (L.phase === "drafting") draftPump(L);
  return L.settings;
}

function advanceLeague(L, reason) {
  if (L.phase !== "active") return { error: "dynasty not active" };
  // M1: progress the league clock (18-week seasons, then rollover). The actual
  // game-sim/offseason resolution server-side is the next phase.
  if (L.week >= 18) { L.week = 1; L.season += 1; }
  else { L.week += 1; }
  persistAppend(L, { t: "advance", season: L.season, week: L.week, reason: reason || "manual" });
  pushEvent(L, "advanced", { season: L.season, week: L.week, reason: reason || "manual" });
  return { season: L.season, week: L.week };
}

function armSchedule(L) {
  if (L.timer) { clearTimeout(L.timer); L.timer = null; }
  if (L.phase === "active" && L.settings.advanceMode === "scheduled" && L.settings.advanceIntervalMs > 0) {
    L.timer = setTimeout(() => { advanceLeague(L, "scheduled"); armSchedule(L); }, L.settings.advanceIntervalMs);
    if (L.timer.unref) L.timer.unref();
  }
}

// ── persistence reload ───────────────────────────────────────────────────────
function loadPersisted() {
  let files = [];
  try { files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".jsonl")); } catch (_) { return; }
  for (const f of files) {
    try {
      const lines = fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
      const h = lines.find(l => l.t === "header"); if (!h) continue;
      const L = newLeagueShell(h);
      for (const l of lines) {
        if (l.t === "member") { if (!L.members.some(m => m.token === l.token)) L.members.push({ token: l.token, teamId: l.teamId, displayName: l.displayName, isAdmin: l.isAdmin, joinedAt: l.joinedAt, email: l.email || null }); }
        else if (l.t === "invite") { if (!L.invites.some(iv => iv.token === l.token)) L.invites.push({ token: l.token, email: l.email || null, used: !!l.used, createdAt: l.createdAt }); }
        else if (l.t === "invite-used") { const iv = L.invites.find(x => x.token === l.token); if (iv) iv.used = true; }
        else if (l.t === "settings") L.settings = sanitizeSettings(l.settings);
        else if (l.t === "phase" || l.t === "advance") { L.phase = l.phase || L.phase; if (l.season) L.season = l.season; if (l.week) L.week = l.week; }
        else if (l.t === "draft-start") L.draft = { poolSeed: l.poolSeed, year: l.year, order: l.order, tape: [], done: false, artifactHash: null, resultHash: null };
        else if (l.t === "draft-pick") { if (L.draft) L.draft.tape.push({ teamId: l.teamId, pid: l.pid, auto: !!l.auto }); }
        else if (l.t === "draft-complete") { if (L.draft) { L.draft.done = true; L.draft.artifactHash = l.artifactHash; L.draft.resultHash = l.resultHash; } }
      }
      leagues.set(L.id, L);
      armSchedule(L);   // re-arm scheduled advances after a restart
      // A draft interrupted by the restart resumes exactly where it stopped —
      // determinism IS the recovery: the tape replays, then the pump continues.
      if (L.phase === "drafting" && L.draft) setTimeout(() => { try { draftPump(L); } catch (e) { console.warn("[league draft resume]", L.id, e.message); } }, 50);
    } catch (e) { console.warn("[league reload]", f, e.message); }
  }
  console.log(`[league] reloaded ${leagues.size} league(s)`);
}

// ── http plumbing ────────────────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > 2e6) reject(new Error("body too large")); });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
  });
}
function adminAuth(id, token) {
  const L = leagues.get(id);
  if (!L) return { error: "no such league" };
  if (L.adminToken !== token) return { error: "not the commissioner" };
  return { L };
}
function memberAuth(id, token) {
  const L = leagues.get(id);
  if (!L) return { error: "no such league" };
  const m = L.members.find(x => x.token === token) || (L.adminToken === token ? { isAdmin: true } : null);
  if (!m) return { error: "bad token" };
  return { L, m };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, leagues: leagues.size, static: STATIC });

    if (req.method === "POST" && url.pathname === "/api/league") {
      const b = await readBody(req);
      const L = createLeague(b);
      const admin = L.members[0];
      return json(res, 200, { leagueId: L.id, adminToken: L.adminToken, memberToken: admin.token, teamId: admin.teamId, joinCode: L.joinCode, link: `#league=${L.id}.${L.joinCode}` });
    }
    if (req.method === "POST" && url.pathname === "/api/league/invite") {
      const b = await readBody(req);
      const a = adminAuth(b.leagueId, b.adminToken); if (a.error) return json(res, 403, a);
      const invites = addInvites(a.L, b.emails, b.count).map(iv => ({ email: iv.email, token: iv.token, link: `#league=${a.L.id}.${iv.token}` }));
      return json(res, 200, { invites, mailer: process.env.HH_MAIL_CMD ? "configured" : "links-only" });
    }
    if (req.method === "POST" && url.pathname === "/api/league/join") {
      const b = await readBody(req);
      const L = leagues.get(b.leagueId); if (!L) return json(res, 404, { error: "no such league" });
      const r = joinLeague(L, b); if (r.error) return json(res, 400, r);
      return json(res, 200, { memberToken: r.member.token, teamId: r.member.teamId, league: publicLeague(L) });
    }
    if (req.method === "POST" && url.pathname === "/api/league/start") {
      const b = await readBody(req);
      const a = adminAuth(b.leagueId, b.adminToken); if (a.error) return json(res, 403, a);
      const r = startLeague(a.L); if (r.error) return json(res, 400, r);
      return json(res, 200, { ok: true, league: publicLeague(a.L) });
    }
    if (req.method === "POST" && url.pathname === "/api/league/settings") {
      const b = await readBody(req);
      const a = adminAuth(b.leagueId, b.adminToken); if (a.error) return json(res, 403, a);
      return json(res, 200, { settings: updateSettings(a.L, b) });
    }
    if (req.method === "POST" && url.pathname === "/api/league/advance") {
      const b = await readBody(req);
      const a = adminAuth(b.leagueId, b.adminToken); if (a.error) return json(res, 403, a);
      const r = advanceLeague(a.L, "manual"); if (r.error) return json(res, 400, r);
      return json(res, 200, r);
    }
    // Fantasy draft: submit PICK INTENT for your own team's turn. The server
    // validates (phase / turn / availability / position rules) and appends to
    // the tape; everything else is derived client-side from (seed, tape).
    if (req.method === "POST" && url.pathname === "/api/league/draft/pick") {
      const b = await readBody(req);
      const auth = memberAuth(b.leagueId, b.token); if (auth.error) return json(res, 403, auth);
      const r = submitDraftPick(auth.L, auth.m, b.pid); if (r.error) return json(res, 400, r);
      return json(res, 200, r);
    }
    // Full draft state for (re)sync: the seed + settings + tape a client needs
    // to re-derive the entire draft (SSE only carries the last 500 events).
    if (req.method === "GET" && url.pathname.startsWith("/api/league/draft/")) {
      const id = url.pathname.split("/").pop();
      const token = url.searchParams.get("token");
      const auth = memberAuth(id, token); if (auth.error) return json(res, 403, auth);
      const L = auth.L;
      if (!L.draft) return json(res, 404, { error: "no draft for this league" });
      const kit = draftKit();
      const st = liveDraftState(L);
      const n = L.draft.order.length;
      return json(res, 200, {
        poolSeed: L.draft.poolSeed, year: L.draft.year, order: L.draft.order,
        rounds: L.settings.draftRounds, pickClockMs: L.settings.pickClockMs,
        tape: L.draft.tape, done: L.draft.done,
        artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash,
        pickIdx: st.pickIdx,
        onClockTeamId: st.pickIdx < n * kit.FD_PICKS_PER_TEAM ? kit._fdOnClock(st, st.pickIdx) : null,
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/league/events/")) {
      const id = url.pathname.split("/").pop();
      const token = url.searchParams.get("token");
      const auth = memberAuth(id, token); if (auth.error) return json(res, 403, auth);
      const L = auth.L;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
      const since = Number(url.searchParams.get("since") || 0);
      for (const ev of L.eventLog) if (ev.seq > since) writeSse(res, ev);
      res.write(": connected\n\n");
      L.subscribers.add(res);
      req.on("close", () => L.subscribers.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/league/")) {
      const id = url.pathname.split("/").pop();
      const token = url.searchParams.get("token");
      const auth = memberAuth(id, token); if (auth.error) return json(res, 403, auth);
      return json(res, 200, { league: publicLeague(auth.L), you: auth.m.isAdmin ? { isAdmin: true } : { teamId: auth.m.teamId } });
    }

    if (STATIC && req.method === "GET") return serveStatic(url.pathname, res);
    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
});

// optional static file serving (single-process deploy), path-traversal guarded
function serveStatic(pathname, res) {
  let p = pathname === "/" ? "/play.html" : pathname;
  const root = path.resolve(__dirname, "..");
  const full = path.resolve(root, "." + p);
  if (!full.startsWith(root)) return json(res, 403, { error: "forbidden" });
  fs.readFile(full, (err, data) => {
    if (err) return json(res, 404, { error: "not found" });
    const ext = path.extname(full).slice(1);
    const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", png: "image/png", woff2: "font/woff2", svg: "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

loadPersisted();
server.listen(PORT, () => console.log(`[league] dynasty server on :${PORT}${STATIC ? " (+static)" : ""}  data=${DATA_DIR}`));

module.exports = { createLeague, joinLeague, startLeague, advanceLeague, updateSettings, addInvites, leagues };
