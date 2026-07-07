// ─── Hashmark Heroes — shared-DYNASTY (league) server ────────────────────────
// Authoritative server for MULTIPLAYER DYNASTIES: a group runs one league
// together, each member controlling a team, with a commissioner (admin) who
// invites people (email or link), starts the dynasty, and controls advancement
// (manual or on a schedule). Plain Node, ZERO npm dependencies, no build step —
// same discipline as the H2H match server (server/h2h-server.js). Companion
// design: INGAME_CLOCK_AND_MULTIPLAYER.md.
//
// Phase M1 = lifecycle + membership + invites + commissioner controls +
// advancement MODE (manual | scheduled).
//
// Phase M2 = SHARED-SEASON SIM (this file, "season" sections below): the
// league is one REAL season, owned by the server. START mints a leagueSeed;
// default-roster leagues derive canonical rosters from it (the fantasy-draft
// pattern minus picks — `_fdBuildDefaultLeague`); fantasy leagues take their
// rosters from the finished draft (poolSeed + tape). Each `advance` sims the
// current week's games through the hosted engine (the same bundle draft-host
// already loads carries GameSimulator) under _setSimRng(per-game seed),
// records {scores, resultHash} per game (server/result-hash.js), applies
// standings, and broadcasts `week_results` over the existing SSE plumbing.
//
// Phase M3 = PLAYOFFS + ROLLOVER: after the final regular week the league
// enters "season_complete"; each further advance sims one bracket round
// (seeded as a PURE FOLD of the published standings — win% → point diff →
// PF → teamId, no RNG; 7 seeds/conference, #1 bye, reseed, Super Bowl) with
// {isPlayoff:true} at week = seasonWeeks+round+1, publishing results +
// hashes per round ("playoff_results" SSE). Champion → "season_over"; one
// more advance rolls to season N+1 — same canonical rosters ("arcade"
// rollover v1; cross-season player development is its own future slice),
// standings reset, per-game seeds re-namespace via the season hash input.
// Scheduled leagues self-drive through the whole loop.
//
// M2 anti-cheat surfaces (CLAUDE.md discipline — named + closed):
//   • seed shopping (server re-rolls until it likes the results): leagueSeed
//     is minted ONCE at START, before any sim, and published in the started
//     event + snapshot. Per-game seeds are a PURE HASH of published inputs —
//     sha256("hh-league-game|leagueSeed|season|week|homeId|awayId") first 4
//     bytes LE — so there is no per-game entropy to shop.
//   • fabricated scores: every game carries resultHash; the schedule is
//     RNG-free (generateFranchiseSchedule) and rosters re-derive from the
//     published genesis, so ANY participant can re-sim any game headlessly
//     (portable math, no franchise loaded — the league-probe does exactly
//     this) and compare hashes. Results are proven, never typed in.
//   • client-submitted outcomes: none exist — advance is commissioner intent
//     only; all outcomes are computed server-side.
//   • standings tampering: standings are a pure fold over the published
//     results; the probe recomputes them independently.
//
// API (all JSON; auth = admin token or per-member token):
//   POST /api/league            {name, adminTeamId, adminName, settings}
//        → {leagueId, adminToken, memberToken, joinCode, link}
//   POST /api/league/invite     {leagueId, adminToken, emails:[...] , count?}
//        → {invites:[{email, token, link}]}            (links to send; see EMAIL note)
//   POST /api/league/join       {leagueId, token, teamId, displayName}
//        → {memberToken, teamId}                       (token = invite token OR joinCode)
//   GET  /api/league/:id?token=T                       league snapshot
//   POST /api/league/start      {leagueId, adminToken}      lobby → active (mints leagueSeed)
//   POST /api/league/settings   {leagueId, adminToken, advanceMode, advanceIntervalMs, deadlineLabel}
//   POST /api/league/advance    {leagueId, adminToken}      sims the week, then week+1
//   POST /api/league/draft/pick {leagueId, token, pid}       fantasy draft: pick intent (your turn only)
//   POST /api/league/draft/queue {leagueId, token, pids:[…]}  private queue; clock timeouts take it first
//   GET  /api/league/draft/:id?token=T                       full draft state (seed/order/tape) for resync
//   GET  /api/league/season/:id?token=T                      full season state (results + standings) for resync
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
const { resultHash } = require("./result-hash.js");

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
  const weeks = Object.keys(L.results).map(Number);
  const lastWeek = weeks.length ? Math.max(...weeks) : 0;
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
    // M2 shared season: genesis + standings + the LAST simmed week inline;
    // the full week-by-week ledger via GET /api/league/season/:id.
    leagueSeed: L.leagueSeed, year: L.year, rostersHash: L.rostersHash,
    standings: L.standings,
    lastResults: lastWeek ? { week: lastWeek, games: L.results[lastWeek] } : null,
    playoffs: L.playoffs, champions: L.champions || [],
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
    queues: {},   // memberToken → [pids] — PRIVATE pick queues (never broadcast)
    // ── M2 shared season ──
    leagueSeed: null,   // uint32 minted at START (schedule/game seeds + default-roster gen)
    year: null,         // pinned at START so gen replays after New Year's still match
    rostersHash: null,  // default leagues: sha256(_fdRosterIds(derived rosters))
    results: {},        // week → [{week, homeId, awayId, homeScore, awayScore, resultHash}]
    standings: null,    // teamId → {w, l, t, pf, pa} — persisted with each week-results record
    playoffs: null,     // M3 bracket state {season, roundIdx, seeds, alive, rounds, champion}
    champions: [],      // [{season, teamId}] — the trophy shelf
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
    // Probe-only (see seasonWeeks()): dropped entirely outside HH_LEAGUE_TEST.
    ...(process.env.HH_LEAGUE_TEST && Number(s.seasonWeeks) > 0 ? { seasonWeeks: Math.floor(Number(s.seasonWeeks)) } : {}),
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
  // Commissioner clicked START. Every league mints its genesis seed HERE —
  // once, before any sim, published immediately (seed-shopping closed).
  // Fantasy-draft leagues route through the drafting phase first; default
  // leagues derive canonical rosters from the seed and go active.
  L.leagueSeed = crypto.randomBytes(4).readUInt32LE(0);
  L.year = new Date().getFullYear();
  persistAppend(L, { t: "season-genesis", leagueSeed: L.leagueSeed, year: L.year });
  if (L.settings.rosterMode === "fantasy_draft") return beginDraft(L);
  const kit = draftKit();
  const built = kit._fdBuildDefaultLeague(L.leagueSeed, L.year);
  L.rostersHash = crypto.createHash("sha256").update(kit._fdRosterIds(built.rosters)).digest("hex");
  L._seasonRosters = built.rosters;   // cache (re-derivable — never persisted)
  L.standings = kit.initStandings();
  persistAppend(L, { t: "rosters-hash", rostersHash: L.rostersHash });
  persistAppend(L, { t: "standings", standings: L.standings });
  L.phase = "active";
  persistAppend(L, { t: "phase", phase: L.phase, season: L.season, week: L.week });
  pushEvent(L, "started", {
    season: L.season, week: L.week, members: L.members.length,
    leagueSeed: L.leagueSeed, year: L.year, rostersHash: L.rostersHash,
  });
  armSchedule(L);
  return { ok: true };
}

// ── M2 shared season — server-side week sims ────────────────────────────────
// The season is a pure function of published inputs: rosters from the genesis
// (leagueSeed for default leagues, poolSeed+tape for fantasy), the RNG-free
// schedule, and per-game seeds hashed from (leagueSeed, season, week, teams).
// The server holds no outcome authority a verifier can't re-derive.
const SEASON_WEEKS = 18;   // = FRANCHISE_WEEKS (schedule spans 18 weeks, 1 bye)
// Probe-only override: a 1-week "season" exercises the season_complete
// parking without 18 real sims. Test-gated in sanitizeSettings — outside
// HH_LEAGUE_TEST the field is dropped, so a commissioner can NOT shorten a
// live season (that would be a real cheat surface). Only gates the phase
// flip; the schedule and every per-game seed are untouched.
function seasonWeeks(L) { return (process.env.HH_LEAGUE_TEST && L.settings.seasonWeeks) || SEASON_WEEKS; }

function gameSeed(leagueSeed, season, week, homeId, awayId) {
  // First 4 bytes (LE) of sha256 over pipe-joined published inputs. No
  // entropy: same league, same fixture → same seed, on any machine.
  const h = crypto.createHash("sha256")
    .update(`hh-league-game|${leagueSeed}|${season}|${week}|${homeId}|${awayId}`).digest();
  return h.readUInt32LE(0);
}

let _schedCache = null;
function leagueSchedule(kit) {
  // generateFranchiseSchedule is RNG-free — one flat 272-game array shared by
  // every league and every client (no per-league derivation needed).
  if (!_schedCache) _schedCache = kit.generateFranchiseSchedule();
  return _schedCache;
}

function seasonRosters(L) {
  if (L._seasonRosters) return L._seasonRosters;
  const kit = draftKit();
  if (L.settings.rosterMode === "fantasy_draft") {
    if (!L.draft || !L.draft.done) return null;
    L._seasonRosters = liveDraftState(L).rosters;   // (poolSeed + tape) → rosters
  } else {
    if (L.leagueSeed == null) return null;
    L._seasonRosters = kit._fdBuildDefaultLeague(L.leagueSeed, L.year).rosters;
  }
  return L._seasonRosters;
}

function applyResult(standings, g) {
  // Mirrors recordFranchiseResult's core (play-franchise-core.js) — W/L/T + PF/PA.
  const h = standings[g.homeId], a = standings[g.awayId];
  if (!h || !a) return;
  h.pf += g.homeScore; h.pa += g.awayScore;
  a.pf += g.awayScore; a.pa += g.homeScore;
  if (g.homeScore > g.awayScore) { h.w++; a.l++; }
  else if (g.awayScore > g.homeScore) { a.w++; h.l++; }
  else { h.t++; a.t++; }
}

// ── M3 playoffs — bracket as a PURE FOLD of the published standings ──────────
// Anti-cheat: seeding uses a documented TOTAL ORDER over published data (win%
// desc → point diff desc → PF desc → teamId asc — no RNG, no h2h lookups a
// verifier would have to reconstruct), so any member re-derives the identical
// bracket from GET /api/league/season. 14-team format mirroring the client
// franchise: 7 seeds per conference, #1 bye, reseed each round, then the
// Super Bowl (better seed-order team is "home" for the sim). Per-game seeds
// reuse the published formula with week = seasonWeeks + roundIdx + 1, so
// playoff games can never collide with regular-season seeds. A playoff sim
// runs {isPlayoff:true} (engine playoff OT — ties can't happen; if the engine
// ever returned one anyway, the HIGHER SEED advances, documented here).
const PLAYOFF_ROUNDS = ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"];
function _seedOrder(kit, standings) {
  const rank = (tid) => {
    const s = standings[tid] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    const gp = s.w + s.l + s.t;
    return { pct: gp ? (s.w + s.t / 2) / gp : 0, diff: s.pf - s.pa, pf: s.pf };
  };
  const cmp = (a, b) => {
    const ra = rank(a), rb = rank(b);
    return rb.pct - ra.pct || rb.diff - ra.diff || rb.pf - ra.pf || a - b;
  };
  const seeds = {};
  for (const conf of ["AFC", "NFC"]) {
    seeds[conf] = kit.TEAMS.filter(t => t.conference === conf).map(t => t.id).sort(cmp).slice(0, 7);
  }
  return seeds;
}
// Matchups for the round about to be simmed. `alive` = seed-ordered surviving
// teamIds per conference (seed order is the seeds array order, which reseeding
// preserves by filtering it).
function _playoffMatchups(P, roundIdx) {
  const pair = (arr) => {
    // Highest surviving hosts lowest surviving, and so on inward.
    const g = [];
    for (let i = 0; i < Math.floor(arr.length / 2); i++) {
      g.push({ homeId: arr[i], awayId: arr[arr.length - 1 - i] });
    }
    return g;
  };
  if (roundIdx === 3) {
    // Super Bowl: the two conference champions; better regular-season seed
    // order hosts (deterministic; conceptually a neutral field).
    const [a] = P.alive.AFC, [n] = P.alive.NFC;
    const home = P.sbHomeConf === "AFC" ? a : n;
    const away = home === a ? n : a;
    return [{ homeId: home, awayId: away, conf: "SB" }];
  }
  const out = [];
  for (const conf of ["AFC", "NFC"]) {
    const alive = P.alive[conf];
    const field = roundIdx === 0 ? alive.slice(1) : alive; // #1 byes the Wild Card
    for (const m of pair(field)) out.push({ ...m, conf });
  }
  return out;
}
// Sims the round P.roundIdx into P (a detached clone — the caller persists
// BEFORE committing P onto the league, the atomic-advance discipline).
async function _simPlayoffRound(L, kit, P) {
  const week = seasonWeeks(L) + P.roundIdx + 1;
  const fixtures = _playoffMatchups(P, P.roundIdx);
  const results = [];
  for (const g of fixtures) {
    const r = simLeagueGame(kit, L, week, g.homeId, g.awayId, /*isPlayoff=*/true);
    let winnerId;
    if (r.homeScore !== r.awayScore) {
      winnerId = r.homeScore > r.awayScore ? g.homeId : g.awayId;
    } else {
      // Documented backstop (engine playoff OT should never tie): the higher
      // seed advances — earlier in the conference's alive order; SB: the
      // seed-order host.
      const order = g.conf === "SB" ? [g.homeId, g.awayId]
        : (P.alive[g.conf] || []).filter(id => id === g.homeId || id === g.awayId);
      winnerId = order[0];
    }
    results.push({ week, conf: g.conf, homeId: g.homeId, awayId: g.awayId,
      homeScore: r.homeScore, awayScore: r.awayScore, winnerId, resultHash: resultHash(r) });
    await new Promise(res => setImmediate(res));
  }
  // Fold survivors, preserving seed order (this IS the reseed).
  if (P.roundIdx === 3) {
    P.champion = results[0].winnerId;
  } else {
    const winners = new Set(results.map(r => r.winnerId));
    for (const conf of ["AFC", "NFC"]) {
      const byeTeam = P.roundIdx === 0 ? [P.alive[conf][0]] : [];
      P.alive[conf] = [...byeTeam, ...P.alive[conf].filter(id => winners.has(id) && !byeTeam.includes(id))];
    }
    if (P.roundIdx === 2) {
      // Which conference hosts the Super Bowl: the champion ranked better in
      // the ORIGINAL seeding order (same published total order; ties by conf id).
      const a = P.alive.AFC[0], n = P.alive.NFC[0];
      const aPos = P.seeds.AFC.indexOf(a), nPos = P.seeds.NFC.indexOf(n);
      P.sbHomeConf = aPos < nPos ? "AFC" : aPos > nPos ? "NFC" : (a < n ? "AFC" : "NFC");
    }
  }
  P.rounds.push(results);
  P.roundIdx += 1;
  return results;
}

function simLeagueGame(kit, L, week, homeId, awayId, isPlayoff) {
  const home = kit.TEAMS.find(t => t.id === homeId);
  const away = kit.TEAMS.find(t => t.id === awayId);
  const rosters = seasonRosters(L);
  const seed = gameSeed(L.leagueSeed, L.season, week, homeId, awayId);
  // Portable math for the SIM only: a challenger on different hardware must
  // reproduce the result bit-for-bit (the h2h-server discipline). Restored to
  // native in finally — roster GEN stays native (the shipped fantasy-draft
  // status quo; the cross-machine gen audit is a separate queued task), so a
  // verifier re-derives rosters natively, then re-sims games portably.
  // Rosters are cloned per sim — the engine mutates player objects.
  // Playoff games sim with {isPlayoff:true} (engine playoff OT — a verifier
  // must pass the same option; documented in the M3 header).
  const clone = (x) => JSON.parse(JSON.stringify(x));
  if (kit._setPortableMath) kit._setPortableMath(true);
  kit._setSimRng(seed >>> 0);
  try {
    const sim = new kit.GameSimulator(home, away, clone(rosters[homeId]), clone(rosters[awayId]),
      isPlayoff ? { isPlayoff: true } : undefined);
    return sim.simulate();
  } finally {
    kit._clearSimRng();
    if (kit._setPortableMath) kit._setPortableMath(false);
  }
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
    // The SEASON seed root, committed to the public event log BEFORE any pick
    // exists. Without this, a fantasy draft left the leagueSeed server-private
    // until finalizeDraft's `started` event — a window in which an operator
    // knowing the finished rosters could shop seeds. Published here, there is
    // nothing to shop: no roster knowledge exists yet, and clients can pin it
    // against the value the season later reports (adversarial-review finding).
    leagueSeed: L.leagueSeed,
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
    // A timed-out human's PRIVATE queue is honored first (first queued player
    // still available AND legal), then BPA-by-need — the fantasy-platform
    // contract that makes long async clocks livable. Only the resulting tape
    // entry is the artifact, so replay/verification are unaffected.
    const member = L.members.find(m => m.teamId === teamId);
    const p = (member && queuedBest(kit, st, teamId, L.queues[member.token])) || kit._fdAutoPick(st, teamId);
    if (!p) return;
    appendDraftPick(L, teamId, p.pid, true);
    kit._fdApplyPick(st, { teamId, pid: p.pid });
    st.pickIdx = L.draft.tape.length;
    pushEvent(L, "pick", { i: pickIdx, teamId, pid: p.pid, auto: true, timeout: true });
    draftPump(L);
  }, ms);
  if (L.draftTimer.unref) L.draftTimer.unref();
}
function queuedBest(kit, st, teamId, pids) {
  for (const pid of (pids || [])) {
    if (st.taken.has(pid)) continue;
    const p = st.byPid.get(pid);
    if (p && kit._fdLegal(st, teamId, p.position)) return p;
  }
  return null;
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
  // M2: the drafted league is the season's roster genesis (its fingerprint is
  // the draft resultHash — rostersHash stays null for fantasy leagues).
  L._seasonRosters = null;   // rebuilt lazily from (poolSeed + tape) on first sim
  L.standings = kit.initStandings();
  persistAppend(L, { t: "standings", standings: L.standings });
  persistAppend(L, { t: "draft-complete", artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash });
  persistAppend(L, { t: "phase", phase: L.phase, season: L.season, week: L.week });
  pushEvent(L, "draft_complete", { artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash, picks: L.draft.tape.length });
  pushEvent(L, "started", { season: L.season, week: L.week, members: L.members.length, leagueSeed: L.leagueSeed, year: L.year });
  armSchedule(L);
  return { ok: true };
}

function updateSettings(L, patch) {
  const next = sanitizeSettings({ ...L.settings, ...patch });
  // teamCount can't drop below current members
  next.teamCount = Math.max(next.teamCount, L.members.length);
  // GENESIS FIELDS FREEZE once the league leaves the lobby: rosterMode is the
  // season's roster-genesis POINTER (seasonRosters branches on it every
  // advance) and draftRounds is a hashed draft input — a post-START flip
  // would let a commissioner swap the genesis every member verified (or
  // brick a default league mid-season). Adversarial-review finding, closed
  // with the same discipline as the seasonWeeks test gate.
  if (L.phase !== "lobby") {
    next.rosterMode = L.settings.rosterMode;
    next.draftRounds = L.settings.draftRounds;
    if ("seasonWeeks" in L.settings) next.seasonWeeks = L.settings.seasonWeeks;
    else delete next.seasonWeeks;
  }
  L.settings = next;
  persistAppend(L, { t: "settings", settings: L.settings });
  pushEvent(L, "settings", L.settings);
  armSchedule(L);
  // Mid-draft settings change (e.g. the commissioner turns the pick clock on
  // for an absent GM): re-pump so the new clock arms on the current pick.
  if (L.phase === "drafting") draftPump(L);
  return L.settings;
}

async function advanceLeague(L, reason) {
  if (L._simming) return { error: "week sim already in progress" };
  // M3: the postseason rides the SAME commissioner-intent advance —
  //   active (weeks 1..N) → season_complete → [seed bracket + Wild Card]
  //   → playoffs (rounds) → season_over (champion) → [rollover] → active S+1.
  if (L.leagueSeed != null && (L.phase === "season_complete" || L.phase === "playoffs")) {
    return advancePlayoffRound(L, reason);
  }
  if (L.leagueSeed != null && L.phase === "season_over") {
    return rolloverSeason(L, reason);
  }
  if (L.phase !== "active") return { error: "dynasty not active" };
  if (L.leagueSeed == null) {
    // Pre-M2 league (started before season-genesis existed): keep the M1
    // clock-tick behavior rather than failing the commissioner.
    if (L.week >= SEASON_WEEKS) { L.week = 1; L.season += 1; } else { L.week += 1; }
    persistAppend(L, { t: "advance", season: L.season, week: L.week, reason: reason || "manual" });
    pushEvent(L, "advanced", { season: L.season, week: L.week, reason: reason || "manual" });
    return { season: L.season, week: L.week };
  }
  const kit = draftKit();
  const season = L.season, week = L.week;
  const rosters = seasonRosters(L);
  if (!rosters) return { error: "no season rosters — draft not finished?" };
  const fixtures = leagueSchedule(kit).filter(g => g.week === week);
  L._simming = true;
  try {
    const results = [];
    for (const g of fixtures) {
      const r = simLeagueGame(kit, L, week, g.homeId, g.awayId);
      results.push({
        week, homeId: g.homeId, awayId: g.awayId,
        homeScore: r.homeScore, awayScore: r.awayScore,
        resultHash: resultHash(r),
      });
      // ~150ms of blocking per game — yield between games so SSE/http stay
      // live through a 16-game week (~2.5s total).
      await new Promise(res => setImmediate(res));
    }
    // Fold standings into a fresh CLONE — each week's record and event must
    // carry its own immutable snapshot. (The live object was previously
    // aliased into the event log + jsonl, so later advances mutated replayed
    // history — adversarial-review finding.)
    const standings = JSON.parse(JSON.stringify(L.standings || kit.initStandings()));
    for (const r of results) applyResult(standings, r);
    const nextPhase = week >= seasonWeeks(L) ? "season_complete" : "active";
    const nextWeek = nextPhase === "season_complete" ? week : week + 1;
    // ONE atomic record per advance, persisted BEFORE memory commits. Crash
    // mid-sim → nothing persisted, re-advance re-sims byte-identically
    // (determinism is the recovery). Persist FAILURE → memory untouched, no
    // memory/disk fork. And reload can never double-fold a week — the old
    // week-results/advance record PAIR could tear between the two appends,
    // reloading standings that already contained week W with L.week still at
    // W (re-advance would fold W twice).
    persistAppend(L, {
      t: "week-results", season, week, results, standings,
      next: { season, week: nextWeek, phase: nextPhase }, reason: reason || "manual",
    });
    L.results[week] = results;
    L.standings = standings;
    L.week = nextWeek;
    L.phase = nextPhase;
    if (nextPhase === "season_complete") L._seasonRosters = null; // re-derivable — release the cache
    pushEvent(L, "week_results", { season, week, results, standings });
    pushEvent(L, "advanced", { season: L.season, week: L.week, phase: L.phase, reason: reason || "manual" });
  } finally {
    L._simming = false;
  }
  return { season: L.season, week: L.week, phase: L.phase, simmed: L.results[week].length };
}

// M3: one playoff ROUND per advance. The bracket is seeded on the first call
// (a pure fold of the published standings — see _seedOrder) and published
// with every round's atomic record, so reload and verifiers never re-derive
// from private state.
async function advancePlayoffRound(L, reason) {
  const kit = draftKit();
  if (!seasonRosters(L)) return { error: "no season rosters — draft not finished?" };
  L._simming = true;
  try {
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const P = L.playoffs ? clone(L.playoffs) : (() => {
      const seeds = _seedOrder(kit, L.standings);
      return { season: L.season, roundIdx: 0, seeds,
               alive: { AFC: [...seeds.AFC], NFC: [...seeds.NFC] },
               sbHomeConf: null, rounds: [], champion: null };
    })();
    const roundIdx = P.roundIdx;
    const results = await _simPlayoffRound(L, kit, P);
    const nextPhase = P.champion != null ? "season_over" : "playoffs";
    // Atomic record BEFORE memory commits (the M2 advance discipline): the
    // full playoffs snapshot rides every record — reload takes the last one.
    persistAppend(L, {
      t: "playoff-results", season: L.season, roundIdx, results,
      playoffs: P, next: { phase: nextPhase }, reason: reason || "manual",
    });
    L.playoffs = P;
    L.phase = nextPhase;
    if (P.champion != null) {
      L.champions = L.champions || [];
      if (!L.champions.some(c => c.season === L.season)) L.champions.push({ season: L.season, teamId: P.champion });
    }
    pushEvent(L, "playoff_results", {
      season: L.season, roundIdx, roundName: PLAYOFF_ROUNDS[roundIdx] || `Round ${roundIdx + 1}`,
      results, playoffs: P, champion: P.champion,
    });
    pushEvent(L, "advanced", { season: L.season, week: L.week, phase: L.phase, reason: reason || "manual" });
    return { season: L.season, phase: L.phase, round: PLAYOFF_ROUNDS[roundIdx], simmed: results.length, champion: P.champion };
  } finally {
    L._simming = false;
  }
}

// M3 rollover — "arcade" v1: SAME canonical rosters (the genesis re-derives;
// player development/aging across league seasons is its own future slice),
// standings reset, results cleared, season++. The schedule is RNG-free and
// identical; per-game seeds re-namespace automatically (season is a hash
// input), so season N+1 is a fresh, fully re-derivable season.
function rolloverSeason(L, reason) {
  const kit = draftKit();
  const nextSeason = L.season + 1;
  const standings = kit.initStandings();
  persistAppend(L, {
    t: "rollover", season: nextSeason, standings,
    next: { season: nextSeason, week: 1, phase: "active" }, reason: reason || "manual",
  });
  const champ = L.playoffs?.champion ?? null;
  L.season = nextSeason;
  L.week = 1;
  L.phase = "active";
  L.standings = standings;
  L.results = {};
  L.playoffs = null;
  pushEvent(L, "rollover", { season: nextSeason, lastChampion: champ });
  pushEvent(L, "advanced", { season: L.season, week: L.week, phase: L.phase, reason: reason || "manual" });
  armSchedule(L);
  return { season: L.season, week: L.week, phase: L.phase, rolledOver: true };
}

function armSchedule(L) {
  if (L.timer) { clearTimeout(L.timer); L.timer = null; }
  // M3: scheduled leagues self-drive through the whole loop — weeks, bracket
  // rounds, and the rollover into next season.
  const drivable = ["active", "season_complete", "playoffs", "season_over"].includes(L.phase);
  if (drivable && L.settings.advanceMode === "scheduled" && L.settings.advanceIntervalMs > 0) {
    L.timer = setTimeout(() => {
      Promise.resolve(advanceLeague(L, "scheduled"))
        .catch(e => console.warn("[league advance]", L.id, e.message))
        .then(() => armSchedule(L));
    }, L.settings.advanceIntervalMs);
    if (L.timer.unref) L.timer.unref();
  }
}

// ── persistence reload ───────────────────────────────────────────────────────
function loadPersisted() {
  let files = [];
  try { files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".jsonl")); } catch (_) { return; }
  for (const f of files) {
    try {
      // Per-line tolerant parse: ONE torn/truncated line (a crash mid-append)
      // must skip that line, not drop the whole league (adversarial-review
      // finding — M2's multi-KB week-results appends widened the torn-write
      // window).
      const lines = fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch (_) { console.warn("[league reload] skipping torn line in", f); return null; }
      }).filter(Boolean);
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
        else if (l.t === "draft-queue") L.queues[l.token] = l.pids || [];
        else if (l.t === "season-genesis") { L.leagueSeed = l.leagueSeed; L.year = l.year; }
        else if (l.t === "rosters-hash") L.rostersHash = l.rostersHash;
        else if (l.t === "standings") L.standings = l.standings;
        // week-results carries a standings snapshot so reload never rebuilds
        // rosters/the kit — the LAST record wins (records are appended in
        // order). `next` (the same-record week/phase bump) makes the advance
        // ATOMIC on disk; legacy records without it are followed by a
        // separate "advance" record handled above.
        else if (l.t === "week-results") {
          L.results[l.week] = l.results;
          L.standings = l.standings || L.standings;
          if (l.next) { if (l.next.season) L.season = l.next.season; if (l.next.week) L.week = l.next.week; if (l.next.phase) L.phase = l.next.phase; }
        }
        // M3: each round record carries the full bracket snapshot (last wins);
        // a rollover record resets the season surfaces in one step.
        else if (l.t === "playoff-results") {
          L.playoffs = l.playoffs || L.playoffs;
          if (l.next?.phase) L.phase = l.next.phase;
          if (L.playoffs?.champion != null) {
            L.champions = L.champions || [];
            if (!L.champions.some(c => c.season === l.season)) L.champions.push({ season: l.season, teamId: L.playoffs.champion });
          }
        }
        else if (l.t === "rollover") {
          if (l.next) { L.season = l.next.season; L.week = l.next.week; L.phase = l.next.phase; }
          L.standings = l.standings || L.standings;
          L.results = {};
          L.playoffs = null;
        }
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
      // M2: the week sims inside — the response lands after the results do
      // (~2.5s for a 16-game week; SSE keeps everyone else current).
      const r = await advanceLeague(a.L, "manual"); if (r.error) return json(res, 400, r);
      armSchedule(a.L);   // a manual advance restarts the scheduled countdown
      return json(res, 200, r);
    }
    // Fantasy draft: set your PRIVATE pick queue (auto-picks on your clock
    // timeout take it first). Replace-semantics; capped; never broadcast.
    if (req.method === "POST" && url.pathname === "/api/league/draft/queue") {
      const b = await readBody(req);
      const auth = memberAuth(b.leagueId, b.token); if (auth.error) return json(res, 403, auth);
      if (!auth.m.token) return json(res, 400, { error: "commissioner token has no seat — use your member token" });
      const pids = (Array.isArray(b.pids) ? b.pids : []).slice(0, 100).map(String);
      auth.L.queues[auth.m.token] = pids;
      persistAppend(auth.L, { t: "draft-queue", token: auth.m.token, pids });
      return json(res, 200, { ok: true, count: pids.length });
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
    // M2: full season state for (re)sync — the week-by-week results ledger +
    // standings + everything a verifier needs to re-derive the season
    // (genesis seeds; the schedule is RNG-free and derived client-side).
    if (req.method === "GET" && url.pathname.startsWith("/api/league/season/")) {
      const id = url.pathname.split("/").pop();
      const token = url.searchParams.get("token");
      const auth = memberAuth(id, token); if (auth.error) return json(res, 403, auth);
      const L = auth.L;
      return json(res, 200, {
        leagueSeed: L.leagueSeed, year: L.year, rosterMode: L.settings.rosterMode,
        rostersHash: L.rostersHash,
        draft: L.draft && L.draft.done ? { poolSeed: L.draft.poolSeed, year: L.draft.year, artifactHash: L.draft.artifactHash, resultHash: L.draft.resultHash } : null,
        phase: L.phase, season: L.season, week: L.week,
        weeks: SEASON_WEEKS,
        results: L.results, standings: L.standings,
        playoffs: L.playoffs, champions: L.champions || [],
        roundNames: PLAYOFF_ROUNDS,
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
      const auth = memberAuth(id, token);
      if (auth.error) {
        // Invite PREVIEW: a join link's token (the open joinCode or an unused
        // single-use invite) may VIEW the lobby snapshot so the joiner can
        // pick a free team — it cannot act as a member.
        const L = leagues.get(id);
        const isInvite = L && (token === L.joinCode || L.invites.some(iv => iv.token === token && !iv.used));
        if (!isInvite) return json(res, 403, auth);
        return json(res, 200, { league: publicLeague(L), you: { preview: true } });
      }
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
