// ─── Game simulator ───────────────────────────────────────────────────────
function normal(mean, sd) {
  const u1 = Math.random() || 0.0001, u2 = Math.random();
  return Math.round(mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sd);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── EFFECTIVE SPEED — weight + agility adjusted ──────────────────────────────
// SPD alone doesn't capture football reality. Two players with the same
// max-speed grade close ground at different rates depending on:
//   1. WEIGHT — 270-lb DL accelerates slower than 195-lb WR even with same
//      top-end. Per F=ma: more mass = less acceleration for same musculature.
//      Drag at sustained speed also rises with mass.
//   2. AGILITY — short bursts (5-15 yds) reward AGI / first-step explosion,
//      not just terminal velocity.
//
// `effectiveSpeed(p, yards)` blends SPD + AGI weighted by burst distance:
//   yards ≤ 5:    burst dominates; AGI 50% of the score, weight penalty maxed
//   yards 5-20:   blended
//   yards ≥ 20:   SPD dominates (already encodes the 40-yd time which is
//                 weight-aware via position-SPD mapping)
//
// Weight penalty: each 30 lbs over 200 = ~1 SPD point lost on burst.
// A 270-lb DL with SPD 90 in a 5-yd pursuit ≈ effective 80; same player
// at 40-yd ≈ effective 88 (small steady-state penalty only).
function effectiveSpeed(p, yards = 30) {
  if (!p) return 50;
  const spd = p.stats?.[0] || 50;
  const agi = p.stats?.[2] || 50;
  // Weight pulled from combineMeasurables if available, else fallback by
  // position averages so engine works even on legacy player objects.
  // try/catch — combineMeasurables can throw on malformed player objects
  // (no stats array, etc.); the engine should never crash on a bad player.
  let w;
  try {
    w = (typeof combineMeasurables === "function")
      ? combineMeasurables(p).weightLbs
      : (POSITION_WEIGHT_FALLBACK[p.position] || 220);
  } catch (_e) {
    w = POSITION_WEIGHT_FALLBACK[p?.position] || 220;
  }
  // Burst mix: 1.0 at 0 yds, 0 at 20+ yds. Lighter players win bursts.
  const burstMix = clamp((20 - yards) / 20, 0, 1);
  // Weight effect — bidirectional now. Above 200 lbs, drag penalty rises
  // linearly (each lb over = 1/30 SPD-points in burst, 1/60 sustained).
  // BELOW 200 lbs, lighter players get a small ACCELERATION BONUS (F=ma
  // — less mass to move = quicker accel). Bonus capped at +1.5 SPD so a
  // theoretical 130-lb player doesn't get unlimited burst — you also need
  // some muscle mass for force production. Sub-160 lbs hits the cap.
  const _wDelta = w - 200;
  const burstPenalty = _wDelta >= 0
    ? _wDelta / 30                          // heavier — slower burst
    : Math.max(-1.5, _wDelta / 40);         // lighter — quicker burst, capped
  const sustainedDrag = _wDelta >= 0
    ? _wDelta / 60                          // heavier — small steady-state drag
    : Math.max(-0.5, _wDelta / 80);         // lighter — tiny sustained boost
  if (burstMix <= 0) {
    // Sustained foot race — SPD dominates, weight drag/boost is small.
    return spd - sustainedDrag;
  }
  // Burst speed: SPD + AGI blend, with bidirectional weight effect.
  const burstScore = spd * 0.5 + agi * 0.5 - burstPenalty;
  const sustainedScore = spd - sustainedDrag;
  return sustainedScore * (1 - burstMix) + burstScore * burstMix;
}
// Fallback weight by position when combineMeasurables isn't available.
const POSITION_WEIGHT_FALLBACK = {
  QB:220, RB:215, WR:200, TE:250, OL:315, DL:280, LB:240, CB:195, S:205, K:200, P:215,
};

// ── MFF (advanced-analytics) per-snap attribution ──────────────────────────
// EXPECTED-PRESSURE (xPressure) credit for MFF per-snap attribution. The engine's
// `pressure` scalar = clamp(basePressure*passMul, -1.5, 1.9) is a *team* trench
// quantity; measured over ~23k dropbacks it is centered at median -0.12 (OL wins
// most reps — completions ~62%), range ~[-0.57, +0.24] (probe: _mff_press_probe.js).
// A hard threshold on it saturates (a dominant line clears it ~every rep → 90%+
// "rate"), so instead each rep is credited a SMOOTH, DETERMINISTIC 0..1 expected
// pressure: BASE at the median, sloped by how far this matchup favors the rush,
// clamped to avoid saturation. BASE≈league pressure rate so the league mean lands
// near NFL ~35%. A sack tops the rep's credit up to a full 1.0 (a sack is a
// pressure). These constants are read ONLY inside `_MFF_ATTR`-gated, RNG-free,
// outcome-neutral writes; changing them cannot move any game-calibration band.
const MFF_PRESS_MED   = -0.12;  // measured median of the pressure scalar
const MFF_PRESS_BASE  = 0.34;   // xPressure credited at a median (even) matchup
const MFF_PRESS_SLOPE = 0.55;   // how fast xPressure rises as the rush wins

// Break-tackle tackler-pool weights and gang-tackle distributions per contact
// context. Yardage bucket "short" = at/near LOS, "mid" = 2nd level, "long" =
// open field. Each row's values sum to 1.0 (probabilities).
const _RUN_TACKLER_ZONES = {
  short: { LB: 0.55, DL: 0.30, S:  0.07, CB: 0.08 },  // LOS scrum
  mid:   { LB: 0.40, S:  0.30, CB: 0.18, DL: 0.12 },  // 2nd level
  long:  { S:  0.50, CB: 0.35, LB: 0.15 },             // open field
};
const _RUN_GANG_DIST = {
  short: [0.25, 0.50, 0.25],
  mid:   [0.55, 0.37, 0.08],
  long:  [0.85, 0.15],
};
// ── LEVEL-4 CONCEPT × COVERAGE LIBRARY ─────────────────────────────────
// Named offensive concepts (route trees) and defensive coverages, with a
// per-matchup read-success table. Replaces the air-yards class mixture with
// "QB calls a concept, defense calls a coverage, lookup matchup → primary
// or fallback throw" — the actual structural model of how NFL passing
// works. Concepts have characteristic depth (primary) and a checkdown
// (fallback). Coverages have characteristic strengths/weaknesses against
// concept types. Read success per (concept, coverage) pair is calibrated
// from NFL film/analytics convention; QB awareness + pressure modulate.
const PASS_CONCEPTS = {
  // Fallback depths were too shallow — read-failed throws were landing at
  // 1-4 yds AT the LOS far too often, producing the "QB dumps it for 1
  // yd" pattern. NFL QBs more often throw away or take the sack instead
  // of accepting a 1-yd checkdown. Bumped fallback depths so even a read
  // failure leaves something resembling a legitimate target depth (the
  // RB/TE settle in front of the sticks, not at the QB's feet).
  QUICK_GAME: {  // slants, hitches, RPO — quick read, beats blitz
    primaryDepth: 4,  primarySd: 1.5,
    fallbackDepth: 3, fallbackSd: 1.0,
    readSuccessVs: { C0_BLITZ: 0.82, C1_MAN: 0.62, C2_ZONE: 0.55, C3_ZONE: 0.66, C4_QUARTERS: 0.55, TAMPA_2: 0.55 },
  },
  DRAG_MESH: {   // crossers — beats man, vulnerable to gap zones
    primaryDepth: 7,  primarySd: 2.0,
    fallbackDepth: 4, fallbackSd: 1.5,
    readSuccessVs: { C0_BLITZ: 0.55, C1_MAN: 0.78, C2_ZONE: 0.55, C3_ZONE: 0.52, C4_QUARTERS: 0.50, TAMPA_2: 0.48 },
  },
  INTERMEDIATE: {  // digs/outs/post-corner — beats zone, vulnerable to man + pressure
    primaryDepth: 12, primarySd: 2.5,
    fallbackDepth: 6, fallbackSd: 2.0,
    readSuccessVs: { C0_BLITZ: 0.42, C1_MAN: 0.52, C2_ZONE: 0.68, C3_ZONE: 0.62, C4_QUARTERS: 0.48, TAMPA_2: 0.55 },
  },
  VERTICAL: {    // go/deep post — beats single-high, dies vs 2-deep
    primaryDepth: 22, primarySd: 3.5,
    fallbackDepth: 8, fallbackSd: 2.5,
    readSuccessVs: { C0_BLITZ: 0.75, C1_MAN: 0.55, C2_ZONE: 0.40, C3_ZONE: 0.38, C4_QUARTERS: 0.30, TAMPA_2: 0.40 },
  },
  SCREEN: {      // behind/at LOS — manufactured YAC, beats blitz, vulnerable to disciplined zone
    primaryDepth: -1, primarySd: 1.5,
    fallbackDepth: 2, fallbackSd: 1.5,
    readSuccessVs: { C0_BLITZ: 0.85, C1_MAN: 0.65, C2_ZONE: 0.52, C3_ZONE: 0.55, C4_QUARTERS: 0.55, TAMPA_2: 0.65 },
  },
  PA_SHOT: {     // play-action vertical — slow developing, beats single-high
    primaryDepth: 18, primarySd: 4.0,
    fallbackDepth: 9, fallbackSd: 2.5,
    readSuccessVs: { C0_BLITZ: 0.40, C1_MAN: 0.65, C2_ZONE: 0.55, C3_ZONE: 0.52, C4_QUARTERS: 0.42, TAMPA_2: 0.48 },
  },
};
const PASS_CONCEPT_FREQ = {  // base offensive concept call distribution
  // Rebalanced from initial draft (30/18/22/13/10/7) — too much QUICK_GAME +
  // SCREEN dragged attempt-avg airYds to 6.2 vs NFL ~8.5-9. Shifted weight
  // to INTERMEDIATE / VERTICAL / PA_SHOT.
  QUICK_GAME: 0.22, DRAG_MESH: 0.17, INTERMEDIATE: 0.30, VERTICAL: 0.16, SCREEN: 0.05, PA_SHOT: 0.10,
};
const PASS_COVERAGE_FREQ = { // base defensive coverage distribution
  C0_BLITZ: 0.05, C1_MAN: 0.22, C2_ZONE: 0.18, C3_ZONE: 0.32, C4_QUARTERS: 0.15, TAMPA_2: 0.08,
};

const _YAC_TACKLER_ZONES = {
  short: { S: 0.40, CB: 0.35, LB: 0.25 },              // catch + immediate wrap
  mid:   { S: 0.40, CB: 0.30, LB: 0.30 },              // typical YAC
  long:  { S: 0.50, CB: 0.35, LB: 0.15 },              // big YAC run
};
const _YAC_GANG_DIST = {
  short: [0.45, 0.45, 0.10],
  mid:   [0.65, 0.30, 0.05],
  long:  [0.85, 0.15],
};
const _RETURN_TACKLER_ZONES = {
  short: { CB: 0.35, S: 0.35, LB: 0.25, DL: 0.05 },    // closing gunner
  mid:   { CB: 0.40, S: 0.40, LB: 0.15, DL: 0.05 },
  long:  { CB: 0.45, S: 0.40, LB: 0.13, DL: 0.02 },    // last man in space
};
const _RETURN_GANG_DIST = {
  short: [0.55, 0.40, 0.05],
  mid:   [0.80, 0.20],
  long:  [0.90, 0.10],
};

// Per-penalty base rate + metadata. Rate is per-play probability (not
// cumulative). Pass-only types ("when": "pass") are skipped on run plays.
// Cumulative thresholds are rebuilt every play with situational mods.
const _PENALTY_RATES = {
  // Pre-snap — committed by side that fouled
  "False Start":              { rate: 0.0120, on: "off", yds: 5,  autoFirst: false, when: "any"  },
  "Defensive Offsides":       { rate: 0.0060, on: "def", yds: 5,  autoFirst: false, when: "any"  },
  "Neutral Zone Infraction":  { rate: 0.0030, on: "def", yds: 5,  autoFirst: false, when: "any"  },
  "Encroachment":             { rate: 0.0030, on: "def", yds: 5,  autoFirst: false, when: "any"  },
  "Delay of Game":            { rate: 0.0045, on: "off", yds: 5,  autoFirst: false, when: "any"  },
  "Illegal Formation":        { rate: 0.0025, on: "off", yds: 5,  autoFirst: false, when: "any"  },
  "Illegal Motion":           { rate: 0.0025, on: "off", yds: 5,  autoFirst: false, when: "any"  },
  // Post-snap (any play type)
  "Holding (Offense)":        { rate: 0.0120, on: "off", yds: 10, autoFirst: false, when: "any"  },
  "Illegal Use of Hands (O)": { rate: 0.0025, on: "off", yds: 10, autoFirst: false, when: "any"  },
  "Holding (Defense)":        { rate: 0.0060, on: "def", yds: 5,  autoFirst: true,  when: "any"  },
  "Unnecessary Roughness":    { rate: 0.0040, on: "def", yds: 15, autoFirst: true,  when: "any"  },
  "Face Mask":                { rate: 0.0020, on: "def", yds: 15, autoFirst: true,  when: "any"  },
  "Horse Collar":             { rate: 0.0010, on: "def", yds: 15, autoFirst: true,  when: "any"  },
  "Taunting":                 { rate: 0.0010, on: "def", yds: 15, autoFirst: true,  when: "any"  },
  "Illegal Block in Back":    { rate: 0.0035, on: "off", yds: 10, autoFirst: false, when: "any"  },
  // Pass-only
  "Pass Interference (D)":    { rate: 0.0080, on: "def", yds: 15, autoFirst: true,  when: "pass" },
  "Illegal Contact":          { rate: 0.0055, on: "def", yds: 5,  autoFirst: true,  when: "pass" },
  "Roughing the Passer":      { rate: 0.0035, on: "def", yds: 15, autoFirst: true,  when: "pass" },
  "Pass Interference (O)":    { rate: 0.0030, on: "off", yds: 10, autoFirst: false, when: "pass" },
  "Ineligible Downfield":     { rate: 0.0025, on: "off", yds: 5,  autoFirst: false, when: "pass" },
  "Intentional Grounding":    { rate: 0.0020, on: "off", yds: 10, autoFirst: false, when: "pass", lossDown: true },
};

// Penalties that kill the play (the snap never legally happened). These
// keep the "replace play with penalty" behavior — no accept/decline because
// nothing to accept against. Everything not listed here is LIVE-BALL: the
// play executes, and the non-offending team picks accept/decline after.
const _DEAD_BALL_PENALTIES = new Set([
  "False Start",
  "Delay of Game",
  "Neutral Zone Infraction",
  "Encroachment",
  "Illegal Formation",
  "Illegal Motion",
]);

// Position attribution for each penalty type — values are relative weights
// (do not need to sum to 100). Sourced from NFL position-attribution data
// (Harvard SAC penalty study, PFR OL penalty leaders, May 2026 research).
//   OL committers dominate false start and offensive holding; CB committers
//   dominate DPI / Def Holding / Illegal Contact; Edge rushers commit most
//   roughing the passer; safeties + linebackers commit most unnecessary
//   roughness / personal fouls. _pickPenaltyOffender consumes this map.
const _PENALTY_POSITIONS = {
  // Pre-snap
  "False Start":              { OL: 88, WR: 6,  TE: 3,  RB: 3 },
  "Defensive Offsides":       { DE: 60, DT: 35, LB: 5 },
  "Neutral Zone Infraction":  { DT: 70, DE: 25, LB: 5 },
  "Encroachment":             { DT: 55, DE: 35, LB: 10 },
  "Delay of Game":            { QB: 100 },
  "Illegal Formation":        { OL: 55, WR: 25, TE: 15, RB: 5 },
  "Illegal Motion":           { WR: 50, TE: 25, RB: 20, OL: 5 },
  // Post-snap (any play)
  "Holding (Offense)":        { OL: 85, TE: 8,  RB: 5,  WR: 2 },
  "Illegal Use of Hands (O)": { OL: 90, TE: 7,  RB: 3 },
  "Holding (Defense)":        { CB: 65, S: 18, LB: 15, DE: 2 },
  "Unnecessary Roughness":    { S: 35, LB: 30, CB: 20, DL: 15 },
  "Face Mask":                { LB: 30, S: 25, DL: 25, CB: 20 },
  "Horse Collar":             { LB: 35, S: 30, CB: 20, DL: 15 },
  "Taunting":                 { CB: 25, S: 25, LB: 20, WR: 15, DL: 10, RB: 5 },
  "Illegal Block in Back":    { WR: 40, RB: 30, TE: 20, OL: 10 },
  // Pass-only
  "Pass Interference (D)":    { CB: 72, S: 20, LB: 8 },
  "Illegal Contact":          { CB: 70, S: 18, LB: 12 },
  "Roughing the Passer":      { DE: 48, DT: 28, LB: 18, S: 4, CB: 2 },
  "Pass Interference (O)":    { WR: 70, TE: 22, RB: 5, OL: 3 },
  "Ineligible Downfield":     { OL: 95, TE: 5 },
  "Intentional Grounding":    { QB: 100 },
};

// Map any receiver / returner archetype to a break-tackle style. Returns
// null for "use the default formula".
function _archetypeBreakStyle(arch) {
  if (!arch) return null;
  // Power-style: big bodies that fight through wraps.
  if (arch === "POWER" || arch === "RED_ZONE" || arch === "GLADIATOR") return "POWER";
  // Elusive-style: short-area quickness, route-runner traits.
  if (arch === "ELUSIVE" || arch === "SLOT" || arch === "ROUTE_RUNNER" || arch === "DUAL_THREAT") return "ELUSIVE";
  // Speed-style: deep burst / breakaway threat.
  if (arch === "SPEED" || arch === "DEEP_THREAT" || arch === "BURNER") return "SPEED";
  // POSSESSION, etc — default formula (mixed STR/AGI).
  return null;
}

function buildRatings(roster) {
  // Injured players (`weeksRemaining > 0`) are unavailable — exclude
  // them from depth-chart ratings so missing your QB1 actually hurts.
  const byPos = {};
  for (const p of roster) {
    if (p.injury && p.injury.weeksRemaining > 0) continue;
    (byPos[p.position] ||= []).push(p);
  }
  for (const k in byPos) byPos[k].sort((a,b) => b.overall - a.overall);
  // Flat top-n average — used only when one player matters (QB, K).
  const g = (pos, n) => {
    const arr = (byPos[pos] || []).slice(0, n);
    return arr.length ? arr.reduce((s,p) => s + p.overall, 0) / arr.length : 50;
  };
  // Weighted top-n average — best players matter more, so a single
  // superstar at OL/DL/CB actually moves the team's rating instead of
  // getting diluted by the bottom of the depth chart. Weight pattern:
  //   [3.5, 2.5, 1.5, 1.0, 0.5]  (best to 5th)
  // For OL n=5: best player carries ~39% of the rating; 5th player ~6%.
  // For DL n=4 / LB n=3 we slice the same weight array.
  const W = [3.5, 2.5, 1.5, 1.0, 0.5];
  const gw = (pos, n) => {
    const arr = (byPos[pos] || []).slice(0, n);
    if (!arr.length) return 50;
    const ws = W.slice(0, arr.length);
    const wSum = ws.reduce((a,b) => a+b, 0);
    return arr.reduce((s,p,i) => s + p.overall * ws[i], 0) / wSum;
  };
  return {
    offense: g("QB",1)*0.30 + gw("RB",2)*0.15 + gw("WR",4)*0.25 + g("TE",1)*0.10 + gw("OL",5)*0.20,
    defense: gw("DL",4)*0.30 + gw("LB",3)*0.30 + gw("CB",2)*0.25 + gw("S",2)*0.15,
    qb: g("QB",1), rb: gw("RB",2), wr: gw("WR",4), ol: gw("OL",5),
    dl: gw("DL",4), lb: gw("LB",3), cb: gw("CB",2), saf: gw("S",2),
    k:  g("K",1),
    starters: {
      qb:  (byPos.QB?.[0])?.name || "QB",
      rb:  (byPos.RB?.[0])?.name || "RB",
      rb2: (byPos.RB?.[1])?.name || null,    // second back — null if no viable depth
      wr1: (byPos.WR?.[0])?.name || "WR1",
      wr2: (byPos.WR?.[1])?.name || "WR2",
      // 3rd / 4th WR for 3-WR (TRIPS) and 4-WR (SPREAD/EMPTY) personnel.
      // Fall back to depth WRs (or wr2/wr1) if the team is thin at WR.
      wr3: (byPos.WR?.[2])?.name || (byPos.WR?.[1])?.name || (byPos.WR?.[0])?.name || "WR3",
      wr4: (byPos.WR?.[3])?.name || (byPos.WR?.[2])?.name || (byPos.WR?.[1])?.name || "WR4",
      te:  (byPos.TE?.[0])?.name || "TE",
      // 2nd TE for HEAVY (12) personnel.
      te2: (byPos.TE?.[1])?.name || (byPos.TE?.[0])?.name || "TE2",
      // 3rd TE for JUMBO (13) personnel.
      te3: (byPos.TE?.[2])?.name || (byPos.TE?.[1])?.name || (byPos.TE?.[0])?.name || "TE3",
      // OL starters by overall rank — top 5 from byPos.OL. Mapped to the
      // formation's 5 OL slots in Y order (top → bottom = LT/LG/C/RG/RT).
      // Adding these lets the renderer decorate each OL slot with a real
      // roster player, so the jersey number stays the SAME across plays
      // (was re-rolled randomly every formation build, which made the
      // same OL spot look like 4 different people across consecutive
      // snaps — pure visual noise).
      ol1: (byPos.OL?.[0])?.name || "LT",
      ol2: (byPos.OL?.[1])?.name || "LG",
      ol3: (byPos.OL?.[2])?.name || "C",
      ol4: (byPos.OL?.[3])?.name || "RG",
      ol5: (byPos.OL?.[4])?.name || "RT",
      k:   (byPos.K?.[0])?.name  || "K",
      p:   (byPos.P?.[0])?.name  || (byPos.K?.[0])?.name || "P",  // Punter (fallback to K if missing)
      de1: byPos.DL?.[0]?.name || "LDE",
      dt1: byPos.DL?.[1]?.name || "LDT",
      dt2: byPos.DL?.[2]?.name || "RDT",
      de2: byPos.DL?.[3]?.name || "RDE",
      lb1: byPos.LB?.[0]?.name || "WLB",
      lb2: byPos.LB?.[1]?.name || "MLB",
      lb3: byPos.LB?.[2]?.name || "SLB",
      cb1: byPos.CB?.[0]?.name || "CB1",
      cb2: byPos.CB?.[1]?.name || "CB2",
      // Nickel/dime DBs for sub-package defense vs 3+ WR sets.
      cb3: (byPos.CB?.[2])?.name || (byPos.CB?.[1])?.name || (byPos.CB?.[0])?.name || "NB",
      cb4: (byPos.CB?.[3])?.name || (byPos.CB?.[2])?.name || (byPos.CB?.[1])?.name || "DB4",
      fs:  byPos.S?.[0]?.name  || "FS",
      ss:  byPos.S?.[1]?.name  || "SS",
    }
  };
}

class GameSimulator {
  constructor(home, away, hRoster, aRoster, opts) {
    this.home = home; this.away = away;
    this.hRoster = hRoster; this.aRoster = aRoster;
    // Optional gameday context: rivalry flag, home-field advantage.
    // Weather still auto-rolls in the constructor below; opts.weather
    // can override post-construction if a caller wants to force it.
    this.opts = opts || {};
    // MFF advanced-analytics attribution. When on, the engine records per-snap
    // per-player rep outcomes (currently: pass-rush pressures / pass-pro
    // pressures-allowed) onto the box-score stat lines. The writes are purely
    // additive (new keys via the `||0` idiom), consume NO Math.random(), and
    // never alter a play outcome — so toggling this flag leaves every existing
    // aggregate byte-identical (proven by _mff_ab_check.js). Default on; the
    // A/B harness sets `_MFF_ATTR = false` to verify calibration is untouched.
    this._MFF_ATTR = this.opts.mffAttr !== false;
    this.isRivalry = !!this.opts.isRivalry;
    this.isPlayoff = !!this.opts.isPlayoff;   // amplifies the clutch swing in big games
    this.homeFieldAdv = this.opts.homeFieldAdv !== false; // default on
    // Per-snap rotation targets, keyed by engine starter role
    // (qb/rb/wr1/wr2/te). Each value is the starter's intended
    // share as a 0..1 fraction; absent keys fall back to the legacy
    // touches-based rotation.
    this.homeSnaps = this.opts.homeSnaps || null;
    this.awaySnaps = this.opts.awaySnaps || null;
    this._playerByName = new Map();
    for (const p of hRoster) this._playerByName.set(p.name, p);
    for (const p of aRoster) this._playerByName.set(p.name, p);
    // Reset per-game ejection / UR-count flags — these persist on the
    // player object between games, so we must clear them at start.
    for (const p of hRoster) { p._ejectedThisGame = false; p._urThisGame = 0; p._benchedRestOfGame = false; }
    for (const p of aRoster) { p._ejectedThisGame = false; p._urThisGame = 0; p._benchedRestOfGame = false; }
    this.homePlaybook = getPlaybook(home); this.awayPlaybook = getPlaybook(away);
    this.homeDefPlaybook = getDefPlaybook(home); this.awayDefPlaybook = getDefPlaybook(away);
    this.homeR = buildRatings(hRoster); this.awayR = buildRatings(aRoster);
    // Home-field advantage: small bump to the home team's offense and
    // defense ratings — narrative small but cumulatively meaningful
    // across a 14-game season. Tunable; ~+1.5 each side.
    if (this.homeFieldAdv !== false) {
      this.homeR.offense += 1.5;
      this.homeR.defense += 1.5;
    }
    // Extract archetypes for the starting unit. Injured players (weeksRemaining > 0)
    // are excluded — same rule as buildRatings — so an injured top-5 OL doesn't
    // get a ghost 0-line in the box score and an injured top-2 WR doesn't keep
    // donating its archetype bonus to the offense from the sidelines.
    const archetypesByPos = (roster, pos, n) => roster
      .filter(p => p.position === pos && !(p.injury && p.injury.weeksRemaining > 0))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, n)
      .map(p => ({ name: p.name, archetype: p.archetype, overall: p.overall, stats: p.stats }));
    // Assigns LT/LG/C/RG/RT slots to the top-5 OL based on archetype + stats.
    // Tackles: best AGI / ATHLETIC. Center: best AWR / TECHNICIAN. Guards:
    // best STR / MAULER / PLUG / ANCHOR. Greedy: claim the best fit for
    // each slot in order.
    const assignOLPositions = (olList) => {
      if (!olList || olList.length === 0) return olList;
      const slots = ["LT", "LG", "C", "RG", "RT"];
      const scoreFor = (p, slot) => {
        const agi = p.stats?.[2] || 70;
        const str = p.stats?.[1] || 70;
        const awr = p.stats?.[3] || 70;
        const blk = p.stats?.[6] || 70;
        if (slot === "LT" || slot === "RT")
          return agi * 1.5 + blk * 0.8 + (p.archetype === "ATHLETIC" ? 22 : 0)
                                       + (p.archetype === "TECHNICIAN" ? 8 : 0);
        if (slot === "C")
          return awr * 1.5 + blk * 0.9 + (p.archetype === "TECHNICIAN" ? 18 : 0)
                                       + (p.archetype === "ANCHOR" ? 10 : 0);
        // LG / RG
        return str * 1.4 + blk * 0.8 + (p.archetype === "MAULER" ? 22 : 0)
                                     + (p.archetype === "PLUG"   ? 14 : 0)
                                     + (p.archetype === "ANCHOR" ? 10 : 0);
      };
      const used = new Set();
      const assigned = {};
      for (const slot of slots) {
        let bestP = null, bestScore = -Infinity;
        for (const p of olList) {
          if (used.has(p.name)) continue;
          const s = scoreFor(p, slot);
          if (s > bestScore) { bestScore = s; bestP = p; }
        }
        if (bestP) { assigned[slot] = bestP; used.add(bestP.name); }
      }
      return olList.map(p => {
        for (const slot of slots) {
          if (assigned[slot]?.name === p.name) return { ...p, subPos: slot };
        }
        return p;
      });
    };
    // Same idea for DL — LDE / LDT / RDT / RDE. SPEED archetypes →
    // edge; POWER / PLUG / PENETRATOR → interior.
    const assignDLPositions = (dlList) => {
      if (!dlList || dlList.length === 0) return dlList;
      const slots = ["LDE", "LDT", "RDT", "RDE"];
      const scoreFor = (p, slot) => {
        const spd = p.stats?.[0] || 70;
        const str = p.stats?.[1] || 70;
        const prs = p.stats?.[7] || 70;
        if (slot === "LDE" || slot === "RDE")
          return spd * 1.4 + prs * 1.0 + (p.archetype === "SPEED" ? 22 : 0)
                                       + (p.archetype === "TWEENER" ? 8 : 0);
        // LDT / RDT
        return str * 1.4 + prs * 0.7 + (p.archetype === "POWER" ? 18 : 0)
                                     + (p.archetype === "PLUG"  ? 14 : 0)
                                     + (p.archetype === "PENETRATOR" ? 12 : 0);
      };
      const used = new Set();
      const assigned = {};
      for (const slot of slots) {
        let bestP = null, bestScore = -Infinity;
        for (const p of dlList) {
          if (used.has(p.name)) continue;
          const s = scoreFor(p, slot);
          if (s > bestScore) { bestScore = s; bestP = p; }
        }
        if (bestP) { assigned[slot] = bestP; used.add(bestP.name); }
      }
      return dlList.map(p => {
        for (const slot of slots) {
          if (assigned[slot]?.name === p.name) return { ...p, subPos: slot };
        }
        return p;
      });
    };
    this.homeDL = assignDLPositions(archetypesByPos(hRoster, "DL", 4));
    this.awayDL = assignDLPositions(archetypesByPos(aRoster, "DL", 4));
    this.homeOL = assignOLPositions(archetypesByPos(hRoster, "OL", 5));
    this.awayOL = assignOLPositions(archetypesByPos(aRoster, "OL", 5));
    // Skill + secondary archetypes (used for per-play modifiers)
    const collectArch = (roster) => ({
      QB:  archetypesByPos(roster, "QB", 1)[0],
      RB:  archetypesByPos(roster, "RB", 1)[0],
      WR1: archetypesByPos(roster, "WR", 2)[0],
      WR2: archetypesByPos(roster, "WR", 2)[1],
      TE:  archetypesByPos(roster, "TE", 1)[0],
      LB:  archetypesByPos(roster, "LB", 3),
      CB:  archetypesByPos(roster, "CB", 2),
      S:   archetypesByPos(roster, "S",  2),
    });
    this.homeArch = collectArch(hRoster);
    this.awayArch = collectArch(aRoster);
    this.score = { home: 0, away: 0 };
    this.quarter = 1; this.time = 900;
    // ── WEATHER ── chosen once per game, affects passing/kicking/fumbles.
    //   CLEAR (60%) — no effect
    //   WINDY (15%) — deep ball + FG harder
    //   RAIN  (15%) — fumbles up, comp down, slight YAC bump
    //   SNOW  (5%)  — combined wind + rain, FG range crushed
    //   HOT   (5%)  — minor fatigue late
    {
      const r = Math.random();
      let label;
      if      (r < 0.60) label = "CLEAR";
      else if (r < 0.75) label = "WINDY";
      else if (r < 0.90) label = "RAIN";
      else if (r < 0.95) label = "SNOW";
      else               label = "HOT";
      // Wind direction (-1 = toward home goal, +1 = toward away goal).
      // Only meaningful for WINDY / SNOW.
      const windDir = Math.random() < 0.5 ? -1 : 1;
      // Wind strength 0..1 (only used for WINDY/SNOW)
      const windStrength = label === "WINDY" ? 0.5 + Math.random() * 0.5
                         : label === "SNOW"  ? 0.4 + Math.random() * 0.4
                         : 0;
      this.weather = { label, windDir, windStrength };
    }
    this.poss = Math.random() < 0.5 ? "home" : "away";
    this.yardLine = 25; this.down = 1; this.ytg = 10;
    this.plays = []; this.drives = [];
    // Timeouts: each team gets 3 per half. Reset at halftime.
    this.timeouts = { home: 3, away: 3 };
    this._twoMinWarned = { half1: false, half2: false };  // ensure we only push the marker once
    this.stats = {
      home: this._buildTeamStats(this.homeR.starters),
      away: this._buildTeamStats(this.awayR.starters),
    };
    // Register OL players so pancakes / sacks_allowed accumulate per-player
    for (const [side, olArr] of [["home", this.homeOL], ["away", this.awayOL]]) {
      for (const p of olArr || []) {
        if (p?.name && !this.stats[side].players[p.name])
          this.stats[side].players[p.name] = { name: p.name, pos: p.subPos || "OL", pid: p.pid || null, ...this._emptyLine() };
      }
    }
    this._lastBallCarrier = null; // who got the ball on the last positive play
    this._lastBallType = null;    // 'pass' | 'rush'
    // Save base starters so per-snap rotation can always sub back to
    // the depth-chart No. 1 unless the current context (fatigue / garbage
    // time) calls for a backup. `homeR.starters` mutates per snap; this
    // snapshot is the source of truth for "who's the official starter."
    this._baseStarters = {
      home: { ...this.homeR.starters },
      away: { ...this.awayR.starters },
    };
    // Per-game fatigue accumulator. Keyed by player name, value 0-100.
    // Each snap bumps the players on the field by a position-cost amount;
    // critical engine math (comp %, sack %, broken tackles, rush yds) reads
    // these to degrade performance late in games — and the rotation logic
    // uses high fatigue as a sub trigger so workhorse RBs cede snaps to RB2.
    this._fatigue = {};
    // In-game momentum. Range -10..+10 per team. Swung by scores, turnovers,
    // 3-and-outs, explosive plays, 4th-down stops. Decays slowly between
    // drives. Engine reads it for small comp%/sack% tilts and play-call
    // aggression — modest individually, compounding across a hot streak.
    this._momentum = { home: 0, away: 0 };
  }
  // Swing the momentum needle. `team` = "home" | "away". Positive amount
  // adds to that team's momentum and (optionally) decays the opponent. The
  // result clamps to ±10. Source string is for the play-by-play feed.
  _swingMomentum(team, amount, source) {
    if (team !== "home" && team !== "away") return;
    const other = team === "home" ? "away" : "home";
    this._momentum[team]  = clamp((this._momentum[team]  || 0) + amount, -10, 10);
    this._momentum[other] = clamp((this._momentum[other] || 0) - amount * 0.5, -10, 10);
    // Surface big swings as a play-by-play visual so the ticker shows them.
    if (Math.abs(amount) >= 3 && source) {
      this._pushVisual?.({ kind: "momentum", team, amount, source,
        // Snapshot the post-swing momentum on the visual so the live HUD
        // strip can read off the new balance directly.
        momentumNow: { home: this._momentum.home, away: this._momentum.away },
        homeScore: this.score?.home, awayScore: this.score?.away });
    }
  }
  // Drive-end decay — momentum naturally regresses toward zero each drive
  // so a single big play doesn't define the whole game. Called after every
  // possession change.
  _decayMomentum() {
    this._momentum.home *= 0.85;
    this._momentum.away *= 0.85;
  }
  // Position-cost per snap. RBs absorb the most contact; OL/DL grind on
  // every play; QB / specialists are lower. Calibrated so a 65-snap game
  // for a workhorse RB ends near 60-70 fatigue (15-20% effective OVR cut).
  static _FATIGUE_COST = {
    QB:  0.7, RB:  1.5, WR:  1.1, TE:  1.2,
    OL:  1.3, LT:  1.3, LG:  1.3, C:   1.3, RG:  1.3, RT:  1.3,
    DL:  1.3, DE:  1.3, DT:  1.3, LDE: 1.3, RDE: 1.3, LDT: 1.3, RDT: 1.3,
    LB:  1.2, CB:  1.1, S:   1.0, FS:  1.0, SS:  1.0,
    K:   0.2, P:   0.2,
  };
  // Per-snap WEAR cost — cumulative micro-damage that survives across games.
  // Different curve than fatigue: lower per-snap, decays slowly across the
  // week (not after each game). High wear elevates injury risk and dings
  // late-game effective OVR. Audit-tuned so:
  //   - RB workhorse (62 snaps, 20 car) hits 90+ wear by mid-season
  //   - OL/DL/LB starters accrue ~50-65 wear by W17 (manageable, ramps late)
  //   - QB/WR stay mostly fresh unless heavily sacked / targeted
  // DL/LB lowered (was 0.13/0.10) because tackler wear stacks on top
  // and they were piling up to ~95+ by playoffs.
  static _WEAR_PER_SNAP = {
    QB:  0.06, RB:  0.12, FB:  0.11, WR:  0.07, TE:  0.09,
    OL:  0.11, LT:  0.11, LG:  0.11, C:   0.11, RG:  0.11, RT:  0.11,
    DL:  0.11, DE:  0.11, DT:  0.11, LDE: 0.11, RDE: 0.11, LDT: 0.11, RDT: 0.11,
    LB:  0.09, CB:  0.07, S:   0.07, FS:  0.07, SS:  0.07,
    K:   0.005, P: 0.005,
  };
  _bumpFatigue(name, costMul = 1.0) {
    if (!name) return;
    const p = this._playerByName.get(name);
    const pos = p?.position || p?.subPos || "WR";
    const baseCost = (this.constructor._FATIGUE_COST[pos] || 1.0);
    // Stamina rating (stats[12]) softens the cost: 90 stamina → 0.75×,
    // 60 stamina → 1.2×. Iron-man flag + RECEIVING-arch RB get a small
    // additional discount. Untrained 60-OVR scrub gases out fast.
    const stamina = p?.stats?.[12] ?? 70;
    const staminaMul = clamp(1 - (stamina - 70) / 80, 0.6, 1.4);
    const archMul = (p?.ironman ? 0.8 : 1.0)
                  * (p?.archetype === "RECEIVING" ? 0.88 : 1.0);
    const cost = baseCost * costMul * staminaMul * archMul;
    this._fatigue[name] = Math.min(100, (this._fatigue[name] || 0) + cost);
    // Wear accumulates onto the persistent player object so it survives
    // game→game. Same modifiers (stamina + ironman) tug on wear because
    // tougher bodies bank less micro-damage per snap.
    if (p) {
      const wearBase = (this.constructor._WEAR_PER_SNAP[pos] || 0.05);
      p._wear = Math.min(100, (p._wear || 0) + wearBase * staminaMul * archMul);
    }
  }
  // Wear bump for a single high-impact event (carry, reception, sack taken).
  // Touches are where the real punishment happens — a 20-carry game is
  // worse on the body than a 65-snap pass-blocking shift.
  //
  // Force-scaled:
  //   wear = baseAmount × tacklerForce × carrierVulnerability + bonuses
  //   tacklerForce = f(STR, SPD, archetype)  — bigger/faster hitters hurt more
  //   vulnerability = f(carrier STR)         — smaller players take more damage
  //   bonuses for negative-yard plays, sack depth, etc.
  //
  // Tackler also accrues wear (~40% of carrier wear) — action ≡ reaction;
  // a 245-lb LB throwing his body still feels the collision.
  //
  // High-force hits ALSO roll a small instant-injury chance. Wear scales
  // your weekly injury probability; the big-hit roll captures freak NFL
  // moments — the cart-off play that wasn't accumulated damage.
  _bumpHitWear(carrierName, baseAmount, tacklerName = null, opts = {}) {
    if (!carrierName || !baseAmount) return;
    const carrier = this._playerByName.get(carrierName);
    if (!carrier) return;
    // Tackler-driven force. STR + SPD as mass/velocity proxies; archetype
    // tilts (HEADHUNTER/POWER hit harder, BALL_HAWK is finesse).
    let force = 1.0;
    let tackler = null;
    if (tacklerName) {
      tackler = this._playerByName.get(tacklerName);
      if (tackler) {
        const tStr = tackler.stats?.[1] ?? 70;
        const tSpd = tackler.stats?.[0] ?? 70;
        // 60/60 → 0.6, 70/70 → 0.8, 85/85 → 1.30, 95/95 → 1.62
        force = ((tStr - 45) / 40 + (tSpd - 45) / 40) / 2;
        const arch = tackler.archetype || "";
        const archMul = (arch === "HEADHUNTER")            ? 1.35
                      : (arch === "POWER" || arch === "THUMPER")        ? 1.20
                      : (arch === "ENFORCER")              ? 1.20
                      : (arch === "BALL_HAWK" || arch === "COVER")      ? 0.85
                      : 1.0;
        force *= archMul;
      }
    }
    force = clamp(force, 0.5, 2.2);
    // Carrier vulnerability — smaller / less-built players absorb more
    // damage per hit. STR is the mass proxy. 60 STR → 1.30x; 75 → 1.0x;
    // 90 → 0.70x. The classic "WR taking a hit from a safety" effect.
    const cStr = carrier.stats?.[1] ?? 70;
    const vuln = clamp(1.0 + (75 - cStr) / 50, 0.65, 1.55);
    // Event extras: getting drilled in the backfield, deep sack, etc.
    let extra = 0;
    if (opts.negativeYards) extra += Math.abs(opts.negativeYards) * 0.18;
    if (opts.eventType === "sack") extra += 0.5 + Math.abs(opts.sackDepth || 0) * 0.07;
    // Carrier modifiers — stamina absorbs some pain; ironman/RECEIVING discount.
    const stamina = carrier.stats?.[12] ?? 70;
    const staminaMul = clamp(1 - (stamina - 70) / 80, 0.6, 1.4);
    const carrierArchMul = (carrier.ironman ? 0.8 : 1.0)
                        * (carrier.archetype === "RECEIVING" ? 0.92 : 1.0);
    const wear = (baseAmount * force * vuln + extra) * staminaMul * carrierArchMul;
    carrier._wear = Math.min(100, (carrier._wear || 0) + wear);
    // Tackler reciprocal wear (action ≡ reaction). 25% of the carrier's
    // wear, no vulnerability scaling (the hitter braced for it). High-STR
    // tacklers feel less proportionally because that's the whole point of
    // being built for contact. Lower than first-pass 0.40 because DL/LB
    // making 5-7 tackles/game compounded too aggressively across a season.
    if (tackler) {
      const tStamina = tackler.stats?.[12] ?? 70;
      const tStaminaMul = clamp(1 - (tStamina - 70) / 80, 0.6, 1.4);
      const tIronMul = tackler.ironman ? 0.8 : 1.0;
      const tackleWear = wear * 0.25 * tStaminaMul * tIronMul;
      tackler._wear = Math.min(100, (tackler._wear || 0) + tackleWear);
    }
    // ── BIG-HIT BROADCAST VISUAL ────────────────────────────────────
    // Surface high-force hits in the play log so the user SEES what
    // the biomechanics engine just did. Madden's play log is flat;
    // ours narrates the hit angle + force + likely body-part impact.
    if (tackler && force >= 1.45 && typeof this._pickHitMechanism === "function") {
      const mech = this._pickHitMechanism(tackler, opts);
      const mechLabel = mech === "head_on" ? "head-on collision"
                      : mech === "high"    ? "high hit"
                      : mech === "low"     ? "cut block"
                      : mech === "side"    ? "side hit"
                      : mech === "behind"  ? "blindside"
                      :                       mech;
      const archChip = tackler.archetype ? ` ${tackler.archetype.replace(/_/g," ")}` : "";
      const intensity = force >= 1.9 ? "💥 MASSIVE" : force >= 1.7 ? "💢 HEAVY" : "💥";
      this._pushVisual({
        kind: "big_hit",
        desc: `${intensity} HIT — ${tackler.name}${archChip} drills ${carrier.name} · ${mechLabel} · force ${force.toFixed(2)}`,
        tackler: tackler.name,
        carrier: carrier.name,
        mechanism: mech,
        force,
        eventType: opts.eventType,
      });
    }
    // BIG-HIT INJURY ROLL. Threshold lowered to 1.1 (was 1.3) and chance
    // bumped 2x — first audit had only 11 big-hits in 10 seasons league-
    // wide. NFL has ~5-10 visible "cart-off" moments per season, so target
    // ~50-100 league-wide additive injuries from impact-driven moments.
    if (force >= 1.1 || opts.eventType === "sack") {
      // Base injury chance bumped 50% (0.0030 → 0.0045) and sack/hitter chances
      // bumped proportionally. Brady-audit signal: injuries / team-season at 15.1
      // (NFL band 18-42) and season-ending at 2.1 (NFL band 4-14) — both
      // structurally low. The shortfall also let elite QBs play 17/17 every
      // year, stacking top-of-distribution passing totals well past NFL ceilings
      // (top QB seasons sat 6,100-6,340 yds vs all-time record 5,477). Lifting
      // the injury rate to NFL-realistic naturally trims 1-2 starts/year from
      // elite QBs (the Brady/Manning/Brees pattern) and lands all three flags.
      let injChance = (force - 0.9) * 0.0045 * vuln;
      if (opts.eventType === "sack") injChance += 0.0018 + Math.abs(opts.sackDepth || 0) * 0.00030;
      if (opts.negativeYards) injChance += Math.abs(opts.negativeYards) * 0.00075;
      if (Math.random() < injChance && typeof this._triggerBigHitInjury === "function") {
        this._triggerBigHitInjury(carrier, force, opts, tackler);
      }
      // Tackler can also get hurt on the same play — head-to-head
      // collisions, awkward angles, the hitter takes the worst of it.
      // Lower rate than the carrier (~1/3) because they braced, but
      // HEADHUNTERs and high-force hits also concuss the hitter.
      if (tackler && force >= 1.3) {
        const tStr = tackler.stats?.[1] ?? 70;
        const tVuln = clamp(1.0 + (75 - tStr) / 60, 0.7, 1.4);  // less than carrier vuln
        let tInjChance = (force - 1.1) * 0.0018 * tVuln;
        if (tackler.archetype === "HEADHUNTER") tInjChance *= 1.5;
        if (Math.random() < tInjChance && typeof this._triggerBigHitInjury === "function") {
          // Reverse the event — tackler is now the "carrier" of the injury
          this._triggerBigHitInjury(tackler, force, { eventType: "hitter", concussionLean: true }, carrier);
        }
      }
      // ── UR FLAG (Unnecessary Roughness) ───────────────────────────
      // Helmet-to-helmet / hit-on-defenseless-receiver penalties. Real
      // NFL: HEADHUNTER tackler + force ≥ 1.5 + defenseless receiver →
      // flag almost every time. Ejection rare — only for egregious or
      // repeat offenders. _maybeFlagURForHit handles both rolls.
      if (tackler && force >= 1.4 && typeof this._maybeFlagURForHit === "function") {
        this._maybeFlagURForHit(carrier, tackler, opts, force);
      }
    }
    // Return the computed hit force (0.5 - 2.2) so the visual emit path can
    // surface it as play.force. Same value drives the big-hit broadcast and
    // injury rolls above, so animation impact stays consistent with the
    // engine's biomechanics.
    return force;
  }
  // Unnecessary Roughness penalty + (rarer) ejection. Fires on big hits
  // where the tackler led with the helmet on a defenseless receiver or
  // delivered a clear high hit. NFL convention:
  //   • UR flag: 15 yds, automatic first down — fires often on high hits
  //   • Ejection: rare (~10% of UR flags), higher for HEADHUNTER + 2nd
  //     UR this game + force ≥ 1.7. Most NFL ejections are for fighting,
  //     not tackles, so we keep this rate low.
  _maybeFlagURForHit(carrier, tackler, opts, force) {
    if (!tackler) return;
    const arch = tackler.archetype || "";
    const ctx = opts.playContext || {};
    const mech = this._pickHitMechanism(tackler, opts);
    // Defenseless context — deep ball / crossing route / receiver still in
    // catching motion. These are the protected-player categories.
    const isDefenseless = ctx.type === "pass" && (
      ctx.depth === "deep" ||
      (ctx.depth === "short" && ctx.location === "middle") ||
      ctx.depth === "mid"
    );
    // Flag probability
    let chance = 0;
    if (mech === "high")                                chance = 0.55;
    else if (mech === "head_on" && arch === "HEADHUNTER" && force >= 1.6) chance = 0.40;
    else if (mech === "head_on" && isDefenseless && force >= 1.5) chance = 0.22;
    else if (arch === "HEADHUNTER" && force >= 1.7)     chance = 0.15;
    if (chance === 0) return;
    if (isDefenseless) chance *= 1.35;
    if (force >= 1.9) chance *= 1.15;
    if (Math.random() >= chance) return;
    // ── Apply UR penalty ──────────────────────────────────────────
    const defKey = this.poss === "home" ? "away" : "home";
    const meta = _PENALTY_RATES?.["Unnecessary Roughness"];
    const pen = {
      type: "Unnecessary Roughness",
      yds: meta?.yds || 15,
      autoFirst: !!(meta?.autoFirst),
      on: "def",
      _meta: {
        flaggedKey: defKey,
        offender: tackler.name,
        preDown: this.down,
        preYtg: this.ytg,
        preYardLine: this.yardLine,
      },
    };
    if (typeof this._applyPenaltyEffects === "function") {
      this._applyPenaltyEffects(pen, { hitTrigger: true, mechanism: mech, force });
    }
    // Track per-game UR count for ejection escalation
    tackler._urThisGame = (tackler._urThisGame || 0) + 1;
    // ── Ejection roll ──────────────────────────────────────────────
    // Rare in NFL (~1-3 per season). Real triggers:
    //   • Egregious helmet-leading hit (mech "high" + force ≥ 1.7)
    //   • Repeat UR in the same game (2nd or 3rd flag)
    //   • HEADHUNTER on defenseless + high force
    let ejectChance = 0;
    if (mech === "high" && force >= 1.7)              ejectChance += 0.18;
    if (arch === "HEADHUNTER" && isDefenseless && force >= 1.7) ejectChance += 0.10;
    if (tackler._urThisGame >= 2)                     ejectChance += 0.22;  // second flag in game
    if (tackler._urThisGame >= 3)                     ejectChance += 0.40;  // egregious pattern
    if (ejectChance > 0 && Math.random() < ejectChance) {
      tackler._ejectedThisGame = true;
      tackler.ejections = (tackler.ejections || 0) + 1;
      // Bench him — fake "injury" with weeksRemaining=0 so engine subs
      // him out for this game. Real recovery is fine because there's no
      // injury label, but the engine won't re-pick him.
      tackler._benchedRestOfGame = true;
      // Track for franchise news / discipline if available
      if (typeof franchise !== "undefined") {
        if (!franchise._ejectionLog) franchise._ejectionLog = {};
        const sk = String(franchise.season);
        if (!franchise._ejectionLog[sk]) franchise._ejectionLog[sk] = [];
        franchise._ejectionLog[sk].push({
          name: tackler.name, pos: tackler.position, arch,
          week: franchise.week, mechanism: mech, force,
          victim: carrier?.name || null,
        });
      }
      // Push a visual so the live log shows the ejection
      this._pushVisual({
        kind: "ejection",
        desc: `🚫 EJECTION — ${tackler.name} disqualified for the hit on ${carrier?.name || "the receiver"}`,
        offender: tackler.name,
        victim: carrier?.name || null,
        mechanism: mech,
        force,
      });
    }
  }
  // Big-hit instant injury. Uses the franchise's injury catalogue (typed,
  // position-weighted) but scales catastrophic-upgrade probability with
  // Resolve the HIT MECHANISM — angle from which the tackler contacted
  // the carrier. Real biomechanics: head-on collisions concuss/sternum/
  // planted-knee; low hits target ACL/MCL/ankle; side hits hit
  // shoulder/AC/hip; high hits go straight to concussion/neck; blindside
  // / behind hits crush shoulders + back because the player can't brace.
  // Tackler archetype + play context + event type determine distribution.
  _pickHitMechanism(tackler, opts = {}) {
    const ctx = opts.playContext || {};
    const eventType = opts.eventType;
    // Base weights — average tackle profile
    const w = { head_on: 0.30, side: 0.30, low: 0.15, high: 0.08, behind: 0.17 };
    // ── ARCHETYPE BIAS ────────────────────────────────────────────
    if (tackler?.archetype) {
      const a = tackler.archetype;
      if (a === "HEADHUNTER") { w.head_on += 0.25; w.high += 0.18; w.low -= 0.08; w.side -= 0.08; }
      else if (a === "POWER" || a === "THUMPER" || a === "ENFORCER") {
        w.head_on += 0.18; w.low += 0.08; w.side -= 0.05;
      }
      else if (a === "WRAP_UP" || a === "TECHNICIAN" || a === "FUNDAMENTAL") {
        // Textbook tackler — head across the bow, square hit, less injury angle
        w.head_on += 0.10; w.side += 0.12; w.high -= 0.05; w.behind -= 0.05;
      }
      else if (a === "BALL_HAWK" || a === "COVER" || a === "SHUTDOWN") {
        // Coverage tackler — chasing from behind / side, finesse
        w.side += 0.12; w.behind += 0.15; w.head_on -= 0.12; w.high -= 0.03;
      }
      else if (a === "DESPERATION") {
        // Beat in coverage → shoestring / cut block territory
        w.low += 0.30; w.head_on -= 0.10; w.high -= 0.05;
      }
      else if (a === "BLITZER" && eventType === "sack") {
        // Edge blitzer on a sack → blindside angle
        w.behind += 0.40; w.head_on -= 0.10;
      }
    }
    // ── PLAY-CONTEXT BIAS ────────────────────────────────────────
    if (eventType === "sack") {
      // Sacks: blindside (pocket collapse from edge), head-on (DT bull rush)
      w.behind += 0.20; w.head_on += 0.10; w.low -= 0.05;
    }
    if (ctx.type === "pass") {
      if (ctx.depth === "deep") {
        // Deep ball over the middle — safety lays the wood
        w.head_on += 0.20; w.high += 0.08; w.side += 0.05; w.low -= 0.15;
      } else if (ctx.depth === "short" && ctx.location === "middle") {
        // Crossing routes — LB squares up the receiver
        w.head_on += 0.15; w.high += 0.05;
      } else if (ctx.location === "outside") {
        // Sideline — DB rides receiver out of bounds, side hit
        w.side += 0.20; w.low -= 0.05;
      }
    }
    if (ctx.type === "run") {
      if (ctx.direction === "outside") {
        // Outside zone / sweep — CBs cut at the legs, shoestring tackles
        w.low += 0.20; w.side += 0.05; w.head_on -= 0.10;
      } else {
        // Inside run — head-on collisions at the LOS
        w.head_on += 0.10; w.low += 0.05;
      }
    }
    if (ctx.isGoalLine || (ctx.type === "run" && ctx.yards != null && ctx.yards < 0)) {
      // Pile / stuff at the LOS — head-on dominates, behind impossible
      w.head_on += 0.18; w.behind -= 0.15; w.low += 0.05;
    }
    if (ctx.type === "screen") {
      // Screens — defenders converge from all angles, often pile-driven
      w.head_on += 0.05; w.low += 0.10;
    }
    // ── WEIGHTED PICK ────────────────────────────────────────────
    let total = 0;
    for (const v of Object.values(w)) total += Math.max(0, v);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(w)) {
      if (v > 0 && (r -= v) <= 0) return k;
    }
    return "head_on";
  }
  // Big-hit instant injury. Uses the franchise's injury catalogue (typed,
  // position-weighted) but scales catastrophic-upgrade probability with
  // hit force — a 2.0-force collision is far more likely to escalate to
  // a torn ACL or chronic concussion than a 1.3-force hit.
  _triggerBigHitInjury(player, force, opts, tackler) {
    if (!player || (player.injury && player.injury.weeksRemaining > 0)) return;
    if (typeof _pickInjuryType !== "function") return;  // graceful no-op in tests
    let t = _pickInjuryType(player.position);
    if (!t) return;
    // ── PLAY-CONTEXT INJURY-TYPE BIASING ──────────────────────────────
    // Real biomechanics: a deep pass over the middle → S/CB hit → concussion
    // or shoulder. Goal-line stuff → pile → shoulder/knee/hand. Cut block
    // on outside run → knee. Sack → shoulder/concussion. Force the picker
    // toward likely body-part / mechanism combos.
    const ctx = opts.playContext || {};
    const pickType = (label) => {
      if (typeof INJURY_TYPES === "undefined") return null;
      return INJURY_TYPES.find(x => x.label === label) || null;
    };
    // Resolve the mechanism (head-on / side / low / high / behind) up
    // front so it can be stamped onto injury history. Mechanism layers
    // ON TOP of the play-context biasing below.
    const mechanism = this._pickHitMechanism(tackler, opts);
    if (opts.concussionLean && Math.random() < 0.60) {
      // Hitter-side reciprocal injury → mostly concussion
      const c = pickType("concussion"); if (c) t = c;
    } else if (opts.eventType === "sack" && force >= 1.5) {
      // Sack → shoulder (60%) or concussion (35%)
      const r = Math.random();
      if (r < 0.35) { const c = pickType("concussion"); if (c) t = c; }
      else if (r < 0.95) { const s = pickType("shoulder"); if (s) t = s; }
    } else if (ctx.type === "pass" && ctx.depth === "deep" && force >= 1.5) {
      // Deep pass + safety hit → concussion / shoulder (high-speed collision)
      const r = Math.random();
      if (r < 0.50) { const c = pickType("concussion"); if (c) t = c; }
      else if (r < 0.80) { const s = pickType("shoulder"); if (s) t = s; }
    } else if (ctx.type === "pass" && ctx.depth === "short" && ctx.location === "middle" && force >= 1.4) {
      // Crossing routes + LB middle hit → concussion / ribs (no rib var → chest reads as back)
      if (Math.random() < 0.45) { const c = pickType("concussion"); if (c) t = c; }
    } else if (ctx.type === "run" && ctx.direction === "outside" && force >= 1.3) {
      // Outside run + low tackle → knee/ankle (cut block territory)
      const r = Math.random();
      if (r < 0.45) { const k = pickType("knee"); if (k) t = k; }
      else if (r < 0.75) { const a = pickType("ankle sprain"); if (a) t = a; }
    } else if (ctx.isGoalLine || (ctx.type === "run" && ctx.yards < 0)) {
      // Pile-up at LOS / GL → shoulder, hand, sometimes knee from awkward fall
      const r = Math.random();
      if (r < 0.35) { const s = pickType("shoulder"); if (s) t = s; }
      else if (r < 0.55) { const h = pickType("hand/wrist"); if (h) t = h; }
      else if (r < 0.75) { const k = pickType("knee"); if (k) t = k; }
    } else if (tackler && tackler.archetype === "HEADHUNTER" && force >= 1.7) {
      if (Math.random() < 0.45) { const c = pickType("concussion"); if (c) t = c; }
    }
    // ── HIT-MECHANISM OVERRIDE ──────────────────────────────────────
    // Mechanism is the FINAL biomechanical filter — it overrides the
    // play-context bias if the hit angle was unambiguous. A high hit
    // (helmet-to-helmet) goes to concussion regardless of play type.
    // A low hit (cut block / shoestring) goes to knee/ankle. A side
    // hit hits shoulder. A behind hit (blindside sack) takes the
    // shoulder + sometimes back/hamstring.
    if (force >= 1.3) {
      const r = Math.random();
      if (mechanism === "high") {
        if (r < 0.80) { const c = pickType("concussion"); if (c) t = c; }
      } else if (mechanism === "low") {
        if (r < 0.55) { const k = pickType("knee"); if (k) t = k; }
        else if (r < 0.85) { const a = pickType("ankle sprain"); if (a) t = a; }
      } else if (mechanism === "side") {
        if (r < 0.55) { const s = pickType("shoulder"); if (s) t = s; }
        else if (r < 0.70) { const h = pickType("hand/wrist"); if (h) t = h; }
      } else if (mechanism === "behind") {
        // Can't brace — shoulder, back/hamstring strain, occasional concussion
        if (r < 0.40) { const s = pickType("shoulder"); if (s) t = s; }
        else if (r < 0.60) { const ham = pickType("hamstring"); if (ham) t = ham; }
        else if (r < 0.75) { const c = pickType("concussion"); if (c) t = c; }
      }
      // head_on → keep whatever the play-context picker chose
    }
    let isCatastrophic = false;
    let careerEnding = false;
    // Force-scaled catastrophic chance. At force 1.3 → ~3%, 1.7 → ~15%,
    // 2.0 → ~30%. Far above the weekly _CATASTROPHIC_UPGRADE_CHANCE of 8%.
    const catChance = clamp((force - 1.2) * 0.35, 0, 0.40);
    if (Math.random() < catChance && typeof _CATASTROPHIC_VARIANTS !== "undefined") {
      const variant = _CATASTROPHIC_VARIANTS[t.label];
      if (variant) {
        t = { ...t, ...variant };
        isCatastrophic = true;
        // Career-ending chance also force-scaled — a violent hit IS more
        // likely to end someone's career.
        const ceMul = force >= 1.9 ? 1.6 : force >= 1.6 ? 1.2 : 1.0;
        if (Math.random() < (variant.careerEndingChance || 0) * ceMul) {
          careerEnding = true;
        }
      }
    }
    // Force-scaled severity (concussion specifically — head-impact
    // duration scales with collision energy in real research).
    // Other injury labels keep their built-in min/max.
    let baseMin = t.min, baseMax = t.max;
    if (t.label === "concussion" && !isCatastrophic) {
      if      (force >= 2.0) { baseMin = 4; baseMax = 8; }
      else if (force >= 1.7) { baseMin = 3; baseMax = 6; }
      else if (force >= 1.4) { baseMin = 2; baseMax = 4; }
      // else default 1-2 weeks
    }
    const wks = careerEnding ? 99 : baseMin + Math.floor(Math.random() * (baseMax - baseMin + 1));
    player.injury = {
      label: t.label,
      weeksRemaining: wks,
      _ovrPenalty: t.ovrPenalty || 0,
      _catastrophic: isCatastrophic,
      _careerEnding: careerEnding,
      _bigHit: true,
    };
    // Concussion bookkeeping — big-hit concussions must count toward
    // the per-season stacking AND the Second Impact recency window.
    if (t.label === "concussion" && typeof franchise !== "undefined") {
      player._concussionsThisSeason = (player._concussionsThisSeason || 0) + 1;
      player._lastConcussionWeek = franchise.week;
    }
    if (careerEnding) {
      player._retiringFromInjury = true;
      if (typeof franchise !== "undefined") {
        if (!franchise._careerEndingLog) franchise._careerEndingLog = {};
        const sk = String(franchise.season);
        if (!franchise._careerEndingLog[sk] || typeof franchise._careerEndingLog[sk] === "number") {
          franchise._careerEndingLog[sk] = [];
        }
        franchise._careerEndingLog[sk].push({
          name: player.name, pos: player.position, age: player.age,
          ovr: player.overall || 0, allPros: player.allPros || 0, proBowls: player.proBowls || 0,
          label: t.label, cause: opts.eventType === "sack" ? "sack" : "big_hit",
          mechanism,
          tackler: tackler?.name || null,
        });
      }
    }
    player.injuryHistory = player.injuryHistory || [];
    // Bump body-part wear (specific region damaged). _bumpBodyPart lives
    // in play-franchise-season.js — guard for headless contexts.
    let bodyPart = null;
    if (typeof _bumpBodyPart === "function") {
      bodyPart = _bumpBodyPart(player, t.label, isCatastrophic ? 55 : 30);
    }
    if (typeof franchise !== "undefined") {
      player.injuryHistory.push({
        season: franchise.season,
        week: franchise.week,
        label: t.label,
        catastrophic: isCatastrophic,
        careerEnding,
        weeks: wks, duration: wks, bodyPart,
        cause: opts.eventType === "sack" ? "sack" : "big_hit",
        mechanism,
        tackler: tackler?.name || null,
      });
    }
  }
  // Legacy simple bump — kept for any callsites without tackler context.
  _bumpPlayerWear(name, amount) {
    this._bumpHitWear(name, amount, null, {});
  }
  _fatigueLevel(name) {
    return this._fatigue[name] || 0;
  }
  // Effective rating multiplier — at fatigue 60, ratings are 88%; at 100,
  // ratings are 80%. Caller can scale a numeric OVR / sub-stat by this.
  // Wear layers on top in the 4th quarter only — high-wear players hold
  // up early but fade late (mirrors NFL "worn down by Q4" feel).
  _fatigueMul(name) {
    const fatMul = 1 - (this._fatigueLevel(name) / 100) * 0.20;
    if (this.quarter !== 4) return fatMul;
    const p = this._playerByName?.get?.(name);
    const wear = p?._wear || 0;
    const wearLatePenalty = wear >= 85 ? 0.07
                         : wear >= 70 ? 0.045
                         : wear >= 50 ? 0.02
                         : 0;
    return fatMul - wearLatePenalty;
  }
  // Average fatigue across a player-array (used for OL/DL group fatigue).
  _avgFatigue(arr) {
    if (!arr?.length) return 0;
    return arr.reduce((s, p) => s + this._fatigueLevel(p?.name), 0) / arr.length;
  }
  // True if the team with the ball is in 2-minute drill mode:
  // < 2:00 left in Q2 or Q4, and either trailing or tied (and 4th-quarter).
  _isTwoMinDrill() {
    if (this.time > 120) return false;
    if (this.quarter !== 2 && this.quarter !== 4) return false;
    const offScore = this.score[this.poss];
    const defScore = this.score[this.poss === "home" ? "away" : "home"];
    if (this.quarter === 2) return offScore <= defScore + 14;   // end of half — go for points
    return offScore <= defScore;   // 4th quarter — only if tied or behind
  }
  // AI decides whether to burn a timeout. Returns the team that called it, or null.
  // Called between plays in _drive(). Only fires when the clock would keep running.
  //
  // HC personality on clock management — the timeout-call thresholds
  // shift based on the HC's coaching style:
  //   Riverboat Gambler  burns timeouts early (160s window, more
  //                      aggressive defensive TOs to get the ball back)
  //   Conservative       saves timeouts late (90s window, picky)
  //   Game Manager       balanced and disciplined (135s, no wasted TOs)
  //   Other              default (120s offense, 130s defense)
  _maybeCallTimeout(prevResult) {
    if (this.time > 180 || this.time <= 5) return null;          // only late in halves
    if (this.quarter !== 2 && this.quarter !== 4) return null;
    if (prevResult?.incomplete || prevResult?.turnover) return null;  // clock already stopped
    if (prevResult?.endDrive) return null;
    const offTeam = this.poss;
    const defTeam = this.poss === "home" ? "away" : "home";
    const offScore = this.score[offTeam];
    const defScore = this.score[defTeam];
    const diff = offScore - defScore;
    // HC clock-management style per team
    const tidOf = (key) => key === "home" ? this.home.id : this.away.id;
    const styleFor = (key) => {
      if (typeof franchise === "undefined") return null;
      return franchise.coaches?.[tidOf(key)]?.hc?.specialtyTrait;
    };
    const toWindowFor = (key) => {
      const s = styleFor(key);
      if (s === "Riverboat Gambler") return 160;
      if (s === "Conservative")      return 90;
      if (s === "Game Manager")      return 135;
      return 120;
    };
    const offTOWindow = toWindowFor(offTeam);
    const defTOWindow = Math.max(toWindowFor(defTeam), 100);  // defense always slightly earlier
    // Offense calls TO if behind and clock running out
    if (this.timeouts[offTeam] > 0 && diff <= 0 && this.time < offTOWindow) {
      this.timeouts[offTeam]--;
      this.plays.push({
        kind: "timeout",
        desc: `Timeout — ${this[offTeam].city} ${this[offTeam].name}`,
        team: offTeam, quarter: this.quarter, time: this.time,
        timeoutsRemaining: { ...this.timeouts },
        homeScore: this.score.home, awayScore: this.score.away,
      });
      return offTeam;
    }
    // Defense calls TO if trailing big and worried opponent will run clock out
    if (this.timeouts[defTeam] > 0 && diff >= 1 && diff <= 16 && this.time < defTOWindow) {
      this.timeouts[defTeam]--;
      this.plays.push({
        kind: "timeout",
        desc: `Timeout — ${this[defTeam].city} ${this[defTeam].name} (defense)`,
        team: defTeam, quarter: this.quarter, time: this.time,
        timeoutsRemaining: { ...this.timeouts },
        homeScore: this.score.home, awayScore: this.score.away,
      });
      return defTeam;
    }
    return null;
  }
  // ── Rotation ──────────────────────────────────────────────────────────
  // Per-snap depth-chart rotation. Triggers:
  //   - Garbage time (game out of reach late) — both teams sub
  //   - Fatigue: starter accumulates touches over the game and rests
  // Starts each snap from this._baseStarters (depth-chart No. 1) and
  // optionally mutates this.offR.starters before the play runs so the
  // existing read sites (no plumbing changes) see the active player.
  _isGarbageTime() {
    const diff = Math.abs(this.score.home - this.score.away);
    if (this.quarter === 4 && this.time <= 600 && diff >= 17) return "heavy";
    if (this.quarter === 4 && diff >= 14) return "mild";
    if (this.quarter >= 3 && diff >= 28) return "mild";
    return null;
  }
  _pickBackup(side, position, excludeNames) {
    const roster = side === "home" ? this.hRoster : this.aRoster;
    const set = new Set(excludeNames);
    // Filter out injured players — a torn-ACL guy shouldn't be the
    // backup just because nobody else is on the bench at that position.
    const candidates = roster
      .filter(p => p.position === position && !set.has(p.name)
                && !(p.injury && p.injury.weeksRemaining > 0))
      .sort((a, b) => (b.overall || 0) - (a.overall || 0));
    return candidates[0]?.name || null;
  }
  _ensurePlayerStat(side, name, pos) {
    if (!name) return;
    const players = this.stats[side].players;
    if (!players[name]) {
      const pid = this._playerByName?.get(name)?.pid || null;
      players[name] = { name, pos, pid, ...this._emptyLine() };
    }
  }
  _touchesFor(side, name) {
    const line = this.stats[side].players[name];
    if (!line) return 0;
    return (line.rush_att || 0) + (line.rec_tgt || 0);
  }
  _rotateForSnap() {
    const side = this.poss;
    // Always reset to base depth chart first, then optionally sub.
    Object.assign(this.offR.starters, this._baseStarters[side]);
    // ── INJURY SWAP ────────────────────────────────────────────────
    // Mid-game injuries don't update _baseStarters, so the base reset
    // above can re-install a player who just tore their ACL. Walk the
    // offensive starter roles and swap any injured guy for a healthy
    // backup. This is what makes "player out 15w" actually mean he
    // doesn't take more snaps in this game (was a real bug — injured
    // WR1 kept getting targeted because his name was still in starters).
    const swapIfInjured = (role, position) => {
      const curName = this.offR.starters[role];
      if (!curName) return;
      const cur = this._playerByName?.get?.(curName);
      if (!cur || !cur.injury || !(cur.injury.weeksRemaining > 0)) return;
      const exclude = Object.values(this.offR.starters);
      const backup = this._pickBackup(side, position, exclude);
      if (backup) {
        // Announce the sub ONCE (first snap the injured guy can't take).
        // Track per-player so subsequent snaps don't keep spamming the same
        // event over and over.
        if (!this._injurySubAnnounced) this._injurySubAnnounced = new Set();
        const key = `${side}:${curName}`;
        if (!this._injurySubAnnounced.has(key)) {
          this._injurySubAnnounced.add(key);
          this._pushVisual({
            kind: "substitution",
            reason: "injury",
            side, role, position,
            out: curName, in: backup,
            injuryLabel: cur.injury.label || "injury",
            catastrophic: !!cur.injury._catastrophic,
            desc: `↺ SUB · ${position} ${curName} OUT (${cur.injury.label || "injury"}) → ${backup} IN`,
          });
        }
        this.offR.starters[role] = backup;
        this._ensurePlayerStat(side, backup, position);
      }
    };
    swapIfInjured("qb",  "QB");
    swapIfInjured("rb",  "RB");
    swapIfInjured("rb2", "RB");
    swapIfInjured("wr1", "WR");
    swapIfInjured("wr2", "WR");
    swapIfInjured("wr3", "WR");
    swapIfInjured("wr4", "WR");
    swapIfInjured("te",  "TE");
    swapIfInjured("te2", "TE");
    swapIfInjured("k",   "K");
    swapIfInjured("p",   "P");
    const garbage = this._isGarbageTime();
    const snapMap = side === "home" ? this.homeSnaps : this.awaySnaps;
    // Per-game snap counter (for count-mode contracts)
    if (!this._slotSnaps) this._slotSnaps = { home: {}, away: {} };
    const slotSnaps = this._slotSnaps[side];
    const trySub = (role, position) => {
      const cur = this.offR.starters[role];
      if (!cur) return;
      // Read contract entry — could be a legacy number OR an object
      // with {share, mode, target, smart}. Normalize.
      const entry = snapMap?.[role];
      const share = (entry == null) ? null
                  : (typeof entry === "number") ? entry
                  : entry.share;
      const mode = (entry && typeof entry === "object") ? entry.mode : null;
      const target = (entry && typeof entry === "object") ? entry.target : null;
      // ── COUNT MODE — hard cap: sub when slot snaps hit target ────
      if (mode === "count" && target != null) {
        slotSnaps[role] = (slotSnaps[role] || 0) + 1;
        if (slotSnaps[role] > target) {
          // Force sub for remainder of game (unless garbage time forces
          // double-sub which is fine)
          const exclude = Object.values(this.offR.starters);
          const backup = this._pickBackup(side, position, exclude);
          if (backup) {
            this.offR.starters[role] = backup;
            this._ensurePlayerStat(side, backup, position);
          }
          return;
        }
        // Below target → stay on field; no other sub roll fires
        return;
      }
      // ── SHARE MODE (legacy + smart-share fallback) ───────────────
      let p = (share != null) ? Math.max(0, 1 - share) : 0;
      if (garbage === "heavy") p = Math.max(p, 0.55);
      else if (garbage === "mild") p = Math.max(p, 0.25);
      // Touch-based sub (legacy fatigue management)
      const t = this._touchesFor(side, cur);
      if (t >= 20)      p = Math.max(p, 0.40);
      else if (t >= 15) p = Math.max(p, 0.25);
      else if (t >= 10) p = Math.max(p, 0.12);
      // Touch-target contract: if mode === "touches" and we've hit
      // (or just hit) the target, sub out. Tightened from 0.8 → 0.95
      // so the starter actually lands close to target (was missing by
      // ~2-3 carries when 0.8 kicked the back-off early).
      if (mode === "touches" && target != null) {
        if (t >= target)             p = Math.max(p, 0.85);
        else if (t >= target * 0.95) p = Math.max(p, 0.30);
      }
      // Fatigue-driven blow: starter rests automatically at high fatigue.
      // At 70+ fatigue, sub chance bumps to at least 35%; at 90+, 60%.
      const fat = this._fatigueLevel(cur);
      if (fat >= 90)      p = Math.max(p, 0.60);
      else if (fat >= 75) p = Math.max(p, 0.40);
      else if (fat >= 60) p = Math.max(p, 0.22);
      if (p <= 0 || Math.random() > p) {
        slotSnaps[role] = (slotSnaps[role] || 0) + 1;
        return;
      }
      const exclude = Object.values(this.offR.starters);
      const backup = this._pickBackup(side, position, exclude);
      if (backup) {
        this.offR.starters[role] = backup;
        this._ensurePlayerStat(side, backup, position);
      }
    };
    trySub("rb",  "RB");
    trySub("wr1", "WR");
    trySub("wr2", "WR");
    trySub("te",  "TE");
    // QB only rotates in heavy garbage time — never on fatigue alone.
    if (garbage === "heavy" && Math.random() < 0.35) {
      const exclude = Object.values(this.offR.starters);
      const backup = this._pickBackup(side, "QB", exclude);
      if (backup) {
        this.offR.starters.qb = backup;
        this._ensurePlayerStat(side, backup, "QB");
      }
    }
  }
  // Smart-contract touch-target API — pickers consult this to bias their
  // selection toward whichever player has an unmet touches target. The
  // caller passes the candidate role names; we return a multiplier per
  // role: >1 if this player is BEHIND their target (boost), <1 if they
  // are AT or PAST target (back off).
  _touchTargetMul(side, role) {
    const snapMap = side === "home" ? this.homeSnaps : this.awaySnaps;
    const entry = snapMap?.[role];
    if (!entry || typeof entry !== "object" || entry.mode !== "touches") return 1.0;
    const target = entry.target;
    if (target == null) return 1.0;
    const name = this.offR.starters[role];
    if (!name) return 1.0;
    const got = this._touchesFor(side, name);
    if (got >= target)         return 0.35;  // past target — back off
    if (got >= target * 0.85)  return 0.85;  // close — slight back-off
    if (got <= target * 0.45)  return 1.45;  // behind — boost
    if (got <= target * 0.65)  return 1.20;
    return 1.0;
  }

  _buildTeamStats(starters) {
    const players = {};
    const add = (name, pos) => { if (name && !players[name]) { const pid = this._playerByName?.get(name)?.pid || null; players[name] = { name, pos, pid, ...this._emptyLine() }; } };
    add(starters.qb, "QB");
    add(starters.rb, "RB");
    add(starters.rb2, "RB");   // backup/committee RB — was MISSING, so all rb2
                               // carries (committee + two-back + reverse) were
                               // silently dropped from player stats (team totals
                               // still counted). Now credited.
    add(starters.wr1, "WR");
    add(starters.wr2, "WR");
    add(starters.wr3, "WR");   // slot WR — gets real targets in 3-WR sets
    add(starters.te2, "TE");   // TE2 — receptions in 12 personnel
    add(starters.te3, "TE");   // TE3 — receptions in 13 (JUMBO) personnel
    add(starters.te, "TE");
    add(starters.k,  "K");
    add(starters.p,  "P");
    // Defensive starters get rows too
    add(starters.de1, "DE"); add(starters.de2, "DE");
    add(starters.dt1, "DT"); add(starters.dt2, "DT");
    add(starters.lb1, "LB"); add(starters.lb2, "LB"); add(starters.lb3, "LB");
    add(starters.cb1, "CB"); add(starters.cb2, "CB");
    add(starters.fs,  "FS"); add(starters.ss,  "SS");
    return {
      team: {
        plays: 0, totalYds: 0, passYds: 0, rushYds: 0,
        pass_att: 0, pass_comp: 0, rush_att: 0,
        sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0,
        firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0,
        rz_att: 0, rz_td: 0,
        timeOfPoss: 0, penalties: 0, penaltyYds: 0,
      },
      players,
    };
  }
  _emptyLine() {
    return {
      pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0, pass_long: 0,
      sacks_taken: 0, sack_yds: 0,
      rush_att: 0, rush_yds: 0, rush_td: 0, rush_long: 0, broken_tackles: 0,
      fumbles: 0, fumbles_lost: 0,
      rec_tgt: 0, rec: 0, rec_yds: 0, rec_td: 0, rec_long: 0, rec_drops: 0,
      fg_made: 0, fg_att: 0, fg_long: 0, xp_made: 0, xp_att: 0,
      // Defensive stats
      tkl: 0, sk: 0, sk_yds: 0, int_made: 0, int_yds: 0, int_long: 0, int_td: 0,
      pd: 0, ff: 0, fr: 0, def_td: 0, missed_tkl: 0,
      // OL-specific
      pancakes: 0, sacks_allowed: 0,
      // Special teams
      punt_att: 0, punt_yds: 0, punt_long: 0, punts_in_20: 0, touchbacks: 0,
      pr_att: 0, pr_yds: 0, pr_long: 0, pr_td: 0,
      kr_att: 0, kr_yds: 0, kr_long: 0, kr_td: 0,
      blk_kick: 0,
    };
  }
  // Resolve play-context to a position-weight table + assist rate.
  // This is the first-principles layer: WHO tackles depends on what
  // happened. A deep pass is overwhelmingly a safety; a goal-line stuff
  // is a DL/LB pile (high assist); an outside run is OLB/CB/S, not DL.
  //
  // ctx = { type, depth, location, direction, yards, isGoalLine }
  //   type:      "run" | "pass" | "screen" | "scramble" | "tor" | "special"
  //   depth:     "short" | "mid" | "deep"     (for passes — air yards bucket)
  //   location:  "middle" | "outside"          (for passes — route side)
  //   direction: "inside" | "outside"          (for runs)
  //   yards:     final yards gained
  //   isGoalLine: tackle happened inside the 5
  _tackleWeightsForContext(ctx) {
    if (!ctx || typeof ctx !== "object") return { weights: { LB: 0.35, S: 0.30, CB: 0.25, DL: 0.10 }, assistRate: 0.30 };
    const { type, depth, location, direction, yards = 0, isGoalLine } = ctx;
    // Goal-line override — gang tackle, DL/LB pile, very high assist
    if (isGoalLine) return { weights: { DL: 0.45, LB: 0.40, S: 0.12, CB: 0.03 }, assistRate: 0.65 };
    if (type === "run") {
      if (yards < 0) {
        // Tackle for loss — DL/LB at the LOS, very high assist (pile)
        return { weights: { DL: 0.50, LB: 0.35, S: 0.10, CB: 0.05 }, assistRate: 0.55 };
      }
      if (yards >= 10) {
        // Breakaway — DBs catch from depth, low assist (open-field solo)
        return { weights: { S: 0.45, CB: 0.30, LB: 0.20, DL: 0.05 }, assistRate: 0.12 };
      }
      if (direction === "outside") {
        // Outside zone / sweep — OLB/CB/S converge, DL barely involved
        return { weights: { LB: 0.30, S: 0.30, CB: 0.30, DL: 0.10 }, assistRate: 0.25 };
      }
      // Inside run, short positive — DL/MLB territory, moderate assist
      return { weights: { DL: 0.30, LB: 0.45, S: 0.15, CB: 0.10 }, assistRate: 0.40 };
    }
    if (type === "pass") {
      if (depth === "deep") {
        // 20+ air yards — safeties + deep CBs almost exclusively
        return { weights: { S: 0.55, CB: 0.35, LB: 0.10, DL: 0.0 }, assistRate: 0.10 };
      }
      if (depth === "mid") {
        // 10-19 air yards — CBs and safeties, occasional LB
        return { weights: { CB: 0.40, S: 0.30, LB: 0.25, DL: 0.05 }, assistRate: 0.18 };
      }
      // Short pass (<10 air yards) — split by middle vs outside
      if (location === "outside") {
        // Slants/outs/flats outside — CBs/safeties handle
        return { weights: { CB: 0.45, S: 0.25, LB: 0.20, DL: 0.10 }, assistRate: 0.25 };
      }
      // Short middle / generic — LB-dominated
      return { weights: { LB: 0.50, S: 0.20, CB: 0.20, DL: 0.10 }, assistRate: 0.30 };
    }
    if (type === "screen") {
      // Screen pass — LB / DL pursuit, often-pile, moderate assist
      return { weights: { LB: 0.35, DL: 0.20, S: 0.20, CB: 0.25 }, assistRate: 0.40 };
    }
    if (type === "scramble") {
      // QB rushes from pocket — LB pursuit, S converge in open field
      return { weights: { LB: 0.35, S: 0.30, DL: 0.20, CB: 0.15 }, assistRate: 0.25 };
    }
    if (type === "tor") {
      // Throw on the run — receiver caught in space, DBs handle
      return { weights: { CB: 0.40, S: 0.30, LB: 0.20, DL: 0.10 }, assistRate: 0.20 };
    }
    if (type === "special") {
      // Special teams (kick/punt return) — coverage units tackle
      return { weights: { S: 0.30, CB: 0.30, LB: 0.30, DL: 0.10 }, assistRate: 0.30 };
    }
    // Generic fallback (shouldn't hit much once all sites pass context)
    return { weights: { LB: 0.35, S: 0.30, CB: 0.25, DL: 0.10 }, assistRate: 0.30 };
  }
  // Pick a defender (weighted by position) and credit a stat field
  // Credit a tackle to the primary tackler AND, an assist to a different
  // defender. Both the weights AND the assist rate now come from play
  // context — a deep pass is overwhelmingly a safety, a goal-line stuff
  // is a high-assist gang tackle, etc. See _tackleWeightsForContext.
  //
  // Backwards-compat: callers can still pass a raw weights object
  // Build per-slot WR/TE/RB route tracks for a pass play. Shared by
  // complete, incomplete, and int handlers so route fidelity is
  // consistent regardless of outcome.
  _buildPassRouteTracks(opts) {
    const { targetSlot, targetDepth, yac = 0, concept, throwT } = opts;
    const slotRouteShape = (slot, conc) => {
      // SHORT TE/RB target — override the concept shape with a SWING/
      // FLAT shape. At targetDepth <= 3 the QUICK_GAME shape gave the
      // TE 0.4yd forward + 1yd sideways by break = "TE catches the ball
      // standing on the LOS". Real 1-3yd TE/RB throws are flats and
      // swings — early break, big lateral release, almost no vertical.
      if (slot === targetSlot && (slot === "te" || slot === "te2" || slot === "rb") && targetDepth <= 3) {
        // dyYd convention: positive = toward midfield, negative = toward
        // sideline. A flat / swing leak goes OUTWARD toward the sideline
        // the player started on (the route is direction-agnostic — the
        // animation projects via toMidSign).
        return {
          breakF: 0.18,                              // very early release
          depthFAtBreak: 0.05,                       // by break: mostly lateral
          depth: Math.max(1, targetDepth),
          latAtBreak: slot === "rb" ? -4.0 : -4.5,  // outward release
          latAtCatch: slot === "rb" ? -7.0 : -7.5,  // wide flat to sideline
        };
      }
      // te2 mirrors the TE concept shape; its opposite-side alignment is
      // handled by toMidSign in the renderer. Slot WRs (wr3/wr4) fall to
      // each concept's default (an inside-breaking route).
      if (slot === "te2") slot = "te";
      switch (conc) {
        case "QUICK_GAME":
          // Slant + quick-out. wr1 cuts inside (slant), wr2 cuts
          // outside (quick out). Was both `lat 2.5` which made wr1
          // and wr2 mirror each other and converge near midfield.
          if (slot === "wr1") return { breakF: 0.30, depthFAtBreak: 0.40, depth: 6, latAtBreak: 0.5,  latAtCatch:  5.0 };  // slant in
          if (slot === "wr2") return { breakF: 0.25, depthFAtBreak: 0.30, depth: 4, latAtBreak: 0.0,  latAtCatch: -3.0 };  // quick out
          if (slot === "te")  return { breakF: 0.30, depthFAtBreak: 0.40, depth: 6, latAtBreak: 0.5,  latAtCatch: -1.5 };
          return { breakF: 0.30, depthFAtBreak: 0.40, depth: 6, latAtBreak: 0.5, latAtCatch: 2.5 };
        case "DRAG_MESH":
          // DRAG_MESH = crossing routes. Both WRs run TOWARD MIDDLE.
          // dyYd convention: positive = toward midfield. Both wr1 and
          // wr2 should have POSITIVE latAtCatch. wr2 was -6.0 (toward
          // sideline) which sent the receiver ~1.5 yd past the sideline
          // at the catch — caused "QB completed pass to WR who was out
          // of bounds" complaints.
          if (slot === "wr1") return { breakF: 0.30, depthFAtBreak: 0.20, depth: 6,  latAtBreak: 3.0,  latAtCatch: 8.0 };
          if (slot === "wr2") return { breakF: 0.30, depthFAtBreak: 0.20, depth: 8,  latAtBreak: 2.5,  latAtCatch: 6.0 };
          if (slot === "te")  return { breakF: 0.55, depthFAtBreak: 0.70, depth: 12, latAtBreak: 1.0,  latAtCatch: 3.0 };
          return { breakF: 0.30, depthFAtBreak: 0.20, depth: 5, latAtBreak: 0, latAtCatch: 4 };
        case "INTERMEDIATE":
          if (slot === "wr1") return { breakF: 0.72, depthFAtBreak: 1.00, depth: 14, latAtBreak: 0.0, latAtCatch: -3.0 };
          if (slot === "wr2") return { breakF: 0.72, depthFAtBreak: 1.00, depth: 12, latAtBreak: 0.0, latAtCatch: 3.0 };
          if (slot === "te")  return { breakF: 0.50, depthFAtBreak: 0.65, depth: 10, latAtBreak: 0.0, latAtCatch: 0.0 };
          return { breakF: 0.50, depthFAtBreak: 0.50, depth: 8, latAtBreak: 0, latAtCatch: 0 };
        case "VERTICAL":
        case "PA_SHOT":
          // Go + dig high-low. wr1 runs the go (22yd straight); wr2
          // runs a deep dig (18yd then breaks toward middle) so the
          // two aren't sharing the same depth + lane. Was both `depth
          // 22 lat 0` — identical go routes at the same yard line.
          if (slot === "wr1") return { breakF: 0.95, depthFAtBreak: 0.95, depth: 22, latAtBreak: 0.0, latAtCatch:  0.0 };
          if (slot === "wr2") return { breakF: 0.80, depthFAtBreak: 1.00, depth: 18, latAtBreak: 0.0, latAtCatch:  5.0 };
          if (slot === "te")  return { breakF: 0.95, depthFAtBreak: 0.95, depth: 18, latAtBreak: 0.0, latAtCatch:  1.5 };
          return { breakF: 0.95, depthFAtBreak: 0.95, depth: 18, latAtBreak: 0, latAtCatch: 0 };
        case "SCREEN":
          return null;
        default:
          // Mirrored curls — wr1 outside, wr2 inside.
          if (slot === "wr1") return { breakF: 0.50, depthFAtBreak: 0.50, depth: 10, latAtBreak: 0.0, latAtCatch: -2.0 };
          if (slot === "wr2") return { breakF: 0.50, depthFAtBreak: 0.50, depth:  8, latAtBreak: 0.0, latAtCatch:  2.0 };
          return { breakF: 0.50, depthFAtBreak: 0.50, depth: 10, latAtBreak: 0.0, latAtCatch: 0.0 };
      }
    };
    const trackFor = (slot) => {
      const shape = slotRouteShape(slot, concept);
      if (!shape) return null;
      const isTgt = slot === targetSlot;
      const endDepth = isTgt ? targetDepth : shape.depth;
      const endLat   = shape.latAtCatch;
      const wps = [
        { t: 0,                                          dxYd: 0,                              dyYd: 0 },
        { t: throwT * shape.breakF,                      dxYd: endDepth * shape.depthFAtBreak, dyYd: shape.latAtBreak },
        { t: throwT,                                     dxYd: endDepth,                       dyYd: endLat },
      ];
      if (isTgt && yac > 0) {
        wps.push({ t: Math.min(1, throwT + (1 - throwT) * 0.85), dxYd: endDepth + yac, dyYd: endLat + Math.min(2, yac * 0.05) });
        wps.push({ t: 1, dxYd: endDepth + yac, dyYd: endLat + Math.min(2, yac * 0.05) });
      } else {
        wps.push({ t: Math.min(1, throwT + (1 - throwT) * 0.85), dxYd: endDepth + 2, dyYd: endLat });
        wps.push({ t: 1, dxYd: endDepth + 2, dyYd: endLat });
      }
      return { role: slot.toUpperCase(), origin: { slot }, waypoints: wps };
    };
    // Build a route track for every receiver ACTUALLY ON THE FIELD for the
    // current personnel (so non-targets run real decoy routes instead of
    // hash paths — Phase 4 intent), plus always the targeted slot. Gating
    // by personnel keeps us from emitting tracks for off-field slots (e.g.
    // wr4 in an 11-personnel set) that have no sprite to animate.
    const _pers = (typeof PERSONNEL !== "undefined" && PERSONNEL[this._currentPersonnel]) || null;
    const _slots = new Set(["wr1", "wr2"]);
    if (!_pers || _pers.wr >= 3) _slots.add("wr3");
    if (_pers && _pers.wr >= 4) _slots.add("wr4");
    if (!_pers || _pers.te >= 1) _slots.add("te");
    if (_pers && _pers.te >= 2) _slots.add("te2");
    if (!_pers || _pers.rb >= 1) _slots.add("rb");
    if (targetSlot) _slots.add(targetSlot);   // never drop the credited receiver's track
    const tracks = {};
    for (const slot of _slots) {
      if (!this.offR.starters[slot]) continue;
      const trk = trackFor(slot);
      if (trk) tracks[slot] = trk;
    }
    return tracks;
  }
  // Build the post-catch tackler pursuit track. Formation start +
  // converge on the receiver's catch + YAC endpoint at t=0.78.
  _buildPassTacklerTrack(opts) {
    const { tacklerSlot, tacklerName, targetSlot, targetDepth, yac, throwT, routeTracks } = opts;
    const startBySlot = {
      cb1: { dxYd: 5,  dyYd: -16 },
      cb2: { dxYd: 5,  dyYd:  16 },
      fs:  { dxYd: 12, dyYd:   0 },
      ss:  { dxYd: 8,  dyYd:   5 },
      lb1: { dxYd: 5.5, dyYd: -3 },     // matches makeFormation lbDepth=5.5
      lb2: { dxYd: 5.5, dyYd:  0 },
      lb3: { dxYd: 5.5, dyYd:  3 },
      nb:  { dxYd: 5,  dyYd: -10 },
    };
    const start = startBySlot[tacklerSlot];
    if (!start) return null;
    // Resolve receiver's catch + YAC endpoint in absolute (LOS, cy)
    // yards. Receiver tracks emit dyYd as "toward midfield" relative
    // to the formation slot — convert to absolute via slot sign +
    // formation offset.
    const wrSign = targetSlot === "wr1" || targetSlot === "wr3" ? -1   // left-side slots
                 : targetSlot === "wr2" || targetSlot === "wr4" ?  1   // right-side slots
                 : targetSlot === "te"  ?  1                            // te1 aligns right
                 : targetSlot === "te2" ? -1                            // te2 aligns left
                 : targetSlot === "rb"  ?  1
                 : 0;
    const wrFormOffsetYd = targetSlot === "wr1" || targetSlot === "wr2" ? 16
                         : targetSlot === "wr3" || targetSlot === "wr4" ? 10
                         : targetSlot === "te" || targetSlot === "te2" ? 5
                         : targetSlot === "rb" ? 1.87
                         : 0;
    // Sample the route track's catch waypoint for the actual latAtCatch
    // (cleaner than recomputing concept shape).
    let endLatAbs = 0;
    if (targetSlot && routeTracks && routeTracks[targetSlot]) {
      const wps = routeTracks[targetSlot].waypoints;
      // throwT waypoint is the third (catch moment); ydyYd is "toward
      // midfield" so its absolute value is the slot's lateral
      // displacement from formation.
      const catchWp = wps.find(w => Math.abs(w.t - throwT) < 0.01) || wps[2];
      if (catchWp) endLatAbs = catchWp.dyYd;
    }
    const endDxYd = targetDepth + yac;
    const endDyAbs = wrSign * (wrFormOffsetYd - endLatAbs);
    // Tackler keeps closing on the receiver THROUGH the tackle moment
    // instead of arriving early and holding. Previously: tackler at the
    // endpoint by t=0.78, then sat there for ~22% of the play while the
    // receiver glided in — "defender waited for him there, receiver fell
    // backwards without contact". Now the tackler is STILL APPROACHING
    // at t=0.78 (slightly past the catch line in the carrier's run
    // direction) and continues driving FORWARD through to t=1.0 — looks
    // like a driving tackle, not a static collision.
    return {
      role: tacklerSlot.toUpperCase(),
      tacklerName,
      waypoints: [
        { t: 0.00,        dxYd: start.dxYd,                       dyYd: start.dyYd },
        { t: throwT * 0.7,
                          dxYd: start.dxYd - (tacklerSlot.startsWith("cb") ? 0 : 1.5),
                          dyYd: start.dyYd * 0.7 },
        // At the catch moment, tackler is still 5-6 yd short of the
        // YAC endpoint (closing fast from coverage).
        { t: throwT,      dxYd: Math.max(targetDepth - 3, start.dxYd),    dyYd: endDyAbs * 0.5 },
        // At the tackle moment, tackler meets the receiver mid-stride —
        // both arriving at the YAC spot at the same instant.
        { t: 0.78,        dxYd: endDxYd,                          dyYd: endDyAbs },
        // After contact, tackler keeps driving forward 2-3 yd (driving
        // the carrier back). Matches the receiver's post-tackle motion
        // so they look locked together going down, not statues.
        { t: 1.00,        dxYd: endDxYd + 2.5,                    dyYd: endDyAbs },
      ],
    };
  }
  // Build LB / FS / SS coverage-aware tracks for pass plays.
  // Coverage matters: C0_BLITZ sends LBs at the QB, C1_MAN puts LBs
  // on TE/RB, zone coverages drop them to hook zones at depth.
  // Skips the slot matching the credited tackler.
  _buildPassZoneDrops(opts) {
    const { tacklerSlot, throwT, coverage = "C2_ZONE", catchDepth = 0 } = opts;
    // Deep catches (15+ yd) draw LBs out of their hook zones — they
    // can't catch up to a deep ball but they should at least TURN AND
    // RUN toward the play instead of jogging in place at hook depth.
    // Non-deep catches use the small post-throw drift that keeps them
    // near hook so they don't pile onto short catches.
    const _isDeepCatch = catchDepth >= 15;
    const out = {};
    const isBlitz = coverage === "C0_BLITZ";
    const isMan   = coverage === "C0_BLITZ" || coverage === "C1_MAN";
    const isTampa = coverage === "TAMPA_2";
    // LB drops — vary by coverage. For BLITZ they charge the QB.
    const lbZoneDrops = {
      lb1: { dxYd: 5, dyYd: -7 },     // hook left
      lb2: { dxYd: 5, dyYd:  0 },     // hook middle
      lb3: { dxYd: 5, dyYd:  7 },     // hook right
    };
    const lbBlitzPaths = {
      lb1: { dxYd: -3, dyYd: -2 },    // blitz from left A-gap
      lb2: { dxYd: -3, dyYd:  0 },    // blitz up the middle
      lb3: { dxYd: -3, dyYd:  2 },    // blitz from right A-gap
    };
    const lbManCovers = {
      lb1: { dxYd: 8,  dyYd: -5 },    // cover RB out left
      lb2: { dxYd: 10, dyYd:  3 },    // cover TE
      lb3: { dxYd: 8,  dyYd:  5 },    // cover RB out right
    };
    for (const lbN of ["lb1", "lb2", "lb3"]) {
      if (tacklerSlot === lbN) continue;
      const target = isBlitz ? lbBlitzPaths[lbN]
                   : isMan   ? lbManCovers[lbN]
                   :           lbZoneDrops[lbN];
      // Tampa-2: MLB (lb2) drops to deep middle instead of underneath
      if (isTampa && lbN === "lb2") {
        out.lb2 = {
          role: "LB",
          waypoints: [
            { t: 0.00, dxYd: 5.5, dyYd: 0 },   // matches formation
            { t: 0.25, dxYd: 9,   dyYd: 0 },
            { t: throwT, dxYd: 14, dyYd: 0 },
            { t: 0.78, dxYd: 14, dyYd: 0 },
            { t: 1.00, dxYd: 14, dyYd: 0 },
          ],
        };
        continue;
      }
      // Per-LB shuffle: staggered TIMING and direction so all 3 LBs don't
      // shuffle in unison at the same moment. Amplitude kept tiny (0.6 yd)
      // so the motion reads as reading-the-QB, not a sprint. Direction
      // for outside LBs biases toward midfield first (where the QB
      // usually targets); MLB drifts forward and back instead of lateral.
      const _lbIdx = lbN === "lb1" ? 0 : lbN === "lb2" ? 1 : 2;
      const _shufStartFrac = [0.18, 0.42, 0.28][_lbIdx];   // first shuffle ratio within hook→throw window
      const _shufMidFrac   = [0.62, 0.85, 0.55][_lbIdx];   // second shuffle ratio
      const _shuf1T = 0.20 + (throwT - 0.20) * _shufStartFrac;
      const _shuf2T = 0.20 + (throwT - 0.20) * _shufMidFrac;
      const _shufLat = 0.6;   // 0.6 yd lateral drift (was 1.6 — superhuman)
      // First drift biased toward midfield. lb1 hooks left (dyYd < 0)
      // so midfield = +dyYd; lb3 hooks right so midfield = -dyYd; lb2
      // shuffles slightly forward/back instead of lateral.
      const _shufLatSign = lbN === "lb2" ? 0 : (target.dyYd > 0 ? -1 : 1);
      const _shufFwdSign = lbN === "lb2" ? 1 : 0;
      out[lbN] = {
        role: "LB",
        waypoints: [
          { t: 0.00, dxYd: 5.5, dyYd: target.dyYd * 0.4 },              // formation (matches lbDepth)
          { t: 0.20, dxYd: target.dxYd, dyYd: target.dyYd },            // backpedal into hook
          { t: _shuf1T, dxYd: target.dxYd + _shufFwdSign * 0.3, dyYd: target.dyYd + _shufLatSign * _shufLat },
          { t: _shuf2T, dxYd: target.dxYd - _shufFwdSign * 0.2, dyYd: target.dyYd - _shufLatSign * _shufLat * 0.4 },
          { t: throwT, dxYd: target.dxYd, dyYd: target.dyYd },          // re-set at the throw moment
          // Smaller break-on-ball drift — these are NON-tackler LBs in
          // zone. Short / medium catches: small drift (don't pile on).
          // Deep catches: turn and run upfield — LB won't catch up to a
          // deep ball but the visual reaction reads as defenders
          // engaging the play, not jogging in place.
          ...(_isDeepCatch ? [
            { t: 0.78, dxYd: target.dxYd + 5, dyYd: target.dyYd * 0.45 },
            { t: 1.00, dxYd: target.dxYd + 10, dyYd: target.dyYd * 0.25 },
          ] : [
            { t: 0.78, dxYd: target.dxYd + 1, dyYd: target.dyYd * 0.88 },
            { t: 1.00, dxYd: target.dxYd + 2, dyYd: target.dyYd * 0.75 },
          ]),
        ],
      };
    }
    // FS / SS — vary depth by coverage.
    //   C0_BLITZ: SS walks up (5-6yd box). FS shallow centerfielder.
    //   C1_MAN:   FS deep solo (16yd). SS in box (6yd).
    //   C2_ZONE:  Both deep half (12yd, ±10yd lateral).
    //   C3_ZONE:  FS deep middle (14). SS deep third (12, +8yd).
    //   C4_QUARTERS: Both deep, wider (12, ±12yd).
    //   TAMPA_2:  Both deep half (12, ±10yd) + MLB deep middle.
    if (tacklerSlot !== "fs") {
      const fsTgt =
            coverage === "C0_BLITZ" ? { dxYd: 8,  dyYd: -3 }
          : coverage === "C1_MAN"   ? { dxYd: 16, dyYd:  0 }
          : coverage === "C2_ZONE"  ? { dxYd: 12, dyYd: -10 }
          : coverage === "TAMPA_2"  ? { dxYd: 12, dyYd: -10 }
          : coverage === "C3_ZONE"  ? { dxYd: 14, dyYd:  0 }
          : coverage === "C4_QUARTERS" ? { dxYd: 12, dyYd: -12 }
          :                              { dxYd: 14, dyYd:  0 };
      out.fs = {
        role: "FS",
        waypoints: [
          { t: 0.00, dxYd: 12,        dyYd: 0 },
          { t: 0.20, dxYd: fsTgt.dxYd, dyYd: fsTgt.dyYd * 0.6 },
          { t: throwT, dxYd: fsTgt.dxYd, dyYd: fsTgt.dyYd },
          { t: 0.78, dxYd: fsTgt.dxYd, dyYd: fsTgt.dyYd },
          { t: 1.00, dxYd: fsTgt.dxYd, dyYd: fsTgt.dyYd },
        ],
      };
    }
    if (tacklerSlot !== "ss") {
      const ssTgt =
            coverage === "C0_BLITZ" ? { dxYd: -2, dyYd: 4 }    // SS blitz
          : coverage === "C1_MAN"   ? { dxYd: 6,  dyYd: 4 }    // box
          : coverage === "C2_ZONE"  ? { dxYd: 12, dyYd: 10 }   // deep half right
          : coverage === "TAMPA_2"  ? { dxYd: 12, dyYd: 10 }
          : coverage === "C3_ZONE"  ? { dxYd: 12, dyYd: 8 }    // deep third
          : coverage === "C4_QUARTERS" ? { dxYd: 12, dyYd: 12 }
          :                              { dxYd: 10, dyYd: 3 };
      out.ss = {
        role: "SS",
        waypoints: [
          { t: 0.00, dxYd: 8,         dyYd: 5 },
          { t: 0.20, dxYd: ssTgt.dxYd, dyYd: ssTgt.dyYd * 0.7 },
          { t: throwT, dxYd: ssTgt.dxYd, dyYd: ssTgt.dyYd },
          { t: 0.78, dxYd: ssTgt.dxYd, dyYd: ssTgt.dyYd },
          { t: 1.00, dxYd: ssTgt.dxYd, dyYd: ssTgt.dyYd },
        ],
      };
    }
    return out;
  }
  // Build OL / DL blocker waypoint tracks for a run play. Engine-
  // driven so animation doesn't reinvent the run-type-aware blocking
  // patterns. dyYd is yards FROM cy (absolute). OL slot Y offsets:
  // slot s ∈ {0..4}, dyYd = (s - 2) * 2.13 (matches makeFormation
  // olGap of 32px = 2.13 yd).
  _buildRunBlockerTracks(opts) {
    const { runType, yards, gapYd = 0, fbInLeadBlock = false } = opts;
    const out = {};
    const OL_GAP_YD = 2.13;
    // Side biases for run-type variations
    const counterSide = Math.sign(gapYd) || 1;     // pull side
    const stretchSide = Math.sign(gapYd) || 1;
    const pitchSide   = Math.sign(gapYd) || 1;
    // DL lateral positions in YARDS — MUST match the RENDERED formation
    // (cy + {-1.5,-0.5,0.5,1.5} * 34px at 15 px/yd = ±3.4 / ±1.13 yd). The
    // old ±8 / ±2.5 flung the DL ~2.4x too wide at the snap, so the OL fired
    // toward empty grass and the lines never met ("not engaging on runs").
    const dlYs = [-3.4, -1.13, 1.13, 3.4];
    const nearestDlY = (y) => dlYs.reduce((a, b) => Math.abs(b - y) < Math.abs(a - y) ? b : a, dlYs[0]);
    for (let s = 0; s < 5; s++) {
      const slotY = (s - 2) * OL_GAP_YD;
      // Base block: fire forward to the DL contact line (DL sit at 2.5 yd, so
      // ~1.7 yd of drive puts the OL a body-width in front of them) AND slide
      // laterally onto the nearest DL so the block lands on a defender, not a
      // gap. Was 0.4 yd forward with no lateral pairing — far short of the DL.
      let driveX = 1.7;
      let driveY = (nearestDlY(slotY) - slotY) * 0.6;
      if (runType === "counter") {
        // Guard opposite the play side pulls — slot -1 if right play,
        // slot +1 if left play.
        const pullSlot = -counterSide;
        if (Math.round(slotY / OL_GAP_YD) === pullSlot) {
          driveX = 0.1;
          driveY = counterSide * 1.2;
        }
      } else if (runType === "stretch") {
        // Whole line flows toward the play side, but still drives up to
        // engage the DL (not just a shallow lateral slide).
        driveX = 1.2;
        driveY = stretchSide * 0.5 + (nearestDlY(slotY) - slotY) * 0.4;
      } else if (runType === "pitch") {
        const isPlaySideOuter = Math.sign(slotY) === Math.sign(pitchSide) && Math.abs(slotY) >= 3;
        if (isPlaySideOuter) {
          driveX = 0.1;
          driveY = pitchSide * 0.8;
        }
      }
      // OL fires from formation (-0.13 yd, slotY) → drive (driveX, slotY+driveY)
      out[`ol${s}`] = {
        role: "OL",
        waypoints: [
          { t: 0.00, dxYd: -0.13,           dyYd: slotY },                 // formation
          { t: 0.10, dxYd: -0.13 + 0.15,    dyYd: slotY + driveY * 0.3 },  // step off LOS
          { t: 0.30, dxYd: -0.13 + driveX,  dyYd: slotY + driveY },        // engaged
          { t: 0.78, dxYd: -0.13 + driveX,  dyYd: slotY + driveY },        // sustain
          { t: 1.00, dxYd: -0.13 + driveX,  dyYd: slotY + driveY },        // settled
        ],
      };
    }
    // DL — held at the LOS, pushed back slightly (interior more on power
    // runs). Slots: 0=DE-left, 1=DT-left, 2=DT-right, 3=DE-right. Y-offsets
    // match the formation (dlYs above) so the DL don't teleport on the snap.
    const dlOffsets = [
      { y: dlYs[0] },   // de1
      { y: dlYs[1] },   // dt1
      { y: dlYs[2] },   // dt2
      { y: dlYs[3] },   // de2
    ];
    for (let s = 0; s < 4; s++) {
      const offY = dlOffsets[s].y;
      // Push-back: DL gets backed up 0.3 yds, interior more on power runs
      const isInterior = s === 1 || s === 2;
      const pushBack = (runType === "counter" || runType === "stretch") ? 0.2
                     : isInterior && yards >= 4 ? 0.4
                     : 0.15;
      out[`dl${s}`] = {
        role: "DL",
        waypoints: [
          { t: 0.00, dxYd: 2.5,                 dyYd: offY },           // LOS engagement (matches DL_DEPTH_YD)
          { t: 0.20, dxYd: 2.5 - pushBack * 0.5, dyYd: offY },          // taking the punch
          { t: 0.45, dxYd: 2.5 - pushBack,       dyYd: offY },          // driven back
          { t: 0.78, dxYd: 2.5 - pushBack,       dyYd: offY },
          { t: 1.00, dxYd: 2.5 - pushBack,       dyYd: offY },
        ],
      };
    }
    // FB lead-block to the 2nd level (LB) when in I-form / pro-set
    if (fbInLeadBlock) {
      out.fb = {
        role: "FB",
        waypoints: [
          { t: 0.00, dxYd: -5,              dyYd: 0.27 },          // I-form depth
          { t: 0.15, dxYd: -1,              dyYd: gapYd * 0.5 },   // through the gap
          { t: 0.40, dxYd:  5.5,            dyYd: gapYd },          // engage LB at new depth
          { t: 0.78, dxYd:  5.5,            dyYd: gapYd },          // sustain
          { t: 1.00, dxYd:  5.5,            dyYd: gapYd },
        ],
      };
    }
    return out;
  }
  // Resolve a player name to a defensive formation slot key
  // (cb1/cb2/fs/ss/lb1/lb2/lb3/nb), or null if not a starter.
  _resolveDefSlot(name) {
    if (!name || !this.defR || !this.defR.starters) return null;
    const ds = this.defR.starters;
    return name === ds.cb1 ? "cb1"
         : name === ds.cb2 ? "cb2"
         : name === ds.fs  ? "fs"
         : name === ds.ss  ? "ss"
         : name === ds.lb1 ? "lb1"
         : name === ds.lb2 ? "lb2"
         : name === ds.lb3 ? "lb3"
         : name === ds.nb  ? "nb"
         : null;
  }
  // ({ LB, S, CB, DL }) — recognized by the presence of those keys.
  _creditTackle(contextOrWeights) {
    let weights, assistRate;
    let sideHint = null;
    if (contextOrWeights && (contextOrWeights.LB != null || contextOrWeights.S != null
        || contextOrWeights.CB != null || contextOrWeights.DL != null)) {
      weights = contextOrWeights;
      assistRate = 0.30;
    } else {
      const t = this._tackleWeightsForContext(contextOrWeights);
      weights = t.weights;
      assistRate = t.assistRate;
      sideHint = contextOrWeights && contextOrWeights.sideHint || null;
    }
    const primary = this._creditDefStat("tkl", weights, null, sideHint);
    if (primary && Math.random() < assistRate) {
      // Assist roll: credit a different defender at the same weights.
      // Skip the primary so we don't double-bump the same player.
      this._creditDefStat("tkl", weights, primary, sideHint);
    }
    return primary;
  }
  _creditDefStat(field, weights, excludeName, sideHint) {
    const def = this.defStats;
    if (!def) return;
    const defStarters = this.defR.starters;
    // sideHint ("left" | "right" | "middle" | null): biases CB / S / LB
    // picks toward the slot whose alignment matches where the play
    // resolved, so a catch on the right sideline doesn't credit the
    // left-side CB. Convention: cb1 = left, cb2 = right; lb1 = WLB
    // (left), lb2 = MLB (middle), lb3 = SLB (right); ss = strong-side
    // (typically right), fs = deep middle (no side preference).
    const sideBoost = (slot) => {
      if (!sideHint) return 1.0;
      const isLeft  = sideHint === "left";
      const isRight = sideHint === "right";
      const isMid   = sideHint === "middle";
      if (slot === "cb1") return isLeft  ? 2.4 : isRight ? 0.35 : 1.0;
      if (slot === "cb2") return isRight ? 2.4 : isLeft  ? 0.35 : 1.0;
      if (slot === "ss")  return isRight ? 1.6 : isMid   ? 1.1  : 0.85;
      if (slot === "fs")  return isMid   ? 1.4 : 1.0;
      if (slot === "lb1") return isLeft  ? 1.4 : isRight ? 0.7  : 1.0;
      if (slot === "lb3") return isRight ? 1.4 : isLeft  ? 0.7  : 1.0;
      return 1.0;
    };
    const pool = [];
    const addCandidate = (name, w, slot) => {
      if (!name) return;
      if (excludeName && name === excludeName) return;
      // Skip ejected players — they're out of the game
      const ply = this._playerByName?.get?.(name);
      if (ply && ply._ejectedThisGame) return;
      pool.push({ name, w: w * sideBoost(slot) });
    };
    if (weights.LB) {
      // NFL LB tackle distribution skews MLB-heavy. Bobby Wagner / Roquan
      // Smith / Fred Warner types average ~150-180 tackles; WLB/SLB get
      // 100-130 and 75-95. Bias lb2 (MLB slot) higher; lb3 (SLB) lower.
      // 1.15x (was 1.25x) after play-context weighting introduced
      // high-LB-share contexts (short-middle pass 50%, inside run 45%)
      // — too much bias drove top tackler past NFL elite ceiling.
      addCandidate(defStarters.lb1, weights.LB * 0.95, "lb1");   // WLB
      addCandidate(defStarters.lb2, weights.LB * 1.15, "lb2");   // MLB — alpha
      addCandidate(defStarters.lb3, weights.LB * 0.85, "lb3");   // SLB
    }
    if (weights.S) {
      addCandidate(defStarters.fs, weights.S, "fs");
      addCandidate(defStarters.ss, weights.S, "ss");
    }
    if (weights.DL) {
      addCandidate(defStarters.de1, weights.DL, "de1");
      addCandidate(defStarters.de2, weights.DL, "de2");
      addCandidate(defStarters.dt1, weights.DL, "dt1");
      addCandidate(defStarters.dt2, weights.DL, "dt2");
    }
    if (weights.CB) {
      addCandidate(defStarters.cb1, weights.CB, "cb1");
      addCandidate(defStarters.cb2, weights.CB, "cb2");
    }
    if (!pool.length) return null;
    const total = pool.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    let chosen = pool[pool.length - 1];
    for (const c of pool) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    const p = def.players[chosen.name];
    if (p) p[field] = (p[field] || 0) + 1;
    return chosen.name;
  }
  // Like _creditDefStat but weights CB / S share by archetype. BALL_HAWK gets
  // more opportunities; SHUTDOWN / PHYSICAL get fewer (QBs threw away from
  // them). Use for coverage stats like INTs / PDs.
  _creditDBStat(field, baseWeights) {
    const def = this.defStats;
    if (!def) return null;
    const cbArchW = a => a === "BALL_HAWK" ? 2.0
                       : a === "ZONE"      ? 1.2
                       : a === "PHYSICAL"  ? 0.78
                       : a === "SHUTDOWN"  ? 0.45
                       : a === "SLOT_CB"   ? 0.85
                       : 1.0;
    const sArchW  = a => a === "BALL_HAWK"    ? 1.8
                       : a === "CENTER_FIELD" ? 1.2
                       : a === "BOX"          ? 0.5
                       : a === "HYBRID"       ? 1.1   // balanced ball production
                       : 1.0;
    const candidates = [];
    if (baseWeights.CB) for (const c of (this.defArch.CB || []))
      if (c?.name) candidates.push({ name: c.name, w: baseWeights.CB * cbArchW(c.archetype) });
    if (baseWeights.S)  for (const s of (this.defArch.S  || []))
      if (s?.name) candidates.push({ name: s.name, w: baseWeights.S  * sArchW(s.archetype) });
    if (baseWeights.LB) for (const l of (this.defArch.LB || []))
      if (l?.name) candidates.push({ name: l.name, w: baseWeights.LB });
    if (baseWeights.DL) for (const d of (this.defArch.DL || []))
      if (d?.name) candidates.push({ name: d.name, w: baseWeights.DL });
    if (!candidates.length) return null;
    const total = candidates.reduce((s, c) => s + c.w, 0);
    let r = Math.random() * total;
    let chosen = candidates[candidates.length - 1];
    for (const c of candidates) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    const p = def.players[chosen.name];
    if (p) p[field] = (p[field] || 0) + 1;
    return chosen.name;
  }
  // Yards after contact — heavy + strong carriers lean into the wrap and
  // drag defenders forward an extra fraction of a yard. Distinct from the
  // outright break-tackle event: this fires on EVERY positive carry whether
  // or not a tackle is broken. NFL yards-after-contact gap between Henry
  // (~3.5 YAC/carry) and an avg scat back (~1.8) sits at ~1.5 yds; this
  // formula returns ~0.0–1.2 for the heaviest power backs.
  // Thresholds: cWeight > 220 AND cstr > 70 to activate. ELUSIVE archetypes
  // get reduced bonus (they avoid contact, not lean into it).
  _leanForwardYds(carrierName, breakStyle) {
    const cp = this._playerByName.get(carrierName);
    if (!cp) return 0;
    const cstr = cp.stats?.[1] ?? 70;
    let cWeight = POSITION_WEIGHT_FALLBACK[cp.position] || 215;
    try {
      const cmb = combineMeasurables(cp);
      cWeight = cmb.weightLbs || cWeight;
    } catch (_e) {}
    if (cWeight <= 220 || cstr <= 70) return 0;
    const massFactor = Math.min(1, (cWeight - 220) / 30);   // 0 at 220, 1 at 250+
    const strFactor  = Math.min(1, (cstr - 70) / 25);        // 0 at 70, 1 at 95+
    const archMul = breakStyle === "POWER"   ? 1.2
                 : breakStyle === "ELUSIVE" ? 0.4
                 : breakStyle === "SPEED"   ? 0.7
                 : 1.0;
    return Math.min(1.8, massFactor * strFactor * archMul * 1.5);
  }
  // Resolve a break-tackle attempt for any open-field carry: RB rush, YAC,
  // QB scramble, KR/PR. Samples 1-3 converging tacklers from a yardage-zone-
  // weighted pool, applies freight-train (mass+momentum) and juke-out (AGI
  // vs mass-penalized defender AGI) bonuses, rolls the break, and credits
  // missed_tkl to every defender beaten. Returns { brokenTackles, bonusYards,
  // tackler }. The caller applies bonusYards (with field cap) and credits
  // broken_tackles to the carrier.
  _resolveBreakTackle({
    carrierName, yards, breakStyle,
    tacklerArchByPos, tacklerStatsPlayers,
    tacklerZones, gangDist,
  }) {
    if (yards <= 0 || !carrierName) return { brokenTackles: 0, bonusYards: 0, tackler: null };
    const cp = this._playerByName.get(carrierName);
    if (!cp) return { brokenTackles: 0, bonusYards: 0, tackler: null };

    const cstr = cp.stats?.[1] ?? 70;
    const cagi = cp.stats?.[2] ?? 70;
    const cspd = effectiveSpeed(cp, 10);
    let densityBonus = 0;
    let cWeight = POSITION_WEIGHT_FALLBACK[cp.position] || 215;
    try {
      const cmb = combineMeasurables(cp);
      cWeight = cmb.weightLbs || cWeight;
      const density = cWeight / (cmb.heightIn || 71);
      densityBonus = (density - 2.75) * 8;
    } catch (_e) {}

    let breakStat;
    if (breakStyle === "POWER")        breakStat = cstr + densityBonus * 1.5;
    else if (breakStyle === "ELUSIVE") breakStat = (cagi * 0.7 + cstr * 0.3) + densityBonus * 0.3;
    else if (breakStyle === "SPEED")   breakStat = (cspd * 0.7 + cstr * 0.3) + densityBonus * 0.4;
    else                                breakStat = (cstr + cagi) / 2 + densityBonus;

    const zones = tacklerZones || _RUN_TACKLER_ZONES;
    const gang  = gangDist     || _RUN_GANG_DIST;
    const zoneKey = yards <= 2 ? "short" : yards <= 7 ? "mid" : "long";
    const zone = zones[zoneKey];
    const gangProbs = gang[zoneKey];

    let nTacklers;
    {
      const r = Math.random();
      if (gangProbs.length === 3) nTacklers = r < gangProbs[0] ? 1 : r < gangProbs[0] + gangProbs[1] ? 2 : 3;
      else                         nTacklers = r < gangProbs[0] ? 1 : 2;
    }

    const positions = Object.keys(zone);
    const totalW = positions.reduce((s, p) => s + zone[p], 0);
    const sampleTackler = (excludeName) => {
      let r = Math.random() * totalW;
      let pos = positions[positions.length - 1];
      for (const p of positions) { r -= zone[p]; if (r <= 0) { pos = p; break; } }
      const pool = (tacklerArchByPos?.[pos] || [])
        .map(d => this._playerByName.get(d?.name))
        .filter(p => p && p.name !== excludeName);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    };

    let tackler = sampleTackler(null);
    if (!tackler) {
      const lbPool = (tacklerArchByPos?.LB || [])
        .map(l => this._playerByName.get(l?.name)).filter(Boolean);
      tackler = lbPool[0] || null;
    }
    const tckRating = tackler ? (tackler.stats[9] || 60) : 70;
    const effectiveTck = tckRating + (nTacklers - 1) * 8;
    const supportSplit = 1 / nTacklers;

    let runOverBonus = 0;
    let tWeight = 215, tAgi = 60;
    if (tackler) {
      try {
        const tcmb = combineMeasurables(tackler);
        tWeight = tcmb.weightLbs || tWeight;
        tAgi = tackler.stats[2] || tAgi;
        if (cspd > 65) {
          const massDelta = cWeight - tWeight;
          if (massDelta > 30) {
            const momentumMul = Math.min(1, (cspd - 65) / 25);
            runOverBonus = (massDelta - 30) * 0.012 * momentumMul * supportSplit;
          }
        }
      } catch (_e) {}
    }

    let jukeOutBonus = 0;
    if (tackler && runOverBonus === 0 && cagi >= 75) {
      const tEffAgi = tAgi - Math.max(0, (tWeight - 200) / 8);
      const jukeDelta = cagi - tEffAgi;
      if (jukeDelta > 10) {
        const archMul = breakStyle === "ELUSIVE" ? 1.0
                     : breakStyle === "POWER"   ? 0.2
                     : 0.5;
        const stillnessMul = cspd < 80 ? 1.0 : 0.6;
        jukeOutBonus = (jukeDelta - 10) * 0.012 * archMul * stillnessMul * supportSplit;
      }
    }

    const baseBreak = breakStyle === "POWER" ? 0.04 : 0.02;
    const breakChance = clamp((breakStat - effectiveTck) / 280 + baseBreak + runOverBonus + jukeOutBonus, 0.005, 0.45);
    if (Math.random() >= breakChance) {
      return { brokenTackles: 0, bonusYards: 0, tackler: tackler?.name || null };
    }

    const brokenTackles = nTacklers;
    const explosive = nTacklers === 1 && (runOverBonus > 0.12 || jukeOutBonus > 0.12);
    const bonusYards = explosive ? rand(6, 14) : rand(3, 8);

    if (tacklerStatsPlayers && tackler?.name && tacklerStatsPlayers[tackler.name]) {
      tacklerStatsPlayers[tackler.name].missed_tkl = (tacklerStatsPlayers[tackler.name].missed_tkl || 0) + 1;
    }
    for (let i = 1; i < brokenTackles; i++) {
      const supporter = sampleTackler(tackler?.name);
      if (supporter?.name && tacklerStatsPlayers && tacklerStatsPlayers[supporter.name]) {
        tacklerStatsPlayers[supporter.name].missed_tkl = (tacklerStatsPlayers[supporter.name].missed_tkl || 0) + 1;
      }
    }
    return { brokenTackles, bonusYards, tackler: tackler?.name || null };
  }
  get offR()       { return this.poss === "home" ? this.homeR : this.awayR; }
  get defR()       { return this.poss === "home" ? this.awayR : this.homeR; }
  get offPlaybook(){ return this.poss === "home" ? this.homePlaybook : this.awayPlaybook; }
  get defPlaybook(){ return this.poss === "home" ? this.awayDefPlaybook : this.homeDefPlaybook; }
  // Situational override: PREVENT defense when leading by 2+ scores late.
  // Falls back to the team's base scheme otherwise.
  get currentDefPlaybook() {
    const baseDef = this.defPlaybook;
    const offKey = this.poss, defKey = offKey === "home" ? "away" : "home";
    const defLead = this.score[defKey] - this.score[offKey];
    const lateGame = (this.quarter === 4 && this.time < 240) || this.quarter >= 5;
    if (lateGame && defLead >= 9) return DEF_PLAYBOOKS.PREVENT;
    // MLB AGGRESSION TILT — the MLB is the defense's playcaller. An aggressive
    // MLB (BLITZER, high PRS+TCK) overrides the team's base scheme on key downs:
    //   ≥80 → BLITZ_46 on 3rd-and-medium / 3rd-and-long
    //   ≤30 → DIME on obvious passing downs
    // Otherwise keep the team base.
    const agg = this._mlbAggression();
    const isPassingDown = (this.down === 3 && this.ytg >= 5) || (this.down === 4 && this.ytg >= 4);
    if (isPassingDown && agg >= 80) return DEF_PLAYBOOKS.BLITZ_46;
    if (isPassingDown && agg <= 30) return DEF_PLAYBOOKS.DIME;
    return baseDef;
  }
  get offOL()      { return this.poss === "home" ? this.homeOL : this.awayOL; }
  get defDL()      { return this.poss === "home" ? this.awayDL : this.homeDL; }
  get offArch()    { return this.poss === "home" ? this.homeArch : this.awayArch; }
  get defArch()    { return this.poss === "home" ? this.awayArch : this.homeArch; }
  // LEVEL-4 — pick an offensive concept + defensive coverage for this snap.
  // Tilts base frequencies by down/distance + playbook tendencies.
  _pickPassConcept(pb) {
    const f = { ...PASS_CONCEPT_FREQ };
    const dn = this.down, yg = this.ytg;
    // 3rd-and-long → push toward INTERMEDIATE / VERTICAL to target sticks
    if (dn >= 3 && yg >= 8) {
      f.QUICK_GAME *= 0.35; f.SCREEN *= 0.50; f.DRAG_MESH *= 0.65;
      f.INTERMEDIATE *= 1.9; f.VERTICAL *= 1.7; f.PA_SHOT *= 0.7;
    }
    // 3rd-and-short → push toward QUICK_GAME / DRAG_MESH (move chains)
    if (dn >= 3 && yg <= 3) {
      f.QUICK_GAME *= 1.7; f.DRAG_MESH *= 1.4; f.SCREEN *= 1.2;
      f.INTERMEDIATE *= 0.55; f.VERTICAL *= 0.25; f.PA_SHOT *= 0.4;
    }
    // Goal line → quick game heavy
    if (this.yardLine >= 95) {
      f.VERTICAL *= 0.2; f.PA_SHOT *= 0.6;
      f.QUICK_GAME *= 1.4; f.DRAG_MESH *= 1.2;
    }
    // Playbook tilts
    const pid = pb?.id;
    if (pid === "AIR_RAID") {
      f.INTERMEDIATE *= 1.3; f.VERTICAL *= 1.5; f.QUICK_GAME *= 0.9;
      f.PA_SHOT *= 0.5; f.SCREEN *= 0.8;
    } else if (pid === "WEST_COAST") {
      f.QUICK_GAME *= 1.3; f.DRAG_MESH *= 1.4; f.SCREEN *= 1.2;
      f.VERTICAL *= 0.6; f.PA_SHOT *= 0.7;
    } else if (pid === "GROUND_AND_POUND") {
      f.PA_SHOT *= 1.9; f.SCREEN *= 1.3;
      f.VERTICAL *= 0.6; f.INTERMEDIATE *= 0.85;
    } else if (pid === "OPTION") {
      f.QUICK_GAME *= 1.2; f.PA_SHOT *= 1.4;
      f.INTERMEDIATE *= 0.7;
    }
    // Aggressive QBs tilt deep
    const agg = this._qbAggression?.() ?? 50;
    if (agg > 70)       { f.VERTICAL *= 1.3; f.PA_SHOT *= 1.2; f.QUICK_GAME *= 0.85; }
    else if (agg < 35)  { f.QUICK_GAME *= 1.25; f.SCREEN *= 1.15; f.VERTICAL *= 0.7; }
    // Weighted roll
    let total = 0; for (const v of Object.values(f)) total += v;
    let r = Math.random() * total;
    for (const [name, p] of Object.entries(f)) { r -= p; if (r <= 0) return name; }
    return "QUICK_GAME";
  }
  _pickPassCoverage(defPb) {
    const f = { ...PASS_COVERAGE_FREQ };
    const dn = this.down, yg = this.ytg;
    // 3rd-and-long → push toward deep zones / 2-high / TAMPA
    if (dn >= 3 && yg >= 8) {
      f.C0_BLITZ *= 0.40; f.C1_MAN *= 0.70;
      f.C2_ZONE *= 1.30; f.C3_ZONE *= 1.15; f.C4_QUARTERS *= 1.55; f.TAMPA_2 *= 1.55;
    }
    // 3rd-and-short → blitz / man (jam routes, force quick)
    if (dn >= 3 && yg <= 3) {
      f.C0_BLITZ *= 1.9; f.C1_MAN *= 1.5;
      f.C2_ZONE *= 0.55; f.C3_ZONE *= 0.60; f.C4_QUARTERS *= 0.45; f.TAMPA_2 *= 0.55;
    }
    // Goal line → man-heavy (no room for zone holes)
    if (this.yardLine >= 95) {
      f.C0_BLITZ *= 1.5; f.C1_MAN *= 1.7;
      f.C2_ZONE *= 0.40; f.C3_ZONE *= 0.40; f.C4_QUARTERS *= 0.30;
    }
    // Defensive playbook tilt (using the existing schemes)
    const did = defPb?.id;
    if (did === "BLITZ_46" || did === "PRESS_MAN") {
      f.C0_BLITZ *= 1.6; f.C1_MAN *= 1.4;
      f.C2_ZONE *= 0.7; f.C4_QUARTERS *= 0.7;
    } else if (did === "COVER_2_SHELL" || did === "TAMPA_2") {
      f.C2_ZONE *= 1.7; f.TAMPA_2 *= 1.8;
      f.C0_BLITZ *= 0.5; f.C1_MAN *= 0.6;
    } else if (did === "PREVENT" || did === "QUARTERS") {
      f.C4_QUARTERS *= 1.8; f.TAMPA_2 *= 1.3;
      f.C0_BLITZ *= 0.3; f.C1_MAN *= 0.5;
    }
    let total = 0; for (const v of Object.values(f)) total += v;
    let r = Math.random() * total;
    for (const [name, p] of Object.entries(f)) { r -= p; if (r <= 0) return name; }
    return "C3_ZONE";
  }
  // Pick a DL rep + OL rep for this play, weighted toward higher-rated guys
  _pickTrenchRep() {
    const dlList = this.defDL || [];
    const olList = this.offOL || [];
    const pickWeighted = (list) => {
      if (!list.length) return null;
      // Weights tilt toward higher overall; ^2.0 sharpens the bias so
      // elite pass-rushers actually win their share of reps (audit
      // showed top sacker at 11.6 vs NFL elite 18-22; ^1.6 was too flat).
      const weights = list.map(p => Math.pow(Math.max(1, p.overall - 40), 2.0));
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum;
      for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
      return list[list.length - 1];
    };
    // ── POSITION-AWARE MATCHUP ──
    // Prefer to use the actual SUB-POSITION assignments (LT/LG/C/RG/RT
    // vs LDE/LDT/RDT/RDE) — DEs face tackles, DTs face guards/center.
    // Falls back to archetype-lane filtering if sub-positions aren't set
    // (legacy roster compatibility).
    const isEdgeSlot = s => s === "LDE" || s === "RDE";
    const dl = pickWeighted(dlList);
    let olCandidates = olList;
    if (dl?.subPos) {
      // Edge DLs face tackles; interior DLs face guards / center.
      const wantSlots = isEdgeSlot(dl.subPos)
        ? new Set(["LT", "RT"])
        : new Set(["LG", "C", "RG"]);
      const matching = olList.filter(p => p.subPos && wantSlots.has(p.subPos));
      if (matching.length) olCandidates = matching;
    } else {
      // Archetype-lane fallback (older sims)
      const dlLane = t => t === "SPEED" ? "EDGE"
                        : (t === "POWER" || t === "PENETRATOR" || t === "PLUG") ? "INTERIOR"
                        : null;
      const olLane = t => t === "ATHLETIC" ? "EDGE"
                        : (t === "MAULER" || t === "ANCHOR" || t === "PLUG") ? "INTERIOR"
                        : null;
      const targetLane = dlLane(dl?.archetype);
      if (targetLane) {
        const matching = olList.filter(p => olLane(p.archetype) === targetLane);
        if (matching.length) olCandidates = matching;
      }
    }
    const ol = pickWeighted(olCandidates);
    return {
      dl, ol,
      dlType: dl?.archetype || "POWER",
      olType: ol?.archetype || "ANCHOR",
    };
  }
  get possTeam() { return this.poss === "home" ? this.home : this.away; }
  get offStats() { return this.stats[this.poss]; }
  get defStats() { return this.stats[this.poss === "home" ? "away" : "home"]; }
  // Pick the specific player who committed a penalty, based on a per-penalty
  // position-weight map (NFL research May 2026). Within the chosen position,
  // bias toward LOW AWR — undisciplined players draw more flags. Returns a
  // player NAME or null if no candidates exist.
  // Snapshot enough engine state to fully undo a play if a live-ball
  // penalty is accepted after the play resolves. We deep-clone stats
  // since the play body mutates them in place; everything else is
  // primitive or shallow-cloneable.
  _snapshotForPenalty() {
    return {
      yardLine: this.yardLine, down: this.down, ytg: this.ytg,
      time: this.time, quarter: this.quarter, poss: this.poss,
      score: { ...this.score },
      stats: JSON.parse(JSON.stringify(this.stats)),
      playsLen: this.plays.length,
      lastClockStopped: this._lastClockStopped,
      lastBallType: this._lastBallType,
      lastRzDrive: this._lastRzDrive,
      timeouts: { home: this.timeouts.home, away: this.timeouts.away },
    };
  }
  _restoreFromPenaltySnapshot(s) {
    this.yardLine = s.yardLine; this.down = s.down; this.ytg = s.ytg;
    this.time = s.time; this.quarter = s.quarter; this.poss = s.poss;
    this.score = { ...s.score };
    this.stats = s.stats;
    this.plays.length = s.playsLen;
    this._lastClockStopped = s.lastClockStopped;
    this._lastBallType = s.lastBallType;
    this._lastRzDrive = s.lastRzDrive;
    this.timeouts.home = s.timeouts.home;
    this.timeouts.away = s.timeouts.away;
  }
  // Decide whether to accept the pending live-ball penalty given the
  // actual play result. Non-offending team chooses. Compares the
  // PRE-play snapshot (this._penSnapshot) against current state to
  // detect score changes — never wipe a TD/FG with a 5-15 yd flag.
  //   pen.on === "def": offense decides
  //   pen.on === "off": defense decides
  _shouldAcceptLivePenalty(pen, playResult, snap) {
    snap = snap || this._penSnapshot;
    const playYds = playResult?.yards ?? 0;
    const isTO    = !!playResult?.turnover;
    const isInc   = !!playResult?.incomplete;
    // Snapshot-vs-current score deltas. Compute relative to the offense
    // when the play STARTED (snap.poss), not current poss (turnovers flip).
    const offSide = snap?.poss || this.poss;
    const defSide = offSide === "home" ? "away" : "home";
    const offScoreDelta = (this.score[offSide] || 0) - (snap?.score?.[offSide] || 0);
    const defScoreDelta = (this.score[defSide] || 0) - (snap?.score?.[defSide] || 0);
    if (pen.on === "def") {
      // Offense decides — wants the better outcome.
      if (offScoreDelta > 0) return false;          // KEEP the TD/FG/score
      if (defScoreDelta > 0) return true;           // negate any defensive score
      if (isTO) return true;                        // negate the TO
      // Did the play already cross the YTG marker (first down)?
      const playGaveFirst = playYds >= (snap?.ytg ?? 10);
      if (pen.autoFirst) {
        // Auto-first is almost always preferred (fresh chains). One
        // exception: the play already crossed YTG AND gained more
        // yards than the penalty — then offense gets BOTH a 1st down
        // and a bigger gain by declining (e.g., a 28-yd completion on
        // 1st-and-10 stands over a 15-yd DPI auto-first reset).
        if (playGaveFirst && playYds > pen.yds) return false;
        return true;
      }
      if (isInc) return true;                       // incomplete vs 5+ yds + replay
      // No auto-first: take the larger yardage (penalty replay yds vs play yards).
      return pen.yds >= playYds;
    } else {
      // Defense decides — wants the worse-for-offense outcome. Accept
      // pushes offense to -pen.yds and REPLAYS the down. Decline leaves
      // them at +playYds and ADVANCES the down. NFL coaches value the
      // down progression at ~5 yds equivalent (especially on 3rd down,
      // where decline forces a punt). Net comparison:
      //   accept_value (offense yds equivalent)  = -pen.yds  (with replay = no down gained for defense)
      //   decline_value (offense yds equivalent) = playYds - downBonus  (defense gains a down)
      // Defense accepts when accept_value < decline_value.
      if (offScoreDelta > 0) return true;           // WIPE the offense's TD/FG
      if (defScoreDelta > 0) return false;          // KEEP the defensive score
      if (isTO) return false;                       // keep the TO
      if (pen.lossDown) return true;                // loss of down (e.g. IG) is bad for offense
      const downBonus = (snap?.down === 3 || snap?.down === 4) ? 8 : 3;
      return -pen.yds < (playYds - downBonus);
    }
  }
  // Apply a fully-formed penalty (dead-ball immediate, or live-ball
  // accepted-after-play). Mutates stats + yardLine + down/ytg + time +
  // pushes the penalty visual. Expects pen._meta populated with
  // flaggedKey, offender, preDown/preYtg/preYardLine.
  _applyPenaltyEffects(pen, decisionContext) {
    const { flaggedKey, offender, preDown, preYtg, preYardLine } = pen._meta || {};
    const flaggedStats = this.stats[flaggedKey];
    if (flaggedStats?.team) {
      flaggedStats.team.penalties  = (flaggedStats.team.penalties  || 0) + 1;
      flaggedStats.team.penaltyYds = (flaggedStats.team.penaltyYds || 0) + pen.yds;
    }
    if (offender && flaggedStats?.players?.[offender]) {
      const ps = flaggedStats.players[offender];
      ps.penalties   = (ps.penalties   || 0) + 1;
      ps.penalty_yds = (ps.penalty_yds || 0) + pen.yds;
    }
    // Yardage direction relative to OFFENSE.
    const dir = pen.on === "off" ? -1 : +1;
    const newYL = clamp(this.yardLine + dir * pen.yds, 1, 99);
    this.yardLine = newYL;
    if (pen.autoFirst) {
      this.down = 1;
      this.ytg = 10;
    } else if (pen.lossDown) {
      this.down = (this.down || 1) + 1;
      this.ytg = clamp(this.ytg + (pen.on === "off" ? pen.yds : -pen.yds), 1, 99);
    } else {
      this.ytg = clamp(this.ytg + (pen.on === "off" ? pen.yds : -pen.yds), 1, 99);
    }
    // NFL penalty clock burn: flag thrown, refs confer, announce, reset =
    // ~10-12s (more than a play clock-stop because of ref discussion time).
    this.time = Math.max(0, this.time - 10);
    this._pushVisual({
      kind: "penalty",
      desc: `🚩 ${pen.type}${offender ? ` on ${offender}` : ` on ${this[flaggedKey]?.name || flaggedKey}`} — ${pen.yds} yds${pen.autoFirst ? ", automatic first down" : ""}${pen.lossDown ? ", loss of down" : ""}`,
      yds: pen.yds,
      onTeam: flaggedKey,
      penType: pen.type,
      offender,
      // poss + startYard let the animation build the field at the PRE-penalty
      // spot (offense = this.poss; the flag is on `onTeam`, which is the
      // offense iff onTeam === poss). autoFirst/lossDown drive the ref signal.
      poss: this.poss,
      startYard: preYardLine,
      autoFirst: !!pen.autoFirst,
      lossDown: !!pen.lossDown,
      on: pen.on,   // "off" | "def" — walk-off direction
      preDown, preYtg, preYardLine,
      decisionContext,  // null for dead-ball, populated for accepted live-ball
    });
  }
  _pickPenaltyOffender(posWeights, side) {
    if (!posWeights) return null;
    const teamKey = side === "off" ? this.poss : (this.poss === "home" ? "away" : "home");
    const teamR = teamKey === "home" ? this.homeR : this.awayR;
    // Step 1: pick a position group by weight.
    let total = 0;
    for (const w of Object.values(posWeights)) total += w;
    if (total <= 0) return null;
    let r = Math.random() * total;
    let pickedPos = null;
    for (const [pos, w] of Object.entries(posWeights)) {
      r -= w;
      if (r <= 0) { pickedPos = pos; break; }
    }
    if (!pickedPos) pickedPos = Object.keys(posWeights)[0];
    // Step 2: resolve candidate names for that position.
    const s = teamR.starters || {};
    const olList = teamKey === "home" ? this.homeOL : this.awayOL;
    let candidates = [];
    switch (pickedPos) {
      case "QB": if (s.qb) candidates.push(s.qb); break;
      case "RB":
        if (s.rb)  candidates.push(s.rb);
        if (s.rb2) candidates.push(s.rb2);
        break;
      case "WR":
        for (const k of ["wr1", "wr2", "wr3", "wr4"]) if (s[k]) candidates.push(s[k]);
        break;
      case "TE":
        if (s.te)  candidates.push(s.te);
        if (s.te2) candidates.push(s.te2);
        break;
      case "OL":
        candidates = (olList || []).map(p => p?.name).filter(Boolean);
        break;
      case "DL":
        for (const k of ["de1", "de2", "dt1", "dt2"]) if (s[k]) candidates.push(s[k]);
        break;
      case "DT":
        for (const k of ["dt1", "dt2"]) if (s[k]) candidates.push(s[k]);
        break;
      case "DE":
        for (const k of ["de1", "de2"]) if (s[k]) candidates.push(s[k]);
        break;
      case "LB":
        for (const k of ["lb1", "lb2", "lb3"]) if (s[k]) candidates.push(s[k]);
        break;
      case "CB":
        for (const k of ["cb1", "cb2", "cb3", "cb4"]) if (s[k]) candidates.push(s[k]);
        break;
      case "S":
        for (const k of ["fs", "ss"]) if (s[k]) candidates.push(s[k]);
        break;
    }
    if (!candidates.length) return null;
    // Dedupe (cb3/cb4 may fall back to cb2/cb1).
    candidates = Array.from(new Set(candidates));
    // Step 3: bias within position by INVERSE AWR — low AWR = more likely.
    const players = candidates.map(name => this._playerByName.get(name)).filter(Boolean);
    if (!players.length) return candidates[0];
    const weights = players.map(p => {
      const awr = p.stats?.[3] ?? 70;
      return Math.max(0.2, 2 - (awr - 50) / 25);  // AWR 50→2.0, 70→1.2, 90→0.4
    });
    const sumW = weights.reduce((a, b) => a + b, 0);
    let rr = Math.random() * sumW;
    for (let i = 0; i < players.length; i++) {
      rr -= weights[i];
      if (rr <= 0) return players[i].name;
    }
    return players[players.length - 1].name;
  }
  _pushVisual(data) {
    this.plays.push({
      ...data,
      // Personnel + defensive package — selected once per snap in _play.
      // Pre-snap visuals (kickoff/score/punt) inherit the last selection.
      personnel: data.personnel || this._currentPersonnel || "BASE",
      defPackage: data.defPackage || this._currentDefPackage || "BASE_43",
      // OL/DL trench leverage seed for the animation (−1.5..1.9). Only
      // meaningful on dropback pass plays; harmless elsewhere.
      pressure: data.pressure != null ? data.pressure : (this._currentPressure || 0),
      poss: this.poss,
      quarter: this.quarter,
      time: this.time,
      down: this.down,
      ytg: this.ytg,
      yardLine: this.yardLine,
      homeScore: this.score.home,
      awayScore: this.score.away,
      timeouts: { ...this.timeouts },
      statsSnap: this._statsSnapWithFatigue(),
    });
  }
  // Live stats snapshot enriched with per-player FATIGUE (0-100). Fatigue lives
  // in this._fatigue (engine-internal, drives _fatigueMul up to -20% perf) and
  // is otherwise invisible to the broadcast — attach it to each player's snap
  // entry so the live-bio HUD can show a workhorse wearing down.
  _statsSnapWithFatigue() {
    const snap = JSON.parse(JSON.stringify(this.stats));
    for (const side of ["home", "away"]) {
      const players = snap[side] && snap[side].players;
      if (!players) continue;
      for (const name in players) {
        players[name].fatigue = Math.round(this._fatigueLevel(name));
      }
    }
    return snap;
  }
  _score(pts, type) {
    this.score[this.poss] += pts;
    // Momentum swing — TDs swing harder than FGs. Defensive scores
    // (pick-six, fumble-six) are routed through `_defScoreXP` which
    // handles its own swing. Two-point conversions ride along with the TD.
    const swing = pts >= 6 ? 3 : pts >= 3 ? 1.5 : 1;
    this._swingMomentum(this.poss, swing, `${type} (+${pts})`);
    // Capture scorer for box-score display
    const scorer = (pts === 6 || pts === 2) ? (this._lastBallCarrier || null) : null;
    const passer = (pts === 6 && this._lastBallType === "pass") ? (this.offR.starters.qb || null) : null;
    const kicker = (type.includes("FG") || type === "Extra Point") ? (this.offR.starters.k || null) : null;
    this._pushVisual({
      kind: "score",
      desc: `${this.possTeam.city} ${this.possTeam.name} — ${type} (+${pts})`,
      scoreType: type,
      scorer, passer, kicker,
      poss: this.poss, pts,
      quarter: this.quarter,
      clockAfter: this.time,   // game clock is this.time (this.clock was undefined)
      homeScore: this.score.home,
      awayScore: this.score.away,
    });
  }
  // ── PLAYCALLER AGGRESSION ──────────────────────────────────────────────
  // The offense's QB and the defense's MLB call the plays in this league.
  // Their AGGRESSION rating drives 4th-down decisions, 2-pt try rate, deep
  // shots, audibles, blitz rate, etc. Derived from existing stats so we
  // don't have to extend the roster generator.
  //   QB aggression = 0.40 × THR + 0.30 × AWR + archetype delta
  //   LB aggression = 0.40 × PRS + 0.30 × TCK + archetype delta
  // Range ~20-99. 50 = neutral, 80+ = "go for it" risk-taker.
  _qbAggression() {
    const qb = this._playerByName.get(this.offR.starters.qb);
    if (!qb) return 50;
    const thr  = qb.stats?.[4] ?? 70;
    const awr  = qb.stats?.[3] ?? 70;
    const arch = qb.archetype;
    const archMod = arch === "GUNSLINGER"   ?  20
                  : arch === "DUAL_THREAT"  ?  10
                  : arch === "POCKET"       ?   0
                  : arch === "GAME_MANAGER" ? -15
                  : 0;
    return clamp(thr * 0.40 + awr * 0.30 + archMod, 20, 99);
  }
  _mlbAggression() {
    const lbName = this.defR.starters.lb2;  // MLB
    if (!lbName) return 50;
    const lb = this._playerByName.get(lbName);
    if (!lb) return 50;
    const prs = lb.stats?.[7] ?? 70;
    const tck = lb.stats?.[9] ?? 70;
    const arch = lb.archetype;
    const archMod = arch === "BLITZER" ?  20
                  : arch === "THUMPER" ?  10
                  : arch === "SIGNAL"  ?   0
                  : arch === "COVER"   ? -10
                  : 0;
    return clamp(prs * 0.40 + tck * 0.30 + archMod, 20, 99);
  }
  // Tilt multiplier centered on 50. Aggressive = >1.0, conservative = <1.0
  // Used to scale base probabilities (e.g. base * tilt). Aggression 80 → 1.30
  _aggTilt(agg) { return 1 + (agg - 50) / 100; }   // 20 → 0.70, 80 → 1.30

  // Composure under pressure → a SIGNED modifier (>0 helps the player, <0
  // hurts). Only bites in late-and-close moments (Q4/OT, <5:00, one-score)
  // and is amplified in the playoffs. Reads the hidden _clutch attribute
  // (50 = neutral). Accuracy / decision-making / catching ONLY — never
  // physical attributes (speed / strength / range).
  // Late-and-close: Q4/OT, under 5:00, one-score. The canonical clutch gate.
  _isLateClose() {
    return this.quarter >= 4 && this.time < 300
        && Math.abs(this.score.home - this.score.away) <= 8;
  }
  _clutchMod(name, scale) {
    if (!name || !this._isLateClose()) return 0;
    const p = this._playerByName?.get?.(name);
    const sig = ((p?._clutch ?? 50) - 50) / 50;          // [-1,+1]; <0 = choker
    return sig * scale * (this.isPlayoff ? 1.5 : 1.0);
  }
  // Handles the kickoff after any score (TD or FG). Decides whether the
  // kicking team should attempt an onside kick (trailing late) and sets
  // possession / yardLine accordingly. Pushes a kickoff visual either way.
  _kickoffAfterScore(scoringTeamKey) {
    const receivingKey = scoringTeamKey === "home" ? "away" : "home";
    const scoreDiff = this.score[scoringTeamKey] - this.score[receivingKey];
    const lateGame  = (this.quarter === 4 && this.time < 240) || this.quarter >= 5;
    const desperate = (this.quarter === 4 && this.time < 30)  || this.quarter >= 5;
    // Kicking team only tries an onside if they're STILL behind (or just
    // tied with little time), since recovering an onside is rare and a
    // failed onside hands the opponent great field position.
    const tryOnside = (lateGame  && scoreDiff <  0)
                   || (desperate && scoreDiff <= 0 && this.time < 60);
    if (tryOnside) {
      const recovered = Math.random() < 0.13;     // ~13% under modern rules
      const kicker = this[scoringTeamKey];
      const receiver = this[receivingKey];
      if (recovered) {
        this._pushVisual({
          kind: "kickoff",
          desc: `ONSIDE KICK — RECOVERED by ${kicker.name}! Ball at midfield.`,
          startYard: 35, endYard: 50,
          isOnside: true, onsideRecovered: true,
          poss: scoringTeamKey,
          motion: { result: "onsideRecovered", contactT: 0.15, scrumT: 0.55 },
        });
        this.poss = scoringTeamKey;
        this.yardLine = 50;            // kicking team starts at the 50
      } else {
        this._pushVisual({
          kind: "kickoff",
          desc: `Onside kick attempt — recovered by ${receiver.name} at midfield`,
          startYard: 35, endYard: 50,
          isOnside: true, onsideRecovered: false,
          poss: receivingKey,
          motion: { result: "onsideLost", contactT: 0.15, scrumT: 0.55 },
        });
        this.poss = receivingKey;
        this.yardLine = 50;            // receiving team starts at the 50
      }
    } else {
      // Standard kickoff. Modern NFL touchback rate is ~70-75% (the
      // 2024 dynamic kickoff rules cut touchbacks but most still go
      // to the EZ). Of returned kicks: average return ~22 yards,
      // with a long-tail chance of a big return or kickoff-return TD
      // (~0.3% of kickoffs become TDs in modern NFL).
      this.poss = receivingKey;
      const ret = this._resolveKickoffReturn(scoringTeamKey, receivingKey);
      this.yardLine = ret.endYL;
      if (ret.isTD) {
        // Kickoff returned for a TD — score it, then the kicking team
        // kicks AGAIN (per NFL rule).
        this._score(6, "Kickoff Return Touchdown!");
        const k = this.offR.starters.k, kStats = this.offStats.players[k];
        if (Math.random() < 0.92) {
          if (kStats) kStats.xp_att++;
          if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
        }
        this._kickoffAfterScore(this.poss);
        return;
      }
    }
    this.down = 1; this.ytg = 10;
  }

  // Resolve a kickoff return when NOT a touchback. Returns the end
  // yardline + whether it went all the way for a TD.
  //   Touchback rate    ~ 70% → endYL 25
  //   Returned median   ~ 22 yards from the goal line (so endYL ~22)
  //   Returned long-tail ~ 0.3% of kickoffs are returned for a TD
  // The receiving team's KR (or RB1 / WR1 fallback) gets the return.
  _resolveKickoffReturn(kickerKey, receiverKey) {
    if (Math.random() < 0.72) return { endYL: 25, isTD: false };
    // Returned — pick a returner. The roster's KR-tagged player would
    // be ideal but most rosters don't tag one, so we use RB1 / WR1.
    const receiverR = receiverKey === "home" ? this.homeR : this.awayR;
    const receiverStats = this.stats[receiverKey];
    const returnerName = receiverR.starters?.kr
                       || receiverR.starters?.rb
                       || receiverR.starters?.wr1
                       || "Returner";
    // Base ~22 yards + noise. ~10% chance of a 40+ yard return; ~0.3%
    // chance the return goes the distance (75+ yards to a TD).
    // SPD/AGI of the returner shift both the base mean (±~6 yds elite vs
    // plodder) and the breakaway-bolt-on probability — without this the
    // base return was flat across SPD quartiles.
    const _krPRet = this._playerByName.get(returnerName);
    const _krSpd = _krPRet?.stats?.[0] ?? 80;
    const _krAgi = _krPRet?.stats?.[2] ?? 75;
    // Clamp the SPD mod to ±6 — a SPD-50 fallback returner (rare, fires
    // when no KR is tagged) lands at -6 (mean ~17.5) rather than -9.
    const _krSpdMod = clamp((_krSpd - 80) * 0.30, -6, 6);
    let ret = Math.max(0, Math.round(18 + Math.random() * 12 + _krSpdMod));
    // Breakaway floor at 0.01 — a SPD 50 player should almost never break away,
    // not 3% per return like the engine-wide minimum.
    const _krBreakawayCh = clamp(0.10 + (_krSpd - 80) / 250 + (_krAgi - 75) / 400, 0.01, 0.30);
    if (Math.random() < _krBreakawayCh) ret += Math.floor(Math.random() * 20);
    // Credit KR stats — kr_yds + kr_td fields are referenced in HoF +
    // accolade tracking (play-franchise-season.js HoF, offseason
    // accolade thresholds), so we must update them or career returner
    // leaders go silently unrecorded. TD branch overrides with full
    // return distance (kick at 35 → 100 yards from kick spot).
    const rStats = receiverStats?.players?.[returnerName];
    if (Math.random() < 0.003) {
      // Touchdown return — credit FULL return distance, not the partial
      // 18-49 yd `ret` (which represents only the routine-return
      // distribution). 100 - 35 = 65 yds from the kick spot.
      if (rStats) {
        rStats.kr_att = (rStats.kr_att || 0) + 1;
        rStats.kr_yds = (rStats.kr_yds || 0) + 65;
        rStats.kr_td  = (rStats.kr_td  || 0) + 1;
        if (65 > (rStats.kr_long || 0)) rStats.kr_long = 65;
      }
      this._pushVisual({
        kind: "kickoff",
        desc: `${returnerName} returns the kickoff ALL THE WAY — TOUCHDOWN!`,
        startYard: 35, endYard: 100,
        kicker: kickerKey, returner: returnerName,
        isReturnTD: true,
        motion: { result: "returnTD", contactT: 0.05, catchT: 0.48, tackleT: null },
      });
      return { endYL: 100, isTD: true };
    }
    // Returner break-tackle in the coverage lane — elite return men juke
    // gunners and truck overmatched cover guys. Defender pool is the
    // kicking team's coverage unit (this.defArch after poss flip).
    const rp = this._playerByName.get(returnerName);
    if (ret > 0 && rp) {
      const br = this._resolveBreakTackle({
        carrierName: returnerName, yards: ret,
        breakStyle: _archetypeBreakStyle(rp.archetype),
        tacklerArchByPos: this.defArch,
        tacklerStatsPlayers: this.defStats?.players,
        tacklerZones: _RETURN_TACKLER_ZONES, gangDist: _RETURN_GANG_DIST,
      });
      if (br.brokenTackles > 0) {
        ret += br.bonusYards;
        if (rStats) rStats.broken_tackles = (rStats.broken_tackles || 0) + br.brokenTackles;
      }
    }
    if (rStats) {
      rStats.kr_att = (rStats.kr_att || 0) + 1;
      rStats.kr_yds = (rStats.kr_yds || 0) + ret;
      if (ret > (rStats.kr_long || 0)) rStats.kr_long = ret;
    }
    // Coverage tackle — credit a kicking-team defender on the return.
    // ST coverage units mostly draw from CB / S depth, so weight there.
    this._creditTackle({ S: 0.30, CB: 0.30, LB: 0.30, DL: 0.10 });
    const endYL = Math.min(50, ret);
    this._pushVisual({
      kind: "kickoff",
      desc: `${returnerName} returns the kick to the own ${endYL}`,
      startYard: 35, endYard: endYL,
      kicker: kickerKey, returner: returnerName,
      retYds: ret,
      motion: { result: "returned", contactT: 0.05, catchT: 0.48, tackleT: 0.85 },
    });
    return { endYL, isTD: false };
  }
  // Attempt an extra point (or rarely a 2-pt) for the DEFENSIVE team after
  // they score on a pick-six / fumble-six / blocked-FG TD / missed-FG TD.
  // Pushes a visual either way so the user sees the kick or the miss/2pt.
  _defScoreXP() {
    const scoringSide = this.poss === "home" ? "away" : "home";
    const scoringTeam = scoringSide === "home" ? this.home : this.away;
    const defStats = this.stats[scoringSide];
    const k = this.defR.starters.k;
    const kStats = defStats?.players?.[k];
    if (Math.random() < 0.92) {
      if (kStats) kStats.xp_att++;
      if (Math.random() < 0.94) {
        this.score[scoringSide] += 1;
        if (kStats) kStats.xp_made++;
        // poss + pts required so the broadcast quarter-scoreboard
        // aggregator (sums kind:"score" with poss+pts) picks up the
        // point. Without these, defensive-TD XP scores were silently
        // dropped from the quarter totals.
        this._pushVisual({ kind: "score", desc: `${scoringTeam.city} ${scoringTeam.name} — Extra Point (+1)`, poss: scoringSide, pts: 1, scoreType: "Extra Point" });
      } else {
        this._pushVisual({ kind: "fg_miss", desc: `${scoringTeam.city} ${scoringTeam.name} — Extra Point MISSED`,
          motion: { result: "miss", missType: Math.random() < 0.5 ? "wide_l" : "wide_r", contactT: 0.45, flightT: 0.85 } });
      }
    } else {
      if (Math.random() < 0.48) {
        this.score[scoringSide] += 2;
        this._pushVisual({ kind: "score", desc: `${scoringTeam.city} ${scoringTeam.name} — 2-Point Conversion (+2)`, poss: scoringSide, pts: 2, scoreType: "2-Point Conversion" });
      } else {
        this._pushVisual({ kind: "incomplete", desc: `${scoringTeam.city} ${scoringTeam.name} — 2-Point Conversion NO GOOD` });
      }
    }
  }
  _play() {
    // Reset pending live-ball penalty state from previous snap.
    this._pendingLivePen = null;
    this._penSnapshot = null;
    const result = this._playInner();
    // Live-ball penalty accept/decline. The play has resolved; non-offending
    // team picks the outcome that's better for them. ACCEPT → restore the
    // pre-play snapshot and apply the penalty. DECLINE → play stands, log
    // the declined flag in stats so we can audit it.
    const pen = this._pendingLivePen;
    if (pen) {
      this._pendingLivePen = null;
      const snap = this._penSnapshot;
      this._penSnapshot = null;
      const accept = this._shouldAcceptLivePenalty(pen, result, snap);
      // Capture the play outcome that was on the table for the audit
      // trace. Score deltas are computed against the snap so the audit
      // can verify whether ignoring a TD/score made sense.
      const offSide = snap?.poss || this.poss;
      const defSide = offSide === "home" ? "away" : "home";
      const decisionContext = {
        playYds: result?.yards ?? 0,
        playWasTO: !!result?.turnover,
        playWasInc: !!result?.incomplete,
        offScoreDelta: (this.score[offSide] || 0) - (snap?.score?.[offSide] || 0),
        defScoreDelta: (this.score[defSide] || 0) - (snap?.score?.[defSide] || 0),
        snapDown: snap?.down, snapYtg: snap?.ytg, snapYardLine: snap?.yardLine,
        penYds: pen.yds, penAutoFirst: !!pen.autoFirst, penLossDown: !!pen.lossDown,
        penOn: pen.on, penType: pen.type,
      };
      if (accept) {
        this._restoreFromPenaltySnapshot(snap);
        this._applyPenaltyEffects(pen, decisionContext);
        return { yards: 0, incomplete: false, isPenalty: true };
      } else {
        // Declined — increment team-level declined counter for audit.
        const { flaggedKey, offender } = pen._meta || {};
        const flaggedStats = this.stats[flaggedKey];
        if (flaggedStats?.team) {
          flaggedStats.team.penalties_declined =
            (flaggedStats.team.penalties_declined || 0) + 1;
        }
        if (offender && flaggedStats?.players?.[offender]) {
          flaggedStats.players[offender].penalties_declined =
            (flaggedStats.players[offender].penalties_declined || 0) + 1;
        }
        // Push a quiet visual so the declined flag shows in the log.
        this._pushVisual({
          kind: "penalty_declined",
          desc: `🚩 ${pen.type}${offender ? ` on ${offender}` : ""} — DECLINED`,
          penType: pen.type,
          offender,
          onTeam: flaggedKey,
          decisionContext,
        });
      }
    }
    return result;
  }
  _playInner() {
    // Clear per-snap concept/coverage stash so non-main-pass pushes
    // (screen, rollout, sack) don't inherit stale values from prior plays.
    this._lastPassConcept = null;
    this._lastPassCoverage = null;
    // Depth-chart rotation: sub starters based on garbage time / fatigue
    // BEFORE any reads of this.offR.starters.X. Restores from base depth
    // chart at the top, then optionally swaps in backups.
    this._rotateForSnap();
    // Snap counts: bump for offensive skill players actually on the
    // field this snap (after rotation). Lets the post-game stats show
    // "played 89% of snaps" — fantasy managers care about this more
    // than raw touch totals.
    {
      const side = this.poss;
      const starters = this.offR.starters;
      // Personnel-aware snap counting — skill players not in the current
      // personnel group aren't on the field, so they don't accumulate
      // snaps / fatigue / wear. SPREAD has no TE, EMPTY has no RB, etc.
      // This is the "smart share" routing: a TE plan at 60% smart-share
      // naturally lands at 60% of TE-personnel snaps (not 60% of all).
      const personnel = (typeof PERSONNEL !== "undefined")
        ? (PERSONNEL[this._currentPersonnel] || PERSONNEL.BASE)
        : null;
      const hasRb = !personnel || personnel.rb > 0;
      const hasTe = !personnel || personnel.te > 0;
      // QB/WR1/WR2 always present. RB only if personnel has RB; TE only
      // if personnel has TE; WR3 in 3+ WR personnel; WR4 in 4-WR personnel.
      const rolesOnField = ["qb", "wr1", "wr2"];
      if (hasRb) rolesOnField.push("rb");
      if (hasTe) rolesOnField.push("te");
      if (personnel && personnel.wr >= 3) rolesOnField.push("wr3");
      if (personnel && personnel.wr >= 4) rolesOnField.push("wr4");
      // Dedupe — wr3/wr4 starters fall back to wr2/wr1 when roster is
      // shallow (only 2 WRs available). Without this dedup, the same
      // player would get double-bumped (2 snaps / 2 fatigue per play).
      const seenNames = new Set();
      for (const role of rolesOnField) {
        const name = starters[role];
        if (!name || seenNames.has(name)) continue;
        seenNames.add(name);
        const pl = this.stats[side].players[name];
        if (pl) pl.snaps = (pl.snaps || 0) + 1;
        else {
          // WR3/WR4 backups aren't pre-registered in _buildTeamStats —
          // ensure the stat line exists so snap counts are recorded for
          // the weekly wear-decay path (it reads snapsThisWeek by name).
          const pos = (this._playerByName?.get?.(name)?.position) || "WR";
          this._ensurePlayerStat(side, name, pos);
          const pl2 = this.stats[side].players[name];
          if (pl2) pl2.snaps = (pl2.snaps || 0) + 1;
        }
        this._bumpFatigue(name);
      }
      this.stats[side].team.snaps = (this.stats[side].team.snaps || 0) + 1;
      // OL/DL grind on every snap regardless of pass/run — bump both lines.
      // Snap counts are recorded onto each player's stat line so weekly
      // wear decay can tell who actually played vs sat (decay uses
      // snapsThisWeek; without this, OL/DL would be treated as healthy
      // scratches and get max recovery — undoing all their wear).
      const olSide = side === "home" ? this.homeOL : this.awayOL;
      const dlSide = side === "home" ? this.awayDL : this.homeDL; // defense
      const offSide = side;
      const defSide = side === "home" ? "away" : "home";
      for (const p of olSide || []) {
        if (!p?.name) continue;
        this._bumpFatigue(p.name);
        const pl = this.stats[offSide].players[p.name];
        if (pl) pl.snaps = (pl.snaps || 0) + 1;
      }
      for (const p of dlSide || []) {
        if (!p?.name) continue;
        this._bumpFatigue(p.name);
        const pl = this.stats[defSide].players[p.name];
        if (pl) pl.snaps = (pl.snaps || 0) + 1;
      }
      // Defensive back-7 also takes contact every snap (LBs flow to ball,
      // DBs run with receivers). Bump them too so late-game coverage degrades.
      const defStarters = (side === "home" ? this.awayR : this.homeR).starters;
      for (const role of ["lb1", "lb2", "lb3", "cb1", "cb2", "fs", "ss"]) {
        const name = defStarters?.[role];
        if (!name) continue;
        this._bumpFatigue(name);
        const pl = this.stats[defSide].players[name];
        if (pl) pl.snaps = (pl.snaps || 0) + 1;
      }
    }
    // ── COACHING TRAIT LOOKUPS ────────────────────────────────────────────────
    // Determine offensive/defensive team IDs for franchise.coaches lookups.
    const _offTeamId = this.poss === "home" ? this.home.id : this.away.id;
    const _defTeamId = this.poss === "home" ? this.away.id : this.home.id;
    const _ocTrait   = (typeof franchise !== "undefined") ? franchise.coaches?.[_offTeamId]?.oc?.trait  : null;
    const _dcTrait   = (typeof franchise !== "undefined") ? franchise.coaches?.[_defTeamId]?.dc?.trait  : null;
    const _hcSpec    = (typeof franchise !== "undefined") ? franchise.coaches?.[_offTeamId]?.hc?.specialtyTrait : null;
    // HC Motivator: +1 offense rating when trailing by ≤7 in Q4
    const _offScore = this.score[this.poss];
    const _defScore2= this.score[this.poss === "home" ? "away" : "home"];
    const _trailDiff= _defScore2 - _offScore;
    const _motivatorBoost = (_hcSpec === "Motivator" && this.quarter >= 4 && _trailDiff >= 1 && _trailDiff <= 7) ? 1 : 0;

    // Talent-gap → per-play advantage. Divisor controls parity: smaller
    // = bigger team effect = best team always wins (was /100). Bumped
    // to /125 because audit showed best team winning 15.4 games/season
    // (NFL 13-14) — compressing the per-play talent effect lets the
    // top team have bad days, more upsets, more parity.
    const adv = (this.offR.offense + _motivatorBoost - this.defR.defense) / 125;

    // AWR in the trenches — affects engine behavior, not OVR.
    // DL snap timing: smart rushers read the center's weight shift and get a
    // half-step jump. Small but compounding over 60+ snaps a game.
    const defDLList = this.defArch?.DL || [];
    const dlAwrAvg = defDLList.length
      ? defDLList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / defDLList.length
      : 70;
    const snapTimingBonus = (dlAwrAvg - 70) / 250; // AWR 85 → +0.06, AWR 55 → -0.06

    // OL blitz pickup: high-AWR linemen make correct protection calls vs stunts
    // and blitzes, keeping the QB clean even under exotic pressure packages.
    const offOLList = (this.poss === "home" ? this.homeOL : this.awayOL) || [];
    const olAwrAvg = offOLList.length
      ? offOLList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / offOLList.length
      : 70;
    const blitzPickupBonus = (70 - olAwrAvg) / 280; // high OL AWR reduces pressure

    // Trench matchup: positive = DL is winning vs OL (offense in trouble)
    // -1.0 ≈ OL dominates, 0 ≈ even, +1.0 ≈ DL crushes OL, +1.5 = absolute mismatch
    const basePressure = clamp((this.defR.dl - this.offR.ol) / 35 + snapTimingBonus + blitzPickupBonus, -1.2, 1.5);
    // Pick the DL rep + OL rep for THIS play, look up the matchup multiplier
    const reps = this._pickTrenchRep();
    const passMul = (PASS_MATCHUP[reps.dlType]?.[reps.olType]) ?? 1.0;
    const runMul  = (RUN_MATCHUP [reps.dlType]?.[reps.olType]) ?? 1.0;
    // Effective pressure for THIS play accounts for the archetype matchup
    const pressure = clamp(basePressure * passMul, -1.5, 1.9);
    // Expose to the visual layer (the OL/DL trench sim seeds engagement
    // leverage from this). Reset to 0 each snap below; set here once the
    // matchup is known. _pushVisual auto-attaches this._currentPressure.
    this._currentPressure = pressure;
    // Two-minute drill: offense down by ≤16, < 2:00 left in half/game.
    // Reduces play clock (no-huddle) and bumps pass rate.
    const inTwoMin = this._isTwoMinDrill();
    // Clock-stop carry: previous play was an incomplete pass / OOB / spike /
    // first down — NFL game clock stops, next snap goes in ~15 sec (play
    // clock continues but game clock paused until snap). Without this the
    // engine burned a flat 27 sec/play regardless of result.
    const clockStopped = !!this._lastClockStopped;
    // NFL per-snap clock burn (incl. dead ball before snap):
    //   normal:  ~26-28s   (engine 27)  class-mixture-tuned ypp lands at NFL
    //                       but plays/team still 58.2 vs NFL 62. Trim from 29
    //                       to 27 adds ~4 plays/team/game, lifting score from
    //                       19.3 toward NFL 22 (efficiency × volume).
    //   stopped: ~13s      (engine 13)  incomp / OOB / TO / spike
    //   2-min:   ~12s      (engine 12)  no-huddle pace
    const dtMean = inTwoMin ? 12 : clockStopped ? 13 : 27;
    const dtSd   = inTwoMin ? 3  : clockStopped ? 4  : 8;
    const dtMin  = inTwoMin ? 5  : clockStopped ? 6  : 14;
    const dtMax  = inTwoMin ? 22 : clockStopped ? 22 : 50;
    const dt = clamp(normal(dtMean, dtSd), dtMin, dtMax);
    this.time -= dt;
    if (this.time < 0) this.time = 0;
    // Time of possession: every snap's elapsed clock counts toward the
    // offense's TOP. Surfaces in team-stats comparison + box score.
    this.stats[this.poss].team.timeOfPoss = (this.stats[this.poss].team.timeOfPoss || 0) + dt;
    const startYard = this.yardLine;
    const off = this.offStats, def = this.defStats;
    const QB = this.offR.starters.qb, RB = this.offR.starters.rb, K = this.offR.starters.k;
    const isThird = this.down === 3, isFourth = this.down === 4;
    // PERSONNEL selection — picked once per snap. Long-yardage tilts toward
    // SPREAD/EMPTY; goal-line toward HEAVY/I_FORM. Stored on `this` so
    // _pushVisual auto-attaches it to every play visual this snap.
    const offPb = getPlaybook(this.possTeam);
    const isLongYardage = (isThird || isFourth) && this.ytg >= 8;
    const isNearGL      = (100 - this.yardLine) <= 5;
    // RED ZONE — 20-yd line in. NFL RZ stats: shorter throws (higher comp%),
    // higher TD-per-attempt for completed passes, heavier personnel inside
    // the 10. Tracked so play handlers can apply RZ-specific tilts and the
    // team box can report rz_att / rz_td / rz_eff.
    const isRedZone = this.yardLine >= 80;
    const isGoalToGo = this.yardLine >= 90;
    this._inRedZone = isRedZone;
    this._inGoalToGo = isGoalToGo;
    // NOTE: this._currentPressure is set ABOVE (once the trench matchup is picked),
    // so the play log / visual trench layer reflects the real per-snap pressure.
    // (A stale `this._currentPressure = 0` reset used to sit here and clobbered it,
    // forcing every logged pressure to 0 — the trench computation had moved above
    // this point in a refactor. Removed.)
    this._currentPersonnel = pickPersonnel(offPb, { isLongYardage, isGoalLine: isNearGL, isRedZone, isGoalToGo, down: this.down, ytg: this.ytg });
    this._currentDefPackage = packageForPersonnel(this._currentPersonnel);
    // Defensive box / coverage response — driven by what offense lines up in
    // (personnel) AND the situation (down/distance). Defense reads the
    // presnap; no need for tendency history. Predictable offenses face the
    // same defensive look every snap and get stuffed accordingly.
    const personnel = this._currentPersonnel || "BASE";
    // Personnel base mods: HEAVY/I_FORM stack the box (more LBs in tight),
    // SPREAD/EMPTY thin out (DIME/QUARTER, more DBs in coverage).
    // JUMBO (13 personnel: 1 RB / 3 TE / 1 WR) — modern heavy set (Rams/Ravens/
    // 49ers): forces the defense into base, runs behind extra blockers, then
    // hits explosive play-action off the run threat. Best PA air bump + max
    // protection (3 TEs help block → fewest sacks), low INT (short/PA throws).
    const PERS_RUN = { I_FORM: -1.8, HEAVY: -1.2, JUMBO: -1.0, BASE: 0, TRIPS: 0, SPREAD: 1.0, EMPTY: 1.5 };
    const PERS_AIR = { I_FORM:  2.0, HEAVY:  1.4, JUMBO:  2.4, BASE: 0, TRIPS: 0, SPREAD: -0.6, EMPTY: -1.0 };
    // SPREAD/EMPTY = defense in DIME/QUARTER playing press + lighter front,
    // tighter coverage on quick reads but more vulnerable inside.
    const PERS_COMP = { I_FORM: 0.020, HEAVY: 0.015, JUMBO: 0.018, BASE: 0, TRIPS: 0, SPREAD: -0.025, EMPTY: -0.040 };
    const PERS_SACK_MUL = { I_FORM: 0.85, HEAVY: 0.90, JUMBO: 0.85, BASE: 1.0, TRIPS: 1.0, SPREAD: 1.12, EMPTY: 1.20 };
    const PERS_INT_MOD  = { I_FORM: -0.001, HEAVY: 0, JUMBO: -0.001, BASE: 0, TRIPS: 0, SPREAD: 0.005, EMPTY: 0.008 };
    // Down & distance — situational tilts on top of personnel.
    const isThirdLong  = this.down === 3 && this.ytg >= 7;
    const isThirdShort = this.down === 3 && this.ytg <= 2;
    // 3rd-down situ mods. Most 3rd downs are medium (3-6 yds) so we apply
    // a base +0.010 on ANY 3rd down to nudge conversion toward NFL 40%.
    // Short/long buckets layer on top. SKIP inside red zone — RZ tightening
    // is separate; we don't want the 3rd-down boost re-inflating RZ TD%.
    const isThirdDown = this.down === 3;
    const situRunMod  = isThirdShort ? -0.5 : isThirdLong ?  0.5 : 0;
    const situAirMod  = isThirdLong  ? -0.5 : isThirdShort ?  0.3 : 0;
    const situCompMod = (isThirdDown && !isRedZone)
                        ? (isThirdLong ? 0.005 : isThirdShort ? 0.030 : 0.018)
                        : 0;
    const situSackMul = isThirdLong  ? 1.05 : 1.0;
    this._boxStackRunMod  = (PERS_RUN[personnel]  || 0) + situRunMod;
    this._boxStackAirMod  = (PERS_AIR[personnel]  || 0) + situAirMod;
    this._boxStackCompMod = (PERS_COMP[personnel] || 0) + situCompMod;
    this._boxStackIntMod  = (PERS_INT_MOD[personnel] || 0);
    this._boxStackSackMul = (PERS_SACK_MUL[personnel] || 1) * situSackMul;
    // RZ team-stat: count the trip when offense first crosses into the 20.
    // Use this._lastRzPossession to dedupe re-entries on a single drive.
    if (isRedZone && this._lastRzDrive !== this.drives.length) {
      this._lastRzDrive = this.drives.length;
      this.stats[this.poss].team.rz_att = (this.stats[this.poss].team.rz_att || 0) + 1;
    }

    if (this.down === 4) {
      const toEZ = 100 - this.yardLine;
      // Max makeable FG distance scales with the kicker's LEG, not a flat 57.
      // A big-leg / LEG-archetype kicker gets sent out for 60+ yarders; a
      // weak-leg / PRECISION kicker is pulled in. This is what makes LEG's
      // signature (long range) actually appear — previously every team's FG
      // ceiling was 57 regardless of who was kicking.
      const _kFg = this._playerByName.get(this.offR.starters.k);
      const _kpwFg = _kFg?.stats?.[10] ?? 70;
      let _maxFgDist = 54 + Math.max(0, _kpwFg - 70) * 0.30;   // kpw 70→54, 90→60
      if (_kFg?.archetype === "LEG") _maxFgDist += 3;
      else if (_kFg?.archetype === "PRECISION") _maxFgDist -= 2;
      _maxFgDist = clamp(_maxFgDist, 48, 64);
      const inFGRange  = (toEZ + 17) <= _maxFgDist;   // dist = toEZ + 17
      const isGoalLine = toEZ <= 3;    // 4th & goal at the 3 or in
      const isShortYTG = this.ytg <= 2;
      // QB AGGRESSION tilts the go-for-it rate. A risk-taking QB (high THR
      // + AWR + GUNSLINGER) elevates every "go" decision; a conservative
      // GAME_MANAGER passes the ball off to the kicker / punter more often.
      const qbTilt = this._aggTilt(this._qbAggression());   // 0.70-1.30
      // HC personality layered on top — Riverboat Gambler always goes,
      // Conservative always punts/kicks. Game Manager mildly conservative
      // (favors safe outcomes). 0.60-1.40 range.
      const offTeamId = this.poss === "home" ? this.home.id : this.away.id;
      const hcStyle = (typeof franchise !== "undefined")
        ? franchise.coaches?.[offTeamId]?.hc?.specialtyTrait : null;
      const hcAggMul = hcStyle === "Riverboat Gambler" ? 1.40
                     : hcStyle === "Conservative"      ? 0.60
                     : hcStyle === "Game Manager"      ? 0.85
                     :                                    1.00;
      const goTilt = clamp(qbTilt * hcAggMul, 0.55, 1.55);
      // Decide between FG / punt / go-for-it. Rates anchor to modern
      // NFL analytics-era go-for-it data (2020+):
      //   4th-and-1 anywhere       ~60-65% go
      //   4th-and-2 anywhere       ~40% go
      //   4th-and-3-4 midfield     ~25-30% go
      //   4th-and-5+ midfield      ~5-10% go (desperation)
      //   4th-and-goal at 1-3      ~70-80% go
      // Field-position modifies: chip-shot FGs (≤35 yd) bias toward FG;
      // longer FGs (40-55 yd) bias toward go. Backed-up own territory
      // pushes toward punt.
      //
      // Situational modifiers (computed once, applied to all branches):
      //   q4Final (≤2:00 left in Q4): trailing → go-heavy, leading → punt
      //   q4Late  (≤5:00 left in Q4): same dial but less extreme
      //   q2End   (≤2:00 left in Q2): more aggressive across the board
      //   Blowout-down (Q4 trailing by 14+): force aggression
      //   Late-game-tied-or-trailing-by-3-in-FG-range: ALWAYS kick FG
      //   Late-game-leading-comfortable-in-FG-range: ALWAYS kick FG
      const defKey = this.poss === "home" ? "away" : "home";
      const scoreDiff = this.score[this.poss] - this.score[defKey];   // <0 = trailing
      const q4 = this.quarter === 4;
      const q4Late  = q4 && this.time < 300;
      const q4Final = q4 && this.time < 120;
      const q2End   = this.quarter === 2 && this.time < 120;
      const blowoutDown = q4 && scoreDiff <= -14;
      let scoreMod = 1.0;
      if (blowoutDown) {
        // Down 2+ scores in Q4 — must press
        scoreMod = 2.2;
      } else if (q4Final) {
        if (scoreDiff <= -1)      scoreMod = 3.0;  // trailing in final 2:00 → almost always go
        else if (scoreDiff === 0) scoreMod = 1.3;  // tied — modest extra aggression
        else                       scoreMod = 0.4;  // leading → bleed clock, punt
      } else if (q4Late) {
        if (scoreDiff <= -7)      scoreMod = 2.0;
        else if (scoreDiff <= -3) scoreMod = 1.5;
        else if (scoreDiff <= 0)  scoreMod = 1.1;
        else if (scoreDiff <= 7)  scoreMod = 0.7;
        else                       scoreMod = 0.4;
      } else if (q2End) {
        // End of Q2 — half ends after this drive. Push for points.
        scoreMod = scoreDiff < 0 ? 1.4 : 1.2;
      }
      // Per-drive commitment: coach who already went for it this drive
      // is more likely to do it again. Strategic + psychological
      // commitment carries through the drive. First go bumps next-go
      // rate ~1.35x; second go bumps it further (1.6x). Saturates fast.
      const driveCommit = (this._drive4thGoCount || 0);
      const commitMod = driveCommit === 0 ? 1.0
                      : driveCommit === 1 ? 1.35
                      :                     1.60;
      let action;

      // ─── MFF Slice G: analytics coaching chart ──────────────────────
      // Modern analytics-era coaches consult a 4th-down chart (Burke /
      // nflfastR / Stats Bomb consensus). Each coach's analyticsAgg trait
      // (0-100) is the probability they DEFER to the chart on this play
      // instead of the traditional rules below. analyticsAgg=80 (Riverboat)
      // → 80% chart; analyticsAgg=15 (Conservative) → 15% chart. The
      // override is applied AFTER traditional `action` is set, so legacy
      // saves with no analyticsAgg (defaulted to 50 by _backfillCoachingStaff)
      // get a meaningful but bounded behavior shift.
      const hcAA = ((typeof franchise !== "undefined")
        ? (franchise.coaches?.[offTeamId]?.hc?.analyticsAgg ?? 50)
        : 50) / 100;
      let _mffAnalyticsAction = null;
      if (Math.random() < hcAA) {
        // The chart's "go threshold" (max ytg that says GO):
        //   own deep ≤30: ≤1   own mid 30-50: ≤2   midfield 50-65: ≤4
        //   opp 65-75: ≤4      opp 75-85 (FG): ≤2  opp 85-95 (RZ): ≤2/4
        //   opp 95+ (goal): ≤2 / ≤4 trailing late
        let goThreshold;
        if (this.yardLine <= 30)       goThreshold = 1;
        else if (this.yardLine <= 50)  goThreshold = 2;
        else if (this.yardLine <= 75)  goThreshold = 4;
        else if (this.yardLine <= 85)  goThreshold = 2;
        else                           goThreshold = (q4Late && scoreDiff < 0) ? 4 : 2;
        // Game-state shifts
        if (q4Late && scoreDiff <= -14) goThreshold = Math.max(goThreshold, 5);
        else if (q4Late && scoreDiff <= -8 && this.time < 600) goThreshold = Math.max(goThreshold, 4);
        else if (q4Late && scoreDiff >= 14) goThreshold = Math.min(goThreshold, 1);
        // Late + tied/trailing 1-3 + FG would tie/win → kick.
        const fgWinChance = q4Late && scoreDiff >= -3 && scoreDiff <= 0 && toEZ <= 30 && inFGRange;
        if (fgWinChance) _mffAnalyticsAction = "fg";
        else if (this.ytg <= goThreshold) _mffAnalyticsAction = "go";
        else if (inFGRange) _mffAnalyticsAction = "fg";
        else if (q4Final && scoreDiff > 0) _mffAnalyticsAction = "punt";
        else if (q4Late && scoreDiff < -3) _mffAnalyticsAction = "go";
        else _mffAnalyticsAction = "punt";
        // Goal-line override: comfy lead, not late, sometimes bank the 3.
        if (_mffAnalyticsAction === "go" && isGoalLine && scoreDiff > 7 && !q4Late && Math.random() < 0.30) {
          _mffAnalyticsAction = "fg";
        }
      }
      // ─── /MFF Slice G ─────────────────────────────────────────────

      if (isGoalLine) {
        // 4th-and-goal: NFL ~75% go on 1-3 yds, ~30% on 4+.
        const goalGo = this.ytg <= 3 ? 0.75 : 0.30;
        // Late-game trailing 3+: must take the TD (down by FG can't be
        // recovered with FG; need 7). Late-game trailing 1-2: FG ties,
        // so even goal-line might kick.
        let goalScoreMod = scoreMod;
        if (q4Late && scoreDiff <= -7) goalScoreMod = Math.max(goalScoreMod, 1.6);
        action = Math.random() < clamp(goalGo * goTilt * goalScoreMod * commitMod, 0.25, 0.97) ? "go" : "fg";
      } else if (inFGRange) {
        // In FG range (≤57 yd kick). Closer kicks lean FG; longer kicks
        // lean go-for-it on short yardage.
        const closeKick = toEZ <= 20;
        // LATE-GAME FG OVERRIDES: tied or trailing by 1-3 with FG that
        // ties/wins → ALWAYS kick. Leading by 1-3 with FG that extends
        // to 2-score → almost always kick.
        const fgWouldTieOrWin = q4Late && scoreDiff <= 0 && scoreDiff >= -3;
        const fgExtendsToTwoScore = q4Late && scoreDiff >= 1 && scoreDiff <= 4;
        if (fgWouldTieOrWin || fgExtendsToTwoScore) {
          action = "fg";
        } else if (q4Late && scoreDiff <= -8 && this.ytg <= 7) {
          // Trailing 8+ late: a FG is wasted (still down 5+). Go for it
          // even on moderate yardage in FG range.
          const desperateGo = this.ytg <= 4 ? 0.85 : 0.55;
          action = Math.random() < desperateGo ? "go" : "fg";
        } else {
          let goRate;
          if (this.ytg <= 1)      goRate = closeKick ? 0.35 : 0.65;
          else if (this.ytg <= 2) goRate = closeKick ? 0.18 : 0.35;
          else if (this.ytg <= 4) goRate = closeKick ? 0.04 : 0.12;
          else                    goRate = 0;
          action = Math.random() < clamp(goRate * goTilt * scoreMod * commitMod, 0, 0.92) ? "go" : "fg";
        }
      } else {
        // Out of FG range. NFL is aggressive on short yardage in plus
        // territory; backed-up own territory still punts.
        const inOwnDeep = this.yardLine <= 30;
        // Late-game leading: just punt regardless of yardage (run clock).
        // Late-game trailing big: go for it on anything reachable.
        if (q4Final && scoreDiff > 0) {
          action = "punt";
        } else if (q4Final && scoreDiff < 0 && this.ytg <= 15) {
          action = "go";
        } else if (blowoutDown && this.ytg <= 12) {
          // Down 14+ in Q4 — go for it on anything manageable
          const desperateGo = this.ytg <= 4 ? 0.92 : this.ytg <= 7 ? 0.70 : 0.45;
          action = Math.random() < desperateGo ? "go" : "punt";
        } else {
          let goRate;
          if (this.ytg <= 1)      goRate = inOwnDeep ? 0.40 : 0.75;
          else if (this.ytg <= 2) goRate = inOwnDeep ? 0.18 : 0.50;
          else if (this.ytg <= 4) goRate = (toEZ <= 55) ? 0.30 : (inOwnDeep ? 0.04 : 0.12);
          else if (this.ytg <= 7) goRate = (toEZ <= 50) ? 0.10 : 0.03;
          else                    goRate = 0;
          action = Math.random() < clamp(goRate * goTilt * scoreMod * commitMod, 0, 0.95) ? "go" : "punt";
        }
      }
      // MFF Slice G: apply analytics-chart override AFTER traditional logic
      // has produced its `action`. The analytics recommendation takes
      // precedence when the coach's analyticsAgg rolled high enough.
      if (_mffAnalyticsAction != null) action = _mffAnalyticsAction;

      // HC decision callout — when the coach defies the chart, surface it.
      // Fires on go-for-its outside the obvious 4th-and-1 case (or when an
      // identifiable HC trait drove the call). Skipped on auto-punts.
      if (action === "go" && (hcStyle === "Riverboat Gambler" || hcStyle === "Conservative" || this.ytg >= 3)) {
        const offTeamObj = this.poss === "home" ? this.home : this.away;
        const hcName = (typeof franchise !== "undefined")
          ? franchise.coaches?.[offTeamId]?.hc?.name : null;
        this._pushVisual({
          kind: "hc_decision",
          decision: "go_4th",
          coachName: hcName || `${offTeamObj?.name || "Team"} HC`,
          trait: hcStyle || null,
          side: this.poss,
          ytg: this.ytg,
          fieldPos: this.yardLine,
          inFGRange,
          rationale: hcStyle === "Riverboat Gambler" ? "Gambler instincts — going for it"
                   : hcStyle === "Conservative" ? "Defies type — desperate situation"
                   : this.ytg <= 2 ? "Short yardage gamble"
                   : "Analytics-era aggression",
          desc: `🎩 ${hcName || "HC"} → 4TH-DOWN GO (${this.ytg} to gain)`,
        });
      }
      if (action === "fg") {
        const dist = toEZ + 17;
        // ── ICE THE KICKER ──
        // Late game, defense burns a TO right before a tying / lead-changing FG.
        // Has a small accuracy effect (kicker has time to overthink).
        const defKey = this.poss === "home" ? "away" : "home";
        const offScore = this.score[this.poss], defScore = this.score[defKey];
        const fgWouldTieOrLead = (offScore + 3) >= defScore;
        const lateGameClose = this.time < 90 && this.quarter >= 4 && Math.abs(offScore - defScore) <= 4;
        const isIcable = lateGameClose && fgWouldTieOrLead && dist >= 30 && this.timeouts[defKey] > 0;
        let isIced = false;
        if (isIcable && Math.random() < 0.55) {
          this.timeouts[defKey]--;
          isIced = true;
          this.plays.push({
            kind: "timeout",
            desc: `🧊 ICE THE KICKER — ${this[defKey].city} ${this[defKey].name}`,
            team: defKey, quarter: this.quarter, time: this.time,
            timeoutsRemaining: { ...this.timeouts },
            personnel: this._currentPersonnel || "BASE",
            defPackage: this._currentDefPackage || "BASE_43",
            poss: this.poss, down: this.down, ytg: this.ytg, yardLine: this.yardLine,
            homeScore: this.score.home, awayScore: this.score.away,
          });
        }
        // Weather effects on FG: wind helps when kicking with it, hurts
        // against it; snow crushes range; rain costs ~3% on long kicks.
        // Wind direction is in world coords; the kicking team's goal is at
        // dir>0 if home (kicking right) — we tilt the math based on poss.
        const wKick = this.weather || { label: "CLEAR", windDir: 0, windStrength: 0 };
        const teamKickDir = this.poss === "home" ? 1 : -1;
        // windWith = +1 if wind is at the kicker's back, -1 if into his face
        const windWith = wKick.windStrength * (wKick.windDir === teamKickDir ? 1 : -1);
        let wxPenalty = 0;
        if (wKick.label === "WINDY") wxPenalty = (wKick.windStrength || 0) * 0.04 + (dist - 30) * 0.012 * (-windWith);   // net base penalty + directional tilt
        else if (wKick.label === "SNOW")  wxPenalty = 0.10 + (dist - 25) * 0.008 * (-windWith);
        else if (wKick.label === "RAIN")  wxPenalty = Math.max(0, (dist - 35)) * 0.004;
        // K archetype tilts FG math: LEG = more range less accuracy, PRECISION =
        // less range more accuracy, CLUTCH = bonus in 4th Q tight games, BALANCED = neutral.
        const kPlayer = this._playerByName.get(K);
        const kArch = kPlayer?.archetype;
        const kpw   = kPlayer?.stats?.[10] ?? 70;
        let archAccMod = 0, archRangeMod = 0;
        if (kArch === "LEG")       { archAccMod = -0.025; archRangeMod = (dist - 35) * 0.0035; }
        else if (kArch === "PRECISION") { archAccMod = +0.035; archRangeMod = -Math.max(0, dist - 45) * 0.006; }
        // Clutch/composure tilts FG ACCURACY only (never range/power) in
        // late-and-close moments — continuous off the hidden _clutch attribute,
        // so an ice-veins kicker hits more and a folder misses more. The CLUTCH
        // archetype is generated with high _clutch, preserving its old edge.
        const clutchAccMod = this._clutchMod(K, 0.06);
        // KPW above 75 adds a small extra range bonus regardless of archetype
        const kpwBonus = Math.max(0, kpw - 75) * 0.001;
        // Ice the kicker — small accuracy hit when defense burned a TO before the snap.
        const iceMod = isIced ? -0.04 : 0;
        // NFL FG% by distance: ~99% at 20yd, ~90% at 35yd, ~80% at 45yd, ~70%
        // at 55yd. Slope -1pp / yd; previous -2pp was too steep (sim hit 52%).
        // Read kicker's KPW + AWR directly. Team K-rating (offR.k) gets
        // dragged down by capped STR/BLK/TCK on kicker, which is incidental
        // to actual kicking. Use the relevant stats: KPW for power, AWR for
        // composure under pressure.
        const kAwr = kPlayer?.stats?.[3] ?? 70;
        const kSkill = (kpw * 0.7 + kAwr * 0.3) - 60;
        const fgPct = clamp(0.99 - (dist - 20) * 0.010 + kSkill / 200
                          + archAccMod + archRangeMod + kpwBonus + iceMod + clutchAccMod - wxPenalty, 0.15, 0.99);
        const kStats = off.players[K]; if (kStats) { kStats.fg_att++; }
        // NOTE: do NOT bump fourthAtt — NFL "4th-down conversion %"
        // measures GO-FOR-IT attempts only. FGs and punts use their
        // own stat columns.
        // Block chance — slightly higher on long attempts
        const blockPct = clamp(0.025 + Math.max(0, dist - 40) * 0.0015, 0.025, 0.06);
        if (Math.random() < blockPct) {
          // Blocked! Defender picks up the ball. ~12% chance the recovery
          // becomes a TD return; otherwise the defense gets the ball at the
          // recovery spot (3-15 yards behind the LOS).
          const isReturnTD = Math.random() < 0.12;
          let recoveryYard;
          if (isReturnTD) recoveryYard = 0;  // they take it all the way
          else {
            // Pick up between -3 and 0 (own end zone is 0 here for offense's POV)
            const losingYards = Math.floor(Math.random() * 13) - 3;
            recoveryYard = Math.max(0, startYard - losingYards);
          }
          this._pushVisual({
            kind: "fg_blocked",
            desc: isReturnTD
              ? `BLOCKED — RETURNED ${100 - startYard} YARDS FOR A TOUCHDOWN!`
              : `BLOCKED — recovered by defense at the ${recoveryYard}`,
            startYard, endYard: recoveryYard, fgDist: dist, kicker: this.offR.starters.k,
            isReturnTD,
          });
          if (isReturnTD) {
            // Defense scores 6, then attempts XP — flip possession after.
            const defScore = this.poss === "home" ? "away" : "home";
            this.score[defScore] += 6;
            // Credit the def_td to a defender (DL most likely on a block)
            const blockerName = this._creditDefStat("def_td", { DL: 0.65, LB: 0.20, S: 0.10, CB: 0.05 });
            const def = this.stats[defScore];
            if (def) def.team.def_td = (def.team.def_td || 0) + 1;
            // XP attempt for the defensive team (with visual)
            this._defScoreXP();
          }
          return { endDrive: true, blockedFG: true, returnedTD: isReturnTD };
        }
        if (Math.random() < fgPct) {
          if (kStats) { kStats.fg_made++; if (dist > kStats.fg_long) kStats.fg_long = dist; }
          this._score(3, `${dist}-yd FG`);
          // PATH B Phase 10 — FG motion: holder/longSnapper/missType
          this._pushVisual({
            kind: "fg_good", desc: `${this.offR.starters.k} drills it from ${dist} yds!`,
            startYard, endYard: 100, fgDist: dist, kicker: this.offR.starters.k,
            holder: this.offR.starters.p || this.offR.starters.qb,
            longSnapper: this.offR.starters.ls || null,
            motion: { result: "good", contactT: 0.45, flightT: 0.85 },
          });
          return { endDrive: true, fgGood: true };
        } else {
          // Long missed FGs (>50 yd attempts) can be returned by the defense
          // — the spot is behind the LOS where the defender catches the ball.
          const isReturnable = dist > 50 && Math.random() < 0.18;
          if (isReturnable) {
            const isReturnTD = Math.random() < 0.05;
            const recoveryYard = isReturnTD ? 0 : Math.max(0, startYard - 8 - Math.floor(Math.random() * 12));
            // PATH B Phase 10 — engine decides miss type so animation
            // doesn't hash. Long misses tend to be "short" (came up
            // short of the uprights); near-distance misses are wide.
            const _missType = dist >= 50 ? (Math.random() < 0.55 ? "short" : (Math.random() < 0.5 ? "wide_l" : "wide_r"))
                            : (Math.random() < 0.5 ? "wide_l" : "wide_r");
            this._pushVisual({
              kind: "fg_miss",
              desc: isReturnTD
                ? `MISSED — RETURNED FOR TOUCHDOWN!`
                : `${this.offR.starters.k} misses from ${dist} — returned to the ${recoveryYard}`,
              startYard, endYard: recoveryYard, fgDist: dist, kicker: this.offR.starters.k,
              isReturnTD, isReturned: true,
              holder: this.offR.starters.p || this.offR.starters.qb,
              longSnapper: this.offR.starters.ls || null,
              motion: { result: "miss", missType: _missType, contactT: 0.45, flightT: 0.85 },
            });
            if (isReturnTD) {
              const defScore = this.poss === "home" ? "away" : "home";
              this.score[defScore] += 6;
              // Credit the def_td — usually a DB on a missed-FG return
              this._creditDefStat("def_td", { S: 0.55, CB: 0.30, LB: 0.10, DL: 0.05 });
              const def = this.stats[defScore];
              if (def) def.team.def_td = (def.team.def_td || 0) + 1;
              this._defScoreXP();
            }
          } else {
            const _missType = dist >= 45 ? (Math.random() < 0.6 ? "short" : (Math.random() < 0.5 ? "wide_l" : "wide_r"))
                            : (Math.random() < 0.5 ? "wide_l" : "wide_r");
            this._pushVisual({
              kind: "fg_miss", desc: `${this.offR.starters.k} misses from ${dist} — no good`,
              startYard, endYard: startYard, fgDist: dist, kicker: this.offR.starters.k,
              holder: this.offR.starters.p || this.offR.starters.qb,
              longSnapper: this.offR.starters.ls || null,
              motion: { result: "miss", missType: _missType, contactT: 0.45, flightT: 0.85 },
            });
          }
        }
        return { endDrive: true };
      }
      if (action === "go") {
        // Going for it: bump the fourthAtt counter + per-drive commitment
        // counter (drives subsequent 4th-down decisions in this drive),
        // then fall through to the normal play logic below (run or pass).
        // Drive-flow code converts a successful first down into ytg=10,
        // otherwise turnover-on-downs.
        off.team.fourthAtt++;
        this._drive4thGoCount = (this._drive4thGoCount || 0) + 1;
        // Mark this conversion attempt — _drive() will check `r.yards >= ytg`
        // and credit fourthConv on success.
        this._pushVisual({ kind: "fourth_go", desc: `${this.possTeam.name} GOES FOR IT — 4th & ${this.ytg}!`, startYard, endYard: startYard });
        // Fall through to normal play (do NOT return)
      } else {
        // Punt — distance, hang time, and return resolution are all driven by
        // the PUNTER (separate from the kicker). Archetype + KPW shape it.
        // NOTE: do NOT bump fourthAtt — punts are not 4th-down conversion
        // attempts in NFL stat parlance.
        const P = this.offR.starters.p;
        const pPlayer = this._playerByName.get(P);
        const pArch = pPlayer?.archetype;
        const pKpw  = pPlayer?.stats?.[10] ?? 65;
        const pAwr  = pPlayer?.stats?.[3]  ?? 65;
        const pSpd  = pPlayer?.stats?.[0]  ?? 60;
        const pAgi  = pPlayer?.stats?.[2]  ?? 60;
        // ── FAKE PUNT ──
        // ATHLETIC punters can fake on 4th-and-short in plus territory. Roll
        // is tilted by QB aggression (aggressive playcallers gamble more).
        const fakeShortYTG = this.ytg <= 4;
        const fakeMidfield = this.yardLine >= 40 && this.yardLine <= 75;
        const fakeEligible = pArch === "ATHLETE" && fakeShortYTG && fakeMidfield;
        if (fakeEligible) {
          const aggTilt = this._aggTilt(this._qbAggression());
          const fakeChance = clamp(0.18 * aggTilt, 0.06, 0.32);
          if (Math.random() < fakeChance) {
            // FAKE PUNT! Decide run (60%) vs pass (40%) — heavier on run since
            // punters aren't really QBs. Run uses SPD+AGI, pass uses AWR.
            const isPass = Math.random() < 0.40;
            if (isPass) {
              const compPct = clamp(0.42 + (pAwr - 65) / 180, 0.22, 0.78);
              const isComp = Math.random() < compPct;
              const tgtName = this.offR.starters.te || this.offR.starters.rb2 || this.offR.starters.rb;
              const fakeYards = isComp ? clamp(Math.round(normal(11, 5)), -2, 38) : 0;
              const success = isComp && fakeYards >= this.ytg;
              this._pushVisual({
                kind: isComp ? "complete" : "incomplete",
                desc: isComp
                  ? `🎩 FAKE PUNT! ${P} throws to ${tgtName} for ${fakeYards} — ${success ? "FIRST DOWN!" : "stopped short"}`
                  : `🎩 FAKE PUNT! ${P} throws — INCOMPLETE`,
                startYard,
                endYard: clamp(startYard + (isComp ? fakeYards : 0), 0, 100),
                isFakePunt: true,
                passer: P,
                receiver: tgtName,
                yards: isComp ? fakeYards : 0,
                targetDepth: 10,
              });
              return { yards: isComp ? fakeYards : 0, incomplete: !isComp };
            } else {
              // Punter run on a fake — burst distance (≤15yd), use
              // effectiveSpeed so a heavy punter doesn't burst like a CB.
              const eSpd = effectiveSpeed(pPlayer, 10);
              const fakeMean = 4 + (eSpd - 65) * 0.07 + (pAgi - 65) * 0.05;
              const fakeYards = clamp(Math.round(normal(fakeMean, 4)), -3, 35);
              const success = fakeYards >= this.ytg;
              this._pushVisual({
                kind: "run",
                desc: `🎩 FAKE PUNT! ${P} runs for ${fakeYards} yds — ${success ? "FIRST DOWN!" : "stopped short"}`,
                startYard,
                endYard: clamp(startYard + fakeYards, 0, 100),
                isFakePunt: true,
                rusher: P,
                yards: fakeYards,
              });
              return { yards: fakeYards };
            }
          }
        }
        // Base distance scales with KPW: 60 KPW ≈ 42 yds, 90 KPW ≈ 52 yds
        let puntMean = 38 + (pKpw - 50) * 0.32;
        let puntSd   = 7;
        // Archetype tilts on top of stats
        let fairCatchBonus = 0;     // shifts return distribution toward fair catches
        let bigReturnSuppress = 0;  // shifts away from big returns (hang time)
        let touchbackRisk = 0;      // extra chance the boomer outkicks coverage
        if (pArch === "BOOMER")       { puntMean += 4; puntSd = 8;  touchbackRisk = 0.06; }
        else if (pArch === "DIRECTIONAL") { puntMean -= 3; puntSd = 4;  fairCatchBonus = 0.18; }
        else if (pArch === "HANG_TIME")   { puntMean += 1; puntSd = 5;  bigReturnSuppress = 0.55; fairCatchBonus = 0.08; }
        // AWR over 75 trims SD (more consistent placement)
        if (pAwr > 75) puntSd = Math.max(3, puntSd - (pAwr - 75) * 0.04);
        // BLOCKED PUNT — ~1% baseline, +0.5pp on bad punter (KPW<55), -0.3pp
        // on elite (KPW>85). Defense recovers at the kick spot.
        const blockChance = clamp(0.010 + (60 - pKpw) * 0.0005, 0.005, 0.025);
        if (Math.random() < blockChance) {
          const punterStats = this.stats[this.poss].players[P];
          if (punterStats) punterStats.punt_att = (punterStats.punt_att || 0) + 1;
          // Credit block to a defender. Use defensive starter slot.
          const blocker = this._creditDefStat("blk_kick", { DL: 0.55, LB: 0.30, S: 0.10, CB: 0.05 });
          // 25% chance the block is returned for a TD (it was caught in the
          // air and ran back); otherwise defense takes over at the kick spot.
          const isBlockTD = Math.random() < 0.25;
          const _defSideBlk = this.poss === "home" ? "away" : "home";
          this._swingMomentum(_defSideBlk, isBlockTD ? 4 : 3, "BLOCKED PUNT");
          this._pushVisual({
            kind: "punt",
            desc: isBlockTD
              ? `BLOCKED PUNT returned for a TD by ${blocker || "the defense"}!`
              : `BLOCKED PUNT — recovered by ${blocker || "the defense"} at the spot!`,
            startYard, puntYards: 0, landYard: startYard, returnYards: 0,
            isTouchback: false, isFairCatch: false, isReturnTD: isBlockTD,
            endYard: isBlockTD ? 0 : startYard,
            kicker: P, punterArch: pArch,
            isBlocked: true, blocker,
          });
          // Score the block-TD immediately + kickoff afterward.
          if (isBlockTD) {
            this._defScoreXP();
            return { endDrive: true, isReturnTD: true };
          }
          return { endDrive: true, punt: 0 };
        }
        const punt = clamp(normal(puntMean, puntSd), 24, 72);
      const landYard = clamp(startYard + punt, 0, 100);
      // Touchback / fair catch / return resolution — biased by archetype.
      let returnYards = 0, isTouchback = false, isFairCatch = false, isMuff = false;
      let prBT = 0;
      let muffRecoveredByKicking = false, muffSpotYL = null;
      if (landYard >= 100 || (touchbackRisk > 0 && Math.random() < touchbackRisk)) {
        isTouchback = true;
      } else {
        // MUFF CHECK — returner fails to secure the punt. NFL ~1-2% per punt
        // return. Rate scales with returner CAT (low CAT = bobbles), high
        // punts (harder catch), and weather. Kicking team has ~40% recovery
        // shot.
        const _retSideMuff = this.poss === "home" ? "away" : "home";
        const _retStMuff = (_retSideMuff === "home" ? this.homeR : this.awayR).starters;
        const _muffPRName = _retStMuff.pr1 || _retStMuff.wr2 || _retStMuff.wr1;
        const _muffPR = _muffPRName ? this._playerByName.get(_muffPRName) : null;
        const _retCat = _muffPR?.stats?.[5] ?? 65;
        const _wxLabel = (this.weather || {}).label;
        const _muffWxMod = _wxLabel === "RAIN" ? 0.008 : _wxLabel === "SNOW" ? 0.012 : 0;
        // NFL ~1-2% muff per non-touchback punt. Elite hands (CAT 80+)
        // muff <0.5%; gloves-of-stone returners (CAT 60) muff ~3%.
        const muffChance = clamp(0.014 + (75 - _retCat) / 500 + _muffWxMod, 0.003, 0.035);
        if (Math.random() < muffChance) {
          isMuff = true;
          muffSpotYL = clamp(landYard, 1, 99);
          // Returner credited with a muff (tracked separately from fumble).
          const _retSt = this.stats[_retSideMuff];
          if (_muffPRName && _retSt?.players?.[_muffPRName]) {
            _retSt.players[_muffPRName].muffs = (_retSt.players[_muffPRName].muffs || 0) + 1;
          }
          // ~40% kicking team recovers (gunners closing fast).
          muffRecoveredByKicking = Math.random() < 0.40;
          if (muffRecoveredByKicking) {
            // Coverage team recovers — kicking team gets the ball BACK at the
            // muff spot. From engine state: this.poss = punting team; we
            // double-flip via {turnover:true} so _drive's flip lands us back
            // on punting team at muffSpotYL. Credit the punter's punt stats
            // first (still a recorded punt).
            const punterStats = this.stats[this.poss].players[P];
            if (punterStats) {
              punterStats.punt_att = (punterStats.punt_att || 0) + 1;
              punterStats.punt_yds = (punterStats.punt_yds || 0) + punt;
              if (punt > (punterStats.punt_long || 0)) punterStats.punt_long = punt;
              if (landYard >= 80) punterStats.punts_in_20 = (punterStats.punts_in_20 || 0) + 1;
            }
            // Credit recovery to a gunner / cover guy.
            const recBy = this._creditDefStat("fr", { CB: 0.40, S: 0.30, LB: 0.20, DL: 0.10 });
            this.stats[this.poss].team.takeaways = (this.stats[this.poss].team.takeaways || 0) + 1;
            this._pushVisual({
              kind: "muff",
              desc: `MUFFED PUNT by ${_muffPRName} at the ${muffSpotYL <= 50 ? `own ${muffSpotYL}` : `opp ${100 - muffSpotYL}`} — recovered by ${recBy || "kicking team"}! Kicking team keeps possession.`,
              startYard, landYard, muffSpotYL,
              returner: _muffPRName, recoverer: recBy,
              recoveredByKicking: true,
            });
            // Pre-flip poss so _drive's turnover-flip lands us back on the
            // punting team at the muff spot. (turnover normally hands ball to
            // the team currently on defense; we want punting team to keep it.)
            this.poss = this.poss === "home" ? "away" : "home";
            return { turnover: true, fumbleSpotYL: muffSpotYL };
          } else {
            // Returner falls on it — no return, possession changes normally
            // (punt result), no return yards. Drop through to regular punt
            // flow with returnYards=0 and landYard = muffSpotYL.
            this._pushVisual({
              kind: "muff",
              desc: `${_muffPRName} muffs the punt at the ${muffSpotYL <= 50 ? `own ${muffSpotYL}` : `opp ${100 - muffSpotYL}`} but falls on it — no return.`,
              startYard, landYard, muffSpotYL,
              returner: _muffPRName, recoveredByKicking: false,
            });
          }
        }
      }
      if (!isMuff && !isTouchback) {
        // Resolve the returner's SPD/AGI to bias the bucket distribution
        // (elite returners hit the long-tail more often AND reach further
        // when they do). Without this PR yards are flat across SPD.
        const _prSideBase = this.poss === "home" ? "away" : "home";
        const _prStartersBase = (_prSideBase === "home" ? this.homeR : this.awayR).starters;
        const _prNameBase = _prStartersBase.pr1 || _prStartersBase.wr2 || _prStartersBase.wr1;
        const _prPBase = _prNameBase ? this._playerByName.get(_prNameBase) : null;
        const _prSpd = _prPBase?.stats?.[0] ?? 80;
        const _prAgi = _prPBase?.stats?.[2] ?? 75;
        // Clamp the bucket shift to ±0.06 so a SPD-50 fallback PR doesn't
        // get pushed entirely into fair-catch / short-bucket territory.
        const _prShift = clamp(((_prSpd - 80) + (_prAgi - 75) * 0.5) / 400, -0.06, 0.06);
        // _prMagBoost is the SPD delta for bucket-magnitude additions —
        // floor at -15 so a slow-returner doesn't get negative bucket adds.
        const _prMagBoost = clamp(_prSpd - 80, -15, 25);
        const r = Math.random() - fairCatchBonus - _prShift;
        if (r < 0.18) { isFairCatch = true; }
        else if (r < 0.55) returnYards = rand(0, 6);
        else if (r < 0.85) returnYards = rand(4, 14) + Math.max(0, Math.floor(_prMagBoost / 8));
        else if (r < 0.96) returnYards = rand(12, 28) + Math.max(0, Math.floor(_prMagBoost / 5));
        else                returnYards = rand(30, 70) + Math.max(0, Math.floor(_prMagBoost / 3));
        // Hang-time punters suppress the longest returns.
        if (returnYards >= 20 && Math.random() < bigReturnSuppress) {
          returnYards = rand(4, 14);
        }
        // Returner break-tackle in the coverage lane — elite returners juke
        // gunners and truck overmatched cover guys. Coverage = kicking team
        // (this.poss / offArch). Skip on fair catches and short jugs (≤2).
        if (!isFairCatch && returnYards > 2) {
          const _retSideEarly = this.poss === "home" ? "away" : "home";
          const _retStartersEarly = (_retSideEarly === "home" ? this.homeR : this.awayR).starters;
          const prName = _retStartersEarly.pr1 || _retStartersEarly.wr2 || _retStartersEarly.wr1;
          const pp = prName ? this._playerByName.get(prName) : null;
          if (pp) {
            const br = this._resolveBreakTackle({
              carrierName: prName, yards: returnYards,
              breakStyle: _archetypeBreakStyle(pp.archetype),
              tacklerArchByPos: this.offArch,
              tacklerStatsPlayers: this.offStats?.players,
              tacklerZones: _RETURN_TACKLER_ZONES, gangDist: _RETURN_GANG_DIST,
            });
            if (br.brokenTackles > 0) {
              returnYards += br.bonusYards;
              prBT = br.brokenTackles;
            }
          }
        }
      }
      // Final spot after return (or fixed touchback at receiver's 20)
      const finalLand = isTouchback ? 80 : clamp(landYard - returnYards, 1, 99);
      const effectivePunt = finalLand - startYard;
      // If they brought it all the way back: TD for the receiving team
      const isReturnTD = !isTouchback && finalLand <= 0;
      // Credit punter stats (and team)
      const punterStats = this.stats[this.poss].players[P];
      if (punterStats) {
        punterStats.punt_att = (punterStats.punt_att || 0) + 1;
        punterStats.punt_yds = (punterStats.punt_yds || 0) + punt;
        if (punt > (punterStats.punt_long || 0)) punterStats.punt_long = punt;
        if (isTouchback) punterStats.touchbacks = (punterStats.touchbacks || 0) + 1;
        if (!isTouchback && landYard >= 80) punterStats.punts_in_20 = (punterStats.punts_in_20 || 0) + 1;
      }
      // Credit returner stats (return team's PR1, fall back to wr2)
      const _retSide = this.poss === "home" ? "away" : "home";
      const _retStarters = (_retSide === "home" ? this.homeR : this.awayR).starters;
      const PR = _retStarters.pr1 || _retStarters.wr2 || _retStarters.wr1;
      const prStats = PR ? this.stats[_retSide].players[PR] : null;
      if (!isTouchback && !isFairCatch && prStats) {
        prStats.pr_att = (prStats.pr_att || 0) + 1;
        prStats.pr_yds = (prStats.pr_yds || 0) + returnYards;
        if (returnYards > (prStats.pr_long || 0)) prStats.pr_long = returnYards;
        if (isReturnTD) prStats.pr_td = (prStats.pr_td || 0) + 1;
        if (prBT) prStats.broken_tackles = (prStats.broken_tackles || 0) + prBT;
        // Coverage tackle for the kicking team (= the current offensive
        // side `this.poss` since the punt is on their possession). Skip
        // if the returner walks in untouched for a TD.
        if (!isReturnTD) {
          const kickStarters = (this.poss === "home" ? this.homeR : this.awayR).starters;
          const candidates = [
            kickStarters.cb1, kickStarters.cb2,
            kickStarters.fs, kickStarters.ss,
            kickStarters.lb3, kickStarters.lb2,
          ].filter(Boolean);
          if (candidates.length) {
            const tackler = candidates[Math.floor(Math.random() * candidates.length)];
            const ts = this.stats[this.poss].players[tackler];
            if (ts) ts.tkl = (ts.tkl || 0) + 1;
          }
        }
      }
      this._pushVisual({
        kind: "punt",
        desc: isTouchback ? `${this.possTeam.name} punts ${punt} yds — touchback`
            : isFairCatch ? `${this.possTeam.name} punts ${punt} yds — fair catch`
            : returnYards > 20 ? `${this.possTeam.name} punt RETURNED ${returnYards} yds!`
            : `${this.possTeam.name} punts ${punt} yds, returned ${returnYards}`,
        startYard, puntYards: punt, landYard, returnYards,
        isTouchback, isFairCatch, isReturnTD,
        endYard: finalLand,
        kicker: P,
        returner: PR,
        punterArch: pArch,
        motion: { result: isTouchback ? "touchback" : isFairCatch ? "fairCatch" : "returned",
                  contactT: 0.20, landT: 0.55 },
      });
        return { endDrive: true, punt: effectivePunt, isReturnTD };
      }
      // (falls through to a regular play below when action === "go")
    }
    const isLong = this.ytg >= 8, isShort = this.ytg <= 2;
    const pb = this.offPlaybook;
    let passProb = isLong ? pb.passProb.long : isShort ? pb.passProb.short : pb.passProb.mid;
    if (inTwoMin) passProb = Math.min(0.96, passProb + 0.25);   // hurry-up = pass-heavy
    // OC personality bias — each OC trait pushes pass/run rate. Air
    // Attack throws everywhere; Trench General / Run Architect lean run;
    // QB Whisperer slightly pass; Red Zone Genius slightly run.
    const offTid = this.poss === "home" ? this.home.id : this.away.id;
    const ocBiasTrait = (typeof franchise !== "undefined") ? franchise.coaches?.[offTid]?.oc?.trait : null;
    // Per-trait magnitudes halved from the fantasy-football tier (+/-0.10) to NFL-
    // realistic (+/-0.05). Real coach effect on pass rate is ~4-6pp at the extreme
    // (most coaches sit within a couple points of league mean even in their preferred
    // direction). With the per-trait magnitudes at the old values, even my OC+HC
    // ±0.07 stack cap was being hit by Air Attack alone — leaving HC bias structurally
    // bounded but Air Attack still pushed close to a full +7pp from base.
    const ocPassBias = ocBiasTrait === "Air Attack"      ?  0.05
                     : ocBiasTrait === "QB Whisperer"   ?  0.03
                     : ocBiasTrait === "Red Zone Genius" ? -0.03
                     : ocBiasTrait === "Run Architect"   ? -0.04
                     : ocBiasTrait === "Trench General"  ? -0.05
                     :                                       0;
    // HC personality also tilts — Riverboat Gambler more pass (he wants
    // chunk plays), Conservative more run (clock-bleed).
    const hcStyleTrait = (typeof franchise !== "undefined") ? franchise.coaches?.[offTid]?.hc?.specialtyTrait : null;
    const hcPassBias = hcStyleTrait === "Riverboat Gambler" ?  0.04
                     : hcStyleTrait === "Conservative"      ? -0.05
                     :                                          0;
    // OC and HC bias used to apply ADDITIVELY uncapped (Air Attack OC +0.10 plus
    // Riverboat HC +0.04 = +0.14 stacked, on a pass-heavy 0.61 playbook → ~0.75
    // mid-down pass rate, then game-plan delta could push it higher still). NFL's
    // pass-heaviest teams sit at 0.65-0.68 on neutral downs, so the stack was
    // letting fantasy Air-Attack offenses past realism — Brady-audit top QB
    // seasons compounded to 6000+ yards (NFL all-time record 5,477). Cap the
    // OC+HC combined deviation at ±0.07 so scheme stacking can't drive a team
    // past the NFL ceiling. Game-plan delta still applies separately below.
    const _coachBiasStack = clamp(ocPassBias + hcPassBias, -0.07, 0.07);
    if (_coachBiasStack) passProb = clamp(passProb + _coachBiasStack, 0.10, 0.95);
    // Weekly game plan tilt — head coach has scouted the opponent and
    // dialed up pass or run accordingly. Stamped on the sim by frnSimOnce.
    const wgp = this.poss === "home" ? this.homeWgp : this.awayWgp;
    if (wgp?.passProbDelta) passProb = clamp(passProb + wgp.passProbDelta, 0.10, 0.95);
    // LEADING-TEAM CLOCK BLEED. NFL teams pivot to the ground game in the 4Q
    // when leading, draining clock instead of risking a turnover. Without this,
    // an elite QB on a winning team kept passing in 4Q "garbage time" and his
    // season totals inflated past NFL elite ceilings. The existing two-minute
    // drill drives TRAILING teams to throw; this is the symmetric mirror.
    // Tiered by lead size and time-of-quarter — a 3-score Q4 lead is basically
    // kneel/run only, while a 1-score lead just tilts modestly.
    if (this.quarter === 4 && this.time < 900) {  // last 15 min of Q4
      const _lead = this.poss === "home"
        ? this.score.home - this.score.away
        : this.score.away - this.score.home;
      if (_lead >= 21)      passProb = clamp(passProb - 0.30, 0.10, 0.95); // blowout — kneel/run
      else if (_lead >= 14) passProb = clamp(passProb - 0.20, 0.10, 0.95); // 2-score lead
      else if (_lead >= 8)  passProb = clamp(passProb - 0.14, 0.10, 0.95); // 1-score lead
      else if (_lead >= 1)  passProb = clamp(passProb - 0.06, 0.10, 0.95); // any lead — modest tilt
    }
    // Goal-to-go bias toward the run — NFL calls ~60% rush inside the 10.
    // Engine still rolled close to 50/50 (default mid passProb), so we shed
    // ~12pp of pass to bring rush TDs back near NFL pace.
    if (this._inGoalToGo) passProb = Math.max(0.20, passProb - 0.12);
    else if (this._inRedZone) passProb = Math.max(0.25, passProb - 0.06);
    const playType = Math.random() < passProb ? "pass" : "run";

    // ── PENALTY ROLL ──
    // NFL averages ~12 accepted penalties per game (~6/team) at ~9%/play.
    // Per-type base rates live in _PENALTY_RATES; this block applies
    // situational modifiers (down/dist, field zone, score state, home/
    // road) and a QB-cadence multiplier on cadence-sensitive penalties
    // (def offsides / NZI / encroachment). Cumulative thresholds are
    // rebuilt every play so context can shift the distribution.
    //
    // Player attribution is handled by _pickPenaltyOffender after the
    // type is selected.
    {
      // Situation context for modifiers.
      const _isThird   = this.down === 3;
      const _isFourth  = this.down === 4;
      const _isShort   = (this.ytg || 10) <= 3;
      const _isLong    = (this.ytg || 10) >= 7;
      const _isRedZone = this.yardLine >= 80;
      const _isRoadOff = this.poss !== "home";
      const _trailingQ4 = this.quarter === 4 && (
        this.poss === "home" ? this.score.home < this.score.away
                             : this.score.away < this.score.home
      );
      // QB cadence — high-AWR QBs draw more pre-snap defensive flags.
      // Rodgers / Mahomes archetype: AWR 92+ → ~1.2x cadence multiplier.
      const _qbName  = this.offR?.starters?.qb;
      const _qbObj   = _qbName ? this._playerByName.get(_qbName) : null;
      const _qbAwr   = _qbObj?.stats?.[3] ?? 70;
      const _cadence = clamp(1 + (_qbAwr - 75) / 75, 0.7, 1.35);
      const _penMod = (type) => {
        let m = 1.0;
        if (type === "False Start") {
          if (_isRoadOff) m *= 1.15;
          if ((_isThird || _isFourth) && _isShort) m *= 1.40;
        } else if (type === "Defensive Offsides" || type === "Neutral Zone Infraction" || type === "Encroachment") {
          m *= _cadence;
          if ((_isThird || _isFourth) && _isShort) m *= 1.60;
        } else if (type === "Pass Interference (D)") {
          if (_isThird && _isLong) m *= 1.50;
          if (_isRedZone) m *= 1.30;
          if (_trailingQ4) m *= 1.20;
        } else if (type === "Holding (Defense)") {
          if (_isThird && _isLong) m *= 1.20;
          if (_isRedZone) m *= 1.15;
        } else if (type === "Illegal Contact") {
          if (_isThird && _isLong) m *= 1.15;
        } else if (type === "Holding (Offense)") {
          // OL holds more when the pass rush wins fast — proxy via 3rd-and-long.
          // Compressed RZ splits make OL hold longer to seal blocks.
          if (_isThird && _isLong) m *= 1.30;
          if (_isRedZone) m *= 1.25;
        } else if (type === "Pass Interference (O)") {
          // Tight RZ coverage forces push-offs / pick plays.
          if (_isRedZone) m *= 1.40;
        } else if (type === "Illegal Use of Hands (O)") {
          if (_isRedZone) m *= 1.20;
        } else if (type === "Roughing the Passer") {
          if (_trailingQ4) m *= 1.10;  // defense pinning ears back
        } else if (type === "Delay of Game") {
          // Pocket-statue QBs run the clock down more often.
          if (_qbAwr < 70) m *= 1.20;
        } else if (type === "Intentional Grounding") {
          // Low-AWR / non-mobile QBs more likely to ground; engine doesn't
          // expose mobility directly so use AWR as a noisy proxy.
          if (_qbAwr < 70) m *= 1.40;
        }
        // Clutch DISCIPLINE: under late-and-close pressure (loud crowd, high
        // stakes) a low-composure unit jumps the snap / false-starts more; a
        // composed unit holds. Pre-snap discipline penalties ONLY — post-snap
        // holding/DPI are technique, not nerves. Sample a representative
        // offender from the responsible unit and tilt the rate by their clutch.
        if (this._isLateClose() &&
            (type === "False Start" || type === "Delay of Game" ||
             type === "Defensive Offsides" || type === "Neutral Zone Infraction" ||
             type === "Encroachment")) {
          const cand = this._pickPenaltyOffender(_PENALTY_POSITIONS[type], _PENALTY_RATES[type].on);
          m *= clamp(1 - this._clutchMod(cand, 0.5), 0.5, 1.6);
        }
        return m;
      };
      // Build cumulative thresholds.
      const _penRoll = [];
      let _cum = 0;
      for (const [type, def] of Object.entries(_PENALTY_RATES)) {
        if (def.when === "pass" && playType !== "pass") continue;
        const rate = def.rate * _penMod(type);
        _cum += rate;
        _penRoll.push({ type, def, cum: _cum });
      }
      const penR = Math.random();
      let pen = null;
      for (const t of _penRoll) {
        if (penR < t.cum) {
          pen = {
            type: t.type, on: t.def.on, yds: t.def.yds,
            autoFirst: t.def.autoFirst, lossDown: t.def.lossDown,
          };
          break;
        }
      }
      // DPI is a SPOT foul, not a flat 15-yarder. NFL distribution
      // (May 2026 research): median 11, mean 17, ~47% are 15+ yds,
      // P90 30+ yds, deep-ball fouls reach 50-60. Cap so the ball
      // never goes past the 1-yard line (NFL: DPI in end zone = ball
      // at the 1, not -1).
      //
      // Deep DPIs (30+ yds) only occur on plays with a deep route —
      // there's no way to draw a 50-yd DPI on a screen pass because no
      // deep route exists. Gate the deep bucket on context: RZ → never
      // deep, 3rd-and-long / trailing-Q4 / GUNSLINGER+DEEP_THROWER QBs
      // allow deep, everything else compresses into mid-range.
      if (pen && pen.type === "Pass Interference (D)") {
        const _qbArch = _qbObj?.archetype || "BALANCED";
        const _deepEligible =
             !_isRedZone
          && (_isLong || _trailingQ4 || _qbArch === "GUNSLINGER" || _qbArch === "DEEP_THROWER" || _qbArch === "GUNSLINGER_VET");
        const dpiR = Math.random();
        let dpiYds;
        if      (dpiR < 0.40) dpiYds = rand(4, 10);                                    // underneath / hold
        else if (dpiR < 0.72) dpiYds = rand(10, 20);                                   // intermediate
        else if (dpiR < 0.92) dpiYds = _deepEligible ? rand(20, 35) : rand(10, 22);    // downfield → compressed if no deep route
        else                  dpiYds = _deepEligible ? rand(35, 60) : rand(15, 28);    // deep ball → compressed if no deep route
        const _distToGL = 100 - this.yardLine;
        pen.yds = Math.max(3, Math.min(dpiYds, _distToGL - 1));
      }
      if (pen) {
        // Capture PRE-penalty situation so audits can correlate penalty
        // type to the down/ytg/zone where the flag was thrown (otherwise
        // auto-first / loss-of-down branches mask the original context).
        const _preDown     = this.down;
        const _preYtg      = this.ytg;
        const _preYardLine = this.yardLine;
        const flaggedKey = pen.on === "off" ? this.poss : (this.poss === "home" ? "away" : "home");
        // Tag the specific player who committed the foul — biased by NFL
        // position attribution and modulated by the player's AWR.
        const offender = this._pickPenaltyOffender(_PENALTY_POSITIONS[pen.type], pen.on);
        // Bundle everything needed to either apply or push as visual later.
        pen._meta = {
          flaggedKey, offender,
          preDown: _preDown, preYtg: _preYtg, preYardLine: _preYardLine,
        };
        // Dead-ball penalties (False Start, DOG, NZI, Encroachment, etc.)
        // kill the play — no snap, no accept/decline. Apply immediately
        // and return as before.
        if (_DEAD_BALL_PENALTIES.has(pen.type)) {
          this._applyPenaltyEffects(pen);
          return { yards: 0, incomplete: false, isPenalty: true };
        }
        // Live-ball penalty: snapshot state, stash the pen, let the play
        // body execute. Outer _play() wrapper picks accept/decline once
        // the actual outcome is known.
        this._pendingLivePen = pen;
        this._penSnapshot = this._snapshotForPenalty();
        // Fall through — play body continues normally.
      }
    }

    // Count the play AFTER the penalty roll — a flagged pre-snap penalty
    // is officially "no play" in NFL stats (doesn't count as a play or
    // a 3rd-down attempt). Replays of 3rd-down with multiple flags also
    // should only count one attempt when the down eventually completes.
    off.team.plays++;
    if (isThird) off.team.thirdAtt++;

    // ── VICTORY FORMATION / KNEEL-DOWN ──
    // Winning team in Q4 kneels to run out the clock when the math
    // works. Each kneel burns ~40s of play clock + ~5s for the snap.
    // Opponent timeouts cost ~30s each (forces a quicker snap). The
    // offense has (5 - this.down) downs remaining; if time_left fits
    // within those kneels minus opponent timeout burn, victory.
    {
      const oppKey = this.poss === "home" ? "away" : "home";
      const lead = this.score[this.poss] - this.score[oppKey];
      const oppTimeouts = this.timeouts[oppKey] || 0;
      const remainingDowns = 5 - this.down;  // 1st = 4 downs available, 4th = 1
      const kneelMargin = remainingDowns * 40 - oppTimeouts * 30;
      const canKneelOut = lead > 0
        && this.quarter === 4
        && this.time <= kneelMargin
        && this.time > 0;
      if (canKneelOut) {
        const qbStats = off.players[QB];
        if (qbStats) qbStats.rush_att++;
        off.team.rush_att++;
        // Time math: the snap-to-snap dt was already deducted at the top
        // of _play. Adjust so the kneel burns exactly ~40s NET (real
        // play clock + the kneel itself), not 40s on top of the regular
        // 12-55s dt. Previous version double-burned clock.
        const intendedKneelTime = 40;
        this.time = Math.max(0, this.time + dt - intendedKneelTime);
        // Safety guard — a kneel at own 1 would trigger the safety
        // detection in _drive (yards: -1 → proposedYL <= 0). Clamp the
        // loss so the ball never crosses the goal line.
        const yardLoss = Math.min(1, startYard - 1);  // 0 if at the 1, else 1
        // NFL credits kneels as rushing — qbStats.rush_yds takes the loss.
        if (qbStats) qbStats.rush_yds = (qbStats.rush_yds || 0) - yardLoss;
        off.team.rushYds = (off.team.rushYds || 0) - yardLoss;
        this._pushVisual({
          kind: "kneel",
          desc: `${QB} takes a knee — victory formation`,
          startYard, endYard: Math.max(1, startYard - yardLoss),
          passer: QB,
        });
        return { yards: -yardLoss };
      }
    }

    // ── QB SPIKE ──
    // Burn a down to stop the clock when it makes sense. Conditions:
    //   • <30s left in Q2/Q4, but >3s (don't spike with the gun about to fire)
    //   • Down 1 or 2 — never spike on 3rd (waste a play that could convert)
    //     or 4th (turnover on downs)
    //   • Out of timeouts (otherwise call a timeout instead)
    //   • Q2: in FG range — spike to set up a halftime field goal
    //   • Q4: trailing or tied — need to score
    {
      const oppKey = this.poss === "home" ? "away" : "home";
      const trailingOrTied = this.score[this.poss] <= this.score[oppKey];
      const myTimeouts = this.timeouts[this.poss];
      const inFGRange = this.yardLine >= 58;                 // ~60+ yds to score → make-able FG
      const canSpike = this.time <= 30 && this.time > 3
                    && this.down <= 2
                    && myTimeouts === 0
                    && (
                      (this.quarter === 2 && inFGRange) ||
                      (this.quarter === 4 && trailingOrTied)
                    );
      if (canSpike && Math.random() < 0.65) {
        const qbStats = off.players[QB];
        if (qbStats) qbStats.pass_att++;
        off.team.pass_att++;
        // Spike takes ~3 seconds total — restore most of dt we already
        // deducted (since the spike is a no-huddle quick play, not a full
        // snap-clock-out play).
        const spikeTime = 3;
        this.time += Math.max(0, dt - spikeTime);
        this._pushVisual({
          kind: "spike",
          desc: `${QB} spikes the ball to stop the clock`,
          startYard, endYard: startYard,
          passer: QB,
        });
        return { yards: 0, incomplete: true };
      }
    }

    if (playType === "pass") {
      const qbStats = off.players[QB];
      const qbArch = this.offArch.QB?.archetype;
      const qbPlayer = this._playerByName.get(QB);
      const qbAwr = qbPlayer?.stats?.[3] ?? 70;
      const qbAgi = qbPlayer?.stats?.[2] ?? 65;
      const qbThr = qbPlayer?.stats?.[4] ?? 75;
      // Coverage-aware target mix — QB attacks weak CBs, avoids elite ones.
      // QB archetype scales how much they care: GUNSLINGER force-feeds
      // their #1 regardless (Favre, Rodgers, Mahomes — pays in INTs);
      // FIELD_GENERAL reads matchups better than average; DUAL_THREAT
      // partial avoidance (playmaker mode); POCKET / GAME_MANAGER default.
      const cbArr = this.defArch.CB || [];
      const cb1Arch = cbArr[0]?.archetype, cb2Arch = cbArr[1]?.archetype;
      const slotCbArch = cbArr.find(c => c?.archetype === "SLOT_CB")?.archetype;
      const avoidFor = a => a === "SHUTDOWN"  ? 0.55
                          : a === "PHYSICAL"  ? 0.78
                          : a === "BALL_HAWK" ? 0.88
                          : 1.00;
      const qbAvoidMul = qbArch === "GUNSLINGER"   ? 0.20
                       : qbArch === "FIELD_GENERAL" ? 1.30
                       : qbArch === "DUAL_THREAT"   ? 0.70
                       : 1.00;
      // Blend each avoidance factor toward 1.0 by qbAvoidMul: a low mul
      // collapses the avoid toward 1.0 (no avoidance); a high mul amplifies.
      const blendAvoid = a => 1 - (1 - a) * qbAvoidMul;
      const cbCoverageMix = {
        wr1: blendAvoid(avoidFor(cb1Arch)),
        wr2: blendAvoid(avoidFor(cb2Arch)),
        wr3: blendAvoid(avoidFor(slotCbArch)),
      };
      // QB archetype effects on the dropback
      // GUNSLINGER: more INTs, deeper throws, less accurate
      // GAME_MANAGER: fewer INTs, shorter throws, more accurate
      // POCKET: slightly more accurate
      // FIELD_GENERAL: fewer INTs, slightly more accurate
      // DUAL_THREAT: bonus scramble rate (added on top of playbook)
      // archPressureMul: per-snap multiplier on pressure-driven scrambles.
      // POCKET QBs take the sack instead of bailing; DUAL_THREAT bails early.
      let qbCompMod = 0, qbIntMod = 0, qbAirMod = 0, qbScrambleBonus = 0, qbBigPlayBonus = 0;
      let archPressureMul = 0.03;
      switch (qbArch) {
        case "POCKET":        qbCompMod = +0.025; qbIntMod = -0.012; qbAirMod = -0.3; qbScrambleBonus = -0.03; archPressureMul = 0.01; break;
        case "GUNSLINGER":    qbCompMod = -0.040; qbIntMod = +0.028; qbAirMod = +1.5; qbBigPlayBonus = 0.10; qbScrambleBonus = -0.02; archPressureMul = 0.02; break;
        case "GAME_MANAGER":  qbCompMod = +0.040; qbIntMod = -0.012; qbAirMod = -1.4; archPressureMul = 0.04; break;
        case "FIELD_GENERAL": qbCompMod = +0.020; qbIntMod = -0.015; archPressureMul = 0.04; break;
        case "DUAL_THREAT":   qbScrambleBonus = 0.04; archPressureMul = 0.10; break;
      }
      // PLAY-ACTION — fakes the handoff to freeze LBs/safeties. Effectiveness
      // scales with the offense's run-game threat (defense has to respect it)
      // and the QB's AWR/THR (sells the fake). Costs a longer dropback → +sack risk.
      let paCompMod = 0, paAirMod = 0, paSackMul = 1.0;
      const runThreat = clamp((this.offR.rb - 65) / 35, 0, 1);   // 0-1 based on RB room
      const paQbSkill = clamp((qbAwr + qbThr - 140) / 80, 0, 1); // 0-1 based on QB
      const paBaseRate = 0.16 + runThreat * 0.10 - (isThird && this.ytg >= 7 ? 0.10 : 0);
      const isPlayAction = !isShort && Math.random() < paBaseRate;
      // FLEA FLICKER — rare trick play, only on PA setups in good run threat.
      // RB takes the fake handoff, then pitches the ball BACK to the QB who
      // throws deep. Big play upside, big-time risk if it breaks down.
      const isFleaFlicker = isPlayAction && runThreat > 0.35 && (this.ytg >= 6 || !isThird) && Math.random() < 0.06;
      if (isPlayAction) {
        paCompMod = 0.025 + paQbSkill * 0.030;     // up to +5.5% comp
        paAirMod  = 1.5  + paQbSkill * 2.5 + runThreat * 1.5;  // up to +5 air yds
        paSackMul = 1.25;                           // longer dropback → more sacks
      }
      if (isFleaFlicker) {
        // Flea flicker forces a deeper target + bigger sack risk
        paAirMod  += 4.0;
        paSackMul *= 1.35;
      }
      // QB SCRAMBLE — pre-throw bail. Pressure response is archetype-gated
      // (Brady takes the sack at archPressureMul 0.01; Lamar bails at 0.10).
      const pressureScrBonus = Math.max(0, pressure) * archPressureMul;
      const scramblePct = (pb.qbScramblePct || 0) + qbScrambleBonus + pressureScrBonus;
      if (scramblePct > 0 && Math.random() < scramblePct) {
        const lbTk = (this.defR.lb - 65) / 25;
        const qbPlayer = this._playerByName.get(QB);
        // Floor the burst penalty: when a slow QB *chooses* to scramble, it's
        // because he sees a lane. Brady-tier shouldn't average -0.75 yds.
        const qbBurst = Math.max(-0.3, (effectiveSpeed(qbPlayer, 12) - 70) * 0.05);
        // Base 4.5: intentional-scramble bonus — the QB only takes off when
        // he's already calculated +EV. Even immobile QBs net ~4 yds when
        // they tuck and run.
        let yards = clamp(normal(4.5 + adv * 1.5 + Math.max(0, pressure) * 0.6 - lbTk + qbBurst, 6.5), -4, 50);
        // Lean forward — Josh Allen / Cam Newton fall forward for an extra
        // half-yard on every scramble. Lamar (lean DUAL_THREAT) slides.
        if (yards > 0) {
          const qbLean = this._leanForwardYds(QB, _archetypeBreakStyle(qbArch));
          if (qbLean > 0) yards = Math.round(yards + qbLean);
        }
        if (yards > 0) yards = Math.min(yards, 100 - startYard);
        // QB scramble break-tackle — Lamar / Cam-tier QBs juke or truck pursuers.
        let qbBT = 0;
        if (yards > 0) {
          const br = this._resolveBreakTackle({
            carrierName: QB, yards,
            breakStyle: _archetypeBreakStyle(qbArch),
            tacklerArchByPos: this.defArch,
            tacklerStatsPlayers: this.defStats?.players,
          });
          if (br.brokenTackles > 0) {
            yards = Math.min(yards + br.bonusYards, 100 - startYard);
            qbBT = br.brokenTackles;
          }
        }
        if (qbStats) {
          qbStats.rush_att = (qbStats.rush_att || 0) + 1;
          qbStats.rush_yds = (qbStats.rush_yds || 0) + yards;
          if (yards > (qbStats.rush_long || 0)) qbStats.rush_long = yards;
          if (qbBT) qbStats.broken_tackles = (qbStats.broken_tackles || 0) + qbBT;
        }
        off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
        this._lastBallCarrier = QB; this._lastBallType = "rush";
        this._pushVisual({
          kind: "run", desc: `${QB} scrambles for ${yards} yds`,
          startYard, yards, endYard: clamp(startYard + yards, 0, 100),
          rusher: QB, isScramble: true
        });
        return { yards };
      }
      // Ball-hawk DBs add to the INT chance; shutdown corners suppress passing entirely
      const defArch = this.defArch;
      const ballHawkBonus =
        ((defArch.CB || []).filter(c => c?.archetype === "BALL_HAWK").length * 0.010) +
        ((defArch.S  || []).filter(s => s?.archetype === "BALL_HAWK").length * 0.012);
      // Pressured QBs throw more INTs (rushed/forced throws). QB archetype tilts this too.
      // Bad QBs (low OVR) make poor reads → significantly more INTs.
      const qbIntFromOvr = (75 - this.offR.qb) / 800;  // QB 60 → +0.019, QB 90 → -0.019
      // Defensive backs matter — but the modifiers HALVED below were
      // previously stacking to a 20% per-attempt INT cap, yielding ~5%
      // league INT rate (real NFL is ~2.5%). Median career INT-made
      // for top-20 DBs was 1.3/g, way over NFL leader 0.82/g.
      // INDIVIDUAL COVER — the INT roll fires before the target is known,
      // but a pick is driven by whoever's actually IN COVERAGE jumping the
      // route. Use the COV of the on-field cover corners (cb1/cb2 always,
      // cb3 in nickel+) instead of the team `defR.cb` aggregate, so a unit
      // with one elite ball-hawk corner forces more picks than its team OVR
      // implies. Weighted toward the corners (most picks come from CBs).
      // Weighted cover average: cb1/cb2 face the bulk of pass volume (top WRs
      // are the high-leverage targets), so weight them 1.0 and cb3 (nickel)
      // at 0.5 — averaging them equally dragged the league INT rate down
      // since cb3 is typically rated 5-8 below cb1/cb2.
      const _wr = (PERSONNEL[this._currentPersonnel]?.wr) ?? 2;
      const _intCBSlots = [
        { name: this.defR.starters.cb1, w: 1.0 },
        { name: this.defR.starters.cb2, w: 1.0 },
      ];
      if (_wr >= 3) _intCBSlots.push({ name: this.defR.starters.cb3, w: 0.5 });
      // Dedupe by NAME — on a thin roster cb3 falls back to cb2's/cb1's name;
      // counting that player twice would skew the average.
      const _seenCB = new Set();
      let _covNum = 0, _covDen = 0;
      for (const { name, w } of _intCBSlots) {
        if (!name || _seenCB.has(name)) continue;
        _seenCB.add(name);
        const p = this._playerByName?.get?.(name);
        if (!p) continue;
        _covNum += (p.stats?.[8] || 65) * w;
        _covDen += w;
      }
      let defIntMod;
      if (_covDen > 0) {
        const _avgCBCov = _covNum / _covDen;
        defIntMod = (_avgCBCov - 65) / 1400;
      } else {
        defIntMod = (this.defR.cb - 65) / 1400;        // fallback to team rating
      }
      const safIntNames = [this.defR.starters.fs, this.defR.starters.ss];
      const safIntPlayers = safIntNames.map(n => this._playerByName?.get?.(n)).filter(Boolean);
      if (safIntPlayers.length) {
        const avgSafCov = safIntPlayers.reduce((s,p) => s + (p.stats?.[8] || 65), 0) / safIntPlayers.length;
        defIntMod += (avgSafCov - 65) / 2200;            // halved from /1100
      }
      const qbAggIntMod = (this._aggTilt(this._qbAggression()) - 1) * 0.008;
      const dcBallHawkMul  = _dcTrait  === "Ball Hawk"    ? 1.025 : 1.0;
      const hcGameMgrIntMul= _hcSpec   === "Game Manager" ? 0.88  : 1.0;
      const boxStackIntMod = this._boxStackIntMod || 0;
      // INT base + clamp tuned against the headless audit (_sim_audit.js).
      // Baseline measured ~1.4% (base 0.010) vs the ~2.5% NFL target. Three
      // headwinds were eating the nominal base bump: (a) multipliers average
      // ~0.92 (Game Manager HC 0.88×, etc.), (b) qbIntFromOvr = (75-qbOvr)/800
      // pushes negative since STARTING QBs systematically score above 75, and
      // (c) the upper clamp of 0.030 truncated the high-pressure tail (real
      // NFL turnover-fest games hit 4%+ per attempt). Lifted the clamp to
      // 0.045 to keep the tail and bumped the base to 0.040 so the average
      // lands in the 2.0-3.0% NFL band.
      // Clutch decision-making: ice-veins QBs protect the ball late (fewer
      // forced throws/picks), folders press and turn it over. Subtract the
      // signed clutch mod so composure (>0) lowers INT% and choke (<0) raises it.
      // Base INT rate CUT (0.040 → 0.030): the old flat ~4% hit EVERY throw
      // depth-blind, the reason multi-INT games ran ~28% (NFL 8-14%). In its
      // place, ARM STRENGTH drives picks — a weak arm can't drive the deep ball,
      // so it gets underthrown and undercut by the trailing defender. This
      // concentrates INTs on realistic arm/depth situations instead of uniform
      // random, and pulls the total down toward NFL.
      const _weakArmIntRisk = Math.max(0, 78 - qbThr) * 0.0010;   // THR 60 → +1.8pp, THR 78+ → 0
      // Base 0.012 → 0.010 (was 0.009, slightly over-corrected). Sim-audit:
      // at 0.009, INT rate/att fell to 1.77% (band 1.80-3.40%, just under),
      // turnovers/g 0.84 (band 0.90-2.10, under), multi-INT 14.6% (band 8-14,
      // at upper edge). 0.010 should land all three cleanly in band — about
      // ~0.72 INT/g, multi-INT ~13%, turnovers~0.9-1.0/g.
      const intPct = clamp((0.010 - adv * 0.008 + defIntMod + pressure * 0.006 + ballHawkBonus + qbIntMod + qbIntFromOvr + qbAggIntMod + boxStackIntMod + _weakArmIntRisk - this._clutchMod(this.offR.starters.qb, 0.012)) * dcBallHawkMul * hcGameMgrIntMul, 0.002, 0.05);
      if (Math.random() < intPct) {
        const targetDepth = clamp(normal(11, 7), 2, 35);
        // Sample the defender who'd be in position to pick. CAT-based drop
        // check: NFL DBs drop ~25-30% of potential picks; ball hawks ~15%,
        // bad-hands DBs ~40%+. If dropped, becomes a PD instead.
        const wouldCatch = this._creditDBStat("int_made", { CB: 0.55, S: 0.35, LB: 0.10 });
        if (wouldCatch) {
          const catchPlayer = this._playerByName.get(wouldCatch);
          const dbCat = catchPlayer?.stats?.[5] ?? 50;
          // Clutch (defense): a composed DB squeezes the game-sealing pick;
          // a folder lets it slip. Hands/concentration only — mirrors WR
          // catching, never physical. Subtract so composure lowers the drop.
          const dropChance = clamp(0.55 - (dbCat - 50) * 0.012 - this._clutchMod(wouldCatch, 0.10), 0.05, 0.50);
          if (Math.random() < dropChance) {
            // Dropped pick — undo INT credit, give PD instead, treat as incomplete
            if (def.players[wouldCatch]) {
              def.players[wouldCatch].int_made = Math.max(0, (def.players[wouldCatch].int_made || 0) - 1);
              def.players[wouldCatch].pd = (def.players[wouldCatch].pd || 0) + 1;
            }
            if (qbStats) qbStats.pass_att++;
            off.team.pass_att++;
            this._pushVisual({
              kind: "incomplete",
              desc: `${QB}'s pass nearly intercepted — ${wouldCatch} dropped it!`,
              startYard, endYard: startYard, passer: QB, dropper: wouldCatch,
              isDroppedPick: true,
            });
            return { yards: 0, incomplete: true };
          }
        }
        if (qbStats) { qbStats.pass_att++; qbStats.pass_int++; }
        off.team.pass_att++; off.team.turnovers++;
        def.team.takeaways++;
        // Credit INT to a DB (CB or S) — already sampled via wouldCatch above
        const intBy = wouldCatch;
        // Interception return yardage — bursty distribution. Most are
        // short (0-5), some medium (6-15), occasional house-call (16-50+).
        const retSeed = Math.random();
        let retYds;
        if (retSeed < 0.45)      retYds = Math.floor(Math.random() * 4);            // 0-3
        else if (retSeed < 0.80) retYds = 4 + Math.floor(Math.random() * 9);         // 4-12
        else if (retSeed < 0.96) retYds = 13 + Math.floor(Math.random() * 18);       // 13-30
        else                      retYds = 30 + Math.floor(Math.random() * 50);       // 30-80 (rare big one)
        // INT spot — approximately where the ball gets picked. Allowed to
        // exceed 100 so we can detect end-zone catches (touchbacks).
        const intSpotYL = clamp(startYard + Math.round(targetDepth / 2), 1, 110);
        // TOUCHBACK — defender picks the ball IN the end zone (intSpotYL ≥ 100)
        // and either kneels or gets tackled before breaking it out (retYds<5).
        // Ball moves to the new offense's 20-yard-line.
        const isTouchback = intSpotYL >= 100 && retYds < 5;
        // Pick-six — the defender runs BACK toward yard 0 (the offense's
        // own end zone, which is the defender's scoring end zone), so the
        // distance they have to cover equals the INT spot's yard line.
        // Earlier the gate was 100 - intSpotYL, the distance FORWARD to the
        // OFFENSE's end zone — backwards from the defender's path — which
        // made any throw into the end zone an instant pick-six.
        const isPickSix = !isTouchback && retYds >= intSpotYL;
        const finalRetYds = isPickSix ? intSpotYL : (isTouchback ? 0 : retYds);
        // Credit return yards to the picking defender
        if (intBy) {
          const intDef = def.players[intBy];
          if (intDef) {
            intDef.int_yds = (intDef.int_yds || 0) + finalRetYds;
            if (finalRetYds > (intDef.int_long || 0)) intDef.int_long = finalRetYds;
            if (isPickSix) { intDef.int_td = (intDef.int_td || 0) + 1; intDef.def_td = (intDef.def_td || 0) + 1; }
          }
        }
        if (isPickSix) {
          this.score[this.poss === "home" ? "away" : "home"] += 6;
          def.team.def_td = (def.team.def_td || 0) + 1;
        }
        // PATH B motion intent for INT plays. Engine knows the
        // intercepter's role (CB / S based on coverage assignment),
        // return distance, whether it's a pick-six. Animation renders
        // it. Same schema as run-play fumble motion.
        // PATH B Phase 6 — INT zone drops. (Receiver routes skipped
        // here because rcvr/targetSlot isn't picked in this branch;
        // animation handles WR run-toward-the-ball during the pick.)
        const _intScaledMs = Math.max(2200, Math.min(11500, Math.abs(Math.max(targetDepth, 8)) / 12 * 1000 + 1000));
        const _intPostCatchMs = 1500;
        const _intActionMs = _intScaledMs + _intPostCatchMs;
        const _intThrowT = _intScaledMs / _intActionMs;
        const _intDefSlot = this._resolveDefSlot(intBy);
        const _intZoneDrops = this._buildPassZoneDrops({ tacklerSlot: _intDefSlot, throwT: _intThrowT, coverage: this._lastPassCoverage });
        const _intMotion = {
          intercepterRole: (intBy && this.defR && this.defR.starters)
            ? (intBy === this.defR.starters.cb1 || intBy === this.defR.starters.cb2 ? "CB"
              : intBy === this.defR.starters.s1 || intBy === this.defR.starters.s2  ? "S"
              : intBy === this.defR.starters.nb                                      ? "NB"
              :                                                                       "LB")
            : "CB",
          interceptT: 0.55,         // catch fraction of action
          returnYds:  finalRetYds,
          isPickSix:  isPickSix,
          isTouchback: isTouchback,
          throwT: _intThrowT,
          tracks: { ..._intZoneDrops },
        };
        // Underthrown pick: a deep ball a weak arm couldn't drive there → the
        // beaten defender closes and undercuts it. (Phase-2 visual: ball lands
        // short, receiver decelerates to come back, defender drives on it.)
        const _utPick = targetDepth >= 15 && qbThr < 72;
        this._pushVisual({
          kind: "int", desc: isPickSix
            ? `PICK SIX! ${intBy} returns it ${finalRetYds} yds for a touchdown!`
            : isTouchback
              ? `INTERCEPTION! ${intBy} picks it off in the end zone — touchback`
              : _utPick
                ? `UNDERTHROWN — ${this.offR.starters.qb} can't drive it deep, ${intBy} undercuts it for the pick${finalRetYds > 0 ? ` (+${finalRetYds})` : ""}`
                : finalRetYds > 0
                  ? `INTERCEPTION! ${intBy} picks off ${this.offR.starters.qb} and returns ${finalRetYds} yds`
                  : `INTERCEPTION! ${this.offR.starters.qb} picked off!`,
          startYard, targetDepth, endYard: startYard, isUnderthrown: _utPick,
          passer: this.offR.starters.qb, defender: intBy,
          intReturnYds: finalRetYds, isPickSix, isTouchback, intSpotYL,
          isPlayAction, isFleaFlicker,
          concept: this._lastPassConcept, coverage: this._lastPassCoverage,
          motion: _intMotion,
        });
        if (isPickSix) this._defScoreXP();
        // Momentum: defense takes ball (+3); pick-six = catastrophic for
        // offense (+4 defense, -3 offense routed by swing). Touchback is
        // smaller swing (defense gets ball but at the 20).
        const defSide = this.poss === "home" ? "away" : "home";
        this._swingMomentum(defSide, isPickSix ? 4 : isTouchback ? 2 : 3, "INT");
        return { turnover: true, retYds: finalRetYds, isPickSix, isTouchback, intSpotYL };
      }
      // Sacks: heavily driven by the OL-vs-DL trench matchup (pressure).
      // Play-action holds the ball longer → more sack risk.
      const sackPb = (pb.sackMul || 1.0) * paSackMul;
      // Composed QB sack reduction: high-AWR QBs slide in the pocket and
      // throw the ball away rather than absorbing the sack. AWR 95 → ~50%
      // fewer sacks; AWR 60 → +20% (jittery, holds it too long).
      const qbAwrSackMul = clamp(1 - (qbAwr - 70) / 60, 0.50, 1.30);
      // BLITZER LBs and SLOT_CBs add small but additive sack bonuses — more
      // bodies bringing the heat ups the odds even when the trench loses.
      const defArchPre = this.defArch;
      const blitzerLBs = (defArchPre.LB || []).filter(l => l?.archetype === "BLITZER").length;
      const slotBlitzCBs = (defArchPre.CB || []).filter(c => c?.archetype === "SLOT_CB").length;
      const archSackBonus = blitzerLBs * 0.025 + slotBlitzCBs * 0.012;
      // Defensive playbook tilts: blitz schemes ramp the sack chance up,
      // dime / prevent schemes drop it.
      const defPbCurrent = this.currentDefPlaybook;
      // MLB aggression tilts the pass-rush effort — blitz-happy MLBs dial up
      // pressure even when the OL matchup doesn't favor it.
      const mlbAggMul = this._aggTilt(this._mlbAggression()); // BLITZER MLB →  up to 1.30
      // Sack rate: NFL league avg ~7%/dropback, elite pass rush vs bad OL
      // tops out ~13-14%. Base/pressure tuned to land ~7%/dropback after
      // multipliers stack (sackPb playbook + AWR + def scheme + MLB agg).
      // Top NFL pass-rushers post 15-22 sacks; prior 0.075 base capped at
      // 0.16 only delivered ~10, so the top end got lifted.
      const _olFat = this._avgFatigue(this.poss === "home" ? this.homeOL : this.awayOL);
      const _dlFat = this._avgFatigue(this.poss === "home" ? this.awayDL : this.homeDL);
      const fatigueSackMul = 1 + (_olFat - _dlFat) / 100 * 0.30;
      // Hot defense generates more pressure — but capped tight so a single
      // turnover doesn't make sacks 50% more frequent.
      const momSackMul = 1 + ((this._momentum?.[this.poss === "home" ? "away" : "home"] || 0)
                            - (this._momentum?.[this.poss] || 0)) * 0.012;
      const boxStackSackMul = this._boxStackSackMul || 1;
      // Base sack chance — 0.075 lands sacks near NFL ~5.0/game with the
      // level-3 trench-battle model. Earlier values: 0.105 (sacks 7.1),
      // 0.075 (sacks 4.6, over-corrected scoring), 0.090 (sacks 5.4 pre-
      // trench, 6.4 post-trench-runs as trench resolution shifted RNG
      // walk). Reset back to 0.075 — trench-driven run distribution adds
      // its own per-snap variance that produces enough "pressure feel".
      const sackPct = clamp((0.075 + pressure * 0.10 - adv * 0.02 + archSackBonus) * sackPb * qbAwrSackMul * defPbCurrent.sackMul * mlbAggMul * fatigueSackMul * momSackMul * boxStackSackMul, 0.02, 0.20);
      // ── MFF trench attribution (additive, no RNG, no outcome change) ──
      // This dropback is one resolved DL-vs-OL rep (the `reps` pair picked at
      // snap top). Credit the pass-rush / pass-pro snap to that pair, and a
      // smooth expected-pressure (xPressure, 0..1) from the matchup. A sack
      // (resolved below) tops this rep's credit up to a full 1.0. Writes only
      // new stat keys via the `||0` idiom — no RNG, no outcome mutation.
      let _mffXp = 0;
      if (this._MFF_ATTR) {
        const _mDl = reps.dl?.name && def.players[reps.dl.name];
        const _mOl = reps.ol?.name && off.players[reps.ol.name];
        if (_mDl) _mDl.pass_rush_snaps = (_mDl.pass_rush_snaps || 0) + 1;
        if (_mOl) _mOl.pass_pro_snaps  = (_mOl.pass_pro_snaps  || 0) + 1;
        _mffXp = clamp(MFF_PRESS_BASE + (pressure - MFF_PRESS_MED) * MFF_PRESS_SLOPE, 0.02, 0.85);
        if (_mDl) _mDl.pressures         = (_mDl.pressures         || 0) + _mffXp;
        if (_mOl) _mOl.pressures_allowed = (_mOl.pressures_allowed || 0) + _mffXp;
      }
      if (Math.random() < sackPct) {
        // THROW ON THE RUN — mobile QBs with high AGI sometimes escape pressure
        // and throw on the move instead of taking the sack. Lower comp / air
        // (it's an off-platform throw), but no sack loss. POCKET QBs never roll.
        const torSkill = clamp((qbAgi + qbThr - 130) / 100, 0, 1);  // 0-1
        const archMul = qbArch === "DUAL_THREAT" ? 1.4 : qbArch === "POCKET" ? 0.1 : qbArch === "GUNSLINGER" ? 0.9 : 1.0;
        // Was 0.35 * archMul (up to 0.45) — let mobile QBs escape too easily.
        // Now most pressure plays still end in a sack even for DT QBs.
        const torChance = clamp(torSkill * 0.22 * archMul, 0, 0.30);
        if (Math.random() < torChance) {
          // Roll the TOR completion check — meaningfully worse than a pocket throw
          const torComp = clamp(0.40 + (qbAgi - 60) / 200 + (qbThr - 70) / 220 - pressure * 0.05, 0.18, 0.72);
          const torRoll = Math.random();
          if (torRoll < torComp) {
            // Completed on the run — shorter / less accurate throw
            const airYds = clamp(normal(7 - pressure * 1.5, 5.5), 1, 35);
            const targetDepth = Math.max(1, Math.round(airYds));
            let yac = airYds >= 5 ? rand(0, Math.max(1, Math.floor(airYds * 0.4))) : 0;
                  const _touchMulTor = {
              wr1: this._touchTargetMul(this.poss, "wr1"),
              wr2: this._touchTargetMul(this.poss, "wr2"),
              te:  this._touchTargetMul(this.poss, "te"),
              rb:  this._touchTargetMul(this.poss, "rb"),
            };
            const rcvr = pickReceiver(pb, this.offR.starters, this._currentPersonnel, cbCoverageMix, _touchMulTor);
            // Backups (wr3/wr4/te2/rb2) aren't pre-registered in
            // _buildTeamStats — ensure their stat line exists or rec_yds
            // gets dropped while pass_yds still credits the QB.
            this._ensurePlayerStat(this.poss, rcvr, this._playerByName?.get?.(rcvr)?.position || "WR");
            const rcvrStats = off.players[rcvr];
            // YAC break-tackle
            let torBT = 0;
            if (yac > 0) {
              const rp = this._playerByName.get(rcvr);
              const br = this._resolveBreakTackle({
                carrierName: rcvr, yards: yac,
                breakStyle: _archetypeBreakStyle(rp?.archetype),
                tacklerArchByPos: this.defArch,
                tacklerStatsPlayers: this.defStats?.players,
                tacklerZones: _YAC_TACKLER_ZONES, gangDist: _YAC_GANG_DIST,
              });
              if (br.brokenTackles > 0) { yac += Math.round(br.bonusYards * 0.75); torBT = br.brokenTackles; }
            }
            const yards = Math.min(Math.max(1, targetDepth + yac), 100 - startYard);
            if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
            if (rcvrStats) {
              rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards;
              if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards;
              if (torBT) rcvrStats.broken_tackles = (rcvrStats.broken_tackles || 0) + torBT;
            }
            off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
            this._lastBallCarrier = rcvr; this._lastBallType = "pass";
            const isTorTD = clamp(startYard + yards, 0, 100) >= 100;
            const torCtx = { type: "tor" };
            const tacklerName = (yards > 0 && !isTorTD) ? this._creditTackle(torCtx) : null;
            this._bumpHitWear(rcvr, 0.25, tacklerName, { playContext: torCtx });
            const torEndTag = isTorTD ? " — TOUCHDOWN!" : tacklerName ? `, tackled by ${tacklerName}` : "";
            this._pushVisual({
              kind: "complete", desc: `${this.offR.starters.qb} throws on the run to ${rcvr} for ${yards} yds${torEndTag}`,
              startYard, targetDepth, catchDepth: targetDepth, yac, yards,
              endYard: clamp(startYard + yards, 0, 100), receiver: rcvr, passer: this.offR.starters.qb,
              tackler: tacklerName, throwType: "TOR", isTOR: true,
            });
            return { yards };
          } else {
            // Incomplete on the run — throwaway
            if (qbStats) qbStats.pass_att++;
            off.team.pass_att++;
            this._pushVisual({
              kind: "incomplete", desc: `${this.offR.starters.qb} throws it away on the run`,
              startYard, targetDepth: 8, endYard: startYard,
              passer: this.offR.starters.qb, isTOR: true,
            });
            return { yards: 0, incomplete: true };
          }
        }
        // SACK EVASION → RUN — agile QBs sometimes escape the pocket and
        // turn the would-be sack into a positive-yardage scramble. Tied
        // to AGI (with AWR helping a bit) and archetype. Pocket passers
        // basically can't do this; dual-threats can do it often.
        const evadeSkill = clamp((qbAgi - 65) / 30, 0, 1);              // 0 at AGI 65, 1 at AGI 95
        const archMulEvade = qbArch === "DUAL_THREAT" ? 1.6
                            : qbArch === "POCKET"     ? 0.08
                            : qbArch === "GUNSLINGER" ? 0.55
                            :                             1.0;
        const awrAssist = clamp((qbAwr - 70) / 80, 0, 0.25);            // small AWR boost
        const evadeChance = clamp((evadeSkill * 0.18 + awrAssist) * archMulEvade, 0, 0.32);
        if (Math.random() < evadeChance) {
          // Escape successful — generate yards, biased by AGI. Most
          // are short (2-6 yds), a few are explosive (Lamar-style).
          const yardsRaw = normal(4 + (qbAgi - 70) / 11, 5);
          let yards = clamp(Math.round(yardsRaw), -2, 35);
          if (yards > 0) yards = Math.min(yards, 100 - startYard);
          if (qbStats) {
            qbStats.rush_att = (qbStats.rush_att || 0) + 1;
            qbStats.rush_yds = (qbStats.rush_yds || 0) + yards;
            if (yards > (qbStats.rush_long || 0)) qbStats.rush_long = yards;
          }
          off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
          this._lastBallCarrier = QB; this._lastBallType = "rush";
          const isEvadeTD = clamp(startYard + yards, 0, 100) >= 100;
          const tacklerName = (yards > -2 && !isEvadeTD)
            ? this._creditTackle({ type: "scramble", yards })
            : null;
          const endTag = isEvadeTD
            ? " — TOUCHDOWN!"
            : tacklerName ? `, tackled by ${tacklerName}` : "";
          this._pushVisual({
            kind: "run",
            desc: `${this.offR.starters.qb} escapes pressure for ${yards} yds${endTag}`,
            startYard, yards,
            endYard: clamp(startYard + yards, 0, 100),
            rusher: QB, isScramble: true,
            tackler: tacklerName,
          });
          return { yards };
        }
        // Sack depth — bidirectional. Brady-tier (slow + aware) takes ~4-5 yd
        // sacks; Lamar-tier (mobile) ~1-2; immobile + unaware QBs deeper.
        // GUNSLINGER holds the ball (deeper); PA / flea flicker = deeper drop.
        const qbSpd = qbPlayer?.stats?.[0] ?? 70;
        const mobilityCut = (qbSpd - 70) / 15;       // SPD 90 -> -1.3, SPD 50 -> +1.3
        const awrCut      = (qbAwr - 70) / 15;       // AWR 90 -> -1.3, AWR 50 -> +1.3
        const sackArchMod = qbArch === "POCKET"      ? -0.5
                         : qbArch === "DUAL_THREAT"  ? -0.5
                         : qbArch === "GUNSLINGER"   ?  2.0
                         : 0;
        const sackPlayMod = isFleaFlicker ? 3 : isPlayAction ? 1 : 0;
        const loss = Math.round(clamp(normal(7 + sackArchMod + sackPlayMod - mobilityCut - awrCut, 4), 1, 22));
        if (qbStats) { qbStats.sacks_taken++; qbStats.sack_yds += loss; }
        off.team.sacks_allowed++; def.team.sacks++;
        // NFL: ~30% of sacks come from LBs (mostly edge-rushing blitzers).
        // Roll for an LB sack when blitzers are on the field; otherwise credit
        // the DL who won the rep.
        const lbPool = (this.defArch.LB || []).filter(l => l?.name);
        const blitzerCount = lbPool.filter(l => l.archetype === "BLITZER").length;
        const lbSackChance = lbPool.length ? Math.min(0.40, 0.18 + blitzerCount * 0.08) : 0;
        let sackedBy = null, sackedByMove = null;
        if (lbPool.length && Math.random() < lbSackChance) {
          const weights = lbPool.map(l => l.archetype === "BLITZER" ? 3 : 1);
          const total = weights.reduce((s, w) => s + w, 0);
          let r = Math.random() * total;
          let chosen = lbPool[lbPool.length - 1];
          for (let i = 0; i < lbPool.length; i++) { r -= weights[i]; if (r <= 0) { chosen = lbPool[i]; break; } }
          if (def.players[chosen.name]) {
            def.players[chosen.name].sk = (def.players[chosen.name].sk || 0) + 1;
            def.players[chosen.name].sk_yds = (def.players[chosen.name].sk_yds || 0) + loss;
            def.players[chosen.name].tkl = (def.players[chosen.name].tkl || 0) + 1;
            sackedBy = chosen.name;
            sackedByMove = "BLITZ";
          }
        } else if (reps.dl?.name && def.players[reps.dl.name]) {
          def.players[reps.dl.name].sk = (def.players[reps.dl.name].sk || 0) + 1;
          def.players[reps.dl.name].sk_yds = (def.players[reps.dl.name].sk_yds || 0) + loss;
          def.players[reps.dl.name].tkl = (def.players[reps.dl.name].tkl || 0) + 1;
          sackedBy = reps.dl.name;
        }
        // Force-scaled sack wear — the sacker's STR/SPD/archetype drives hit
        // force, sack depth adds extra (deeper sack = more time to wind up).
        // QB getting sacked too much → wear climbs → injury risk climbs.
        this._bumpHitWear(QB, 1.2, sackedBy, { eventType: "sack", sackDepth: loss });
        // Charge the sack to the OL who lost the rep
        if (reps.ol?.name && off.players[reps.ol.name])
          off.players[reps.ol.name].sacks_allowed = (off.players[reps.ol.name].sacks_allowed || 0) + 1;
        // MFF: a sack is the strongest pressure outcome — credit the DL a
        // QB-hit, and top this rep's xPressure up to a full 1.0 (sack ⇒ pressure).
        // (Additive, no RNG.)
        if (this._MFF_ATTR) {
          const _mDl2 = reps.dl?.name && def.players[reps.dl.name];
          const _mOl2 = reps.ol?.name && off.players[reps.ol.name];
          const _top = Math.max(0, 1 - _mffXp);
          if (_mDl2) { _mDl2.qb_hits = (_mDl2.qb_hits || 0) + 1; _mDl2.pressures = (_mDl2.pressures || 0) + _top; }
          if (_mOl2) _mOl2.pressures_allowed = (_mOl2.pressures_allowed || 0) + _top;
        }
        // Strip-sack — NFL ~10% of sacks force a fumble. Low-AWR QBs (poor
        // ball security) are more vulnerable; high-AWR feel the rush and
        // tuck the ball.
        // Clutch ball security: a composed QB feels the rush and tucks it away;
        // a folder coughs it up under late pressure. (Composure, never physical.)
        // 0.10 → 0.13 base. Sim-audit turnovers 0.84/g (band 0.90-2.10) and
        // blowouts/shutouts under band because fumbles were thin. Strip-sacks
        // are the highest-variance turnover (often returned for TDs).
        const stripChance = clamp(0.13 - (qbAwr - 70) / 400 - this._clutchMod(QB, 0.04), 0.05, 0.22);
        const isStripSack = Math.random() < stripChance;
        let recoveredByDef = false;
        let recoveredBy = null;
        if (isStripSack) {
          off.team.fumbles = (off.team.fumbles || 0) + 1;
          if (qbStats) qbStats.fumbles = (qbStats.fumbles || 0) + 1;
          // ~55% of strip-sacks are recovered by the defense
          if (Math.random() < 0.55) {
            recoveredByDef = true;
            off.team.fumbles_lost = (off.team.fumbles_lost || 0) + 1;
            off.team.turnovers = (off.team.turnovers || 0) + 1;
            def.team.takeaways = (def.team.takeaways || 0) + 1;
            recoveredBy = sackedBy || this._creditDefStat("fr", { DL: 0.50, LB: 0.30, S: 0.10, CB: 0.10 });
            if (recoveredBy && def.players[recoveredBy]) def.players[recoveredBy].fr = (def.players[recoveredBy].fr || 0) + 1;
          }
          // Credit forced fumble to the sacker
          if (sackedBy && def.players[sackedBy]) def.players[sackedBy].ff = (def.players[sackedBy].ff || 0) + 1;
        }
        // Pick a move from the DL's archetype toolkit
        const moves = DL_ARCHETYPES[reps.dlType]?.moves || ["SACK"];
        const move = moves[Math.floor(Math.random() * moves.length)];
        // PATH B Phase 7 — sacker pursuit track. Engine emits a path
        // for the named DL/blitzer to converge on the QB's drop spot.
        // contactT varies by depth (deep drops give longer pursuits).
        const _sackerName = sackedBy || reps.dl?.name || null;
        const _sackerSlot = this._resolveDefSlot(_sackerName) || (() => {
          if (!_sackerName || !this.defR?.starters) return null;
          const ds = this.defR.starters;
          if (_sackerName === ds.de1) return "de1";
          if (_sackerName === ds.de2) return "de2";
          if (_sackerName === ds.dt1) return "dt1";
          if (_sackerName === ds.dt2) return "dt2";
          return null;
        })();
        const _sackerStart = (() => {
          // DL slot positions in YARDS — must match DL_DEPTH_YD in
          // play-render.js:makeFormation (currently 2.5).
          // de1 (left end): dyYd ≈ -8;  dt1 (left tackle): dyYd ≈ -2.5
          // dt2 (right tackle): dyYd ≈ +2.5;  de2 (right end): dyYd ≈ +8
          // LB blitzer: dyYd ≈ 0, dxYd ≈ +4 (matches lbDepth-ish)
          switch (_sackerSlot) {
            case "de1": return { dxYd: 2.5, dyYd: -8 };
            case "dt1": return { dxYd: 2.5, dyYd: -2.5 };
            case "dt2": return { dxYd: 2.5, dyYd:  2.5 };
            case "de2": return { dxYd: 2.5, dyYd:  8 };
            case "lb1": return { dxYd: 4,   dyYd: -3 };
            case "lb2": return { dxYd: 4,   dyYd:  0 };
            case "lb3": return { dxYd: 4,   dyYd:  3 };
            case "ss":  return { dxYd: 8,   dyYd:  5 };
            case "fs":  return { dxYd: 12,  dyYd:  0 };
            case "cb1": return { dxYd: 5,   dyYd: -16 };
            case "cb2": return { dxYd: 5,   dyYd:  16 };
            default:    return { dxYd: 2.5, dyYd:  0 };
          }
        })();
        // QB at his drop position is roughly -6 yards behind LOS during
        // the dance; final sack spot is at -(loss) yards from LOS (the
        // QB falls FORWARD from drop to sack spot during the takedown).
        const _qbDropXYd = -6;            // where QB is during the pocket dance
        const _qbSackXYd = -loss;         // where QB ends up after fall
        // Contact time — when the sacker reaches the QB. Pushed later
        // than before (0.72→0.85 normal) so the sacker isn't standing
        // around for the back third of the play; from contact to 0.95
        // the sacker follows the QB forward through the fall.
        const _sackContactT = sackedByMove === "BLITZ" ? 0.65
                            : loss >= 8                ? 0.88
                            : 0.82;
        const _sackerTrack = _sackerSlot ? {
          role: _sackerSlot.toUpperCase(),
          sackerName: _sackerName,
          waypoints: [
            { t: 0.00,                          dxYd: _sackerStart.dxYd,                                       dyYd: _sackerStart.dyYd },                 // formation
            { t: 0.22,                          dxYd: _sackerStart.dxYd + 0.5,                                  dyYd: _sackerStart.dyYd * 0.85 },          // engaged at LOS
            { t: _sackContactT * 0.55,          dxYd: (_sackerStart.dxYd + _qbDropXYd) * 0.5,                   dyYd: _sackerStart.dyYd * 0.4 },           // breaking through
            { t: _sackContactT * 0.85,          dxYd: _qbDropXYd + (_sackerStart.dxYd - _qbDropXYd) * 0.25,     dyYd: _sackerStart.dyYd * 0.15 },          // closing the last yard
            { t: _sackContactT,                 dxYd: _qbDropXYd,                                               dyYd: 0 },                                 // CONTACT at QB's drop position
            { t: 0.95,                          dxYd: _qbSackXYd,                                               dyYd: 0 },                                 // riding QB forward through the fall
            { t: 1.00,                          dxYd: _qbSackXYd,                                               dyYd: 0 },                                 // settled on top
          ],
        } : null;
        this._pushVisual({
          kind: "sack", desc: `${this.offR.starters.qb} sacked for -${loss} yds`,
          startYard, sackLoss: loss, endYard: clamp(startYard - loss, 1, 99),
          passer: this.offR.starters.qb,
          dlName: reps.dl?.name, dlType: reps.dlType, dlMove: move,
          olName: reps.ol?.name, olType: reps.olType,
          isPlayAction, isFleaFlicker,
          isStripSack,
          recoveredByDef: isStripSack ? recoveredByDef : undefined,
          recoveredBy:    isStripSack ? recoveredBy    : undefined,
          motion: _sackerTrack ? {
            sackerName: _sackerName,
            sackerSlot: _sackerSlot,
            contactT: _sackContactT,
            tracks: { sacker: _sackerTrack },
          } : null,
        });
        // Return negative yardage and let _drive() handle the down progression.
        // (Previously we mutated this.yardLine/down/ytg directly which double-counted
        // the down increment in _drive(), turning a 3rd-down sack into a phantom
        // turnover-on-downs.)
        return { yards: -loss };
      }
      // Pressure disrupts comp% (QB rushed, throw-aways, contested catches)
      const compPbMul = pb.compMul || 1.0;
      // Shutdown CBs suppress comp%; possession WRs boost it slightly
      const shutdownPenalty = (defArch.CB || []).filter(c => c?.archetype === "SHUTDOWN").length * 0.025;
      const offArch = this.offArch;
      const possessionBonus = ((offArch.WR1?.archetype === "POSSESSION") ? 0.020 : 0)
                            + ((offArch.WR2?.archetype === "POSSESSION") ? 0.012 : 0);
      // Screen passes — about 8% of called passes are screens. High comp rate, modest YAC.
      // Skip on 3rd & long (screens get blown up by overzealous blitzers).
      const isScreenCall = !(isThird && this.ytg >= 9) && Math.random() < 0.085;
      if (isScreenCall) {
        // Screen TARGET — ~70% RB, ~30% WR (wr1 or wr2 50/50). Engine
        // emitted only RB screens before, so every screen looked the
        // same — RB stepping toward QB. Real playbooks include WR/now/
        // tunnel screens and bubble screens off the slot.
        const _scrPick = Math.random();
        const _isWRScreen = _scrPick < 0.30;
        const _scrWrSlot = _isWRScreen
          ? (Math.random() < 0.5 ? "wr1" : "wr2")
          : null;
        const rcvr = _isWRScreen
          ? this.offR.starters[_scrWrSlot]
          : this.offR.starters.rb;
        const _scrRole = _isWRScreen ? "WR" : "RB";
        this._ensurePlayerStat(this.poss, rcvr, _scrRole);
        const rcvrStats = off.players[rcvr];
        if (Math.random() < 0.84) {
          // Completed screen
          const airYds = rand(-1, 1);
          const baseYac = rand(2, 7);
          const bigYac = Math.random() < 0.16 ? rand(8, 22) : 0;
          let yac = baseYac + bigYac;
          // YAC break-tackle on screens — RB in space with blockers, high break opportunity
          let screenBT = 0;
          if (yac > 0) {
            const rp = this._playerByName.get(rcvr);
            const br = this._resolveBreakTackle({
              carrierName: rcvr, yards: yac,
              breakStyle: _archetypeBreakStyle(rp?.archetype),
              tacklerArchByPos: this.defArch,
              tacklerStatsPlayers: this.defStats?.players,
              tacklerZones: _YAC_TACKLER_ZONES, gangDist: _YAC_GANG_DIST,
            });
            if (br.brokenTackles > 0) { yac += Math.round(br.bonusYards * 0.75); screenBT = br.brokenTackles; }
          }
          const yards = Math.min(clamp(airYds + yac, -3, 95), 100 - startYard);
          if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
          if (rcvrStats) {
            rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards;
            if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards;
            if (screenBT) rcvrStats.broken_tackles = (rcvrStats.broken_tackles || 0) + screenBT;
          }
          off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
          this._lastBallCarrier = rcvr; this._lastBallType = "pass";
          const isScreenTD = clamp(startYard + yards, 0, 100) >= 100;
          const screenCtx = { type: "screen" };
          const tacklerName = (yards > 0 && !isScreenTD) ? this._creditTackle(screenCtx) : null;
          this._bumpHitWear(rcvr, 0.35, tacklerName, { playContext: screenCtx });  // screens take more contact
          const screenEndTag = isScreenTD ? " — TOUCHDOWN!" : tacklerName ? `, tackled by ${tacklerName}` : "";
          // PATH B Phase 8 — screen motion. RB receives a short toss
          // and runs downfield; engine emits carrier path + decoy
          // routes for WRs/TE.
          this._lastPassConcept = "SCREEN";
          const _scrThrowT = 0.30;     // carrier catches very early (short toss)
          // Carrier shape varies by screen type:
          //   RB screen: step in toward the QB to receive a checkdown,
          //     then forward through the convoy.
          //   WR screen: WR drifts back ~1 yd outside (bubble) instead
          //     of stepping toward the QB. Catch is a lateral toss
          //     behind LOS; YAC goes forward with blockers leading.
          //     dyYd negative = away from midfield (toward sideline).
          const _scrCarrierTrack = _isWRScreen ? {
            role: _scrWrSlot.toUpperCase(), origin: { slot: _scrWrSlot },
            waypoints: [
              { t: 0,                          dxYd: 0,      dyYd: 0    },                              // formation (wide)
              { t: 0.10,                       dxYd: -1,     dyYd: -0.5 },                              // bubble back/outside
              { t: _scrThrowT,                 dxYd: airYds, dyYd: -1.2 },                              // catch outside-and-behind
              { t: Math.min(1, _scrThrowT + (1 - _scrThrowT) * 0.85),
                                                dxYd: yards, dyYd: -1 + Math.min(1, yac * 0.04) },     // YAC heading downfield with slight midfield drift
              { t: 1,                          dxYd: yards, dyYd: -1 + Math.min(1, yac * 0.04) },
            ],
          } : {
            role: "RB", origin: { slot: "rb" },
            waypoints: [
              { t: 0,                          dxYd: 0, dyYd: 0 },                                      // formation
              { t: 0.10,                       dxYd: -1, dyYd: 0 },                                     // step toward QB
              { t: _scrThrowT,                 dxYd: airYds, dyYd: -0.5 },                              // catch (lateral toss)
              { t: Math.min(1, _scrThrowT + (1 - _scrThrowT) * 0.85),
                                                dxYd: yards, dyYd: Math.min(2, yac * 0.05) },           // YAC end
              { t: 1,                          dxYd: yards, dyYd: Math.min(2, yac * 0.05) },
            ],
          };
          // Other receivers run vertical decoys to clear coverage. On
          // WR screens the SLOT/TE blockers convoy back toward the
          // carrier instead; route helper keeps the others on verticals.
          const _scrRoutes = this._buildPassRouteTracks({
            targetSlot: null, targetDepth: 18, yac: 0,
            concept: "VERTICAL", throwT: _scrThrowT,
          });
          // Carrier slot owns its own track — strip the helper's stub.
          if (_isWRScreen) delete _scrRoutes[_scrWrSlot];
          else             delete _scrRoutes.rb;
          const _scrZoneDrops = this._buildPassZoneDrops({
            tacklerSlot: this._resolveDefSlot(tacklerName),
            throwT: _scrThrowT, coverage: this._lastPassCoverage,
          });
          const _scrCarrierKey = _isWRScreen ? _scrWrSlot : "rb";
          this._pushVisual({
            kind: "complete", desc: `Screen to ${rcvr} for ${yards} yds${screenEndTag}`,
            startYard, targetDepth: airYds, catchDepth: airYds, yac, yards,
            endYard: clamp(startYard + yards, 0, 100), receiver: rcvr,
            passer: this.offR.starters.qb, tackler: tacklerName, isScreen: true,
            isWRScreen: _isWRScreen || undefined,
            throwType: "CHECKDOWN",
            motion: {
              targetSlot: _scrCarrierKey,
              throwT: _scrThrowT,
              dropDepth: 2,
              tracks: { ..._scrRoutes, [_scrCarrierKey]: _scrCarrierTrack, ..._scrZoneDrops },
            },
          });
          return { yards };
        } else {
          // Screen got blown up — incomplete (timing was off, defender read it)
          if (qbStats) qbStats.pass_att++;
          if (rcvrStats) rcvrStats.rec_tgt++;
          off.team.pass_att++;
          // Also emit motion for blown-up screens — RB still moves toward
          // the catch spot but doesn't catch; defenders converge.
          this._lastPassConcept = "SCREEN";
          const _scrIncThrowT = 0.30;
          const _scrIncCarrier = {
            role: "RB", origin: { slot: "rb" },
            waypoints: [
              { t: 0,           dxYd: 0,  dyYd: 0 },
              { t: 0.15,        dxYd: -1, dyYd: 0 },
              { t: _scrIncThrowT, dxYd: 0, dyYd: -0.5 },
              { t: 1,           dxYd: 0,  dyYd: -0.5 },
            ],
          };
          const _scrIncZoneDrops = this._buildPassZoneDrops({
            tacklerSlot: null, throwT: _scrIncThrowT, coverage: this._lastPassCoverage,
          });
          this._pushVisual({
            kind: "incomplete", desc: `Screen broken up — incomplete`,
            startYard, targetDepth: -1, endYard: startYard,
            passer: this.offR.starters.qb, intended: rcvr, isScreen: true,
            motion: {
              targetSlot: "rb",
              throwT: _scrIncThrowT,
              dropDepth: 2,
              tracks: { rb: _scrIncCarrier, ..._scrIncZoneDrops },
            },
          });
          return { yards: 0, incomplete: true };
        }
      }
      // Pick the targeted receiver up front so their CAT/archetype affect the completion roll.
      // (Previously the receiver was picked AFTER the comp roll, so a 39-CAT WR had
      // the same comp% as a 95-CAT one — that's no longer true.)
      const _touchMul = {
        wr1: this._touchTargetMul(this.poss, "wr1"),
        wr2: this._touchTargetMul(this.poss, "wr2"),
        te:  this._touchTargetMul(this.poss, "te"),
        rb:  this._touchTargetMul(this.poss, "rb"),
      };
      const rcvr = pickReceiver(pb, this.offR.starters, this._currentPersonnel, cbCoverageMix, _touchMul);
      // Backups (wr3/wr4/te2/rb) aren't pre-registered — ensure here.
      this._ensurePlayerStat(this.poss, rcvr, this._playerByName?.get?.(rcvr)?.position || "WR");
      const rcvrStats = off.players[rcvr];
      const rcvrPlayer = this._playerByName?.get?.(rcvr) || null;
      const rcvrCat = rcvrPlayer?.stats?.[5] ?? 70;
      const rcvrAwr = rcvrPlayer?.stats?.[3] ?? 65;
      // CAT swings comp% meaningfully — a 95-CAT WR catches everything thrown his way,
      // a 60-CAT WR is a question mark on every throw.
      const catCompMod = (rcvrCat - 70) / 130;       // CAT 95 → +0.192; CAT 60 → -0.077
      const awrCompMod = (rcvrAwr - 65) / 280;       // route-running bump
      // ── WR ARCHETYPE EFFECTS on this throw ──
      // Bonuses/penalties to comp% based on the targeted receiver's
      // archetype. DEEP_THREAT trades catch% for big plays; POSSESSION
      // is a chain-mover; ROUTE_RUNNER beats coverage; RED_ZONE only
      // matters near the end zone.
      const rcvrArch = rcvrPlayer?.archetype;
      const isRedZone = startYard >= 80;
      let archCompMod = 0;
      if      (rcvrArch === "POSSESSION")   archCompMod = 0.045;
      else if (rcvrArch === "ROUTE_RUNNER") archCompMod = 0.030;
      else if (rcvrArch === "SLOT")         archCompMod = 0.025;
      else if (rcvrArch === "DEEP_THREAT")  archCompMod = -0.040;
      else if (rcvrArch === "RED_ZONE")     archCompMod = isRedZone ? 0.055 : -0.010;
      // OC Red Zone Genius: +8% comp in the red zone
      const ocRZGeniusMod = (isRedZone && _ocTrait === "Red Zone Genius") ? 0.08 : 0;
      archCompMod += ocRZGeniusMod;
      // COVER MATCHUP — the SPECIFIC covering defender's COV stat is a major
      // factor, for EVERY target (not just outside WRs). Assignment mirrors
      // the man-cover scheme: wr1→cb1, wr2→cb2, slot wr3→nickel (cb3),
      // TE→MLB (lb2), RB→WLB/SLB (lb1/lb3). Previously only wr1/wr2 had an
      // individual cover term — a TE on an elite cover-LB vs a scrub LB
      // completed at the SAME rate (the LB's COV rating was ignored; only the
      // COUNT of COVER-archetype LBs mattered via coverLbMod). Now the man
      // across from each receiver moves the needle by his own coverage skill.
      let cbCoverMod = 0;
      const _st = this.defR.starters;
      // Resolve the slot key (for press/mismatch terms below) AND the cover
      // defender's name + the swing scale for this target's position group.
      let wrSlotKey = null, _coverName = null, _coverScale = 170;
      if (rcvr === this.offR.starters.wr1)      { wrSlotKey = "cb1"; _coverName = _st.cb1; _coverScale = 170; }
      else if (rcvr === this.offR.starters.wr2) { wrSlotKey = "cb2"; _coverName = _st.cb2; _coverScale = 170; }
      else if (rcvr === this.offR.starters.wr3) { _coverName = _st.cb3; _coverScale = 200; }   // slot vs nickel (softer)
      else if (rcvr === this.offR.starters.te)  { _coverName = _st.lb2; _coverScale = 230; }   // TE vs MLB (LBs cover worse)
      else if (rcvr === this.offR.starters.rb)  { _coverName = _st.lb1; _coverScale = 230; }   // RB vs WLB
      else if (rcvr === this.offR.starters.wr4 || rcvr === this.offR.starters.wr5) {
        _coverName = _st.cb4 || _st.cb3; _coverScale = 200;   // extra WR vs dime back
      }
      else if (rcvr === this.offR.starters.te2) { _coverName = _st.lb3; _coverScale = 230; }   // 2nd TE vs SLB
      else if (rcvr === this.offR.starters.rb2) { _coverName = _st.lb3; _coverScale = 230; }   // 2nd back vs SLB
      else { _coverName = _st.cb3; _coverScale = 220; }   // any other target → nickel-ish default (no silent 0)
      if (_coverName) {
        const covPlayer = this._playerByName?.get?.(_coverName) || null;
        const covCov = covPlayer?.stats?.[8] ?? 65;
        cbCoverMod = -(covCov - 65) / _coverScale;   // WR: COV95 → -0.176; LB cover (230): ±0.13
        // Safety help — average COV of the 2 starting safeties tightens
        // everything up a touch (deep help over the top, run support).
        const safNames = [_st.fs, _st.ss];
        const safPlayers = safNames.map(n => this._playerByName?.get?.(n)).filter(Boolean);
        if (safPlayers.length) {
          const avgSafCov = safPlayers.reduce((s,p) => s + (p.stats?.[8] || 65), 0) / safPlayers.length;
          cbCoverMod -= (avgSafCov - 65) / 480;       // up to ~-0.063 from elite safety duo
        }
        // MFF coverage attribution: credit a coverage TARGET to the deterministic
        // cover man (denominator for completion-allowed rate). Additive, no RNG.
        if (this._MFF_ATTR && def.players[_coverName])
          def.players[_coverName].cover_tgt = (def.players[_coverName].cover_tgt || 0) + 1;
      }
      // QB OVR matters a lot for completion %: a 60-OVR scrub completes far less than a 90-OVR star
      // (swing of ~0.20 across 30 OVR points, centered around 75 OVR baseline)
      // OVR completion boost compressed: was (OVR-75)/150 giving a 99
      // (QB completion skill is now the DEPTH-WEIGHTED accuracy/arm blend computed
      // in the hoisted air-yards block — qbDepthSkill — not a flat OVR term.)
      // ── COMPOSED-QB POCKET BONUS ──────────────────────────────────────
      // Smart, cool-headed QBs (high AWR) extend plays in the pocket — they
      // step up, slide, hold the ball longer, and wait for the deep route
      // to open. They take fewer sacks AND find the favorable matchup. The
      // edge scales with AWR: 60 → -0.20 (jittery), 75 → +0.10, 95 → +0.50.
      const qbPocketBonus = clamp((qbAwr - 70) / 50, -0.20, 0.50);
      // Speed-vs-coverage mismatch: when our targeted WR is meaningfully
      // faster than the covering CB, a smart QB sees the step + lets it
      // develop. Bonus only applies when the QB is composed enough to wait.
      let mismatchBonus = 0;
      if (wrSlotKey && qbPocketBonus > 0) {
        const cbName2 = this.defR.starters[wrSlotKey];
        const cbPlayer2 = cbName2 ? this._playerByName?.get?.(cbName2) : null;
        const cbCov2 = cbPlayer2?.stats?.[8] ?? 65;
        // Effective speed accounts for weight + AGI burst — a heavier WR
        // with the same SPD doesn't shake coverage as easily.
        const wrSpd  = effectiveSpeed(rcvrPlayer, 15);
        const speedAdv = wrSpd - cbCov2;   // positive when WR has the step
        if (speedAdv > 6) {
          mismatchBonus = qbPocketBonus * 0.45 * Math.min(1, (speedAdv - 6) / 14);
        }
      }
      // ── DEFENSIVE ARCHETYPE EFFECTS ─────────────────────────────────────
      //  COVER LB        → reduces TE/RB completion %
      //  SIGNAL LB       → smart play recognition, mild comp% suppression
      //  ZONE CB         → caps WR juke / explosive YAC (handled below)
      //  PHYSICAL CB     → jams the WR — reduces speed mismatch bonus
      //  SLOT_CB         → better vs SLOT WR (handled at slot matchup)
      //  CENTER_FIELD S  → caps deep passing (reduces air yards on deep throws)
      const coverLBs = (defArch.LB || []).filter(l => l?.archetype === "COVER").length;
      const signalLBs = (defArch.LB || []).filter(l => l?.archetype === "SIGNAL").length;
      // HYBRID (3-down) LBs hold up in coverage too — partial credit vs COVER.
      const hybridLBs = (defArch.LB || []).filter(l => l?.archetype === "HYBRID").length;
      // Uniform per-COVER-LB term (was 0.040 for TE/RB targets). The heavy
      // TE/RB-target weight DOUBLE-COUNTED with the new individual cbCoverMod:
      // a COVER LB covering a TE got his COV rating applied via cbCoverMod
      // AND an archetype penalty here for the same matchup. coverLbMod is now
      // purely a "COVER LBs on the field tighten the underneath" term; the
      // DIRECT cover man's skill comes solely from cbCoverMod (his actual COV).
      const coverLbMod = -(coverLBs * 0.012) - (hybridLBs * 0.007);
      const signalLbMod = -(signalLBs * 0.012);
      // Physical CB jam — kills the speed mismatch if our targeted WR is on
      // a press corner. Only applies when the targeted slot matches.
      let physicalJamMod = 0;
      if (wrSlotKey) {
        const cbName3 = this.defR.starters[wrSlotKey];
        const cbPlayer3 = cbName3 ? this._playerByName?.get?.(cbName3) : null;
        if (cbPlayer3?.archetype === "PHYSICAL") {
          physicalJamMod = -0.025;
          // Also zero out the mismatchBonus when the WR was getting beat off the line
          mismatchBonus *= 0.4;
        }
      }
      // ZONE CB caps the post-catch chunk play. Stored for the YAC section
      // below.
      const zoneCB = wrSlotKey ? (this.defR.starters[wrSlotKey]
        ? this._playerByName?.get?.(this.defR.starters[wrSlotKey])?.archetype === "ZONE"
        : false) : false;
      // Weather: slippery ball (rain/snow) drops completion %, wind hurts
      // deep passes (caught further below in airMean adjustment).
      const wxPass = this.weather || { label: "CLEAR" };
      // WINDY/HOT were previously no-ops on completion: WINDY only tilted air
      // yards by wind DIRECTION (averaging to ~0 across games) and HOT did
      // nothing despite its "minor fatigue late" intent. Wind disrupts timing
      // and ball flight both ways → a small NET comp penalty; HOT legs tire.
      const wxCompMod = wxPass.label === "RAIN"  ? -0.05
                      : wxPass.label === "SNOW"  ? -0.08
                      : wxPass.label === "WINDY" ? -0.015 - (wxPass.windStrength || 0) * 0.025
                      : wxPass.label === "HOT"   ? -0.015
                      : 0;
      // Defensive-scheme tilt: nickel / dime tighten pass coverage, 46 blitz leaves windows open.
      // DC Cover Scheme: -3% completion rate for the offense
      const dcCoverSchemeMul = _dcTrait === "Cover Scheme" ? 0.97 : 1.0;
      // Red-zone completion bump — throws are shorter (fade, slant, hi-low
      // concepts), DBs play tighter coverage but quarterback completion
      // rates actually rise inside the 20. NFL RZ comp% is ~4pp higher than
      // overall. Goal-to-go bumps another ~2pp.
      // Defense tightens LOGARITHMICALLY as field shrinks. yL 80 (RZ entry)
      // = no penalty; yL 95 (5 to go) = significant; yL 99 (goal-to-goal)
      // = heavy. Log curve gives diminishing returns mid-RZ so the cliff
      // hits at the goal line, matching NFL RZ TD% by yard line.
      const rzPenalty = this._inRedZone ? Math.log(1 + Math.max(0, this.yardLine - 80) / 4) : 0;
      // Elite defensive playmakers amplify RZ disruption — top OVR DL/LB/S
      // collapse the pocket faster + close windows in compressed space.
      // 80 OVR = 0 extra; 95+ OVR = max bonus.
      const _rzEliteD = this._inRedZone
        ? Math.max(0, (Math.max(this.defR.dl, this.defR.lb, this.defR.saf) - 80) / 100)
        : 0;
      const rzCompBonus = -rzPenalty * 0.040 - _rzEliteD * 0.05;   // up to -17pp total
      // Fatigue effect — tired QB throws less accurately, tired secondary
      // gives up more catches. Net effect = (qbFatigue - secFatigue) * mod.
      // At max QB fatigue with fresh secondary, comp drops ~4pp.
      const _qbFat = this._fatigueLevel(this.offR.starters.qb);
      const _secFat = (this._fatigueLevel(this.defR.starters.cb1)
                    + this._fatigueLevel(this.defR.starters.cb2)) / 2;
      const fatigueCompMod = -(_qbFat - _secFat) / 100 * 0.04;
      // Momentum tilt — hot offense throws with confidence (+0.5pp per
      // momentum point, max ±5pp); hot defense plays tighter coverage.
      const momCompMod = ((this._momentum?.[this.poss] || 0)
                       -  (this._momentum?.[this.poss === "home" ? "away" : "home"] || 0)) * 0.0025;
      // Clutch/composure — late-and-close throws by ice-veins QBs are more
      // accurate (Brady "raises his level"); folders sag. Plus the target
      // receiver's composure (hands in the moment). Accuracy + catching only,
      // never physical. Migrated off _drive — which is now dev/effort only;
      // composure lives in the dedicated _clutch attribute (see _clutchMod).
      const clutchCompMod = this._clutchMod(this.offR.starters.qb, 0.04)
                          + this._clutchMod(rcvr, 0.03);
      const boxStackCompMod = this._boxStackCompMod || 0;
      // CONCEPT × COVERAGE matchup — hoisted before compPct so the
      // expected openness can modulate completion rate. Previously this
      // was picked inside the completion branch, so compPct didn't know
      // whether the route was beating the coverage. Result: wide-open
      // routes had the same comp% as covered ones, and the engine called
      // "incomplete" on plays where the visual showed the ball arriving
      // at a wide-open receiver.
      const _hoistedConcept = this._pickPassConcept(pb);
      const _hoistedCoverage = this._pickPassCoverage(defPbCurrent);
      const _hoistedReadP = PASS_CONCEPTS[_hoistedConcept]?.readSuccessVs?.[_hoistedCoverage] ?? 0.50;
      // Openness-driven comp% modifier. A 0.80-read matchup adds +9pp,
      // a 0.40-read matchup subtracts ~5pp. Open routes complete; covered
      // routes don't.
      const opennessCompMod = (_hoistedReadP - 0.55) * 0.35;
      // ── DEPTH-TIERED COMPLETION (first principles) ──────────────────────────
      // Deeper throws complete LESS even when open — longer flight, tighter window
      // — so a single depth-blind comp% let deep balls over-complete and fattened
      // the explosive-play / season-yardage tail. We pivot at league aDOT (~8) so the
      // AGGREGATE comp% is preserved while the SHAPE gets right: short ↑, deep ↓. And
      // QB quality separates MORE with depth (arm + accuracy) — elites hit the deep
      // ball, everyone completes the short stuff. This replaces a flat qbCompFromOvr.
      // ── REALIZED AIR YARDS (hoisted above the comp roll) ────────────────────
      // The QB commits to a target depth BEFORE the catch is resolved: read
      // success → the concept's primary depth, read failure → its fallback. This
      // draw used to live INSIDE the completion branch, so the depth-tiering
      // below (depthCompMod, qbDepthSkill, the arm gate, the underthrow) keyed off
      // _expDepth — a probability blend pinned near league aDOT (~8) with tiny
      // variance — and was therefore nearly inert: deep balls never actually got
      // the deep-ball penalty. Keying everything off the REALIZED per-throw depth
      // gives the shape its teeth (short ↑, deep ↓, arm separates with depth) while
      // the AGGREGATE comp% is preserved (mean airYds ≈ 8 = the pivot). It also lets
      // the audit bucket attempts/completions by true air yards instead of the blend.
      const _conceptDef = PASS_CONCEPTS[_hoistedConcept];
      const _readBase = (_conceptDef?.readSuccessVs?.[_hoistedCoverage] ?? 0.50) + 0.04;
      const _qbAwr = this._playerByName?.get?.(QB?.name)?.stats?.[3] ?? 70;
      const _qbReadMod = (_qbAwr - 70) / 200;
      const _pressReadCut = clamp(pressure * 0.10, 0, 0.20);
      const defDeepBonus = (defPbCurrent.deepCovMul - 1) * 4.5;   // -2 for prevent, +0.7 for blitz_46
      const _readMod = _qbReadMod - _pressReadCut + paAirMod * 0.02 - defDeepBonus * 0.015;
      const _readSuccess = Math.random() < clamp(_readBase + _readMod, 0.15, 0.92);
      let airYds = _readSuccess
        ? clamp(Math.round((_conceptDef?.primaryDepth ?? 8) + normal(0, _conceptDef?.primarySd ?? 3)), -2, 55)
        : clamp(Math.round((_conceptDef?.fallbackDepth ?? 4) + normal(0, _conceptDef?.fallbackSd ?? 2)), -2, 55);
      // Stick-aim safety: 3rd-and-long fallback shouldn't dump for a lost FD.
      const stickAim = (this.down >= 3 && this.ytg >= 8) ? Math.min(6, this.ytg - 8) : 0;
      if (stickAim > 0 && !_readSuccess && airYds < this.ytg - 1) {
        airYds = clamp(Math.round(airYds + stickAim * 0.6), -2, 55);
      }
      // Receiver-archetype aDOT shift (DEEP_THREAT deeper, SLOT/BLOCKING shorter).
      const archAirMod = rcvrArch === "DEEP_THREAT"  ?  4.5
                       : rcvrArch === "POSSESSION"   ? -1.5
                       : rcvrArch === "SLOT"         ? -3.0
                       : rcvrArch === "RED_ZONE"     ? -1.2
                       : rcvrArch === "ROUTE_RUNNER" ? -0.5
                       : rcvrArch === "BLOCKING"     ? -3.5  // blocking TE: short outlets only
                       : rcvrArch === "HYBRID"       ? -1.5  // hybrid TE: between receiving + blocking
                       : 0;
      // Intended-depth tilts that were declared-but-never-applied (dead) until the
      // realized-airYds draw was hoisted here. From first principles each shifts the
      // depth chart: RBs check down short (NFL RB aDOT ~0-1 vs WR ~9), aggressive QBs
      // throw deeper (mean-neutral spread), Air-Attack OCs push downfield, and box
      // count tilts shots (heavy personnel shortens, spread/obvious-pass deepens).
      const posAirMod      = rcvrPlayer?.position === "RB" ? -3.0 : 0;
      const qbAggAirMod    = (this._aggTilt(this._qbAggression()) - 1) * 3.0; // agg 80→+0.9, agg 20→−0.9
      const ocAirAttackMod = _ocTrait === "Air Attack" ? 1.0 : 0;
      const boxStackAirMod = this._boxStackAirMod || 0;
      // One combined tilt at the same 0.7 scale as the archetype shift, so the
      // concept model still drives the base depth and these only nudge it.
      const _airTilt = archAirMod + posAirMod + qbAggAirMod + ocAirAttackMod + boxStackAirMod;
      if (_airTilt) airYds = clamp(Math.round(airYds + _airTilt * 0.7), -2, 55);
      this._lastPassConcept = _hoistedConcept;
      this._lastPassCoverage = _hoistedCoverage;
      // Deeper throws complete LESS even when open — longer flight, tighter window.
      // Pivot at league aDOT (~8): short +, deep − (intrinsic), aggregate preserved.
      // Two regimes: a gentle base slope (0.013/air-yard — short throws plateau near
      // their ceiling, intermediate declines moderately), PLUS an extra penalty that
      // bites only past 15 air yards. Completion falls off faster the deeper you go,
      // but the short AND intermediate game keep their (correct) completion rates —
      // an earlier kink-at-the-pivot version over-taxed the healthy 8-14 bucket.
      const depthCompMod = (8 - airYds) * 0.013 - Math.max(0, airYds - 15) * 0.010;
      // AUDIT: tally dropback attempts by REALIZED intended air depth (short <8 /
      // mid 8-14 / deep ≥15 air yds). Completions are counted at each completion
      // site below via this._curTb. Lets _sim_audit report deep-ball tried/
      // completed rates against NFL.
      const _tb = airYds < 8 ? "short" : airYds < 15 ? "mid" : "deep";
      off.team["pa_" + _tb] = (off.team["pa_" + _tb] || 0) + 1;
      this._curTb = _tb;
      // ── DEPTH-WEIGHTED QB COMPLETION SKILL ──────────────────────────────────
      // Completion is a DIFFERENT skill at different depths (first principles):
      //   • short (≤5 yds): pure placement / timing / touch → ACCURACY (AWR) +
      //     TECHNIQUE (TEC). Arm is irrelevant — anyone completes a 5-yd out.
      //   • intermediate: accuracy still leads, velocity starts to matter.
      //   • deep (≥19): ARM (THR) drives it in, with an accuracy floor for
      //     placement; a noodle arm physically can't get there (→ underthrow).
      // Blend the two skill axes by depth. armWeight ramps 0 → 0.80 from 4 to 26
      // air yds (crossing 50/50 at the ~15-yd deep line); accWeight = 1-armWeight.
      // Both axes are centered on the league-average QB (AWR 75 / TEC 68 / THR 80)
      // so the average QB nets ZERO at every depth and the aggregate comp% is
      // preserved — only the per-depth SPREAD changes. This replaces the old flat
      // qbCompFromOvr + bolt-on arm bonus.
      const _qbThr = qbPlayer?.stats?.[4] ?? 80;
      const _qbAwrC = qbPlayer?.stats?.[3] ?? 75;
      const _qbTecC = qbPlayer?.stats?.[11] ?? 68;
      const _accSkill = (_qbAwrC - 75) * 0.62 + (_qbTecC - 68) * 0.38;   // accuracy composite, ~0 at avg
      const _armSkill = _qbThr - 80;                                      // arm, ~0 at avg
      const _armWeight = clamp((airYds - 4) / 22, 0, 0.80);               // short→0, deep→0.80
      const _accWeight = 1 - _armWeight;
      const qbDepthSkill = _accSkill * _accWeight * 0.0040 + _armSkill * _armWeight * 0.0048;
      // ── UNDERTHROW (Phase 2) ────────────────────────────────────────────
      // A below-average arm can't drive the deep ball there: it lands SHORT, the
      // receiver decelerates to come back, and the beaten defender closes for a
      // play. The INT outcome rides the arm-driven int rate upstream; here are
      // the NON-pick outcomes — a pass breakup, or a contested catch well short
      // of the target (lost separation → few yards). Deep throws, weak arms only.
      if (airYds >= 16 && _qbThr < 80) {
        const _utChance = clamp((airYds - 16) * 0.012 + (80 - _qbThr) * 0.015, 0, 0.45);
        if (Math.random() < _utChance) {
          const _utQB = this.offR.starters.qb;
          if (Math.random() < 0.55) {
            // PD — defender drives on the short ball and knocks it away
            const _utDB = this._creditDBStat("pd", { CB: 0.5, S: 0.35, LB: 0.15 });
            if (qbStats) qbStats.pass_att++;
            off.team.pass_att++;
            this._pushVisual({ kind: "incomplete", incReason: "underthrown", desc: `UNDERTHROWN — ${rcvr} has to come back, ${_utDB || "the DB"} closes and breaks it up`, startYard, endYard: startYard, targetDepth: airYds, passer: _utQB, defender: _utDB, isUnderthrown: true });
            return { yards: 0, incomplete: true };
          }
          // Contested catch SHORT — receiver fights back to it, hauls it in well
          // short of the intended marker.
          const _utYds = Math.max(2, Math.round(airYds * (0.40 + Math.random() * 0.25)));
          if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += _utYds; if (_utYds > qbStats.pass_long) qbStats.pass_long = _utYds; }
          if (this._curTb) off.team["pc_" + this._curTb] = (off.team["pc_" + this._curTb] || 0) + 1;   // audit: contested-short still completes (deep)
          const _utRS = off.players[rcvr];
          if (_utRS) { _utRS.rec_tgt++; _utRS.rec++; _utRS.rec_yds += _utYds; }
          off.team.pass_att++; off.team.pass_comp++; off.team.passYds += _utYds; off.team.totalYds += _utYds;
          this._pushVisual({ kind: "complete", desc: `${rcvr} comes back for the underthrown ball — short of the marker (+${_utYds})`, startYard, endYard: clamp(startYard + _utYds, 0, 100), receiver: rcvr, passer: _utQB, yards: _utYds, isUnderthrown: true });
          return { yards: _utYds };
        }
      }
      const compPct = clamp((0.62 + adv * 0.13 + qbDepthSkill + depthCompMod - pressure * 0.10 - shutdownPenalty + possessionBonus + qbCompMod + paCompMod + catCompMod + awrCompMod + cbCoverMod + mismatchBonus + coverLbMod + signalLbMod + physicalJamMod + wxCompMod + archCompMod + rzCompBonus + fatigueCompMod + momCompMod + clutchCompMod + boxStackCompMod + opennessCompMod) * compPbMul * defPbCurrent.passMul * dcCoverSchemeMul, 0.15, 0.95);
      if (Math.random() < compPct) {
        // Air yards drop when pressure shortens the QB's reads (check-downs / dump-offs)
        // Weaker QBs also throw shorter — they can't push the ball downfield reliably.
        // Composed QBs (high AWR) push the ball further by extending the play
        // and waiting for the deep route to break open.
        // Air-yards boost from OVR halved: was /12 giving 99-OVR +2.0
        // air-yards. Combined with the higher base airYdsMean (7.5)
        // and YAC layer this produced ~13-15 yd avg completions for
        // elites — too high. /24 keeps the elite advantage but
        // compresses to ~+1.0yd at 99 OVR.
        const qbAirFromOvr = (this.offR.qb - 75) / 24;
        const qbPocketAirBonus = Math.max(0, qbPocketBonus) * 2.0;
        // CENTER_FIELD safety caps deep passing — pulls the air mean down
        // when a rangy single-high safety is on the field. Range scales
        // with the safety's actual effective speed (a "rangy" safety
        // with elite SPD + light body covers more ground than a
        // slow safety with the archetype but bad measurables).
        const centerFieldSafeties = (defArch.S || []).filter(s => s?.archetype === "CENTER_FIELD");
        let centerFieldCap = 0;
        for (const s of centerFieldSafeties) {
          const safPlayer = this._playerByName?.get?.(s?.name);
          // 35yd sustained chase — SPD dominates. Light + fast S covers
          // ~1.5 yds; heavy slow S covers ~0.7 yds.
          const eSpd = safPlayer ? effectiveSpeed(safPlayer, 35) : 75;
          centerFieldCap -= 0.6 + (eSpd - 75) * 0.04;
        }
        // Weather: wind crushes deep balls into the headwind, rain/snow
        // make all throws slightly shorter (slippery ball).
        const teamPassDir = this.poss === "home" ? 1 : -1;
        const passWindWith = wxPass.windStrength
          ? wxPass.windStrength * (wxPass.windDir === teamPassDir ? 1 : -1)
          : 0;
        const wxAirMod = wxPass.label === "WINDY" ? -((wxPass.windStrength || 0) * 1.8) + passWindWith * 2.0
                       : wxPass.label === "SNOW"  ? passWindWith * 2.0 - 1.5
                       : wxPass.label === "RAIN"  ? -1.0
                       : 0;
        // (posAirMod / qbAggAirMod / ocAirAttackMod / boxStackAirMod are now applied
        // to the REALIZED airYds up in the hoisted draw — see the "_airTilt" combine.)
        // +0.8 -> +1.5: YAC trim cut offense too much (YPA fell to 0.91x).
        // Partial restore — passes back to ~7.0 yds avg without re-inflating
        // sacks or RZ.
        // Concept, coverage, read success and the REALIZED airYds were drawn and
        // applied ABOVE the comp roll (the QB commits to a target depth before the
        // catch resolves — see "REALIZED AIR YARDS"); airYds is in scope here.
        // YAC distribution — short catches / screens get more YAC potential.
        // Tuned to land NFL-average ~4.5 yds YAC per completion. The prior
        // "bumped YAC" (mean ~5.5) was a band-aid for the bimodal single-
        // normal pass system that wasn't producing enough chunks via
        // airYds. With the class-mixture air-yards model (concepts deliver
        // chunks structurally), the YAC bump double-counts and pushes
        // pass YPA past NFL. Dialed back closer to NFL baseline.
        let yac = 0;
        if (airYds >= 1) {
          const r = Math.random();
          if (r < 0.25) yac = 0;
          else if (r < 0.65) yac = rand(1, Math.max(3, Math.floor(airYds * 0.55)) + 2);
          else if (r < 0.94) yac = rand(3, Math.max(7, Math.floor(airYds * 0.9)) + 3);
          else                yac = rand(4, 12) + Math.floor(airYds * 0.4);
        }
        // YAC archetype tilt: SLOT and POSSESSION lead the league but the
        // prior 1.45/1.25 stacked with high base YAC pushed top WR season
        // yards 40-50% over NFL. Tightened so the archetype tilt models
        // real spread (~10-15%) without inflating leaderboards.
        const yacArchMul = rcvrArch === "SLOT"        ? 1.15
                         : rcvrArch === "POSSESSION"  ? 1.05
                         : rcvrArch === "ROUTE_RUNNER" ? 1.00
                         : rcvrArch === "RED_ZONE"    ? 0.55
                         : rcvrArch === "DEEP_THREAT" ? 0.85
                         : rcvrArch === "BLOCKING"    ? 0.70  // not a YAC threat
                         : rcvrArch === "HYBRID"      ? 0.88  // hybrid TE: modest YAC
                         : 1.0;
        yac = Math.round(yac * yacArchMul);
        // YAC break-tackle — physics model. Receiver's archetype maps to
        // ELUSIVE (SLOT/ROUTE_RUNNER) / POWER (RED_ZONE/big TEs) / SPEED
        // (DEEP_THREAT). Mass + AGI mismatches decide whether the first DB
        // in coverage gets trucked, juked, or wraps cleanly. ZONE CBs are
        // already in the tackler pool — disciplined coverage gets sampled
        // normally and benefits from base TCK rating.
        let wrJuke = false;
        let yacBrokenTackles = 0;
        const rcvrP = this._playerByName.get(rcvr);
        if (rcvrP && yac > 0) {
          const recBreakStyle = _archetypeBreakStyle(rcvrP.archetype) || _archetypeBreakStyle(rcvrArch);
          // ZONE CB suppresses YAC explosiveness — break chance scaled by 0.6.
          // We approximate this by halving bonus yards via a re-roll: if the
          // break fires under zone, downgrade to a non-explosive bonus.
          const br = this._resolveBreakTackle({
            carrierName: rcvr, yards: yac,
            breakStyle: recBreakStyle,
            tacklerArchByPos: this.defArch,
            tacklerStatsPlayers: this.defStats?.players,
            tacklerZones: _YAC_TACKLER_ZONES,
            gangDist: _YAC_GANG_DIST,
          });
          if (br.brokenTackles > 0) {
            wrJuke = true;
            const zoneMul = zoneCB ? 0.6 : 1.0;
            // SLOT is shifty for EXTRA yards but lives in the quick game — it
            // shouldn't house-call from the slot. Dampen its explosive break
            // bonus so it wins on consistent YAC, not 50-yd catch-and-runs.
            const slotMul = rcvrArch === "SLOT" ? 0.60 : 1.0;
            // YAC contexts get 75% of break bonus (receivers don't sprint as
            // far after break as RBs in space).
            yac += Math.round(br.bonusYards * zoneMul * slotMul * 0.75);
            yacBrokenTackles = br.brokenTackles;
          }
        }
        // SLOT per-catch ceiling — high floor, low ceiling. Keeps the slot a
        // YAC volume weapon without letting it top the team in long gains
        // (that's the deep threat's job).
        if (rcvrArch === "SLOT") yac = Math.min(yac, 26);
        const targetDepth = Math.max(1, Math.round(airYds));
        // Cap at distance to end zone so a 3-yd goal-line catch doesn't get reported as a 25-yd TD
        const yards = Math.min(clamp(targetDepth + yac, -2, 95), 100 - startYard);
        // MFF coverage attribution: a completion was allowed against the cover man.
        // Credit completion + yards-allowed (through-the-air gain). Additive, no RNG.
        if (this._MFF_ATTR && _coverName && def.players[_coverName]) {
          def.players[_coverName].cover_comp = (def.players[_coverName].cover_comp || 0) + 1;
          def.players[_coverName].cover_yds  = (def.players[_coverName].cover_yds  || 0) + yards;
        }
        // (receiver was picked above, before the comp roll)
        // Throw type — QB picks based on situation + archetype:
        //  CHECKDOWN (≤4 yds): low arc, fast — short outlet
        //  ZIP (5-18 yds, tight window): low arc + max velocity — threading the needle
        //  TOUCH (5-18 yds, soft route): higher arc + slower — gentle drop-in
        //  DEEP (≥19 yds): big arc, max distance
        const throwTypeRoll = Math.random();
        let throwType;
        if (airYds <= 4) {
          throwType = "CHECKDOWN";
        } else if (airYds >= 19) {
          throwType = "DEEP";
        } else {
          // Mid-range: pick TOUCH vs ZIP based on QB archetype + situation
          const zipBias = qbArch === "GUNSLINGER" ? 0.65
                       : qbArch === "GAME_MANAGER" ? 0.20
                       : qbArch === "POCKET" ? 0.40
                       : qbArch === "FIELD_GENERAL" ? 0.45
                       : 0.50;
          // Tight windows (3rd-and-medium, red zone) favor ZIP
          const tightBoost = (isThird && this.ytg >= 5) ? 0.15 : 0;
          throwType = throwTypeRoll < (zipBias + tightBoost) ? "ZIP" : "TOUCH";
        }
        // CATCH RADIUS — combined CAT + AGI + AWR + a body-size bump determines
        // how big a window the receiver can pluck the ball from. Drives high-
        // point catch ability on deep / contested throws.
        const rcat = rcvrPlayer?.stats?.[5] ?? 65;
        const ragi = rcvrPlayer?.stats?.[2] ?? 65;
        const rawr = rcvrPlayer?.stats?.[3] ?? 65;
        const bodyBonus = rcvrPlayer?.bodyType === "BROAD" ? 4
                        : rcvrPlayer?.bodyType === "TALL_HEAVY" ? 6
                        : rcvrPlayer?.bodyType === "LEAN" ? 2 : 0;
        const catchRadius = rcat * 0.4 + ragi * 0.35 + rawr * 0.25 + bodyBonus;  // 0-100ish
        // Deep / high passes trigger a LEAP — receiver gets airborne to high-point
        // the ball. We mark this as cosmetic since the comp/incomp decision
        // was already made above (this branch is the COMPLETED case).
        const isLeapingCatch = airYds >= 16 && (
          catchRadius >= 75 || (catchRadius >= 60 && Math.random() < 0.5)
        );
        // POST-CATCH FUMBLE — receiver loses ball during YAC. Higher chance
        // with low CAT (juggled catches), big YAC (defenders punching out),
        // or contested grab. Real NFL: ~0.5% per reception.
        const rcvrCatStat = rcvrPlayer?.stats?.[5] ?? 70;
        // Tuned to land per-catch fumble rate near NFL 0.5%. Big YAC and low
        // CAT amplify; elite receivers (CAT 90+) bring it under 0.3%.
        const yacFumbleChance = yac > 0
          ? clamp(0.003 + Math.max(0, (yac - 5) / 500) - Math.max(0, (rcvrCatStat - 75) / 1200) - this._clutchMod(rcvr, 0.004), 0.001, 0.012)
          : 0;
        if (Math.random() < yacFumbleChance) {
          // Catch happens at catchYL. Ball comes out somewhere in YAC.
          const catchYL = clamp(startYard + Math.max(1, Math.round(airYds)), 1, 99);
          const yacToFumble = Math.max(0, Math.floor(yac * (0.30 + Math.random() * 0.55)));
          const fumbleAdvance = Math.max(0, Math.round(airYds)) + yacToFumble;
          const fumbleYL = clamp(startYard + fumbleAdvance, 1, 99);
          const recoveredBy = Math.random() < 0.55 ? "def" : "off";
          const ffBy = this._creditDefStat("ff", { S: 0.35, CB: 0.30, LB: 0.30, DL: 0.05 });
          const ylDesc = (y) => y <= 50 ? `own ${y}` : `opp ${100 - y}`;
          if (recoveredBy === "def") {
            // Turnover. Credit catch + yards-to-fumble.
            if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += fumbleAdvance; }
            if (rcvrStats) {
              rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += fumbleAdvance;
              rcvrStats.fumbles = (rcvrStats.fumbles || 0) + 1;
              rcvrStats.fumbles_lost = (rcvrStats.fumbles_lost || 0) + 1;
            }
            this._bumpPlayerWear(rcvr, 0.6);  // got drilled and lost the ball
            off.team.pass_att++; off.team.pass_comp++; off.team.passYds += fumbleAdvance; off.team.totalYds += fumbleAdvance;
            off.team.fumbles = (off.team.fumbles || 0) + 1;
            off.team.fumbles_lost = (off.team.fumbles_lost || 0) + 1;
            off.team.turnovers = (off.team.turnovers || 0) + 1;
            def.team.takeaways = (def.team.takeaways || 0) + 1;
            const frBy = this._creditDefStat("fr", { S: 0.40, CB: 0.35, LB: 0.20, DL: 0.05 });
            this._pushVisual({
              kind: "fumble",
              desc: `${rcvr} catches at the ${ylDesc(catchYL)}, FUMBLES at the ${ylDesc(fumbleYL)} — recovered by ${frBy || "defense"}${ffBy ? `, forced by ${ffBy}` : ""}!`,
              startYard, endYard: fumbleYL,
              catchYL, fumbleYL, receiver: rcvr, passer: this.offR.starters.qb,
              defender: frBy, forcedBy: ffBy, recoveredBy: "def",
              motion: { result: "passFumbleLost", catchYL, fumbleYL, fumbleT: 0.65, scrumT: 0.90,
                        forcedBySlot: this._resolveDefSlot(ffBy) },
            });
            this._lastBallCarrier = rcvr; this._lastBallType = "pass";
            const defSide = this.poss === "home" ? "away" : "home";
            this._swingMomentum(defSide, 3, "FUMBLE");
            return { turnover: true, fumbleSpotYL: fumbleYL };
          } else {
            // Offense recovers. Receiver gets yards UP TO fumble, then small loss on the dive.
            const lossOnDive = rand(1, 4);
            const netYds = Math.max(0, fumbleAdvance - lossOnDive);
            if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += netYds; }
            if (rcvrStats) {
              rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += netYds;
              rcvrStats.fumbles = (rcvrStats.fumbles || 0) + 1;
            }
            this._bumpPlayerWear(rcvr, 0.5);
            off.team.pass_att++; off.team.pass_comp++; off.team.passYds += netYds; off.team.totalYds += netYds;
            off.team.fumbles = (off.team.fumbles || 0) + 1;
            this._pushVisual({
              kind: "fumble",
              desc: `${rcvr} fumbles after catch at the ${ylDesc(fumbleYL)} — offense recovers, net ${netYds} yds!`,
              startYard, endYard: clamp(startYard + netYds, 0, 100),
              catchYL, fumbleYL, receiver: rcvr, passer: this.offR.starters.qb,
              forcedBy: ffBy, recoveredBy: "off",
              motion: { result: "passFumbleRecoveredOff", catchYL, fumbleYL, fumbleT: 0.65, scrumT: 0.90,
                        forcedBySlot: this._resolveDefSlot(ffBy) },
            });
            this._lastBallCarrier = rcvr; this._lastBallType = "pass";
            return { yards: netYds };
          }
        }
        if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
        if (this._curTb) off.team["pc_" + this._curTb] = (off.team["pc_" + this._curTb] || 0) + 1;   // audit: completion by intended air depth
        if (rcvrStats) {
          rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards;
          if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards;
          if (yacBrokenTackles) rcvrStats.broken_tackles = (rcvrStats.broken_tackles || 0) + yacBrokenTackles;
        }
        off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
        this._lastBallCarrier = rcvr; this._lastBallType = "pass";
        // Tackle credit on the catch — play-context driven. Air-yards
        // bucket determines whether it's short/mid/deep; the picker
        // weights shift heavily (deep pass → almost always a safety).
        const isTD = clamp(startYard + yards, 0, 100) >= 100;
        const depthBucket = airYds >= 20 ? "deep" : airYds >= 10 ? "mid" : "short";
        // sideHint: targeted-WR slot → field side, so the credited tackler
        // lines up with where the catch actually happened. Without this,
        // a deep right-sideline catch could credit the left CB.
        const _passSideHint = rcvr === this.offR.starters.wr1 ? "left"
                            : rcvr === this.offR.starters.wr2 ? "right"
                            : rcvr === this.offR.starters.te  ? "right"
                            : rcvr === this.offR.starters.rb  ? "middle"
                            : "middle";
        const passCtx = { type: "pass", depth: depthBucket, sideHint: _passSideHint };
        const tacklerName = (yards > 0 && !isTD) ? this._creditTackle(passCtx) : null;
        this._bumpHitWear(rcvr, 0.25, tacklerName, { playContext: passCtx });
        const flavorTag = wrJuke ? " (CATCH AND JUKE!)"
                        : isLeapingCatch ? " (HIGH POINTED!)" : "";
        const endTag = isTD ? " — TOUCHDOWN!"
                     : tacklerName ? `, tackled by ${tacklerName}` : "";
        // ── PATH B Phase 4 — per-slot route tracks for ALL receivers ────
        // Engine emits route waypoints for EVERY receiver on the field
        // (targeted + decoys) so animation doesn't fall back to hash
        // decoys for non-targets. Each track is keyed by formation slot
        // ("wr1", "wr2", "wr3", "wr4", "te", "te2", "rb") with
        // origin: { slot }; waypoints are deltas in YARDS where dyYd is
        // "toward midfield" (positive = inside break, negative = toward
        // sideline). Targeted slot gets the full track that ends at the
        // catch + YAC spot; non-targeted slots get a route ending at
        // their concept-appropriate spot (no catch, just the route).
        //
        // IDENTITY FIX (was: collapse to 4 slots). The credited receiver
        // now maps to its OWN formation slot so the animation draws the
        // RIGHT sprite (right jersey) making the catch — no more
        // "shows the wrong person." pickReceiver (play-data.js) only ever
        // credits wr1/wr2/wr3/wr4/te/te2/rb, and only when that slot is on
        // the field for the current personnel (wr3 needs 3WR, wr4 needs
        // 4WR, te2 needs 2TE), so every slot emitted here has a real,
        // correctly-numbered sprite + its own route track. The renderer
        // resolves play.motion.targetSlot via formation[slot]; if it can't
        // (an off-field slot — only reachable through the defensive
        // fallback below) it hash-picks a decoy, so the fallback still maps
        // to an always-present primary slot to avoid a teleport.
        const _targetSlot = rcvr === this.offR.starters.wr1 ? "wr1"
                          : rcvr === this.offR.starters.wr2 ? "wr2"
                          : rcvr === this.offR.starters.wr3 ? "wr3"
                          : rcvr === this.offR.starters.wr4 ? "wr4"
                          : rcvr === this.offR.starters.wr5 ? "wr4"   // rare: 5th WR → nearest on-field slot
                          : rcvr === this.offR.starters.te  ? "te"
                          : rcvr === this.offR.starters.te2 ? "te2"
                          : rcvr === this.offR.starters.te3 ? "te2"   // rare: 3rd TE → te2 sprite
                          : rcvr === this.offR.starters.rb  ? "rb"
                          : rcvr === this.offR.starters.rb2 ? "rb"    // rare: 2nd RB → rb slot
                          : rcvr === this.offR.starters.fb  ? "rb"    // FB → backfield slot
                          // Defensive fallback by position — guarantees an
                          // always-present primary slot for an unexpected name.
                          : (() => {
                              const _pos = this._playerByName.get(rcvr)?.position;
                              return _pos === "TE" ? "te"
                                   : (_pos === "RB" || _pos === "FB") ? "rb"
                                   : "wr2";
                            })();
        // Animation uses scaledDuration(max(targetDepth, yards, 8)) +
        // POST_CATCH_MS to time the play. Mirror that here so engine's
        // routeT (0=snap, 1=settled) aligns with animation's aT.
        const _scaledMs = Math.max(2200, Math.min(11500, Math.abs(Math.max(targetDepth, yards, 8)) / 12 * 1000 + 1000));
        const _postCatchMs = isTD ? 2400 : 1700;
        const _actionMs   = _scaledMs + _postCatchMs;
        const _throwT     = _scaledMs / _actionMs;
        // Per-slot route tracks — shared with incomplete + INT via the helper.
        const _routeTracks = this._buildPassRouteTracks({
          targetSlot: _targetSlot, targetDepth, yac,
          concept: this._lastPassConcept, throwT: _throwT,
        });
        const _hasTracks = Object.keys(_routeTracks).length > 0;
        // ── PATH B Phase 5 — post-catch tackler pursuit track ────────
        // Mirror of Phase 3a's run-play tackler track, but for the
        // receiver-after-the-catch case. Engine derives the tackler's
        // formation role from the credited tackler's name (defR.starters
        // lookup), emits a pursuit path that converges on the YAC
        // endpoint at t=0.78. Animation samples instead of running the
        // sim-physics post-catch pursuit, which used to teleport the
        // tackler to whoever was geometrically closest (often disagreed
        // with the named tackler).
        const _passTacklerSlot = this._resolveDefSlot(tacklerName);
        const _passTacklerTrack = _passTacklerSlot
          ? this._buildPassTacklerTrack({
              tacklerSlot: _passTacklerSlot, tacklerName,
              targetSlot: _targetSlot, targetDepth, yac,
              throwT: _throwT, routeTracks: _routeTracks,
            })
          : null;
        // ── PATH B Phase 7b — coverage-aware LB / safety tracks ────
        // _buildPassZoneDrops now varies by play.coverage: BLITZ →
        // LBs charge QB; MAN → LBs cover TE/RB; ZONE → drop to hooks;
        // TAMPA_2 → MLB drops deep middle, etc.
        const _secondaryPassTracks = this._buildPassZoneDrops({
          tacklerSlot: _passTacklerSlot,
          throwT: _throwT,
          coverage: this._lastPassCoverage,
          catchDepth: targetDepth,
        });
        // ── PATH B Phase 4.2 — throwType + dropDepth ────────────────
        // Animation was defaulting every completion to TOUCH because
        // the engine never emitted throwType for normal passes. Engine
        // decides based on depth + QB throw skill: DEEP for 20+ yds,
        // ZIP for short-to-mid with a strong arm, CHECKDOWN for
        // backfield outlets, TOUCH for everything in between.
        // dropDepth: 3-step (short), 5-step (mid), 7-step (deep / PA).
        const _throwTypeEmit = (() => {
          if (targetDepth >= 20) return "DEEP";
          if (targetDepth < 5)   return "CHECKDOWN";
          if (targetDepth >= 8 && qbThr >= 82) return "ZIP";
          return "TOUCH";
        })();
        const _dropDepthEmit = isPlayAction ? 7
                             : targetDepth >= 20 ? 7
                             : targetDepth >= 10 ? 5
                             :                     3;
        this._pushVisual({
          kind: "complete",
          desc: `${this.offR.starters.qb} → ${rcvr} for ${yards} yds${flavorTag}${endTag}`,
          startYard, targetDepth, catchDepth: targetDepth, yac, yards,
          endYard: clamp(startYard + yards, 0, 100), receiver: rcvr, passer: this.offR.starters.qb,
          tackler: tacklerName, throwType: _throwTypeEmit,
          isPlayAction, isFleaFlicker, wrJuke, isLeapingCatch, catchRadius,
          concept: this._lastPassConcept, coverage: this._lastPassCoverage,
          motion: _hasTracks ? {
            targetSlot: _targetSlot,
            throwT: _throwT,
            dropDepth: _dropDepthEmit,
            tackleT: 0.78,
            tacklerSlot: _passTacklerSlot,
            tacklerName,
            // Phase 4+ readers key on slot directly (tracks.wr1 etc).
            tracks: { ..._routeTracks,
                      ..._passTacklerTrack ? { tackler: _passTacklerTrack } : {},
                      ..._secondaryPassTracks },
          } : null,
        });
        return { yards };
      }
      // Incompletions land at the REALIZED intended depth (hoisted airYds) so a
      // deep miss visibly sails deep and the batted/leap logic keys off true depth.
      const targetDepth = clamp(Math.max(1, Math.round(airYds)), 1, 55);
      // (rcvr/rcvrStats/rcvrPlayer/rcvrCat already in scope from the outer pass block)
      if (qbStats) qbStats.pass_att++;
      if (rcvrStats) rcvrStats.rec_tgt++;
      off.team.pass_att++;
      // Drop chance — on a missed-comp, was this a drop or off-target? Lower-CAT
      // receivers are way more likely to be the drop side of the equation.
      const archMul = rcvrPlayer?.archetype === "POSSESSION" ? 0.55
                    : rcvrPlayer?.archetype === "DEEP_THREAT" ? 1.25
                    : 1.0;
      const dropBase = clamp((90 - rcvrCat) / 220 + 0.035, 0.02, 0.30) * archMul;
      const isDrop = Math.random() < dropBase;
      let pdName = null;
      if (isDrop) {
        if (rcvrStats) rcvrStats.rec_drops = (rcvrStats.rec_drops || 0) + 1;
        off.team.drops = (off.team.drops || 0) + 1;
      } else {
        // 55% of non-drop incompletions are pass deflections (overthroughs,
        // throwways, bad releases account for the other ~45%)
        pdName = Math.random() < 0.55 ? this._creditDBStat("pd", { CB: 0.55, S: 0.30, LB: 0.15 }) : null;
      }
      // CATCH RADIUS / NEAR-MISS LEAP — for deep throws, the receiver leaps
      // and the ball flies past their fingertips. Cosmetic flag for the animation.
      const incRagi = rcvrPlayer?.stats?.[2] ?? 60;
      const incRawr = rcvrPlayer?.stats?.[3] ?? 60;
      const incCatchRadius = rcvrCat * 0.4 + incRagi * 0.35 + incRawr * 0.25;
      const isLeapMiss = !isDrop && targetDepth >= 18 && incCatchRadius >= 55;
      // ── INCOMPLETE REASON ──
      // Drop / leap-miss / PD are already determined above. For anything
      // else, pick a more specific reason so the animation actually shows
      // what happened instead of one generic falling-ball clip.
      let incReason = null;
      let incDesc = `${this.offR.starters.qb} pass incomplete`;
      if (isDrop) {
        incReason = "drop";
        incDesc = `DROP! ${rcvr} can't hang on`;
      } else if (isLeapMiss) {
        incReason = "leapmiss";
        incDesc = `${this.offR.starters.qb}'s pass sails through ${rcvr}'s hands`;
      } else if (pdName) {
        incReason = "pd";
        incDesc = `${this.offR.starters.qb} pass broken up by ${pdName}`;
      } else {
        // Generic incompletion — pick a specific reason. Weighting depends
        // on context (pressure, throw depth, QB stats).
        const qbThrLocal = qbPlayer?.stats?.[4] ?? 75;
        const isMobile = qbAgi >= 75;
        const wThrowaway  = (pressure > 0.5 && isMobile) ? 30 : 4;     // mobile QB under pressure
        const wBatted     = targetDepth < 8 ? 12 : 3;                  // short throws get tipped at LOS
        const wOverthrown = 25 + (pressure > 0 ? 15 : 0) + (qbThrLocal < 70 ? 12 : 0) + (targetDepth >= 15 ? 12 : 0);
        const wUndertrown = 16 + (pressure > 0 ? 8 : 0) + (qbThrLocal < 70 ? 10 : 0);
        const wOffTarget  = 20;
        const totalW = wThrowaway + wBatted + wOverthrown + wUndertrown + wOffTarget;
        let pick = Math.random() * totalW;
        const QB = this.offR.starters.qb;
        if      ((pick -= wThrowaway)  < 0) { incReason = "throwaway"; incDesc = `${QB} throws it away under pressure`; }
        else if ((pick -= wBatted)     < 0) { incReason = "batted"; const dl = this._creditDefStat("pd", { DL: 0.80, LB: 0.20 }); pdName = dl; incDesc = `${QB}'s pass batted down at the line${dl ? ` by ${dl}` : ""}`; }
        else if ((pick -= wOverthrown) < 0) { incReason = "overthrown"; incDesc = `${QB} OVERTHROWS ${rcvr}`; }
        else if ((pick -= wUndertrown) < 0) { incReason = "underthrown"; incDesc = `${QB}'s pass UNDERTHROWN — ${rcvr} can't reach it`; }
        else                                { incReason = "offtarget"; incDesc = `${QB}'s pass off-target — ${rcvr} can't get there`; }
      }
      // PATH B Phase 6 — incomplete also gets per-slot routes + LB drops
      // Slot WR (wr3) folded into "wr2" — see the matching comment on
      // _targetSlot above. Without this, incomplete passes to a slot WR
      // had no route track at all → animation picked a random WR and
      // the ball landed where the engine intended (wr3's spot) while
      // the rendered receiver was running an unrelated route. That's
      // the "WR teleports to the ball" report on dropped slot passes.
      const _incTargetSlot = rcvr === this.offR.starters.wr1 ? "wr1"
                           : rcvr === this.offR.starters.wr2 ? "wr2"
                           : rcvr === this.offR.starters.wr3 ? "wr3"
                           : rcvr === this.offR.starters.wr4 ? "wr4"
                           : rcvr === this.offR.starters.wr5 ? "wr4"
                           : rcvr === this.offR.starters.te  ? "te"
                           : rcvr === this.offR.starters.te2 ? "te2"
                           : rcvr === this.offR.starters.te3 ? "te2"
                           : rcvr === this.offR.starters.rb  ? "rb"
                           : null;
      const _incScaledMs = Math.max(2200, Math.min(11500, Math.abs(Math.max(targetDepth, 8)) / 12 * 1000 + 1000));
      const _incPostCatchMs = 600;
      const _incActionMs = _incScaledMs + _incPostCatchMs;
      const _incThrowT = _incScaledMs / _incActionMs;
      const _incRouteTracks = _incTargetSlot ? this._buildPassRouteTracks({
        targetSlot: _incTargetSlot, targetDepth, yac: 0,
        concept: this._lastPassConcept, throwT: _incThrowT,
      }) : {};
      const _incZoneDrops = this._buildPassZoneDrops({ tacklerSlot: null, throwT: _incThrowT, coverage: this._lastPassCoverage });
      const _incHasMotion = Object.keys(_incRouteTracks).length > 0;
      this._pushVisual({
        kind: "incomplete",
        desc: incDesc,
        startYard, targetDepth, endYard: startYard,
        passer: this.offR.starters.qb, intended: rcvr, defender: pdName,
        isDrop, isPlayAction, isFleaFlicker, isLeapMiss, incReason,
        concept: this._lastPassConcept, coverage: this._lastPassCoverage,
        motion: _incHasMotion ? {
          targetSlot: _incTargetSlot,
          throwT: _incThrowT,
          tracks: { ..._incRouteTracks, ..._incZoneDrops },
        } : null,
      });
      return { yards: 0, incomplete: true };
    }
    // Fumble chance — based on carrier's grip (STR + AWR), pressure, and archetype.
    // POWER backs cough it up more (carrying through contact); ELUSIVE less (rarely take direct hits).
    const optionMul = pb.qbRushFumbleMul || 1.0;
    const rbArch = this.offArch.RB?.archetype;
    const rbPlayer = this._playerByName.get(RB);
    // Ball security is mostly technique/awareness (AWR), only lightly strength.
    const grip = rbPlayer ? ((rbPlayer.stats[3] || 70) * 0.7 + (rbPlayer.stats[1] || 70) * 0.3) : 70;
    const gripMod = (72 - grip) / 1800;    // dampened so it can't swamp the archetype tilt
    // Archetype tilt is now ADDITIVE in rate space. A MULTIPLIER (×1.35) on the
    // grip-suppressed base was being canceled by POWER's high STR → power backs
    // ended up fumbling the LEAST, backwards from intent. POWER carries through
    // contact / fights for the extra yard with the ball exposed → fumbles more;
    // ELUSIVE avoids square hits → fewer.
    const archFumbleAdd = rbArch === "POWER" ? 0.0050 : rbArch === "ELUSIVE" ? -0.0035 : 0;
    // Weather: rain/snow makes the ball slippery → more fumbles.
    const wxFum = this.weather || { label: "CLEAR" };
    const wxFumMod = wxFum.label === "RAIN" ? 0.006
                   : wxFum.label === "SNOW" ? 0.010
                   : 0;
    // Base 0.030 -> 0.0085. The RB probe measured ~1 fumble per ~43 touches
    // originally (~2.5x NFL); grip/archetype/pressure/weather mods land an
    // average back near 1/80-90 carries. Elite-grip backs (floor 0.004) get
    // genuinely sure-handed; POWER backs in the rain still cough it up.
    // Base 0.0085 → 0.012. Sim-audit reported turnovers/g 0.84 vs band 0.90-2.10
    // and shutout/blowout rates under band — symptoms of too-low total fumbles.
    // 0.012/carry ≈ 1 fumble per 83 carries, matching NFL average. Fumbles drive
    // game-margin variance (lost lead changes, defensive TDs).
    const fumblePct = clamp((0.012 + gripMod + archFumbleAdd + Math.max(0, pressure) * 0.013 + wxFumMod - this._clutchMod(RB, 0.005)) * optionMul, 0.005, 0.12);
    if (Math.random() < fumblePct) {
      // Scrum-based recovery — the ball bounces in a pile of converging players.
      // Defense has a slight edge in open field (2-4 dive attempts each kick the
      // ball loose until someone secures it). About 58% defense recovery overall.
      // (Not to be confused with NFL-style "muffs" — those are punt-return drops.)
      const scrumDives = rand(2, 4);
      let recoveredBy = null;
      let scrumMisses = 0;
      for (let i = 0; i < scrumDives; i++) {
        if (Math.random() < 0.55) {        // 55% chance someone secures it this dive
          recoveredBy = Math.random() < 0.58 ? "def" : "off";
          break;
        }
        scrumMisses++;
      }
      if (!recoveredBy) recoveredBy = Math.random() < 0.58 ? "def" : "off";
      const ffBy = this._creditDefStat("ff", { LB: 0.35, DL: 0.40, S: 0.20, CB: 0.05 });
      // Credit the FUMBLE to the carrier (separate from "lost" — recovered own fumble still counts).
      const carrierFumStats = off.players[RB];
      if (carrierFumStats) carrierFumStats.fumbles = (carrierFumStats.fumbles || 0) + 1;
      off.team.fumbles = (off.team.fumbles || 0) + 1;
      // FUMBLE SPOT — fumbles don't all happen at the snap. Estimate a
      // realistic spot somewhere along the projected gain (so a RB rumbling
      // 8 yds before getting stripped recovers the ball downfield).
      // Distribution biased toward shorter gains: most strips happen
      // early in the run, before the carrier breaks free.
      const projectedYds = Math.max(0, Math.round(normal(2.5, 3.2)));
      const fumbleAdvance = Math.min(projectedYds, Math.max(0, 100 - startYard - 1));
      const fumbleSpotYL = clamp(startYard + fumbleAdvance, 1, 99);
      if (recoveredBy === "def") {
        off.team.turnovers++; def.team.takeaways++;
        off.team.fumbles_lost = (off.team.fumbles_lost || 0) + 1;
        if (carrierFumStats) carrierFumStats.fumbles_lost = (carrierFumStats.fumbles_lost || 0) + 1;
        // Carrier gets credit for the rushing yards UP TO the fumble.
        if (carrierFumStats && fumbleAdvance > 0) {
          carrierFumStats.rush_att++;
          carrierFumStats.rush_yds += fumbleAdvance;
        }
        this._bumpPlayerWear(RB, 0.8);  // fumble strip = a hard hit
        off.team.rush_att++; off.team.rushYds += fumbleAdvance; off.team.totalYds += fumbleAdvance;
        const frBy = this._creditDefStat("fr", { LB: 0.35, DL: 0.35, S: 0.20, CB: 0.10 });
        const spotDesc = fumbleAdvance > 0 ? ` (lost at the ${fumbleSpotYL <= 50 ? `own ${fumbleSpotYL}` : `opp ${100 - fumbleSpotYL}`})` : "";
        this._pushVisual({
          kind: "fumble",
          desc: `FUMBLE! Recovered by ${this[this.poss === "home" ? "away" : "home"].name} defense — ${ffBy ? `forced by ${ffBy}` : `loose ball`}!${spotDesc}`,
          startYard, endYard: fumbleSpotYL,
          rusher: RB, defender: frBy, forcedBy: ffBy, recoveredBy: "def", scrumMisses,
          fumbleSpotYL,
          motion: { result: "fumbleLost", fumbleT: 0.55, scrumT: 0.85, fumbleSpotYL,
                    forcedBySlot: this._resolveDefSlot(ffBy) },
        });
        const _defSideFum = this.poss === "home" ? "away" : "home";
        this._swingMomentum(_defSideFum, 3, "FUMBLE");
        return { turnover: true, fumbleSpotYL };
      } else {
        // Offense recovers — ball stays with them. Credit the yards UP to
        // the fumble, then subtract 2-6 yards for the dive (lost on the pile).
        const lossYds = rand(2, 6);
        const netYds = fumbleAdvance - lossYds;
        const carrierStats = off.players[RB];
        if (carrierStats) {
          carrierStats.rush_att++;
          carrierStats.rush_yds += netYds;
        }
        this._bumpPlayerWear(RB, 0.6);
        off.team.rush_att++; off.team.rushYds += netYds; off.team.totalYds += netYds;
        const finalYL = clamp(fumbleSpotYL - lossYds, 1, 99);
        this._pushVisual({
          kind: "fumble",
          desc: `FUMBLE! ${this.possTeam.name} recovers their own — ${netYds >= 0 ? "" : "net "}${netYds}-yd ${netYds >= 0 ? "gain" : "loss"} on the dive`,
          startYard, endYard: finalYL,
          rusher: RB, forcedBy: ffBy, recoveredBy: "off", scrumMisses,
          yards: netYds,
          motion: { result: "fumbleRecoveredOff", fumbleT: 0.55, scrumT: 0.85,
                    fumbleSpotYL, forcedBySlot: this._resolveDefSlot(ffBy) },
        });
        return { yards: netYds };
      }
    }
    // +1.6 baseline lift — landing rush yards slightly above NFL pace
    // (user asked for "slightly over NFL, not below"). Engine's run-stuff
    // modifiers overcompensate at the tail. Raises base to 5.9; realized
    // mean lands near 4.7, ~9% above NFL 4.3.
    // rushMean baseline trimmed to land NFL YPC ~4.4. leanForward bonus is
    // applied separately on every positive carry for heavy/strong backs.
    const rushMean = (pb.rushYdsMean ?? 4.3) - 0.2;
    const rushSd   = pb.rushYdsSd   ?? 5.5;
    // ── TWO-BACK FORMATION DECISION ────────────────────────────────────
    // Only when there's a viable second back on the roster. Probability
    // tilts by playbook (GROUND_AND_POUND uses it the most), and short
    // yardage / goal line bumps it.
    const hasRB2 = !!this.offR.starters.rb2;
    let useTwoBack = false;
    if (hasRB2) {
      let twoBackPct = 0.16;       // balanced default
      if (pb.id === "GROUND_AND_POUND") twoBackPct = 0.35;
      else if (pb.id === "AIR_RAID")    twoBackPct = 0.04;
      else if (pb.id === "OPTION")      twoBackPct = 0.22;
      if (this.ytg <= 2) twoBackPct += 0.20;     // power short yardage
      if (startYard >= 95) twoBackPct += 0.15;   // goal line
      useTwoBack = Math.random() < twoBackPct;
    }
    // FB lead-block bonus — bumps rush yardage, reduces stuff risk
    const fbBoost = useTwoBack ? 0.9 : 0;
    const fbStuffReduction = useTwoBack ? 0.4 : 0;   // subtracts from trench loss
    // ── DESIGNED QB RUNS — read-option / QB-power / draw / sneak ──────────
    // Previously this rate came ONLY from the playbook (`pb.qbRushPct`), which
    // just OPTION sets — so a Lamar/Vick-type on a BALANCED, AIR_RAID, or even
    // DUAL_THREAT scheme got ZERO designed carries and finished ~2 rush att/game
    // (all pressure-scrambles). Real peak dual-threats run 8-12x/game. The fix:
    // make the designed-run rate follow the QB (archetype + actual mobility),
    // layered on top of the playbook base, so the run game adapts to the player.
    let qbRushPct = pb.qbRushPct || 0;
    {
      const _qbP = this._playerByName?.get?.(QB);
      const _qbArch = _qbP?.archetype;
      const _qbSpd = _qbP?.stats?.[0] ?? 60;
      const _qbAgi = _qbP?.stats?.[2] ?? 60;
      // Mobility 0..1: ramps from SPD ~72 (pocket) toward ~92 (elite runner);
      // AGI nudges it (a quick-twitch QB keeps it more than a straight-line one).
      const _mob = clamp((_qbSpd - 72) * 0.055 + (_qbAgi - 70) * 0.020, 0, 1);
      if (_qbArch === "DUAL_THREAT") {
        // Designed-run identity: a floor (the offense is BUILT around his legs)
        // plus mobility. Elite wheels → ~0.32 of run calls become QB keepers.
        qbRushPct = Math.max(qbRushPct, 0.15 + _mob * 0.17);
      } else {
        // Even a pocket guy with surprising legs (or a G&P keeper package)
        // tucks it occasionally — but it never becomes his identity.
        qbRushPct = Math.max(qbRushPct, _mob * 0.10);
      }
    }
    let isQBRun = qbRushPct > 0 && Math.random() < qbRushPct;
    // SPEED OPTION — a subset of QB-run calls where the RB trails the QB
    // as a live pitch threat. The QB sprints to the option side and either
    // KEEPS the ball or PITCHES to the trailing back. Option-heavy
    // playbooks call it most.
    let isSpeedOption = false;
    let isPitch = false;
    let optionRead = null;       // {defAttacksQb, goesCorrect, optSide} when speed option fires
    if (isQBRun && this.offR.starters.rb) {
      const speedOptPct = pb.id === "OPTION"       ? 0.40
                        : pb.id === "DUAL_THREAT" ? 0.22
                        : 0.10;
      if (Math.random() < speedOptPct) {
        isSpeedOption = true;
        // Deterministic play-side (matches the animation's optSide).
        const optSide = ((startYard * 19) >>> 0) % 2 === 0 ? 1 : -1;
        // ── EDGE READ DEFENDER ────────────────────────────────────────
        // The playside DE / OLB defines the option's outcome. Aggregate
        // the team's edge tendencies: aggressive front-7 archetypes push
        // toward COMMITTING to the QB; disciplined LBs stay on the pitch.
        const defArchSO = this.defArch;
        const aggressive = (defArchSO.LB || []).filter(l =>
          l?.archetype === "BLITZER" || l?.archetype === "THUMPER").length
          + (defArchSO.DL || []).filter(d =>
              d?.archetype === "SPEED" || d?.archetype === "POWER").length * 0.5;
        const disciplined = (defArchSO.LB || []).filter(l =>
          l?.archetype === "COVER" || l?.archetype === "SIGNAL").length;
        // Use a specific edge defender's AWR for the commit roll (one of
        // the LBs — defaults to LB1).
        const edgeLb = (defArchSO.LB || [])[optSide === 1 ? 2 : 0]
                     || (defArchSO.LB || [])[0];
        const edgeAwr = edgeLb ? (this._playerByName?.get?.(edgeLb.name)?.stats?.[3] ?? 70) : 70;
        let defAttacksQbChance = 0.50 + (aggressive - disciplined) * 0.08;
        // High-AWR edges READ the play and adjust (slight bias toward the
        // correct commit). For simplicity we just add small noise here.
        defAttacksQbChance += (edgeAwr - 70) / 600;
        defAttacksQbChance = clamp(defAttacksQbChance, 0.20, 0.82);
        const defAttacksQb = Math.random() < defAttacksQbChance;
        // ── QB READ ACCURACY ──────────────────────────────────────────
        // Sharp QBs (high AWR) make the correct give vs keep most of the
        // time. The CORRECT read is "pitch if defender attacks QB" or
        // "keep if defender plays the pitch back". Look up QB AWR locally
        // since the option play is on the run-side branch, where the
        // pass-play scope (which defines qbAwr) isn't reachable.
        const _optQbPlayer = this._playerByName?.get?.(QB);
        const _optQbAwr    = _optQbPlayer?.stats?.[3] ?? 70;
        const qbReadAccuracy = clamp((_optQbAwr - 55) / 50, 0.30, 0.94);
        const goesCorrect = Math.random() < qbReadAccuracy;
        const correctRead = defAttacksQb;   // true = correct read says PITCH
        isPitch = goesCorrect ? correctRead : !correctRead;
        optionRead = { defAttacksQb, goesCorrect, optSide };
        // If the RB carries (pitch), isQBRun flips so the rest of the sim
        // (carrier, stats, animation routing) routes through the RB.
        if (isPitch) isQBRun = false;
      }
    }
    // REVERSE — rare trick play, ~1.5% of non-QB runs. RB takes the handoff
    // and runs laterally, then pitches to a crossing WR who runs the other way.
    // High variance: bigger gains AND bigger losses if it gets read.
    // Never on two-back — fullbacks don't run reverses.
    const isReverse = !isQBRun && !useTwoBack && !isSpeedOption && Math.random() < 0.015;
    // ── RUN-PLAY VARIANTS (counter / stretch / pitch) ──────────────────
    // Pick a runType for the non-reverse, non-QB runs. Distribution favors
    // GROUND_AND_POUND and OPTION schemes for counter / pitch, AIR_RAID
    // teams stick mostly to inside zone.
    let runType = "inside";   // default
    if (!isQBRun && !isReverse && !isSpeedOption) {
      const r = Math.random();
      if (pb.id === "GROUND_AND_POUND") {
        if      (r < 0.18) runType = "counter";
        else if (r < 0.36) runType = "stretch";
        else if (r < 0.42) runType = "pitch";
      } else if (pb.id === "OPTION") {
        if      (r < 0.12) runType = "counter";
        else if (r < 0.24) runType = "stretch";
        else if (r < 0.36) runType = "pitch";
      } else if (pb.id === "AIR_RAID") {
        if      (r < 0.05) runType = "counter";
        else if (r < 0.10) runType = "stretch";
      } else {  // BALANCED + others
        if      (r < 0.10) runType = "counter";
        else if (r < 0.22) runType = "stretch";
        else if (r < 0.26) runType = "pitch";
      }
    }
    // Per-variant yardage tuning — counter = boom/bust, stretch needs
    // athletic OL, pitch = chunk upside with TFL risk if read.
    let runVarMean = 0, runVarSd = 1.0;
    if (runType === "counter") {
      runVarMean = (this.offR.ol >= 78 ? 1.2 : 0.2);   // counters die against bad OL
      runVarSd   = 1.35;
    } else if (runType === "stretch") {
      runVarMean = (this.offR.ol >= 80 ? 1.4 : -0.6);  // stretch demands athletic OL
      runVarSd   = 1.15;
    } else if (runType === "pitch") {
      runVarMean = 0.6;                                 // get on the edge fast
      runVarSd   = 1.45;                                // big plays + big losses
    }
    // SPEED OPTION yardage — now driven by whether the QB made the
    // CORRECT read of the edge defender. A correct read means the defense
    // is wrong-footed: the carrier has an open lane (chunk play). A wrong
    // read means the defender is right there at the mesh point (stuff).
    if (isSpeedOption) {
      if (optionRead?.goesCorrect) {
        // Right read — chunk
        if (isPitch) { runVarMean = 1.8; runVarSd = 1.50; }
        else          { runVarMean = 1.4; runVarSd = 1.35; }
      } else {
        // Wrong read — defender meets the carrier near the LOS
        if (isPitch) { runVarMean = -2.5; runVarSd = 0.85; }
        else          { runVarMean = -1.8; runVarSd = 0.90; }
      }
    }
    // Committee split — give the change-of-pace back (rb2) a real share of
    // carries on standard runs. Previously rb2 only ever LEAD-BLOCKED in
    // two-back sets, so rb1 hogged ~98% of RB carries (lead share ~81% of the
    // backfield, vs the NFL's ~55-70% bell-cow). On a non-QB, non-two-back run
    // (two-back = rb2 is already the lead blocker), rb2 takes the carry ~32% of
    // the time → rb1 settles around a realistic ~62% of RB carries.
    // Committee split, QUALITY-WEIGHTED. A flat split made every team a 58/42
    // committee with no true workhorses; in reality an elite RB1 over a scrub
    // RB2 (Henry/CMC) hogs ~75-85%, while two similar backs share ~55/45. Scale
    // rb2's carry share by the OVR gap: equal backs → ~0.42 to rb2 (committee),
    // a 15-pt gap → ~0.09 (clear workhorse). Yields a realistic SPREAD of
    // backfield types across the league rather than one uniform ratio.
    let runner = RB;
    const _rb2name = this.offR.starters.rb2;
    if (!isQBRun && !useTwoBack && _rb2name) {
      const _rb1ovr = this._playerByName.get(RB)?.overall || 72;
      const _rb2ovr = this._playerByName.get(_rb2name)?.overall || 66;
      const _gap = _rb1ovr - _rb2ovr;
      // Concentrate carries on the lead back: base 0.42 left rb1 at ~62% of RB
      // carries (NFL bell-cows are ~65-75%), so the median feature back got ~14
      // carries / ~58 yds vs NFL ~16 / ~70. Lower rb2's base share so rb1 climbs
      // to ~68-70% — lifts rushing VOLUME (not via pass/run ratio, which is fine
      // at ~58% pass) and gives the league true workhorses.
      const _rb2share = Math.max(0.05, Math.min(0.40, 0.34 - _gap * 0.022));
      if (Math.random() < _rb2share) runner = _rb2name;
    }
    const carrier = isQBRun ? QB : runner;
    // QB runs break for chunks slightly more often — defense had to honor pass
    // first, and on read-option a defender is wrong-footed. The edge SCALES with
    // QB speed: elite runners (Vick/Lamar) net ~6.5-8 ypc on designed carries,
    // well above an RB's ~4.4, because they hit the second level untouched.
    const carrierBoost = isQBRun
      ? 0.8 + Math.max(0, ((this._playerByName?.get?.(QB)?.stats?.[0] ?? 60) - 80)) * 0.07
      : 0;
    // RB archetype effects on the rush: POWER drives short yardage, SPEED is boom/bust,
    // ELUSIVE breaks for slightly more big plays, RECEIVING is a worse pure runner
    let rbBoost = 0, rbSdMul = 1.0;
    if (!isQBRun) {
      switch (rbArch) {
        case "POWER":     rbBoost = 0.5;  rbSdMul = 0.85; break;  // less variance, sturdier
        case "SPEED":     rbBoost = 0.3;  rbSdMul = 1.30; break;  // boom/bust
        case "ELUSIVE":   rbBoost = 0.4;  rbSdMul = 1.10; break;
        case "WORKHORSE": rbBoost = 0.2;  rbSdMul = 0.95; break;
        case "RECEIVING": rbBoost = -0.6; rbSdMul = 1.0;  break;
      }
    }
    // Box safety adds some stuffing power; thumper LB does too
    const defArchRun = this.defArch;
    const boxSafetyStuff = ((defArchRun.S || []).filter(s => s?.archetype === "BOX").length * 0.2)
                         + ((defArchRun.S || []).filter(s => s?.archetype === "HYBRID").length * 0.08);
    const thumperStuff   = ((defArchRun.LB || []).filter(l => l?.archetype === "THUMPER").length * 0.18)
                         + ((defArchRun.LB || []).filter(l => l?.archetype === "HYBRID").length * 0.08);
    // LB gap recognition: high-AWR linebackers read the run key pre-snap and fill
    // the right gap — smart LBs are in the right place before the RB gets there.
    const lbRunList = defArchRun.LB || [];
    const lbAwrAvg = lbRunList.length
      ? lbRunList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / lbRunList.length
      : 70;
    const lbGapRead = (lbAwrAvg - 70) / 300; // AWR 85 → +0.05 yds stuffed, AWR 55 → -0.05
    // RB gap vision: aware backs find the right crease without hesitation.
    const rbAwr = rbPlayer?.stats?.[3] ?? 70;
    const rbGapVision = (rbAwr - 70) / 280; // AWR 85 → +0.054 yds gained, AWR 55 → -0.054
    // Trench pressure drives run efficiency: elite DL stuffs runs at/near the LOS
    const trenchYds = -pressure * 1.9;   // dominant DL = average lost ~2 yds per carry
    const lbTackle  = (this.defR.lb - 60) / 60;  // strong LBs add minor stuffing
    // Run-blocking matchup tilts the gap — apply runMul to the trench effect
    const runTrenchYds = trenchYds * (2 - runMul); // runMul<1 (DL wins) → bigger negative
    // REVERSE — big-play upside but bigger variance and a real chance of TFL.
    // The lateral hand-off and direction change make it boom-or-bust.
    const reverseBonus = isReverse ? (Math.random() < 0.45 ? -5 + Math.random() * 3 : 4 + Math.random() * 10) : 0;
    const reverseSdMul = isReverse ? 1.6 : 1.0;
    // Defensive scheme tilt for run defense: 46 blitz stuffs runs, dime
    // gets gashed.
    const defPbRun = this.currentDefPlaybook;
    // OC Run Architect: +0.3 to variant mean; DC Run Stopper: -0.4 to run mean
    const ocRunArchBonus    = _ocTrait === "Run Architect" ? 0.3  : 0;
    const dcRunStopperMalus = _dcTrait === "Run Stopper"  ? -0.4 : 0;
    // Fatigue malus — tired RB loses burst (∼-1.5 yds at fatigue 75); tired
    // OL opens smaller holes. Net effect = avg(rb,ol) fatigue minus def-front
    // fatigue, so a fresh defense vs a gassed o-line really stalls a run.
    const _carrierFat = isQBRun ? this._fatigueLevel(QB) : this._fatigueLevel(carrier);
    const _olFatRun = this._avgFatigue(this.poss === "home" ? this.homeOL : this.awayOL);
    const _dlFatRun = this._avgFatigue(this.poss === "home" ? this.awayDL : this.homeDL);
    const fatigueRunYds = -((_carrierFat + _olFatRun) / 2 - _dlFatRun) / 100 * 2.5;
    // Red-zone power bonus — short-yardage power runs convert in real NFL
    // at ~65% on 1st-and-goal. Bonus trimmed (+0.8/+0.4 → +0.6/+0.3) to
    // keep rush TDs in the slightly-over-NFL zone instead of 1.19× pace.
    // Same log curve as comp — defense piles up in box near goal line.
    const _rzPen2 = this._inRedZone ? Math.log(1 + Math.max(0, this.yardLine - 80) / 4) : 0;
    // Elite defenders eat run-blocking in RZ — see passing RZ bonus.
    const _rzEliteDr = this._inRedZone
      ? Math.max(0, (Math.max(this.defR.dl, this.defR.lb, this.defR.saf) - 80) / 100)
      : 0;
    const rzRunBonus = -_rzPen2 * 0.9 - _rzEliteDr * 1.5;
    const boxStackRunMod = this._boxStackRunMod || 0;
    // ── LEVEL-3 TRENCH-BATTLE RUN MODEL ─────────────────────────────────
    // Real football: every snap is a player-vs-player battle. A great OL vs
    // bad DL produces a QUALITATIVELY DIFFERENT distribution shape (lots of
    // designed/burst, almost no TFL/stuff) than the reverse. Additive
    // bonuses can't capture this — they only shift the mean. Multiplicative
    // matchups produce real per-team variance.
    //
    // Resolve a TRENCH BATTLE per snap from actual player ratings + the
    // archetype matchup table. Outcome is one of five tiers (dominant_win →
    // dominant_loss). Each outcome maps to a CHARACTERISTIC class profile —
    // dominant_win is heavy on designed/burst/big with almost no negatives;
    // dominant_loss is heavy on TFL/stuff with almost no chunk plays.
    // Secondary effects (FB blocking, LB pursuit, fatigue, RZ, scheme,
    // reverse) apply small targeted shifts on TOP of the trench-determined
    // base, NOT as additive signal into a single normal.
    const _olOvr = reps?.ol?.overall ?? this.offR.ol ?? 70;
    const _dlOvr = reps?.dl?.overall ?? this.defR.dl ?? 70;
    // Battle score — positive favors OL. Includes archetype matchup table
    // (runMul) so e.g. POWER DL vs PASS-PROTECT OL produces a real edge.
    const _battleScore = (_olOvr - _dlOvr) / 8 + (runMul - 1) * 5
                       + (rushMean - 4.3) * 0.5;   // playbook tilt
    // Per-snap noise — even dominant OLs lose some reps; even bad OLs win
    // some. SD 1.5 keeps outcomes probabilistic, not deterministic.
    const _noise = normal(0, 1.5);
    const _finalScore = _battleScore + _noise;
    let _trench;
    if      (_finalScore >  3)  _trench = 'dominant_win';
    else if (_finalScore >  1)  _trench = 'win';
    else if (_finalScore > -1)  _trench = 'even';
    else if (_finalScore > -3)  _trench = 'loss';
    else                        _trench = 'dominant_loss';
    // ── MFF run-trench attribution (additive, no RNG, no outcome change) ──
    // `_trench` is the resolved per-snap OL-vs-DL run battle, already computed
    // from the individual reps.ol/reps.dl ratings + archetype matchup + noise
    // (so it's a genuine individual signal, unlike the team-level pass pressure).
    // Credit the rep to both linemen: the OL gets a run-block win/loss, the DL
    // gets a run stuff (OL beaten) / loss (DL blocked). Writes only new keys.
    if (this._MFF_ATTR) {
      const _olWon = _trench === 'win' || _trench === 'dominant_win';
      const _dlWon = _trench === 'loss' || _trench === 'dominant_loss';
      const _rOl = reps.ol?.name && off.players[reps.ol.name];
      const _rDl = reps.dl?.name && def.players[reps.dl.name];
      if (_rOl) {
        _rOl.run_block_snaps = (_rOl.run_block_snaps || 0) + 1;
        if (_olWon) _rOl.run_block_wins   = (_rOl.run_block_wins   || 0) + 1;
        if (_dlWon) _rOl.run_block_losses = (_rOl.run_block_losses || 0) + 1;
      }
      if (_rDl) {
        _rDl.run_def_snaps = (_rDl.run_def_snaps || 0) + 1;
        if (_dlWon) _rDl.run_stuffs     = (_rDl.run_stuffs     || 0) + 1;
        if (_olWon) _rDl.run_def_losses = (_rDl.run_def_losses || 0) + 1;
      }
    }
    // Outcome → base class probability profile. Each profile is internally
    // consistent: more winning = fewer negatives + more chunks. The five
    // profiles produce a 2.5+ yard YPC spread between trench mismatches,
    // matching real NFL elite-vs-bottom rushing spread.
    const TRENCH = {
      // tfl,  stuff, des,  burst, big      // mean ypc (-2/1/4/9/18 means)
      dominant_win:  [0.02, 0.10, 0.50, 0.25, 0.13], // ~6.7
      win:           [0.05, 0.18, 0.55, 0.15, 0.07], // ~4.7
      even:          [0.10, 0.25, 0.48, 0.12, 0.05], // ~3.9
      loss:          [0.18, 0.35, 0.35, 0.08, 0.04], // ~2.8
      dominant_loss: [0.30, 0.45, 0.20, 0.04, 0.01], // ~1.2
    };
    let [p_tfl, p_stuff, p_des, p_burst, p_big] = TRENCH[_trench];
    // ── SECONDARY MATCHUP MODIFIERS (small targeted shifts) ─────────────
    // These apply on TOP of the trench-determined base — they don't drive
    // the shape, they tune it. Each one affects a specific class boundary
    // (e.g. LB pursuit adds STUFF risk, not TFL risk).
    p_stuff += clamp(lbTackle * 0.04, -0.04, 0.06);      // strong LBs wrap up
    p_stuff -= clamp(fbStuffReduction * 0.05, 0, 0.06);  // FB lead block helps
    p_des   += clamp(fbStuffReduction * 0.05, 0, 0.06);
    p_tfl   += clamp(thumperStuff * 0.04, 0, 0.06);      // thumper LBs blow up
    p_stuff += clamp(boxSafetyStuff * 0.03, 0, 0.05);    // safety run support
    p_des   += clamp(rbGapVision * 0.03, -0.03, 0.05);   // vision finds creases
    p_burst += clamp(rbGapVision * 0.02, -0.02, 0.04);
    // LB gap-shooting compresses everything toward the middle
    p_tfl   += clamp(lbGapRead * 0.025, 0, 0.05);
    p_burst -= clamp(lbGapRead * 0.025, 0, 0.05);
    // Fatigue removes burst/big plays
    if (fatigueRunYds < 0) {
      p_burst += fatigueRunYds * 0.015;
      p_big   += fatigueRunYds * 0.008;
    }
    // Red zone: field compressed → fewer chunks, more stuffs
    if (this._inRedZone) {
      p_big   *= 0.4;
      p_burst *= 0.7;
      p_stuff += 0.06;
    }
    // Box stacking → more stuffs/TFL, fewer big plays
    if (boxStackRunMod < 0) {
      p_tfl   -= boxStackRunMod * 0.015;
      p_stuff -= boxStackRunMod * 0.025;
      p_big   += boxStackRunMod * 0.010;
    }
    // Reverse plays: high variance, lots of TFL + lots of big
    if (isReverse) {
      p_tfl   += 0.10; p_stuff -= 0.05; p_des -= 0.20;
      p_burst += 0.08; p_big   += 0.07;
    }
    // OC/DC scheme tilts (small)
    p_des += clamp(ocRunArchBonus * 0.05 + dcRunStopperMalus * 0.05, -0.05, 0.05);
    // Clamp + renormalize
    p_tfl   = clamp(p_tfl,   0.005, 0.45);
    p_stuff = clamp(p_stuff, 0.02,  0.55);
    p_burst = clamp(p_burst, 0.005, 0.35);
    p_big   = clamp(p_big,   0.001, 0.20);
    p_des   = Math.max(0.10, 1 - p_tfl - p_stuff - p_burst - p_big);
    const _psum = p_tfl + p_stuff + p_des + p_burst + p_big;
    p_tfl /= _psum; p_stuff /= _psum; p_des /= _psum; p_burst /= _psum; p_big /= _psum;
    // Within-class shift now SMALL — most variance is in class choice.
    // Captures fine RB skill (archetype) + scheme variance + QB run bonus.
    const withinShift = (rbBoost + carrierBoost + runVarMean) * 0.4
                      + reverseBonus * 0.3;
    // Reverse plays widen the burst/big classes
    const _bSd = 3 * (reverseSdMul || 1);
    const _gSd = 9 * (reverseSdMul || 1);
    // Class draw
    const _cls = Math.random();
    let yards;
    // Class means trimmed — first-pass values landed rush YPC at 4.90 (NFL
    // ~4.4). Lean-forward + broken-tackle add ~0.4 yds on top, so the class
    // baseline needs to be ~4.0 for measured ypc to land at NFL avg.
    if (_cls < p_tfl) {
      yards = Math.round(normal(-2.0 + withinShift, 1.5));
      yards = clamp(yards, -8, 0);
    } else if (_cls < p_tfl + p_stuff) {
      yards = Math.round(normal(1.0 + withinShift, 1.0));
      yards = clamp(yards, 0, 4);
    } else if (_cls < p_tfl + p_stuff + p_des) {
      yards = Math.round(normal(4.0 + withinShift, 1.8 * (rbSdMul || 1)));
      yards = clamp(yards, 1, 9);
    } else if (_cls < p_tfl + p_stuff + p_des + p_burst) {
      yards = Math.round(normal(9.0 + withinShift, _bSd));
      yards = clamp(yards, 7, 18);
    } else {
      yards = Math.round(normal(18.0 + withinShift * 1.5, _gSd));
      yards = clamp(yards, 14, 75);
    }
    // Yards after contact — heavy power backs lean forward and drag tacklers.
    // Applied to every positive carry, before the break-tackle event rolls.
    if (!isQBRun && yards > 0) {
      const lean = this._leanForwardYds(carrier, rbArch);
      if (lean > 0) yards = Math.round(yards + lean);
    }
    // Cap at distance to end zone so a 1-yd goal-line carry doesn't get reported as a 17-yd TD
    if (yards > 0) yards = Math.min(yards, 100 - startYard);
    // Broken tackles — physics-based break attempt. Skipped on QB rushes
    // (QB scrambles handled by their own path) and on losses.
    let brokenTackles = 0, bonusYards = 0;
    if (!isQBRun && yards > 0) {
      const br = this._resolveBreakTackle({
        carrierName: carrier, yards,
        breakStyle: rbArch,
        tacklerArchByPos: this.defArch,
        tacklerStatsPlayers: this.defStats?.players,
      });
      brokenTackles = br.brokenTackles;
      bonusYards = br.bonusYards;
      if (bonusYards) yards = Math.min(yards + bonusYards, 100 - startYard);
    }
    const carrierStats = off.players[carrier];
    if (carrierStats) {
      carrierStats.rush_att++;
      carrierStats.rush_yds += yards;
      if (yards > carrierStats.rush_long) carrierStats.rush_long = yards;
      if (brokenTackles) carrierStats.broken_tackles = (carrierStats.broken_tackles || 0) + brokenTackles;
    }
    off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
    // Award a pancake block to a random OL on quality runs (≥5 yards, not a QB scramble)
    if (yards >= 5 && !isQBRun) {
      const olArr = this.offOL || [];
      if (olArr.length && Math.random() < 0.38) {
        const blocker = olArr[Math.floor(Math.random() * olArr.length)];
        if (blocker?.name && off.players[blocker.name])
          off.players[blocker.name].pancakes = (off.players[blocker.name].pancakes || 0) + 1;
      }
    }
    this._lastBallCarrier = carrier; this._lastBallType = "rush";
    const brokeNote = brokenTackles > 0 ? ` (${brokenTackles} broken tackle${brokenTackles > 1 ? "s" : ""}!)` : "";
    const runVariantTag = runType === "counter" ? "counter" :
                          runType === "stretch" ? "stretch" :
                          runType === "pitch"   ? "pitch"   : "";
    const isRushTD = clamp(startYard + yards, 0, 100) >= 100;
    // Tackle credit on runs — first-principles play-context model:
    //   • breakaway (≥10 yd) → DBs catching from depth, low assist
    //   • short-positive inside → DL/MLB territory, high assist (pile)
    //   • outside zone / sweep → OLB/CB/S, less DL
    //   • backfield stuff (≤0 yd) → DL/LB pile, very high assist
    //   • goal-line short positive → DL/LB pile
    // _creditTackle reads the context and picks weights + assist rate.
    const isOutside = isSpeedOption || /* sweep cue */ false;  // could expand
    const isGoalLine = this.yardLine >= 95 && yards < 4;
    const tacklerName = isRushTD ? null : this._creditTackle({
      type: "run",
      direction: isOutside ? "outside" : "inside",
      yards,
      isGoalLine,
    });
    // Force-scaled wear: tackler's STR/SPD/archetype × carrier vulnerability.
    // Negative-yard carries (drilled in the backfield) add extra hit force.
    // Returned force (0.5 - 2.2) drives the visual impact below.
    const _hitForce = this._bumpHitWear(carrier, 0.5, tacklerName, {
      negativeYards: yards < 0 ? yards : 0,
      playContext: { type: "run", direction: isOutside ? "outside" : "inside", isGoalLine },
    });
    const rushEndTag = isRushTD ? " — TOUCHDOWN!"
                     : tacklerName ? `, tackled by ${tacklerName}` : "";
    const desc = isSpeedOption
      ? (isPitch
          ? `${QB} pitches to ${this.offR.starters.rb} on the speed option for ${yards} yds${brokeNote}${rushEndTag}`
          : `${QB} keeps on the speed option for ${yards} yds${brokeNote}${rushEndTag}`)
      : isQBRun
        ? `${QB} keeps it for ${yards} yds${brokeNote}${rushEndTag}`
        : runVariantTag
          ? `${this.offR.starters.rb} ${runVariantTag} for ${yards} yds${brokeNote}${rushEndTag}`
          : `${this.offR.starters.rb} runs for ${yards} yds${brokeNote}${rushEndTag}`;
    // ── PATH B: motion intent for animation playback ─────────────
    // play.motion carries decisions the engine makes about the play's
    // visual shape. Animation reads these instead of inferring (which
    // is what created all the rubber-band / hash patches). Phase 1
    // schema:
    //   tacklerRole   – role of the tackling defender (MLB/OLB/SS/FS/CB)
    //                   Animation maps role → defender index.
    //   tackleT       – action-time when the tackle happens (0..1)
    //   hitDir        – impact unit vector (carrier knockback direction)
    //   carrierEndDY  – lateral Y offset of the carrier's final spot
    //                   (relative to cy), so animation doesn't hash.
    // Tackler-role decision lives here so it reflects the play context
    // (gap type, run type, yardage) rather than a per-play hash.
    // Tackler-role decision: prefer the credited tackler's ACTUAL
    // slot (so visual animator + box score agree on who made the
    // tackle). Falls back to a context-based heuristic for plays
    // where the tackle wasn't credited yet (TDs) or the credit
    // resolved to a slot the animation can't render directly.
    let _tacklerRole = null;
    const _tacklerSlot = this._resolveDefSlot(tacklerName);
    if (_tacklerSlot) {
      // Map slot → role label the animation expects.
      _tacklerRole = _tacklerSlot === "cb1" || _tacklerSlot === "cb2" ? "CB"
                   : _tacklerSlot === "fs" ? "FS"
                   : _tacklerSlot === "ss" ? "SS"
                   : _tacklerSlot === "lb1" ? "OLB"
                   : _tacklerSlot === "lb2" ? "MLB"
                   : _tacklerSlot === "lb3" ? "OLB"
                   : _tacklerSlot === "nb" ? "CB"
                   : null;
    }
    if (!_tacklerRole) {
      // Fallback heuristic for TDs / unresolved credits
      if (yards >= 15)              _tacklerRole = "FS";          // breakaway → free safety
      else if (yards >= 8)          _tacklerRole = "SS";          // intermediate → strong safety
      else if (runType === "stretch" || runType === "pitch") _tacklerRole = "OLB";  // outside → edge LB
      else if (runType === "counter") _tacklerRole = "MLB";       // misdirection → MLB cleans up
      else                          _tacklerRole = "MLB";         // inside / default → MLB
    }
    // Hit direction — carrier knocked back along the motion axis with
    // a slight lateral component based on tackler approach.
    const _hitSeed = (startYard * 7 + (yards * 11)) >>> 0;
    const _hitLatSign = (_hitSeed & 1) ? 1 : -1;
    const _carrierEndDY = ((_hitSeed >> 1) & 31) - 15;   // -15..+15 px
    // ── CARRIER WAYPOINT TRACK (Path B Phase 2) ─────────────────────
    // 5 key frames describe the carrier's path through the play.
    // Coordinates are YARDS relative to (LOS, cy). Animation
    // translates to pixels via losX + dxYd * PX_PER_YARD.
    //
    //   t = 0       — formation spot (8 yds behind LOS, ~1.87 lateral)
    //   t = 0.10    — mesh (handoff): just behind LOS, lateral merging
    //   t = 0.22    — read (hit the hole): at LOS, lateral roughly cy
    //   t = 0.78    — tackle spot: full yardage gained, lateral = end Y
    //   t = 1.0     — settled at tackle spot
    //
    // Future phases will add jukes (lateral spike + dodge defender
    // dive), counter motion (false step), pitch fan-out, etc.
    const _carrierLateralEndYd = (_carrierEndDY || 0) / 15;
    // Carrier track. Old "read" waypoint had dxYd = yards * 0.14 at
    // t=0.22, which meant on a 30-yd run the RB had to cover 8 yards
    // in 12% of the action window — ~28 yps (60 mph) burst through
    // the line. That's where the "first part of run is faster than
    // normal running" comes from. New: read waypoint stays near the
    // LOS (capped between -1 and +2 yd) regardless of total play
    // distance, so the post-LOS run gets the full 0.26-0.78 cruise
    // window at a believable speed.
    const _carrierReadDxYd = clamp(yards * 0.05, -1, 2);
    // On a TD, carry the final waypoint ~5yd PAST the goal line so the
    // scorer runs THROUGH the plane and celebrates in the end zone —
    // matching what the local-endX run types (counter/reverse/stretch/
    // pitch) already do. Without this, inside/default runs (which use
    // this track) stopped dead on the white stripe while the same-yardage
    // TD on a stretch ran into the EZ — divergent end position by runType.
    // Rush TD: carry ~3yd INTO the end zone (crosses the plane, celebrates in
    // the EZ). Was +5, which on the shallow rendered EZ ended the (motion-
    // track-driven) scorer back at the goalpost base — the animation-side
    // endX bonus was reduced to 3yd to match, but most runs use THIS track,
    // so the scorer still finished on the post until this matched it.
    const _carrierEndDxYd = yards + (isRushTD ? 3 : 0);
    // Pace the carrier waypoints by DISTANCE so the RB moves at a CONSTANT
    // speed from the backfield through the mesh and into the hole. The old
    // fixed t-values (mesh 0.10, LOS 0.22) front-loaded the 8-yd backfield
    // approach into the first 22% of the play — the RB BURST to the LOS at
    // ~13yps and then crawled the gain ("extra speed when the RB takes the
    // handoff"). t now ∝ cumulative forward distance, reaching the tackle
    // spot at 0.78. Handles losses via abs distances.
    // 2-back style — picked HERE so the carrier track t=0 waypoint matches
    // the rendered RB start position. makeFormation used to roll I vs PRO
    // randomly per render → 50% of multi-back runs the engine and renderer
    // disagreed on the RB's pre-snap depth, causing a 4yd + 28px sprite
    // teleport at runT=0. Deterministic hash so the visual and the
    // emitted twoBackStyle land on the same value.
    const _isMultiBack = useTwoBack || this._currentPersonnel === "I_FORM";
    const _twoBackStyle = _isMultiBack
      ? ((((startYard * 7) ^ ((yards | 0) * 13)) >>> 0) & 1 ? "I" : "PRO")
      : null;
    // I-style stacks FB/RB behind QB on the midline — RB starts 12yd back
    // at cy. PRO-style and single-back start at the usual 8yd / +28px slot.
    const _startDxYd = _twoBackStyle === "I" ? -12 : -8;
    const _startDyYd = _twoBackStyle === "I" ?  0  : 1.87;
    const _d01 = Math.abs(_startDxYd - (-4));                      // start → mesh
    const _d12 = Math.abs(_carrierReadDxYd - (-4));                // mesh → read/LOS
    const _d23 = Math.abs(_carrierEndDxYd - _carrierReadDxYd);     // read → end
    const _dTot = Math.max(1, _d01 + _d12 + _d23);
    const _tMesh = (_d01 / _dTot) * 0.78;
    const _tRead = ((_d01 + _d12) / _dTot) * 0.78;
    const _carrierTrack = {
      role: isQBRun ? "QB" : "RB",
      waypoints: [
        { t: 0.00,    dxYd: _startDxYd,          dyYd: _startDyYd },             // formation
        { t: _tMesh,  dxYd: -4,                  dyYd: 1.00 },                   // mesh / handoff
        { t: _tRead,  dxYd: _carrierReadDxYd,    dyYd: 0.50 },                   // read at LOS
        { t: 0.78,    dxYd: _carrierEndDxYd,     dyYd: _carrierLateralEndYd },   // goal line / tackle spot
        { t: 1.00,    dxYd: _carrierEndDxYd,     dyYd: _carrierLateralEndYd },   // settled (in EZ on a TD)
      ],
    };
    // ── PRIMARY TACKLER TRACK (Path B Phase 3a) ─────────────────────
    // Path-B answer to the "defender teleports" bug. Engine emits the
    // tackler's pursuit path in YARDS relative to (LOS, cy). The
    // start spot is role-aware (MLB starts shallower than FS), the
    // converge spot equals the carrier's tackle-spot waypoint, so
    // the tackler arrives at the right place at exactly tackleT.
    //
    // Cadence mirrors the carrier:
    //   t=0:    formation
    //   t=0.10: read (defender holds lane while diagnosing run)
    //   t=0.22: break (commits toward play-side)
    //   t=0.78: tackle spot (converges with carrier)
    //   t=1.0:  settled
    //
    // Animation will read this for the primary tackler; remaining
    // defenders stay on legacy pursuit logic until later phases.
    const _tacklerStart = (() => {
      // Play-side bias: positive = same side as carrier's lateral end
      const sideY = _carrierLateralEndYd >= 0 ? 1 : -1;
      switch (_tacklerRole) {
        case "MLB": return { dxYd:  4, dyYd:  0 };
        case "OLB": return { dxYd:  4, dyYd:  sideY * 4 };
        case "SS":  return { dxYd:  8, dyYd:  sideY * 5 };
        case "FS":  return { dxYd: 12, dyYd:  0 };
        case "CB":  return { dxYd:  5, dyYd:  sideY * 18 };
        default:    return { dxYd:  4, dyYd:  0 };
      }
    })();
    // Tackler "read" — small drift while diagnosing the play.
    // FS / safeties drift downhill, LBs hold lane, CBs settle.
    const _readDxYd = _tacklerRole === "FS" || _tacklerRole === "SS"
      ? _tacklerStart.dxYd - 1.5     // downhill
      : _tacklerStart.dxYd;
    // "Break" waypoint: defender starts converging toward the carrier
    // at t≈0.22 (when the back hits the hole). Halfway between start
    // and tackle spot, with slight downhill bias.
    const _breakDxYd = (_readDxYd + yards) * 0.45;
    const _breakDyYd = (_tacklerStart.dyYd + _carrierLateralEndYd) * 0.5;
    const _tacklerTrack = {
      role: _tacklerRole,
      waypoints: [
        { t: 0.00, dxYd: _tacklerStart.dxYd, dyYd: _tacklerStart.dyYd },     // formation
        { t: 0.10, dxYd: _readDxYd,          dyYd: _tacklerStart.dyYd },     // read (lane)
        { t: 0.22, dxYd: _breakDxYd,         dyYd: _breakDyYd },              // break
        { t: 0.78, dxYd: yards,              dyYd: _carrierLateralEndYd },    // tackle spot
        { t: 1.00, dxYd: yards,              dyYd: _carrierLateralEndYd },    // settled
      ],
    };
    // ── SECONDARY DEFENDER LANE DISCIPLINE (Path B Phase 3c) ────────
    // Non-tackler defenders get short tracks describing zone behavior:
    // FS holds deep middle until breakaway; SS plays downhill but stops
    // at second-level support; CBs hold outside contain at the
    // sideline numbers. Skip the slot matching the primary tackler so
    // the tackler track (which converges) wins. Solves the
    // "everyone converges on the carrier" feel on inside runs.
    //
    // Side bias: defenders on the play-side close more, backside
    // holds responsibility. _playSide is +1 for bottom of field
    // (positive dyYd), -1 for top.
    const _secondaryTracks = {};
    const _playSide = _carrierLateralEndYd >= 0 ? 1 : -1;
    const _isBreakaway = yards >= 12;
    // FS (free safety): deep middle help. Holds at -12 yds deep until
    // play threatens breakaway (yards >= 12), then comes downhill but
    // stops short of the tackle (still safety; the tackler is the
    // converger). When FS IS the tackler (long runs), skip.
    if (_tacklerRole !== "FS") {
      const fsConvergeYds = _isBreakaway ? yards * 0.4 : 8;
      _secondaryTracks.fs = {
        role: "FS",
        waypoints: [
          { t: 0.00, dxYd: 12, dyYd: 0 },                               // deep middle
          { t: 0.10, dxYd: 11, dyYd: 0 },                               // read
          { t: 0.30, dxYd: 10, dyYd: _playSide * 0.5 },                 // shuffle play-side
          { t: 0.78, dxYd: fsConvergeYds, dyYd: _playSide * 2 },        // support arrival
          { t: 1.00, dxYd: fsConvergeYds, dyYd: _playSide * 2 },
        ],
      };
    }
    // SS (strong safety): force player. Comes downhill but stops at
    // the box (~6 yds deep) unless the play breaks outside.
    if (_tacklerRole !== "SS") {
      const ssFinalYds = (runType === "stretch" || runType === "pitch") ? 7 : 6;
      _secondaryTracks.ss = {
        role: "SS",
        waypoints: [
          { t: 0.00, dxYd: 8, dyYd: _playSide * 5 },                    // formation alley
          { t: 0.20, dxYd: 7, dyYd: _playSide * 4 },                    // downhill
          { t: 0.40, dxYd: ssFinalYds, dyYd: _playSide * 3 },           // box-edge fit
          { t: 0.78, dxYd: ssFinalYds, dyYd: _playSide * 3 },           // hold
          { t: 1.00, dxYd: ssFinalYds, dyYd: _playSide * 3 },
        ],
      };
    }
    // CB1 / CB2: outside contain. Squeeze inward 2-3 yds but never
    // leave the perimeter unless the play is to their side.
    const _cb1ContainYds = (runType === "stretch" && _playSide < 0) || (runType === "pitch" && _playSide < 0) ? 4 : 6;
    const _cb2ContainYds = (runType === "stretch" && _playSide > 0) || (runType === "pitch" && _playSide > 0) ? 4 : 6;
    _secondaryTracks.cb1 = {
      role: "CB",
      waypoints: [
        { t: 0.00, dxYd: 5,                dyYd: -16 },                 // press / outside
        { t: 0.20, dxYd: _cb1ContainYds,   dyYd: -14 },                 // squeeze
        { t: 0.78, dxYd: _cb1ContainYds,   dyYd: -13 },                 // contain
        { t: 1.00, dxYd: _cb1ContainYds,   dyYd: -13 },
      ],
    };
    _secondaryTracks.cb2 = {
      role: "CB",
      waypoints: [
        { t: 0.00, dxYd: 5,                dyYd: 16 },
        { t: 0.20, dxYd: _cb2ContainYds,   dyYd: 14 },
        { t: 0.78, dxYd: _cb2ContainYds,   dyYd: 13 },
        { t: 1.00, dxYd: _cb2ContainYds,   dyYd: 13 },
      ],
    };
    // Phase 9 — OL/DL blocker tracks (run plays). _carrierLateralEndYd
    // serves as a proxy for the gap the carrier hits.
    const _blockerTracks = this._buildRunBlockerTracks({
      runType: runType || "inside",
      yards,
      gapYd: _carrierLateralEndYd,
      fbInLeadBlock: useTwoBack,
    });
    const _motion = {
      tacklerRole: _tacklerRole,
      // Specific defender slot the engine resolved as the tackler ("cb1" /
      // "cb2" / "fs" / "ss" / "lb1-3" / "nb"). Animation reads this in
      // preference to tacklerRole so the wrong-CB collision (engine emits
      // a play-side tackler track, animation hash-picks the off-side CB,
      // sprite teleports across the field at the snap) can't happen.
      tacklerSlot: _tacklerSlot || null,
      tackleT:    0.78,                                  // matches TACKLE_START_AT in animation
      hitDir:     { dx: -1, dy: _hitLatSign * 0.3 },     // pushed backward + lateral
      carrierEndDY: _carrierEndDY,
      gapYd:      _carrierLateralEndYd,
      tracks: { carrier: _carrierTrack, tackler: _tacklerTrack,
                ..._secondaryTracks, ..._blockerTracks },
    };
    // play.force: scale engine force (0.5-2.2) into the animation's expected
    // range (~0-15). Drives ragdoll launch velocity and slow-mo depth in
    // play-animation.js (search for `play.force` in the run-ragdoll branch).
    // x5 mapping: average tackle 1.0 → 5 (visible mid-impact), big-hit
    // threshold 1.45 → 7.25, massive 1.9 → 9.5, max 2.2 → 11.
    const _playForce = (typeof _hitForce === "number") ? _hitForce * 5 : null;
    this._pushVisual({ kind: "run", desc, startYard, yards, endYard: clamp(startYard + yards, 0, 100), rusher: carrier, isQBRun, isReverse, runType, isSpeedOption, isPitch, optionRead, tackler: tacklerName, brokenTackles, force: _playForce, isTwoBack: useTwoBack, twoBackStyle: _twoBackStyle, fb: useTwoBack ? this.offR.starters.rb2 : null, motion: _motion });
    return { yards };
  }
  _drive() {
    const start = this.poss; let plays = 0;
    // Reset per-drive 4th-down commitment counter. NFL coaches who go
    // for it on 4th down earlier in a drive show stronger willingness
    // to do it again on the same drive — the strategic context (field
    // position, game state, "we said we're playing for it") persists.
    this._drive4thGoCount = 0;
    // Track drive metadata for the end-of-drive summary card.
    const driveStartYL   = this.yardLine;
    const driveStartTime = this.time;
    const driveStartQ    = this.quarter;
    const driveStartTeam = this[start].name;
    const pushDriveSummary = (result, opts = {}) => {
      const yardsGained = (opts.endYL ?? this.yardLine) - driveStartYL;
      // Time elapsed (handle quarter wrap)
      let elapsedSec = (driveStartTime - this.time);
      if (this.quarter > driveStartQ) elapsedSec += (this.quarter - driveStartQ) * 900;
      const m = Math.floor(Math.max(0, elapsedSec) / 60);
      const s = Math.floor(Math.max(0, elapsedSec) % 60);
      const ts = `${m}:${String(s).padStart(2, "0")}`;
      const fpStart = driveStartYL <= 50 ? `own ${driveStartYL}` : `opp ${100 - driveStartYL}`;
      this.plays.push({
        kind: "drive_summary",
        desc: `═ ${driveStartTeam}: ${plays}-play, ${yardsGained >= 0 ? yardsGained : yardsGained} yds, ${ts} — starting ${fpStart} → ${result.toUpperCase()} ═`,
        quarter: this.quarter, time: this.time,
        homeScore: this.score.home, awayScore: this.score.away,
        driveResult: result,
        drivePlays: plays,
        driveYards: yardsGained,
        driveTime: elapsedSec,
        driveStartYL,
      });
    };
    while (this.time > 0 && plays < 22) {
      plays++;
      const r = this._play();
      // Clock-stop tracker — sets the dt regime for the NEXT snap.
      // NFL: incomplete passes and turnovers stop the game clock. The next
      // snap goes in ~20 sec instead of ~28. First-down stops are brief and
      // don't materially compress the next play. Drive-end (TD/FG/punt) is
      // already handled by drive-change time logic.
      this._lastClockStopped = !!(r?.incomplete || r?.turnover);
      // 2-minute warning marker (Q2 + Q4) — push once per half right AFTER
      // the play that crossed 2:00, so it appears in the log before any
      // timeout that the trailing team might call on the same dead ball.
      const halfKey = this.quarter <= 2 ? "half1" : "half2";
      if (this.time <= 120 && !this._twoMinWarned[halfKey]
          && (this.quarter === 2 || this.quarter === 4)) {
        this._twoMinWarned[halfKey] = true;
        this.plays.push({
          kind: "two_min_warning",
          desc: this.quarter === 2 ? "⏱ TWO-MINUTE WARNING (Q2)" : "⏱ TWO-MINUTE WARNING (Q4)",
          quarter: this.quarter, time: this.time,
          homeScore: this.score.home, awayScore: this.score.away,
        });
      }
      // After the play (and after the warning if any), the team that's
      // behind may call timeout to preserve time.
      this._maybeCallTimeout(r);
      // Penalty handled inside _play — yardLine/down/ytg already set;
      // _drive should not run its normal yards/down/first-down logic.
      if (r.isPenalty) continue;
      // Explosive play — offense bumps momentum on a 20+ yd gain.
      if (!r.turnover && !r.endDrive && (r.yards || 0) >= 20) {
        this._swingMomentum(this.poss, 1, "EXPLOSIVE PLAY");
      }
      if (r.endDrive) {
        if (r.isReturnTD) {
          // Punt returned for a TD by the receiving team
          this.poss = this.poss === "home" ? "away" : "home";
          this.yardLine = 100;
          this._score(6, "Punt Return Touchdown!");
          const k = this.offR.starters.k, kStats = this.offStats.players[k];
          if (Math.random() < 0.92) {
            if (kStats) kStats.xp_att++;
            if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
          }
          pushDriveSummary("PUNT RETURN TD", { endYL: 100 });
          this.drives.push({ team: start, result: "PUNT-RTN-TD", homeScore: this.score.home, awayScore: this.score.away });
          this._kickoffAfterScore(this.poss);
          return;
        }
        if (r.fgGood) {
          // Made FG — kickoff to the receiving team (with onside option).
          this._kickoffAfterScore(this.poss);
          break;
        }
        if (r.punt !== undefined) {
          // 3-and-out (or shorter) gives the defense a momentum bump.
          // Explosive defensive series. Counts plays in this drive.
          if (plays <= 3) {
            const _defSide3O = this.poss === "home" ? "away" : "home";
            this._swingMomentum(_defSide3O, 1, "3 & OUT");
          }
          this._decayMomentum();
          this.poss = this.poss === "home" ? "away" : "home";
          this.yardLine = clamp(100 - (this.yardLine + r.punt), 1, 99);
        } else {
          // Missed/blocked FG: opponent gets the ball at the SPOT OF THE
          // KICK (LOS + 7). NFL rule also prevents the kicking team's
          // miss from pinning the opponent inside their own 20 — even a
          // short missed FG gives the opponent the ball at the 20 minimum
          // (per the 2014+ rule). Previously this mirrored the LOS, which
          // gave the opponent ~7 free yards of field position vs the rule.
          this.poss = this.poss === "home" ? "away" : "home";
          const kickSpot = this.yardLine + 7;
          const mirror = 100 - kickSpot;
          this.yardLine = Math.max(20, clamp(mirror, 1, 99));
        }
        this.down = 1; this.ytg = 10; break;
      }
      if (r.turnover) {
        // Drive summary BEFORE flipping possession.
        const turnoverEndYL = r.intSpotYL || r.fumbleSpotYL || this.yardLine;
        const turnoverResult = r.isPickSix ? "PICK SIX"
                              : r.isTouchback ? "INT (TOUCHBACK)"
                              : r.intSpotYL  ? "INTERCEPTION"
                              : r.fumbleSpotYL ? "FUMBLE"
                              :                 "TURNOVER";
        pushDriveSummary(turnoverResult, { endYL: turnoverEndYL });
        this.poss = this.poss === "home" ? "away" : "home";
        if (r.isTouchback) {
          // End-zone INT, defender didn't break it out — ball at the 20.
          this.yardLine = 20;
        } else if (r.intSpotYL != null) {
          // Use the actual INT spot (not the LOS) to mirror into the new
          // offense's coordinates, then add the return yards. Without this,
          // the new offense got the LOS mirrored, which gave them ~target
          // depth yards of FREE field position on every downfield INT.
          const mirror = clamp(100 - r.intSpotYL, 1, 99);
          this.yardLine = clamp(mirror + (r.retYds || 0), 1, 99);
        } else if (r.fumbleSpotYL != null) {
          // Same idea as the INT — defense recovers at the strip spot,
          // not at the snap.
          const mirror = clamp(100 - r.fumbleSpotYL, 1, 99);
          this.yardLine = clamp(mirror + (r.retYds || 0), 1, 99);
        } else {
          // Any turnover without a spot — fall back to LOS mirror.
          const mirror = clamp(100 - this.yardLine, 5, 95);
          this.yardLine = clamp(mirror + (r.retYds || 0), 5, 99);
        }
        // Pick-six TD + XP attempt are already handled in _play (_defScoreXP
        // pushes the XP visual). The "this.poss" we just flipped above is the
        // team that intercepted, so they're the SCORING team — they kick off.
        if (r.isPickSix) {
          this._kickoffAfterScore(this.poss);
          break;
        }
        this.down = 1; this.ytg = 10; break;
      }
      const yards = r.yards || 0;
      // SAFETY — ball carrier tackled in his own end zone. Detect BEFORE
      // the clamp (which would hide the negative yardLine and treat it
      // as a 0-yard line play). Sacks losing more yards than the offense
      // had to give, runs into own end zone after a deep-EZ snap, etc.
      // Awards 2 pts to the defense and triggers a free kick from the
      // OFFENSE's 20-yard line (simplified to a standard kickoff visual
      // landing at the receiving team's 25).
      const proposedYL = this.yardLine + yards;
      if (!r.incomplete && yards < 0 && proposedYL <= 0) {
        const defKey = this.poss === "home" ? "away" : "home";
        this.score[defKey] += 2;
        // Momentum swings to the team that scored — same as every other
        // score (routed through _score / _defScoreXP). The safety updated the
        // scoreboard directly and was the ONE score type that skipped the
        // swing, so a safety left momentum untouched (inconsistent, and it
        // skews the trailing team's subsequent play-calling).
        this._swingMomentum(defKey, 1, "Safety (+2)");
        this._pushVisual({
          kind: "safety",
          desc: `SAFETY — 2 points for ${this[defKey].name}`,
          scoringTeam: defKey,
        });
        // Also push a kind:"score" entry so the quarter-by-quarter
        // scoreboard aggregator (play-broadcast.js sums `kind==="score"
        // && p.pts`) picks up the 2 points. Without this the scoreboard
        // would be 2 points short whenever a safety occurred.
        this._pushVisual({
          kind: "score",
          desc: `${this[defKey].city} ${this[defKey].name} — Safety (+2)`,
          scoreType: "Safety",
          poss: defKey,
          pts: 2,
        });
        pushDriveSummary("SAFETY", { endYL: 0 });
        this.drives.push({ team: start, result: "SAFETY", homeScore: this.score.home, awayScore: this.score.away });
        // Free kick from the offense's 20. Possession flips to the
        // scoring team (the defense that just got the safety).
        this.poss = defKey;
        this.yardLine = 25;
        this.down = 1; this.ytg = 10;
        this._pushVisual({
          kind: "kickoff",
          desc: `Free kick after safety — ${this[defKey].name} receives at the 25`,
          startYard: 20, endYard: 25,
          motion: { result: "freeKick", contactT: 0.05, catchT: 0.48, tackleT: 0.85 },
        });
        return;
      }
      if (!r.incomplete) this.yardLine = clamp(this.yardLine + yards, 0, 100);
      const wasThird = (this.down === 3);
      if (this.yardLine >= 100) {
        // Credit TD to last ball carrier
        const off = this.stats[this.poss];
        // Red-zone TD bookkeeping — only count once per RZ trip (this drive).
        if (this._lastRzDrive === this.drives.length) {
          off.team.rz_td = (off.team.rz_td || 0) + 1;
        }
        if (this._lastBallCarrier && off.players[this._lastBallCarrier]) {
          if (this._lastBallType === "pass") {
            off.players[this._lastBallCarrier].rec_td++;
            const qb = this.offR.starters.qb;
            if (off.players[qb]) off.players[qb].pass_td++;
          } else if (this._lastBallType === "rush") {
            off.players[this._lastBallCarrier].rush_td++;
          }
        }
        if (wasThird) off.team.thirdConv++;
        off.team.firstDowns++;
        this._score(6, "Touchdown!");
        const k = this.offR.starters.k, kStats = off.players[k];
        // ── 2-POINT CONVERSION AI ──
        // Decision based on the score MARGIN AFTER the TD (the +6 is
        // already applied by _score above). Standard chart values
        // cover: down 5, down 2, down 1, tied, up 1, up 4, up 5, up 12.
        // Late game (Q4 <10:00 or OT) flips MUCH more aggressive.
        const myKey = this.poss;
        const oppKey = myKey === "home" ? "away" : "home";
        const diff = this.score[myKey] - this.score[oppKey];
        const lateGame = (this.quarter === 4 && this.time < 600) || this.quarter >= 5;
        let twoPtChance = 0.04;        // default: just kick
        switch (diff) {
          case -5: twoPtChance = lateGame ? 0.80 : 0.30; break;  // down 5 → need 7
          case -2: twoPtChance = lateGame ? 0.95 : 0.45; break;  // down 2 → tie immediately
          case -1: twoPtChance = lateGame ? 0.35 : 0.08; break;  // down 1 → lead-by-1 vs tie
          case  0: twoPtChance = lateGame ? 0.20 : 0.04; break;  // tied → usually kick
          case  1: twoPtChance = lateGame ? 0.55 : 0.18; break;  // up 1 → up 3 (2-score buffer)
          case  4: twoPtChance = lateGame ? 0.75 : 0.18; break;  // up 4 → up 6 (forces TD to lose)
          case  5: twoPtChance = lateGame ? 0.92 : 0.35; break;  // up 5 → up 7
          case 12: twoPtChance = lateGame ? 0.80 : 0.45; break;  // up 12 → up 14 (2-score with FG)
        }
        // Desperation: down by ≥9 late = go for 2 most of the time
        if (lateGame && diff <= -9) twoPtChance = Math.max(twoPtChance, 0.65);
        // QB + HC AGGRESSION tilt the 2-pt rate. Risk-taking QBs go for
        // 2 more often even in non-chart situations; Riverboat HCs even
        // more so; Conservatives basically never except down 2 late.
        const offTidXP = this.poss === "home" ? this.home.id : this.away.id;
        const hcStyleXP = (typeof franchise !== "undefined") ? franchise.coaches?.[offTidXP]?.hc?.specialtyTrait : null;
        const hcXpMul = hcStyleXP === "Riverboat Gambler" ? 1.50
                      : hcStyleXP === "Conservative"      ? 0.50
                      : hcStyleXP === "Game Manager"      ? 0.85
                      :                                       1.00;
        twoPtChance = clamp(twoPtChance * this._aggTilt(this._qbAggression()) * hcXpMul, 0, 0.97);
        if (Math.random() < twoPtChance) {
          // 2-point try
          if (Math.random() < 0.48) this._score(2, "2-Point Conversion");
          else this._pushVisual({ kind: "xp_miss", desc: `2-pt conversion fails — no good` });
        } else {
          // Kick XP
          if (kStats) kStats.xp_att++;
          if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
          else this._pushVisual({ kind: "xp_miss", desc: `Extra point — no good` });
        }
        pushDriveSummary("TOUCHDOWN", { endYL: 100 });
        this.drives.push({ team: start, result: "TD", homeScore: this.score.home, awayScore: this.score.away });
        this._kickoffAfterScore(this.poss);
        return;
      }
      const wasFourth = (this.down === 4);
      if (r.incomplete) this.down++;
      else if (yards >= this.ytg) {
        this.stats[this.poss].team.firstDowns++;
        if (wasThird) this.stats[this.poss].team.thirdConv++;
        if (wasFourth) this.stats[this.poss].team.fourthConv++;
        this.down = 1; this.ytg = 10;
      }
      else { this.down++; this.ytg -= yards; }
      // Turnover on downs — failed 4th-down conversion gives ball to defense
      if (wasFourth && this.down > 4) {
        this._pushVisual({ kind: "to_downs", desc: `Turnover on downs!`, startYard: this.yardLine, endYard: this.yardLine });
        pushDriveSummary("TURNOVER ON DOWNS");
        this.drives.push({ team: start, result: "TURNOVER_ON_DOWNS", homeScore: this.score.home, awayScore: this.score.away });
        // Momentum: 4th-down stop is a massive defensive event.
        const _defSideStop = this.poss === "home" ? "away" : "home";
        this._swingMomentum(_defSideStop, 3, "4TH DOWN STOP");
        this._decayMomentum();
        this.poss = this.poss === "home" ? "away" : "home";
        this.yardLine = clamp(100 - this.yardLine, 1, 99);
        this.down = 1; this.ytg = 10;
        return;
      }
    }
    // Quarter-break continuity: if the while-loop exited because time hit
    // 0 mid-drive AT THE END OF Q1 OR Q3 (not halftime, not end-of-game),
    // the drive CONTINUES into the next quarter at the same down/distance.
    // Skip the drive summary push so the same drive doesn't get logged
    // twice. simulate() will bump the quarter, reset time to 900, and
    // call _drive() again with the preserved state.
    const isInterQuarterBreak = (this.time <= 0)
      && (this.quarter === 1 || this.quarter === 3)
      && plays > 0;
    if (isInterQuarterBreak) return;

    // Determine drive result from the most recent play's kind. By this
    // point all the special early-return cases (TD, turnover, etc.) have
    // already pushed their own summary. This catch-all covers FG good/miss/
    // blocked, punts, and end-of-half timeouts.
    let finalResult = "END OF DRIVE";
    const lastPlay = this.plays[this.plays.length - 1];
    if (lastPlay) {
      if      (lastPlay.kind === "fg_good")    finalResult = "FIELD GOAL";
      else if (lastPlay.kind === "fg_miss")    finalResult = "MISSED FG";
      else if (lastPlay.kind === "fg_blocked") finalResult = "FG BLOCKED";
      else if (lastPlay.kind === "punt")       finalResult = "PUNT";
      else if (this.time <= 0)                  finalResult = "END OF HALF";
    }
    pushDriveSummary(finalResult);
    this.drives.push({ team: start, result: "FG/Punt/TO", homeScore: this.score.home, awayScore: this.score.away });
  }
  simulate() {
    // Opening kickoff — track who receives so we can give the OTHER team
    // the ball at halftime (NFL rule). The team currently in this.poss
    // (set randomly in the constructor) is the receiver; the kicker is
    // the other side. Previously the visual hardcoded "away kicks off"
    // even when home actually had been randomly assigned the kick role.
    this.openingKickReceiver = this.poss;
    const openingKicker = this.poss === "home" ? "away" : "home";
    this._pushVisual({
      kind: "kickoff",
      desc: `${this[openingKicker].city} ${this[openingKicker].name} kicks off to ${this[this.openingKickReceiver].name}`,
      startYard: 35, endYard: 25,
      motion: { result: "openingKick", contactT: 0.05, catchT: 0.48, tackleT: 0.85 },
    });
    while (this.quarter <= 4) {
      if (this.time <= 0) {
        if (this.quarter === 2) {
          // Halftime — possession goes to the team that did NOT receive
          // the opening kickoff. Previously this just flipped whoever
          // was last on offense, which could be wrong depending on how
          // Q2 ended.
          this.timeouts = { home: 3, away: 3 };
          this.plays.push({ kind: "halftime", desc: "═══ HALFTIME ═══", quarter: 2, time: 0, homeScore: this.score.home, awayScore: this.score.away });
          const halfKicker = this.openingKickReceiver;
          const halfReceiver = this.openingKickReceiver === "home" ? "away" : "home";
          this.poss = halfReceiver;
          this.yardLine = 25; this.down = 1; this.ytg = 10;
          this._pushVisual({
            kind: "kickoff",
            desc: `${this[halfKicker].city} ${this[halfKicker].name} kicks off to start the second half`,
            startYard: 35, endYard: 25,
            motion: { result: "halftimeKick", contactT: 0.05, catchT: 0.48, tackleT: 0.85 },
          });
        }
        // Q1↔Q2 and Q3↔Q4: drive state (poss, yardLine, down, ytg) is
        // preserved on `this` — the next _drive() call continues the
        // in-progress drive at the same down/distance. _drive's tail
        // detects "time ran out mid-drive between quarters" and skips
        // the END-OF-HALF summary so the drive remains one logical unit.
        this.quarter++;
        // ── FATIGUE RECOVERY on the break ──
        // In-game fatigue was purely monotonic (no recovery anywhere), so every
        // high-snap starter redlined to ~95-100 by Q4 (audit caught this). Players
        // rest between quarters; the halftime break (Q2→Q3) restores the most. This
        // restores realistic end-game levels (workhorse ~60-70) and keeps the
        // stamina stat meaningful late instead of everyone saturating.
        {
          const _recMul = (this.quarter === 3) ? 0.55 : 0.88;   // halftime vs quarter break
          for (const nm in this._fatigue) this._fatigue[nm] *= _recMul;
        }
        // Quarter-break card for the Q1→Q2 and Q3→Q4 breaks only. The graphic
        // marks the quarter that JUST ENDED (the animation renders it as
        // "END OF Q{quarter}"); this.quarter was already incremented, so emit
        // quarter-1 — otherwise the Q1→Q2 break labeled "END OF Q2" (off by
        // one). The Q2→Q3 break is HALFTIME (its own card pushed above), so
        // skip the quarter card there to avoid a doubled graphic.
        const _endedQ = this.quarter - 1;
        if (this.quarter <= 4 && _endedQ !== 2) {
          this.plays.push({ kind: "quarter", desc: `─── End of Q${_endedQ} ───`, quarter: _endedQ, time: 0, homeScore: this.score.home, awayScore: this.score.away });
        }
        this.time = 900;
        continue;
      }
      this._drive();
    }
    if (this.score.home === this.score.away) {
      // Modern NFL regular-season overtime (2025 rule): both teams ALWAYS
      // get at least one possession, regardless of what happens on the
      // first drive (TD/FG/safety/punt). After both possessions, sudden
      // death applies. If still tied when the 10-minute clock expires,
      // the game ends in a tie (no more coin-flip-FG fallback).
      this.plays.push({ kind: "ot", desc: "═══ OVERTIME ═══", quarter: 5, time: 600, homeScore: this.score.home, awayScore: this.score.away });
      this.quarter = 5; this.time = 600;
      this.poss = Math.random() < 0.5 ? "home" : "away";
      this.yardLine = 25; this.down = 1; this.ytg = 10;
      const otReceiver = this.poss;
      const otKicker = this.poss === "home" ? "away" : "home";
      this._pushVisual({
        kind: "kickoff",
        desc: `${this[otKicker].city} ${this[otKicker].name} kicks off to open overtime`,
        startYard: 35, endYard: 25,
        motion: { result: "overtimeKick", contactT: 0.05, catchT: 0.48, tackleT: 0.85 },
      });
      // First possession
      if (this.time > 0) this._drive();
      // Per modern NFL rule, a SAFETY on the first OT drive ends the
      // game immediately — the defense scored, no second possession.
      // (TDs and FGs DON'T end OT under the 2025 rule; both teams
      // always get a possession unless this safety case fires.)
      const lastDrive = this.drives[this.drives.length - 1];
      const otSafetyEnded = lastDrive && lastDrive.result === "SAFETY";
      // Second possession — guaranteed unless OT-safety just ended things.
      // If a score happened on drive 1, _drive's TD/FG branch already
      // triggered _kickoffAfterScore so this.poss is already flipped.
      // If drive 1 ended in a punt/turnover-on-downs/turnover,
      // this.poss already flipped.
      if (!otSafetyEnded && this.time > 0) this._drive();
      // Sudden death — any score by either team wins. Safety cap at 8
      // drives to prevent pathological infinite loops if drives somehow
      // burn no clock.
      let sd = 0;
      while (this.score.home === this.score.away && this.time > 0 && sd < 8) {
        this._drive();
        sd++;
      }
      // If tied at end of OT, regular-season game ends in a tie. No
      // random FG fallback (previously line 2330-2332 would coin-flip
      // award 3 points to one team, which is not a rule).
    }
    // Build a player lookup map for hover tooltips
    const lookup = new Map();
    for (const p of this.hRoster) lookup.set(p.name, { ...p, team: "home" });
    for (const p of this.aRoster) lookup.set(p.name, { ...p, team: "away" });
    return {
      homeTeam: this.home, awayTeam: this.away,
      homeScore: this.score.home, awayScore: this.score.away,
      homeRatings: this.homeR, awayRatings: this.awayR,
      homeRoster: this.hRoster, awayRoster: this.aRoster,
      playerLookup: lookup,
      plays: this.plays, drives: this.drives,
      stats: this.stats,
      weather: this.weather,
      winner: this.score.home > this.score.away ? "home" : this.score.away > this.score.home ? "away" : "tie",
    };
  }
}

