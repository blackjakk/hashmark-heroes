// Adapter: GameSimulator result -> BSPNBoxScoreData
//
// This is the ONLY place that should know about GameSimulator internals.
// Components consume BSPNBoxScoreData; if the sim grows new fields, only
// this adapter changes.
//
// Current sim shape (from GameSimulator.simulate()):
//   { homeTeam, awayTeam, homeScore, awayScore,
//     homeRatings, awayRatings, winner, plays, drives }
// where plays[] are { kind, desc, quarter, time, homeScore, awayScore, yards? }
//
// Fields the sim does NOT yet produce (left empty / TODO):
//   - per-player stat aggregates
//   - team totals (first downs, total yards, TOP, penalties)
//   - explicit scoring-play time + scorer team id (we parse desc as a stopgap)
//   - leaders, top performers, game notes
//   - team records as of the game
//
// When the sim eventually publishes those, fill the empty arrays from
// the new fields. Until then, callers can pass an `extras` object to
// supplement.

import { getTeam } from "../data/teams.js";

function abbrFor(team) {
  if (!team) return "TBD";
  const c = (team.city || "").trim();
  const n = (team.name || "").trim();
  if (c && n) return (c[0] + n.slice(0, 2)).toUpperCase();
  return (n || "TBD").slice(0, 3).toUpperCase();
}

function toBSPNTeam(team, record) {
  if (!team) {
    return { id: "tbd", name: "TBD", abbreviation: "TBD",
             primaryColor: "#888", secondaryColor: "#444" };
  }
  return {
    id: team.id,
    name: team.name,
    city: team.city,
    abbreviation: abbrFor(team),
    record: record || null,
    primaryColor: team.primary,
    secondaryColor: team.secondary,
    asciiMark: team.asciiMark || null,
  };
}

// Walk the plays array, summing pts per quarter for each side.
function deriveQuarterScores(plays) {
  const acc = {};
  for (const p of plays || []) {
    if (p.kind !== "score") continue;
    const q = Math.max(1, Math.min(8, p.quarter || 1));
    acc[q] ||= { home: 0, away: 0 };
    // Find pts via diff against the previous score (sim doesn't emit pts directly).
    // Fallback: assume 3 (FG) or 6/7/8 (TD) based on desc text.
    let pts = 0;
    if (p.desc && /Touchdown/i.test(p.desc)) pts = 6;
    else if (p.desc && /Extra Point/i.test(p.desc)) pts = 1;
    else if (p.desc && /2-Point/i.test(p.desc))     pts = 2;
    else if (p.desc && /Field Goal/i.test(p.desc))   pts = 3;
    // Assign to the side whose score moved (cheap heuristic — falls back
    // to no-op if we can't determine).
    if (p.homeScore != null && p.awayScore != null) {
      // We don't have previous totals here without tracking. Skip allocation;
      // we'll fix this via a second pass below.
    }
    acc[q].pts = pts;
  }
  // Second pass — properly diff against running totals from plays themselves.
  const out = {};
  let runHome = 0, runAway = 0;
  for (const p of plays || []) {
    if (p.kind !== "score") continue;
    const q = Math.max(1, Math.min(8, p.quarter || 1));
    out[q] ||= { home: 0, away: 0 };
    const dH = (p.homeScore || 0) - runHome;
    const dA = (p.awayScore || 0) - runAway;
    if (dH > 0) out[q].home += dH;
    if (dA > 0) out[q].away += dA;
    runHome = p.homeScore ?? runHome;
    runAway = p.awayScore ?? runAway;
  }
  // Always emit 4 quarters; pad zeros where the game ended early.
  const maxQ = Math.max(4, ...Object.keys(out).map(Number));
  const arr = [];
  for (let q = 1; q <= maxQ; q++) {
    arr.push({
      periodLabel: q <= 4 ? `Q${q}` : (q === 5 ? "OT" : `OT${q - 4}`),
      away: out[q]?.away || 0,
      home: out[q]?.home || 0,
    });
  }
  return arr;
}

// Best-effort scoring summary from plays[]. We parse description text for
// the scorer name because the sim doesn't currently emit a scorer field.
function deriveScoringSummary(plays, awayTeam, homeTeam) {
  const out = [];
  let runHome = 0, runAway = 0;
  for (const p of plays || []) {
    if (p.kind !== "score") continue;
    const dH = (p.homeScore || 0) - runHome;
    const dA = (p.awayScore || 0) - runAway;
    const teamId = dH > 0 ? homeTeam?.id : dA > 0 ? awayTeam?.id : null;
    runHome = p.homeScore ?? runHome;
    runAway = p.awayScore ?? runAway;
    if (!teamId) continue;
    const secs = p.time || 0;
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    out.push({
      period: p.quarter <= 4 ? `Q${p.quarter}` : "OT",
      time: `${mm}:${ss}`,
      teamId,
      description: p.desc || "",
      scoreText: `${runAway}-${runHome}`,
    });
  }
  return out;
}

/**
 * Convert a sim result into BSPNBoxScoreData.
 *
 * @param {Object} gameResult - shape returned by GameSimulator.simulate()
 * @param {Object} [extras] - optional supplements for fields the sim
 *   doesn't yet emit. Each key, if present, is used verbatim:
 *     - awayRecord, homeRecord       (strings like "8-3 (5-1)")
 *     - comparisonStats               (BSPNComparisonStat[])
 *     - awayBoxScoreGroups            (BSPNStatGroup[])
 *     - homeBoxScoreGroups            (BSPNStatGroup[])
 *     - leaderGroups                  (BSPNLeaderGroup[])
 *     - topPerformers                 (BSPNLeaderGroup)
 *     - gameNotes                     (BSPNGameNote[])
 *     - status                        ("FINAL" by default)
 *     - gameId
 *
 * @returns {import("../types/bspnBoxScore.js").BSPNBoxScoreData}
 */
export function toBSPNBoxScoreData(gameResult, extras) {
  const ex = extras || {};
  const home = gameResult?.homeTeam ? getTeam(gameResult.homeTeam.id) || gameResult.homeTeam : null;
  const away = gameResult?.awayTeam ? getTeam(gameResult.awayTeam.id) || gameResult.awayTeam : null;
  const awayT = toBSPNTeam(away, ex.awayRecord);
  const homeT = toBSPNTeam(home, ex.homeRecord);

  const winner = gameResult?.winner ||
    (gameResult?.homeScore > gameResult?.awayScore ? "home"
      : gameResult?.awayScore > gameResult?.homeScore ? "away" : "tie");

  return {
    summary: {
      gameId: ex.gameId ?? "—",
      status: ex.status || "FINAL",
      awayTeam: awayT,
      homeTeam: homeT,
      awayScore: gameResult?.awayScore || 0,
      homeScore: gameResult?.homeScore || 0,
      quarterScores: deriveQuarterScores(gameResult?.plays),
      winner,
    },
    // TODO: sim doesn't yet aggregate team totals. Callers supply via extras.
    comparisonStats: ex.comparisonStats || [],
    // TODO: sim doesn't yet aggregate per-player stats. Callers supply via extras.
    awayBoxScoreGroups: ex.awayBoxScoreGroups || [],
    homeBoxScoreGroups: ex.homeBoxScoreGroups || [],
    scoringSummary: deriveScoringSummary(gameResult?.plays, awayT, homeT),
    // TODO: sim doesn't yet aggregate leaders. Callers supply via extras.
    leaderGroups: ex.leaderGroups || [],
    topPerformers: ex.topPerformers,
    gameNotes: ex.gameNotes || [],
  };
}
