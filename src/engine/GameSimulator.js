// ─── Play-by-play American football game simulator ────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randf()        { return Math.random(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Box-Muller normal distribution
function normal(mean, sd) {
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(mean + z * sd);
}

// ─── Team rating aggregation ──────────────────────────────────────────────────

function avgOverall(players, n = Infinity) {
  const top = players.slice(0, n);
  return top.length ? top.reduce((s, p) => s + p.overall, 0) / top.length : 50;
}

export function buildTeamRatings(roster) {
  const byPos = {};
  for (const p of roster) {
    if (!byPos[p.position]) byPos[p.position] = [];
    byPos[p.position].push(p);
  }
  for (const pos in byPos) byPos[pos].sort((a, b) => b.overall - a.overall);

  const g = (pos, n) => avgOverall(byPos[pos] || [], n);

  const offense = g("QB",1)*0.30 + g("RB",2)*0.15 + g("WR",4)*0.25 + g("TE",1)*0.10 + g("OL",5)*0.20;
  const defense = g("DL",4)*0.30 + g("LB",3)*0.30 + g("CB",2)*0.25 + g("S",2)*0.15;
  const st      = g("K",1)*0.60  + g("P",1)*0.40;

  return {
    offense, defense, st,
    qb: g("QB",1), rb: g("RB",2), wr: g("WR",4), ol: g("OL",5),
    dl: g("DL",4), lb: g("LB",3), cb: g("CB",2), s:  g("S",2),
    k:  g("K",1),
    starters: {
      qb:  (byPos["QB"]  || [{}])[0]?.name || "QB",
      rb:  (byPos["RB"]  || [{}])[0]?.name || "RB",
      wr1: (byPos["WR"]  || [{}])[0]?.name || "WR1",
      wr2: (byPos["WR"]  || [{},{}])[1]?.name || "WR2",
      k:   (byPos["K"]   || [{}])[0]?.name || "K",
    }
  };
}

// ─── Main simulator class ─────────────────────────────────────────────────────

export class GameSimulator {
  constructor(homeTeam, awayTeam, homeRoster, awayRoster) {
    this.home = homeTeam;
    this.away = awayTeam;
    this.homeR = buildTeamRatings(homeRoster);
    this.awayR = buildTeamRatings(awayRoster);

    this.score    = { home: 0, away: 0 };
    this.quarter  = 1;
    this.time     = 900;  // seconds per quarter
    this.poss     = randf() < 0.5 ? "home" : "away";
    this.yardLine = 25;   // from own goal line
    this.down     = 1;
    this.ytg      = 10;   // yards to go
    this.plays    = [];
    this.drives   = [];
  }

  get offR() { return this.poss === "home" ? this.homeR : this.awayR; }
  get defR() { return this.poss === "home" ? this.awayR : this.homeR; }
  get possTeam() { return this.poss === "home" ? this.home : this.away; }

  _score(pts, type) {
    this.score[this.poss] += pts;
    this._play("score", `${this.possTeam.city} ${this.possTeam.name} — ${type} (${pts} pts)`, 0);
  }

  _play(kind, desc, yards) {
    this.plays.push({
      kind, desc, yards,
      quarter:   this.quarter,
      time:      this.time,
      yardLine:  this.yardLine,
      down:      this.down,
      ytg:       this.ytg,
      homeScore: this.score.home,
      awayScore: this.score.away,
    });
  }

  _simulatePlay() {
    const adv = (this.offR.offense - this.defR.defense) / 100;

    // Time consumed per play
    this.time -= clamp(normal(33, 9), 12, 55);

    // 4th-down decisions
    if (this.down === 4) {
      const toEZ  = 100 - this.yardLine;
      const dist  = toEZ + 17;

      if (toEZ <= 52 && this.ytg <= 5) {
        // Field goal attempt
        const fgPct = clamp(0.95 - (dist - 20) * 0.018 + (this.offR.k - 60) / 250, 0.20, 0.97);
        if (randf() < fgPct) {
          this._score(3, `${dist}-yd Field Goal`);
          this._play("fg_good", `${this.offR.starters.k} splits the uprights from ${dist} yards!`, 0);
        } else {
          this._play("fg_miss", `${this.offR.starters.k} misses from ${dist} yards — no good!`, 0);
        }
        return { turnover: false, endDrive: true };
      }

      // Punt
      const puntDist = clamp(normal(46, 7), 28, 68);
      this._play("punt", `${this.possTeam.name} punts ${puntDist} yards`, 0);
      return { turnover: false, endDrive: true, punt: puntDist };
    }

    // Play call
    const isLong = this.ytg >= 8;
    const isShort = this.ytg <= 2;
    const passProb = isLong ? 0.72 : isShort ? 0.42 : 0.58;
    const playType = randf() < passProb ? "pass" : "run";

    if (playType === "pass") {
      // Interception
      const intPct = clamp(0.022 - adv * 0.010 + (this.defR.cb - 60) / 1200, 0.005, 0.06);
      if (randf() < intPct) {
        this._play("int", `INTERCEPTION! ${this.offR.starters.qb} picked off`, 0);
        return { turnover: true };
      }

      // Sack
      const sackPct = clamp(0.06 + (this.defR.dl - 60) / 500 - adv * 0.03, 0.02, 0.12);
      if (randf() < sackPct) {
        const loss = rand(3, 11);
        this._play("sack", `${this.offR.starters.qb} sacked for -${loss}`, -loss);
        this.yardLine = clamp(this.yardLine - loss, 1, 99);
        this.down++;
        this.ytg += loss;
        return { turnover: false };
      }

      // Completion
      const compPct = clamp(0.60 + adv * 0.14 + (this.offR.qb - 60) / 300, 0.34, 0.82);
      if (randf() < compPct) {
        const yards = clamp(normal(8.5 + adv * 3, 12), -2, 70);
        const rcvr  = randf() < 0.55 ? this.offR.starters.wr1 : this.offR.starters.wr2;
        this._play("complete", `${this.offR.starters.qb} → ${rcvr} for ${yards} yards`, yards);
        return { turnover: false, yards };
      }

      // Incomplete
      this._play("incomplete", `${this.offR.starters.qb} — incomplete pass`, 0);
      return { turnover: false, yards: 0, incomplete: true };
    }

    // Run
    const fumblePct = clamp(0.012 - adv * 0.005, 0.003, 0.025);
    if (randf() < fumblePct) {
      this._play("fumble", `FUMBLE recovered by defense!`, 0);
      return { turnover: true };
    }
    const yards = clamp(normal(4.3 + adv * 1.8, 5.5), -4, 50);
    this._play("run", `${this.offR.starters.rb} runs for ${yards} yards`, yards);
    return { turnover: false, yards };
  }

  _runDrive() {
    const startYL = this.yardLine;
    const possOwner = this.poss;
    let plays = 0;

    while (this.time > 0 && plays < 22) {
      plays++;
      const result = this._simulatePlay();

      if (result.endDrive) {
        // After FG or punt, flip possession
        if (result.punt) {
          const newYL = clamp(100 - (this.yardLine + result.punt), 10, 95);
          this.poss     = this.poss === "home" ? "away" : "home";
          this.yardLine = newYL;
        } else {
          // FG — flip from current field position
          this.poss     = this.poss === "home" ? "away" : "home";
          this.yardLine = clamp(100 - this.yardLine, 10, 90);
        }
        this.down = 1; this.ytg = 10;
        break;
      }

      if (result.turnover) {
        this.poss     = this.poss === "home" ? "away" : "home";
        this.yardLine = clamp(100 - this.yardLine, 5, 95);
        this.down = 1; this.ytg = 10;
        break;
      }

      const yards = result.yards || 0;

      if (!result.incomplete) {
        this.yardLine = clamp(this.yardLine + yards, 0, 100);
      }

      // Touchdown
      if (this.yardLine >= 100) {
        this._score(6, "Touchdown!");
        // PAT or 2-pt
        if (randf() < 0.92) {
          if (randf() < 0.936) this._score(1, "Extra Point");
        } else {
          if (randf() < 0.48)  this._score(2, "2-Point Conversion");
        }
        this.drives.push({
          team: possOwner, result: "TD",
          homeScore: this.score.home, awayScore: this.score.away
        });
        this.poss     = this.poss === "home" ? "away" : "home";
        this.yardLine = 25;
        this.down = 1; this.ytg = 10;
        return;
      }

      // Down and distance update
      if (result.incomplete) {
        this.down++;
      } else if (yards >= this.ytg) {
        this.down = 1;
        this.ytg  = 10;
      } else {
        this.down++;
        this.ytg -= yards;
      }
    }

    this.drives.push({
      team: possOwner, result: "Punt/Turnover/FG",
      homeScore: this.score.home, awayScore: this.score.away
    });
  }

  simulate() {
    // Kickoff
    this.plays.push({ kind: "kickoff", desc: `${this.away.city} ${this.away.name} kicks off to open the game`, quarter: 1, time: 900, homeScore: 0, awayScore: 0 });

    while (this.quarter <= 4) {
      if (this.time <= 0) {
        if (this.quarter === 2) {
          this.plays.push({ kind: "halftime", desc: "=== HALFTIME ===", quarter: 2, time: 0, homeScore: this.score.home, awayScore: this.score.away });
          this.poss = this.poss === "home" ? "away" : "home"; // Flip for second half
          this.yardLine = 25;
          this.down = 1; this.ytg = 10;
        }
        this.quarter++;
        this.time = 900;
        if (this.quarter <= 4) {
          this.plays.push({ kind: "quarter", desc: `--- Start of Q${this.quarter} ---`, quarter: this.quarter, time: 900, homeScore: this.score.home, awayScore: this.score.away });
        }
        continue;
      }
      this._runDrive();
    }

    // Overtime if tied
    if (this.score.home === this.score.away) {
      this.plays.push({ kind: "ot", desc: "=== OVERTIME! ===", quarter: 5, time: 600, homeScore: this.score.home, awayScore: this.score.away });
      this.quarter = 5;
      this.time    = 600;
      this.poss    = randf() < 0.5 ? "home" : "away";
      let otPlays  = 0;
      while (this.score.home === this.score.away && otPlays < 8) {
        this._runDrive();
        otPlays++;
      }
      // Force result if still tied
      if (this.score.home === this.score.away) {
        if (randf() < 0.5) this.score.home += 3;
        else                this.score.away += 3;
      }
    }

    const winner = this.score.home > this.score.away ? "home"
                 : this.score.away > this.score.home ? "away"
                 : "tie";

    return {
      homeTeam:    this.home,
      awayTeam:    this.away,
      homeScore:   this.score.home,
      awayScore:   this.score.away,
      homeRatings: this.homeR,
      awayRatings: this.awayR,
      winner,
      plays:       this.plays,
      drives:      this.drives,
    };
  }
}
