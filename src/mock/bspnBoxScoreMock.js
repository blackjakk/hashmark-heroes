// Neutral BSPN box-score fixture for the proof-of-concept route.
//
// IMPORTANT: must NOT hardcode any team city, mascot, or player name from
// the reference image (no Chicago/Miami/Blaze/Waves/Flame/Knoxx etc).
// All teams come from src/data/teams.js (deterministic shuffle by seed)
// and all player names come from PlayerGenerator.randomName().

import TEAMS from "../data/teams.js";
import { randomName } from "../engine/PlayerGenerator.js";

// Tiny deterministic RNG so the mock is stable across hot-reloads if a
// seed is provided. Without a seed, falls back to Math.random.
function makeRng(seed) {
  if (seed == null) return Math.random;
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function abbrFromTeam(t) {
  // First letter of city + first two of mascot; falls back to 3 from name.
  const c = (t.city || "").trim();
  const n = (t.name || "").trim();
  if (c && n) return (c[0] + n.slice(0, 2)).toUpperCase();
  return (n || "TBD").slice(0, 3).toUpperCase();
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function toBSPNTeam(t) {
  return {
    id: t.id,
    name: t.name,
    abbreviation: abbrFromTeam(t),
    city: t.city,
    record: null,                  // mock leaves blank — adapter or caller fills
    primaryColor: t.primary,
    secondaryColor: t.secondary,
    asciiMark: null,
  };
}

function buildQuarterScores(awayTotal, homeTotal, rng) {
  // Distribute totals across Q1-Q4 in 0,3,7,8-ish chunks.
  const dist = total => {
    const out = [0, 0, 0, 0];
    let left = total;
    for (let i = 0; i < 4 && left > 0; i++) {
      const take = pick([0, 0, 3, 7, 7, 10, 14], rng);
      out[i] = Math.min(take, left);
      left -= out[i];
    }
    if (left > 0) out[3] += left;
    return out;
  };
  const a = dist(awayTotal);
  const h = dist(homeTotal);
  return [0, 1, 2, 3].map(i => ({ periodLabel: `Q${i + 1}`, away: a[i], home: h[i] }));
}

function buildComparisonStats(rng) {
  // Generic stat row defaults. Real adapter will replace.
  const r = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const aFD = r(12, 26), hFD = r(12, 26);
  const aTY = r(220, 450), hTY = r(220, 450);
  const aPY = r(140, 320), hPY = r(140, 320);
  const aRY = aTY - aPY, hRY = hTY - hPY;
  const aTO = r(0, 3), hTO = r(0, 3);
  const aSK = r(0, 5), hSK = r(0, 5);
  const aPen = r(20, 90), hPen = r(20, 90);
  const top = r(1500, 2100), bot = 3600 - top;
  return [
    { key: "first_downs",   label: "FIRST DOWNS",   awayValue: aFD,  homeValue: hFD },
    { key: "total_yards",   label: "TOTAL YARDS",   awayValue: aTY,  homeValue: hTY },
    { key: "passing_yards", label: "PASSING YARDS", awayValue: aPY,  homeValue: hPY },
    { key: "rushing_yards", label: "RUSHING YARDS", awayValue: aRY,  homeValue: hRY },
    { key: "turnovers",     label: "TURNOVERS",     awayValue: aTO,  homeValue: hTO },
    { key: "sacks",         label: "SACKS",         awayValue: aSK,  homeValue: hSK },
    { key: "penalties",     label: "PENALTIES (YDS)", awayValue: aPen, homeValue: hPen },
    {
      key: "top", label: "TIME OF POSSESSION", format: "time",
      awayValue: `${Math.floor(top / 60)}:${String(top % 60).padStart(2, "0")}`,
      homeValue: `${Math.floor(bot / 60)}:${String(bot % 60).padStart(2, "0")}`,
      awayBarValue: top, homeBarValue: bot,
    },
  ];
}

function buildStatGroups(rng) {
  const r = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const playerId = () => randomName();
  const passingRows = Array.from({ length: 1 }, (_, i) => {
    const att = r(20, 38), comp = Math.max(8, Math.floor(att * (0.55 + rng() * 0.25)));
    const yds = comp * (rng() * 7 + 6) | 0;
    const td = r(0, 4), int_ = r(0, 2);
    const rtg = ((comp / att) * 100 + (yds / att) + td * 4 - int_ * 5).toFixed(1);
    return { id: `p${i}`, cells: { player: playerId(), cmp: comp, att, yds, td, int: int_, rtg } };
  });
  const mkRb = (i) => {
    const a = r(4, 22), y = a * (rng() * 5 + 3) | 0;
    return { id: `rb${i}`, cells: { player: playerId(), att: a, yds: y, avg: (y / a).toFixed(1), td: r(0, 2), lng: r(8, 45) } };
  };
  const mkWr = (i) => {
    const rec = r(1, 10), y = rec * (rng() * 11 + 6) | 0;
    return { id: `wr${i}`, cells: { player: playerId(), rec, yds: y, avg: (y / rec).toFixed(1), td: r(0, 2), lng: r(8, 50) } };
  };
  const mkDef = (i) => ({
    id: `d${i}`,
    cells: { player: playerId(), tkl: r(2, 9), ast: r(0, 4), tfl: r(0, 3), sack: (rng() * 2).toFixed(1), int: r(0, 1), ff: r(0, 1), fr: r(0, 1) },
  });
  const mkKicker = (i) => {
    const fga = r(1, 4), fgm = r(0, fga);
    const xpa = r(0, 5), xpm = Math.max(0, xpa - r(0, 1));
    return { id: `k${i}`, cells: { player: playerId(), fgm_fga: `${fgm}-${fga}`, lng: r(20, 55), xp: `${xpm}-${xpa}`, pts: fgm * 3 + xpm } };
  };
  return [
    {
      title: "PASSING",
      columns: [
        { key: "player", label: "" },
        { key: "cmp", label: "CMP", align: "right" }, { key: "att", label: "ATT", align: "right" },
        { key: "yds", label: "YDS", align: "right" }, { key: "td", label: "TD", align: "right" },
        { key: "int", label: "INT", align: "right" }, { key: "rtg", label: "RTG", align: "right" },
      ],
      rows: passingRows,
    },
    {
      title: "RUSHING",
      columns: [
        { key: "player", label: "" },
        { key: "att", label: "ATT", align: "right" }, { key: "yds", label: "YDS", align: "right" },
        { key: "avg", label: "AVG", align: "right" }, { key: "td", label: "TD", align: "right" },
        { key: "lng", label: "LNG", align: "right" },
      ],
      rows: [mkRb(0), mkRb(1), mkRb(2)],
    },
    {
      title: "RECEIVING",
      columns: [
        { key: "player", label: "" },
        { key: "rec", label: "REC", align: "right" }, { key: "yds", label: "YDS", align: "right" },
        { key: "avg", label: "AVG", align: "right" }, { key: "td", label: "TD", align: "right" },
        { key: "lng", label: "LNG", align: "right" },
      ],
      rows: [mkWr(0), mkWr(1), mkWr(2), mkWr(3)],
    },
    {
      title: "DEFENSE",
      columns: [
        { key: "player", label: "" },
        { key: "tkl", label: "TKL", align: "right" }, { key: "ast", label: "AST", align: "right" },
        { key: "tfl", label: "TFL", align: "right" }, { key: "sack", label: "SACK", align: "right" },
        { key: "int", label: "INT", align: "right" }, { key: "ff", label: "FF", align: "right" },
        { key: "fr", label: "FR", align: "right" },
      ],
      rows: [mkDef(0), mkDef(1), mkDef(2)],
    },
    {
      title: "KICKING",
      columns: [
        { key: "player", label: "" },
        { key: "fgm_fga", label: "FGM-FGA", align: "right" },
        { key: "lng", label: "LONG", align: "right" },
        { key: "xp", label: "XP", align: "right" },
        { key: "pts", label: "PTS", align: "right" },
      ],
      rows: [mkKicker(0)],
    },
  ];
}

function buildScoringSummary(awayTeam, homeTeam, quarterScores, rng) {
  const plays = [];
  let aScore = 0, hScore = 0;
  quarterScores.forEach((q, qi) => {
    const events = [];
    if (q.away > 0) events.push({ side: "away", pts: q.away });
    if (q.home > 0) events.push({ side: "home", pts: q.home });
    events.forEach(ev => {
      if (ev.side === "away") aScore += ev.pts; else hScore += ev.pts;
      const t = ev.side === "away" ? awayTeam : homeTeam;
      const isFG = ev.pts === 3;
      const isTD = ev.pts >= 6;
      const name = randomName();
      const desc = isFG
        ? `${name} ${20 + Math.floor(rng() * 35)} yd field goal`
        : isTD
          ? `${name} ${1 + Math.floor(rng() * 35)} yd ${rng() < 0.5 ? "rush" : "pass"} (${randomName()} kick)`
          : `${name} safety`;
      plays.push({
        period: `Q${qi + 1}`,
        time: `${String(Math.floor(rng() * 14)).padStart(2, "0")}:${String(Math.floor(rng() * 59)).padStart(2, "0")}`,
        teamId: t.id,
        description: desc,
        scoreText: `${aScore}-${hScore}`,
      });
    });
  });
  return plays;
}

function buildLeaderGroups(awayTeam, homeTeam, rng) {
  const mk = (label, team) => ({
    playerName: randomName(),
    teamId: team.id,
    label,
    jersey: String(10 + Math.floor(rng() * 80)),
    statLine: pick([
      `${100 + Math.floor(rng() * 200)} YDS, ${Math.floor(rng() * 3)} TD`,
      `${5 + Math.floor(rng() * 12)} REC, ${50 + Math.floor(rng() * 100)} YDS`,
      `${4 + Math.floor(rng() * 9)} TKL, ${Math.floor(rng() * 3)} SACKS`,
    ], rng),
  });
  return [
    { title: "OFFENSIVE LEADERS", rows: [
      mk("PASSING",  rng() < 0.5 ? awayTeam : homeTeam),
      mk("RUSHING",  rng() < 0.5 ? awayTeam : homeTeam),
      mk("RECEIVING", rng() < 0.5 ? awayTeam : homeTeam),
      mk("DEFENSE",  rng() < 0.5 ? awayTeam : homeTeam),
    ]},
  ];
}

function buildTopPerformers(awayTeam, homeTeam, rng) {
  const rows = Array.from({ length: 4 }, () => {
    const team = rng() < 0.5 ? awayTeam : homeTeam;
    const pts = (rng() * 25 + 8).toFixed(1);
    return {
      playerName: randomName(),
      teamId: team.id,
      label: "",
      jersey: String(10 + Math.floor(rng() * 80)),
      statLine: `${pts} FPTS`,
      value: parseFloat(pts),
    };
  }).sort((a, b) => b.value - a.value);
  return { title: "GAME LEADERS · TOP PERFORMERS", rows };
}

function buildGameNotes(rng) {
  // Neutral observations. No specific player or team text.
  const candidates = [
    "Streak extended in division play.",
    "Crossed milestone in passing yards this season.",
    "First multi-sack game of the year.",
    "Improves home record above .500.",
    `Attendance: ${(50000 + Math.floor(rng() * 25000)).toLocaleString()}`,
    `Weather: ${50 + Math.floor(rng() * 30)}°F, ${pick(["Clear", "Overcast", "Light Rain", "Windy"], rng)}`,
    "Next Game: TBD",
  ];
  // Pick 4-5 notes deterministically from the seed
  return candidates.slice(0, 5 + Math.floor(rng() * 2))
    .map((t, i) => ({ id: `n${i}`, text: t }));
}

/**
 * Build a self-contained BSPNBoxScoreData fixture.
 *
 * @param {number} [seed] - optional deterministic seed
 * @returns {import("../types/bspnBoxScore.js").BSPNBoxScoreData}
 */
export function buildMockBoxScore(seed) {
  const rng = makeRng(seed);
  // Pick two distinct random teams from the TEAMS table — never hardcoded.
  const a = Math.floor(rng() * TEAMS.length);
  let b = Math.floor(rng() * TEAMS.length);
  if (b === a) b = (b + 1) % TEAMS.length;
  const awayT = toBSPNTeam(TEAMS[a]);
  const homeT = toBSPNTeam(TEAMS[b]);

  const awayScore = Math.floor(rng() * 35) + 7;
  const homeScore = Math.floor(rng() * 35) + 7;
  const quarterScores = buildQuarterScores(awayScore, homeScore, rng);

  // Synthesize records (visible in summary strip but neutral)
  const recWL = () => `${1 + Math.floor(rng() * 10)}-${1 + Math.floor(rng() * 6)}`;
  awayT.record = recWL();
  homeT.record = recWL();

  return {
    summary: {
      gameId: `mock-${seed ?? "rand"}`,
      status: "FINAL",
      awayTeam: awayT,
      homeTeam: homeT,
      awayScore,
      homeScore,
      quarterScores,
      winner: awayScore > homeScore ? "away" : awayScore < homeScore ? "home" : "tie",
    },
    comparisonStats: buildComparisonStats(rng),
    awayBoxScoreGroups: buildStatGroups(rng),
    homeBoxScoreGroups: buildStatGroups(rng),
    scoringSummary: buildScoringSummary(awayT, homeT, quarterScores, rng),
    leaderGroups: buildLeaderGroups(awayT, homeT, rng),
    topPerformers: buildTopPerformers(awayT, homeT, rng),
    gameNotes: buildGameNotes(rng),
  };
}
