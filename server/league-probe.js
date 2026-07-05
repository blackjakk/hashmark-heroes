// league-probe.js — full dynasty lifecycle over the real wire: create → invite
// (email + link) → members claim teams → snapshot → start → manual advance →
// scheduled advance → auth guards → restart recovery. Zero-dep; spawns the
// server on a throwaway port + data dir. Runs headless in CI like the H2H probes.
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = 8799;
const DATA = path.join(require("os").tmpdir(), "hh-league-probe-" + Date.now());
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };
const check = (c, m) => c ? ok(m) : bad(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } }, res => {
      let buf = ""; res.on("data", c => buf += c); res.on("end", () => { try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} }); } catch (e) { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
// collect SSE events for `ms` — resolves with whatever was collected if the
// server dies mid-stream (the restart-recovery sections kill it on purpose).
function sse(p, ms) {
  return new Promise((resolve) => {
    const events = [];
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(events); } };
    const r = http.get({ host: "127.0.0.1", port: PORT, path: p }, res => {
      let buf = "";
      res.on("data", c => { buf += c; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const tl = blk.split("\n").find(l => l.startsWith("event: ")); const dl = blk.split("\n").find(l => l.startsWith("data: ")); if (tl) events.push({ type: tl.slice(7), data: dl ? JSON.parse(dl.slice(6)) : null }); } });
      res.on("error", finish);
      res.on("end", finish);
    });
    r.on("error", finish);
    setTimeout(() => { r.destroy(); finish(); }, ms);
  });
}

function spawnServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, "league-server.js"), String(PORT)],
    { env: { ...process.env, HH_LEAGUE_DATA: DATA, HH_LEAGUE_TEST: "1", HH_LEAGUE_PORT: String(PORT) }, stdio: "ignore" });
  return srv;
}
async function waitUp() { for (let i = 0; i < 40; i++) { try { const h = await req("GET", "/api/health"); if (h.status === 200) return true; } catch (_) {} await sleep(100); } return false; }

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  let srv = spawnServer();
  if (!await waitUp()) { console.log("server didn't start"); process.exit(1); }

  console.log("[create dynasty]");
  const create = await req("POST", "/api/league", { name: "Probe Dynasty", adminTeamId: 1, adminName: "Commish", settings: { teamCount: 6, advanceMode: "manual" } });
  check(create.status === 200 && create.body.leagueId, "create returns leagueId");
  check(!!create.body.adminToken && !!create.body.memberToken, "create issues admin + member tokens");
  check(/^#league=/.test(create.body.link || ""), `share link minted (${create.body.link})`);
  const { leagueId, adminToken } = create.body;

  console.log("\n[invite by email + link]");
  const inv = await req("POST", "/api/league/invite", { leagueId, adminToken, emails: ["a@x.com", "b@x.com"] });
  check(inv.status === 200 && (inv.body.invites || []).length === 2, "invite returns one link per email");
  check(inv.body.invites.every(i => /^#league=/.test(i.link)), "each invite has a join link");
  check(inv.body.mailer === "links-only", "no mailer configured → links-only (admin sends them)");
  const inviteToken = inv.body.invites[0].token;

  console.log("\n[members claim teams]");
  const j1 = await req("POST", "/api/league/join", { leagueId, token: inviteToken, teamId: 2, displayName: "GM Ada" });
  check(j1.status === 200 && j1.body.memberToken, "join via EMAIL invite token works");
  const j2 = await req("POST", "/api/league/join", { leagueId, token: create.body.joinCode, teamId: 3, displayName: "GM Lin" });
  check(j2.status === 200 && j2.body.memberToken, "join via open LINK (joinCode) works");
  const jDup = await req("POST", "/api/league/join", { leagueId, token: create.body.joinCode, teamId: 2 });
  check(jDup.status === 400, "taken team is rejected");
  const jReuse = await req("POST", "/api/league/join", { leagueId, token: inviteToken, teamId: 4 });
  check(jReuse.status === 400, "single-use email invite can't be reused");

  console.log("\n[snapshot]");
  const snap = await req("GET", `/api/league/${leagueId}?token=${adminToken}`);
  check(snap.body.league.members.length === 3, `roster shows 3 members (admin + 2 joiners) — got ${snap.body.league?.members?.length}`);
  check(snap.body.league.phase === "lobby", "phase is lobby pre-start");

  console.log("\n[commissioner start + manual advance, watched over SSE]");
  // M2: START pays the one-time draft-kit build (~2s) and advance SIMS the
  // week (~2.5s) — the window must outlive both, with CI headroom.
  const evP = sse(`/api/league/events/${leagueId}?token=${adminToken}`, 15000);
  await sleep(150);
  const start = await req("POST", "/api/league/start", { leagueId, adminToken });
  check(start.status === 200 && start.body.league.phase === "active", "admin starts the dynasty → active");
  const adv = await req("POST", "/api/league/advance", { leagueId, adminToken });
  check(adv.status === 200 && adv.body.week === 2, `manual advance → week 2 (got ${adv.body.week})`);
  const events = await evP;
  check(events.some(e => e.type === "started"), "SSE delivered 'started'");
  check(events.some(e => e.type === "advanced"), "SSE delivered 'advanced'");

  console.log("\n[auth guards]");
  const badStart = await req("POST", "/api/league/advance", { leagueId, adminToken: "WRONG" });
  check(badStart.status === 403, "non-commissioner cannot advance");

  console.log("\n[scheduled advance fires on its own]");
  await req("POST", "/api/league/settings", { leagueId, adminToken, advanceMode: "scheduled", advanceIntervalMs: 250 });
  const wk0 = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league.week;
  // M2: an advance now SIMS the whole week (~2-3s), so poll instead of a
  // fixed sleep.
  let wk1 = wk0;
  for (let i = 0; i < 60 && wk1 <= wk0; i++) { await sleep(250); wk1 = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league.week; }
  check(wk1 > wk0, `scheduled mode auto-advanced without input (${wk0} → ${wk1})`);
  // Back to manual — a 250ms scheduled loop that sims 16 games per tick would
  // otherwise churn the server for the rest of the probe.
  await req("POST", "/api/league/settings", { leagueId, adminToken, advanceMode: "manual" });

  console.log("\n[restart recovery — determinism is the recovery]");
  const before = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league;
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) { bad("server didn't respawn"); }
  const after = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league;
  check(after && after.members.length === before.members.length, "members survive a restart");
  check(after && after.phase === "active" && after.season === before.season, "phase/season survive a restart");

  // ── FANTASY DRAFT (FANTASY_DRAFT_DESIGN.md S2) ─────────────────────────────
  console.log("\n[fantasy draft — commissioner start → drafting phase]");
  const fdc = await req("POST", "/api/league", {
    name: "Draft Dynasty", adminTeamId: 5, adminName: "Commish",
    settings: { teamCount: 4, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 0 },
  });
  check(fdc.status === 200, "fantasy-draft league created");
  const fdId = fdc.body.leagueId, fdAdmin = fdc.body.adminToken, fdCommishTok = fdc.body.memberToken;
  const fdJoin = await req("POST", "/api/league/join", { leagueId: fdId, token: fdc.body.joinCode, teamId: 9, displayName: "GM Bo" });
  const fdBoTok = fdJoin.body.memberToken;
  const evDraft = sse(`/api/league/events/${fdId}?token=${fdAdmin}`, 2500);
  await sleep(150);
  const fdStart = await req("POST", "/api/league/start", { leagueId: fdId, adminToken: fdAdmin });
  check(fdStart.status === 200 && fdStart.body.league.phase === "drafting", "commissioner START enters the DRAFT, not active");
  const snap1 = await req("GET", `/api/league/${fdId}?token=${fdAdmin}`);
  check(snap1.body.league.phase === "drafting", "phase is drafting");
  check(snap1.body.league.draft && snap1.body.league.draft.poolSeed > 0, "draft summary carries the server-minted poolSeed");

  console.log("\n[draft state + validation guards]");
  const dst = await req("GET", `/api/league/draft/${fdId}?token=${fdCommishTok}`);
  check(dst.status === 200 && Array.isArray(dst.body.order) && dst.body.order.length === 32, "draft state: 32-team order");
  check(dst.body.tape.length > 0, `AI turns auto-picked up to the first human (${dst.body.tape.length} picks on the tape)`);
  check([5, 9].includes(dst.body.onClockTeamId), `a HUMAN team is on the clock (team ${dst.body.onClockTeamId})`);

  // Independent re-derivation — the client-side verification path: rebuild the
  // pool from (seed, year), replay the tape, and pick legally from the result.
  const kit = require("./draft-host.js").loadDraftKit();
  const built = kit._fdBuildPool(dst.body.poolSeed, dst.body.year);
  built.order = dst.body.order;
  let st = kit._fdApplyTape(built, dst.body.tape);
  check(st.pickIdx === dst.body.tape.length, "probe re-derived the draft state from (seed, tape)");
  const onClock = dst.body.onClockTeamId;
  const humanTok = onClock === 5 ? fdCommishTok : fdBoTok;
  const otherTok = onClock === 5 ? fdBoTok : fdCommishTok;
  const legalPick = st.pool.find(p => !st.taken.has(p.pid) && kit._fdLegal(st, onClock, p.position));
  const takenPid = dst.body.tape[0].pid;

  const wrongTurn = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: otherTok, pid: legalPick.pid });
  check(wrongTurn.status === 400 && /not your pick/.test(wrongTurn.body.error), "out-of-turn pick rejected");
  const dupPick = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: takenPid });
  check(dupPick.status === 400 && /already drafted/.test(dupPick.body.error), "already-drafted player rejected");
  const bogus = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: "nope" });
  check(bogus.status === 400, "bogus pid rejected");
  const badTok = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: "WRONG", pid: legalPick.pid });
  check(badTok.status === 403, "bad token rejected");
  const good = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: legalPick.pid });
  check(good.status === 200 && good.body.pid === legalPick.pid, `on-clock human pick accepted (${legalPick.position} ${legalPick.name})`);

  console.log("\n[mid-draft restart — the tape IS the recovery]");
  const preTape = (await req("GET", `/api/league/draft/${fdId}?token=${fdAdmin}`)).body.tape.length;
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) bad("server didn't respawn mid-draft");
  const postRestart = await req("GET", `/api/league/draft/${fdId}?token=${fdAdmin}`);
  check(postRestart.status === 200 && postRestart.body.tape.length >= preTape,
    `draft survives a restart (tape ${preTape} → ${postRestart.body.tape.length})`);
  check((await req("GET", `/api/league/${fdId}?token=${fdAdmin}`)).body.league.phase === "drafting", "phase still drafting after restart");

  console.log("\n[private queue honored by the clock]");
  // It's a human's turn right now (clock still 0). Queue a specific legal,
  // available player for the ON-CLOCK member — the timeout pick at exactly
  // this tape index must be that player.
  const dst2 = (await req("GET", `/api/league/draft/${fdId}?token=${fdAdmin}`)).body;
  const preClock = dst2.tape.length;
  const st2 = kit._fdApplyTape(built, dst2.tape);
  const onClock2 = dst2.onClockTeamId;
  const tok2 = onClock2 === 5 ? fdCommishTok : fdBoTok;
  const queued = st2.pool.filter(pp => !st2.taken.has(pp.pid) && kit._fdLegal(st2, onClock2, pp.position))[3]; // NOT the BPA head
  const qr = await req("POST", "/api/league/draft/queue", { leagueId: fdId, token: tok2, pids: [queued.pid] });
  check(qr.status === 200 && qr.body.count === 1, `on-clock GM queued ${queued.position} ${queued.name} (deliberately not BPA)`);

  console.log("\n[pick clock finishes the draft unattended]");
  const clk = await req("POST", "/api/league/settings", { leagueId: fdId, adminToken: fdAdmin, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 60 });
  check(clk.status === 200 && clk.body.settings.pickClockMs === 60, "commissioner arms a (test-floor) pick clock mid-draft");
  let fin = null;
  for (let i = 0; i < 120; i++) { // 24 human turns × 60ms + 1,600 auto picks
    await sleep(250);
    const s = await req("GET", `/api/league/${fdId}?token=${fdAdmin}`);
    if (s.body.league && s.body.league.phase === "active") { fin = s.body.league; break; }
  }
  check(!!fin, "draft ran to completion on the clock (phase → active)");
  check(fin && fin.draft.done && /^[0-9a-f]{64}$/.test(fin.draft.artifactHash || ""), `artifactHash minted (${(fin?.draft?.artifactHash || "").slice(0, 12)}…)`);

  console.log("\n[anti-cheat: independent verification of the artifact]");
  const final = (await req("GET", `/api/league/draft/${fdId}?token=${fdBoTok}`)).body;
  check(final.tape.length === 32 * kit.FD_PICKS_PER_TEAM, `full tape (${final.tape.length} = 32×${kit.FD_PICKS_PER_TEAM})`);
  st = kit._fdApplyTape(built, final.tape);
  const myResultHash = crypto.createHash("sha256")
    .update(JSON.stringify(final.order.map(t => [t, st.rosters[t].map(p => p.pid)])))
    .digest("hex");
  check(myResultHash === final.resultHash, "probe re-derived the rosters → resultHash MATCHES the server's");
  const floorsOk = final.order.every(t => {
    const c = {};
    for (const p of st.rosters[t]) c[p.position] = (c[p.position] || 0) + 1;
    return Object.entries(kit.FD_FLOORS).every(([q, m]) => (c[q] || 0) >= m);
  });
  check(floorsOk, "every drafted roster meets every position floor");
  const humanPicks = final.tape.filter(e => !e.auto).length;
  check(humanPicks >= 1, `human pick present on the tape (${humanPicks})`);
  const clockPick = final.tape[preClock];
  check(clockPick && clockPick.teamId === onClock2 && clockPick.pid === queued.pid,
    `clock timeout drafted the QUEUED player, not BPA (${queued.name})`);

  // ── M2 SHARED SEASON (server-simmed weeks → standings) ─────────────────────
  // Independent re-sim helper — the challenger's recipe, straight from the
  // league-server header: rosters re-derived NATIVELY from the genesis, the
  // game re-simmed under PORTABLE math with the documented seed formula.
  const { resultHash } = require("./result-hash.js");
  const probeSim = (leagueSeed, season, week, homeId, awayId, rosters) => {
    const seed = crypto.createHash("sha256")
      .update(`hh-league-game|${leagueSeed}|${season}|${week}|${homeId}|${awayId}`).digest().readUInt32LE(0);
    const clone = (x) => JSON.parse(JSON.stringify(x));
    if (kit._setPortableMath) kit._setPortableMath(true);
    kit._setSimRng(seed >>> 0);
    try {
      return new kit.GameSimulator(kit.TEAMS.find(t => t.id === homeId), kit.TEAMS.find(t => t.id === awayId),
        clone(rosters[homeId]), clone(rosters[awayId])).simulate();
    } finally { kit._clearSimRng(); if (kit._setPortableMath) kit._setPortableMath(false); }
  };
  const refold = (results) => {
    const st = Object.fromEntries(kit.TEAMS.map(t => [t.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 }]));
    for (const wk of Object.values(results)) for (const g of wk) {
      const h = st[g.homeId], a = st[g.awayId];
      h.pf += g.homeScore; h.pa += g.awayScore; a.pf += g.awayScore; a.pa += g.homeScore;
      if (g.homeScore > g.awayScore) { h.w++; a.l++; }
      else if (g.awayScore > g.homeScore) { a.w++; h.l++; }
      else { h.t++; a.t++; }
    }
    return st;
  };

  console.log("\n[M2 — default league: canonical genesis at START]");
  const m2c = await req("POST", "/api/league", { name: "Season Dynasty", adminTeamId: 7, adminName: "Commish", settings: { teamCount: 4 } });
  const m2Id = m2c.body.leagueId, m2Admin = m2c.body.adminToken;
  await req("POST", "/api/league/join", { leagueId: m2Id, token: m2c.body.joinCode, teamId: 12, displayName: "GM Sue" });
  const evSeason = sse(`/api/league/events/${m2Id}?token=${m2Admin}`, 12000);
  await sleep(150);
  const m2Start = await req("POST", "/api/league/start", { leagueId: m2Id, adminToken: m2Admin });
  check(m2Start.status === 200 && m2Start.body.league.phase === "active", "default league START → active");
  const m2Snap = m2Start.body.league;
  check(m2Snap.leagueSeed > 0, `leagueSeed minted at START (${m2Snap.leagueSeed})`);
  check(/^[0-9a-f]{64}$/.test(m2Snap.rostersHash || ""), `rostersHash published (${(m2Snap.rostersHash || "").slice(0, 12)}…)`);
  check(m2Snap.standings && Object.keys(m2Snap.standings).length === 32
    && Object.values(m2Snap.standings).every(s => s.w === 0 && s.l === 0), "standings start 32 × 0-0");
  const m2Built = kit._fdBuildDefaultLeague(m2Snap.leagueSeed, m2Snap.year);
  const m2MyHash = crypto.createHash("sha256").update(kit._fdRosterIds(m2Built.rosters)).digest("hex");
  check(m2MyHash === m2Snap.rostersHash, "probe re-derived all 32 rosters from the seed → rostersHash MATCHES");

  console.log("\n[M2 — advance sims the week server-side]");
  const m2Adv = await req("POST", "/api/league/advance", { leagueId: m2Id, adminToken: m2Admin });
  check(m2Adv.status === 200 && m2Adv.body.week === 2 && m2Adv.body.simmed === 16, `advance simmed the week (${m2Adv.body.simmed} games) → week 2`);
  const m2Season = (await req("GET", `/api/league/season/${m2Id}?token=${m2Admin}`)).body;
  const m2Wk1 = m2Season.results[1] || m2Season.results["1"] || [];
  check(m2Wk1.length === 16, `season ledger holds 16 week-1 results`);
  const fixtures = kit.generateFranchiseSchedule().filter(g => g.week === 1);
  check(m2Wk1.every((g, i) => g.homeId === fixtures[i].homeId && g.awayId === fixtures[i].awayId),
    "results follow the RNG-free schedule's week-1 fixtures exactly");
  check(m2Wk1.every(g => Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) && /^[0-9a-f]{64}$/.test(g.resultHash)),
    "every game carries scores + a 64-hex resultHash");
  check(JSON.stringify(refold(m2Season.results)) === JSON.stringify(m2Season.standings),
    "standings are exactly the fold of the published results");
  const m2PubSnap = (await req("GET", `/api/league/${m2Id}?token=${m2Admin}`)).body.league;
  check(m2PubSnap.lastResults && m2PubSnap.lastResults.week === 1 && m2PubSnap.lastResults.games.length === 16,
    "snapshot carries the last simmed week inline");

  console.log("\n[M2 — anti-cheat: independent re-sim of a published result]");
  const g0 = m2Wk1[0];
  const mySim = probeSim(m2Season.leagueSeed, 1, 1, g0.homeId, g0.awayId, m2Built.rosters);
  check(mySim.homeScore === g0.homeScore && mySim.awayScore === g0.awayScore,
    `probe re-simmed game 1 → same score (${mySim.homeScore}-${mySim.awayScore})`);
  check(resultHash(mySim) === g0.resultHash, "probe's re-sim resultHash MATCHES the server's — the result is PROVEN, not asserted");

  console.log("\n[M2 — restart mid-season: the ledger is the recovery]");
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) bad("server didn't respawn mid-season");
  const m2After = (await req("GET", `/api/league/season/${m2Id}?token=${m2Admin}`)).body;
  check(m2After.week === 2 && (m2After.results[1] || m2After.results["1"] || []).length === 16, "week + results survive a restart");
  check(JSON.stringify(m2After.standings) === JSON.stringify(m2Season.standings), "standings survive a restart (persisted snapshot, no kit rebuild)");
  const m2Adv2 = await req("POST", "/api/league/advance", { leagueId: m2Id, adminToken: m2Admin });
  check(m2Adv2.status === 200 && m2Adv2.body.week === 3, "post-restart advance sims week 2 (rosters re-derived from the seed)");
  const m2Wk2 = ((await req("GET", `/api/league/season/${m2Id}?token=${m2Admin}`)).body.results[2] || [])[0];
  const mySim2 = probeSim(m2Season.leagueSeed, 1, 2, m2Wk2.homeId, m2Wk2.awayId, m2Built.rosters);
  check(resultHash(mySim2) === m2Wk2.resultHash, "week-2 re-sim hash matches — post-restart roster derivation is canonical");
  const seasonEvents = await evSeason;
  check(seasonEvents.some(e => e.type === "started" && e.data.leagueSeed === m2Snap.leagueSeed), "SSE 'started' carried the leagueSeed");
  check(seasonEvents.some(e => e.type === "week_results" && (e.data.results || []).length === 16), "SSE 'week_results' streamed the simmed week");

  console.log("\n[M2 — season completion parks the league]");
  const shortL = await req("POST", "/api/league", { name: "Short Season", adminTeamId: 20, adminName: "X", settings: { teamCount: 2, seasonWeeks: 1 } });
  await req("POST", "/api/league/start", { leagueId: shortL.body.leagueId, adminToken: shortL.body.adminToken });
  const finAdv = await req("POST", "/api/league/advance", { leagueId: shortL.body.leagueId, adminToken: shortL.body.adminToken });
  check(finAdv.status === 200 && finAdv.body.phase === "season_complete", "final-week advance parks phase at season_complete");
  const finAdv2 = await req("POST", "/api/league/advance", { leagueId: shortL.body.leagueId, adminToken: shortL.body.adminToken });
  check(finAdv2.status === 400 && /season complete/.test(finAdv2.body.error || ""), "advancing a complete season is rejected (playoffs are the next milestone)");

  console.log("\n[M2 — fantasy league: the drafted genesis feeds the season]");
  const fdAdv = await req("POST", "/api/league/advance", { leagueId: fdId, adminToken: fdAdmin });
  check(fdAdv.status === 200 && fdAdv.body.simmed === 16, "drafted league advance sims the week");
  const fdSeason = (await req("GET", `/api/league/season/${fdId}?token=${fdBoTok}`)).body;
  const fdWk1 = fdSeason.results[1] || fdSeason.results["1"] || [];
  check(fdWk1.length === 16 && fdSeason.leagueSeed > 0, "fantasy season ledger + leagueSeed published");
  // Re-derive the DRAFTED rosters from (poolSeed + tape) — the genesis every
  // member already verified — and re-sim a game against the published hash.
  const fdRosters = kit._fdApplyTape(built, final.tape).rosters;
  const fdG = fdWk1[0];
  const fdSim = probeSim(fdSeason.leagueSeed, 1, 1, fdG.homeId, fdG.awayId, fdRosters);
  check(resultHash(fdSim) === fdG.resultHash, "fantasy game re-sim from (poolSeed + tape) rosters MATCHES the server's resultHash");

  srv.kill("SIGKILL");
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n──────────────────────────────────────\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
