// ─── BSPN live broadcast layer ──────────────────────────────────────────────
// Phase 1: presentation only. Consumes the same gameResult / playHead as
// the existing engine but re-shapes via toBSPNLiveGameState() so the
// markup never reaches into raw simulator internals.
//
// Architecture:
//   • Pure helpers (_bspnLive*) compute derived values from raw state.
//   • toBSPNLiveGameState(gameResult, playHead) is the only place that
//     reads from the engine. It returns a BSPNLiveGameState contract
//     consumed by every component.
//   • Each component (BSPNHeader, BSPNScoreboard, AsciiFieldViewer,
//     BoxScoreMiniPanel, TeamStatsMiniPanel, LastPlayPanel,
//     DriveSummaryPanel, NextUpPanel, PlayByPlayPanel,
//     TopPerformersPanel, BSPNBottomTicker, ScoreNumeral) is a pure
//     function with `.render(props)` returning an HTML string, plus
//     `.update(state)` for per-play in-place refresh.
//   • BSPNGameScreen composes all of the above into the full layout.
//
// TODO when engine exposes more data:
//   - play.formationSnap (per-play positions) would let AsciiFieldViewer
//     drop the static formation derivation.
//   - play.firstDownYardLine would replace the down+ytg derivation.
//   - play.shortLabel + play.resultText would let LastPlayPanel skip
//     the regex name highlighter.

function _bspnLiveAbbr(team) {
  if (!team) return "TBD";
  const n = (team.name || "").trim();
  if (n) return n.slice(0, 3).toUpperCase();
  const c = (team.city || "").trim();
  return (c || "TBD").slice(0, 3).toUpperCase();
}
function _bspnLiveQuarterLabel(q) {
  if (q == null) return "—";
  if (q === 5) return "OT";
  return ["1ST","2ND","3RD","4TH"][q - 1] || `Q${q}`;
}
function _bspnLiveClock(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}
function _bspnLiveDownLabel(play) {
  if (!play || !play.down || play.down < 1) return "";
  const ord = ["1ST","2ND","3RD","4TH"][play.down - 1] || `${play.down}TH`;
  return `${ord} & ${play.ytg ?? "—"}`;
}
function _bspnLiveYardLabel(play, homeT, awayT) {
  // play.yardLine is from the offense's perspective (0..100). We surface
  // a quick "MEM 28" style label using the possession team's abbr +
  // current ball spot.
  if (play?.yardLine == null) return "";
  const possT = play.poss === "home" ? homeT : awayT;
  const otherT = play.poss === "home" ? awayT : homeT;
  if (!possT) return "";
  const yl = play.yardLine;
  const abbr = yl > 50 ? _bspnLiveAbbr(otherT) : _bspnLiveAbbr(possT);
  const spot = yl > 50 ? (100 - yl) : yl;
  return `${abbr} ${spot}`;
}

// Compute a top-N performers list for either side from the latest
// statsSnap on `gameResult.plays`. Used by renderBSPN_TopPerformers.
function _bspnLiveTopPerformers(stats, side) {
  const players = Object.values(stats?.[side]?.players || {});
  if (!players.length) return [];
  const score = p =>
    (p.pass_yds||0) * 1.0 + (p.pass_td||0) * 25 - (p.pass_int||0) * 10 +
    (p.rush_yds||0) * 1.0 + (p.rush_td||0) * 18 +
    (p.rec_yds||0) * 1.0 + (p.rec_td||0) * 18 +
    (p.tkl||0) * 1.5 + (p.sk||0) * 6 + (p.int_made||0) * 12 +
    (p.fg_made||0) * 4;
  return players
    .map(p => ({ p, s: score(p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(x => {
      const p = x.p;
      let line = "";
      if (p.pos === "QB" && (p.pass_att||0) > 0) {
        line = `${p.pass_comp||0}-${p.pass_att||0}, ${p.pass_yds||0} YDS, ${p.pass_td||0} TD`;
      } else if (p.pos === "RB" || (p.rush_att||0) > 0) {
        line = `${p.rush_att||0} CAR, ${p.rush_yds||0} YDS${p.rush_td?`, ${p.rush_td} TD`:""}`;
      } else if (p.rec || p.rec_yds) {
        line = `${p.rec||0} REC, ${p.rec_yds||0} YDS${p.rec_td?`, ${p.rec_td} TD`:""}`;
      } else if (p.tkl || p.sk) {
        line = `${p.tkl||0} TKL${p.sk?`, ${p.sk} SK`:""}${p.int_made?`, ${p.int_made} INT`:""}`;
      } else if (p.fg_made || p.xp_made) {
        line = `${p.fg_made||0}/${p.fg_att||0} FG${p.xp_made?`, ${p.xp_made}/${p.xp_att||0} XP`:""}`;
      }
      return { name: p.name, pos: p.pos, statLine: line };
    });
}

// Derive a static 11v11 formation centered on the line of scrimmage.
// The engine doesn't expose per-frame player positions yet, so this
// supplies position data for any future HTML-rendered field overlay.
// AsciiFieldViewer currently leans on the canvas for live sprite
// rendering and only uses fieldPlayers for labels.
// TODO: once GameSimulator stamps play.formationSnap with real
// per-snap positions, replace this derivation with the snapshot.
function _bspnLiveFieldPlayers(curPlay, homeT, awayT, gr) {
  // Some play kinds (kickoff, halftime, quarter markers) don't carry
  // poss/yardLine. Walk back to the most recent snap-like play so the
  // field always has a positionable formation between drives.
  let snap = curPlay;
  if (!snap || snap.poss == null || snap.yardLine == null) {
    const plays = gr?.plays || [];
    for (let i = plays.length - 1; i >= 0; i--) {
      const p = plays[i];
      if (p.poss != null && p.yardLine != null) { snap = p; break; }
    }
  }
  if (!snap || snap.poss == null || snap.yardLine == null) return [];
  const losAbs = _bspnLiveAbsoluteYardLine(snap);
  const possTeam   = snap.poss === "home" ? homeT : awayT;
  const otherTeam  = snap.poss === "home" ? awayT : homeT;
  // Direction of attack: home drives toward yard 100, away toward yard 0.
  const dir = snap.poss === "home" ? +1 : -1;
  // Look up roster starters via gameResult.playerLookup if available.
  const findStarter = (team, pos) => {
    if (!gr?.homeRatings || !gr?.awayRatings) return null;
    const side = team === homeT ? "home" : "away";
    const r = side === "home" ? gr.homeRatings : gr.awayRatings;
    const st = r?.starters;
    if (!st) return null;
    return st[pos] || null;
  };
  const playerByName = name => gr?.playerLookup?.get?.(name) || null;
  const mkOffense = (role, dx, dy, posLabel, name) => ({
    id: `off-${role}`,
    playerId: playerByName(name)?.id ?? null,
    teamId: possTeam?.id ?? null,
    name: name || "",
    position: posLabel,
    jerseyNumber: playerByName(name)?.number || "",
    x: Math.max(0, Math.min(100, losAbs + dx * dir)),
    y: dy,
    role: "offense",
    hasBall: role === "QB",
    highlighted: false,
    spriteState: "ready",
    facing: dir > 0 ? "right" : "left",
  });
  const mkDefense = (role, dx, dy, posLabel) => ({
    id: `def-${role}`,
    playerId: null,
    teamId: otherTeam?.id ?? null,
    name: "",
    position: posLabel,
    jerseyNumber: "",
    x: Math.max(0, Math.min(100, losAbs + dx * dir)),
    y: dy,
    role: "defense",
    hasBall: false,
    highlighted: false,
    spriteState: "ready",
    facing: dir > 0 ? "left" : "right",
  });
  const out = [];
  // Offense — generic 11-man set
  out.push(mkOffense("QB",  -5, 0,      "QB", findStarter(possTeam, "qb")));
  out.push(mkOffense("RB",  -8, -0.4,   "RB", findStarter(possTeam, "rb")));
  out.push(mkOffense("WR1",  0, -0.85,  "WR", findStarter(possTeam, "wr1")));
  out.push(mkOffense("WR2",  0,  0.85,  "WR", findStarter(possTeam, "wr2")));
  out.push(mkOffense("WR3", -2, -0.65,  "WR", findStarter(possTeam, "wr3")));
  out.push(mkOffense("TE",   0,  0.55,  "TE", findStarter(possTeam, "te")));
  for (let i = 0; i < 5; i++) {
    out.push(mkOffense(`OL${i+1}`, 0, -0.4 + i * 0.2, "OL", null));
  }
  // Defense — generic 4-3 base
  for (let i = 0; i < 4; i++) {
    out.push(mkDefense(`DL${i+1}`, 1, -0.35 + i * 0.23, "DL"));
  }
  for (let i = 0; i < 3; i++) {
    out.push(mkDefense(`LB${i+1}`, 5, -0.45 + i * 0.45, "LB"));
  }
  out.push(mkDefense("CB1", 6, -0.85, "CB"));
  out.push(mkDefense("CB2", 6,  0.85, "CB"));
  out.push(mkDefense("S1", 12, -0.30, "S"));
  out.push(mkDefense("S2", 12,  0.30, "S"));
  return out;
}

// Convert offense-perspective yard line (0..100) to absolute from home
// goal line, so downstream consumers don't need to know whose offense
// is on the field.
function _bspnLiveAbsoluteYardLine(play) {
  if (!play || play.yardLine == null) return 50;
  // play.yardLine is from the offense's perspective: 0 = own goal,
  // 100 = opponent's goal. Convert to absolute (0 = home goal).
  return play.poss === "home" ? play.yardLine : (100 - play.yardLine);
}

// Derive first-down line in absolute coordinates from ytg + direction.
// TODO: drop once engine stamps play.firstDownYardLine.
function _bspnLiveFirstDownLine(play) {
  if (!play || play.yardLine == null || play.ytg == null) return null;
  const losAbs = _bspnLiveAbsoluteYardLine(play);
  const dir = play.poss === "home" ? +1 : -1;
  const fd = losAbs + (play.ytg * dir);
  return Math.max(0, Math.min(100, fd));
}

// Compact currentPlay block consumed by AsciiFieldViewer/LastPlayPanel.
function _bspnLiveCurrentPlay(curPlay, homeT, awayT) {
  if (!curPlay) return null;
  const losAbs = _bspnLiveAbsoluteYardLine(curPlay);
  const fd = _bspnLiveFirstDownLine(curPlay);
  // Short label = play kind in caps; result text = best-effort suffix
  // pulled from desc. TODO: read play.shortLabel + play.resultText if
  // the engine starts emitting them.
  const shortLabel = (curPlay.kind || "").toUpperCase().replace(/_/g, " ");
  let resultText = "";
  const desc = curPlay.desc || "";
  const m = desc.match(/for ([+-]?\d+ ?yards?)/i);
  if (m) resultText = `+${m[1].replace(/ ?yards?$/i, " yds")}`;
  return {
    id: `play-${curPlay.quarter}-${curPlay.time}-${curPlay.poss || "x"}`,
    description: desc,
    shortLabel,
    resultText,
    ballX: losAbs,
    ballY: 0,
    lineOfScrimmage: losAbs,
    firstDownLine: fd,
    paths: null,  // TODO: surface route/run paths once engine emits them
  };
}

// Pulls per-player wear / stress / injury / snap% / recent big-hit for the
// offensive skill core (QB, RB, WR1, WR2, TE) on each team. Reads live
// state from franchise.rosters[teamId] (mutated by the engine during the
// game) plus the latest stats snapshot. Recent big_hit visuals within the
// last 6 plays light up the affected player's row.
function _liveBioForTeams(gr, head, homeT, awayT, snap) {
  if (typeof franchise === "undefined" || !franchise) return null;
  const ROLES = [
    { key: "qb",  label: "QB",  pos: "QB" },
    { key: "rb",  label: "RB",  pos: "RB" },
    { key: "wr1", label: "WR1", pos: "WR" },
    { key: "wr2", label: "WR2", pos: "WR" },
    { key: "te",  label: "TE",  pos: "TE" },
  ];
  // Walk back recent visuals for big-hit / ejection events on these players
  const HIT_WINDOW = 6;
  const recentHits = {};
  for (let i = Math.max(0, head - HIT_WINDOW); i < head; i++) {
    const p = gr.plays[i];
    if (!p) continue;
    if (p.kind === "big_hit" && p.carrier) {
      recentHits[p.carrier] = {
        force: p.force, mech: p.mechanism, playsAgo: head - 1 - i,
      };
    }
    if (p.kind === "ejection" && p.victim) {
      recentHits[p.victim] = recentHits[p.victim] || { mech: "ejection-hit", playsAgo: head - 1 - i };
    }
  }
  const teamRows = (teamObj, sideKey) => {
    const tid = teamObj?.id;
    const roster = franchise.rosters?.[tid] || [];
    const sidePlayers = snap?.[sideKey]?.players || {};
    // Resolve starters by best-OVR-at-position from the live roster (the
    // engine's _baseStarters list isn't reachable from outside the sim,
    // and this matches buildRatings() ordering closely enough for HUD).
    const byPos = {};
    for (const p of roster) {
      if (!p || (p.injury && p.injury.weeksRemaining > 0)) continue;
      (byPos[p.position] ||= []).push(p);
    }
    for (const k in byPos) byPos[k].sort((a,b) => (b.overall||0) - (a.overall||0));
    const rows = [];
    for (const role of ROLES) {
      const idx = role.key === "wr2" ? 1 : 0;
      const player = byPos[role.pos]?.[idx];
      // Also pull from full roster including injured for "out" rows
      const anyAtPos = roster.filter(p => p.position === role.pos)
        .sort((a,b) => (b.overall||0) - (a.overall||0));
      const target = player || anyAtPos[idx];
      if (!target) continue;
      const playerStats = sidePlayers[target.name] || {};
      const snaps = playerStats.snaps || 0;
      // Estimate total offensive snaps for snap% — use team-level snaps from
      // statsSnap if available
      const teamSnaps = snap?.[sideKey]?.team?.snaps || 0;
      const snapPct = teamSnaps > 0 ? Math.min(100, Math.round(snaps / teamSnaps * 100)) : null;
      const wear = Math.round(target._wear || 0);
      const stress = Math.round(target._stress || 0);
      // Per-game fatigue (0-100), enriched onto the snapshot by the engine.
      const fatigue = Math.round(playerStats.fatigue || 0);
      const isInjured = !!(target.injury && target.injury.weeksRemaining > 0);
      const lastHit = recentHits[target.name] || null;
      // Body-part wear snapshot (chronic scars). Only include regions with
      // meaningful wear so the silhouette doesn't get noisy.
      const bodyWear = {};
      if (target._bodyWear) {
        for (const k of Object.keys(target._bodyWear)) {
          const v = target._bodyWear[k];
          if (v >= 15) bodyWear[k] = v;
        }
      }
      rows.push({
        role: role.label, pos: target.position,
        name: target.name, jersey: target.jersey || null,
        ovr: target.overall || null,
        wear, stress, fatigue,
        snaps, snapPct,
        injury: isInjured ? {
          label: target.injury.label,
          weeks: target.injury.weeksRemaining,
          cata: !!target.injury._catastrophic,
        } : null,
        lastHit,
        bodyWear,
      });
    }
    return rows;
  };
  return {
    home: teamRows(homeT, "home"),
    away: teamRows(awayT, "away"),
  };
}

/** Adapter: gameResult + playHead → BSPNLiveGameState. */
function toBSPNLiveGameState(gr, head) {
  if (!gr) return null;
  head = Math.max(0, Math.min(head ?? 0, gr.plays.length));
  // Walk back from head for the latest snapshot (kickoff/markers don't
  // carry one). Mirrors currentStats() but local to keep the adapter
  // self-contained.
  // `curPlay` here = most-recently-shown play (used for last-play
  // description, score, clock, drive accounting). The next-snap
  // situation (down/dist/yardLine/poss) lives on `nextSnapPlay`,
  // computed below — engine snapshots play.down/ytg as the PRE-snap
  // state of that play, so the next play's pre-snap fields are what
  // the scoreboard should show after a play completes.
  let snap = null;
  let curPlay = null;
  for (let i = head - 1; i >= 0; i--) {
    const p = gr.plays[i];
    if (!curPlay) curPlay = p;
    if (p.statsSnap) { snap = p.statsSnap; break; }
  }
  if (!snap) snap = { home: { team: {}, players: {} }, away: { team: {}, players: {} } };
  const homeT = gr.homeTeam, awayT = gr.awayTeam;
  const ended = head >= gr.plays.length;
  const last = curPlay || gr.plays[0];
  const homeScore = last?.homeScore ?? 0;
  const awayScore = last?.awayScore ?? 0;
  const winner = ended ? gr.winner : null;
  // The play whose pre-snap fields drive the scoreboard. Walk forward
  // from `head` skipping any non-snap markers (quarter / halftime /
  // 2-min warning / timeout / kickoff / fg_good / fg_miss / score)
  // until we find the next true snap. If the game has ended or there
  // is no upcoming snap, fall back to the most recently shown play.
  const NON_SNAP = new Set(["quarter","halftime","ot","two_min_warning","timeout","kickoff","fg_good","fg_miss","score","punt"]);
  let nextSnapPlay = null;
  for (let i = head; i < gr.plays.length; i++) {
    const p = gr.plays[i];
    if (p.poss != null && p.yardLine != null && p.down) { nextSnapPlay = p; break; }
  }
  // For situation display (down/dist/yardLine/poss), prefer the next
  // snap; if there isn't one (mid-marker, end of game), fall back to
  // the last completed play.
  const sitPlay = ended ? last : (nextSnapPlay || last);

  // Quarter scores: tally points per quarter from scoring events up to head.
  const qs = { 1: { home:0, away:0 }, 2: { home:0, away:0 }, 3: { home:0, away:0 }, 4: { home:0, away:0 } };
  for (let i = 0; i < head; i++) {
    const p = gr.plays[i];
    if (p.kind === "score" && p.poss && p.pts) {
      const q = Math.min(4, Math.max(1, p.quarter || 1));
      qs[q][p.poss] += p.pts;
    }
  }

  // Current drive — count plays + yards + clock since last drive
  // boundary. A drive boundary is any play whose kind ends a drive
  // (kickoff, score, punt, int, fumble, fg_good, fg_miss), or the
  // first play after one. Catches turnovers/punts/missed FGs that the
  // earlier "kickoff || score" heuristic missed.
  const DRIVE_END = new Set(["kickoff","score","punt","int","fumble","fg_good","fg_miss","halftime","ot"]);
  let driveStartIdx = 0;
  for (let i = head - 1; i >= 0; i--) {
    const p = gr.plays[i];
    if (DRIVE_END.has(p.kind)) {
      // If this very play IS a drive-end, the current drive started
      // AFTER it. If it's a regular play with a drive-end immediately
      // before it, the drive started AT this index.
      driveStartIdx = (i === head - 1) ? i : i + 1;
      break;
    }
  }
  const driveSlice = gr.plays.slice(driveStartIdx, head);
  const drivePlays = driveSlice.filter(p =>
    !["kickoff","quarter","halftime","ot","two_min_warning","timeout"].includes(p.kind)).length;
  const driveYards = driveSlice.reduce((s, p) => s + (p.yards || 0), 0);
  // Time elapsed since drive start (clock counts DOWN, so subtract)
  const startT = driveSlice[0]?.time ?? last?.time ?? 0;
  const endT   = last?.time ?? 0;
  const driveTimeSec = Math.max(0, startT - endT);

  // Drive map sequence — each scoring/snap play in this drive, mapped to
  // absolute yard lines for the team in possession. Used by DriveMapPanel.
  const DRIVE_MAP_KINDS = new Set(["run","complete","incomplete","int","fumble","punt","fg_good","fg_miss","score","big_hit","ejection","substitution","hc_decision"]);
  const driveSeq = [];
  for (const p of driveSlice) {
    if (!DRIVE_MAP_KINDS.has(p.kind)) continue;
    if (p.startYard == null) continue;
    const sY = p.startYard;
    const eY = p.endYard != null ? p.endYard : p.startYard + (p.yards || 0);
    driveSeq.push({
      kind: p.kind,
      startYard: sY,
      endYard: Math.max(0, Math.min(100, eY)),
      yards: p.yards || 0,
      poss: p.poss,
      isTD: (eY >= 100) && (p.kind === "run" || p.kind === "complete"),
    });
  }
  const driveStartY = driveSeq.length ? driveSeq[0].startYard : (sitPlay?.startYard ?? null);

  // Momentum snapshot — walk back from head for the latest kind:"momentum"
  // visual carrying momentumNow. The engine doesn't expose its live tally
  // outside the sim, so we read from the visual stream.
  let momentum = { home: 0, away: 0, lastSwing: null };
  for (let i = head - 1; i >= Math.max(0, head - 60); i--) {
    const p = gr.plays[i];
    if (p?.kind === "momentum" && p.momentumNow) {
      momentum = {
        home: p.momentumNow.home || 0,
        away: p.momentumNow.away || 0,
        lastSwing: { team: p.team, amount: p.amount, source: p.source, playsAgo: head - 1 - i },
      };
      break;
    }
  }

  // Play-by-play rows from the current drive (latest first)
  const pbpRows = [];
  for (let i = head - 1; i >= 0 && pbpRows.length < 12; i--) {
    const p = gr.plays[i];
    if (p.kind === "kickoff") {
      pbpRows.push({ kind: "drive-start", desc: "— DRIVE START —" });
      break;
    }
    if (["quarter","halftime","ot","two_min_warning"].includes(p.kind)) continue;
    const possT = p.poss === "home" ? homeT : awayT;
    pbpRows.push({
      kind: p.kind, q: `Q${p.quarter || "?"}`,
      t: _bspnLiveClock(p.time),
      poss: p.poss,
      teamAbbr: possT ? _bspnLiveAbbr(possT)[0] : "",
      teamColor: possT?.primary,
      dd: p.down ? `${p.down}-${p.ytg ?? "?"}` : "",
      ydLabel: _bspnLiveYardLabel(p, homeT, awayT),
      desc: p.desc || "",
      // Biomechanics / discipline metadata — surfaced as chips in the row.
      mechanism: p.mechanism || (p.decisionContext && p.decisionContext.mechanism) || null,
      force: typeof p.force === "number"
        ? p.force
        : (p.decisionContext && typeof p.decisionContext.force === "number" ? p.decisionContext.force : null),
      eventType: p.eventType || null,
      penType: p.penType || null,
      hitTrigger: !!(p.decisionContext && p.decisionContext.hitTrigger),
      // Level-4 — offensive concept called + defensive coverage faced.
      concept: p.concept || null,
      coverage: p.coverage || null,
      personnel: p.personnel || null,   // offensive personnel grouping (surfaced as a chip)
      defPackage: p.defPackage || null, // defensive package faced — surfaced as a chip
    });
  }
  pbpRows.reverse();

  // Records / abbrev — use franchise if available, else first 3 chars
  const findRec = team => {
    if (!team) return null;
    const s = (typeof franchise !== "undefined" && franchise?.standings) ? franchise.standings[team.id] : null;
    if (!s) return null;
    return `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
  };

  // Last-play summary
  const lastPlayBlock = curPlay ? {
    desc: curPlay.desc || "",
    downLabel: _bspnLiveDownLabel(curPlay),
    yardLabel: _bspnLiveYardLabel(curPlay, homeT, awayT),
    poss: curPlay.poss,
    teamColor: curPlay.poss === "home" ? homeT?.primary : awayT?.primary,
    kind: curPlay.kind,
  } : null;

  // Next-up: derived from current state (down/distance/yard line)
  // NextUp panel shows the same upcoming-snap state as the scoreboard
  // (sitPlay), not the just-played one.
  let nextUp = null;
  if (sitPlay && !ended && sitPlay.down) {
    nextUp = {
      downLabel: _bspnLiveDownLabel(sitPlay),
      yardLabel: _bspnLiveYardLabel(sitPlay, homeT, awayT),
    };
  }

  // Top performers per side
  const topHome = _bspnLiveTopPerformers(snap, "home");
  const topAway = _bspnLiveTopPerformers(snap, "away");

  // Ticker items — accumulate notable events as the game progresses
  const tickerItems = [];
  for (let i = 0; i < head; i++) {
    const p = gr.plays[i];
    if (p.kind === "score" && p.pts >= 6) {
      const possT = p.poss === "home" ? homeT : awayT;
      tickerItems.push({ label: `${possT?.name || ""} TD`, text: p.desc || "Touchdown" });
    } else if (p.kind === "int" || p.kind === "fumble") {
      tickerItems.push({ label: "TURNOVER", text: p.desc || (p.kind === "int" ? "Interception" : "Fumble") });
    }
  }
  // Cap to last 8 to keep ticker tight
  while (tickerItems.length > 8) tickerItems.shift();

  // Bottom-line marquee text
  const leaderSide = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : null;
  const bottomLine = ended
    ? (winner === "tie"
      ? `FINAL · ${homeT.name} ${homeScore} – ${awayT.name} ${awayScore} — TIE`
      : `FINAL · ${(winner === "home" ? homeT : awayT).name.toUpperCase()} WIN ${homeScore}-${awayScore}`)
    : leaderSide
      ? `${(leaderSide === "home" ? homeT : awayT).name.toUpperCase()} LEAD ${Math.max(homeScore,awayScore)}-${Math.min(homeScore,awayScore)} · ${_bspnLiveQuarterLabel(last?.quarter)} ${_bspnLiveClock(last?.time)}`
      : `${homeT.name} & ${awayT.name} TIED ${homeScore}-${homeScore} · ${_bspnLiveQuarterLabel(last?.quarter)} ${_bspnLiveClock(last?.time)}`;

  // Canonical BSPNLiveGameState. Legacy aliases (homeScore, awayScore,
  // quarterLabel, downLabel, yardLabel, poss, drive, boxScore, ticker)
  // kept alongside the new spec fields so old call sites don't break.
  const homeTeamObj = {
    id: homeT.id, name: homeT.name, city: homeT.city,
    abbr: _bspnLiveAbbr(homeT),
    primary: homeT.primary, secondary: homeT.secondary,
    record: findRec(homeT),
    asciiMark: typeof teamAscii === "function" ? teamAscii(homeT) : "",
  };
  const awayTeamObj = {
    id: awayT.id, name: awayT.name, city: awayT.city,
    abbr: _bspnLiveAbbr(awayT),
    primary: awayT.primary, secondary: awayT.secondary,
    record: findRec(awayT),
    asciiMark: typeof teamAscii === "function" ? teamAscii(awayT) : "",
  };
  // Situation fields come from `sitPlay` (next snap pre-state), not
  // `last` (just-completed play). Engine snapshots play.down/ytg as
  // pre-snap so the next play's pre-snap is what the scoreboard
  // should show after the current play wraps up.
  const possessionTeamId = sitPlay?.poss === "home" ? homeT.id : sitPlay?.poss === "away" ? awayT.id : null;
  const losAbs = _bspnLiveAbsoluteYardLine(sitPlay);
  const fdLine = _bspnLiveFirstDownLine(sitPlay);
  const yardLineText = _bspnLiveYardLabel(sitPlay, homeT, awayT);
  const downLabel = _bspnLiveDownLabel(sitPlay);

  // — Live bio: for each team, pull QB/RB/WR1/WR2/TE current wear+stress
  //   + injury state from franchise rosters (mutated live during play).
  //   Plus recent big_hit visuals for the per-row "last hit" callout.
  const liveBio = _liveBioForTeams(gr, head, homeT, awayT, snap);

  return {
    // — Identity —
    gameId: `live-${homeT.id}-${awayT.id}`,

    // — Teams —
    homeTeam: homeTeamObj,
    awayTeam: awayTeamObj,

    // — Score —
    score: { home: homeScore, away: awayScore },

    // — Clock / quarter / status —
    quarter: _bspnLiveQuarterLabel(last?.quarter),
    clock: _bspnLiveClock(last?.time),
    status: ended ? "FINAL" : "LIVE",
    ended, winner,
    timeouts: last?.timeouts || { home: 3, away: 3 },

    // — Possession + situation — pulled from sitPlay (next snap)
    possessionTeamId,
    down: sitPlay?.down ?? null,
    distance: sitPlay?.ytg ?? null,
    downLabel,
    yardLineText,
    absoluteYardLine: losAbs,
    lineOfScrimmage: losAbs,
    firstDownLine: fdLine,

    // — Aggregates —
    quarterScores: [1,2,3,4].map(q => ({ q: `${q}`, home: qs[q].home, away: qs[q].away })),
    teamStats: {
      home: snap.home?.team || {},
      away: snap.away?.team || {},
    },

    // — Field —
    fieldPlayers: _bspnLiveFieldPlayers(sitPlay, homeT, awayT, gr),

    // — Plays —
    currentPlay: _bspnLiveCurrentPlay(sitPlay, homeT, awayT),
    lastPlay: lastPlayBlock,
    driveSummary: { plays: drivePlays, yards: driveYards, timeSec: driveTimeSec, resultText: null },
    nextUpText: nextUp ? `${nextUp.downLabel}${nextUp.yardLabel ? ` ON ${nextUp.yardLabel}` : ""}` : "",
    playByPlay: pbpRows,

    // — Stats & ticker —
    topPerformers: { home: topHome, away: topAway },
    tickerItems,
    bottomLine,
    weather: gr.weather || null,

    // — Live bio (per-player wear/stress/snap%/injury) —
    liveBio,

    // — Momentum (running, with last-swing source) —
    momentum,

    // — Legacy aliases (kept for now; remove once all callers migrate) —
    homeScore, awayScore,
    quarterLabel: _bspnLiveQuarterLabel(last?.quarter),
    yardLabel: yardLineText,
    poss: sitPlay?.poss || null,
    nextUp,
    drive: { plays: drivePlays, yards: driveYards, timeSec: driveTimeSec, sequence: driveSeq, startYard: driveStartY },
    boxScore: {
      home: { team: snap.home?.team || {}, players: snap.home?.players || {} },
      away: { team: snap.away?.team || {}, players: snap.away?.players || {} },
    },
    ticker: tickerItems,
  };
}

// ─── Components ─────────────────────────────────────────────────────────────
// Each component:
//   • render(props)  → HTML string. Pure, no DOM access.
//   • update(state)  → in-place innerHTML refresh of its mount target.
// All consume slices of BSPNLiveGameState (or sub-props) — never reach
// into raw gameResult internals.

const ScoreNumeral = {
  render({ value, color, muted }) {
    const cls = "bspnlive-score-num bspnlive-num" + (muted ? " muted" : "");
    const style = color && !muted ? ` style="color:${color}"` : "";
    return `<span class="${cls}"${style}>${value ?? 0}</span>`;
  },
};

const BSPNHeader = {
  render() {
    // PLAY-BY-PLAY is the implicit context during live game; show the
    // unified nav (SCORECENTER/STANDINGS/STATS/LEGACY/WIRE) so the user
    // can jump out of the game to a league surface. The dashboard
    // launcher will yank them back into the live view anyway.
    const navHtml = (typeof _bspnNavHtml === "function")
      ? _bspnNavHtml("PLAY-BY-PLAY")
      : "";
    return `<header class="bspnlive-header">
      <div>
        <div class="bspnlive-logo">BSPN</div>
        <div class="bspnlive-logo-sub">BALL. STRATEGY. PASSION. NOW.</div>
      </div>
      <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${navHtml}</nav>
    </header>`;
  },
};

const BSPNScoreboard = {
  _teamBlock({ team, score, isWinner, otherWon, showPoss, right }) {
    const recHtml = team.record ? `<div class="bspnlive-score-record">(${team.record})</div>` : "";
    const possHtml = showPoss
      ? `<div class="bspnlive-score-poss" style="color:${team.primary};border-color:${team.primary}">● POSS</div>`
      : "";
    const muted = !isWinner && otherWon;
    return `<div class="bspnlive-score-team${right ? " right" : ""}" style="--team-color:${team.primary}">
      <pre class="bspnlive-score-mark">${team.asciiMark || ""}</pre>
      <div class="bspnlive-score-team-meta">
        <div class="bspnlive-score-rank"><span class="bspnlive-num">${team.abbr || ""}</span></div>
        <div class="bspnlive-score-name">${team.city || ""} ${team.name || ""}</div>
        ${recHtml}
        ${possHtml}
      </div>
      ${ScoreNumeral.render({ value: score, muted })}
    </div>`;
  },
  render(state) {
    const homeWon = state.winner === "home";
    const awayWon = state.winner === "away";
    const possHome = !state.ended && state.possessionTeamId === state.homeTeam.id;
    const possAway = !state.ended && state.possessionTeamId === state.awayTeam.id;
    const center = state.ended
      ? `<div class="bspnlive-score-meta">${state.status}</div>`
      : `<div class="bspnlive-score-quarter">${state.quarter} QTR</div>
         <div class="bspnlive-score-clock">${state.clock}</div>
         ${state.downLabel
            ? `<div class="bspnlive-score-down"><span class="bspnlive-num">${state.downLabel}</span><span class="bspnlive-score-down-sep">·</span><span class="bspnlive-num">${state.yardLineText || ""}</span></div>`
            : ""}`;
    return `<div id="scoreboard" class="bspnlive-score-strip">
      ${this._teamBlock({ team: state.awayTeam, score: state.score.away, isWinner: awayWon, otherWon: homeWon, showPoss: possAway })}
      <div class="bspnlive-score-center">
        <div class="bspnlive-score-meta">BSPN SATURDAY NIGHT FOOTBALL</div>
        ${center}
      </div>
      ${this._teamBlock({ team: state.homeTeam, score: state.score.home, isWinner: homeWon, otherWon: awayWon, showPoss: possHome, right: true })}
    </div>`;
  },
  update(state) {
    const el = document.getElementById("scoreboard");
    if (!el) return;
    el.outerHTML = this.render(state);
  },
};

const AsciiFieldViewer = {
  // Renders the field wrap with the engine's canvas as the live frame.
  // The canvas-based renderer continues to paint sprites; this component
  // owns the surrounding chrome + play caption.
  render(state) {
    return `<main class="bspnlive-center">
      <div class="bspnlive-field-wrap field-wrap">
        <canvas id="field-pixi" width="${FIELD.W}" height="${FIELD.H}"
          style="position:absolute;inset:0;width:100%;height:auto;pointer-events:none"></canvas>
        <canvas id="field" width="${FIELD.W}" height="${FIELD.H}"></canvas>
        <canvas id="field-uprights" width="${FIELD.W}" height="${FIELD.H}"
          style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>
        <div class="cinema-callout" id="cinemaCallout"></div>
        <div class="bspnlive-field-overlay field-overlay">
          <div class="field-status" id="fieldStatus">Pre-game</div>
          <div id="quarterClock">—</div>
        </div>
      </div>
      <div id="playCaption" class="bspnlive-play-caption play-caption">Game starting…</div>
      <div class="bspnlive-progress-label">
        <span id="progLabel">Play 0/0</span>
        <span id="quarterLabel"></span>
      </div>
      <div class="bspnlive-progress progress-bar">
        <div class="bspnlive-progress-fill progress-fill" id="progFill" style="width:0%"></div>
      </div>
    </main>`;
  },
  update(state) {
    // Caption text is owned by the play-animation loop (#playCaption).
    // No-op here — the canvas + caption are refreshed per frame, not
    // per BSPNGameScreen.update().
  },
};

const BoxScoreMiniPanel = {
  render(state) {
    return `<div id="bspnlive-boxscore">${this._body(state)}</div>`;
  },
  _body(state) {
    const qs = state.quarterScores || [];
    const head = qs.map(q => `<th>${q.q}</th>`).join("") + `<th>T</th>`;
    const aRow = qs.map(q => `<td>${q.away}</td>`).join("") + `<td><b>${state.score.away}</b></td>`;
    const hRow = qs.map(q => `<td>${q.home}</td>`).join("") + `<td><b>${state.score.home}</b></td>`;
    return `<table class="bspnlive-mini-table">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>
        <tr class="team-a"><td>${state.awayTeam.abbr}</td>${aRow}</tr>
        <tr class="team-h"><td>${state.homeTeam.abbr}</td>${hRow}</tr>
      </tbody>
    </table>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-boxscore");
    if (el) el.innerHTML = this._body(state);
  },
};

const TeamStatsMiniPanel = {
  render(state) {
    return `<div id="bspnlive-teamstats">${this._body(state)}</div>`;
  },
  _body(state) {
    const hT = state.teamStats?.home || {};
    const aT = state.teamStats?.away || {};
    const fmtTOP = v => `${Math.floor((v||0)/60)}:${String((v||0)%60).padStart(2,"0")}`;
    const rows = [
      ["1ST DOWNS",     hT.firstDowns, aT.firstDowns],
      ["RUSH YARDS",    hT.rushYds,    aT.rushYds],
      ["PASS YARDS",    hT.passYds,    aT.passYds],
      ["TOTAL YARDS",   hT.totalYds,   aT.totalYds],
      ["TURNOVERS",     hT.turnovers,  aT.turnovers],
      ["TIME OF POSS",  fmtTOP(hT.timeOfPoss), fmtTOP(aT.timeOfPoss)],
    ];
    return `<table class="bspnlive-mini-table">
      <thead><tr>
        <th></th>
        <th style="color:${state.awayTeam.primary}">${state.awayTeam.abbr}</th>
        <th style="color:${state.homeTeam.primary}">${state.homeTeam.abbr}</th>
      </tr></thead>
      <tbody>
        ${rows.map(([label, h, a]) => `<tr>
          <td>${label}</td>
          <td>${a ?? "0"}</td>
          <td>${h ?? "0"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-teamstats");
    if (el) el.innerHTML = this._body(state);
  },
};

const LastPlayPanel = {
  render(state) {
    return `<div id="bspnlive-lastplay">${this._body(state)}</div>`;
  },
  _body(state) {
    if (!state.lastPlay) {
      return `<div class="bspnlive-lastplay-text" style="color:var(--blgray);font-style:italic">Waiting for first play…</div>`;
    }
    const p = state.lastPlay;
    // Highlight a leading "X. Lastname" so the player name pops as the
    // scorer/actor. TODO: drop once play.shortLabel is engine-stamped.
    const desc = (p.desc || "").replace(/^([A-Z]\. [A-Z][a-z]+)/, '<span class="scorer">$1</span>');
    return `
      <div class="bspnlive-lastplay-text">${desc}</div>
      ${p.downLabel
        ? `<div class="bspnlive-lastplay-down"><span class="bspnlive-num">${p.downLabel}</span>${p.yardLabel ? ` <span style="color:var(--blgray)">ON</span> <span class="bspnlive-num">${p.yardLabel}</span>` : ""}</div>`
        : ""}
    `;
  },
  update(state) {
    const el = document.getElementById("bspnlive-lastplay");
    if (el) el.innerHTML = this._body(state);
  },
};

// Drive map — horizontal mini-field showing the current drive's path
// from start to current LOS, with markers per snap and TD endpoints.
const DriveMapPanel = {
  render(state) {
    return `<div id="bspnlive-drivemap">${this._body(state)}</div>`;
  },
  _body(state) {
    const d = state.drive || {};
    const seq = d.sequence || [];
    const possIsHome = state.possessionTeamId === state.homeTeam?.id;
    const team = possIsHome ? state.homeTeam : state.awayTeam;
    if (!seq.length || d.startYard == null) {
      return `<div style="font-size:.62rem;color:var(--blgray);padding:.5rem 0;text-align:center">
        ${state.possessionTeamId ? `${team?.abbr || ""} starting drive…` : "No drive in progress."}
      </div>`;
    }
    const startY = d.startYard;
    const curY = seq[seq.length - 1].endYard;
    const teamColor = team?.primary || "#f5c542";
    // Build the strip: 100-yard field with markers for each snap.
    // Yard 0 = own goal, 100 = opp goal. Each pct is yard %.
    const yToPct = y => Math.max(0, Math.min(100, y));
    const marks = seq.map((p, i) => {
      const x = yToPct(p.endYard);
      const isLast = i === seq.length - 1;
      const isGain = p.yards > 0;
      const isLoss = p.yards < 0;
      const sym = p.kind === "complete" ? "✦"
               : p.kind === "run" ? "●"
               : p.kind === "incomplete" ? "✕"
               : p.kind === "int" || p.kind === "fumble" ? "⚠"
               : p.kind === "fg_good" ? "FG"
               : p.kind === "fg_miss" ? "✕"
               : p.kind === "punt" ? "P"
               : "·";
      const color = p.isTD ? "#ffd54d"
                  : isLast ? teamColor
                  : isGain ? "#9be09b"
                  : isLoss ? "#ff9090"
                  : "#aaa";
      return `<div class="drvmap-mark${isLast ? " current" : ""}${p.isTD ? " td" : ""}"
                   style="left:${x}%;color:${color};border-color:${color}"
                   title="Play ${i+1}: ${p.kind} · ${p.startYard} → ${p.endYard} (${p.yards>=0?"+":""}${p.yards} yd)">
                ${sym}
              </div>`;
    }).join("");
    // Connecting path: snap → snap line
    const pathPts = [`${yToPct(startY)},50`].concat(seq.map(p => `${yToPct(p.endYard)},50`)).join(" ");
    return `<div class="drvmap-wrap">
      <div class="drvmap-meta">
        <span style="color:${teamColor};font-weight:700">${team?.abbr || "—"}</span>
        <span style="color:var(--blgray)">${d.plays || 0} plays · ${d.yards >= 0 ? "+" : ""}${d.yards} yds · ${Math.floor((d.timeSec||0)/60)}:${String((d.timeSec||0)%60).padStart(2,"0")}</span>
        <span style="color:var(--blgray);margin-left:auto">start: ${startY <= 50 ? `own ${startY}` : `opp ${100 - startY}`}</span>
      </div>
      <div class="drvmap-field" style="--team:${teamColor}">
        <div class="drvmap-grid">
          ${[10,20,30,40,50,60,70,80,90].map(y =>
            `<div class="drvmap-tick" style="left:${y}%">
              <span class="drvmap-tick-num">${y === 50 ? "50" : (y > 50 ? 100 - y : y)}</span>
            </div>`).join("")}
        </div>
        <svg class="drvmap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points="${pathPts}"
            fill="none" stroke="${teamColor}" stroke-width="0.6"
            stroke-dasharray="0" opacity="0.85" />
        </svg>
        <div class="drvmap-start" style="left:${yToPct(startY)}%" title="Drive start at ${startY}">▶</div>
        ${marks}
      </div>
    </div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-drivemap");
    if (el) el.innerHTML = this._body(state);
  },
};

// ── DRIVE CHART — every play as a +/- bar at its true field position ─────
// Full-game version of DriveMapPanel: walks ALL plays up to playHead and
// lays each scrimmage play out as a horizontal bar on a 0-100 field,
// positioned EXACTLY where it happened. True field directions: home drives
// L→R (own goal at x=0), away drives R→L (own goal at x=100). Bar length =
// yards; color = whether the play was a GOOD play in context (success/EPA),
// not just whether it gained yards. Fills in live; persists post-game.
let _dvChartCache = { head: -1, data: null };
function _buildDriveChartData(gr, head) {
  if (!gr || !gr.plays) return null;
  head = Math.max(0, Math.min(head ?? gr.plays.length, gr.plays.length));
  if (_dvChartCache.head === head && _dvChartCache.data) return _dvChartCache.data;
  const SCRIM = new Set(["complete", "incomplete", "sack", "int", "run", "scramble", "fumble"]);
  const homeId = gr.homeTeam?.id;
  const clamp01 = v => Math.max(0, Math.min(100, v));
  const drives = [];
  let cur = null;
  // Result fallback for drives the engine didn't tag with a drive_summary
  // (some FG/punt paths break the drive loop early). Markers that land
  // between a drive's last snap and the next drive carry the outcome.
  const RESULT_MARK = { fg_good: "FIELD GOAL", fg_miss: "MISSED FG", punt: "PUNT" };
  const inferResult = (d) => {
    if (d.result) return d.result;
    if (d._pending) return d._pending;
    const lp = d.plays[d.plays.length - 1];
    if (!lp) return null;
    if (lp.isTD || (lp.endYard ?? 0) >= 100) return "TOUCHDOWN";
    if (lp.kind === "int") return "INTERCEPTION";
    if (lp.kind === "fumble") return "FUMBLE";
    return null;   // genuinely in progress
  };
  const closeDrive = (result, startYL) => {
    if (cur && cur.plays.length) {
      if (result != null) cur.result = result;
      cur.result = inferResult(cur);
      if (startYL != null && cur.startYL == null) cur.startYL = startYL;
      drives.push(cur);
    }
    cur = null;
  };
  for (let i = 0; i < head; i++) {
    const p = gr.plays[i];
    if (!p) continue;
    if (p.kind === "drive_summary") { closeDrive(p.driveResult, p.driveStartYL); continue; }
    // Capture terminal markers for the open drive (TD = score +6; FG; punt).
    if (cur && !cur.result) {
      if (p.kind === "score" && (p.pts || 0) >= 6) cur._pending = "TOUCHDOWN";
      else if (RESULT_MARK[p.kind]) cur._pending = RESULT_MARK[p.kind];
    }
    const isScrim = SCRIM.has(p.kind) && p.down >= 1 && p.down <= 4 && typeof p.yardLine === "number";
    if (!isScrim) continue;
    // New drive on possession change (safety net if a summary was missed).
    if (cur && cur.poss !== p.poss) closeDrive(null, null);
    if (!cur) cur = { poss: p.poss, isHome: p.poss === "home", plays: [], result: null, startYL: p.yardLine };
    cur.plays.push(p);
  }
  if (cur && cur.plays.length) { cur.result = inferResult(cur); drives.push(cur); }   // in-progress / final drive

  // Terminal EP for a drive result (offense perspective) — only used for the
  // last play's EPA tooltip; coloring uses exact success below.
  const termEP = (drive) => {
    const r = (drive.result || "").toUpperCase();
    const lastP = drive.plays[drive.plays.length - 1];
    if (lastP && (lastP.isTD || (lastP.endYard ?? 0) >= 100)) return 7;
    if (r.includes("TOUCHDOWN") || r.includes("-TD")) return 7;
    if (r.includes("SAFETY")) return -2;
    if (lastP && lastP.kind === "fg_good") return 3;
    return null;   // ambiguous (FG/Punt/TO lumped) — skip EPA on terminal play
  };
  const epOf = (typeof _mffEP === "function")
    ? (d, y, yl) => _mffEP(d, y, yl)
    : () => null;
  const isSuccess = (typeof _mffIsSuccess === "function")
    ? (c, scored) => _mffIsSuccess(c, scored)
    : (c, scored) => scored || (c.yd || 0) >= (c.d === 1 ? c.y * 0.4 : c.d === 2 ? c.y * 0.6 : c.y);

  for (const d of drives) {
    const beforeEP = d.plays.map(p => epOf(p.down, p.ytg || 10, p.yardLine));
    d.rows = d.plays.map((p, idx) => {
      const yards = typeof p.yards === "number" ? p.yards : 0;
      const start = p.yardLine;
      const end = clamp01(start + yards);
      const scored = !!p.isTD || (p.endYard ?? 0) >= 100;
      const c = { k: p.kind, d: p.down, y: p.ytg || 10, yd: yards };
      const succ = isSuccess(c, scored);
      const isTO = p.kind === "int" || p.kind === "fumble";
      const tier = scored ? "td"
                 : isTO ? "to"
                 : succ ? "good"
                 : yards > 0 ? "ok"
                 : "bad";
      // EPA: exact for non-terminal plays (next play's pre-snap EP); terminal
      // uses the result EP if unambiguous.
      let epa = null;
      if (beforeEP[idx] != null) {
        const after = (idx < d.plays.length - 1)
          ? beforeEP[idx + 1]
          : (() => { const t = termEP(d); return t == null ? null : t; })();
        if (after != null) epa = +(after - beforeEP[idx]).toFixed(2);
      }
      return {
        fxStart: d.isHome ? start : 100 - start,
        fxEnd:   d.isHome ? end   : 100 - end,
        yards, tier, epa, kind: p.kind, down: p.down, ytg: p.ytg || 10,
        startYL: start, scored, dir: d.isHome ? (yards >= 0 ? "r" : "l") : (yards >= 0 ? "l" : "r"),
        desc: p.desc || "",
      };
    });
  }
  const data = { drives, homeId, ended: head >= gr.plays.length };
  _dvChartCache = { head, data };
  return data;
}

const DriveChartPanel = {
  render() { return `<div id="bspnlive-drivechart">${this._body()}</div>`; },
  _body() {
    const gr = (typeof gameResult !== "undefined") ? gameResult : null;
    const head = (typeof playHead !== "undefined") ? playHead : (gr ? gr.plays.length : 0);
    const data = _buildDriveChartData(gr, head);
    if (!data || !data.drives.length) {
      return `<div style="font-size:.62rem;color:var(--blgray);padding:1rem 0;text-align:center">No drives yet — chart fills in as the game is played.</div>`;
    }
    const homeT = gr.homeTeam, awayT = gr.awayTeam;
    const homeAbbr = (typeof _bspnLiveAbbr === "function") ? _bspnLiveAbbr(homeT) : (homeT?.abbr || "HOME");
    const awayAbbr = (typeof _bspnLiveAbbr === "function") ? _bspnLiveAbbr(awayT) : (awayT?.abbr || "AWAY");
    const homeColor = homeT?.primary || "#4da3ff";
    const awayColor = awayT?.primary || "#f5c542";
    const tickNums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    const axis = `<div class="dvchart-axis">
      <span class="dvchart-ez left" style="background:${homeColor}" title="${homeAbbr} end zone">${homeAbbr}</span>
      <div class="dvchart-axis-field">
        ${tickNums.map((n, i) => `<span class="dvchart-axnum" style="left:${(i + 1) * 10}%">${n}</span>`).join("")}
      </div>
      <span class="dvchart-ez right" style="background:${awayColor}" title="${awayAbbr} end zone">${awayAbbr}</span>
    </div>`;

    const drivesHtml = data.drives.map((d, di) => {
      const team = d.isHome ? homeT : awayT;
      const teamAbbr = d.isHome ? homeAbbr : awayAbbr;
      const tc = team?.primary || (d.isHome ? homeColor : awayColor);
      const r = (d.result || "").toUpperCase();
      const resClass = r.includes("TOUCHDOWN") || r.includes("-TD") ? "r-td"
                     : r.includes("SAFETY") ? "r-sfty"
                     : r.includes("TURNOVER") || r.includes("INT") || r.includes("FUMBLE") ? "r-to"
                     : r.includes("FG") || r.includes("FIELD GOAL") ? "r-fg"
                     : r ? "r-punt" : "r-live";
      const resText = d.result ? d.result : "in progress…";
      const startTxt = d.startYL != null ? (d.startYL <= 50 ? `own ${d.startYL}` : `opp ${100 - d.startYL}`) : "";
      const rows = d.rows.map(rw => {
        const left = Math.min(rw.fxStart, rw.fxEnd);
        const w = Math.max(0.8, Math.abs(rw.fxEnd - rw.fxStart));
        const epaTxt = rw.epa != null ? ` · EPA ${rw.epa >= 0 ? "+" : ""}${rw.epa}` : "";
        const ddTxt = `${rw.down}&${rw.ytg}`;
        const title = `${ddTxt} at ${rw.startYL <= 50 ? "own " + rw.startYL : "opp " + (100 - rw.startYL)} · ${rw.kind} ${rw.yards >= 0 ? "+" : ""}${rw.yards}yd${epaTxt}${rw.scored ? " · TD!" : ""}`;
        // Incompletion / zero-gain: a hollow tick at the snap spot.
        if (rw.kind === "incomplete" || (rw.yards === 0 && rw.kind !== "int" && rw.kind !== "fumble")) {
          return `<div class="dvchart-play"><div class="dvchart-tick" style="left:${rw.fxStart}%" title="${title}"></div></div>`;
        }
        return `<div class="dvchart-play">
          <div class="dvchart-bar t-${rw.tier} dir-${rw.dir}" style="left:${left}%;width:${w}%" title="${title}"></div>
        </div>`;
      }).join("");
      return `<div class="dvchart-drive">
        <div class="dvchart-dhead">
          <span class="dvchart-dteam" style="color:${tc}">${d.isHome ? "▶" : "◀"} ${teamAbbr}</span>
          <span class="dvchart-dstart">${startTxt}</span>
          <span class="dvchart-dres ${resClass}">${resText}</span>
        </div>
        <div class="dvchart-rows">${rows}</div>
      </div>`;
    }).join("");

    return `<div class="dvchart-legend">
        <span class="lg t-td">TD</span><span class="lg t-good">good play</span>
        <span class="lg t-ok">gain, short</span><span class="lg t-bad">loss/fail</span>
        <span class="lg t-to">turnover</span>
        <span style="margin-left:auto;color:var(--blgray)">◀ ${awayT?.abbr||"AWAY"} drives · ${homeT?.abbr||"HOME"} drives ▶</span>
      </div>
      ${axis}
      <div class="dvchart-field">${drivesHtml}</div>`;
  },
  update() {
    const el = document.getElementById("bspnlive-drivechart");
    if (el) el.innerHTML = this._body();
  },
};

const DriveSummaryPanel = {
  render(state) {
    return `<div id="bspnlive-drive">${this._body(state)}</div>`;
  },
  _body(state) {
    const d = state.driveSummary || { plays: 0, yards: 0, timeSec: 0 };
    return `<div class="bspnlive-stat-grid">
      <div class="k">PLAYS</div><div class="k">YARDS</div><div class="k">TIME</div>
      <div class="v">${d.plays}</div>
      <div class="v">${d.yards}</div>
      <div class="v">${_bspnLiveClock(d.timeSec)}</div>
    </div>${d.resultText ? `<div style="margin-top:.4rem;text-align:center;color:var(--blgold);font-size:.65rem;letter-spacing:1px">${d.resultText}</div>` : ""}`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-drive");
    if (el) el.innerHTML = this._body(state);
  },
};

const NextUpPanel = {
  render(state) {
    return `<div id="bspnlive-nextup">${this._body(state)}</div>`;
  },
  _body(state) {
    if (!state.nextUpText) {
      return `<div class="bspnlive-nextup" style="color:var(--blgray)">—</div>`;
    }
    return `<div class="bspnlive-nextup"><span class="bspnlive-num">${state.nextUpText}</span></div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-nextup");
    if (el) el.innerHTML = this._body(state);
  },
};

const _MECH_LABEL = {
  head_on: "HEAD-ON", high: "HIGH", low: "LOW", side: "SIDE", behind: "BLINDSIDE",
};
const _MECH_COLOR = {
  high: "#e6373a", head_on: "#ed6a3a", low: "#f0a93a", side: "#90c4ec", behind: "#d4dc5a",
};
// Level-4 concept/coverage labels — short tags for the PBP chip strip.
const _CONCEPT_LABEL = {
  QUICK_GAME: "QUICK", DRAG_MESH: "MESH", INTERMEDIATE: "INT",
  VERTICAL: "VERT", SCREEN: "SCRN", PA_SHOT: "PA",
};
const _COVERAGE_LABEL = {
  C0_BLITZ: "C0", C1_MAN: "C1", C2_ZONE: "C2",
  C3_ZONE: "C3", C4_QUARTERS: "C4", TAMPA_2: "TAMPA",
};
// Personnel grouping → compact NFL tag. Vanilla 11 (BASE/TRIPS) is omitted to
// avoid chipping every play; the "tell" packages (heavy/light/13) get a chip.
const _PERSONNEL_TAG = { I_FORM:"21", HEAVY:"12", JUMBO:"13", SPREAD:"10", EMPTY:"01" };
// Defensive package → chip label. Vanilla 4-3 BASE is omitted (like vanilla 11
// on offense); the sub packages are the "tell" worth showing as the matchup.
const _DEF_PKG_TAG = { NICKEL:"NICKEL", DIME:"DIME", QUARTER:"QUARTER" };
function _pbpChips(r) {
  const chips = [];
  if (r.personnel && _PERSONNEL_TAG[r.personnel]) {
    const tag = _PERSONNEL_TAG[r.personnel];
    // JUMBO (13) is the heavy money set — highlight it gold; others ghost-blue.
    const jumbo = r.personnel === "JUMBO";
    const col = jumbo ? "#d4af37" : "#8fb3c9";
    chips.push(`<span class="bspn-pbp-chip ghost" style="color:${col};border-color:${col}">${tag} pers</span>`);
  }
  // Defensive package faced — red-toned to read as the defense's response.
  if (r.defPackage && _DEF_PKG_TAG[r.defPackage]) {
    chips.push(`<span class="bspn-pbp-chip ghost" style="color:#e0917f;border-color:#e0917f">${_DEF_PKG_TAG[r.defPackage]}</span>`);
  }
  if (r.concept && r.coverage) {
    const cn = _CONCEPT_LABEL[r.concept] || r.concept;
    const cv = _COVERAGE_LABEL[r.coverage] || r.coverage;
    chips.push(`<span class="bspn-pbp-chip ghost" style="color:#c9a83a;border-color:#c9a83a">${cn} vs ${cv}</span>`);
  }
  if (r.mechanism) {
    const lbl = _MECH_LABEL[r.mechanism] || String(r.mechanism).toUpperCase();
    const col = _MECH_COLOR[r.mechanism] || "#90c4ec";
    chips.push(`<span class="bspn-pbp-chip" style="background:${col};color:#000">${lbl}</span>`);
  }
  if (r.force != null) {
    const fc = r.force >= 1.9 ? "#e6373a" : r.force >= 1.7 ? "#ed6a3a" : r.force >= 1.4 ? "#f0a93a" : "#90c4ec";
    chips.push(`<span class="bspn-pbp-chip ghost" style="color:${fc};border-color:${fc}">⚡ ${r.force.toFixed(2)}</span>`);
  }
  if (r.eventType === "sack") {
    chips.push(`<span class="bspn-pbp-chip ghost" style="color:#90c4ec;border-color:#90c4ec">SACK</span>`);
  }
  if (r.kind === "penalty") {
    const isUR = r.penType === "Unnecessary Roughness";
    const col = isUR ? "#e6373a" : "#f5c542";
    chips.push(`<span class="bspn-pbp-chip" style="background:${col};color:#000">🚩 FLAG</span>`);
  }
  if (r.kind === "ejection") {
    chips.push(`<span class="bspn-pbp-chip" style="background:#e6373a;color:#fff">🚫 EJECTION</span>`);
  }
  return chips.length ? `<div class="bspn-pbp-chips">${chips.join("")}</div>` : "";
}
const PlayByPlayPanel = {
  render(state) {
    return `<div id="bspnlive-pbp" class="bspnlive-pbp-list">${this._body(state)}</div>`;
  },
  _body(state) {
    const rows = (state.playByPlay || []).map(r => {
      if (r.kind === "drive-start") {
        return `<div class="bspnlive-pbp-row drive-start">${r.desc}</div>`;
      }
      const rowCls = r.kind === "ejection" ? "bspnlive-pbp-row ejection"
                   : r.kind === "big_hit"  ? "bspnlive-pbp-row big-hit"
                   : r.kind === "penalty"  ? "bspnlive-pbp-row penalty"
                   : "bspnlive-pbp-row";
      return `<div class="${rowCls}">
        <span class="q">${r.q} ${r.t}</span>
        <span class="t" style="color:${r.teamColor||"var(--blgreen)"}">${r.teamAbbr||""}</span>
        <span class="dd">${r.dd} ${r.ydLabel||""}</span>
        <span class="desc">${_bspnEsc(r.desc)}</span>
        ${_pbpChips(r)}
      </div>`;
    }).join("");
    return rows || `<div style="color:var(--blgray);font-style:italic;font-size:.7rem">Play-by-play will appear here.</div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-pbp");
    if (!el) return;
    el.innerHTML = this._body(state);
    el.scrollTop = el.scrollHeight;
  },
};

const TopPerformersPanel = {
  render(state) {
    return `<div id="bspnlive-perf-body">${this._body(state)}</div>`;
  },
  _body(state) {
    const block = (team, list) => `
      <div class="bspnlive-perf-team" style="--team-color:${team.primary}">${team.city.toUpperCase()}</div>
      ${list.length
        ? list.map(p =>
            `<div class="bspnlive-perf-row">
              <span class="name">${_bspnEsc(p.name)}</span>
              <span class="stat">${_bspnEsc(p.statLine || "")}</span>
            </div>`).join("")
        : `<div style="color:var(--blgray);font-size:.7rem;font-style:italic">No stats yet.</div>`}`;
    return block(state.awayTeam, state.topPerformers?.away || []) +
           block(state.homeTeam, state.topPerformers?.home || []);
  },
  update(state) {
    const el = document.getElementById("bspnlive-perf-body");
    if (el) el.innerHTML = this._body(state);
  },
};

const BSPNBottomTicker = {
  render(state) {
    return `<div class="bspnlive-ticker-wrap">
      <span class="bspnlive-ticker-label">BSPN BOTTOM LINE</span>
      <div class="bspnlive-ticker">
        <div class="bspnlive-ticker-inner" id="bspnlive-ticker-inner">${this._body(state)}</div>
      </div>
      <span class="bspnlive-ticker-corner">[SCORES] · [SCHEDULE] · [SETTINGS]</span>
    </div>`;
  },
  _body(state) {
    const items = (state.tickerItems && state.tickerItems.length)
      ? state.tickerItems
      : [{ label: "BSPN", text: state.bottomLine || "GRIDIRON. CODE. GLORY." }];
    return items.map(it =>
      `<span class="bspnlive-ticker-item"><span class="lbl">${_bspnEsc(it.label)}:</span>${_bspnEsc(it.text)}</span>`
    ).join("");
  },
  update(state) {
    const el = document.getElementById("bspnlive-ticker-inner");
    if (el) el.innerHTML = this._body(state);
  },
};

// LiveBioPanel — per-team skill-player wear/stress/snap%/injury chips.
// Surfaces engine systems (wear, stress, body-part damage, mid-game
// substitution) that previously had no live representation.
// Body-part hot map SVG for the LIVE BIO row. Renders a tiny Vitruvian
// silhouette with colored markers on any region whose chronic body-wear
// score has crossed the visibility threshold. Coordinates match the
// _BODY_PARTS keys in play-franchise-season.js.
const _BODYHOT_COORDS = {
  head:        { cx: 20, cy: 7  }, neck:        { cx: 20, cy: 13 },
  chest:       { cx: 20, cy: 24 }, back:        { cx: 20, cy: 26 },
  groin:       { cx: 20, cy: 33 },
  shoulderL:   { cx: 14, cy: 18 }, shoulderR:   { cx: 26, cy: 18 },
  hipL:        { cx: 17, cy: 35 }, hipR:        { cx: 23, cy: 35 },
  hamstringL:  { cx: 17, cy: 42 }, hamstringR:  { cx: 23, cy: 42 },
  kneeL:       { cx: 17, cy: 49 }, kneeR:       { cx: 23, cy: 49 },
  calfL:       { cx: 17, cy: 53 }, calfR:       { cx: 23, cy: 53 },
  achillesL:   { cx: 17, cy: 57 }, achillesR:   { cx: 23, cy: 57 },
  ankleL:      { cx: 16, cy: 61 }, ankleR:      { cx: 24, cy: 61 },
  handL:       { cx: 9,  cy: 30 }, handR:       { cx: 31, cy: 30 },
};
function _bodyHotMapSVG(bodyWear) {
  // Always render the silhouette outline even with no wear so the
  // chip slot stays a stable size. Render dots for any region the
  // adapter passed through (already filtered to wear >= 15).
  const markers = Object.entries(bodyWear || {}).map(([part, v]) => {
    const c = _BODYHOT_COORDS[part];
    if (!c) return "";
    const intensity = Math.min(100, v) / 100;
    const color = v >= 70 ? "#ff3a3a" : v >= 45 ? "#ff8a4a" : "#e8a000";
    const r = 2 + intensity * 1.8;
    const titlePart = part.replace(/([LR])$/, " $1").replace(/^./, c => c.toUpperCase());
    return `<g><circle cx="${c.cx}" cy="${c.cy}" r="${r + 1.5}" fill="${color}" opacity="${0.22 + intensity * 0.18}"/>
      <circle cx="${c.cx}" cy="${c.cy}" r="${r}" fill="${color}" opacity="${0.7 + intensity * 0.3}"><title>${titlePart}: ${Math.round(v)}</title></circle></g>`;
  }).join("");
  return `<svg viewBox="0 0 40 70" width="32" height="56" class="livebio-bodyhot">
    <ellipse cx="20" cy="7" rx="4.5" ry="5.2" fill="#222" stroke="#555" stroke-width=".6"/>
    <path d="M14,13 L26,13 L28,22 L24,38 L26,68 L22,68 L20,38 L18,38 L17,68 L13,68 L15,38 L11,22 Z"
          fill="#222" stroke="#555" stroke-width=".6"/>
    <path d="M14,14 L8,30" stroke="#555" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M26,14 L32,30" stroke="#555" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${markers}
  </svg>`;
}

const LiveBioPanel = {
  render(state) {
    return `<div id="bspnlive-livebio">${this._body(state)}</div>`;
  },
  _body(state) {
    const lb = state.liveBio;
    if (!lb || (!lb.home?.length && !lb.away?.length)) {
      return `<div style="font-size:.6rem;color:var(--blgray);padding:.3rem 0">No live data — pre-game.</div>`;
    }
    const teamBlock = (rows, team) => {
      if (!rows?.length) return "";
      return `<div class="livebio-team">
        <div class="livebio-team-head" style="border-left:3px solid ${team.primary}">
          <span class="livebio-team-abbr">${team.abbr || team.name}</span>
        </div>
        <div class="livebio-rows">
          ${rows.map(r => this._row(r)).join("")}
        </div>
      </div>`;
    };
    return teamBlock(lb.away, state.awayTeam) + teamBlock(lb.home, state.homeTeam);
  },
  _row(r) {
    const wearColor = r.wear >= 75 ? "#ff7070" : r.wear >= 55 ? "#e8a000" : r.wear >= 30 ? "#9bd0ff" : "#7ee08a";
    const stressColor = r.stress >= 75 ? "#ff7070" : r.stress >= 55 ? "#e8a000" : "#7ee08a";
    const wearW = Math.max(0, Math.min(100, r.wear));
    const stressW = Math.max(0, Math.min(100, r.stress));
    // Fatigue: green (fresh) → amber → red (gassed). High = tired = worse.
    const fatigue = r.fatigue || 0;
    const fatColor = fatigue >= 70 ? "#ff7070" : fatigue >= 45 ? "#e8a000" : "#7ee08a";
    const fatW = Math.max(0, Math.min(100, fatigue));
    const hitChip = r.lastHit
      ? `<span class="livebio-hit-chip"
            title="Last contact: ${r.lastHit.mech || "hit"}${r.lastHit.force ? ` · force ${r.lastHit.force.toFixed(2)}` : ""}">💥${r.lastHit.force ? r.lastHit.force.toFixed(1) : ""}</span>`
      : "";
    const injuryChip = r.injury
      ? `<span class="livebio-injury-chip" style="color:#ff9090"
            title="${r.injury.label}${r.injury.cata?" — catastrophic":""}">${r.injury.cata?"🚑":"🩹"} ${r.injury.weeks}w</span>`
      : "";
    const snapTxt = r.snapPct != null ? `${r.snapPct}%` : (r.snaps ? `${r.snaps} sn` : "—");
    const hotSvg = _bodyHotMapSVG(r.bodyWear || {});
    const hasScars = Object.keys(r.bodyWear || {}).length > 0;
    return `<div class="livebio-row${r.lastHit?.playsAgo === 0 ? " flash" : ""}">
      <div class="livebio-id">
        <span class="livebio-role">${r.role}</span>
        <span class="livebio-name">${r.name || "—"}</span>
        ${r.ovr ? `<span class="livebio-ovr">${r.ovr}</span>` : ""}
        <span class="livebio-snaps">${snapTxt}</span>
        ${injuryChip}${hitChip}
      </div>
      <div class="livebio-content">
        <div class="livebio-bars">
          <div class="livebio-bar-row">
            <span class="livebio-bar-lbl">W</span>
            <div class="livebio-bar"><div class="livebio-bar-fill" style="width:${wearW}%;background:${wearColor}"></div></div>
            <span class="livebio-bar-val">${r.wear}</span>
          </div>
          <div class="livebio-bar-row">
            <span class="livebio-bar-lbl">S</span>
            <div class="livebio-bar"><div class="livebio-bar-fill" style="width:${stressW}%;background:${stressColor}"></div></div>
            <span class="livebio-bar-val">${r.stress}</span>
          </div>
          <div class="livebio-bar-row" title="In-game fatigue (0-100) — accumulates with workload, recovers on the bench; up to -20% performance when gassed">
            <span class="livebio-bar-lbl">F</span>
            <div class="livebio-bar"><div class="livebio-bar-fill" style="width:${fatW}%;background:${fatColor}"></div></div>
            <span class="livebio-bar-val">${fatigue}</span>
          </div>
        </div>
        <div class="livebio-bodyhot-col${hasScars ? "" : " empty"}" title="${hasScars ? `Chronic wear / past injuries by region` : `No notable region wear`}">
          ${hotSvg}
        </div>
      </div>
    </div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-livebio");
    if (el) el.innerHTML = this._body(state);
  },
};

// Field HUD overlay — score/clock/down/drive corners over the canvas.
// Built once into the field-wrap; updates each tick via DOM mutation.
// Momentum bar — thin centered strip showing the running -10..+10
// balance between the two teams. Color-filled toward the leading
// side; flares when the latest swing happened within the last play
// or two (drives a flash + flavor chip).
const MomentumBar = {
  render(state) {
    return `<div class="momentum-bar" id="momentum-bar">${this._body(state)}</div>`;
  },
  _body(state) {
    const m = state.momentum || { home: 0, away: 0, lastSwing: null };
    // Net = home - away, range roughly -15..+15 (since both can be ±10)
    const net = (m.home || 0) - (m.away || 0);
    const pct = Math.max(-1, Math.min(1, net / 15)); // -1..+1
    // Bar geometry: 0 in the middle, fill grows toward leading side
    const homeFill = pct > 0 ? pct * 50 : 0;       // 0..50
    const awayFill = pct < 0 ? -pct * 50 : 0;
    const homeColor = state.homeTeam?.primary || "#9be09b";
    const awayColor = state.awayTeam?.primary || "#9bd0ff";
    const fresh = m.lastSwing && m.lastSwing.playsAgo <= 1;
    const swingTeamObj = m.lastSwing
      ? (m.lastSwing.team === "home" ? state.homeTeam : state.awayTeam)
      : null;
    const flareChip = fresh && m.lastSwing
      ? `<div class="momentum-flare" style="--team:${swingTeamObj?.primary || "#fff"}">
          <span class="mom-flare-icon">⚡</span>
          <span class="mom-flare-text">${m.lastSwing.source}</span>
          <span class="mom-flare-team">${(swingTeamObj?.abbr || "").toUpperCase()} +${m.lastSwing.amount}</span>
        </div>`
      : "";
    // Crowd reaction — home stadium reads momentum + score-state. Negative
    // for the home team flips mood. Magnitude of |home momentum| sets level.
    const homeNet = (m.home || 0);
    const homeLeading = (state.score.home || 0) > (state.score.away || 0);
    let mood, moodCls, moodColor;
    if (homeNet >= 6)       { mood = "ELECTRIC";  moodCls = "electric"; moodColor = "#ffd54d"; }
    else if (homeNet >= 3)  { mood = "RAUCOUS";   moodCls = "raucous";  moodColor = "#ff8a4a"; }
    else if (homeNet >= 0)  { mood = homeLeading ? "BUZZING" : "EVEN"; moodCls = ""; moodColor = "#9bd0ff"; }
    else if (homeNet >= -3) { mood = "RESTLESS";  moodCls = ""; moodColor = "#aaa"; }
    else if (homeNet >= -6) { mood = "STUNNED";   moodCls = ""; moodColor = "#888"; }
    else                    { mood = "DEFLATED";  moodCls = ""; moodColor = "#666"; }
    const crowdChip = `<span class="crowd-chip ${moodCls}" style="--mood:${moodColor}" title="Home-crowd mood inferred from team momentum + score state">
      <span>🏟</span><span>${mood}</span>
    </span>`;
    return `<div class="mom-strip">
      <span class="mom-team-label home" style="color:${homeColor}">${state.homeTeam?.abbr || "H"}</span>
      <div class="mom-track">
        <div class="mom-fill home" style="width:${homeFill}%;background:${homeColor};box-shadow:0 0 ${4 + homeFill/4}px ${homeColor}"></div>
        <div class="mom-fill away" style="width:${awayFill}%;background:${awayColor};box-shadow:0 0 ${4 + awayFill/4}px ${awayColor}"></div>
        <div class="mom-center"></div>
      </div>
      <span class="mom-team-label away" style="color:${awayColor}">${state.awayTeam?.abbr || "A"}</span>
      ${crowdChip}
    </div>${flareChip}`;
  },
  update(state) {
    const el = document.getElementById("momentum-bar");
    if (el) el.innerHTML = this._body(state);
  },
};

const FieldHUD = {
  render(state) {
    return `<div class="field-hud" id="field-hud">
      <div class="hud-corner top-left">${this._teamScore(state, "home")}</div>
      <div class="hud-corner top-center">${this._clock(state)}</div>
      <div class="hud-corner top-right">${this._teamScore(state, "away")}</div>
      <div class="hud-corner bot-left">${this._situation(state)}</div>
      <div class="hud-corner bot-right">${this._drive(state)}</div>
      ${this._cameraToggle()}
    </div>`;
  },
  _cameraToggle() {
    const td = (typeof cameraMode !== "undefined" && cameraMode === "topdown") ? " active" : "";
    const bd = (typeof cameraMode !== "undefined" && cameraMode === "broadcast") ? " active" : "";
    const audOn = (typeof GCAudio !== "undefined" && GCAudio.isEnabled()) ? "" : " muted";
    const audIcon = (typeof GCAudio !== "undefined" && GCAudio.isEnabled()) ? "🔊" : "🔇";
    return `<div class="hud-cam-toggle">
      <button id="camTopdownBtn" class="hud-cam-btn${td}" onclick="setCameraMode('topdown')" title="Top-down view">⬇ TOP</button>
      <button id="camBroadcastBtn" class="hud-cam-btn${bd}" onclick="setCameraMode('broadcast')" title="Broadcast camera (tilted field)">🎥 BCAST</button>
      <button class="hud-cam-btn" onclick="frnReplayLastPlay()" title="Re-watch the previous play in slow motion">↻ REPLAY</button>
      <button id="audToggleBtn" class="hud-cam-btn${audOn}" onclick="_toggleAudio()" title="Toggle stadium audio">${audIcon}</button>
    </div>`;
  },
  _teamScore(state, side) {
    const t = side === "home" ? state.homeTeam : state.awayTeam;
    const score = side === "home" ? state.score.home : state.score.away;
    const possIcon = state.possessionTeamId === t.id
      ? `<span class="hud-poss" style="background:${t.primary}">●</span>` : "";
    const to = state.timeouts?.[side] ?? 3;
    const toDots = Array.from({length:3}).map((_,i) =>
      `<span class="hud-to-dot${i < to ? " on" : ""}"></span>`).join("");
    return `<div class="hud-team-score" style="--team:${t.primary}">
      <div class="hud-team-meta">
        ${possIcon}
        <span class="hud-team-abbr">${t.abbr || t.name?.slice(0,3).toUpperCase()}</span>
      </div>
      <div class="hud-score-num">${score ?? 0}</div>
      <div class="hud-to-strip">${toDots}</div>
    </div>`;
  },
  _clock(state) {
    return `<div class="hud-clock">
      <div class="hud-quarter">${state.quarter || "—"}</div>
      <div class="hud-clock-num">${state.clock || "0:00"}</div>
    </div>`;
  },
  _situation(state) {
    if (!state.downLabel) return "";
    const isRZ = state.absoluteYardLine != null && state.absoluteYardLine >= 80;
    const isGL = state.absoluteYardLine != null && state.absoluteYardLine >= 95;
    return `<div class="hud-situation">
      <div class="hud-down">${state.downLabel || ""}</div>
      <div class="hud-yardline">${state.yardLineText || ""}</div>
      ${isGL ? `<div class="hud-zone gold">GOAL LINE</div>`
            : isRZ ? `<div class="hud-zone red">RED ZONE</div>` : ""}
    </div>`;
  },
  _drive(state) {
    const d = state.drive || {};
    const mins = Math.floor((d.timeSec || 0) / 60);
    const secs = (d.timeSec || 0) % 60;
    return `<div class="hud-drive">
      <div class="hud-drive-lbl">DRIVE</div>
      <div class="hud-drive-num">${d.plays || 0} pl · ${d.yards || 0} yd · ${mins}:${String(secs).padStart(2,"0")}</div>
    </div>`;
  },
  update(state) {
    const el = document.getElementById("field-hud");
    if (!el) return;
    el.innerHTML = `
      <div class="hud-corner top-left">${this._teamScore(state, "home")}</div>
      <div class="hud-corner top-center">${this._clock(state)}</div>
      <div class="hud-corner top-right">${this._teamScore(state, "away")}</div>
      <div class="hud-corner bot-left">${this._situation(state)}</div>
      <div class="hud-corner bot-right">${this._drive(state)}</div>
      ${this._cameraToggle()}`;
  },
};

const BSPNGameScreen = {
  render(state) {
    return `<div class="bspnlive-root v2" style="--away-color:${state.awayTeam.primary};--home-color:${state.homeTeam.primary}">
      ${BSPNHeader.render()}
      ${BSPNScoreboard.render(state)}
      ${MomentumBar.render(state)}
      <div class="bspnlive-body v2">
        ${AsciiFieldViewer.render(state)}
        ${FieldHUD.render(state)}
        <aside class="bspnlive-side right v2">
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">⚕ LIVE BIO</div>
            ${LiveBioPanel.render(state)}
          </div>
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">LAST PLAY</div>
            ${LastPlayPanel.render(state)}
          </div>
        </aside>
      </div>
      <div class="bspnlive-bottom v2">
        <div class="bspnlive-bottom-tabs">
          <button class="bspnlive-tab active" data-tab="pbp" onclick="_bspnSwitchTab('pbp')">PLAY-BY-PLAY</button>
          <button class="bspnlive-tab" data-tab="box" onclick="_bspnSwitchTab('box')">BOX SCORE</button>
          <button class="bspnlive-tab" data-tab="stats" onclick="_bspnSwitchTab('stats')">TEAM STATS</button>
          <button class="bspnlive-tab" data-tab="drive" onclick="_bspnSwitchTab('drive')">DRIVE · NEXT UP</button>
          <button class="bspnlive-tab" data-tab="dvchart" onclick="_bspnSwitchTab('dvchart')">DRIVE CHART</button>
          <button class="bspnlive-tab" data-tab="perf" onclick="_bspnSwitchTab('perf')">TOP PERFORMERS</button>
        </div>
        <div class="bspnlive-bottom-content">
          <div class="bspnlive-bottom-pane active" data-pane="pbp">
            ${PlayByPlayPanel.render(state)}
            <div id="playLog" class="play-log" style="display:none"></div>
          </div>
          <div class="bspnlive-bottom-pane" data-pane="box">
            ${BoxScoreMiniPanel.render(state)}
          </div>
          <div class="bspnlive-bottom-pane" data-pane="stats">
            ${TeamStatsMiniPanel.render(state)}
          </div>
          <div class="bspnlive-bottom-pane" data-pane="drive">
            <div class="bspnlive-panel-title" style="text-align:left;padding-bottom:.3rem;margin-bottom:.45rem">DRIVE MAP</div>
            ${DriveMapPanel.render(state)}
            <div class="bspnlive-drive-row" style="margin-top:.7rem">
              <div class="bspnlive-drive-col">
                <div class="bspnlive-panel-title">DRIVE SUMMARY</div>
                ${DriveSummaryPanel.render(state)}
              </div>
              <div class="bspnlive-drive-col">
                <div class="bspnlive-panel-title">NEXT UP</div>
                ${NextUpPanel.render(state)}
              </div>
            </div>
          </div>
          <div class="bspnlive-bottom-pane" data-pane="dvchart">
            <div class="bspnlive-panel-title" style="text-align:left;padding-bottom:.3rem;margin-bottom:.45rem">DRIVE CHART · every play, where it happened</div>
            ${DriveChartPanel.render()}
          </div>
          <div class="bspnlive-bottom-pane" data-pane="perf">
            ${TopPerformersPanel.render(state)}
          </div>
        </div>
      </div>
      ${BSPNBottomTicker.render(state)}
      <!-- Hidden legacy nodes kept so existing render helpers don't blow up -->
      <div id="boxScore" style="display:none"></div>
      <table id="ratings" style="display:none"></table>
      <div id="driveLog" style="display:none"></div>
    </div>`;
  },
  update(state) {
    if (!document.querySelector(".bspnlive-root")) return;
    BSPNScoreboard.update(state);
    MomentumBar.update(state);
    FieldHUD.update(state);
    BoxScoreMiniPanel.update(state);
    TeamStatsMiniPanel.update(state);
    LiveBioPanel.update(state);
    LastPlayPanel.update(state);
    DriveSummaryPanel.update(state);
    DriveMapPanel.update(state);
    DriveChartPanel.update();
    NextUpPanel.update(state);
    PlayByPlayPanel.update(state);
    TopPerformersPanel.update(state);
    BSPNBottomTicker.update(state);
  },
};

// Stadium audio mute / unmute. Called from the HUD audio toggle button.
function _toggleAudio() {
  if (typeof GCAudio === "undefined") return;
  const nowOn = !GCAudio.isEnabled();
  GCAudio.setEnabled(nowOn);
  if (!nowOn) GCAudio.crowd.stop();
  const btn = document.getElementById("audToggleBtn");
  if (btn) {
    btn.textContent = nowOn ? "🔊" : "🔇";
    btn.classList.toggle("muted", !nowOn);
  }
}

// Tab switcher for the bottom strip (box / stats / pbp / drive / perf).
function _bspnSwitchTab(name) {
  document.querySelectorAll(".bspnlive-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".bspnlive-bottom-pane").forEach(p =>
    p.classList.toggle("active", p.dataset.pane === name));
}

// Per-play refresh — called from the existing animation loop via the
// legacy renderScoreboard/renderBoxScore/renderPlayLog hooks.
function renderBSPNLive() {
  if (!gameResult || !document.querySelector(".bspnlive-root")) return;
  const state = toBSPNLiveGameState(gameResult, playHead);
  if (!state) return;
  BSPNGameScreen.update(state);
}

function renderGameLayout() {
  gameArea.classList.remove("empty");
  boxTab = "totals";
  // Compose the BSPN broadcast layout via named components. Initial state
  // is derived from the engine — same per-play state used by .update().
  const state = toBSPNLiveGameState(gameResult, playHead);
  gameArea.innerHTML = state ? BSPNGameScreen.render(state) : "";
  // Reset transient overlays from any prior game
  if (typeof _subTicker !== "undefined" && _subTicker.clearAll) _subTicker.clearAll();
  if (typeof _bigHitCinema !== "undefined" && _bigHitCinema.clear) _bigHitCinema.clear();
  if (typeof _touchdownCinema !== "undefined" && _touchdownCinema.clear) _touchdownCinema.clear();
  if (typeof _hcDecisionCinema !== "undefined" && _hcDecisionCinema.clear) _hcDecisionCinema.clear();
  if (typeof _momentCinema !== "undefined" && _momentCinema.clear) _momentCinema.clear();
  if (typeof _segmentCinema !== "undefined" && _segmentCinema.clear) _segmentCinema.clear();
  // Re-apply camera mode — renderGameLayout just rebuilt the field-wrap +
  // canvas, so the perspective CSS we set last time is gone.
  if (typeof setCameraMode === "function" && typeof cameraMode !== "undefined") {
    setCameraMode(cameraMode);
  }
  // Initial field draw — engine continues to own the canvas.
  const ctx = $("field").getContext("2d");
  if (viewMode === "cinema") {
    cinemaCamX = yardToWorldX(50);
    drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  } else {
    drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  }
}

