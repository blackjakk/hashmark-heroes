/* =============================================================================
 * play-franchise-fantasydraft.js — S1 of FANTASY_DRAFT_DESIGN.md
 * -----------------------------------------------------------------------------
 * Single-player league-wide fantasy draft: every roster in the league is
 * drafted from scratch. The whole draft is a PURE FUNCTION
 *   (poolSeed + settings + tape) → 32 rosters
 * — pool generation runs under _setSimRng(poolSeed) (the play-player generator
 * is fully _rand()-routed), every pick (user, AI, auto-fill) is one tape entry,
 * and any state (resume after refresh, the final league) is re-derived by
 * replaying the tape. Same deterministic-replay architecture as interactive
 * playcalling. S2 (league server) and S3 (on-chain) reuse this module's
 * pool/legality/auto-pick functions verbatim — only WHO validates picks moves.
 *
 * DETERMINISM RULES (CLAUDE.md): all gen under _setSimRng; the auto-pick
 * scorer is a pure function of draft state — no RNG, no libm transcendentals.
 * Gate-safe: this is an opt-in creation flow; the audit/teleport batteries
 * never enter it, and rngSeedBase/_deriveGameSeed are untouched.
 * ========================================================================== */

"use strict";

// Hard per-position minimums every team must END with (engine-safe floors —
// same values _seedPracticeSquads protects). Sum = 35 of 51 picks; the other
// 16 are flex.
const FD_FLOORS = { QB: 2, K: 1, P: 1, TE: 2, RB: 2, WR: 4, OL: 7, DL: 5, LB: 4, CB: 4, S: 3 };
// Soft target shape (the default league mix). Sum = 51 = picks per team.
const FD_TARGET = (typeof ROSTER_SLOTS !== "undefined")
  ? ROSTER_SLOTS
  : { QB: 3, RB: 4, WR: 6, TE: 3, OL: 9, DL: 7, LB: 6, CB: 6, S: 5, K: 1, P: 1 };
const FD_POSITIONS = Object.keys(FD_TARGET);
const FD_PICKS_PER_TEAM = FD_POSITIONS.reduce((s, k) => s + FD_TARGET[k], 0); // 51
// Small static positional premiums for the auto-pick scorer (pure arithmetic).
const FD_POS_VALUE = { QB: 3, WR: 1, CB: 1, OL: 1, DL: 1, RB: 0.5, TE: 0.5, LB: 0.5, S: 0.5, K: 0, P: 0 };

// ── Pool generation (deterministic) ─────────────────────────────────────────
// Mirrors _buildDraftLeague's sequence minus assignContracts (players are
// drafted unsigned; contracts are assigned deterministically at finish).
// `year` is pinned in the draft state so a replay after New Year's Eve still
// reproduces byte-identically.
//
// SEEDING: the generator's helpers still contain ~11k raw Math.random draws
// (jersey/college numbers, weightedTierPick, flavor rolls, …) beyond the
// _rand()-routed paths, so seeding _setSimRng alone is NOT reproducible.
// Until those are all _rand()-routed, the build scopes a seeded Math.random
// override (the audit-gate technique) — every draw, _rand() fallback
// included, comes from ONE mulberry32 stream. Synchronous + restored in
// finally, so nothing outside the build ever sees the override.
function _fdSeededScope(seed, fn) {
  const orig = Math.random;
  Math.random = _mulberry32(seed >>> 0);
  try { return fn(); } finally { Math.random = orig; }
}
function _fdBuildPool(seed, year) {
  return _fdSeededScope(seed, () => {
    const rosters = {};
    const usedNames = new Set();
    const teamTiers = assignTeamTiers();
    for (const t of TEAMS) {
      const roster = genFranchiseRoster(t, usedNames, teamTiers[t.id]);
      roster.forEach(p => usedNames.add(p.name));
      rosters[t.id] = roster;
    }
    assignFranchiseAges(rosters);
    assignDraftInfo(rosters, year);
    if (typeof assignCareerTeams === "function") assignCareerTeams(rosters);
    // Flatten + strip team identity/contracts: this is now ONE pool.
    const pool = [];
    for (const t of TEAMS) for (const p of rosters[t.id]) {
      delete p.contract;
      if (!p.pid) p.pid = "fd" + pool.length; // gen assigns _rand()-pids; backstop
      pool.push(p);
    }
    // Total deterministic order: OVR desc, then name, then pid (cross-client
    // identical board regardless of gen iteration details).
    pool.sort((a, b) => (b.overall || 0) - (a.overall || 0)
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      || (a.pid < b.pid ? -1 : 1));
    // Draft order: seeded Fisher-Yates over team ids (still on the pool stream).
    const order = TEAMS.map(t => t.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(_rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { pool, order, teamTiers };
  });
}

// ── Canonical DEFAULT league (league M2 — shared-season genesis) ────────────
// A default-roster ONLINE league needs canonical rosters every member derives
// identically: the fantasy-draft pattern MINUS picks. Same gen sequence as
// _fdBuildPool (tiers → per-team gen → ages → draft info → career teams)
// under _fdSeededScope, with `year` pinned (a replay after New Year's Eve
// still reproduces byte-identically) — but rosters KEEP their team identity.
// Contracts are deliberately NOT assigned here: generateContract needs
// helpers outside the server bundle (play-franchise-offseason.js), they never
// enter the sim or the rostersHash, and the client signs them at "Start my
// franchise" under a derived seed — exactly _fdFinish's discipline. Shared by
// the browser client (verify + local franchise), the league server
// (server/draft-host.js hosts this file), and the probes.
function _fdBuildDefaultLeague(seed, year) {
  return _fdSeededScope(seed, () => {
    const rosters = {};
    const usedNames = new Set();
    const teamTiers = assignTeamTiers();
    for (const t of TEAMS) {
      const roster = genFranchiseRoster(t, usedNames, teamTiers[t.id]);
      roster.forEach(p => usedNames.add(p.name));
      rosters[t.id] = roster;
    }
    assignFranchiseAges(rosters);
    assignDraftInfo(rosters, year);
    if (typeof assignCareerTeams === "function") assignCareerTeams(rosters);
    let i = 0;
    for (const t of TEAMS) for (const p of rosters[t.id]) { if (!p.pid) p.pid = "lg" + (i++); }
    return { rosters, teamTiers };
  });
}
// Canonical serializer for a rosters hash — ONE string shape shared by the
// server (node:crypto) and clients (crypto.subtle), so the hashes compare.
// pids are drawn from the seeded stream during gen, so they fingerprint the
// entire generation (same shape as the draft resultHash's roster listing).
function _fdRosterIds(rosters) {
  return JSON.stringify(TEAMS.map(t => [t.id, (rosters[t.id] || []).map(p => p.pid)]));
}

// ── Derived draft state (replay the tape) ───────────────────────────────────
// PURE core shared by the browser, the league server (server/draft-host.js)
// and the probes: build an empty state from a pool build, apply tape entries.
function _fdNewState(built) {
  const st = {
    pool: built.pool, teamTiers: built.teamTiers, order: built.order,
    byPid: new Map(built.pool.map(p => [p.pid, p])),
    taken: new Set(),
    rosters: Object.fromEntries(built.order.map(id => [id, []])),
    counts: Object.fromEntries(built.order.map(id => [id, {}])),
    availByPos: {}, pickIdx: 0,
  };
  for (const pos of FD_POSITIONS) st.availByPos[pos] = 0;
  for (const p of built.pool) st.availByPos[p.position]++;
  return st;
}
function _fdApplyPick(st, e) {
  const p = st.byPid.get(e.pid);
  if (!p || st.taken.has(e.pid)) return false; // tolerate a corrupt entry rather than crash
  st.taken.add(e.pid);
  st.rosters[e.teamId].push(p);
  st.counts[e.teamId][p.position] = (st.counts[e.teamId][p.position] || 0) + 1;
  st.availByPos[p.position]--;
  return true;
}
// Full derivation: (pool build + tape) → state. What the server, a verifying
// client, and the artifact re-check all run.
function _fdApplyTape(built, tape) {
  const st = _fdNewState(built);
  for (const e of tape) _fdApplyPick(st, e);
  st.pickIdx = tape.length;
  return st;
}

// Browser-side cached view over franchise.fantasyDraft (incremental: only NEW
// tape entries are applied per call).
let _fdCache = null;
function _fdState() {
  const fd = franchise && franchise.fantasyDraft;
  if (!fd) return null;
  if (!_fdCache || _fdCache.seed !== fd.poolSeed) {
    const built = _fdBuildPool(fd.poolSeed, fd.year);
    built.order = fd.order || built.order; // stored order is the artifact input
    _fdCache = Object.assign(_fdNewState(built), { seed: fd.poolSeed, applied: 0 });
  }
  const st = _fdCache;
  const tape = fd.tape;
  for (; st.applied < tape.length; st.applied++) _fdApplyPick(st, tape[st.applied]);
  st.pickIdx = tape.length;
  st.order = fd.order;
  return st;
}
function _fdOnClock(st, pickIdx) {
  const n = st.order.length;
  const round = Math.floor(pickIdx / n), i = pickIdx % n;
  return (round % 2 === 1) ? st.order[n - 1 - i] : st.order[i]; // snake
}
function _fdDone(st) { return st.pickIdx >= st.order.length * FD_PICKS_PER_TEAM; }

// ── Legality (the no-deadlock rule) ─────────────────────────────────────────
// A pick of `pos` by `teamId` is legal iff, after taking it:
//  (1) the team can still meet its own FD_FLOORS in its remaining picks,
//  (2) per-position sanity cap (TARGET+2; K/P exactly 1),
//  (3) GLOBAL feasibility: for every position, the remaining pool still covers
//      the sum of every team's remaining floor deficits (counting argument —
//      prevents all starvation deadlocks, incl. someone hoarding both kickers).
function _fdLegal(st, teamId, pos) {
  const c = st.counts[teamId];
  const have = c[pos] || 0;
  const cap = (pos === "K" || pos === "P") ? FD_TARGET[pos] : FD_TARGET[pos] + 2;
  if (have >= cap) return false;
  if ((st.availByPos[pos] || 0) <= 0) return false;
  const myCount = st.rosters[teamId].length;
  const remainingAfter = FD_PICKS_PER_TEAM - myCount - 1;
  let myNeed = 0;
  for (const q of FD_POSITIONS) {
    const deficit = Math.max(0, (FD_FLOORS[q] || 0) - ((c[q] || 0) + (q === pos ? 1 : 0)));
    myNeed += deficit;
  }
  if (myNeed > remainingAfter) return false;
  // Global feasibility per position (only `pos` supply changed; every
  // position's demand may involve this team's updated counts).
  for (const q of FD_POSITIONS) {
    let demand = 0;
    for (const t of st.order) {
      const tc = st.counts[t];
      const haveQ = (tc[q] || 0) + (t === teamId && q === pos ? 1 : 0);
      demand += Math.max(0, (FD_FLOORS[q] || 0) - haveQ);
    }
    const supply = (st.availByPos[q] || 0) - (q === pos ? 1 : 0);
    if (supply < demand) return false;
  }
  return true;
}

// ── Auto-pick (pure function of state — NO RNG, NO libm) ────────────────────
// BPA + floor urgency + soft shape toward FD_TARGET. Total tiebreak keeps every
// replay/validator identical.
function _fdAutoPick(st, teamId) {
  // Score = overall + per-POSITION bonus, so hoist legality + bonus out of the
  // player loop (11 checks/turn instead of ~1600×) and single-pass the
  // OVR-sorted pool with a sound early exit. Selection is IDENTICAL to the
  // naive per-player scan (same formula, same order, same strict-> tiebreak) —
  // this is what lets the server run a 1,632-pick auto-fill without blocking.
  const c = st.counts[teamId];
  const legalPos = {}, bonus = {};
  let maxBonus = -Infinity;
  for (const pos of FD_POSITIONS) {
    legalPos[pos] = _fdLegal(st, teamId, pos);
    const have = c[pos] || 0;
    bonus[pos] = (FD_POS_VALUE[pos] || 0)
      + (have < (FD_FLOORS[pos] || 0) ? 10
         : have < FD_TARGET[pos] ? 4
         : -8 * (have - FD_TARGET[pos] + 1));
    if (legalPos[pos] && bonus[pos] > maxBonus) maxBonus = bonus[pos];
  }
  let best = null, bestScore = -Infinity;
  for (const p of st.pool) {
    if (st.taken.has(p.pid) || !legalPos[p.position]) continue;
    const score = (p.overall || 0) + bonus[p.position];
    if (score > bestScore) { best = p; bestScore = score; }
    // pool is OVR-desc: no later player (overall ≤ this one's) can beat
    // bestScore once even this overall + the best legal bonus falls short.
    if (bestScore >= (p.overall || 0) + maxBonus) break;
  }
  return best;
}

// ── Pick queue ──────────────────────────────────────────────────────────────
// A user-ordered wishlist of pids (persisted on franchise.fantasyDraft.queue).
// Auto-picks FOR THE USER (auto-rest + the post-round bench fill) take the
// first queued player that is still available AND legal before falling back
// to BPA-by-need. Pure function of (state, queue) — replay is unaffected
// because only the resulting tape entry is the artifact.
function _fdQueueBest(st, teamId, queue) {
  for (const pid of (queue || [])) {
    if (st.taken.has(pid)) continue;
    const p = st.byPid.get(pid);
    if (p && _fdLegal(st, teamId, p.position)) return p;
  }
  return null;
}
function frnFantasyQueueToggle(pid) {
  const fd = franchise.fantasyDraft;
  fd.queue = fd.queue || [];
  const i = fd.queue.indexOf(pid);
  if (i >= 0) fd.queue.splice(i, 1); else fd.queue.push(pid);
  saveFranchise();
  renderFantasyDraftRoom();
}
function frnFantasyQueueMove(pid, dir) {
  const q = franchise.fantasyDraft.queue || [];
  const i = q.indexOf(pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  saveFranchise();
  renderFantasyDraftRoom();
}

// ── Advancing the draft ─────────────────────────────────────────────────────
function _fdAppendPick(teamId, pid, auto) {
  franchise.fantasyDraft.tape.push({ teamId, pid, auto: !!auto });
}
// Run AI/auto picks until the user is on the clock inside the interactive
// rounds, or the draft is complete. Interactive rounds over → auto-fill
// EVERYONE (including the user) to full rosters.
function _fdAdvance() {
  const fd = franchise.fantasyDraft;
  const interactivePicks = fd.settings.rounds * franchise.fantasyDraft.order.length;
  for (;;) {
    const st = _fdState();
    if (_fdDone(st)) return "done";
    const teamId = _fdOnClock(st, st.pickIdx);
    const userTurn = teamId === franchise.chosenTeamId;
    const interactive = st.pickIdx < interactivePicks;
    if (userTurn && interactive && !fd.autoRest) return "user";
    const p = (userTurn && _fdQueueBest(st, teamId, fd.queue)) || _fdAutoPick(st, teamId);
    if (!p) return "stuck"; // provably unreachable (legality feasibility) — belt & suspenders
    _fdAppendPick(teamId, p.pid, true);
  }
}

// ── Finish: derive rosters, sign contracts, boot the franchise ──────────────
function _fdFinish() {
  const st = _fdState();
  const fd = franchise.fantasyDraft;
  franchise.rosters = st.rosters;
  franchise.teamTiers = st.teamTiers;
  // Contracts for the whole drafted league via the tested league pricer —
  // same seeded scope, so the final signed league is as reproducible as the
  // draft itself (contract helpers also draw raw Math.random).
  _fdSeededScope((fd.poolSeed ^ 0x5eed5eed) >>> 0, () =>
    assignContracts(franchise.rosters, SALARY_CAP_BASE));
  fd.done = true;
  franchise.phase = "preseason";
  _initFranchisePicks();
  _initCoachingStaff();
  _initFrontOffice();
  _seedPracticeSquads();
  if (typeof _seedCollegePipeline === "function") _seedCollegePipeline();
  _fdCache = null;
  saveFranchise();
  if (typeof DS !== "undefined" && DS.toast) {
    DS.toast({ message: "🧢 Draft complete — your league is signed and ready for camp", kind: "success", duration: 4500 });
  }
  showFranchiseDashboard();
}

// ── Entry points ────────────────────────────────────────────────────────────
// Start-screen card → team identity picker (no rosters exist yet, so this is
// a simple identity grid, not the roster-preview picker).
function frnStartFantasyDraft() {
  const meta = _readSlotsMeta();
  meta.activeSlotId = null; // new slot on first save, like frnStartNew
  _writeSlotsMeta(meta);
  franchise = null;
  const host = $("frnHomeContent");
  const cards = TEAMS.map(t => `
    <button class="fps-start" style="--accent:${t.primary}" onclick="frnFantasyPickTeam(${t.id})">
      <div class="fps-start-icon" aria-hidden="true" style="color:${t.primary}">⬢</div>
      <div class="fps-start-name">${_escHtml(t.city)} ${_escHtml(t.name)}</div>
      <div class="fps-start-desc">Draft this franchise's roster from scratch</div>
    </button>`).join("");
  host.innerHTML = `
    <div class="fps-hero" style="margin-bottom:1rem">
      <div class="fps-hero-badge">🧢</div>
      <div class="fps-hero-title">FANTASY DRAFT</div>
      <div class="fps-hero-sub">Every roster in the league starts empty — all 32 teams draft from one pool</div>
    </div>
    <div style="display:flex;align-items:center;gap:.6rem;justify-content:center;margin-bottom:1rem;flex-wrap:wrap">
      <span style="color:var(--gray);font-size:.72rem;letter-spacing:1px">ROUNDS YOU CALL:</span>
      ${[12, 25, 51].map(r => DS.chip({
        label: r === 12 ? "12 · fast" : r === 25 ? "25 · deep" : "51 · every pick",
        active: r === _fdRoundsChoice, on: `_fdSetRounds(${r})`,
      })).join("")}
      <span style="color:var(--gray);font-size:.68rem">(the rest auto-fills by need)</span>
    </div>
    <div class="fps-section-title">PICK YOUR FRANCHISE</div>
    <div class="fps-starts">${cards}</div>
    <div style="text-align:center;margin-top:1rem">
      ${DS.button({ label: "← Back", variant: "outline", on: "renderFrnStartScreen()" })}
    </div>`;
}
let _fdRoundsChoice = 12;
function _fdSetRounds(r) { _fdRoundsChoice = r; frnStartFantasyDraft(); }

function frnFantasyPickTeam(teamId) {
  try {
    franchise = {
      chosenTeamId: teamId,
      season: 1, week: 1,
      phase: "fantasy_draft",
      rosters: {},
      teamTiers: {},
      salaryCap: SALARY_CAP_BASE,
      schedule: generateFranchiseSchedule(),
      standings: initStandings(),
      playoffBracket: null, history: [], pendingFranchiseGame: null,
      rngSeedBase: (Math.random() * 0xFFFFFFFF) >>> 0,
      _offChanges: null, seasonStats: {}, seasonHighlights: [],
      superBowlGame: null, ir: {}, _irReturnsUsed: {},
      fantasyDraft: {
        poolSeed: (Math.random() * 0xFFFFFFFF) >>> 0,
        year: new Date().getFullYear(),
        settings: { rounds: _fdRoundsChoice, snake: true },
        order: null, // filled below from the seeded stream
        tape: [], done: false, autoRest: false,
      },
    };
    _fdCache = null;
    // Derive + persist the order now (explicit in the artifact inputs).
    const built = _fdBuildPool(franchise.fantasyDraft.poolSeed, franchise.fantasyDraft.year);
    franchise.fantasyDraft.order = built.order;
    saveFranchise();
    const status = _fdAdvance();
    saveFranchise();
    if (status === "done") { _fdFinish(); return; }
    renderFantasyDraftRoom();
  } catch (err) {
    franchise = null;
    _frnRenderCreateError(err);
  }
}

// User picks a player from the board.
function frnFantasyDraftPick(pid) {
  const st = _fdState();
  if (_fdDone(st)) return;
  const teamId = _fdOnClock(st, st.pickIdx);
  if (teamId !== franchise.chosenTeamId) return;
  const p = st.byPid.get(pid);
  if (!p || st.taken.has(pid) || !_fdLegal(st, teamId, p.position)) {
    if (typeof DS !== "undefined" && DS.toast) DS.toast({ message: "That pick isn't available — check your remaining position minimums", kind: "warn" });
    return;
  }
  _fdAppendPick(teamId, pid, false);
  if (typeof DS !== "undefined" && DS.toast) {
    DS.toast({ message: `✓ Drafted ${p.position} ${p.name} (${p.overall} OVR)`, kind: "success", duration: 2200 });
  }
  const status = _fdAdvance();
  saveFranchise();
  if (status === "done") { _fdFinish(); return; }
  renderFantasyDraftRoom();
}

async function frnFantasyAutoRest() {
  const ok = await _frnConfirm(
    "Hand your remaining picks to the auto-drafter? It fills your roster best-player-available by need. This finishes the entire draft.",
    { title: "Auto-draft the rest?", confirmLabel: "🤖 Auto-draft" });
  if (!ok) return;
  franchise.fantasyDraft.autoRest = true;
  const status = _fdAdvance();
  saveFranchise();
  if (status === "done") _fdFinish();
}

// ── The draft room ──────────────────────────────────────────────────────────
let _fdFilter = "ALL";
let _fdSearch = "";
function _fdSetFilter(pos) { _fdFilter = pos; renderFantasyDraftRoom(); }
function _fdSetSearch(v) {
  _fdSearch = String(v || "");
  renderFantasyDraftRoom();
  // The room re-renders wholesale — restore focus + caret so typing flows.
  const el = document.getElementById("fdSearch");
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function renderFantasyDraftRoom() {
  const navEl = document.getElementById("frnNavBar"); if (navEl) navEl.style.display = "none";
  const shEl = document.getElementById("frnAppShell"); if (shEl) shEl.style.display = "none";
  const ftEl = document.getElementById("frnAppFooter"); if (ftEl) ftEl.style.display = "none";
  const host = $("frnHomeContent");
  const st = _fdState();
  const fd = franchise.fantasyDraft;
  const n = st.order.length;
  const total = n * FD_PICKS_PER_TEAM;
  const interactivePicks = fd.settings.rounds * n;
  const round = Math.floor(st.pickIdx / n) + 1;
  const teamId = _fdOnClock(st, st.pickIdx);
  const onClock = getTeam(teamId);
  const mine = teamId === franchise.chosenTeamId;
  const my = getTeam(franchise.chosenTeamId);
  const myCounts = st.counts[franchise.chosenTeamId];
  const myRoster = st.rosters[franchise.chosenTeamId];

  // Recent picks strip (last 8)
  const recent = fd.tape.slice(-8).map((e, i) => {
    const p = st.byPid.get(e.pid); const t = getTeam(e.teamId);
    const overall = fd.tape.length - Math.min(8, fd.tape.length) + i + 1;
    return `<span class="ds-chip" title="${_escHtml(t.city + " " + t.name)}" style="border-color:${t.primary}">
      #${overall} ${_escHtml(t.abbr || t.name.slice(0, 3).toUpperCase())} · ${p.position} ${_escHtml(p.name)} <b style="color:var(--gold-lt)">${p.overall}</b></span>`;
  }).join(" ");

  // My needs meter
  const needChips = FD_POSITIONS.map(pos => {
    const have = myCounts[pos] || 0, floor = FD_FLOORS[pos] || 0, tgt = FD_TARGET[pos];
    const col = have < floor ? "var(--ds-grade-neg)" : have < tgt ? "var(--ds-grade-warn)" : "var(--ds-grade-pos)";
    return `<span class="ds-chip" style="color:${col};border-color:${col}">${pos} ${have}/${tgt}${have < floor ? " ⚠" : ""}</span>`;
  }).join(" ");

  // Board (position + name filtered, top 60)
  const q = _fdSearch.trim().toLowerCase();
  const queue = fd.queue || [];
  const avail = st.pool.filter(p => !st.taken.has(p.pid)
    && (_fdFilter === "ALL" || p.position === _fdFilter)
    && (!q || p.name.toLowerCase().includes(q)));
  const shown = avail.slice(0, 60);
  const rows = shown.map(p => {
    const legal = mine && _fdLegal(st, franchise.chosenTeamId, p.position);
    const queued = queue.includes(p.pid);
    return `<tr>
      <td style="font-weight:800;color:var(--gold-lt)">${p.overall}</td>
      <td style="font-weight:700;text-align:left">${_escHtml(p.name)}</td>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="color:var(--gray)">${p.age || "?"}</td>
      <td style="white-space:nowrap">${DS.button({ label: queued ? "✓" : "＋", variant: "outline", size: "sm",
        on: `frnFantasyQueueToggle('${_escHtml(p.pid)}')`,
        title: queued ? `Remove ${p.name} from your queue` : `Queue ${p.name} — auto-picks take your queue first`,
        ariaLabel: `${queued ? "Unqueue" : "Queue"} ${p.name}`,
        attrs: queued ? { style: "color:var(--gold-lt);border-color:var(--gold)" } : null })}${mine ? " " + DS.button({ label: "Draft", variant: legal ? "gold" : "outline", size: "sm", disabled: !legal, on: `frnFantasyDraftPick('${_escHtml(p.pid)}')`, title: legal ? `Draft ${p.name}` : "Blocked by your remaining position minimums", ariaLabel: `Draft ${p.name}` }) : ""}</td>
    </tr>`;
  }).join("");
  // Queue panel rows (kept even when a queued player gets taken — struck out).
  const queueRows = queue.map((pid, i) => {
    const p = st.byPid.get(pid);
    if (!p) return "";
    const gone = st.taken.has(pid);
    return `<div style="display:flex;align-items:center;gap:.35rem;padding:.12rem 0${gone ? ";opacity:.45;text-decoration:line-through" : ""}">
      <b style="color:var(--gray);min-width:1.2rem">${i + 1}.</b>
      <span style="flex:1"><b style="color:var(--gray)">${p.position}</b> ${_escHtml(p.name)} <b style="color:var(--gold-lt)">${p.overall}</b>${gone ? " (taken)" : ""}</span>
      ${DS.button({ label: "▲", variant: "outline", size: "sm", on: `frnFantasyQueueMove('${_escHtml(pid)}',-1)`, ariaLabel: `Move ${p.name} up`, disabled: i === 0 })}
      ${DS.button({ label: "▼", variant: "outline", size: "sm", on: `frnFantasyQueueMove('${_escHtml(pid)}',1)`, ariaLabel: `Move ${p.name} down`, disabled: i === queue.length - 1 })}
      ${DS.button({ label: "✕", variant: "outline", size: "sm", on: `frnFantasyQueueToggle('${_escHtml(pid)}')`, ariaLabel: `Remove ${p.name} from queue` })}
    </div>`;
  }).join("");
  const queueHead = mine ? _fdQueueBest(st, franchise.chosenTeamId, queue) : null;

  const filters = ["ALL", ...FD_POSITIONS].map(pos =>
    DS.chip({ label: pos, active: _fdFilter === pos, on: `_fdSetFilter('${pos}')` })).join(" ");

  host.innerHTML = `
    <div class="fps-hero" style="margin-bottom: .8rem">
      <div class="fps-hero-badge">🧢</div>
      <div class="fps-hero-title">FANTASY DRAFT · ROUND ${round}/${fd.settings.rounds}</div>
      <div class="fps-hero-sub">Pick ${st.pickIdx + 1} of ${interactivePicks} called live (${total} total) ·
        ${mine ? `<b style="color:var(--gold-lt)">YOU'RE ON THE CLOCK — ${_escHtml(my.city)} ${_escHtml(my.name)}</b>` : `on the clock: ${_escHtml(onClock.city)} ${_escHtml(onClock.name)}`}</div>
    </div>
    <div class="ds-progress" style="max-width:640px;margin:0 auto .9rem" title="${st.pickIdx} of ${total} picks made">
      <div class="ds-progress__fill" style="width:${(st.pickIdx / total * 100).toFixed(1)}%"></div>
    </div>
    ${recent ? `<div style="display:flex;gap:.35rem;flex-wrap:wrap;justify-content:center;margin-bottom:1rem">${recent}</div>` : ""}
    <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:1rem;align-items:start">
      <div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.6rem;align-items:center">${filters}
          <input id="fdSearch" type="search" value="${_escHtml(_fdSearch)}" placeholder="🔎 player name…"
            oninput="_fdSetSearch(this.value)" aria-label="Search players by name"
            style="margin-left:auto;min-width:11rem;font-size:.72rem;padding:.3rem .5rem"></div>
        <table class="frn-ana-table"><thead>
          <tr><th>OVR</th><th style="text-align:left">Player</th><th>Pos</th><th>Age</th><th></th></tr>
        </thead><tbody>${rows}</tbody></table>
        <div style="color:var(--gray);font-size:.65rem;margin-top:.4rem">showing ${shown.length} of ${avail.length} available</div>
      </div>
      <div>
        ${queue.length || mine ? `<div class="fps-section-title" style="margin-top:0">MY QUEUE · ${queue.length}</div>
        ${queueHead && mine ? DS.button({ label: `⭐ Draft #1 queued — ${queueHead.position} ${queueHead.name}`, variant: "gold", size: "sm", on: `frnFantasyDraftPick('${_escHtml(queueHead.pid)}')`, attrs: { style: "margin-bottom:.4rem;width:100%" } }) : ""}
        <div style="border:1px solid var(--border);border-radius:8px;padding:.4rem .55rem;font-size:.72rem;margin-bottom:.8rem;max-height:180px;overflow-y:auto">
          ${queueRows || `<div style="color:var(--gray);font-style:italic">Empty — ＋ players from the board. Auto-picks take your queue first.</div>`}
        </div>` : ""}
        <div class="fps-section-title" style="margin-top:0">MY ROSTER · ${myRoster.length}/${FD_PICKS_PER_TEAM}</div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.7rem">${needChips}</div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:.5rem .6rem;font-size:.75rem">
          ${myRoster.length ? myRoster.map(p => `<div style="display:flex;justify-content:space-between;padding:.12rem 0">
              <span><b style="color:var(--gray)">${p.position}</b> ${_escHtml(p.name)}</span><b style="color:var(--gold-lt)">${p.overall}</b>
            </div>`).join("") : `<div style="color:var(--gray);font-style:italic">No picks yet — you're building from zero.</div>`}
        </div>
        <div style="margin-top:.8rem;display:flex;flex-direction:column;gap:.4rem">
          ${DS.button({ label: "🤖 Auto-draft my remaining picks", variant: "outline", on: "frnFantasyAutoRest()", title: "Hand the rest to the auto-drafter and finish the entire draft" })}
        </div>
        <p style="color:var(--gray);font-size:.62rem;margin-top:.6rem">After round ${fd.settings.rounds}, every bench auto-fills by need.
        Position minimums (QB ${FD_FLOORS.QB} · K ${FD_FLOORS.K} · P ${FD_FLOORS.P} …) are enforced so every roster comes out playable.</p>
      </div>
    </div>`;
}

// Probe/test hook: run a complete draft headlessly for a given seed (every
// pick auto) and return derived rosters + hashes WITHOUT touching `franchise`.
function _fdSimulateFullDraft(seed, year, rounds) {
  const saveFr = franchise, saveCache = _fdCache;
  try {
    franchise = {
      chosenTeamId: TEAMS[0].id, salaryCap: SALARY_CAP_BASE,
      fantasyDraft: { poolSeed: seed >>> 0, year: year || 2026, settings: { rounds: rounds || 1, snake: true }, order: null, tape: [], done: false, autoRest: true },
    };
    _fdCache = null;
    franchise.fantasyDraft.order = _fdBuildPool(seed >>> 0, franchise.fantasyDraft.year).order;
    const status = _fdAdvance();
    const st = _fdState();
    return { status, tape: franchise.fantasyDraft.tape.slice(), rosters: st.rosters, order: st.order.slice() };
  } finally {
    franchise = saveFr; _fdCache = saveCache;
  }
}
