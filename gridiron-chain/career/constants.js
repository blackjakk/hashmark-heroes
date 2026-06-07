// All lookup tables and tier definitions for the player model.
// Numbers are tunable — keep them centralized here.

export const POSITIONS = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];

// Mean & sd of height (inches) and weight (lbs) per position.
// Tuned to roughly match real NFL distributions.
export const PHYSICAL_BY_POSITION = {
  QB: { height: { mean: 75.0, sd: 1.6 }, weight: { mean: 220, sd: 12 } },
  RB: { height: { mean: 70.5, sd: 1.5 }, weight: { mean: 215, sd: 10 } },
  WR: { height: { mean: 72.0, sd: 1.8 }, weight: { mean: 200, sd: 10 } },
  TE: { height: { mean: 76.0, sd: 1.4 }, weight: { mean: 250, sd:  9 } },
  OL: { height: { mean: 76.5, sd: 1.5 }, weight: { mean: 315, sd: 12 } },
  DL: { height: { mean: 75.0, sd: 1.7 }, weight: { mean: 290, sd: 18 } },
  LB: { height: { mean: 73.0, sd: 1.5 }, weight: { mean: 240, sd: 11 } },
  CB: { height: { mean: 71.0, sd: 1.6 }, weight: { mean: 195, sd:  8 } },
  S:  { height: { mean: 72.5, sd: 1.5 }, weight: { mean: 210, sd:  8 } },
  K:  { height: { mean: 73.0, sd: 1.8 }, weight: { mean: 200, sd: 11 } },
  P:  { height: { mean: 74.0, sd: 1.8 }, weight: { mean: 215, sd: 11 } },
};

// Hand size and arm length distributions (inches)
export const HAND_SIZE = { mean: 9.6, sd: 0.5, min: 8.5, max: 11.0 };
export const ARM_LENGTH = { mean: 32.6, sd: 1.2, min: 30.0, max: 36.0 };

// ─── Hidden trait tier rates ──────────────────────────────────────────────

export const ROOKIE_TIER_RATES = {
  BUST: 0.20,
  SOLID: 0.60,
  STAR: 0.17,
  GENERATIONAL: 0.03,
};

export const ROOKIE_TIER_OVR = {
  BUST:         { startMin: 50, startMax: 60, ceilMin: 60, ceilMax: 72 },
  SOLID:        { startMin: 60, startMax: 72, ceilMin: 70, ceilMax: 82 },
  STAR:         { startMin: 72, startMax: 82, ceilMin: 82, ceilMax: 92 },
  GENERATIONAL: { startMin: 82, startMax: 92, ceilMin: 92, ceilMax: 99 },
};

export const LONGEVITY_TIER_RATES = {
  STANDARD:    0.82,
  LATE_BLOOMER: 0.10,
  IRON_MAN:     0.06,
  LEGEND:       0.02,
};

export const LONGEVITY_PRIME_END = {
  STANDARD:    { mean: 30,   sd: 1.5 },
  LATE_BLOOMER:{ mean: 33,   sd: 1.0 },
  IRON_MAN:    { mean: 36,   sd: 1.0 },
  LEGEND:      { mean: 38.5, sd: 1.0 },
};

export const POSITION_LONGEVITY_MOD = {
  K:  +5,
  P:  +5,
  // QB modifier is computed dynamically from pocket_score
  QB: 0,
  WR: 0,
  TE: 0,
  CB: 0,
  S:  0,
  OL: -1,
  DL: -1,
  LB: -1,
  RB: -3,
};

export const CLUTCH_TIER_RATES = {
  FOLDS:     0.08,
  AVERAGE:   0.62,
  CLUTCH:    0.25,
  LEGENDARY: 0.05,
};

export const RETIREMENT_STYLE_RATES = {
  PRESEASON:  0.82,
  POSTSEASON: 0.12,
  SURPRISE:   0.05,
  SUDDEN:     0.01,
};

// Conference tiers (used at draft to discount/reward college competition)
export const CONFERENCE_TIER_LABELS = {
  ELITE: "🟡 ELITE",
  MID:   "🟢 MID-TIER",
  SUB:   "⚪ SUB-TIER",
};

// Recruiting bias — where each true rookie tier ends up by college tier
export const RECRUITING_BIAS = {
  GENERATIONAL: { ELITE: 0.92, MID: 0.07, SUB: 0.01 },
  STAR:         { ELITE: 0.75, MID: 0.22, SUB: 0.03 },
  SOLID:        { ELITE: 0.50, MID: 0.35, SUB: 0.15 },
  BUST:         { ELITE: 0.30, MID: 0.35, SUB: 0.35 },
};

// Per-position stat groupings. Three-tier model:
//   key:       core stats — scaled with the player's overall rating
//   secondary: contributing stats — partial scaling
//   (everything else is filler — stays near a position-baseline, doesn't track overall)
export const POSITION_STATS = {
  QB: {
    key:       ["arm_strength","accuracy_short","accuracy_deep","football_iq"],
    secondary: ["burst","cod","balance"],
    overallWeights: { arm_strength: 1.0, accuracy_short: 1.3, accuracy_deep: 1.2, football_iq: 1.3 },
  },
  RB: {
    key:       ["burst","balance","functional_strength","cod","lateral_quickness"],
    secondary: ["top_speed","hand_skill","stamina_pool","route_running"],
    overallWeights: { burst: 1.3, balance: 1.2, functional_strength: 1.1, cod: 1.0, lateral_quickness: 1.1 },
  },
  WR: {
    key:       ["top_speed","route_running","hand_skill","cod"],
    secondary: ["burst","balance","football_iq","lateral_quickness"],
    overallWeights: { top_speed: 1.2, route_running: 1.3, hand_skill: 1.4, cod: 1.1 },
  },
  TE: {
    key:       ["hand_skill","route_running","block_skill","functional_strength"],
    secondary: ["balance","top_speed","football_iq"],
    overallWeights: { hand_skill: 1.2, route_running: 1.1, block_skill: 1.2, functional_strength: 1.1 },
  },
  OL: {
    key:       ["functional_strength","block_skill","balance","football_iq"],
    secondary: ["discipline","stamina_pool"],
    overallWeights: { functional_strength: 1.3, block_skill: 1.5, balance: 1.0, football_iq: 1.0 },
  },
  DL: {
    key:       ["pass_rush","functional_strength","run_defense","burst"],
    secondary: ["top_speed","balance","football_iq"],
    overallWeights: { pass_rush: 1.4, functional_strength: 1.2, run_defense: 1.1, burst: 1.0 },
  },
  LB: {
    key:       ["tackle_skill","run_defense","top_speed","football_iq"],
    secondary: ["pass_rush","coverage_zone","cod","burst"],
    overallWeights: { tackle_skill: 1.3, run_defense: 1.2, top_speed: 1.0, football_iq: 1.1 },
  },
  CB: {
    key:       ["coverage_man","coverage_zone","top_speed","cod"],
    secondary: ["burst","football_iq","tackle_skill","balance","lateral_quickness"],
    overallWeights: { coverage_man: 1.3, coverage_zone: 1.1, top_speed: 1.2, cod: 1.3 },
  },
  S: {
    key:       ["coverage_zone","tackle_skill","football_iq","top_speed"],
    secondary: ["coverage_man","cod","burst","balance"],
    overallWeights: { coverage_zone: 1.2, tackle_skill: 1.2, football_iq: 1.2, top_speed: 1.1 },
  },
  K: {
    key:       ["kick_power","kick_accuracy"],
    secondary: ["football_iq","stamina_pool"],
    overallWeights: { kick_power: 1.4, kick_accuracy: 1.6 },
  },
  P: {
    key:       ["kick_power","kick_accuracy"],
    secondary: ["football_iq","stamina_pool"],
    overallWeights: { kick_power: 1.6, kick_accuracy: 1.3 },
  },
};

// Universal baseline — what a position-irrelevant stat lands at.
// e.g., an OL's burst lives near 45-55, regardless of how good a player they are.
export const FILLER_BASELINE = { mean: 50, sd: 8 };

// Athletic-baseline overrides (some positions have raised filler floors for athletic stats)
export const POSITION_FILLER_OVERRIDES = {
  RB: { top_speed: 75, burst: 80, cod: 75, balance: 75, lateral_quickness: 70 },
  WR: { burst: 75, top_speed: 75, lateral_quickness: 65 },
  CB: { burst: 75, top_speed: 78, lateral_quickness: 65 },
  S:  { burst: 70, top_speed: 72 },
  LB: { burst: 65, top_speed: 65 },
  DL: { functional_strength: 75 },
  OL: { functional_strength: 65, block_skill: 60 },           // even bad OL are big
  K:  {},
  P:  {},
  QB: {},
  TE: {},
};

// All hidden stat keys — a player object always has all of these.
export const HIDDEN_STAT_KEYS = [
  // Athletic
  "burst","top_speed","cod","lateral_quickness","balance","explosive_power",
  "functional_strength","stamina_pool","durability",
  // Skill
  "hand_skill","route_running","arm_strength","accuracy_short","accuracy_deep",
  "block_skill","pass_rush","run_defense","coverage_zone","coverage_man",
  "tackle_skill","kick_power","kick_accuracy",
  // Mental
  "football_iq","discipline","work_ethic","leadership",
  // Personality
  "greed","temper","loyalty",
];

// Visibility tiers used when displaying another team's player
export const VISIBILITY = {
  HIDDEN:        { label: "Unscouted",        noise: null, badge: "—" },
  ROSTER:        { label: "Measured",         noise: 0.03, badge: "✓ MEASURED" },
  RECENT_FILM:   { label: "Recent film",      noise: 0.10, badge: "Recent film" },
  LAST_SEASON:   { label: "Last season",      noise: 0.15, badge: "Last season" },
  STALE_FILM:    { label: "Stale film",       noise: 0.25, badge: "⚠ Stale film" },
  RELEASED_VET:  { label: "Released vet",     noise: 0.20, badge: "Released vet" },
};
