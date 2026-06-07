// ─── NFL realism benchmarks ───────────────────────────────────────────────
// The targets we've calibrated the engine against (sources are the engine's
// own calibration comments — see play-engine.js lines noted). `lo`/`hi` is the
// pass band; a value inside it is ✓, outside is ⚠. `per` is how the metric is
// computed from the per-team-per-game aggregate. Used by _benchmarkPanel to
// auto-flag a long sim instead of eyeballing the averages table.
const SIM_BENCHMARKS = [
  // label, target text, lo, hi, fn(teamAvg) → value, fmt
  { label: "Points / game",      target: "~22",        lo: 17,  hi: 27,  fn: (g) => g.pts,                         fmt: (v) => v.toFixed(1) },
  { label: "Total yds / game",   target: "~330",       lo: 290, hi: 380, fn: (g) => g.totalYds,                    fmt: (v) => v.toFixed(0) },
  { label: "Pass yds / game",    target: "~225",       lo: 190, hi: 270, fn: (g) => g.passYds,                     fmt: (v) => v.toFixed(0) },
  { label: "Rush yds / game",    target: "~115",       lo: 90,  hi: 145, fn: (g) => g.rushYds,                     fmt: (v) => v.toFixed(0) },
  { label: "Completion %",       target: "~63%",       lo: 58,  hi: 69,  fn: (g) => g.pass_att ? g.pass_comp / g.pass_att * 100 : 0, fmt: (v) => v.toFixed(1) + "%" },
  { label: "Yards / carry",      target: "~4.4",       lo: 3.9, hi: 4.9,  fn: (g) => g.rush_att ? g.rushYdsRaw / g.rush_att : 0,     fmt: (v) => v.toFixed(2) },
  { label: "INT rate / att",     target: "~2.5%",      lo: 1.8, hi: 3.4,  fn: (g) => g.pass_att ? g.turnoverInt / g.pass_att * 100 : 0, fmt: (v) => v.toFixed(2) + "%" },
  { label: "Sacks / game",       target: "~2.4",       lo: 1.6, hi: 3.3,  fn: (g) => g.sacks,                       fmt: (v) => v.toFixed(2) },
  { label: "Turnovers / game",   target: "~1.4",       lo: 0.9, hi: 2.1,  fn: (g) => g.turnovers,                   fmt: (v) => v.toFixed(2) },
  { label: "First downs / game", target: "~20",        lo: 16,  hi: 24,  fn: (g) => g.firstDowns,                  fmt: (v) => v.toFixed(1) },
  { label: "Penalties / game",   target: "~6 / team",  lo: 4,   hi: 8,   fn: (g) => g.penalties,                   fmt: (v) => v.toFixed(2) },
  { label: "Penalty yds / game", target: "~50 / team", lo: 35,  hi: 70,  fn: (g) => g.penaltyYds,                  fmt: (v) => v.toFixed(0) },
];

// Build the benchmark panel HTML — averages BOTH teams together (the league
// rate is per-team), compares to the band, and renders a ✓ / ⚠ per metric.
function _benchmarkPanelHTML(agg) {
  // Per-team-per-game aggregate (home + away pooled, divided by 2n team-games).
  const tg = 2 * agg.n;
  const h = agg.teamSums.home, a = agg.teamSums.away;
  const g = {
    pts:        (agg.homeScoreSum + agg.awayScoreSum) / tg,
    totalYds:   (h.totalYds + a.totalYds) / tg,
    passYds:    (h.passYds + a.passYds) / tg,
    rushYds:    (h.rushYds + a.rushYds) / tg,
    firstDowns: (h.firstDowns + a.firstDowns) / tg,
    sacks:      (h.sacks + a.sacks) / tg,
    turnovers:  (h.turnovers + a.turnovers) / tg,
    penalties:  (h.penalties + a.penalties) / tg,
    penaltyYds: (h.penaltyYds + a.penaltyYds) / tg,
    // Rates need pooled RAW numerators/denominators (NOT per-game values).
    // YPC = total rush yds / total carries; comp% = total comp / total att;
    // INT rate = total picks / total att. Using the per-game rushYds above
    // for the YPC numerator made it ~0 (off by the games factor) — so keep a
    // raw pooled rush-yards total here just for the ratio.
    rushYdsRaw: h.rushYds + a.rushYds,
    pass_comp:  h.pass_comp + a.pass_comp,
    pass_att:   h.pass_att + a.pass_att,
    rush_att:   h.rush_att + a.rush_att,
    // INT thrown — pooled count of EVERY passer's picks (accumulated in
    // runManyGames), so INT-rate = picks / attempts is exact, not a top-QB
    // proxy.
    turnoverInt: (h.intThrown + a.intThrown),
  };
  let nOk = 0;
  const rows = SIM_BENCHMARKS.map(b => {
    const v = b.fn(g);
    const ok = v >= b.lo && v <= b.hi;
    if (ok) nOk++;
    const flag = ok ? "✓" : "⚠";
    const col  = ok ? "#5fd07a" : "#f0b03a";
    return `<tr>
      <td class="lbl" style="text-align:left">${b.label}</td>
      <td style="color:var(--white);text-align:right">${b.fmt(v)}</td>
      <td style="color:var(--gray);text-align:right">${b.target}</td>
      <td style="color:${col};text-align:center;font-weight:700">${flag}</td>
    </tr>`;
  }).join("");
  const allOk = nOk === SIM_BENCHMARKS.length;
  return `
    <div class="sm-section">
      <h4>NFL realism check — ${nOk}/${SIM_BENCHMARKS.length} in range ${allOk ? "✓" : "⚠"}</h4>
      <div style="font-size:.72rem;color:var(--gray);margin-bottom:6px">
        Per team per game, pooled across both sides. ⚠ = outside the NFL band — worth a look.
      </div>
      <table class="sm-stats-table">
        <tr style="font-size:.7rem;color:var(--gray)">
          <td style="text-align:left">METRIC</td><td style="text-align:right">SIM</td><td style="text-align:right">NFL</td><td style="text-align:center"></td>
        </tr>
        ${rows}
      </table>
    </div>`;
}

// ─── Sim Many — run N games and aggregate ─────────────────────────────────
function runManyGames(home, away, hRoster, aRoster, n) {
  const agg = {
    n,
    homeWins: 0, awayWins: 0, ties: 0,
    homeScoreSum: 0, awayScoreSum: 0,
    homeScoreMax: 0, awayScoreMax: 0,
    biggestBlowout: { margin: 0, home: 0, away: 0 },
    closestGame: { margin: 999, home: 0, away: 0 },
    teamSums: {
      home: { totalYds: 0, passYds: 0, rushYds: 0, sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0, firstDowns: 0, pass_comp: 0, pass_att: 0, rush_att: 0, penalties: 0, penaltyYds: 0, intThrown: 0 },
      away: { totalYds: 0, passYds: 0, rushYds: 0, sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0, firstDowns: 0, pass_comp: 0, pass_att: 0, rush_att: 0, penalties: 0, penaltyYds: 0, intThrown: 0 },
    },
    qbSums: { home: { passYds: 0, passTD: 0, int: 0, rushYds: 0, rushTD: 0, sacksTaken: 0 },
              away: { passYds: 0, passTD: 0, int: 0, rushYds: 0, rushTD: 0, sacksTaken: 0 } },
    rbSums: { home: { yds: 0, td: 0 }, away: { yds: 0, td: 0 } },
    wrSums: { home: { yds: 0, td: 0 }, away: { yds: 0, td: 0 } },
    // Top defensive performers per game (best sacker, best INT-getter, best tackler)
    topSackerSums:  { home: { sk: 0 }, away: { sk: 0 } },
    topIntSums:     { home: { ints: 0 }, away: { ints: 0 } },
    topTacklerSums: { home: { tkl: 0 }, away: { tkl: 0 } },
  };
  for (let i = 0; i < n; i++) {
    const sim = new GameSimulator(home, away, hRoster, aRoster);
    const r = sim.simulate();
    const hs = r.homeScore, as = r.awayScore;
    if (hs > as) agg.homeWins++;
    else if (as > hs) agg.awayWins++;
    else agg.ties++;
    agg.homeScoreSum += hs;
    agg.awayScoreSum += as;
    if (hs > agg.homeScoreMax) agg.homeScoreMax = hs;
    if (as > agg.awayScoreMax) agg.awayScoreMax = as;
    const margin = Math.abs(hs - as);
    if (margin > agg.biggestBlowout.margin) {
      agg.biggestBlowout = { margin, home: hs, away: as };
    }
    if (margin < agg.closestGame.margin) {
      agg.closestGame = { margin, home: hs, away: as };
    }
    for (const side of ["home", "away"]) {
      const t = r.stats[side].team;
      const s = agg.teamSums[side];
      s.totalYds += t.totalYds; s.passYds += t.passYds; s.rushYds += t.rushYds;
      s.sacks += t.sacks; s.sacks_allowed += t.sacks_allowed;
      s.turnovers += t.turnovers; s.takeaways += t.takeaways;
      s.firstDowns += t.firstDowns;
      s.pass_comp += t.pass_comp; s.pass_att += t.pass_att; s.rush_att += t.rush_att;
      s.penalties += (t.penalties || 0); s.penaltyYds += (t.penaltyYds || 0);
      // League INT thrown — sum EVERY passer's picks (team has no pass_int
      // field), so the INT-rate benchmark reflects all interceptions, not
      // just the top QB's.
      for (const p of Object.values(r.stats[side].players)) {
        s.intThrown += (p.pass_int || 0);
      }
      // Top-line player aggregates (top QB / RB / WR by yds)
      const players = Object.values(r.stats[side].players);
      const topQB = players.filter(p => p.pos === "QB").sort((a, b) => b.pass_yds - a.pass_yds)[0];
      const topRB = players.filter(p => p.rush_att > 0).sort((a, b) => b.rush_yds - a.rush_yds)[0];
      const topWR = players.filter(p => p.rec_tgt > 0).sort((a, b) => b.rec_yds - a.rec_yds)[0];
      if (topQB) {
        agg.qbSums[side].passYds    += topQB.pass_yds;
        agg.qbSums[side].passTD     += topQB.pass_td;
        agg.qbSums[side].int        += topQB.pass_int;
        agg.qbSums[side].rushYds    += topQB.rush_yds   || 0;
        agg.qbSums[side].rushTD     += topQB.rush_td    || 0;
        agg.qbSums[side].sacksTaken += topQB.sacks_taken || 0;
      }
      if (topRB) { agg.rbSums[side].yds += topRB.rush_yds; agg.rbSums[side].td += topRB.rush_td; }
      if (topWR) { agg.wrSums[side].yds += topWR.rec_yds; agg.wrSums[side].td += topWR.rec_td; }
      // Top defensive performers — pick the BEST in each category for this game
      const defPlayers = players.filter(p => ["DE","DT","LB","CB","FS","SS"].includes(p.pos));
      const topSk  = defPlayers.sort((a, b) => (b.sk || 0) - (a.sk || 0))[0];
      const topInt = defPlayers.sort((a, b) => (b.int_made || 0) - (a.int_made || 0))[0];
      const topTkl = defPlayers.sort((a, b) => (b.tkl || 0) - (a.tkl || 0))[0];
      if (topSk)  agg.topSackerSums[side].sk    += topSk.sk        || 0;
      if (topInt) agg.topIntSums[side].ints     += topInt.int_made || 0;
      if (topTkl) agg.topTacklerSums[side].tkl  += topTkl.tkl      || 0;
    }
  }
  return agg;
}

// Compute the key matchup drivers from ratings + sim results.
// Returns up to 4 ordered insights: which side won the trenches, coverage, QB, etc.
function computeKeyDrivers(agg, home, away, hRoster, aRoster) {
  const hR = buildRatings(hRoster), aR = buildRatings(aRoster);
  const drivers = [];

  // Trench (pass-rush): DL vs OL
  const homePassRush = hR.dl - aR.ol;  // home DL vs away OL
  const awayPassRush = aR.dl - hR.ol;  // away DL vs home OL
  const passRushEdge = homePassRush - awayPassRush;
  if (Math.abs(passRushEdge) >= 4) {
    const winner = passRushEdge > 0 ? home : away;
    const loser  = passRushEdge > 0 ? away : home;
    drivers.push({
      mag: Math.abs(passRushEdge),
      icon: "💪",
      text: `<b>${winner.name}</b> wins the trenches — DL ${(passRushEdge > 0 ? hR.dl : aR.dl).toFixed(0)} vs ${loser.name} OL ${(passRushEdge > 0 ? aR.ol : hR.ol).toFixed(0)}. Drives sacks + pressure throughout the game.`
    });
  }

  // QB advantage
  const qbEdge = hR.qb - aR.qb;
  if (Math.abs(qbEdge) >= 6) {
    const winner = qbEdge > 0 ? home : away;
    drivers.push({
      mag: Math.abs(qbEdge),
      icon: "🎯",
      text: `<b>${winner.name}</b> has the QB edge (${hR.qb.toFixed(0)} vs ${aR.qb.toFixed(0)}). Higher comp%, fewer INTs, deeper average throws.`
    });
  }

  // Coverage: WR vs CB+S
  const homeCoverageVsAwayWR = (hR.cb + hR.saf) / 2 - aR.wr;  // home D vs away WRs
  const awayCoverageVsHomeWR = (aR.cb + aR.saf) / 2 - hR.wr;  // away D vs home WRs
  if (Math.abs(homeCoverageVsAwayWR) >= 6) {
    const winner = homeCoverageVsAwayWR > 0 ? home : away;
    drivers.push({
      mag: Math.abs(homeCoverageVsAwayWR),
      icon: "🛡️",
      text: `<b>${winner.name}</b> coverage outclasses ${homeCoverageVsAwayWR > 0 ? away.name : home.name} receivers (${homeCoverageVsAwayWR > 0 ? `${hR.cb.toFixed(0)}/${hR.saf.toFixed(0)} CB/S vs ${aR.wr.toFixed(0)} WR` : `${aR.cb.toFixed(0)}/${aR.saf.toFixed(0)} CB/S vs ${hR.wr.toFixed(0)} WR`}).`
    });
  }
  if (Math.abs(awayCoverageVsHomeWR) >= 6 && Math.sign(awayCoverageVsHomeWR) !== Math.sign(homeCoverageVsAwayWR)) {
    const winner = awayCoverageVsHomeWR > 0 ? away : home;
    drivers.push({
      mag: Math.abs(awayCoverageVsHomeWR),
      icon: "🛡️",
      text: `<b>${winner.name}</b> coverage outclasses ${awayCoverageVsHomeWR > 0 ? home.name : away.name} receivers.`
    });
  }

  // Run-game / RB
  const rbEdge = hR.rb - aR.rb;
  if (Math.abs(rbEdge) >= 6) {
    const winner = rbEdge > 0 ? home : away;
    drivers.push({
      mag: Math.abs(rbEdge),
      icon: "🏃",
      text: `<b>${winner.name}</b> has the better RB room (${hR.rb.toFixed(0)} vs ${aR.rb.toFixed(0)}) — more chunk runs and YAC.`
    });
  }

  // Notable archetype tells from the rosters
  const archCount = (roster, pos, arch) => roster.filter(p => p.position === pos && p.archetype === arch).length;
  const tag = (count, label, who) => {
    if (count >= 2) drivers.push({ mag: count * 3, icon: "🔥", text: `<b>${who.name}</b> rolls out ${count} ${label}s — schematic advantage.` });
  };
  tag(archCount(hRoster, "CB", "SHUTDOWN"), "Shutdown CB", home);
  tag(archCount(aRoster, "CB", "SHUTDOWN"), "Shutdown CB", away);
  tag(archCount(hRoster, "DL", "SPEED"),    "Speed rusher", home);
  tag(archCount(aRoster, "DL", "SPEED"),    "Speed rusher", away);
  tag(archCount(hRoster, "S",  "BALL_HAWK"),"Ball Hawk safety", home);
  tag(archCount(aRoster, "S",  "BALL_HAWK"),"Ball Hawk safety", away);

  // Statistical tells from the sim itself
  const hSackDiff = (agg.teamSums.home.sacks - agg.teamSums.home.sacks_allowed) / agg.n;
  if (Math.abs(hSackDiff) >= 1.5) {
    const winner = hSackDiff > 0 ? home : away;
    drivers.push({ mag: Math.abs(hSackDiff) * 3, icon: "⚡", text: `<b>${winner.name}</b> wins the sack battle by ${Math.abs(hSackDiff).toFixed(1)}/game on average.` });
  }
  const hTOdiff = (agg.teamSums.home.takeaways - agg.teamSums.home.turnovers) / agg.n;
  if (Math.abs(hTOdiff) >= 0.6) {
    const winner = hTOdiff > 0 ? home : away;
    drivers.push({ mag: Math.abs(hTOdiff) * 6, icon: "🔄", text: `<b>${winner.name}</b> wins the turnover battle by ${Math.abs(hTOdiff).toFixed(2)}/game.` });
  }

  // Sort by magnitude, take top 5
  return drivers.sort((a, b) => b.mag - a.mag).slice(0, 5);
}

function renderSimManyResults(agg, home, away, hRoster, aRoster) {
  const drivers = (hRoster && aRoster) ? computeKeyDrivers(agg, home, away, hRoster, aRoster) : [];
  const homeWinPct = (agg.homeWins / agg.n * 100).toFixed(1);
  const awayWinPct = (agg.awayWins / agg.n * 100).toFixed(1);
  const tiePct     = (agg.ties     / agg.n * 100).toFixed(1);
  const avg = (sum) => (sum / agg.n).toFixed(1);
  const isHomeWinner = agg.homeWins > agg.awayWins;
  const row = (lbl, hv, av, fmt = (v) => v) => {
    // hv/av may be numbers OR pre-formatted strings ("69.1%"). Parse a numeric
    // for the better/worse highlight, but DISPLAY the original value — coercing
    // "69.1%" with +hv gave NaN, which is why COMP%/YPC rendered "NaN".
    const hn = parseFloat(hv), an = parseFloat(av);
    const hCls = hn > an ? "better" : "";
    const aCls = an > hn ? "better" : "";
    const disp = (v) => (typeof v === "number" ? fmt(v) : v);
    return `<tr>
      <td class="home ${hCls}">${disp(hv)}</td>
      <td class="lbl">${lbl}</td>
      <td class="away ${aCls}">${disp(av)}</td>
    </tr>`;
  };
  const compPct = (s) => s.pass_att ? (s.pass_comp / s.pass_att * 100).toFixed(1) + "%" : "—";
  const ypc = (s) => s.rush_att ? (s.rushYds / s.rush_att).toFixed(1) : "—";
  const html = `
    <div class="sm-title">${teamAscii(home)} ${home.city} ${home.name} <span style="color:var(--gray);font-size:.85rem">vs</span> ${teamAscii(away)} ${away.city} ${away.name}</div>
    <div class="sm-sub">${agg.n} simulations · all stats are averages per game</div>

    <div class="sm-record">
      <div class="sm-team-block ${isHomeWinner ? "winner" : ""}">
        <div class="sm-team-name">${home.name}</div>
        <div class="sm-team-pct">${homeWinPct}%</div>
        <div class="sm-team-wins">${agg.homeWins} wins · ${avg(agg.homeScoreSum)} avg pts</div>
      </div>
      <div class="sm-vs">— vs —<br><span style="font-size:.7rem;color:var(--gray)">${tiePct}% ties</span></div>
      <div class="sm-team-block ${!isHomeWinner ? "winner" : ""}">
        <div class="sm-team-name">${away.name}</div>
        <div class="sm-team-pct">${awayWinPct}%</div>
        <div class="sm-team-wins">${agg.awayWins} wins · ${avg(agg.awayScoreSum)} avg pts</div>
      </div>
    </div>

    ${drivers.length ? `
    <div class="sm-section">
      <h4>Key drivers — why this matchup goes this way</h4>
      <ul class="sm-drivers">
        ${drivers.map(d => `<li><span class="sm-driver-icon">${d.icon}</span> ${d.text}</li>`).join("")}
      </ul>
    </div>` : ""}

    <div class="sm-section">
      <h4>Notable games</h4>
      <div style="font-size:.78rem;color:var(--gray);line-height:1.6">
        <div>Biggest blowout: <span style="color:var(--white)">${home.name} ${agg.biggestBlowout.home} — ${away.name} ${agg.biggestBlowout.away}</span> (margin ${agg.biggestBlowout.margin})</div>
        <div>Closest result: <span style="color:var(--white)">${home.name} ${agg.closestGame.home} — ${away.name} ${agg.closestGame.away}</span> (margin ${agg.closestGame.margin})</div>
        <div>Highest score: <span style="color:var(--white)">${home.name} ${agg.homeScoreMax} | ${away.name} ${agg.awayScoreMax}</span></div>
      </div>
    </div>

    <div class="sm-section">
      <h4>Team averages per game</h4>
      <table class="sm-stats-table">
        ${row("TOTAL YDS",     avg(agg.teamSums.home.totalYds),     avg(agg.teamSums.away.totalYds))}
        ${row("PASS YDS",      avg(agg.teamSums.home.passYds),      avg(agg.teamSums.away.passYds))}
        ${row("RUSH YDS",      avg(agg.teamSums.home.rushYds),      avg(agg.teamSums.away.rushYds))}
        ${row("FIRST DOWNS",   avg(agg.teamSums.home.firstDowns),   avg(agg.teamSums.away.firstDowns))}
        ${row("COMP %",        compPct(agg.teamSums.home),          compPct(agg.teamSums.away), v => v)}
        ${row("YPC",           ypc(agg.teamSums.home),              ypc(agg.teamSums.away), v => v)}
        ${row("SACKS",         avg(agg.teamSums.home.sacks),        avg(agg.teamSums.away.sacks))}
        ${row("SACKS ALLOWED", avg(agg.teamSums.home.sacks_allowed), avg(agg.teamSums.away.sacks_allowed))}
        ${row("TURNOVERS",     avg(agg.teamSums.home.turnovers),    avg(agg.teamSums.away.turnovers))}
        ${row("TAKEAWAYS",     avg(agg.teamSums.home.takeaways),    avg(agg.teamSums.away.takeaways))}
        ${row("PENALTIES",     avg(agg.teamSums.home.penalties),    avg(agg.teamSums.away.penalties))}
        ${row("PENALTY YDS",   avg(agg.teamSums.home.penaltyYds),   avg(agg.teamSums.away.penaltyYds))}
      </table>
    </div>

    ${_benchmarkPanelHTML(agg)}

    <div class="sm-section">
      <h4>Top players (averaged per game)</h4>
      <table class="sm-stats-table">
        ${row("QB PASS YDS", avg(agg.qbSums.home.passYds), avg(agg.qbSums.away.passYds))}
        ${row("QB PASS TD",  avg(agg.qbSums.home.passTD),  avg(agg.qbSums.away.passTD))}
        ${row("QB INT",      avg(agg.qbSums.home.int),     avg(agg.qbSums.away.int))}
        ${row("QB SACKED",   avg(agg.qbSums.home.sacksTaken), avg(agg.qbSums.away.sacksTaken))}
        ${row("QB RUSH YDS", avg(agg.qbSums.home.rushYds), avg(agg.qbSums.away.rushYds))}
        ${row("QB RUSH TD",  avg(agg.qbSums.home.rushTD),  avg(agg.qbSums.away.rushTD))}
        ${row("RB YDS",      avg(agg.rbSums.home.yds),     avg(agg.rbSums.away.yds))}
        ${row("RB TD",       avg(agg.rbSums.home.td),      avg(agg.rbSums.away.td))}
        ${row("WR YDS",      avg(agg.wrSums.home.yds),     avg(agg.wrSums.away.yds))}
        ${row("WR TD",       avg(agg.wrSums.home.td),      avg(agg.wrSums.away.td))}
      </table>
    </div>

    <div class="sm-section">
      <h4>Top defenders (averaged per game)</h4>
      <table class="sm-stats-table">
        ${row("BEST SACKER (SK)",  avg(agg.topSackerSums.home.sk),    avg(agg.topSackerSums.away.sk))}
        ${row("BEST DB (INT)",      avg(agg.topIntSums.home.ints),     avg(agg.topIntSums.away.ints))}
        ${row("BEST TACKLER (TKL)", avg(agg.topTacklerSums.home.tkl),  avg(agg.topTacklerSums.away.tkl))}
      </table>
    </div>
  `;
  $("simManyBody").innerHTML = html;
  $("simManyModal").style.display = "flex";
}

$("simManyBtn").addEventListener("click", () => {
  const homeId = +homeSel.value, awayId = +awaySel.value;
  if (homeId === awayId) { alert("Pick two different teams!"); return; }
  const home = getTeam(homeId), away = getTeam(awayId);
  const homeRoster = (preview.home.id === homeId && preview.home.roster)
    ? preview.home.roster : regenerateFullRoster(home, {});
  const homeBlock = new Set(homeRoster.map(p => p.name));
  const awayRoster = (preview.away.id === awayId && preview.away.roster)
    ? preview.away.roster : regenerateFullRoster(away, {}, homeBlock);
  const n = +$("simManyCount").value || 100;
  const btn = $("simManyBtn");
  btn.disabled = true; btn.textContent = `Simulating ${n}...`;
  // Yield to the browser so the disabled state can paint, then run
  setTimeout(() => {
    const agg = runManyGames(home, away, homeRoster, awayRoster, n);
    renderSimManyResults(agg, home, away, homeRoster, awayRoster);
    btn.disabled = false; btn.textContent = "🎲 Sim Many";
  }, 30);
});
$("simManyClose").addEventListener("click", () => {
  $("simManyModal").style.display = "none";
  document.querySelector(".sim-many-card").classList.remove("wide");
});
$("simManyModal").addEventListener("click", (e) => {
  if (e.target.id === "simManyModal") {
    $("simManyModal").style.display = "none";
    document.querySelector(".sim-many-card").classList.remove("wide");
  }
});

// ─── Sim by QB Archetype — run N games for each of the 5 QB archetypes ────
// For each archetype we swap the home team's starting QB with a freshly-
// generated test QB tuned to that archetype at the target overall, so every
// archetype gets a fair shot at the same rating ceiling.
function runManyGamesByQBArchetype(home, away, hRoster, aRoster, n, targetOvr) {
  const archetypes = Object.keys(QB_ARCHETYPES);
  // Strip ALL QBs from the cloned roster — we'll add a single test QB per arch.
  // Otherwise a 65-OVR backup could outrank our 60-OVR test QB and start instead.
  const rosterNoQB = hRoster.filter(p => p.position !== "QB");
  const origStarter = hRoster.filter(p => p.position === "QB")
    .sort((a, b) => b.overall - a.overall)[0];
  if (!origStarter) return null;
  const results = {};
  const testQBs = {};
  for (const arch of archetypes) {
    const testQB = genTestQB(arch, targetOvr);
    testQBs[arch] = testQB;
    const rosterCopy = [testQB, ...rosterNoQB];
    results[arch] = runManyGames(home, away, rosterCopy, aRoster, n);
  }
  return { archetypes, results, testQBs, targetOvr, origStarterName: origStarter.name, origStarterOvr: origStarter.overall };
}

function renderSimByQBResults(data, home, away) {
  const { archetypes, results, testQBs, targetOvr, origStarterName } = data;
  const n = results[archetypes[0]].n;
  // Build rows: one per archetype
  const rows = archetypes.map(arch => {
    const agg = results[arch];
    const winPct = agg.homeWins / agg.n * 100;
    const qb = testQBs[arch];
    const [spd, _str, agi, awr, thr] = qb.stats;
    return {
      arch,
      label: QB_ARCHETYPES[arch].label,
      blurb: QB_ARCHETYPES[arch].blurb,
      qbOvr: qb.overall,
      spd, agi, awr, thr,
      winPct,
      record: `${agg.homeWins}-${agg.awayWins}${agg.ties ? `-${agg.ties}` : ""}`,
      ptsFor:  agg.homeScoreSum / agg.n,
      ptsAgst: agg.awayScoreSum / agg.n,
      passYds: agg.qbSums.home.passYds / agg.n,
      passTD:  agg.qbSums.home.passTD  / agg.n,
      intThr:  agg.qbSums.home.int     / agg.n,
      sackT:   agg.qbSums.home.sacksTaken / agg.n,
      rushYds: agg.qbSums.home.rushYds / agg.n,
      totalYds: agg.teamSums.home.totalYds / agg.n,
    };
  });
  // Best/worst markers
  const bestBy = (key, higherIsBetter = true) => {
    let bi = 0, wi = 0;
    for (let i = 1; i < rows.length; i++) {
      if ((higherIsBetter ? rows[i][key] > rows[bi][key] : rows[i][key] < rows[bi][key])) bi = i;
      if ((higherIsBetter ? rows[i][key] < rows[wi][key] : rows[i][key] > rows[wi][key])) wi = i;
    }
    return { bi, wi };
  };
  const winMarks = bestBy("winPct", true);
  const cell = (val, marks, idx, fmt = (v) => v.toFixed(1)) => {
    let cls = "metric";
    if (idx === marks.bi) cls += " best";
    else if (idx === marks.wi) cls += " worst";
    return `<td class="${cls}">${fmt(val)}</td>`;
  };
  // Find overall winner
  const winnerRow = rows.reduce((a, b) => a.winPct >= b.winPct ? a : b);

  // Per-column best/worst (used by row-coloring trick: we color all cells of best/worst row, not per-metric)
  // Simpler: highlight best win-pct row gold, worst red.
  const html = `
    <div class="sm-title">🧪 Sim by QB Archetype · ${targetOvr} OVR</div>
    <div class="sm-sub">
      ${teamAscii(home)} ${home.city} ${home.name} <span style="color:var(--gray)">vs</span>
      ${teamAscii(away)} ${away.city} ${away.name}
      &middot; replacing ${origStarterName} with a generated ${targetOvr}-OVR test QB per archetype
      &middot; ${n} games each (${n * 5} total)
    </div>

    <table class="sm-qb-table">
      <thead>
        <tr>
          <th class="arch">QB Archetype · Stat Profile</th>
          <th>WIN %</th>
          <th>RECORD</th>
          <th>PF</th>
          <th>PA</th>
          <th>PASS YDS</th>
          <th>TD</th>
          <th>INT</th>
          <th>SACKED</th>
          <th>RUSH YDS</th>
          <th>TOT YDS</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr class="${i === winMarks.bi ? "best" : (i === winMarks.wi ? "worst" : "")}">
            <td class="arch">
              ${r.label} <span style="color:var(--gray);font-weight:400">(${r.qbOvr})</span>
              <div class="sm-qb-blurb">${r.blurb}</div>
              <div class="sm-qb-statline">
                <span>SPD ${r.spd}</span>
                <span>AGI ${r.agi}</span>
                <span>AWR ${r.awr}</span>
                <span>THR ${r.thr}</span>
              </div>
            </td>
            ${cell(r.winPct, winMarks, i, v => v.toFixed(1) + "%")}
            <td class="metric">${r.record}</td>
            ${cell(r.ptsFor,  bestBy("ptsFor",  true),  i)}
            ${cell(r.ptsAgst, bestBy("ptsAgst", false), i)}
            ${cell(r.passYds, bestBy("passYds", true),  i, v => v.toFixed(0))}
            ${cell(r.passTD,  bestBy("passTD",  true),  i, v => v.toFixed(2))}
            ${cell(r.intThr,  bestBy("intThr",  false), i, v => v.toFixed(2))}
            ${cell(r.sackT,   bestBy("sackT",   false), i, v => v.toFixed(2))}
            ${cell(r.rushYds, bestBy("rushYds", true),  i, v => v.toFixed(0))}
            ${cell(r.totalYds, bestBy("totalYds", true),  i, v => v.toFixed(0))}
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div class="sm-qb-winner">
      <div class="label">BEST ARCHETYPE FOR THIS MATCHUP</div>
      <div class="name">${winnerRow.label} — ${winnerRow.winPct.toFixed(1)}% win rate</div>
    </div>

    <div class="sm-section">
      <div style="font-size:.7rem;color:var(--gray);line-height:1.5">
        The home QB is replaced with a freshly-generated ${targetOvr}-OVR test QB per archetype.
        Stats are biased toward the archetype but the weighted overall is identical across all five.
        Rest of the roster, playbook, and matchup are held constant.
        Gold = best in column · Red = worst in column.
      </div>
    </div>
  `;
  $("simManyBody").innerHTML = html;
  document.querySelector(".sim-many-card").classList.add("wide");
  $("simManyModal").style.display = "flex";
}

$("simByQBBtn").addEventListener("click", () => {
  const homeId = +homeSel.value, awayId = +awaySel.value;
  if (homeId === awayId) { alert("Pick two different teams!"); return; }
  const home = getTeam(homeId), away = getTeam(awayId);
  const homeRoster = (preview.home.id === homeId && preview.home.roster)
    ? preview.home.roster : regenerateFullRoster(home, {});
  const homeBlock = new Set(homeRoster.map(p => p.name));
  const awayRoster = (preview.away.id === awayId && preview.away.roster)
    ? preview.away.roster : regenerateFullRoster(away, {}, homeBlock);
  const n = +$("simManyCount").value || 100;
  let targetOvr = parseInt($("qbOvrInput").value, 10);
  if (!Number.isFinite(targetOvr)) targetOvr = 90;
  targetOvr = Math.min(99, Math.max(60, targetOvr));
  $("qbOvrInput").value = targetOvr;
  const btn = $("simByQBBtn");
  btn.disabled = true; btn.textContent = `Simulating 5×${n}...`;
  setTimeout(() => {
    const data = runManyGamesByQBArchetype(home, away, homeRoster, awayRoster, n, targetOvr);
    if (data) renderSimByQBResults(data, home, away);
    btn.disabled = false; btn.textContent = "🧪 Sim by QB";
  }, 30);
});

// ─── Sim by Playbook ─────────────────────────────────────────────────────
function runManyGamesByPlaybook(home, away, hRoster, aRoster, n) {
  const playbooks = Object.keys(PLAYBOOKS);
  const origPb = home.playbook;
  const results = {};
  for (const pbId of playbooks) {
    const teamCopy = { ...home, playbook: pbId };
    results[pbId] = runManyGames(teamCopy, away, hRoster, aRoster, n);
  }
  return { playbooks, results, origPb };
}

function renderSimByPlaybookResults(data, home, away) {
  const { playbooks, results, origPb } = data;
  const n = results[playbooks[0]].n;
  const rows = playbooks.map(pbId => {
    const agg = results[pbId];
    const pb  = PLAYBOOKS[pbId];
    return {
      pbId, label: pb.name, badge: pb.badge,
      winPct:   agg.homeWins / agg.n * 100,
      record:   `${agg.homeWins}-${agg.awayWins}${agg.ties ? `-${agg.ties}` : ""}`,
      ptsFor:   agg.homeScoreSum / agg.n,
      ptsAgst:  agg.awayScoreSum / agg.n,
      passYds:  agg.teamSums.home.passYds / agg.n,
      rushYds:  agg.teamSums.home.rushYds / agg.n,
      totalYds: agg.teamSums.home.totalYds / agg.n,
      to:       agg.teamSums.home.turnovers / agg.n,
      sacks_allowed: agg.teamSums.home.sacks_allowed / agg.n,
    };
  });
  const bestBy = (key, higherIsBetter = true) => {
    let bi = 0, wi = 0;
    for (let i = 1; i < rows.length; i++) {
      if ((higherIsBetter ? rows[i][key] > rows[bi][key] : rows[i][key] < rows[bi][key])) bi = i;
      if ((higherIsBetter ? rows[i][key] < rows[wi][key] : rows[i][key] > rows[wi][key])) wi = i;
    }
    return { bi, wi };
  };
  const cell = (val, marks, idx, fmt = (v) => v.toFixed(1)) => {
    let cls = "metric";
    if (idx === marks.bi) cls += " best";
    else if (idx === marks.wi) cls += " worst";
    return `<td class="${cls}">${fmt(val)}</td>`;
  };
  const winMarks = bestBy("winPct", true);
  const winnerRow = rows.reduce((a, b) => a.winPct >= b.winPct ? a : b);
  const html = `
    <div class="sm-title">📘 Sim by Playbook</div>
    <div class="sm-sub">
      ${teamAscii(home)} ${home.city} ${home.name} <span style="color:var(--gray)">vs</span>
      ${teamAscii(away)} ${away.city} ${away.name}
      &middot; default playbook: <span style="color:var(--white);font-weight:700">${PLAYBOOKS[origPb || "BALANCED"]?.name || "Balanced"}</span>
      &middot; ${n} games each (${n * 5} total)
    </div>

    <table class="sm-qb-table">
      <thead>
        <tr>
          <th class="arch">Playbook</th>
          <th>WIN %</th>
          <th>RECORD</th>
          <th>PF</th>
          <th>PA</th>
          <th>PASS YDS</th>
          <th>RUSH YDS</th>
          <th>TOT YDS</th>
          <th>TO</th>
          <th>SK ALLW</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr class="${i === winMarks.bi ? "best" : (i === winMarks.wi ? "worst" : "")}">
            <td class="arch">
              ${r.label}
              <div class="sm-qb-blurb">${PLAYBOOKS[r.pbId].name === origPb ? "default" : ""}</div>
            </td>
            ${cell(r.winPct, winMarks, i, v => v.toFixed(1) + "%")}
            <td class="metric">${r.record}</td>
            ${cell(r.ptsFor,  bestBy("ptsFor",  true),  i)}
            ${cell(r.ptsAgst, bestBy("ptsAgst", false), i)}
            ${cell(r.passYds, bestBy("passYds", true),  i, v => v.toFixed(0))}
            ${cell(r.rushYds, bestBy("rushYds", true),  i, v => v.toFixed(0))}
            ${cell(r.totalYds, bestBy("totalYds", true),  i, v => v.toFixed(0))}
            ${cell(r.to, bestBy("to", false),  i, v => v.toFixed(2))}
            ${cell(r.sacks_allowed, bestBy("sacks_allowed", false),  i, v => v.toFixed(2))}
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div class="sm-qb-winner">
      <div class="label">BEST PLAYBOOK FOR THIS ROSTER vs ${away.name.toUpperCase()}</div>
      <div class="name">${winnerRow.label} — ${winnerRow.winPct.toFixed(1)}% win rate</div>
    </div>

    <div class="sm-section">
      <div style="font-size:.7rem;color:var(--gray);line-height:1.5">
        Same roster, same opponent. Only the home team's playbook varies.
        Gold = best in column · Red = worst in column.
      </div>
    </div>
  `;
  $("simManyBody").innerHTML = html;
  document.querySelector(".sim-many-card").classList.add("wide");
  $("simManyModal").style.display = "flex";
}

// ─── Power Rankings — round-robin all 32 teams ───────────────────────────
// Each team plays every other team `gamesPerPair` times (default 1).
// 32 teams × 31 opponents / 2 unique pairs = 496 pairs.
function runPowerRankings(gamesPerPair = 1) {
  // Generate one roster per team once
  const rosters = {};
  for (const t of TEAMS) {
    rosters[t.id] = regenerateFullRoster(t, {});
  }
  // League-wide benchmark accumulator — pools EVERY team-game across the full
  // round-robin so the NFL realism check reflects the whole league, not one
  // matchup. _benchmarkPanelHTML expects the runManyGames agg shape, so build
  // a compatible mini-agg with both sides folded into `home` (the panel pools
  // home+away anyway) and `n` = total TEAM-GAMES / 2 (it multiplies by 2*n).
  const _lb = { totalYds: 0, passYds: 0, rushYds: 0, sacks: 0, sacks_allowed: 0,
                turnovers: 0, takeaways: 0, firstDowns: 0, pass_comp: 0, pass_att: 0,
                rush_att: 0, penalties: 0, penaltyYds: 0, intThrown: 0 };
  const _zero = { ..._lb };
  let _lbTeamGames = 0, _lbPtsSum = 0;
  // Track W/L/T + total points scored/allowed
  const standings = {};
  for (const t of TEAMS) {
    standings[t.id] = { id: t.id, team: t, w: 0, l: 0, t: 0, pf: 0, pa: 0, games: 0 };
  }
  // Round-robin
  for (let i = 0; i < TEAMS.length; i++) {
    for (let j = i + 1; j < TEAMS.length; j++) {
      const h = TEAMS[i], a = TEAMS[j];
      for (let g = 0; g < gamesPerPair; g++) {
        const sim = new GameSimulator(h, a, rosters[h.id], rosters[a.id]);
        const r = sim.simulate();
        const hs = r.homeScore, as = r.awayScore;
        const sh = standings[h.id], sa = standings[a.id];
        sh.pf += hs; sh.pa += as; sa.pf += as; sa.pa += hs;
        sh.games++; sa.games++;
        if (hs > as)      { sh.w++; sa.l++; }
        else if (as > hs) { sa.w++; sh.l++; }
        else              { sh.t++; sa.t++; }
        // Pool both teams' box scores into the league benchmark accumulator.
        for (const side of ["home", "away"]) {
          const t = r.stats[side].team;
          _lb.totalYds += t.totalYds; _lb.passYds += t.passYds; _lb.rushYds += t.rushYds;
          _lb.sacks += t.sacks; _lb.sacks_allowed += t.sacks_allowed;
          _lb.turnovers += t.turnovers; _lb.takeaways += t.takeaways;
          _lb.firstDowns += t.firstDowns;
          _lb.pass_comp += t.pass_comp; _lb.pass_att += t.pass_att; _lb.rush_att += t.rush_att;
          _lb.penalties += (t.penalties || 0); _lb.penaltyYds += (t.penaltyYds || 0);
          for (const p of Object.values(r.stats[side].players)) _lb.intThrown += (p.pass_int || 0);
          _lbTeamGames++;
        }
        _lbPtsSum += hs + as;
      }
    }
  }
  // Compute win pct and rank
  const ranked = Object.values(standings).map(s => ({
    ...s,
    winPct: (s.w + s.t * 0.5) / Math.max(1, s.games),
    pd: (s.pf - s.pa) / Math.max(1, s.games),
  })).sort((a, b) => b.winPct - a.winPct || b.pd - a.pd);
  // League benchmark agg in the runManyGames shape so _benchmarkPanelHTML can
  // consume it. All team-games folded into `home`; `away` zeroed; n =
  // teamGames/2 so the panel's tg = 2*n = total team-games. Points split into
  // the two score sums (panel pools them).
  const _benchAgg = {
    n: Math.max(1, _lbTeamGames / 2),
    homeScoreSum: _lbPtsSum / 2, awayScoreSum: _lbPtsSum / 2,
    teamSums: { home: _lb, away: _zero },
    qbSums: { home: { int: 0 }, away: { int: 0 } },
  };
  ranked._benchAgg = _benchAgg;
  return ranked;
}

function renderPowerRankings(ranked, gamesPerPair) {
  // Group by conference for the breakdown
  const byConf = { AFC: [], NFC: [] };
  for (const r of ranked) (byConf[r.team.conference] || (byConf[r.team.conference] = [])).push(r);
  const totalGames = ranked.reduce((s, r) => s + r.games, 0) / 2;  // each game double-counted

  const rankRow = (r, rank) => `
    <tr>
      <td class="pr-rank">${rank}</td>
      <td class="pr-team">
        <span class="pr-emoji">${teamAscii(r.team)}</span>
        <span class="pr-name">${r.team.city} ${r.team.name}</span>
        <span class="pr-conf">${r.team.conference}·${r.team.division}</span>
      </td>
      <td class="pr-record">${r.w}-${r.l}${r.t ? `-${r.t}` : ""}</td>
      <td class="pr-pct">${(r.winPct * 100).toFixed(1)}%</td>
      <td class="pr-pf">${(r.pf / r.games).toFixed(1)}</td>
      <td class="pr-pa">${(r.pa / r.games).toFixed(1)}</td>
      <td class="pr-pd ${r.pd >= 0 ? "pos" : "neg"}">${r.pd >= 0 ? "+" : ""}${r.pd.toFixed(1)}</td>
    </tr>
  `;

  const html = `
    <div class="sm-title">📊 Power Rankings</div>
    <div class="sm-sub">
      Round-robin across all ${TEAMS.length} teams · ${gamesPerPair} game${gamesPerPair > 1 ? "s" : ""} per matchup · ${totalGames} games total
    </div>

    <table class="pr-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Record</th>
          <th>WIN %</th>
          <th>PF/G</th>
          <th>PA/G</th>
          <th>DIFF</th>
        </tr>
      </thead>
      <tbody>
        ${ranked.map((r, i) => rankRow(r, i + 1)).join("")}
      </tbody>
    </table>

    <div class="sm-section">
      <h4>By conference</h4>
      <div class="pr-conf-grid">
        ${["AFC", "NFC"].map(c => `
          <div class="pr-conf-block">
            <div class="pr-conf-title">${c}</div>
            <ol class="pr-conf-list">
              ${byConf[c].slice(0, 8).map(r => `
                <li><span class="pr-emoji">${teamAscii(r.team)}</span> ${r.team.name} <span style="color:var(--gray)">${r.w}-${r.l}${r.t ? `-${r.t}` : ""}</span></li>
              `).join("")}
            </ol>
          </div>
        `).join("")}
      </div>
    </div>

    ${ranked._benchAgg ? `
    <div class="sm-section">
      <div style="font-size:.72rem;color:var(--gray);margin-bottom:4px">
        LEAGUE-WIDE — pooled across all ${totalGames} games of the round-robin (not one matchup).
      </div>
    </div>
    ${_benchmarkPanelHTML(ranked._benchAgg)}` : ""}

    <div class="sm-section">
      <div style="font-size:.7rem;color:var(--gray);line-height:1.5">
        Tiebreakers: win pct first, then point differential. With only ${gamesPerPair} game${gamesPerPair > 1 ? "s" : ""} per matchup, expect some upsets and variance.
        Bump games-per-pair higher for a smoother ranking.
      </div>
    </div>
  `;
  $("simManyBody").innerHTML = html;
  document.querySelector(".sim-many-card").classList.add("wide");
  $("simManyModal").style.display = "flex";
}

$("powerRankBtn").addEventListener("click", () => {
  // Scale gamesPerPair off the Sim Many count so users can pick their pain level
  const n = +$("simManyCount").value || 100;
  // Map: 10 → 1 game per pair (496 total); 100 → 3 (1488); 500 → 5 (2480); 1000 → 8 (3968)
  const gpp = n >= 1000 ? 8 : n >= 500 ? 5 : n >= 100 ? 3 : 1;
  const totalGames = gpp * (TEAMS.length * (TEAMS.length - 1) / 2);
  const btn = $("powerRankBtn");
  btn.disabled = true; btn.textContent = `Simulating ${totalGames}...`;
  setTimeout(() => {
    const ranked = runPowerRankings(gpp);
    renderPowerRankings(ranked, gpp);
    btn.disabled = false; btn.textContent = "📊 Power Rankings";
  }, 30);
});

// ─── Tournament Bracket — single-elimination playoff ───────────────────
// Seeds the top 8 (or 16) teams from a quick round-robin, then runs a
// single-elimination bracket. Each round runs `gamesPerRound` games and
// the team that wins more advances (tiebreaker: total points scored).
function runTournament(bracketSize, gamesPerRound) {
  // 1) Quick seed round — every team plays 1 game vs every other
  const rosters = {};
  for (const t of TEAMS) rosters[t.id] = regenerateFullRoster(t, {});
  const standings = {};
  for (const t of TEAMS) standings[t.id] = { team: t, w: 0, pf: 0, games: 0 };
  for (let i = 0; i < TEAMS.length; i++) {
    for (let j = i + 1; j < TEAMS.length; j++) {
      const h = TEAMS[i], a = TEAMS[j];
      const sim = new GameSimulator(h, a, rosters[h.id], rosters[a.id]);
      const r = sim.simulate();
      standings[h.id].pf += r.homeScore; standings[a.id].pf += r.awayScore;
      standings[h.id].games++; standings[a.id].games++;
      if (r.homeScore > r.awayScore) standings[h.id].w++;
      else if (r.awayScore > r.homeScore) standings[a.id].w++;
    }
  }
  const seeded = Object.values(standings)
    .sort((a, b) => b.w - a.w || b.pf - a.pf)
    .slice(0, bracketSize);

  // 2) Bracket — standard playoff pairing: 1v8, 4v5, 2v7, 3v6 (then 1v16 etc for 16-team)
  const pairings = (size) => {
    const out = [];
    for (let i = 0; i < size / 2; i++) out.push([i, size - 1 - i]);
    // Reorder so winners meet in proper bracket positions
    if (size === 8)  return [[0,7],[3,4],[1,6],[2,5]];
    if (size === 16) return [[0,15],[7,8],[3,12],[4,11],[1,14],[6,9],[2,13],[5,10]];
    return out;
  };
  const firstRound = pairings(bracketSize);

  const playMatchup = (hSeed, aSeed) => {
    // Higher seed (lower index) hosts
    const home = hSeed.team, away = aSeed.team;
    let homeW = 0, awayW = 0, homePF = 0, awayPF = 0;
    const games = [];
    for (let g = 0; g < gamesPerRound; g++) {
      const sim = new GameSimulator(home, away, rosters[home.id], rosters[away.id]);
      const r = sim.simulate();
      games.push({ homeScore: r.homeScore, awayScore: r.awayScore });
      homePF += r.homeScore; awayPF += r.awayScore;
      if (r.homeScore > r.awayScore) homeW++;
      else if (r.awayScore > r.homeScore) awayW++;
    }
    const winner = homeW > awayW ? hSeed : awayW > homeW ? aSeed : (homePF >= awayPF ? hSeed : aSeed);
    return { home: hSeed, away: aSeed, homeW, awayW, homePF, awayPF, winner, games };
  };

  const rounds = [];
  let currentRound = firstRound.map(([i, j]) => playMatchup(seeded[i], seeded[j]));
  rounds.push(currentRound);
  while (currentRound.length > 1) {
    const next = [];
    for (let i = 0; i < currentRound.length; i += 2) {
      next.push(playMatchup(currentRound[i].winner, currentRound[i + 1].winner));
    }
    rounds.push(next);
    currentRound = next;
  }
  const champion = currentRound[0].winner;
  return { bracketSize, gamesPerRound, seeded, rounds, champion };
}

function renderTournament(data) {
  const { bracketSize, gamesPerRound, seeded, rounds, champion } = data;
  const roundNames = bracketSize === 8
    ? ["Quarterfinals", "Semifinals", "Championship"]
    : ["First Round", "Quarterfinals", "Semifinals", "Championship"];

  const matchupCard = (m, roundIdx) => {
    const h = m.home, a = m.away;
    const hSeed = seeded.indexOf(h) + 1;
    const aSeed = seeded.indexOf(a) + 1;
    const hWin = m.winner === h;
    const aWin = m.winner === a;
    const homeScore = gamesPerRound > 1 ? `${m.homeW}-${m.awayW}` : `${m.games[0].homeScore}`;
    const awayScore = gamesPerRound > 1 ? "" : `${m.games[0].awayScore}`;
    const detail = gamesPerRound > 1
      ? `${m.homeW}-${m.awayW} series, ${Math.round(m.homePF/gamesPerRound)}-${Math.round(m.awayPF/gamesPerRound)} avg`
      : `${m.games[0].homeScore} - ${m.games[0].awayScore}`;
    return `
      <div class="tn-matchup">
        <div class="tn-team ${hWin ? "winner" : "loser"}">
          <span class="tn-seed">#${hSeed}</span>
          <span class="tn-emoji">${teamAscii(h.team)}</span>
          <span class="tn-name">${h.team.name}</span>
        </div>
        <div class="tn-score">${detail}</div>
        <div class="tn-team ${aWin ? "winner" : "loser"}">
          <span class="tn-seed">#${aSeed}</span>
          <span class="tn-emoji">${teamAscii(a.team)}</span>
          <span class="tn-name">${a.team.name}</span>
        </div>
      </div>
    `;
  };

  const html = `
    <div class="sm-title">🏆 Tournament — Top ${bracketSize}</div>
    <div class="sm-sub">
      Single elimination · ${gamesPerRound > 1 ? `Best of ${gamesPerRound * 2 - 1} per round` : "1 game per round"}
    </div>

    <div class="tn-champion">
      <div class="label">CHAMPION</div>
      <div class="trophy">🏆</div>
      <div class="name">${teamAscii(champion.team)} ${champion.team.city} ${champion.team.name}</div>
      <div class="sub">#${seeded.indexOf(champion) + 1} seed · ${champion.team.conference} ${champion.team.division}</div>
    </div>

    <div class="tn-rounds">
      ${rounds.map((round, ri) => `
        <div class="tn-round">
          <h4>${roundNames[ri]}</h4>
          <div class="tn-matchups">
            ${round.map(m => matchupCard(m, ri)).join("")}
          </div>
        </div>
      `).join("")}
    </div>

    <div class="sm-section">
      <h4>Seeding (from round-robin)</h4>
      <table class="sm-stats-table" style="font-size:.74rem">
        ${seeded.map((s, i) => `
          <tr>
            <td style="text-align:left;width:8%">#${i + 1}</td>
            <td style="text-align:left">${teamAscii(s.team)} ${s.team.city} ${s.team.name}</td>
            <td style="text-align:right">${s.w}-${s.games - s.w}</td>
            <td style="text-align:right;color:var(--gray)">${(s.pf / s.games).toFixed(1)} PPG</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;
  $("simManyBody").innerHTML = html;
  document.querySelector(".sim-many-card").classList.add("wide");
  $("simManyModal").style.display = "flex";
}

$("tournamentBtn").addEventListener("click", () => {
  const n = +$("simManyCount").value || 100;
  // Map count to bracket complexity
  // 10 → 8-team, 1 game/round
  // 100 → 8-team, 3 games/round (best of 5)
  // 500 → 16-team, 3 games/round
  // 1000 → 16-team, 5 games/round (best of 9)
  const bracketSize = n >= 500 ? 16 : 8;
  const gamesPerRound = n >= 1000 ? 5 : n >= 100 ? 3 : 1;
  const btn = $("tournamentBtn");
  btn.disabled = true; btn.textContent = `Simulating bracket...`;
  setTimeout(() => {
    const data = runTournament(bracketSize, gamesPerRound);
    renderTournament(data);
    btn.disabled = false; btn.textContent = "🏆 Tournament";
  }, 30);
});

$("simByPBBtn").addEventListener("click", () => {
  const homeId = +homeSel.value, awayId = +awaySel.value;
  if (homeId === awayId) { alert("Pick two different teams!"); return; }
  const home = getTeam(homeId), away = getTeam(awayId);
  const homeRoster = (preview.home.id === homeId && preview.home.roster)
    ? preview.home.roster : regenerateFullRoster(home, {});
  const homeBlock = new Set(homeRoster.map(p => p.name));
  const awayRoster = (preview.away.id === awayId && preview.away.roster)
    ? preview.away.roster : regenerateFullRoster(away, {}, homeBlock);
  const n = +$("simManyCount").value || 100;
  const btn = $("simByPBBtn");
  btn.disabled = true; btn.textContent = `Simulating 5×${n}...`;
  setTimeout(() => {
    const data = runManyGamesByPlaybook(home, away, homeRoster, awayRoster, n);
    if (data) renderSimByPlaybookResults(data, home, away);
    btn.disabled = false; btn.textContent = "📘 Sim by PB";
  }, 30);
});

playBtn.addEventListener("click", () => {
  if (!playing) {
    playing = true;
    if (!animState) {
      startNextPlay();
    } else {
      // Resume mid-play: shift timers so we pick up where we left off.
      const now = performance.now();
      if (animState.elapsedOnPause != null) {
        animState.startTime = now - animState.elapsedOnPause;
        animState.elapsedOnPause = null;
      }
      if (animState.holdElapsedOnPause != null) {
        animState.holdStart = now - animState.holdElapsedOnPause;
        animState.holdElapsedOnPause = null;
      }
      rafId = requestAnimationFrame(tick);
    }
    updateButtons();
  }
});
pauseBtn.addEventListener("click", () => {
  playing = false;
  cancelAnimationFrame(rafId);
  if (animState) {
    const now = performance.now();
    animState.elapsedOnPause = now - animState.startTime;
    if (animState.holdStart != null) animState.holdElapsedOnPause = now - animState.holdStart;
  }
  updateButtons();
});
endBtn.addEventListener("click", () => {
  playing = false;
  cancelAnimationFrame(rafId);
  playHead = gameResult.plays.length;
  animState = null;
  renderStaticEnd();
  updateButtons();
});

// Jump the playback head forward to a target play index. Cancels the current
// animation, refreshes side panels, and either resumes auto-play or draws a
// static frame depending on whether the user was playing.
function jumpAheadTo(targetIdx) {
  if (!gameResult) return;
  targetIdx = Math.min(targetIdx, gameResult.plays.length);
  if (targetIdx <= playHead) return;
  const wasPlaying = playing;
  cancelAnimationFrame(rafId);
  animState = null;
  playing = false;
  playHead = targetIdx;

  renderScoreboard();
  renderPlayLog();
  renderBoxScore();
  renderProgress();

  if (playHead >= gameResult.plays.length) {
    renderStaticEnd();
    updateButtons();
    return;
  }
  if (wasPlaying) {
    playing = true;
    startNextPlay();
  } else {
    const ctx = $("field").getContext("2d");
    const cur = playHead > 0 ? gameResult.plays[playHead - 1] : null;
    if (viewMode === "cinema") drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, cur);
    else                       drawField      (ctx, gameResult.homeTeam, gameResult.awayTeam, cur);
  }
  updateButtons();
}

$("nextPlayBtn").addEventListener("click", () => {
  if (!gameResult || playHead >= gameResult.plays.length) return;
  jumpAheadTo(playHead + 1);
});

$("endQtrBtn").addEventListener("click", () => {
  if (!gameResult || playHead >= gameResult.plays.length) return;
  const curQ = gameResult.plays[playHead]?.quarter || 1;
  let i = playHead;
  while (i < gameResult.plays.length && (gameResult.plays[i].quarter ?? curQ) <= curQ) i++;
  jumpAheadTo(i);
});

$("endHalfBtn").addEventListener("click", () => {
  if (!gameResult || playHead >= gameResult.plays.length) return;
  const cur = gameResult.plays[playHead];
  let target;
  if ((cur.quarter ?? 1) <= 2) {
    // Find first play in Q3 (or a halftime marker)
    target = gameResult.plays.findIndex((p, i) => i > playHead && ((p.quarter ?? 1) >= 3 || p.kind === "halftime"));
  } else if ((cur.quarter ?? 1) <= 4) {
    // Already past halftime — sim to end of regulation
    target = gameResult.plays.findIndex((p, i) => i > playHead && (p.quarter ?? 1) >= 5);
    if (target < 0) target = gameResult.plays.length;
  } else {
    target = gameResult.plays.length;
  }
  if (target < 0) target = gameResult.plays.length;
  jumpAheadTo(target);
});

function updateButtons() {
  const done = !gameResult || playHead >= gameResult.plays.length;
  playBtn.disabled       = !gameResult || playing || done;
  pauseBtn.disabled      = !gameResult || !playing;
  endBtn.disabled        = !gameResult || done;
  const skipDis          = !gameResult || done;
  $("nextPlayBtn").disabled = skipDis;
  $("endQtrBtn").disabled   = skipDis;
  $("endHalfBtn").disabled  = skipDis;
}

let boxTab = "totals";

