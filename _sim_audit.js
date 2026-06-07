// Headless audit harness — runs the engine in node (NO browser) to compute
// real NFL-realism benchmarks over many games. Concatenates the DOM-free
// script files + the audit code into ONE script so top-level const/class
// declarations share lexical scope (they don't attach to a VM global).
// Dev/audit tool only — ignored by the build.
const fs = require("fs");
const path = require("path");

const files = [
  "play-data.js",     // TEAMS, PERSONNEL, DEF_PACKAGE, pickReceiver, getPlaybook, PLAYBOOKS
  "play-player.js",   // genRoster, genUniquePlayer, player gen + stat helpers
  "play-render.js",   // pickBodyType, CELEB_STYLES, gen helpers (UI-init lines stripped below)
  "play-sim.js",      // SimPlayer, simIntercept, Engagement, PassProSim, RunBlockSim
  "play-motion.js",   // MotionPlayback
  "play-engine.js",   // GameSimulator
];
const extraConsts = "";
// play-render.js runs 4 UI-init calls at load that touch real DOM elements
// (the team dropdowns + preview). Strip those specific top-level lines — the
// gen helpers + constants we need are all plain declarations above them.
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}

// Minimal browser shims. play-render.js runs some UI-init at load time, so DOM
// getters return a BENIGN chainable stub (not null) — every property is a
// no-op so top-level setup can't throw. The sim path never reads back from it.
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "style" || k === "classList" || k === "dataset") return _stub;
                if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = () => 0;
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

const SEASONS = Number(process.argv[2] || 100);

const audit = `
;(function runAudit() {
  if (typeof TEAMS === "undefined" || typeof GameSimulator === "undefined") {
    console.error("Missing TEAMS or GameSimulator after load");
    process.exit(1);
  }
  console.error("Loaded OK — " + TEAMS.length + " teams, GameSimulator ready.");
  const SEASONS = ${SEASONS};
  function buildRoster(team) { return genRoster(getPlaybook(team), {}, null); }

  const lb = { totalYds:0, passYds:0, rushYds:0, sacks:0, sacks_allowed:0,
    turnovers:0, takeaways:0, firstDowns:0, pass_comp:0, pass_att:0, rush_att:0,
    penalties:0, penaltyYds:0, intThrown:0, ptsSum:0, teamGames:0, games:0,
    // ── Tier 1: drive-level (yds/drive = totalYds/drives; 3-and-out needs
    // per-drive play grouping the engine doesn't expose, so omitted) ──
    drives:0, driveTDs:0, driveFGs:0, driveTOs:0, driveOther:0, drivePts:0,
    thirdAtt:0, thirdConv:0, fourthAtt:0, fourthConv:0, rzAtt:0, rzTD:0,
    // ── Tier 2: kicking / ST / situational ──
    fgMade:0, fgAtt:0, xpMade:0, xpAtt:0, puntAtt:0, puntYds:0,
    fg0_39_m:0, fg0_39_a:0, fg40_49_m:0, fg40_49_a:0, fg50_m:0, fg50_a:0,
    otGames:0 };
  // Per-team-game arrays for distribution stats (median/quantiles/extremes).
  // Means alone can mask shape bugs — a clamp truncating tails would never
  // show in the average but jumps out in P90/max.
  const tg_pts=[], tg_totalYds=[], tg_passYds=[], tg_rushYds=[], tg_firstDowns=[],
        tg_sacks=[], tg_turnovers=[], tg_penalties=[], tg_penaltyYds=[],
        tg_intThrown=[], tg_passAtt=[], tg_passComp=[], tg_rushAtt=[];

  // ── PER-POSITION PRODUCTION ──
  // For each team-game we find the PRIMARY producer at each position (the de
  // facto starter, by the position's signature stat) and push their per-game
  // stat line into pp[POS]. At report time we show median / P10 / P90 / max
  // per key stat + milestone-game frequencies. Player lines carry a pos
  // (subPos), normalized here: DE/DT to DL, FS/SS to S.
  const pp = { QB:[], RB:[], WR:[], TE:[], OL:[], DL:[], LB:[], CB:[], S:[], K:[], P:[] };
  const normPos = (p) => p==="DE"||p==="DT"||p==="NT" ? "DL" : p==="FS"||p==="SS" ? "S" : p;
  // signature stat → picks the "starter" at each position
  const sigStat = { QB:"pass_att", RB:"rush_att", WR:"rec_yds", TE:"rec_yds", OL:"pancakes",
                    DL:"sk", LB:"tkl", CB:"pd", S:"tkl", K:"fg_att", P:"punt_att" };
  // Per-GAME (not per-team-game) — margin is one value per matchup.
  const game_margin=[];

  // Per-offensive-playbook + per-weather accumulators (gameplay-system audit).
  // Declared OUTSIDE the season loop so they accumulate across all seasons and
  // are in scope at report time. Each team uses its real playbook (getPlaybook),
  // so tagging team-games by the offense's playbook shows whether the 5 schemes
  // produce distinct, NFL-shaped profiles. Weather is read off the sim post-game.
  const PB = {};
  const WX = {};
  const _pbInit = id => (PB[id] || (PB[id] = { g:0, plays:0, passYds:0, rushYds:0, pAtt:0, rAtt:0, comp:0, pts:0, sacksAllowed:0 }));
  const _wxInit = l => (WX[l] || (WX[l] = { g:0, passYds:0, rushYds:0, pAtt:0, comp:0, pts:0, fum:0, fgM:0, fgA:0 }));

  // ── COACHING SYSTEM (gameplay-system audit) ──
  // _sim_audit normally has NO franchise, so every HC trait defaults to neutral
  // and the coaching dial never fires. Inject a franchise.coaches stub assigning
  // each team an HC specialtyTrait (balanced across the 4 types) so the 4th-down
  // aggression multiplier (hcAggMul) activates, then tag 4th-down go-attempts by
  // trait to verify Riverboat Gambler > Game Manager > Conservative.
  const HC_TRAITS = ["Riverboat Gambler", "Conservative", "Game Manager", null];
  globalThis.franchise = { coaches:{}, week:1, season:1, _careerEndingLog:{}, _ejectionLog:{} };
  TEAMS.forEach((t, i) => { globalThis.franchise.coaches[t.id] = { hc: { specialtyTrait: HC_TRAITS[i % HC_TRAITS.length] } }; });
  const CO = {};
  const _coKey = t => (globalThis.franchise.coaches[t.id] && globalThis.franchise.coaches[t.id].hc.specialtyTrait) || "Neutral";
  const _coInit = k => (CO[k] || (CO[k] = { g:0, fourthAtt:0, fourthConv:0, pts:0 }));

  // Per-play breakdowns (defensive scheme / offensive personnel / coverage shell).
  // These are chosen dynamically each play, so they're tagged from the play log
  // rather than per team-game. Verifies each scheme/package/coverage behaves
  // distinctly (e.g. DIME tighter vs pass, HEAVY run-heavy, man vs zone comp%).
  const DP = {}, PN = {}, CV = {};
  const _dpI = k => (DP[k] || (DP[k] = { plays:0, yds:0, patt:0, comp:0, sk:0 }));
  const _pnI = k => (PN[k] || (PN[k] = { plays:0, yds:0, patt:0 }));
  const _cvI = k => (CV[k] || (CV[k] = { att:0, comp:0, yds:0 }));

  // FATIGUE/WEAR audit. Fatigue is per-game (sim._fatigue, 0-100, read post-game);
  // it should leave a workhorse RB ~60-70 by the 4th quarter (15-20% rating cut)
  // and barely touch low-snap positions. Per-quarter yds/play surfaces whether
  // the late-game fatigue tax shows up as a realistic (mild) efficiency dropoff.
  const FT = { QB:[], RB:[], WR:[], TE:[], OL:[], DL:[], LB:[], CB:[], S:[] };
  const QF = {};   // quarter → { plays, yds }
  const _qfI = q => (QF[q] || (QF[q] = { plays:0, yds:0 }));

  // Misc gameplay-system counters (special teams returns, trick plays, 2-pt /
  // onside, clock, momentum, play-type mix, ejections).
  const ST = { krAtt:0, krYds:0, krTd:0, prAtt:0, prYds:0, prTd:0, muff:0 };
  const TR = { reverse:0, option:0, flea:0, fakePunt:0, fakeFg:0 };
  const SIT2 = { twoAtt:0, onside:0, onsideRec:0, kneel:0, spike:0, mom:0, pa:0 };
  const PTYPE = {};                       // pass concept → count
  let SCRpass = 0, PASSN = 0;             // screen rate denominator

  // ── PER-PLAY YARDAGE DISTRIBUTIONS ──
  // Histogram buckets (yardage). Negative bucket -> stuff (rare big losses go
  // into the -3 floor); zero is its own bucket; positives split into short /
  // medium / chunk / explosive. Mirrored buckets for runs and catches so the
  // two distributions are directly comparable.
  const YD_BUCKETS = [
    { lo: -99, hi: -1, label: "loss" },
    { lo:   0, hi:  0, label: "0" },
    { lo:   1, hi:  3, label: "1-3" },
    { lo:   4, hi:  9, label: "4-9" },
    { lo:  10, hi: 19, label: "10-19" },
    { lo:  20, hi: 39, label: "20-39" },
    { lo:  40, hi: 99, label: "40+" },
  ];
  function _ydBucket(y) {
    for (let i = 0; i < YD_BUCKETS.length; i++) {
      const b = YD_BUCKETS[i];
      if (y >= b.lo && y <= b.hi) return i;
    }
    return -1;
  }
  // Two parallel grids: [bucket][down] count. Down 1-4; "all" = down 0.
  const _newGrid = () => YD_BUCKETS.map(() => [0, 0, 0, 0, 0]);  // index 0 = all downs
  const RUN_HIST = _newGrid();    // run yardage (excludes sacks)
  const CMP_HIST = _newGrid();    // completion yardage (sacks/incompletes excluded)

  // 3rd-down conversion rate by distance bucket. NFL benchmarks:
  // short (≤2): ~70%, medium (3-6): ~45%, long (7-10): ~30%, xlong (≥11): ~15-20%.
  // Per-play count: attempt = any 3rd-down play; conv = yards gained >= ytg.
  // (Penalties / kneels excluded — we already filter to pass+run plays above.)
  const TD_DIST = {
    short:  { att: 0, conv: 0 },
    medium: { att: 0, conv: 0 },
    long:   { att: 0, conv: 0 },
    xlong:  { att: 0, conv: 0 },
  };
  function _tdBucket(ytg) {
    return ytg <= 2 ? "short" : ytg <= 6 ? "medium" : ytg <= 10 ? "long" : "xlong";
  }

  const t0 = Date.now();
  for (let s = 0; s < SEASONS; s++) {
    const rosters = {};
    for (const t of TEAMS) rosters[t.id] = buildRoster(t);
    for (let i = 0; i < TEAMS.length; i++) {
      for (let j = i + 1; j < TEAMS.length; j++) {
        const h = TEAMS[i], a = TEAMS[j];
        const sim = new GameSimulator(h, a, rosters[h.id], rosters[a.id]);
        const r = sim.simulate();
        lb.games++; lb.ptsSum += (r.homeScore + r.awayScore);
        game_margin.push(Math.abs(r.homeScore - r.awayScore));
        // End-of-game fatigue by starter position (read off the sim instance).
        const _fat = sim._fatigue || {};
        for (const sid of [h.id, a.id]) {
          const byPos = {};
          for (const pl of rosters[sid]) (byPos[pl.position] || (byPos[pl.position] = [])).push(pl);
          for (const Pn in FT) {
            const arr = byPos[Pn]; if (!arr || !arr.length) continue;
            const starter = arr.reduce((b,p)=>(p.overall||0)>(b.overall||0)?p:b);
            FT[Pn].push(_fat[starter.name] || 0);
          }
        }
        const _wxL = (sim.weather && sim.weather.label) || "CLEAR";
        const _wx = _wxInit(_wxL);
        for (const side of ["home","away"]) {
          const tm = r.stats[side].team;
          const pts = side==="home" ? r.homeScore : r.awayScore;
          // name→OVR for this side's roster, so per-position OVR can be reported.
          const _sideRoster = side==="home" ? rosters[h.id] : rosters[a.id];
          const _ovrByName = {};
          for (const _p of _sideRoster) _ovrByName[_p.name] = _p.overall || 0;
          let teamInt = 0;
          for (const p of Object.values(r.stats[side].players)) teamInt += (p.pass_int||0);
          // Sums (for means + rate denominators)
          lb.totalYds += tm.totalYds; lb.passYds += tm.passYds; lb.rushYds += tm.rushYds;
          lb.sacks += tm.sacks; lb.sacks_allowed += tm.sacks_allowed;
          lb.turnovers += tm.turnovers; lb.takeaways += tm.takeaways;
          lb.firstDowns += tm.firstDowns;
          lb.pass_comp += tm.pass_comp; lb.pass_att += tm.pass_att; lb.rush_att += tm.rush_att;
          lb.penalties += (tm.penalties||0); lb.penaltyYds += (tm.penaltyYds||0);
          lb.intThrown += teamInt;
          for (const _b of ["short","mid","deep"]) { lb["pa_"+_b]=(lb["pa_"+_b]||0)+(tm["pa_"+_b]||0); lb["pc_"+_b]=(lb["pc_"+_b]||0)+(tm["pc_"+_b]||0); }
          // ── Per-playbook (offense) + per-weather accumulation ──
          const _offTeam = side==="home" ? h : a;
          const _pb = _pbInit(_offTeam.playbook || "BALANCED");
          _pb.g++; _pb.plays += (tm.plays||0); _pb.passYds += tm.passYds; _pb.rushYds += tm.rushYds;
          _pb.pAtt += tm.pass_att; _pb.rAtt += tm.rush_att; _pb.comp += tm.pass_comp;
          _pb.pts += pts; _pb.sacksAllowed += (tm.sacks_allowed||0);
          _wx.g++; _wx.passYds += tm.passYds; _wx.rushYds += tm.rushYds;
          _wx.pAtt += tm.pass_att; _wx.comp += tm.pass_comp; _wx.pts += pts;
          const _co = _coInit(_coKey(_offTeam));
          _co.g++; _co.fourthAtt += (tm.fourthAtt||0); _co.fourthConv += (tm.fourthConv||0); _co.pts += pts;
          // Situational (team stats)
          lb.thirdAtt += (tm.thirdAtt||0); lb.thirdConv += (tm.thirdConv||0);
          lb.fourthAtt += (tm.fourthAtt||0); lb.fourthConv += (tm.fourthConv||0);
          lb.rzAtt += (tm.rz_att||0); lb.rzTD += (tm.rz_td||0);
          // Kicking / ST (player lines) + per-position starter detection
          const posLeader = {};   // POS → best line this team-game by sigStat
          for (const p of Object.values(r.stats[side].players)) {
            lb.fgMade += (p.fg_made||0); lb.fgAtt += (p.fg_att||0);
            lb.xpMade += (p.xp_made||0); lb.xpAtt += (p.xp_att||0);
            lb.puntAtt += (p.punt_att||0); lb.puntYds += (p.punt_yds||0);
            _wx.fum += (p.fumbles||0); _wx.fgM += (p.fg_made||0); _wx.fgA += (p.fg_att||0);
            ST.krAtt += (p.kr_att||0); ST.krYds += (p.kr_yds||0); ST.krTd += (p.kr_td||0);
            ST.prAtt += (p.pr_att||0); ST.prYds += (p.pr_yds||0); ST.prTd += (p.pr_td||0);
            const P = normPos(p.pos);
            if (pp[P]) {
              const stat = sigStat[P];
              if (!posLeader[P] || (p[stat]||0) > (posLeader[P][stat]||0)) posLeader[P] = p;
            }
          }
          for (const P in posLeader) { posLeader[P]._ovr = _ovrByName[posLeader[P].name] || 0; pp[P].push(posLeader[P]); }
          lb.teamGames++;
          // Per-team-game arrays (for quantiles + event rates)
          tg_pts.push(pts);
          tg_totalYds.push(tm.totalYds); tg_passYds.push(tm.passYds); tg_rushYds.push(tm.rushYds);
          tg_firstDowns.push(tm.firstDowns); tg_sacks.push(tm.sacks);
          tg_turnovers.push(tm.turnovers); tg_penalties.push(tm.penalties||0);
          tg_penaltyYds.push(tm.penaltyYds||0); tg_intThrown.push(teamInt);
          tg_passAtt.push(tm.pass_att); tg_passComp.push(tm.pass_comp); tg_rushAtt.push(tm.rush_att);
        }
        // ── Drive-level (game-level, both teams) ──
        // Drives carry running homeScore/awayScore; the delta vs the prior
        // drive tells us this drive's points + outcome (FG vs TD vs none).
        // "FG/Punt/TO" is lumped by the engine, so we re-derive: +3 → FG,
        // +6/7/8 → TD, 0 → punt-or-TO (we don't separate those two here).
        const drv = r.full?.drives || r.drives || [];
        let prevH = 0, prevA = 0;
        for (const d of drv) {
          lb.drives++;
          const dH = (d.homeScore||0) - prevH, dA = (d.awayScore||0) - prevA;
          prevH = d.homeScore||0; prevA = d.awayScore||0;
          const off = d.team;  // "home"/"away" — points scored BY this drive's offense
          const ptsThis = off === "home" ? dH : dA;
          const oppPts  = off === "home" ? dA : dH;  // def/return TD against
          lb.drivePts += Math.max(0, ptsThis);
          if (d.result === "TD") lb.driveTDs++;
          else if (ptsThis === 3) lb.driveFGs++;
          else if (d.result === "TURNOVER_ON_DOWNS" || oppPts > 0) lb.driveTOs++;
          else lb.driveOther++;  // punt or non-scoring TO (lumped by engine)
        }
        // 3-and-outs + OT from the play log
        const plays = r.full?.plays || r.plays || [];
        if (plays.some(p => p.qtr === 5 || p.quarter === 5 || /\bOT\b|overtime/i.test(p.desc||""))) lb.otGames++;
        // FG by distance from play log
        for (const p of plays) {
          if (p.kind === "fg_good" || p.kind === "fg_miss" || p.kind === "fg_blocked") {
            const dist = p.fgDist || 0, made = p.kind === "fg_good";
            if (dist < 40)      { lb.fg0_39_a++; if (made) lb.fg0_39_m++; }
            else if (dist < 50) { lb.fg40_49_a++; if (made) lb.fg40_49_m++; }
            else                { lb.fg50_a++; if (made) lb.fg50_m++; }
          }
          // Per-play scheme tagging (defensive package / personnel / coverage)
          const k = p.kind;
          // Rare-event + situational counters — ALL play kinds, before the
          // run/pass filter so kickoffs / kneels / spikes / momentum aren't skipped.
          if      (k === "muff")     ST.muff++;
          else if (k === "kneel")    SIT2.kneel++;
          else if (k === "spike")    SIT2.spike++;
          else if (k === "momentum") SIT2.mom++;
          if (p.isReverse)     TR.reverse++;
          if (p.isSpeedOption) TR.option++;
          if (p.isFakePunt)    TR.fakePunt++;
          if (p.isFleaFlicker) TR.flea++;
          if (p.isOnside)      { SIT2.onside++; if (p.onsideRecovered) SIT2.onsideRec++; }
          if (/fake (field goal|fg)\b/i.test(p.desc||"")) TR.fakeFg++;
          if (/2-?point conversion|2-?pt conversion|goes for (2|two)/i.test(p.desc||"")) SIT2.twoAtt++;
          const isPass = k === "complete" || k === "incomplete" || k === "sack";
          const isRun  = k === "run" || k === "scramble";
          if (!isPass && !isRun) continue;
          const yds = p.yards || 0;
          const qn = p.quarter || p.qtr; if (qn) { const qf = _qfI(qn); qf.plays++; qf.yds += yds; }
          // Per-play yardage histogram by down. Runs include scrambles; pass
          // completions only (sacks/incompletes excluded — different question).
          {
            const dn = p.down || 0;                  // 1-4 valid; 0 = unknown
            const downIdx = (dn >= 1 && dn <= 4) ? dn : 0;
            if (isRun) {
              const bi = _ydBucket(yds);
              if (bi >= 0) { RUN_HIST[bi][0]++; if (downIdx) RUN_HIST[bi][downIdx]++; }
            } else if (k === "complete") {
              const bi = _ydBucket(yds);
              if (bi >= 0) { CMP_HIST[bi][0]++; if (downIdx) CMP_HIST[bi][downIdx]++; }
            }
            // 3rd-down conversion bucket — counts attempts and successes by
            // distance. Conv = play that gained the ytg (incl. by sack/incomplete
            // it's auto-fail since yds <= 0).
            if (dn === 3) {
              const tg = p.ytg || 10;
              const buck = _tdBucket(tg);
              TD_DIST[buck].att++;
              if (yds >= tg) TD_DIST[buck].conv++;
            }
          }
          if (p.concept) { PTYPE[p.concept] = (PTYPE[p.concept]||0) + 1; PASSN++; if (p.isScreen || p.concept === "SCREEN") SCRpass++; if (p.isPlayAction) SIT2.pa++; }
          const dp = _dpI(p.defPackage || "BASE_43");
          dp.plays++; dp.yds += yds;
          if (isPass) { if (k === "sack") dp.sk++; else { dp.patt++; if (k === "complete") dp.comp++; } }
          const pn = _pnI(p.personnel || "BASE");
          pn.plays++; pn.yds += yds; if (isPass && k !== "sack") pn.patt++;
          if (isPass && k !== "sack" && p.coverage) {
            const cv = _cvI(p.coverage); cv.att++; if (k === "complete") { cv.comp++; cv.yds += yds; }
          }
        }
      }
    }
    if ((s+1) % 5 === 0) console.error("  ..."+(s+1)+"/"+SEASONS+" seasons ("+lb.games+" games, "+((Date.now()-t0)/1000).toFixed(0)+"s)");
  }

  const tg = lb.teamGames;
  const g = {
    pts: lb.ptsSum / lb.games / 2,
    totalYds: lb.totalYds/tg, passYds: lb.passYds/tg, rushYds: lb.rushYds/tg,
    firstDowns: lb.firstDowns/tg, sacks: lb.sacks/tg, turnovers: lb.turnovers/tg,
    penalties: lb.penalties/tg, penaltyYds: lb.penaltyYds/tg,
    compPct: lb.pass_att ? lb.pass_comp/lb.pass_att*100 : 0,
    ypc: lb.rush_att ? lb.rushYds/lb.rush_att : 0,
    intRate: lb.pass_att ? lb.intThrown/lb.pass_att*100 : 0,
    // Efficiency / pace — total plays = pass attempts + rush attempts (sacks
    // count as pass plays via pass_att in NFL accounting and our engine).
    // ptsSum is per-game-both-teams, so divide by 2 for per-team.
    playsPerGame: tg ? (lb.pass_att + lb.rush_att) / tg : 0,
    ypp: (lb.pass_att + lb.rush_att) ? lb.totalYds / (lb.pass_att + lb.rush_att) : 0,
    // ptsSum is per-game (both teams); pass_att+rush_att is summed per
    // team-game (also both teams). Same scale → NO /2 (an earlier /2 halved
    // this to ~0.20 and false-flagged it; true all-snap NFL ppp ~0.36-0.41).
    ppp: (lb.pass_att + lb.rush_att) ? lb.ptsSum / (lb.pass_att + lb.rush_att) : 0,
    ypComp: lb.pass_comp ? lb.passYds / lb.pass_comp : 0,
  };
  const B = [
    ["Points / game", g.pts, 17, 27, v=>v.toFixed(1)],
    ["Total yds / game", g.totalYds, 290, 380, v=>v.toFixed(0)],
    ["Pass yds / game", g.passYds, 190, 270, v=>v.toFixed(0)],
    ["Rush yds / game", g.rushYds, 90, 145, v=>v.toFixed(0)],
    ["Completion %", g.compPct, 58, 69, v=>v.toFixed(1)+"%"],
    ["Yards / carry", g.ypc, 3.9, 4.9, v=>v.toFixed(2)],
    ["INT rate / att", g.intRate, 1.8, 3.4, v=>v.toFixed(2)+"%"],
    ["Sacks / game", g.sacks, 1.6, 3.3, v=>v.toFixed(2)],
    ["Turnovers / game", g.turnovers, 0.9, 2.1, v=>v.toFixed(2)],
    ["First downs / game", g.firstDowns, 16, 24, v=>v.toFixed(1)],
    ["Penalties / game", g.penalties, 4, 8, v=>v.toFixed(2)],
    ["Penalty yds / game", g.penaltyYds, 35, 70, v=>v.toFixed(0)],
    // Efficiency block — NFL refs: plays/game ~63, ypp ~5.4, ppp ~0.36, yds/comp ~11
    ["Plays / game", g.playsPerGame, 58, 68, v=>v.toFixed(1)],
    ["Yards / play", g.ypp, 5.0, 6.0, v=>v.toFixed(2)],
    ["Points / play", g.ppp, 0.30, 0.42, v=>v.toFixed(3)],
    ["Yards / completion", g.ypComp, 10.0, 12.5, v=>v.toFixed(1)],
  ];
  let nOk = 0;
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" NFL REALISM AUDIT — "+SEASONS+" seasons · "+lb.games.toLocaleString()+" games · "+lb.teamGames.toLocaleString()+" team-games");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(22)+" "+"SIM".padStart(9)+"   "+"NFL BAND".padStart(13)+"  FLAG");
  console.log(" "+"-".repeat(54));
  for (const [label,val,lo,hi,fmt] of B) {
    const ok = val>=lo && val<=hi; if (ok) nOk++;
    const band = fmt(lo).replace("%","")+"-"+fmt(hi);
    console.log(" "+label.padEnd(22)+" "+fmt(val).padStart(9)+"   "+band.padStart(13)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(54));
  console.log(" "+nOk+"/"+B.length+" in range");

  // ============== DISTRIBUTION TABLE — P10/P50/P90 + min/max ==============
  // Quantile picks the lower-of-two index (no interpolation) — fine at this
  // sample size and avoids float fuzz when comparing to NFL reference points.
  function q(arr, p) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a,b)=>a-b);
    return sorted[Math.min(sorted.length-1, Math.floor(p * sorted.length))];
  }
  function mn(arr) { return arr.length ? Math.min(...arr) : 0; }
  function mx(arr) { return arr.length ? Math.max(...arr) : 0; }
  function std(arr, mean) {
    if (arr.length < 2) return 0;
    let s = 0; for (const v of arr) s += (v - mean)*(v - mean);
    return Math.sqrt(s / (arr.length - 1));
  }
  // NFL reference: P10 / P50 / P90 per team-game from recent seasons.
  // Sources: NFL.com 2018-2023 team game logs aggregated; rough but useful.
  const D = [
    // [label, arr, mean, fmt, nflP10, nflP50, nflP90]
    ["Points",       tg_pts,        g.pts,        v=>v.toFixed(0),  10,  22,  37],
    ["Total yds",    tg_totalYds,   g.totalYds,   v=>v.toFixed(0), 250, 345, 450],
    ["Pass yds",     tg_passYds,    g.passYds,    v=>v.toFixed(0), 140, 235, 340],
    ["Rush yds",     tg_rushYds,    g.rushYds,    v=>v.toFixed(0),  55, 115, 190],
    ["First downs",  tg_firstDowns, g.firstDowns, v=>v.toFixed(0),  12,  20,  28],
    ["Sacks",        tg_sacks,      g.sacks,      v=>v.toFixed(0),   0,   2,   5],
    ["Turnovers",    tg_turnovers,  g.turnovers,  v=>v.toFixed(0),   0,   1,   3],
    ["Penalties",    tg_penalties,  g.penalties,  v=>v.toFixed(0),   2,   6,  10],
    ["Penalty yds",  tg_penaltyYds, g.penaltyYds, v=>v.toFixed(0),  15,  50,  90],
  ];
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" DISTRIBUTION — sim P10 / median / P90 vs NFL reference");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(13)+"  "+"P10".padStart(4)+"  "+"P50".padStart(4)+"  "+"P90".padStart(4)+"  "+"min/max".padStart(9)+"  "+"std".padStart(4)+"   "+"NFL P10/P50/P90");
  console.log(" "+"-".repeat(70));
  for (const [label, arr, mean, fmt, n10, n50, n90] of D) {
    const sP10 = q(arr,0.10), sP50 = q(arr,0.50), sP90 = q(arr,0.90);
    const sd = std(arr, mean);
    const mm = fmt(mn(arr))+"/"+fmt(mx(arr));
    const nflRef = n10+"/"+n50+"/"+n90;
    console.log(" "+label.padEnd(13)+"  "+fmt(sP10).padStart(4)+"  "+fmt(sP50).padStart(4)+"  "+fmt(sP90).padStart(4)+"  "+mm.padStart(9)+"  "+sd.toFixed(0).padStart(4)+"   "+nflRef);
  }

  // ============== EVENT RATES — shape sanity checks ==============
  const shutoutPct  = tg_pts.filter(v=>v===0).length / tg_pts.length * 100;
  const big40Pct    = tg_pts.filter(v=>v>=40).length / tg_pts.length * 100;
  const margin14Pct = game_margin.filter(v=>v>=14).length / game_margin.length * 100;
  const margin21Pct = game_margin.filter(v=>v>=21).length / game_margin.length * 100;
  const multiIntPct = tg_intThrown.filter(v=>v>=2).length / tg_intThrown.length * 100;
  const totalPassAtt = tg_passAtt.reduce((s,v)=>s+v,0);
  const totalRushAtt = tg_rushAtt.reduce((s,v)=>s+v,0);
  const passShare = totalPassAtt / (totalPassAtt + totalRushAtt) * 100;
  // Yards per pass attempt (gross — NFL net-YPA adjusts for sacks but our
  // tm.passYds already excludes sack yardage by convention, so this is close).
  const ypa = lb.pass_att ? lb.passYds / lb.pass_att : 0;
  // Median game margin — pure distributional measure of competitiveness
  const marginMedian = q(game_margin, 0.50);
  const E = [
    ["Shutout rate (team-games at 0 pts)", shutoutPct.toFixed(2)+"%", "1.0-2.5%", shutoutPct>=1.0 && shutoutPct<=2.5],
    ["40+ pt games (team-games >=40)",     big40Pct.toFixed(2)+"%",   "3.0-7.0%", big40Pct>=3.0 && big40Pct<=7.0],
    ["Games with margin >=14",             margin14Pct.toFixed(1)+"%","40-55%",   margin14Pct>=40 && margin14Pct<=55],
    ["Games with margin >=21 (blowouts)",  margin21Pct.toFixed(1)+"%","20-32%",   margin21Pct>=20 && margin21Pct<=32],
    ["Median game margin (pts)",           marginMedian.toFixed(0),   "9-13",     marginMedian>=9 && marginMedian<=13],
    ["Multi-INT team-games (>=2 picks)",   multiIntPct.toFixed(2)+"%","8-14%",    multiIntPct>=8 && multiIntPct<=14],
    ["Pass share of plays",                passShare.toFixed(1)+"%",  "55-62%",   passShare>=55 && passShare<=62],
    ["Yards / pass attempt",               ypa.toFixed(2),            "6.6-7.4",  ypa>=6.6 && ypa<=7.4],
  ];
  let eOk = 0;
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" EVENT RATES — shape checks (catch bugs that means hide)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(38)+"  "+"SIM".padStart(8)+"   "+"NFL BAND".padStart(10)+"  FLAG");
  console.log(" "+"-".repeat(70));
  for (const [label, val, band, ok] of E) {
    if (ok) eOk++;
    console.log(" "+label.padEnd(38)+"  "+String(val).padStart(8)+"   "+band.padStart(10)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(70));
  console.log(" "+eOk+"/"+E.length+" in range\\n");

  // ============== TIER 1+2: DRIVE / SITUATIONAL / KICKING ==============
  // Per-DRIVE denominators. lb.drives counts both teams' drives across all
  // games; per-team-game drive count = lb.drives / lb.teamGames.
  const drv = lb.drives || 1;
  const D2 = [
    ["Drives / team-game", lb.drives/lb.teamGames, 10.5, 12.5, v=>v.toFixed(1)],
    ["Points / drive", lb.drivePts/drv, 1.6, 2.3, v=>v.toFixed(2)],
    ["Yards / drive", lb.totalYds/drv, 28, 36, v=>v.toFixed(1)],
    ["TD / drive", lb.driveTDs/drv*100, 18, 26, v=>v.toFixed(1)+"%"],
    ["FG / drive", lb.driveFGs/drv*100, 9, 18, v=>v.toFixed(1)+"%"],
    ["Punt+TO / drive", (lb.driveOther+lb.driveTOs)/drv*100, 48, 62, v=>v.toFixed(1)+"%"],
    ["3rd-down conv %", lb.thirdAtt?lb.thirdConv/lb.thirdAtt*100:0, 36, 44, v=>v.toFixed(1)+"%"],
    ["4th-down conv %", lb.fourthAtt?lb.fourthConv/lb.fourthAtt*100:0, 45, 60, v=>v.toFixed(1)+"%"],
    ["Red-zone TD %", lb.rzAtt?lb.rzTD/lb.rzAtt*100:0, 52, 66, v=>v.toFixed(1)+"%"],
    ["FG %", lb.fgAtt?lb.fgMade/lb.fgAtt*100:0, 82, 90, v=>v.toFixed(1)+"%"],
    ["  FG 0-39", lb.fg0_39_a?lb.fg0_39_m/lb.fg0_39_a*100:0, 93, 100, v=>v.toFixed(1)+"%"],
    ["  FG 40-49", lb.fg40_49_a?lb.fg40_49_m/lb.fg40_49_a*100:0, 78, 90, v=>v.toFixed(1)+"%"],
    ["  FG 50+", lb.fg50_a?lb.fg50_m/lb.fg50_a*100:0, 55, 75, v=>v.toFixed(1)+"%"],
    ["XP %", lb.xpAtt?lb.xpMade/lb.xpAtt*100:0, 92, 97, v=>v.toFixed(1)+"%"],
    ["Punt avg (yds)", lb.puntAtt?lb.puntYds/lb.puntAtt:0, 43, 48, v=>v.toFixed(1)],
    ["OT game %", lb.otGames/lb.games*100, 4, 10, v=>v.toFixed(1)+"%"],
  ];
  let dOk = 0;
  console.log("══════════════════════════════════════════════════════════");
  console.log(" DRIVE / SITUATIONAL / KICKING");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(22)+" "+"SIM".padStart(9)+"   "+"NFL BAND".padStart(13)+"  FLAG");
  console.log(" "+"-".repeat(60));
  for (const [label,val,lo,hi,fmt] of D2) {
    const ok = val>=lo && val<=hi; if (ok) dOk++;
    const band = fmt(lo).replace("%","")+"-"+fmt(hi);
    console.log(" "+label.padEnd(22)+" "+fmt(val).padStart(9)+"   "+band.padStart(13)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(60));
  console.log(" "+dOk+"/"+D2.length+" in range\\n");

  // ============== PER-POSITION PRODUCTION (per-game, the starter) ==============
  function _q(arr,p){ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); return s[Math.min(s.length-1,Math.floor(p*s.length))]; }
  function _mx(arr){ return arr.length?Math.max(...arr):0; }
  // dist line: "label  P50 / P10 / P90 / max"  for a derived per-line value
  function distLine(label, lines, fn, fmt){
    const vals = lines.map(fn).filter(v=>!isNaN(v));
    fmt = fmt || (v=>v.toFixed(1));
    return label.padEnd(11)+" "+fmt(_q(vals,.5)).padStart(6)+" /"+fmt(_q(vals,.10)).padStart(6)+" /"+fmt(_q(vals,.90)).padStart(6)+" /"+fmt(_mx(vals)).padStart(6);
  }
  function freq(label, lines, pred){ const n=lines.length||1; return label+" "+(lines.filter(pred).length/n*100).toFixed(0)+"%"; }
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PER-POSITION PRODUCTION — per game, the position's starter");
  console.log(" (each row: median / P10 / P90 / max ; n = starter-games)");
  console.log("══════════════════════════════════════════════════════════");
  const QB=pp.QB, RB=pp.RB, WR=pp.WR, TE=pp.TE, DL=pp.DL, LB=pp.LB, CB=pp.CB, S=pp.S, K=pp.K, P=pp.P, OL=pp.OL;
  // Starter OVR by position (these are FRESH-GEN rosters — no development; for
  // the DEVELOPED OVR-by-round + by-position picture see _brady_audit.js).
  console.log(" STARTER OVR by position (median / P10 / P90 / max):");
  for (const Pn of ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]) {
    const ov = pp[Pn].map(l=>l._ovr||0).filter(v=>v>0);
    if (!ov.length) continue;
    console.log("   "+Pn.padEnd(3)+" "+_q(ov,.5).toString().padStart(3)+" / "+_q(ov,.10).toString().padStart(3)+" / "+_q(ov,.90).toString().padStart(3)+" / "+_mx(ov).toString().padStart(3));
  }
  console.log("");
  console.log(" QB  (n="+QB.length+")   NFL starter refs in (parens)");
  console.log("   "+distLine("Comp%", QB, l=>l.pass_att?l.pass_comp/l.pass_att*100:0, v=>v.toFixed(0)+"%")+"   (~63%)");
  console.log("   "+distLine("Pass yds", QB, l=>l.pass_yds||0, v=>v.toFixed(0))+"   (~230)");
  console.log("   "+distLine("Pass TD", QB, l=>l.pass_td||0, v=>v.toFixed(1))+"   (~1.5)");
  console.log("   "+distLine("INT", QB, l=>l.pass_int||0, v=>v.toFixed(1))+"   (~0.7)");
  console.log("   "+freq("300+yd game",QB,l=>(l.pass_yds||0)>=300)+"   "+freq("3+TD",QB,l=>(l.pass_td||0)>=3)+"   "+freq("multi-INT",QB,l=>(l.pass_int||0)>=2));
  // ── PASSING BY AIR DEPTH — dropback attempts by INTENDED depth ──
  (function(){
    const g = (lb.games||1) * 2;   // team-games (both offenses per game)
    const _r = b => { const a=lb["pa_"+b]||0, c=lb["pc_"+b]||0; return { a, c, pct: a? c/a*100 : 0 }; };
    const S=_r("short"), M=_r("mid"), D=_r("deep"), tot=(S.a+M.a+D.a)||1;
    console.log(" PASSING BY AIR DEPTH (dropback att, intended depth; comp% = comp/att at depth)");
    console.log("   depth        att/g   att%   comp%    (NFL ~)");
    console.log("   short (<8) "+(S.a/g).toFixed(1).padStart(6)+(S.a/tot*100).toFixed(0).padStart(6)+"% "+S.pct.toFixed(0).padStart(6)+"%   (~58% / ~74%)");
    console.log("   mid (8-14) "+(M.a/g).toFixed(1).padStart(6)+(M.a/tot*100).toFixed(0).padStart(6)+"% "+M.pct.toFixed(0).padStart(6)+"%   (~27% / ~58%)");
    console.log("   deep (15+) "+(D.a/g).toFixed(1).padStart(6)+(D.a/tot*100).toFixed(0).padStart(6)+"% "+D.pct.toFixed(0).padStart(6)+"%   (~15% / ~45%)");
  })();
  console.log(" RB  (n="+RB.length+")");
  console.log("   "+distLine("Carries", RB, l=>l.rush_att||0, v=>v.toFixed(0))+"   (~16)");
  console.log("   "+distLine("Rush yds", RB, l=>l.rush_yds||0, v=>v.toFixed(0))+"   (~70)");
  console.log("   "+distLine("YPC", RB, l=>l.rush_att?l.rush_yds/l.rush_att:0, v=>v.toFixed(1))+"   (~4.3)");
  console.log("   "+distLine("Rec", RB, l=>l.rec||0, v=>v.toFixed(1))+"   (~3)");
  console.log("   "+freq("100+yd game",RB,l=>(l.rush_yds||0)>=100)+"   "+freq("2+TD",RB,l=>((l.rush_td||0)+(l.rec_td||0))>=2));
  console.log(" WR  (n="+WR.length+")");
  console.log("   "+distLine("Targets", WR, l=>l.rec_tgt||0, v=>v.toFixed(0))+"   (~8)");
  console.log("   "+distLine("Rec", WR, l=>l.rec||0, v=>v.toFixed(1))+"   (~5)");
  console.log("   "+distLine("Rec yds", WR, l=>l.rec_yds||0, v=>v.toFixed(0))+"   (~70)");
  console.log("   "+distLine("Yds/catch", WR, l=>l.rec?l.rec_yds/l.rec:0, v=>v.toFixed(1))+"   (~13)");
  console.log("   "+freq("100+yd game",WR,l=>(l.rec_yds||0)>=100)+"   "+freq("2+TD",WR,l=>(l.rec_td||0)>=2));
  console.log(" TE  (n="+TE.length+")");
  console.log("   "+distLine("Rec", TE, l=>l.rec||0, v=>v.toFixed(1))+"   (~4)");
  console.log("   "+distLine("Rec yds", TE, l=>l.rec_yds||0, v=>v.toFixed(0))+"   (~45)");
  console.log("   "+freq("100+yd game",TE,l=>(l.rec_yds||0)>=100));
  console.log(" DL  (n="+DL.length+")   LB (n="+LB.length+")");
  console.log("   DL "+distLine("Tkl", DL, l=>l.tkl||0, v=>v.toFixed(1))+"  | Sacks "+_q(DL.map(l=>l.sk||0),.5).toFixed(1)+" med, "+_mx(DL.map(l=>l.sk||0))+" max  "+freq("multi-sk",DL,l=>(l.sk||0)>=2));
  console.log("   LB "+distLine("Tkl", LB, l=>l.tkl||0, v=>v.toFixed(1))+"  | Sk "+_q(LB.map(l=>l.sk||0),.5).toFixed(1)+" INT "+_q(LB.map(l=>l.int_made||0),.5).toFixed(1));
  console.log(" CB  (n="+CB.length+")   S (n="+S.length+")");
  console.log("   CB Tkl "+_q(CB.map(l=>l.tkl||0),.5).toFixed(1)+" med | PD "+_q(CB.map(l=>l.pd||0),.5).toFixed(1)+" med/"+_mx(CB.map(l=>l.pd||0))+" max | "+freq("INT game",CB,l=>(l.int_made||0)>=1));
  console.log("   S  Tkl "+_q(S.map(l=>l.tkl||0),.5).toFixed(1)+" med | INT "+freq("game",S,l=>(l.int_made||0)>=1)+" | PD "+_q(S.map(l=>l.pd||0),.5).toFixed(1)+" med");
  console.log(" K  (n="+K.length+")   P (n="+P.length+")");
  console.log("   K  FG made "+_q(K.map(l=>l.fg_made||0),.5).toFixed(1)+"/g (max "+_mx(K.map(l=>l.fg_made||0))+") | long "+_mx(K.map(l=>l.fg_long||0)));
  console.log("   P  Punts "+_q(P.map(l=>l.punt_att||0),.5).toFixed(1)+"/g | avg "+(()=>{const a=P.filter(l=>l.punt_att);return a.length?(a.reduce((s,l)=>s+l.punt_yds,0)/a.reduce((s,l)=>s+l.punt_att,0)).toFixed(1):"0";})()+" | long "+_mx(P.map(l=>l.punt_long||0)));
  console.log(" OL  (n="+OL.length+")   Pancakes "+_q(OL.map(l=>l.pancakes||0),.5).toFixed(1)+" med/"+_mx(OL.map(l=>l.pancakes||0))+" max");
  console.log("");

  // ============== PLAYBOOK BREAKDOWN — scheme differentiation ==============
  // Each team runs its real offensive playbook; this shows whether the 5
  // schemes produce distinct, NFL-shaped profiles (AIR_RAID pass-heavy,
  // GROUND_AND_POUND run-heavy, OPTION/DUAL_THREAT run-leaning, etc.).
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PLAYBOOK BREAKDOWN (offense) — per team-game by scheme");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"SCHEME".padEnd(16)+"PASS%".padStart(6)+"pYDS".padStart(7)+"rYDS".padStart(7)+"Y/PLAY".padStart(8)+"PTS".padStart(6)+"SKall".padStart(7));
  console.log("   "+"-".repeat(57));
  for (const [id, s] of Object.entries(PB).sort((a,b)=>b[1].g-a[1].g)) {
    if (!s.g) continue;
    const passShare = 100*s.pAtt/Math.max(1,(s.pAtt+s.rAtt));
    const ypp = (s.passYds+s.rushYds)/Math.max(1,s.plays);
    console.log("   "+id.padEnd(16)+passShare.toFixed(1).padStart(6)+(s.passYds/s.g).toFixed(0).padStart(7)
      +(s.rushYds/s.g).toFixed(0).padStart(7)+ypp.toFixed(2).padStart(8)+(s.pts/s.g).toFixed(1).padStart(6)
      +(s.sacksAllowed/s.g).toFixed(2).padStart(7));
  }

  // ============== WEATHER BREAKDOWN — environment effects ==============
  // Verifies weather actually moves the game: RAIN/SNOW should cut completion%
  // and lift fumbles; wind/snow should drop FG%.
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" WEATHER BREAKDOWN — per team-game by condition");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"WEATHER".padEnd(10)+"share".padStart(7)+"CMP%".padStart(7)+"pYDS".padStart(7)+"rYDS".padStart(7)+"PTS".padStart(6)+"FUM/g".padStart(7)+"FG%".padStart(7));
  console.log("   "+"-".repeat(58));
  const _wxTot = Object.values(WX).reduce((n,s)=>n+s.g,0)||1;
  for (const [lab, s] of Object.entries(WX).sort((a,b)=>b[1].g-a[1].g)) {
    if (!s.g) continue;
    console.log("   "+lab.padEnd(10)+(100*s.g/_wxTot).toFixed(1).padStart(7)+(100*s.comp/Math.max(1,s.pAtt)).toFixed(1).padStart(7)
      +(s.passYds/s.g).toFixed(0).padStart(7)+(s.rushYds/s.g).toFixed(0).padStart(7)+(s.pts/s.g).toFixed(1).padStart(6)
      +(s.fum/s.g).toFixed(3).padStart(7)+(100*s.fgM/Math.max(1,s.fgA)).toFixed(1).padStart(7));
  }

  // ============== COACHING BREAKDOWN — HC trait → gameplay ==============
  // Each team got a franchise HC specialtyTrait; this confirms the trait moves
  // 4th-down aggression (Riverboat goes for it most, Conservative least).
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" COACHING BREAKDOWN — 4th-down aggression by HC trait");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"HC TRAIT".padEnd(20)+"4thGo/g".padStart(9)+"conv%".padStart(8)+"PTS/g".padStart(8));
  const _coOrder = { "Riverboat Gambler":0, "Neutral":1, "Game Manager":2, "Conservative":3 };
  for (const [k, s] of Object.entries(CO).sort((a,b)=>(_coOrder[a[0]]??9)-(_coOrder[b[0]]??9))) {
    if (!s.g) continue;
    console.log("   "+k.padEnd(20)+(s.fourthAtt/s.g).toFixed(2).padStart(9)
      +(100*s.fourthConv/Math.max(1,s.fourthAtt)).toFixed(0).padStart(7)+"%"+(s.pts/s.g).toFixed(1).padStart(8));
  }

  // ====== DEFENSIVE SCHEME / PERSONNEL / COVERAGE (per-play) ======
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" DEFENSIVE SCHEME BREAKDOWN (per play faced)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"PACKAGE".padEnd(14)+"plays%".padStart(8)+"Y/PLAY".padStart(8)+"CMP%".padStart(7)+"SK%".padStart(7));
  const _dpTot = Object.values(DP).reduce((n,s)=>n+s.plays,0)||1;
  for (const [k,s] of Object.entries(DP).sort((a,b)=>b[1].plays-a[1].plays)) {
    if (s.plays<50) continue;
    console.log("   "+k.padEnd(14)+(100*s.plays/_dpTot).toFixed(1).padStart(8)+(s.yds/s.plays).toFixed(2).padStart(8)
      +(100*s.comp/Math.max(1,s.patt)).toFixed(1).padStart(7)+(100*s.sk/Math.max(1,s.plays)).toFixed(1).padStart(7));
  }
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PERSONNEL BREAKDOWN (offense, per play)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"PERSONNEL".padEnd(14)+"plays%".padStart(8)+"Y/PLAY".padStart(8)+"PASS%".padStart(7));
  const _pnTot = Object.values(PN).reduce((n,s)=>n+s.plays,0)||1;
  for (const [k,s] of Object.entries(PN).sort((a,b)=>b[1].plays-a[1].plays)) {
    if (s.plays<50) continue;
    console.log("   "+k.padEnd(14)+(100*s.plays/_pnTot).toFixed(1).padStart(8)+(s.yds/s.plays).toFixed(2).padStart(8)
      +(100*s.patt/Math.max(1,s.plays)).toFixed(1).padStart(7));
  }
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" COVERAGE BREAKDOWN (per completion — which shell gets beaten deepest)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   (coverage is logged only on completions, so comp%-allowed isn't");
  console.log("    derivable from the log — Y/CMP is the reliable softness signal)");
  console.log("   "+"COVERAGE".padEnd(14)+"cmp%".padStart(8)+"Y/CMP".padStart(8));
  const _cvTot = Object.values(CV).reduce((n,s)=>n+s.comp,0)||1;
  for (const [k,s] of Object.entries(CV).sort((a,b)=>b[1].comp-a[1].comp)) {
    if (s.comp<50) continue;
    console.log("   "+k.padEnd(14)+(100*s.comp/_cvTot).toFixed(1).padStart(8)+(s.yds/Math.max(1,s.comp)).toFixed(2).padStart(8));
  }

  // ============== FATIGUE / WEAR — end-game fatigue + per-quarter ==============
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" FATIGUE BREAKDOWN — starter end-of-game fatigue (0-100) by position");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   (workhorse RB should end ~60-70; low-snap positions stay low)");
  console.log("   "+"POS".padEnd(6)+"med".padStart(6)+"P90".padStart(6)+"max".padStart(6));
  for (const Pn of ["QB","RB","WR","TE","OL","DL","LB","CB","S"]) {
    const a = FT[Pn]; if (!a || !a.length) continue;
    console.log("   "+Pn.padEnd(6)+_q(a,.5).toFixed(0).padStart(6)+_q(a,.9).toFixed(0).padStart(6)+_mx(a).toFixed(0).padStart(6));
  }
  console.log(" PER-QUARTER efficiency (fatigue tax should make Q4 dip slightly):");
  console.log("   "+"QTR".padEnd(6)+"Y/PLAY".padStart(8)+"plays".padStart(8));
  for (const q of Object.keys(QF).sort((a,b)=>a-b)) {
    const s = QF[q]; if (!s.plays) continue;
    console.log("   "+("Q"+q).padEnd(6)+(s.yds/s.plays).toFixed(2).padStart(8)+String(s.plays).padStart(8));
  }

  // ============== SPECIAL TEAMS RETURNS ==============
  const _gp = lb.games || 1;
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" SPECIAL TEAMS RETURNS (per game, both teams)  NFL refs in (parens)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   Kick returns:  "+(ST.krAtt/_gp).toFixed(1)+"/g  avg "+(ST.krYds/Math.max(1,ST.krAtt)).toFixed(1)+" (~22)  TD "+(ST.krTd/Math.max(1,_gp)).toFixed(3)+"/g");
  console.log("   Punt returns:  "+(ST.prAtt/_gp).toFixed(1)+"/g  avg "+(ST.prYds/Math.max(1,ST.prAtt)).toFixed(1)+" (~9)   TD "+(ST.prTd/Math.max(1,_gp)).toFixed(3)+"/g");
  console.log("   Muffs: "+(ST.muff/_gp).toFixed(3)+"/g");

  // ============== TRICK PLAYS & SITUATIONAL ==============
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" TRICK PLAYS & SITUATIONAL (per game unless noted)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   Reverses "+(TR.reverse/_gp).toFixed(3)+"  SpeedOption "+(TR.option/_gp).toFixed(2)+"  FleaFlicker "+(TR.flea/_gp).toFixed(3)+"  FakePunt "+(TR.fakePunt/_gp).toFixed(3)+"  FakeFG "+(TR.fakeFg/_gp).toFixed(3));
  console.log("   2-pt att "+(SIT2.twoAtt/_gp).toFixed(3)+"/g   Onside "+(SIT2.onside/_gp).toFixed(3)+"/g  recov% "+(100*SIT2.onsideRec/Math.max(1,SIT2.onside)).toFixed(0)+"   PlayAction "+(100*SIT2.pa/Math.max(1,PASSN)).toFixed(1)+"% of pass");
  console.log("   Kneels "+(SIT2.kneel/_gp).toFixed(2)+"/g  Spikes "+(SIT2.spike/_gp).toFixed(2)+"/g  Momentum swings "+(SIT2.mom/_gp).toFixed(2)+"/g");
  const _ej = (typeof globalThis.franchise!=="undefined" && globalThis.franchise._ejectionLog)
    ? Object.values(globalThis.franchise._ejectionLog).reduce((n,a)=>n+(a?a.length:0),0) : 0;
  console.log("   Ejections "+(_ej/_gp).toFixed(4)+"/g ("+_ej+" total — HEADHUNTER big-hit mechanic)");

  // ============== PLAY-TYPE MIX (pass concepts) ==============
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PLAY-TYPE MIX — pass concept distribution (% of pass plays)");
  console.log("══════════════════════════════════════════════════════════");
  for (const [c,n] of Object.entries(PTYPE).sort((a,b)=>b[1]-a[1])) {
    console.log("   "+c.padEnd(14)+(100*n/Math.max(1,PASSN)).toFixed(1).padStart(6)+"%");
  }
  console.log("   (screens "+(100*SCRpass/Math.max(1,PASSN)).toFixed(1)+"% of pass plays)");
  console.log("");

  // ============== YARDAGE DISTRIBUTION — per play, by down ==============
  function _printHist(label, grid) {
    const totalAll = grid.reduce((s, r) => s + r[0], 0) || 1;
    const totalsByDown = [0,0,0,0,0];
    for (const r of grid) for (let d = 0; d < 5; d++) totalsByDown[d] += r[d];
    for (let d = 0; d < 5; d++) totalsByDown[d] = totalsByDown[d] || 1;
    console.log("══════════════════════════════════════════════════════════");
    console.log(" " + label + " (% of plays in each bucket; n=" + totalAll + ")");
    console.log("══════════════════════════════════════════════════════════");
    const head = "  " + "BUCKET".padEnd(7) + "ALL".padStart(7) + "1st".padStart(7) + "2nd".padStart(7) + "3rd".padStart(7) + "4th".padStart(7) + "  hist (ALL)";
    console.log(head);
    console.log("  " + "-".repeat(head.length - 2));
    for (let i = 0; i < YD_BUCKETS.length; i++) {
      const row = grid[i];
      const pctAll = 100 * row[0] / totalAll;
      const cells = [
        ("  " + YD_BUCKETS[i].label).padEnd(7),
        pctAll.toFixed(1).padStart(6) + "%",
      ];
      for (let d = 1; d <= 4; d++) cells.push((100 * row[d] / totalsByDown[d]).toFixed(1).padStart(6) + "%");
      // Visual bar — capped 40 chars at 100%, scaled by ALL%.
      const bar = "█".repeat(Math.min(40, Math.round(pctAll * 0.8)));
      console.log(cells.join("") + "  " + bar);
    }
    // Quick summary stats per down (mean, % of plays gaining 10+).
    const meanByDown = [0,0,0,0,0], explByDown = [0,0,0,0,0];
    for (let d = 0; d < 5; d++) {
      let sum = 0;
      for (let i = 0; i < YD_BUCKETS.length; i++) {
        const mid = (YD_BUCKETS[i].lo === -99) ? -3   // approximate stuff at -3
                  : (YD_BUCKETS[i].hi === 99) ? 50    // approximate explosive at 50
                  : (YD_BUCKETS[i].lo + YD_BUCKETS[i].hi) / 2;
        sum += grid[i][d] * mid;
        if (YD_BUCKETS[i].lo >= 10) explByDown[d] += grid[i][d];
      }
      meanByDown[d] = sum / totalsByDown[d];
    }
    console.log("  " + "mean   ".padEnd(7)
      + meanByDown[0].toFixed(1).padStart(6) + " "
      + meanByDown[1].toFixed(1).padStart(6) + " "
      + meanByDown[2].toFixed(1).padStart(6) + " "
      + meanByDown[3].toFixed(1).padStart(6) + " "
      + meanByDown[4].toFixed(1).padStart(6));
    console.log("  " + "10+%   ".padEnd(7)
      + (100*explByDown[0]/totalsByDown[0]).toFixed(1).padStart(5) + "% "
      + (100*explByDown[1]/totalsByDown[1]).toFixed(1).padStart(5) + "% "
      + (100*explByDown[2]/totalsByDown[2]).toFixed(1).padStart(5) + "% "
      + (100*explByDown[3]/totalsByDown[3]).toFixed(1).padStart(5) + "% "
      + (100*explByDown[4]/totalsByDown[4]).toFixed(1).padStart(5) + "%");
    console.log("");
  }
  _printHist("RUN-PLAY YARDAGE — distribution by down", RUN_HIST);
  _printHist("COMPLETION YARDAGE — distribution by down (catches only)", CMP_HIST);

  // ============== 3RD-DOWN CONVERSION BY DISTANCE ==============
  console.log("══════════════════════════════════════════════════════════");
  console.log(" 3RD-DOWN CONVERSION BY DISTANCE  (NFL: short ~70 / med ~45 / long ~30 / xlong ~17)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  "+"BUCKET".padEnd(20)+"att".padStart(8)+"conv".padStart(8)+"conv%".padStart(9)+"   NFL band");
  const _tdBands = { short: "65-75%", medium: "40-50%", long: "25-35%", xlong: "10-22%" };
  const _tdLabels = { short: "short  (1-2 yds)", medium: "medium (3-6 yds)", long: "long   (7-10 yds)", xlong: "xlong  (11+ yds)" };
  let totA = 0, totC = 0;
  for (const k of ["short","medium","long","xlong"]) {
    const s = TD_DIST[k]; totA += s.att; totC += s.conv;
    const pct = s.att ? (100*s.conv/s.att).toFixed(1)+"%" : "—";
    console.log("  "+_tdLabels[k].padEnd(20)+String(s.att).padStart(8)+String(s.conv).padStart(8)+pct.padStart(9)+"   "+_tdBands[k]);
  }
  console.log("  "+"─".repeat(50));
  console.log("  "+"ALL 3rd downs".padEnd(20)+String(totA).padStart(8)+String(totC).padStart(8)+(totA?(100*totC/totA).toFixed(1)+"%":"—").padStart(9)+"   36-44%");
  console.log("");

})();
`;

// DETERMINISM: the engine is unseeded (~142 Math.random/game), so this audit
// samples different games every run. At the default 100 seasons the aggregate
// realism benchmarks are large-N and stable, but seeding makes the run exactly
// reproducible — so a benchmark that moves after a code change is attributable
// to the change, not to noise (the same regression-gate value as the seeded
// teleport battery). mulberry32 in the bundle eval scope only; shipped engine
// untouched. Default seed fixed; pass arg 3 to vary.
const SEED = (process.argv[3] != null ? Number(process.argv[3]) : 1337) >>> 0;
const seedPrelude = `
  (function () {
    var __a = ${SEED} >>> 0;
    Math.random = function () {
      __a |= 0; __a = (__a + 0x6D2B79F5) | 0;
      var t = Math.imul(__a ^ (__a >>> 15), 1 | __a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
`;
console.error("[_sim_audit seed=" + SEED + ", deterministic]");
let bundle = seedPrelude + shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += audit;

// Run as one script in this process's scope (Function avoids strict-mode
// const/let leakage issues; sloppy-mode top-level decls stay function-local).
new Function(bundle)();
