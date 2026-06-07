// ─── 32 fictional teams ────────────────────────────────────────────────────
const TEAMS = [
  { id:1,  city:"New Albion",  name:"Kraken",     conference:"AFC", division:"East",  primary:"#00264D", secondary:"#84B6F4", emoji:"🦑" },
  { id:2,  city:"Stonehaven",  name:"Titans",     conference:"AFC", division:"East",  primary:"#4B92DB", secondary:"#FFFFFF", emoji:"⚡" },
  { id:3,  city:"Ironport",    name:"Wolves",     conference:"AFC", division:"East",  primary:"#1A1A1A", secondary:"#A0A0A0", emoji:"🐺" },
  { id:4,  city:"Coldwater",   name:"Buccaneers", conference:"AFC", division:"East",  primary:"#0072CE", secondary:"#FFB81C", emoji:"🏴‍☠️" },
  { id:5,  city:"Steelforge",  name:"Hammers",    conference:"AFC", division:"North", primary:"#FFB612", secondary:"#101820", emoji:"🔨", playbook:"GROUND_AND_POUND" },
  { id:6,  city:"Riverdale",   name:"Grizzlies",  conference:"AFC", division:"North", primary:"#FB4F14", secondary:"#000000", emoji:"🐻" },
  { id:7,  city:"Coalport",    name:"Ravens",     conference:"AFC", division:"North", primary:"#241773", secondary:"#9E7C0C", emoji:"🦅" },
  { id:8,  city:"Lakewood",    name:"Bulldogs",   conference:"AFC", division:"North", primary:"#0B162A", secondary:"#C83803", emoji:"🐶" },
  { id:9,  city:"Sunbelt",     name:"Vipers",     conference:"AFC", division:"South", primary:"#002244", secondary:"#69BE28", emoji:"🐍" },
  { id:10, city:"Palmetto",    name:"Jaguars",    conference:"AFC", division:"South", primary:"#006778", secondary:"#D7A22A", emoji:"🐆" },
  { id:11, city:"Bayou",       name:"Gators",     conference:"AFC", division:"South", primary:"#03202F", secondary:"#A71930", emoji:"🐊", playbook:"GROUND_AND_POUND" },
  { id:12, city:"Redrock",     name:"Stallions",  conference:"AFC", division:"South", primary:"#4F2683", secondary:"#FFC62F", emoji:"🐎" },
  { id:13, city:"Desert",      name:"Scorpions",  conference:"AFC", division:"West",  primary:"#002244", secondary:"#C60C30", emoji:"🦂" },
  { id:14, city:"Silicon",     name:"Raiders",    conference:"AFC", division:"West",  primary:"#101820", secondary:"#A5ACAF", emoji:"⚔️", playbook:"AIR_RAID" },
  { id:15, city:"Cascade",     name:"Thunder",    conference:"AFC", division:"West",  primary:"#002C5F", secondary:"#69BE28", emoji:"⛈️" },
  { id:16, city:"Frontier",    name:"Outlaws",    conference:"AFC", division:"West",  primary:"#E31837", secondary:"#FFB81C", emoji:"🤠", playbook:"OPTION" },
  { id:17, city:"Capitol",     name:"Sentinels",  conference:"NFC", division:"East",  primary:"#003594", secondary:"#869397", emoji:"🛡️" },
  { id:18, city:"Metro",       name:"Predators",  conference:"NFC", division:"East",  primary:"#004C54", secondary:"#A5ACAF", emoji:"🦁" },
  { id:19, city:"Eastport",    name:"Eagles",     conference:"NFC", division:"East",  primary:"#004C54", secondary:"#A5ACAF", emoji:"🦅" },
  { id:20, city:"Colonial",    name:"Minutemen",  conference:"NFC", division:"East",  primary:"#003366", secondary:"#B0B7BC", emoji:"🎯", playbook:"AIR_RAID" },
  { id:21, city:"Great Lakes", name:"Frost",      conference:"NFC", division:"North", primary:"#4F2683", secondary:"#FFC62F", emoji:"❄️" },
  { id:22, city:"Ironwood",    name:"Vikings",    conference:"NFC", division:"North", primary:"#4B2E83", secondary:"#FFC62F", emoji:"🪓" },
  { id:23, city:"Prairie",     name:"Wolves",     conference:"NFC", division:"North", primary:"#203731", secondary:"#FFB612", emoji:"🐺" },
  { id:24, city:"Blizzard",    name:"Bears",      conference:"NFC", division:"North", primary:"#0B162A", secondary:"#C83803", emoji:"🐻" },
  { id:25, city:"Magnolia",    name:"Saints",     conference:"NFC", division:"South", primary:"#D3BC8D", secondary:"#101820", emoji:"⚜️", playbook:"DUAL_THREAT" },
  { id:26, city:"Gulf",        name:"Marauders",  conference:"NFC", division:"South", primary:"#D50A0A", secondary:"#0A0A08", emoji:"🏴" },
  { id:27, city:"Swamp",       name:"Kings",      conference:"NFC", division:"South", primary:"#002244", secondary:"#FFC62F", emoji:"👑" },
  { id:28, city:"Peach State", name:"Falcons",    conference:"NFC", division:"South", primary:"#A71930", secondary:"#000000", emoji:"🦅" },
  { id:29, city:"Pacific",     name:"Surge",      conference:"NFC", division:"West",  primary:"#002244", secondary:"#69BE28", emoji:"🌊", playbook:"AIR_RAID" },
  { id:30, city:"Redwood",     name:"Giants",     conference:"NFC", division:"West",  primary:"#0B2265", secondary:"#A71930", emoji:"🌲", playbook:"GROUND_AND_POUND" },
  { id:31, city:"Canyon",      name:"Hawks",      conference:"NFC", division:"West",  primary:"#002244", secondary:"#A5ACAF", emoji:"🦅" },
  { id:32, city:"Volcanic",    name:"Fury",       conference:"NFC", division:"West",  primary:"#97233F", secondary:"#000000", emoji:"🌋" },
];
const getTeam = id => TEAMS.find(t => t.id === Number(id));

// ASCII team identifier — replaces the emoji column in selectors, scoreboards,
// power-rankings, etc. Custom 3-char tokens per mascot where possible, else
// falls back to a bracketed first letter `[X]`. Pure ASCII so it renders the
// same on any system + reads as a terminal label rather than a sticker.
// NOTE: avoid sequences like `<S>` `<v>` `<H>` — the HTML parser will
// interpret them as real tags (e.g. <s> is strikethrough) and clobber
// every subsequent element rendered via innerHTML.
const TEAM_ASCII_OVERRIDES = {
  Kraken:"~8~",  Titans:"]T[",  Wolves:"/W\\", Buccaneers:">+<",
  Hammers:"=H=", Grizzlies:"oGo", Ravens:"\\v/", Bulldogs:"[B]",
  Vipers:"}S{",  Jaguars:">J<", Gators:"}G{",  Stallions:"/H\\",
  Scorpions:"~S~", Raiders:"X-X", Thunder:"/!\\", Outlaws:"[O]",
  Sentinels:"{S}", Predators:"/P\\", Eagles:"^v^", Minutemen:"(*)",
  Frost:"*F*",   Vikings:"(V)", Pirates:">P<", Steamers:"=S=",
  Comets:"~C~",  Storm:"/!\\",  Mustangs:"/M\\", Bandits:"[B]",
  Riders:"/R\\", Giants:"]G[",  Hawks:"^H^",   Fury:"!F!",
};
function teamAscii(team) {
  if (!team) return "[?]";
  return TEAM_ASCII_OVERRIDES[team.name] || `[${(team.name || "?")[0]}]`;
}

// ─── Personnel groupings ──────────────────────────────────────────────────
// Offensive personnel (which skill players are on the field) and the
// defensive package that subs in to match. Real NFL notation: first
// digit = RB count, second = TE count, WR = 5 - (RB+TE).
//   I_FORM (21): 2RB-1TE-2WR — power/run heavy
//   HEAVY  (12): 1RB-2TE-2WR — jumbo, run/PA threat
//   BASE   (11): 1RB-1TE-2WR — legacy default (4 skill, slim split)
//   TRIPS  (11): 1RB-1TE-3WR — modern NFL standard, slot WR3
//   SPREAD (10): 1RB-0TE-4WR — passing down
//   EMPTY  (01): 0RB-1TE-4WR — no back, true 5-out
const PERSONNEL = {
  I_FORM: { rb: 2, te: 1, wr: 2, label: "I-Form (21)",  skill: 5 },
  HEAVY:  { rb: 1, te: 2, wr: 2, label: "Heavy (12)",   skill: 5 },
  JUMBO:  { rb: 1, te: 3, wr: 1, label: "Jumbo (13)",   skill: 5 },
  BASE:   { rb: 1, te: 1, wr: 3, label: "Base (11)",    skill: 5 },
  TRIPS:  { rb: 1, te: 1, wr: 3, label: "Trips (11)",   skill: 5 },
  SPREAD: { rb: 1, te: 0, wr: 4, label: "Spread (10)",  skill: 5 },
  EMPTY:  { rb: 0, te: 1, wr: 4, label: "Empty (01)",   skill: 5 },
};
// ── FORMATION_DEPTHS — single source of truth for pre-snap skill positions ──
// Each tracked offensive skill slot's formation START, in LOS-RELATIVE YARDS:
//   backYd = yards behind the LOS (toward own end zone; +X back for offense)
//   latYd  = yards from field center (− = the WR1 side, + = the WR2 side)
// makeFormation (play-render.js) derives the canonical (normal-down, non-GL,
// 1-back) positions from this table; goal-line / long-yardage / multi-back are
// variants applied on top there. The engine (play-engine.js) emits each motion
// track's t=0 waypoint from the SAME table, so renderer and engine share one
// frame and a tracked player's start is never re-derived two ways. Lateral
// magnitudes also drive the matching CB alignment widths in makeFormation, so
// editing a WR here moves its corner too (coupling preserved by derivation).
// (fb + the 2-back I/PRO variants live in makeFormation for now.)
const FORMATION_DEPTHS = {
  qb:  { backYd: 6,       latYd: 0 },
  rb:  { backYd: 8,       latYd: 28 / 15 },   // +1.867 yd (28px off center)
  wr1: { backYd: 0,       latYd: -16 },       // outside left (−240px)
  wr2: { backYd: 0,       latYd: 16 },        // outside right
  wr3: { backYd: 0,       latYd: -10 },       // slot left (−150px)
  wr4: { backYd: 0,       latYd: 10 },        // slot right
  wr5: { backYd: 0,       latYd: 95 / 15 },   // +6.333 yd (tight slot, 95px)
  te1: { backYd: 2 / 15,  latYd: 78 / 15 },   // 2px off LOS, +5.2 yd
  te2: { backYd: 2 / 15,  latYd: -78 / 15 },
};
// Defensive package counts — subs are made off the base 4-3 (DL stays 4).
const DEF_PACKAGE = {
  BASE_43: { dl: 4, lb: 3, cb: 2, s: 2, label: "4-3 Base" },
  NICKEL:  { dl: 4, lb: 2, cb: 3, s: 2, label: "Nickel"   },
  DIME:    { dl: 4, lb: 1, cb: 4, s: 2, label: "Dime"     },
  QUARTER: { dl: 4, lb: 0, cb: 5, s: 2, label: "Quarter"  },
};
function packageForPersonnel(p) {
  const wr = PERSONNEL[p]?.wr ?? 2;
  if (wr >= 5) return "QUARTER";
  if (wr >= 4) return "DIME";
  if (wr >= 3) return "NICKEL";
  return "BASE_43";
}
// Personnel selection — playbook-weighted plus situational tilts.
// Goal-line favors HEAVY/I_FORM; long-yardage favors SPREAD/EMPTY.
function pickPersonnel(playbook, situation) {
  const sit = situation || {};
  if (sit.isGoalLine) {
    const r = Math.random();
    return r < 0.40 ? "HEAVY" : r < 0.65 ? "JUMBO" : r < 0.85 ? "I_FORM" : "BASE";
  }
  if (sit.isLongYardage) {
    const r = Math.random();
    return r < 0.45 ? "SPREAD" : r < 0.65 ? "EMPTY" : "TRIPS";
  }
  // Red zone (inside the 20) tilts toward heavier sets — shorter routes,
  // power running, extra blocker. Goal-to-go (inside the 10) tilts more
  // strongly. AIR_RAID stays in 11/SPREAD for fade routes; SMASHMOUTH /
  // GROUND_AND_POUND lean fully heavy.
  if (sit.isRedZone) {
    const mix = playbook.personnelMix || {};
    const heavyTilt = sit.isGoalToGo ? 0.30 : 0.18;
    const reweighted = {};
    for (const [k, p] of Object.entries(mix)) {
      if (k === "HEAVY" || k === "I_FORM" || k === "JUMBO") reweighted[k] = p * (1 + heavyTilt * 3);
      else if (k === "SPREAD" || k === "EMPTY") reweighted[k] = p * (1 - heavyTilt);
      else reweighted[k] = p;
    }
    const sum = Object.values(reweighted).reduce((a, b) => a + b, 0) || 1;
    let roll = Math.random() * sum;
    for (const [key, prob] of Object.entries(reweighted)) {
      if (roll < prob) return key;
      roll -= prob;
    }
    return "BASE";
  }
  const mix = playbook.personnelMix || { TRIPS: 0.40, BASE: 0.20, SPREAD: 0.15, HEAVY: 0.12, JUMBO: 0.05, I_FORM: 0.05, EMPTY: 0.03 };
  let roll = Math.random();
  for (const [key, prob] of Object.entries(mix)) {
    if (roll < prob) return key;
    roll -= prob;
  }
  return "BASE";
}

// ─── Playbooks ────────────────────────────────────────────────────────────
const PLAYBOOKS = {
  BALANCED: {
    id: "BALANCED", name: "Balanced", badge: "BAL",
    passProb: { long: 0.67, mid: 0.53, short: 0.37 },
    // NFL target shares (2020-2024): WR1 25-28%, WR2 18-22%, TE 18-22%,
    // RB 12-18%. Engine WR1 was 40% → top WR getting ~2x NFL season yards.
    // Lowered + redistributed to RB (NFL pass-catching backs get 12-18% TS).
    // After pace fix, WR1 dropped to 1473 — bumping back from 34 to 36
    // (still leaves WR2 at 28 in NFL band).
    targetMix: { wr1: 0.36, wr2: 0.27, te: 0.22, rb: 0.15 },
    // 2024 NFL personnel usage: 11/TRIPS dominates (~62%), 12/HEAVY ~18%,
    // BASE basically dead. Bumped TRIPS / cut BASE.
    personnelMix: { TRIPS: 0.55, HEAVY: 0.14, JUMBO: 0.08, SPREAD: 0.09, BASE: 0.07, I_FORM: 0.04, EMPTY: 0.03 },
    tierBias: {},
    airYdsMean: 7.5, airYdsSd: 6,
    rushYdsMean: 4.3, rushYdsSd: 5.5,
    compMul: 1.0, sackMul: 1.0,
  },
  AIR_RAID: {
    id: "AIR_RAID", name: "Air Raid", badge: "AIR",
    // Pass volume trimmed — was throwing 87% of plays so even mediocre
    // WRs racked up 130+ yds vs elite secondaries on volume alone.
    passProb: { long: 0.77, mid: 0.61, short: 0.45 },
    // rb 0.10 → 0.16 — NFL pass-catching backs in spread schemes (CMC,
    // Ekeler) see ~17-22% target share. Carved from wr1+wr2 so the deep
    // game still gets fed.
    // NFL air-raid teams: WR1 still gets top share but ~30% not 38%.
    // RB pass-catching share bumped to 20% (Ekeler/CMC-tier outliers hit 22%+).
    targetMix: { wr1: 0.32, wr2: 0.26, te: 0.20, rb: 0.22 },
    // Air Raid runs 11/SPREAD/EMPTY almost exclusively. 0 BASE.
    personnelMix: { TRIPS: 0.50, SPREAD: 0.30, EMPTY: 0.13, HEAVY: 0.04, BASE: 0.02, I_FORM: 0.01 },
    tierBias: { QB: "elite", WR: "elite" },
    // Elite QB + WRs hit at high comp% with normal air-yard depth; pay the
    // tax in sack volume from extra dropbacks and a weaker run game.
    airYdsMean: 7.5, airYdsSd: 7,
    rushYdsMean: 4.0, rushYdsSd: 5,
    // sackMul bumped (1.15 → 1.32) — defense knows pass is coming, pins ears back
    compMul: 1.01, sackMul: 1.32,
  },
  GROUND_AND_POUND: {
    id: "GROUND_AND_POUND", name: "Ground & Pound", badge: "G&P",
    passProb: { long: 0.55, mid: 0.34, short: 0.20 },
    targetMix: { wr1: 0.32, wr2: 0.20, te: 0.30, rb: 0.18 },
    // G&P is the only scheme that still uses BASE/I_FORM meaningfully
    // (run-first identity). Still bumps TRIPS over BASE for spread looks.
    personnelMix: { HEAVY: 0.26, JUMBO: 0.12, I_FORM: 0.22, TRIPS: 0.22, BASE: 0.13, SPREAD: 0.05 },
    tierBias: { RB: "elite", OL: "elite" },
    // Run-first; when they DO pass it's deeper play-action — but those deep
    // shots are LOWER comp%. Sack rate is normal (no auto-discount).
    airYdsMean: 9, airYdsSd: 7,
    rushYdsMean: 4.7, rushYdsSd: 5,
    compMul: 0.92, sackMul: 1.0,
  },
  // Dual-threat QB scheme: QB scrambles when pressured
  DUAL_THREAT: {
    id: "DUAL_THREAT", name: "Dual Threat", badge: "DT",
    passProb: { long: 0.70, mid: 0.47, short: 0.25 },
    // Dual-threat QB: WR1 still featured but RB share bumped (Lamar/CMC
    // duos see ~20% RB target share).
    targetMix: { wr1: 0.33, wr2: 0.24, te: 0.21, rb: 0.22 },
    personnelMix: { TRIPS: 0.53, SPREAD: 0.18, HEAVY: 0.12, JUMBO: 0.05, BASE: 0.05, I_FORM: 0.05, EMPTY: 0.02 },
    tierBias: { QB: "elite", WR: "good", RB: "good" },
    airYdsMean: 7.5, airYdsSd: 6.5,
    rushYdsMean: 4.8, rushYdsSd: 5.5,
    compMul: 1.0, sackMul: 1.05,
    qbScramblePct: 0.22,
    // Scheme floor for designed QB runs (read-option / QB-power). The engine
    // raises this further from the QB's own mobility, but a dual-threat scheme
    // calls QB keepers even with a merely-average runner under center.
    qbRushPct: 0.18,
  },
  // Read-Option / RPO: mobile QB carries — option-style with explosive QB
  OPTION: {
    id: "OPTION", name: "Read Option", badge: "OPT",
    passProb: { long: 0.60, mid: 0.40, short: 0.25 },
    targetMix: { wr1: 0.32, wr2: 0.22, te: 0.26, rb: 0.20 },
    personnelMix: { TRIPS: 0.30, HEAVY: 0.22, JUMBO: 0.08, I_FORM: 0.18, BASE: 0.14, SPREAD: 0.08 },
    tierBias: { QB: "elite", RB: "good" },
    airYdsMean: 7.5, airYdsSd: 6.5,
    rushYdsMean: 4.5, rushYdsSd: 6,        // good but not elite (G&P still better at pure run)
    compMul: 0.97, sackMul: 1.05,          // QB holds for reads → small comp/sack penalty
    qbScramblePct: 0.16,                   // bails sometimes (vs DT 0.22, but more impact)
    qbRushPct: 0.28,                       // ~28% of designed runs are QB carries
    qbRushFumbleMul: 1.4,                  // option exchanges fumble more
  },
};

function getPlaybook(team) { return PLAYBOOKS[team?.playbook] || PLAYBOOKS.BALANCED; }

// ── DEFENSIVE PLAYBOOKS ────────────────────────────────────────────────
// Each team has a base scheme that tilts run / pass / sack / deep-coverage
// outcomes. Multipliers are FROM the offense's perspective:
//   runMul > 1 → offense gains more yards on the ground
//   passMul > 1 → offense completes more / gains more on passes
//   sackMul > 1 → MORE sacks (defense generates pressure)
//   deepCovMul > 1 → defense gives up more deep yards
const DEF_PLAYBOOKS = {
  BASE_43: {
    id: "BASE_43", name: "4-3 Base", badge: "4-3",
    runMul: 1.00, passMul: 1.00, sackMul: 1.00, deepCovMul: 1.00,
    archBias: { LB: { COVER: 0.30, SIGNAL: 0.25, BLITZER: 0.20, THUMPER: 0.25 } },
  },
  BASE_34: {
    id: "BASE_34", name: "3-4 Base", badge: "3-4",
    runMul: 0.97, passMul: 0.98, sackMul: 1.10, deepCovMul: 1.00,
    archBias: { LB: { BLITZER: 0.35, THUMPER: 0.30, COVER: 0.20, SIGNAL: 0.15 } },
  },
  NICKEL: {
    id: "NICKEL", name: "Nickel", badge: "NCK",
    runMul: 1.05, passMul: 0.93, sackMul: 1.00, deepCovMul: 0.95,
    archBias: { CB: { SLOT_CB: 0.40, ZONE: 0.30, SHUTDOWN: 0.20, PHYSICAL: 0.10 } },
  },
  DIME: {
    id: "DIME", name: "Dime", badge: "DM",
    runMul: 1.12, passMul: 0.88, sackMul: 0.95, deepCovMul: 0.85,
    archBias: { S: { CENTER_FIELD: 0.50, BALL_HAWK: 0.30, BOX: 0.05, PHYSICAL: 0.15 } },
  },
  BLITZ_46: {
    id: "BLITZ_46", name: "46 Blitz", badge: "46",
    runMul: 0.88, passMul: 1.12, sackMul: 1.25, deepCovMul: 1.15,
    archBias: { LB: { BLITZER: 0.55, THUMPER: 0.30, SIGNAL: 0.10, COVER: 0.05 } },
  },
  PREVENT: {
    id: "PREVENT", name: "Prevent", badge: "PRV",
    runMul: 1.10, passMul: 0.92, sackMul: 0.85, deepCovMul: 0.55,
    archBias: { S: { CENTER_FIELD: 0.55, BALL_HAWK: 0.25, PHYSICAL: 0.10, BOX: 0.10 } },
  },
};
function getDefPlaybook(team) {
  if (team?.defPlaybook && DEF_PLAYBOOKS[team.defPlaybook]) return DEF_PLAYBOOKS[team.defPlaybook];
  if (!team) return DEF_PLAYBOOKS.BASE_43;
  // Hardcoded defensive identities for a few teams. Steel/Ravens/Gators
  // run a classic 3-4. Bears (Blizzard) + Bulldogs are aggressive 4-3
  // with heavy LB pressure. Others get a deterministic base pick.
  const idMap = {
    5:  "BASE_34",   // Steelforge Hammers
    7:  "BASE_34",   // Coalport Ravens
    8:  "BASE_43",   // Lakewood Bulldogs (aggressive front-4)
    11: "BASE_34",   // Bayou Gators
    24: "BASE_43",   // Blizzard Bears
  };
  if (idMap[team.id]) return DEF_PLAYBOOKS[idMap[team.id]];
  // Deterministic per-team pick from the base schemes. BASE_43 is the
  // most common; nickel/dime sprinkled in.
  const pool = ["BASE_43", "BASE_43", "BASE_43", "BASE_34", "NICKEL", "DIME"];
  return DEF_PLAYBOOKS[pool[(team.id * 7) % pool.length]] || DEF_PLAYBOOKS.BASE_43;
}

// `touchMul` (optional) — smart-contract multipliers per role keyed by
// "wr1"/"wr2"/"te"/"rb". Multiplies the final mix share so a player
// behind their touch target gets boosted, past target gets backed off.
function pickReceiver(playbook, starters, personnel, coverageMix, touchMul) {
  const p = PERSONNEL[personnel] || PERSONNEL.BASE;
  const base = playbook.targetMix;
  // Adjust mix to match what's actually on the field for this personnel.
  // 3-WR sets: carve a slot-WR share from wr1+wr2.
  // 4-WR / SPREAD: another slice for wr4.
  // No-TE (10): fold TE share into WRs.
  // No-RB (01/EMPTY): fold RB share into WRs.
  let mix = { wr1: base.wr1 || 0, wr2: base.wr2 || 0, wr3: 0, wr4: 0, te: base.te || 0, rb: base.rb || 0 };
  if (p.te === 0) {
    mix.wr1 += mix.te * 0.45;
    mix.wr2 += mix.te * 0.30;
    mix.te = 0;
  }
  if (p.rb === 0) {
    mix.wr1 += mix.rb * 0.40;
    mix.wr2 += mix.rb * 0.30;
    mix.rb = 0;
  }
  // 1-WR sets (JUMBO 13): only one WR on the field — fold the WR2 share onto
  // the tight ends (3 of them) and the lone WR, not a phantom 2nd receiver.
  if (p.wr <= 1) {
    mix.te  += mix.wr2 * 0.60;
    mix.wr1 += mix.wr2 * 0.25;
    mix.rb  += mix.wr2 * 0.15;
    mix.wr2 = 0;
  }
  if (p.wr >= 3) {
    const slice = Math.min(0.18, (mix.wr1 + mix.wr2) * 0.22);
    mix.wr1 -= slice * 0.55;
    mix.wr2 -= slice * 0.45;
    mix.wr3 = slice;
  }
  if (p.wr >= 4) {
    const slice = 0.10;
    mix.wr1 -= slice * 0.40;
    mix.wr2 -= slice * 0.30;
    mix.wr3 -= slice * 0.30;
    mix.wr4 = slice;
  }
  // Coverage avoidance — QBs throw less at SHUTDOWN / PHYSICAL CBs and
  // more at weaker matchups. coverageMix values multiply the base share
  // (<1 = avoid, 1 = neutral, >1 = attack).
  if (coverageMix) {
    if (coverageMix.wr1 != null) mix.wr1 *= coverageMix.wr1;
    if (coverageMix.wr2 != null) mix.wr2 *= coverageMix.wr2;
    if (coverageMix.wr3 != null) mix.wr3 *= coverageMix.wr3;
    if (coverageMix.te  != null) mix.te  *= coverageMix.te;
    const total = mix.wr1 + mix.wr2 + mix.wr3 + mix.wr4 + mix.te + mix.rb;
    if (total > 0) {
      for (const k of ["wr1", "wr2", "wr3", "wr4", "te", "rb"]) mix[k] /= total;
    }
  }
  // Smart-contract touch-target bias: multiplies each role's share by
  // its touchMul (>1 boosts behind-target, <1 backs off past-target).
  // Renormalize so probabilities still sum to ~1.
  if (touchMul) {
    if (touchMul.wr1 != null) mix.wr1 *= touchMul.wr1;
    if (touchMul.wr2 != null) mix.wr2 *= touchMul.wr2;
    if (touchMul.te  != null) mix.te  *= touchMul.te;
    if (touchMul.rb  != null) mix.rb  *= touchMul.rb;
    const total = mix.wr1 + mix.wr2 + mix.wr3 + mix.wr4 + mix.te + mix.rb;
    if (total > 0) {
      for (const k of ["wr1", "wr2", "wr3", "wr4", "te", "rb"]) mix[k] /= total;
    }
  }
  // Multi-TE sets (HEAVY 12 / JUMBO 13): give the 2nd — and in JUMBO the 3rd — TE
  // a real receiving share carved from the move-TE's target. Without this only the
  // move-TE ever catches, so a 3-TE package was a pure blocking label.
  if (p.te >= 2 && mix.te > 0 && starters.te2 && starters.te2 !== starters.te) {
    const teTotal = mix.te;
    if (p.te >= 3 && starters.te3 && starters.te3 !== starters.te2 && starters.te3 !== starters.te) {
      // JUMBO (13): three TEs split the share — move-TE leads, TE3 a real sliver.
      mix.te  = teTotal * 0.50;
      mix.te2 = teTotal * 0.33;
      mix.te3 = teTotal * 0.17;
    } else {
      // HEAVY (12): two TEs.
      mix.te2 = teTotal * 0.30;
      mix.te  = teTotal * 0.70;
    }
  }
  let roll = Math.random();
  for (const key of ["wr1", "wr2", "wr3", "wr4", "te", "te2", "te3", "rb"]) {
    const prob = mix[key] || 0;
    if (prob <= 0) continue;
    if (roll < prob) return starters[key] || starters.wr1;
    roll -= prob;
  }
  return starters.wr1;
}

