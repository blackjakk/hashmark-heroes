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

  // ── member signature keypairs (ECDSA P-256; the per-pick / per-call
  // attestation layer). One helper set shared by the draft + M4 scenes. ──
  const mkKp = () => {
    const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pub = kp.publicKey.export({ format: "jwk" });
    return { kp, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
  };
  const signWith = (k, msg) => crypto.sign("sha256", msg, { key: k.kp.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  const pickMsg = (leagueId, i, teamId, pid) => Buffer.from(`hh-pick|${leagueId}|${i}|${teamId}|${pid}`);
  const callMsg = (matchId, seq, by, call) => {
    const n = (call === "auto" || call == null) ? null : call;
    return Buffer.from(`hh-call|${matchId}|${seq}|${by}|${JSON.stringify(n)}`);
  };

  // ── FANTASY DRAFT (FANTASY_DRAFT_DESIGN.md S2) ─────────────────────────────
  console.log("\n[fantasy draft — commissioner start → drafting phase]");
  const fdKeys = { 5: mkKp(), 9: mkKp() };   // both members key-registered
  const fdc = await req("POST", "/api/league", {
    name: "Draft Dynasty", adminTeamId: 5, adminName: "Commish", pubKey: fdKeys[5].pub,
    settings: { teamCount: 4, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 0 },
  });
  check(fdc.status === 200, "fantasy-draft league created");
  const fdId = fdc.body.leagueId, fdAdmin = fdc.body.adminToken, fdCommishTok = fdc.body.memberToken;
  const fdJoin = await req("POST", "/api/league/join", { leagueId: fdId, token: fdc.body.joinCode, teamId: 9, displayName: "GM Bo", pubKey: fdKeys[9].pub });
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
  // per-pick SIGNATURES: a key-registered member's pick must be signed
  const noSig = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: legalPick.pid });
  check(noSig.status === 400 && /pick signature/.test(noSig.body.error || ""), "unsigned pick from a key-registered member rejected");
  const forgedPick = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: legalPick.pid, sig: "AAAA" + "B".repeat(80) });
  check(forgedPick.status === 400 && /pick signature/.test(forgedPick.body.error || ""), "forged pick signature rejected");
  const pickSig = signWith(fdKeys[onClock], pickMsg(fdId, st.pickIdx, onClock, legalPick.pid));
  const good = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: legalPick.pid, sig: pickSig });
  check(good.status === 200 && good.body.pid === legalPick.pid, `on-clock human pick accepted, SIGNED (${legalPick.position} ${legalPick.name})`);

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
  // per-pick attestation lane: member-signed human picks + league-server-
  // signed auto-picks = FULL coverage (both members registered keys), and
  // every signature independently re-verifies against the served keys.
  check(Array.isArray(final.sigTape) && final.sigTape.length === final.tape.length
    && final.sigTape.every(x => x && x.sig), "sigTape covers every pick (member + server signed)");
  check(!!final.keys && !!final.keys.server && !!final.keys.members["5"] && !!final.keys.members["9"],
    "draft endpoint serves the league server key + member keys");
  const _pickVerify = (i) => {
    const rec = final.sigTape[i], e = final.tape[i];
    const pub = rec.by === "server" ? final.keys.server : final.keys.members[String(rec.by)];
    if (!pub) return false;
    try {
      const key = crypto.createPublicKey({ key: pub, format: "jwk" });
      return crypto.verify("sha256", pickMsg(fdId, i, e.teamId, e.pid), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(rec.sig, "base64"));
    } catch (_) { return false; }
  };
  check(final.sigTape.every((_, i) => _pickVerify(i)), "every pick signature re-verifies (referee recipe)");
  check(final.sigTape.some(x => x.by === "server") && final.sigTape.some(x => x.by !== "server"),
    "attestation mixes member-signed human picks + server-signed auto-picks");
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

  console.log("\n[M2 — genesis fields freeze once the league starts]");
  // rosterMode is the season's roster-genesis pointer — a post-START flip
  // would swap the genesis every member verified (or brick the season).
  const flip = await req("POST", "/api/league/settings", { leagueId: m2Id, adminToken: m2Admin, rosterMode: "fantasy_draft" });
  check(flip.status === 200 && flip.body.settings.rosterMode === "default",
    "post-START rosterMode flip is IGNORED (genesis pointer frozen)");
  const m2Adv3 = await req("POST", "/api/league/advance", { leagueId: m2Id, adminToken: m2Admin });
  check(m2Adv3.status === 200 && m2Adv3.body.simmed === 16, "season still sims from the original genesis after the attempted flip");

  console.log("\n[M3 — playoffs: bracket rounds, champion, rollover]");
  const shortL = await req("POST", "/api/league", { name: "Short Season", adminTeamId: 20, adminName: "X", settings: { teamCount: 2, seasonWeeks: 1 } });
  const m3Id = shortL.body.leagueId, m3Admin = shortL.body.adminToken;
  await req("POST", "/api/league/start", { leagueId: m3Id, adminToken: m3Admin });
  const m3adv = () => req("POST", "/api/league/advance", { leagueId: m3Id, adminToken: m3Admin });
  const finAdv = await m3adv();
  check(finAdv.status === 200 && finAdv.body.phase === "season_complete", "final regular week → phase season_complete");
  const roundSizes = [];
  let last = null;
  for (let i = 0; i < 4; i++) { last = await m3adv(); roundSizes.push(last.body.simmed); }
  check(roundSizes.join("/") === "6/4/2/1", `four advances sim the bracket rounds (${roundSizes.join("/")})`);
  check(last.body.phase === "season_over" && last.body.champion != null, `Super Bowl crowns a champion (team ${last.body.champion})`);
  const m3Season = (await req("GET", `/api/league/season/${m3Id}?token=${m3Admin}`)).body;
  // ANTI-CHEAT: bracket seeding is a pure fold of the PUBLISHED standings —
  // re-derive it independently under the documented total order.
  const seedRank = (tid) => { const s = m3Season.standings[tid]; const gp = s.w + s.l + s.t; return { pct: gp ? (s.w + s.t / 2) / gp : 0, diff: s.pf - s.pa, pf: s.pf }; };
  const seedCmp = (a, b) => { const ra = seedRank(a), rb = seedRank(b); return rb.pct - ra.pct || rb.diff - ra.diff || rb.pf - ra.pf || a - b; };
  const mySeeds = {};
  for (const conf of ["AFC", "NFC"]) mySeeds[conf] = kit.TEAMS.filter(t => t.conference === conf).map(t => t.id).sort(seedCmp).slice(0, 7);
  check(JSON.stringify(mySeeds) === JSON.stringify(m3Season.playoffs.seeds), "bracket seeds re-derived from published standings → MATCH");
  // ANTI-CHEAT: a playoff result re-sims to the published hash ({isPlayoff:true}).
  const sbGame = m3Season.playoffs.rounds[3][0];
  const m3Built = kit._fdBuildDefaultLeague(m3Season.leagueSeed, m3Season.year);
  const sbSeed = crypto.createHash("sha256")
    .update(`hh-league-game|${m3Season.leagueSeed}|1|${sbGame.week}|${sbGame.homeId}|${sbGame.awayId}`).digest().readUInt32LE(0);
  const sbClone = (x) => JSON.parse(JSON.stringify(x));
  if (kit._setPortableMath) kit._setPortableMath(true);
  kit._setSimRng(sbSeed >>> 0);
  let sbSim;
  try {
    sbSim = new kit.GameSimulator(kit.TEAMS.find(t => t.id === sbGame.homeId), kit.TEAMS.find(t => t.id === sbGame.awayId),
      sbClone(m3Built.rosters[sbGame.homeId]), sbClone(m3Built.rosters[sbGame.awayId]), { isPlayoff: true }).simulate();
  } finally { kit._clearSimRng(); if (kit._setPortableMath) kit._setPortableMath(false); }
  check(resultHash(sbSim) === sbGame.resultHash, "Super Bowl re-sim resultHash MATCHES — playoff results are proven too");
  check((m3Season.champions || []).some(c => c.season === 1 && c.teamId === last.body.champion), "champion recorded on the trophy shelf");
  // Rollover: same genesis, fresh slate, season-namespaced seeds.
  const roll = await m3adv();
  check(roll.status === 200 && roll.body.rolledOver && roll.body.season === 2 && roll.body.phase === "active", "advance from season_over rolls to season 2");
  const s2 = (await req("GET", `/api/league/season/${m3Id}?token=${m3Admin}`)).body;
  check(s2.rostersHash === m3Season.rostersHash && Object.keys(s2.results).length === 0 && s2.playoffs === null
    && Object.values(s2.standings).every(x => x.w === 0 && x.l === 0), "rollover keeps the roster genesis, resets results/standings/bracket");
  const s2adv = await m3adv();
  check(s2adv.status === 200 && s2adv.body.simmed === 16, "season 2 sims (per-game seeds re-namespaced by season)");
  // Restart mid-dynasty: champions + phase + season-2 results survive.
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) bad("server didn't respawn post-rollover");
  const m3After = (await req("GET", `/api/league/season/${m3Id}?token=${m3Admin}`)).body;
  check(m3After.season === 2 && (m3After.champions || []).length === 1 && (m3After.results[1] || []).length === 16,
    "restart mid-dynasty: trophy shelf + season-2 ledger survive");

  console.log("\n[M2 — fantasy league: the drafted genesis feeds the season]");
  const fdAdv = await req("POST", "/api/league/advance", { leagueId: fdId, adminToken: fdAdmin });
  check(fdAdv.status === 200 && fdAdv.body.simmed === 16, "drafted league advance sims the week");
  const fdSeason = (await req("GET", `/api/league/season/${fdId}?token=${fdBoTok}`)).body;
  const fdWk1 = fdSeason.results[1] || fdSeason.results["1"] || [];
  check(fdWk1.length === 16 && fdSeason.leagueSeed > 0, "fantasy season ledger + leagueSeed published");
  // Seed-shopping closure: the SEASON seed root must have been committed to
  // the public event log BEFORE any pick existed — draft_started carries it,
  // and it must be the same seed the season later sims under.
  const draftEvents = await evDraft;
  const ds0 = draftEvents.find(e => e.type === "draft_started");
  check(!!ds0 && ds0.data.leagueSeed > 0 && ds0.data.leagueSeed === fdSeason.leagueSeed,
    "leagueSeed was published in draft_started (pre-roster-knowledge) and matches the season's");
  // Re-derive the DRAFTED rosters from (poolSeed + tape) — the genesis every
  // member already verified — and re-sim a game against the published hash.
  const fdRosters = kit._fdApplyTape(built, final.tape).rosters;
  const fdG = fdWk1[0];
  const fdSim = probeSim(fdSeason.leagueSeed, 1, 1, fdG.homeId, fdG.awayId, fdRosters);
  check(resultHash(fdSim) === fdG.resultHash, "fantasy game re-sim from (poolSeed + tape) rosters MATCHES the server's resultHash");

  // ═══ M4 — humanGamesH2H: member fixtures play LIVE; results ingest only as
  // two-party-attested, fully re-verified artifacts ═══
  console.log("\n[M4 — humanGamesH2H: fixtures held open for live play]");
  const H2H_PORT = 8797;
  process.env.H2H_DATA = path.join(require("os").tmpdir(), "hh-league-probe-h2h-" + Date.now());
  await require("./h2h-server.js").start(H2H_PORT);
  const m4Clone = (x) => JSON.parse(JSON.stringify(x));
  const h2hReq = (method, p, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: H2H_PORT, path: p, method, headers: { "Content-Type": "application/json" } }, res => {
      let buf = ""; res.on("data", c => buf += c); res.on("end", () => { try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} }); } catch (e) { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
  // long-lived SSE with a live handle (the fixed-window sse() can't span a match)
  const sseOpen = (port, p) => {
    const events = [];
    const r = http.get({ host: "127.0.0.1", port, path: p }, res => {
      let buf = "";
      res.on("data", c => {
        buf += c; let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          const tl = blk.split("\n").find(l => l.startsWith("event: "));
          const dl = blk.split("\n").find(l => l.startsWith("data: "));
          if (tl) events.push({ type: tl.slice(7), data: dl ? JSON.parse(dl.slice(6)) : null });
        }
      });
      res.on("error", () => {});
    });
    r.on("error", () => {});
    return { events, close: () => r.destroy() };
  };
  const m4Seed = (leagueSeed, season, week, homeId, awayId) => crypto.createHash("sha256")
    .update(`hh-league-game|${leagueSeed}|${season}|${week}|${homeId}|${awayId}`).digest().readUInt32LE(0);
  // Fabricate a locally-VERIFIED artifact — the attack the two-party close
  // exists for: seed + rosters are public, so one member CAN synthesize a
  // whole match solo. tapePolicy(ctx) return values are recorded verbatim.
  const m4Fab = (leagueSeed, season, week, homeId, awayId, rosters, tapePolicy) => {
    const seed = m4Seed(leagueSeed, season, week, homeId, awayId);
    const tape = [];
    if (kit._setPortableMath) kit._setPortableMath(true);
    kit._setSimRng(seed >>> 0);
    let r;
    try {
      const sim = new kit.GameSimulator(kit.TEAMS.find(t => t.id === homeId), kit.TEAMS.find(t => t.id === awayId),
        m4Clone(rosters[homeId]), m4Clone(rosters[awayId]));
      const coord = (ctx) => { const call = tapePolicy ? tapePolicy(ctx) : null; tape.push(call); return call; };
      sim._coordinators = { home: coord, away: coord };
      r = sim.simulate();
    } finally { kit._clearSimRng(); if (kit._setPortableMath) kit._setPortableMath(false); }
    return { seed, homeTeamId: homeId, awayTeamId: awayId, math: "portable",
      rosters: { home: rosters[homeId], away: rosters[awayId] }, tape, resultHash: resultHash(r),
      result: { homeScore: r.homeScore, awayScore: r.awayScore } };
  };
  // Three member teams whose pairwise meetings give two early fixtures in
  // DIFFERENT weeks (the schedule is a single round-robin — a pair meets once).
  const m4Sched = kit.generateFranchiseSchedule();
  const m4Meet = new Map();
  for (const g of m4Sched) m4Meet.set(Math.min(g.homeId, g.awayId) + ":" + Math.max(g.homeId, g.awayId), g);
  const m4Mtg = (a, b) => m4Meet.get(Math.min(a, b) + ":" + Math.max(a, b));
  let m4Best = null;
  for (let a = 1; a <= 32; a++) for (let b = a + 1; b <= 32; b++) for (let c = b + 1; c <= 32; c++) {
    const ms = [m4Mtg(a, b), m4Mtg(a, c), m4Mtg(b, c)].filter(Boolean).sort((x, y) => x.week - y.week);
    // Need ALL THREE pairwise meetings (the schedule is NOT a full round-robin
    // — 272 of 496 pairs meet) at strictly increasing weeks: fixture 1 = the
    // dispute/force-sim scene, fixture 2 = propose/confirm, fixture 3 = the
    // signature solo-accept scene; the weeks between must sim clean.
    if (ms.length < 3 || ms[0].week === ms[1].week || ms[1].week === ms[2].week) continue;
    const key3 = ms[1].week * 10000 + ms[2].week * 100 + ms[0].week;
    if (!m4Best || key3 < m4Best.key3) m4Best = { teams: [a, b, c], ms, key3 };
  }
  const [m4G1, m4G2] = m4Best.ms;
  const m4Kp = Object.fromEntries(m4Best.teams.map(t => [t, mkKp()]));   // league-registered member keys
  const m4c = await req("POST", "/api/league", { name: "M4 Live League", adminTeamId: m4Best.teams[0], adminName: "GM One",
    pubKey: m4Kp[m4Best.teams[0]].pub,
    settings: { advanceMode: "manual", humanGamesH2H: true } });
  const m4Id = m4c.body.leagueId, m4Admin = m4c.body.adminToken;
  const m4Tok = { [m4Best.teams[0]]: m4c.body.memberToken };
  for (let i = 1; i < 3; i++) {
    const j = await req("POST", "/api/league/join", { leagueId: m4Id, token: m4c.body.joinCode, teamId: m4Best.teams[i], displayName: "GM " + (i + 1), pubKey: m4Kp[m4Best.teams[i]].pub });
    m4Tok[m4Best.teams[i]] = j.body.memberToken;
  }
  const m4Pub = (await req("GET", `/api/league/${m4Id}?token=${m4Admin}`)).body.league;
  check(m4Pub.members.every(m => m.pubKey && m.pubKey.crv === "P-256"), "member pubkeys registered + published in the snapshot");
  await req("POST", "/api/league/start", { leagueId: m4Id, adminToken: m4Admin });
  const m4S0 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  const m4Rosters = kit._fdBuildDefaultLeague(m4S0.leagueSeed, m4S0.year).rosters;
  for (let w = 1; w < m4G1.week; w++) await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  const m4LgSse = sseOpen(PORT, `/api/league/events/${m4Id}?token=${encodeURIComponent(m4Tok[m4G2.awayId])}`);
  const m4Adv1 = await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  check(m4Adv1.status === 200 && (m4Adv1.body.pendingH2H || []).length === 1
    && m4Adv1.body.pendingH2H[0].homeId === m4G1.homeId && m4Adv1.body.simmed === 15,
    `advance holds the member-vs-member fixture open (week ${m4G1.week}, 15 AI games simmed)`);
  const m4S1 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  check(m4S1.pendingWeek && m4S1.pendingWeek.week === m4G1.week && m4S1.week === m4G1.week,
    "season endpoint exposes the open week");

  console.log("\n[M4 — the league trusts NOTHING: rejection battery]");
  const m4TokH = m4Tok[m4G1.homeId], m4TokA = m4Tok[m4G1.awayId];
  const m4ArtNull = m4Fab(m4S0.leagueSeed, m4S0.season, m4G1.week, m4G1.homeId, m4G1.awayId, m4Rosters, null);
  let m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH,
    artifact: { ...m4ArtNull, homeTeamId: m4ArtNull.awayTeamId, awayTeamId: m4ArtNull.homeTeamId } });
  check(m4r.status === 400 && /pending fixture/.test(m4r.body.error || ""), "reversed matchup rejected");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH, artifact: { ...m4ArtNull, seed: (m4ArtNull.seed + 1) >>> 0 } });
  check(m4r.status === 400 && /seed/.test(m4r.body.error || ""), "wrong seed rejected (league re-derives it)");
  const m4Tamp = m4Clone(m4ArtNull);
  m4Tamp.rosters.home[0].overall = 99; m4Tamp.rosters.home[0].speed = 99;
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH, artifact: m4Tamp });
  check(m4r.status === 400 && /roster/.test(m4r.body.error || ""), "inflated roster rejected (canonical-roster equality)");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH, artifact: { ...m4ArtNull, resultHash: "0".repeat(64) } });
  check(m4r.status === 400 && /re-sim/.test(m4r.body.error || ""), "tampered resultHash rejected by the full tape re-sim");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4Admin, artifact: m4ArtNull });
  check(m4r.status === 400 && /seat/.test(m4r.body.error || ""), "commissioner token (no team seat) rejected");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: "deadbeef", artifact: m4ArtNull });
  check(m4r.status === 403, "garbage token rejected");

  console.log("\n[M4 — two-party attestation: solo fabrication cannot land a result]");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH, artifact: m4ArtNull });
  check(m4r.status === 200 && m4r.body.proposed && m4r.body.awaitingConfirm,
    "first verified artifact = PROPOSED only (a solo fabrication stalls here)");
  const m4ArtPass = m4Fab(m4S0.leagueSeed, m4S0.season, m4G1.week, m4G1.homeId, m4G1.awayId, m4Rosters,
    (ctx) => (ctx.kind === "playcall" ? "pass" : null));
  check(m4ArtPass.resultHash !== m4ArtNull.resultHash, "a different tape fabricates a different (still verifying) result");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokA, artifact: m4ArtPass });
  check(m4r.status === 400 && /conflict/.test(m4r.body.error || ""), "opponent's CONFLICTING verified artifact → disputed, not ingested");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokA, artifact: m4ArtNull });
  check(m4r.status === 400 && /disputed/.test(m4r.body.error || ""), "disputed fixture refuses further submissions");
  const m4Adv1b = await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  check(m4Adv1b.status === 200 && m4Adv1b.body.week === m4G1.week + 1, "commissioner's deadline advance force-sims + closes the week");
  const m4S2 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  const m4Forced = (m4S2.results[m4G1.week] || []).find(x => x.homeId === m4G1.homeId && x.awayId === m4G1.awayId);
  check(!!m4Forced && m4Forced.forced === true && (m4S2.results[m4G1.week] || []).length === 16,
    "forced entry recorded; week holds all 16 results");
  check(!!m4Forced && m4Forced.resultHash === m4ArtNull.resultHash,
    "force-sim ≡ null-tape replay (coordinator defer is byte-identical — cross-bundle regression detector)");
  check(!m4S2.pendingWeek, "pendingWeek cleared after the force close");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4TokH, artifact: m4ArtNull });
  check(m4r.status === 400, "submission after week close rejected");

  console.log("\n[M4 — the real flow: live match on the h2h server, verified ingest]");
  for (let w = m4G1.week + 1; w < m4G2.week; w++) await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  const m4Adv2 = await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  check(m4Adv2.status === 200 && (m4Adv2.body.pendingH2H || []).length === 1, `second fixture held open (week ${m4G2.week})`);
  const m4T2H = m4Tok[m4G2.homeId], m4T2A = m4Tok[m4G2.awayId];
  const m4Outsider = m4Best.teams.find(t => t !== m4G2.homeId && t !== m4G2.awayId);
  const m4FxSeed = m4Seed(m4S0.leagueSeed, m4S0.season, m4G2.week, m4G2.homeId, m4G2.awayId);
  const m4cm = await h2hReq("POST", "/api/match", { homeTeamId: m4G2.homeId, awayTeamId: m4G2.awayId,
    clockMs: 60000, homeRoster: m4Rosters[m4G2.homeId], seed: m4FxSeed });
  check(m4cm.status === 200 && !!m4cm.body.matchId, "h2h match created, seed-bound to the league fixture");
  const m4jm = await h2hReq("POST", "/api/join", { matchId: m4cm.body.matchId, joinCode: m4cm.body.joinCode,
    awayTeamId: m4G2.awayId, awayRoster: m4Rosters[m4G2.awayId] });
  check(m4jm.status === 200 && !!m4jm.body.token, "opponent joined with the canonical roster");
  const m4Link = `#h2h=${m4cm.body.matchId}.${m4cm.body.joinCode}`;
  m4r = await req("POST", "/api/league/h2h-challenge", { leagueId: m4Id, token: m4T2H, link: "javascript:alert(1)" });
  check(m4r.status === 400, "challenge with a non-http/#h2h link rejected");
  m4r = await req("POST", "/api/league/h2h-challenge", { leagueId: m4Id, token: m4Tok[m4Outsider], link: m4Link });
  check(m4r.status === 400, "member with no pending fixture cannot challenge");
  m4r = await req("POST", "/api/league/h2h-challenge", { leagueId: m4Id, token: m4T2H, link: m4Link });
  check(m4r.status === 200, "challenge relayed");
  await sleep(400);
  check(m4LgSse.events.some(e => e.type === "h2h_challenge" && e.data.link === m4Link),
    "opponent received h2h_challenge over league SSE");
  // drive the match to FINAL — two scripted clients answering instantly
  const m4Mid = m4cm.body.matchId, m4Tks = { home: m4cm.body.token, away: m4jm.body.token };
  let m4Final = null;
  const m4DoneP = {}; const m4Done = new Promise(res => { m4DoneP.res = res; });
  const m4Policy = (side, kind, ctx) => {
    if (kind === "defense") return side === "home" ? "C0_BLITZ" : "C3_ZONE";
    if (kind === "fourthDown") return side === "home" ? (ctx.inFGRange ? "fg" : "punt") : null;
    if (kind === "pat") return "kick";
    return side === "home" ? (ctx.down <= 1 ? "run" : "pass") : "auto";
  };
  const m4Client = (side) => {
    const es = sseOpen(H2H_PORT, `/api/events/${m4Mid}?token=${m4Tks[side]}`);
    let seen = 0;
    const pump = setInterval(async () => {
      while (seen < es.events.length) {
        const ev = es.events[seen++];
        if (ev.type === "final" && !m4Final) { m4Final = ev.data; m4DoneP.res(); }
        if (ev.type !== "decision") continue;
        await h2hReq("POST", "/api/call", { matchId: m4Mid, token: m4Tks[side], seq: ev.data.seq, call: m4Policy(side, ev.data.kind, ev.data.ctx) });
      }
    }, 30);
    return () => { clearInterval(pump); es.close(); };
  };
  const m4CloseH = m4Client("home"), m4CloseA = m4Client("away");
  await Promise.race([m4Done, sleep(240000)]);
  await sleep(500);
  m4CloseH(); m4CloseA();
  check(!!m4Final, "live h2h match reached FINAL");
  const m4Art = (await h2hReq("GET", `/api/artifact/${m4Mid}?token=${m4Tks.home}`)).body;
  check(m4Art.seed === m4FxSeed && Array.isArray(m4Art.tape), "artifact carries the bound league seed");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4Tok[m4Outsider], artifact: m4Art });
  check(m4r.status === 400 && /not part/.test(m4r.body.error || ""), "uninvolved member cannot attest the fixture");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4T2H, artifact: m4Art });
  check(m4r.status === 200 && m4r.body.proposed, "live artifact re-verified + proposed");
  await sleep(400);
  check(m4LgSse.events.some(e => e.type === "h2h_proposed" && e.data.resultHash === m4Art.resultHash),
    "h2h_proposed broadcast to the league");

  console.log("\n[M4 — restart with an open week + pending proposal]");
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) bad("server didn't respawn mid-open-week");
  const m4S3 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  const m4Key = m4G2.homeId + "v" + m4G2.awayId;
  check(m4S3.pendingWeek && m4S3.pendingWeek.week === m4G2.week && m4S3.pendingWeek.pending.length === 1
    && m4S3.pendingWeek.proposed?.[m4Key]?.resultHash === m4Art.resultHash,
    "open week + pending PROPOSAL survive the restart");
  m4r = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4T2A, artifact: m4Art });
  check(m4r.status === 200 && m4r.body.confirmed && m4r.body.weekClosed,
    "opponent's matching artifact CONFIRMS → verified ingest, week closes");
  const m4S4 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  const m4Ent = (m4S4.results[m4G2.week] || []).find(x => x.homeId === m4G2.homeId && x.awayId === m4G2.awayId);
  check(!!m4Ent && m4Ent.h2h === true && m4Ent.resultHash === m4Art.resultHash
    && m4Ent.homeScore === m4Final.result.homeScore && m4Ent.awayScore === m4Final.result.awayScore
    && Array.isArray(m4Ent.by) && m4Ent.by.length === 2,
    "human result in the ledger: verified hash, real score, both attesters");
  const m4Games = Object.values(m4S4.standings).reduce((n, t) => n + t.w + t.l + t.t, 0) / 2;
  check(m4S4.week === m4G2.week + 1 && !m4S4.pendingWeek && m4Games === 16 * m4G2.week,
    `standings fold exactly once per game (${m4Games} = 16×${m4G2.week}); season moved on`);
  console.log("\n[M4 — signature solo-accept: a fully-attested artifact needs no confirmation]");
  const m4G3 = m4Best.ms[2];
  for (let w = m4G2.week + 1; w < m4G3.week; w++) await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  const m4Adv3 = await req("POST", "/api/league/advance", { leagueId: m4Id, adminToken: m4Admin });
  check(m4Adv3.status === 200 && (m4Adv3.body.pendingH2H || []).length === 1, `third fixture held open (week ${m4G3.week})`);
  const m4T3H = m4Tok[m4G3.homeId];
  // Named surface: MATCH-LOCAL keys are self-registrable — a fabricator signs
  // a solo match with keys it made up. Fully self-consistent signatures, but
  // the keys don't equal the LEAGUE-REGISTERED member keys → NOT solo-accepted
  // (falls back to two-party attestation, where it stalls without the victim).
  const fabNull = m4Fab(m4S0.leagueSeed, m4S0.season, m4G3.week, m4G3.homeId, m4G3.awayId, m4Rosters, null);
  const fabHome = mkKp(), fabAway = mkKp();
  const fabArt = { ...fabNull, id: "fabricated",
    keys: { home: fabHome.pub, away: fabAway.pub, server: mkKp().pub },
    sigs: fabNull.tape.map((c, i) => ({ by: "home", sig: signWith(fabHome, callMsg("fabricated", i, "home", c)) })) };
  let m4r3 = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4T3H, artifact: fabArt });
  check(m4r3.status === 200 && m4r3.body.proposed === true && !m4r3.body.attested,
    "self-keyed fabrication verifies but is NOT solo-accepted (league keys don't match) — stalls at propose");
  // The real flow: seats registered with the members' LEAGUE keys, every call
  // signed → the artifact is self-proving; ONE submission enters the ledger.
  const m4Fx3Seed = m4Seed(m4S0.leagueSeed, m4S0.season, m4G3.week, m4G3.homeId, m4G3.awayId);
  const m4cm3 = await h2hReq("POST", "/api/match", { homeTeamId: m4G3.homeId, awayTeamId: m4G3.awayId,
    clockMs: 60000, homeRoster: m4Rosters[m4G3.homeId], seed: m4Fx3Seed, pubKey: m4Kp[m4G3.homeId].pub });
  const m4jm3 = await h2hReq("POST", "/api/join", { matchId: m4cm3.body.matchId, joinCode: m4cm3.body.joinCode,
    awayTeamId: m4G3.awayId, awayRoster: m4Rosters[m4G3.awayId], pubKey: m4Kp[m4G3.awayId].pub });
  const m4Mid3 = m4cm3.body.matchId, m4Tks3 = { home: m4cm3.body.token, away: m4jm3.body.token };
  const m4SideKp = { home: m4Kp[m4G3.homeId], away: m4Kp[m4G3.awayId] };
  let m4Final3 = null;
  const m4Done3P = {}; const m4Done3 = new Promise(res => { m4Done3P.res = res; });
  const m4Client3 = (side) => {
    const es = sseOpen(H2H_PORT, `/api/events/${m4Mid3}?token=${m4Tks3[side]}`);
    let seen = 0;
    const pump = setInterval(async () => {
      while (seen < es.events.length) {
        const ev = es.events[seen++];
        if (ev.type === "final" && !m4Final3) { m4Final3 = ev.data; m4Done3P.res(); }
        if (ev.type !== "decision") continue;
        const call = m4Policy(side, ev.data.kind, ev.data.ctx);
        const sig = signWith(m4SideKp[side], callMsg(m4Mid3, ev.data.seq, side, call));
        await h2hReq("POST", "/api/call", { matchId: m4Mid3, token: m4Tks3[side], seq: ev.data.seq, call, sig });
      }
    }, 30);
    return () => { clearInterval(pump); es.close(); };
  };
  const m4c3H = m4Client3("home"), m4c3A = m4Client3("away");
  await Promise.race([m4Done3, sleep(240000)]);
  await sleep(500);
  m4c3H(); m4c3A();
  check(!!m4Final3, "signed live match reached FINAL");
  const m4Art3 = (await h2hReq("GET", `/api/artifact/${m4Mid3}?token=${m4Tks3.home}`)).body;
  check(Array.isArray(m4Art3.sigs) && m4Art3.sigs.every(x => x && x.sig), "artifact FULLY attested (every entry signed)");
  m4r3 = await req("POST", "/api/league/h2h-result", { leagueId: m4Id, token: m4T3H, artifact: m4Art3 });
  check(m4r3.status === 200 && m4r3.body.attested === true && m4r3.body.confirmed === true && m4r3.body.weekClosed === true,
    "SOLO-ACCEPT: one submission of the fully-attested artifact closes the week (no confirmation round)");
  const m4S5 = (await req("GET", `/api/league/season/${m4Id}?token=${m4Admin}`)).body;
  const m4Ent3 = (m4S5.results[m4G3.week] || []).find(x => x.homeId === m4G3.homeId && x.awayId === m4G3.awayId);
  check(!!m4Ent3 && m4Ent3.attested === true && m4Ent3.h2h === true
    && m4Ent3.homeScore === m4Final3.result.homeScore && Array.isArray(m4Ent3.by) && m4Ent3.by.length === 2,
    "ledger entry marked ATTESTED with the real score + both members");
  check(!m4S5.pendingWeek && m4S5.week === m4G3.week + 1, "fabricated proposal superseded; season moved on");

  m4LgSse.close();
  try { fs.rmSync(process.env.H2H_DATA, { recursive: true, force: true }); } catch (_) {}

  srv.kill("SIGKILL");
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n──────────────────────────────────────\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
