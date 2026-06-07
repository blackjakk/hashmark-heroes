// ─── Generate a 17-week regular season schedule ────────────────────────────────

import TEAMS from "../data/teams.js";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeGame(homeId, awayId, week, id) {
  return { id, homeTeamId: homeId, awayTeamId: awayId, week, played: false, homeScore: 0, awayScore: 0 };
}

export function generateSchedule(season = 1) {
  let gid = 0;
  const games = [];

  const afc = TEAMS.filter(t => t.conference === "AFC");
  const nfc = TEAMS.filter(t => t.conference === "NFC");

  const divs = (conf) => ({
    East:  conf.filter(t => t.division === "East"),
    North: conf.filter(t => t.division === "North"),
    South: conf.filter(t => t.division === "South"),
    West:  conf.filter(t => t.division === "West"),
  });

  const afcDivs = divs(afc);
  const nfcDivs = divs(nfc);

  // Randomise week assignment within the 17-week window (weeks 1-17)
  const wk = () => Math.floor(Math.random() * 17) + 1;

  // ── In-division: 2× per opponent (home+away) = 6 games per team ───────────
  const addDivGames = (teams) => {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        games.push(makeGame(teams[i].id, teams[j].id, wk(), gid++));
        games.push(makeGame(teams[j].id, teams[i].id, wk(), gid++));
      }
    }
  };

  [...Object.values(afcDivs), ...Object.values(nfcDivs)].forEach(addDivGames);

  // ── Intra-conference cross-division (simplified: one game vs each team in one other division) ──
  const addCrossDivGames = (confDivs) => {
    const divKeys = Object.keys(confDivs);
    // Rotate division matchups each season
    const offset = (season - 1) % 3;
    for (let i = 0; i < divKeys.length; i++) {
      const j = (i + 1 + offset) % divKeys.length;
      const dA = confDivs[divKeys[i]];
      const dB = confDivs[divKeys[j]];
      const sB = shuffle(dB);
      for (let k = 0; k < dA.length; k++) {
        games.push(makeGame(dA[k].id, sB[k].id, wk(), gid++));
      }
    }
  };

  addCrossDivGames(afcDivs);
  addCrossDivGames(nfcDivs);

  // ── Inter-conference: 4 games per team ─────────────────────────────────────
  const sAfc = shuffle(afc);
  const sNfc = shuffle(nfc);
  for (let i = 0; i < 16; i++) {
    games.push(makeGame(sAfc[i].id, sNfc[i].id, wk(), gid++));
  }

  return games.sort((a, b) => a.week - b.week);
}

// ─── Generate playoff bracket from standings ───────────────────────────────────

export function buildPlayoffSeeds(standings) {
  // standings: array of { teamId, conference, division, wins, losses, ties, pointsFor, pointsAgainst }
  const pct = r => (r.wins + r.ties * 0.5) / Math.max(1, r.wins + r.losses + r.ties);

  const byConf = (conf) => {
    const teams = standings.filter(t => t.conference === conf).sort((a, b) => pct(b) - pct(a));
    // Seeds 1-4 = division winners (best 4 division winners by record), 5-7 = best wildcards
    const divWinners   = [];
    const seen         = new Set();
    const allDivs      = ["East","North","South","West"];

    for (const div of allDivs) {
      const winner = teams.find(t => t.division === div && !seen.has(t.teamId));
      if (winner) { divWinners.push(winner); seen.add(winner.teamId); }
    }

    const wildcards = teams.filter(t => !seen.has(t.teamId)).slice(0, 3);
    return [...divWinners, ...wildcards].slice(0, 7).map(t => t.teamId);
  };

  return { afc: byConf("AFC"), nfc: byConf("NFC") };
}
