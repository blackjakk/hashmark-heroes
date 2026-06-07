// Offensive + defensive schemes and the per-player fit calculator.
// A player's scheme_fit is a multiplier applied to their effectiveness in the sim.
// It's also shown (with noise) in the draft room for prospect evaluation.

// Each scheme defines a `demands` map: { stat: weight } per position.
// scheme_fit for a player at position P:
//   weighted_avg(player.hidden[stat]) over scheme.demands[P]
// then mapped to a 0-100% fit score.

export const OFFENSIVE_SCHEMES = {
  AIR_RAID: {
    id: "AIR_RAID",
    name: "Air Raid",
    archetype: "Chuck it deep, spread the field",
    demands: {
      QB: { arm_strength: 1.5, accuracy_deep: 1.4, football_iq: 1.0 },
      WR: { top_speed: 1.4, hand_skill: 1.3, route_running: 1.0 },
      TE: { route_running: 1.0, hand_skill: 1.0 },
      RB: { hand_skill: 1.0, burst: 0.9 },
      OL: { block_skill: 1.2, balance: 1.0 },
    },
  },
  WEST_COAST: {
    id: "WEST_COAST",
    name: "West Coast",
    archetype: "Precision timing, short-to-intermediate",
    demands: {
      QB: { accuracy_short: 1.5, football_iq: 1.4, accuracy_deep: 1.0 },
      WR: { route_running: 1.5, cod: 1.3, hand_skill: 1.2 },
      TE: { route_running: 1.3, hand_skill: 1.2, block_skill: 1.0 },
      RB: { hand_skill: 1.2, route_running: 1.0, burst: 1.0 },
      OL: { block_skill: 1.3, balance: 1.0 },
    },
  },
  POWER_RUN: {
    id: "POWER_RUN",
    name: "Power Run",
    archetype: "Grind it, impose your will",
    demands: {
      QB: { accuracy_short: 1.0, football_iq: 1.1 },
      RB: { functional_strength: 1.5, balance: 1.4, burst: 1.1 },
      OL: { functional_strength: 1.5, block_skill: 1.5 },
      TE: { block_skill: 1.4, functional_strength: 1.2 },
      WR: { hand_skill: 1.0 },
    },
  },
  SPREAD_RPO: {
    id: "SPREAD_RPO",
    name: "Spread / RPO",
    archetype: "QB as weapon, stress the defense",
    demands: {
      QB: { burst: 1.4, cod: 1.2, football_iq: 1.5, accuracy_short: 1.2 },
      RB: { burst: 1.4, cod: 1.3, hand_skill: 1.0 },
      WR: { burst: 1.3, route_running: 1.2, hand_skill: 1.1 },
      TE: { route_running: 1.0 },
      OL: { block_skill: 1.2, balance: 1.1, cod: 1.0 },
    },
  },
  PRO_STYLE: {
    id: "PRO_STYLE",
    name: "Pro Style",
    archetype: "Classic NFL, full playbook",
    demands: {
      QB: { accuracy_short: 1.2, accuracy_deep: 1.2, football_iq: 1.5, arm_strength: 1.1 },
      RB: { balance: 1.2, functional_strength: 1.1, hand_skill: 1.1 },
      WR: { route_running: 1.3, hand_skill: 1.2 },
      TE: { route_running: 1.1, block_skill: 1.1, hand_skill: 1.1 },
      OL: { block_skill: 1.3, functional_strength: 1.2 },
    },
  },
  VERTICAL: {
    id: "VERTICAL",
    name: "Vertical Stretch",
    archetype: "Attack all levels, isolate mismatches",
    demands: {
      QB: { arm_strength: 1.5, accuracy_deep: 1.4 },
      WR: { top_speed: 1.5, burst: 1.2, hand_skill: 1.2 },
      TE: { route_running: 1.3, hand_skill: 1.1 },
      RB: { burst: 1.1 },
      OL: { block_skill: 1.4 },
    },
  },
};

export const DEFENSIVE_SCHEMES = {
  FOUR_THREE: {
    id: "FOUR_THREE",
    name: "4-3",
    archetype: "Classic gap control, DE-heavy",
    demands: {
      DL: { pass_rush: 1.4, run_defense: 1.2, functional_strength: 1.1 },
      LB: { tackle_skill: 1.4, run_defense: 1.3, top_speed: 1.0 },
      CB: { coverage_man: 1.1, coverage_zone: 1.1 },
      S:  { tackle_skill: 1.1, coverage_zone: 1.0 },
    },
  },
  THREE_FOUR: {
    id: "THREE_FOUR",
    name: "3-4",
    archetype: "Versatile, disguise-heavy",
    demands: {
      DL: { functional_strength: 1.5, run_defense: 1.3 },
      LB: { pass_rush: 1.4, coverage_zone: 1.1, tackle_skill: 1.1 },
      CB: { coverage_man: 1.1, coverage_zone: 1.1 },
      S:  { football_iq: 1.2, tackle_skill: 1.0 },
    },
  },
  COVER_2: {
    id: "COVER_2",
    name: "Cover 2 / Tampa 2",
    archetype: "Two-deep, take away the deep ball",
    demands: {
      DL: { pass_rush: 1.3 },
      LB: { top_speed: 1.3, coverage_zone: 1.4, tackle_skill: 1.1 },
      CB: { coverage_zone: 1.4, tackle_skill: 1.1 },
      S:  { coverage_zone: 1.4, top_speed: 1.2 },
    },
  },
  COVER_3: {
    id: "COVER_3",
    name: "Cover 3 Zone",
    archetype: "Three-deep, bend-don't-break",
    demands: {
      DL: { pass_rush: 1.1, run_defense: 1.1 },
      LB: { coverage_zone: 1.3, tackle_skill: 1.1 },
      CB: { coverage_zone: 1.5, football_iq: 1.2 },
      S:  { coverage_zone: 1.4, football_iq: 1.1 },
    },
  },
  PRESS_MAN: {
    id: "PRESS_MAN",
    name: "Press Man",
    archetype: "Lock up, no cushion, aggressive",
    demands: {
      DL: { pass_rush: 1.4 },
      LB: { coverage_man: 1.1, top_speed: 1.1 },
      CB: { coverage_man: 1.5, cod: 1.4, burst: 1.2 },
      S:  { tackle_skill: 1.2, coverage_man: 1.1 },
    },
  },
  ZONE_BLITZ: {
    id: "ZONE_BLITZ",
    name: "Zone Blitz",
    archetype: "Confuse the QB, mixed looks",
    demands: {
      DL: { football_iq: 1.2, pass_rush: 1.2 },
      LB: { pass_rush: 1.2, coverage_zone: 1.3, football_iq: 1.2 },
      CB: { coverage_zone: 1.2, football_iq: 1.1 },
      S:  { coverage_zone: 1.2, football_iq: 1.2 },
    },
  },
};

export const ALL_OFFENSIVE_IDS = Object.keys(OFFENSIVE_SCHEMES);
export const ALL_DEFENSIVE_IDS = Object.keys(DEFENSIVE_SCHEMES);

// Compute scheme_fit for a player against a scheme.
// Returns { fit: 0-100, multiplier: 0.88-1.08 }.
// `useStats` allows callers to pass in noisy/observed stats instead of the player's true ones —
// this is how draft-room fit % gets its noise.
export function schemeFit(player, scheme, useStats = null) {
  const stats = useStats || player.hidden;
  const demand = scheme.demands[player.position];
  if (!demand) {
    // Position not directly addressed (e.g., K/P on offensive scheme) → neutral fit
    return { fit: 60, multiplier: 1.0 };
  }
  let weighted = 0, totalW = 0;
  for (const [key, w] of Object.entries(demand)) {
    const v = stats[key] ?? 50;
    weighted += v * w;
    totalW += w;
  }
  const avg = weighted / totalW;
  // Map 50 → 60% fit, 80 → 90% fit, 99 → 100% fit
  const fit = Math.min(100, Math.max(20, Math.round(avg * 0.95 + 12)));
  // Multiplier per spec: 90+→+8%, 75-89→+3%, 60-74→0, 45-59→-5%, <45→-12%
  const multiplier =
    fit >= 90 ? 1.08 :
    fit >= 75 ? 1.03 :
    fit >= 60 ? 1.00 :
    fit >= 45 ? 0.95 :
                0.88;
  return { fit, multiplier };
}

// Helper: compute fit % for all offensive schemes (or all defensive, depending on player position).
export function allFits(player) {
  const isDef = ["DL","LB","CB","S"].includes(player.position);
  const schemes = isDef ? DEFENSIVE_SCHEMES : OFFENSIVE_SCHEMES;
  const result = {};
  for (const [id, scheme] of Object.entries(schemes)) {
    result[id] = schemeFit(player, scheme);
  }
  return result;
}
