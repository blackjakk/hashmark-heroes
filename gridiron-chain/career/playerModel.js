// Core player generator. Produces a fully-specified player with hidden stats,
// hidden traits, visible measurables, and identifying info.
//
// Generation order (per spec section 8):
//   1. Position (or use provided)
//   2. Height + weight from position-specific normal distributions
//   3. rookie_tier roll
//   4. longevity_tier roll
//   5. prime_start_age, prime_end_age computed (with QB pocket-score modifier)
//   6. ceiling_overall + starting_overall from rookie_tier
//   7. Hidden athletic + skill stats rolled to hit starting_overall (position-weighted)
//   8. Personality stats rolled independently
//   9. pocket_score (QB only)
//  10. Measurables computed from hidden stats + noise
//  11. Name + college + class info

import {
  POSITIONS, PHYSICAL_BY_POSITION,
  ROOKIE_TIER_RATES, ROOKIE_TIER_OVR,
  LONGEVITY_TIER_RATES, LONGEVITY_PRIME_END,
  POSITION_LONGEVITY_MOD, CLUTCH_TIER_RATES, RETIREMENT_STYLE_RATES,
  HIDDEN_STAT_KEYS, POSITION_STATS, FILLER_BASELINE, POSITION_FILLER_OVERRIDES,
} from "./constants.js";
import { normal, clamp, randInt, randFloat, weighted, pick } from "./random.js";
import { generateMeasurables } from "./measurables.js";
import { randomName } from "./names.js";
import { pickCollege } from "./colleges.js";

// ── Hidden stat generation ──────────────────────────────────────────────
//
// Three-tier model:
//   key stats:       roll near targetOverall (small variance)
//   secondary stats: roll between baseline and targetOverall
//   filler stats:    roll near a position-specific baseline (default 50)
//
// Then a calibration pass nudges the key stats so the position-weighted average
// lands near targetOverall (with a ceiling cap).
function rollHiddenStats(rng, position, targetOverall, ceilingOverall) {
  const cfg = POSITION_STATS[position];
  if (!cfg) throw new Error(`No stat config for position ${position}`);
  const overrides = POSITION_FILLER_OVERRIDES[position] || {};
  const stats = {};
  const keySet = new Set(cfg.key);
  const secSet = new Set(cfg.secondary);

  // Mental + personality stats — independent of position
  const mentalKeys = ["football_iq","discipline","work_ethic","leadership"];
  const personalityKeys = ["greed","temper","loyalty"];

  for (const key of HIDDEN_STAT_KEYS) {
    if (personalityKeys.includes(key)) {
      stats[key] = clamp(Math.round(normal(rng, 50, 18)), 5, 99);
      continue;
    }

    if (keySet.has(key)) {
      // Key stats — center on targetOverall, capped at ceiling
      const v = clamp(Math.round(normal(rng, targetOverall, 6)), 25, ceilingOverall);
      stats[key] = v;
    } else if (secSet.has(key)) {
      // Secondary — between filler baseline and ~80% of target
      const baseline = overrides[key] ?? FILLER_BASELINE.mean;
      const center = baseline + (targetOverall - baseline) * 0.55;
      const v = clamp(Math.round(normal(rng, center, 9)), 25, ceilingOverall);
      stats[key] = v;
    } else {
      // Filler — stays near baseline regardless of overall
      const baseline = overrides[key] ?? FILLER_BASELINE.mean;
      const sd = mentalKeys.includes(key) ? 12 : FILLER_BASELINE.sd;
      const v = clamp(Math.round(normal(rng, baseline, sd)), 20, 99);
      stats[key] = v;
    }
  }

  // Calibration pass: nudge key stats so weighted average matches targetOverall
  const w = cfg.overallWeights;
  const wKeys = Object.keys(w);
  if (wKeys.length > 0) {
    let sum = 0, totalW = 0;
    for (const k of wKeys) {
      sum += stats[k] * w[k];
      totalW += w[k];
    }
    const currentWeighted = sum / totalW;
    const delta = targetOverall - currentWeighted;
    if (Math.abs(delta) > 1) {
      for (const k of wKeys) {
        stats[k] = clamp(Math.round(stats[k] + delta * 0.7), 25, ceilingOverall);
      }
    }
  }

  return stats;
}

// Will to be Great — drawn from beta-like distribution favoring middle, with a long upper tail.
function rollWillToBeGreat(rng) {
  // Two normals blended: most players are 50–70, rare ones hit 90+
  const base = normal(rng, 60, 14);
  const tail = rng() < 0.07 ? normal(rng, 92, 4) : 0;
  return clamp(Math.round(Math.max(base, tail)), 5, 99);
}

// Compute current overall as a position-weighted average of hidden stats.
export function computeOverall(position, hidden) {
  const cfg = POSITION_STATS[position];
  if (!cfg) return 50;
  const w = cfg.overallWeights;
  let sum = 0, totalW = 0;
  for (const k of Object.keys(w)) {
    sum += (hidden[k] ?? 50) * w[k];
    totalW += w[k];
  }
  return clamp(Math.round(sum / totalW), 30, 99);
}

// QB pocket score: high = pocket passer, low = scrambler.
// Based on size + (lack of) burst.
function computePocketScore(height, weight, hidden) {
  // Tall + heavy + low burst → high pocket score
  const heightFactor = (height - 72) * 4;       // 6'4" → +12, 5'10" → -8
  const weightFactor = (weight - 215) * 0.4;    // 235 → +8, 195 → -8
  const speedPenalty = (hidden.burst - 60) * 0.6; // burst 90 → -18 (more scrambler)
  const score = 50 + heightFactor + weightFactor - speedPenalty;
  return clamp(Math.round(score), 0, 99);
}

// ── Top-level generator ─────────────────────────────────────────────────

let nextId = 1;
export function resetIdCounter() { nextId = 1; }

export function generatePlayer(rng, opts = {}) {
  const position = opts.position || pick(rng, POSITIONS);
  const phys = PHYSICAL_BY_POSITION[position];

  const height = clamp(Math.round(normal(rng, phys.height.mean, phys.height.sd)), 66, 80);
  const weight = clamp(Math.round(normal(rng, phys.weight.mean, phys.weight.sd)), 165, 340);

  // ── Trait rolls ──────────────────────────────────────────────────────
  const rookieTier    = weighted(rng, ROOKIE_TIER_RATES);
  const longevityTier = weighted(rng, LONGEVITY_TIER_RATES);
  const clutchTier    = weighted(rng, CLUTCH_TIER_RATES);
  const retirementStyle = weighted(rng, RETIREMENT_STYLE_RATES);

  const willToBeGreat = rollWillToBeGreat(rng);

  // Prime ages — base from longevity tier, adjusted by position later
  const primeStartAge = clamp(Math.round(normal(rng, 24, 1.0)), 21, 26);
  const longevityCfg = LONGEVITY_PRIME_END[longevityTier];
  let primeEndAge = Math.round(normal(rng, longevityCfg.mean, longevityCfg.sd));

  // ── Overall targets from rookie tier ─────────────────────────────────
  const ovr = ROOKIE_TIER_OVR[rookieTier];
  const ceilingOverall  = randInt(rng, ovr.ceilMin, ovr.ceilMax);
  const startingOverall = randInt(rng, ovr.startMin, ovr.startMax);

  // ── Hidden stat allocation ───────────────────────────────────────────
  const hidden = rollHiddenStats(rng, position, startingOverall, ceilingOverall);

  // ── QB pocket score + position-specific longevity modifier ───────────
  let pocketScore = null;
  let posLongevityMod = POSITION_LONGEVITY_MOD[position] || 0;
  if (position === "QB") {
    pocketScore = computePocketScore(height, weight, hidden);
    posLongevityMod = pocketScore > 70 ? 3 : pocketScore < 40 ? -2 : 0;
  }
  primeEndAge = clamp(primeEndAge + posLongevityMod, 27, 43);

  // WTG bonus to prime_end (slight extension for relentless players)
  if (willToBeGreat >= 85) primeEndAge += 1;
  if (willToBeGreat >= 95) primeEndAge += 1;

  // ── Measurables (visible) ────────────────────────────────────────────
  const measurables = generateMeasurables(rng, position, height, weight, hidden);

  // ── Identity ─────────────────────────────────────────────────────────
  const college = opts.college || pickCollege(rng, rookieTier);

  return {
    id: nextId++,
    name: opts.name || randomName(rng),
    age: opts.age ?? 22,
    position,
    college: college.school,
    conferenceId: college.conferenceId,
    conferenceName: college.conferenceName,
    conferenceTier: college.tier,
    classYear: opts.classYear || "PRO",  // FR/SO/JR/SR/PRO/RETIRED

    measurables,
    hidden,

    traits: {
      rookieTier,
      longevityTier,
      primeStartAge,
      primeEndAge,
      ceilingOverall,
      pocketScore,
      clutchTier,
      willToBeGreat,
      retirementStyle,
    },

    currentOverall: computeOverall(position, hidden),
  };
}

// Generate a draft class — n prospects across positions, weighted by realistic NFL roster distribution.
const DRAFT_POSITION_WEIGHTS = {
  QB: 6, RB: 8, WR: 12, TE: 7, OL: 16, DL: 14, LB: 10, CB: 12, S: 8, K: 3, P: 2,
};

export function generateDraftClass(rng, n = 60, opts = {}) {
  const players = [];
  const totalWeight = Object.values(DRAFT_POSITION_WEIGHTS).reduce((s, v) => s + v, 0);
  for (let i = 0; i < n; i++) {
    const position = weighted(rng, DRAFT_POSITION_WEIGHTS);
    players.push(generatePlayer(rng, { position, age: 22, classYear: "SR", ...opts }));
  }
  return players;
}

// Scout grade with noise per spec section 9
const SCOUT_NOISE_TABLE = {
  GENERATIONAL: [["GENERATIONAL", 0.85], ["STAR", 0.13], ["SOLID", 0.02]],
  STAR:         [["STAR", 0.78], ["GENERATIONAL", 0.06], ["SOLID", 0.13], ["BUST", 0.03]],
  SOLID:        [["SOLID", 0.80], ["STAR", 0.10], ["BUST", 0.10]],
  BUST:         [["BUST", 0.78], ["SOLID", 0.18], ["STAR", 0.04]],
};

export function scoutGrade(rng, player) {
  const truth = player.traits.rookieTier;
  const dist = SCOUT_NOISE_TABLE[truth];
  let roll = rng();
  for (const [label, p] of dist) {
    roll -= p;
    if (roll <= 0) {
      // Tier label + 1-10 numeric within the tier
      const numeric = randInt(rng, 4, 9) + (label === truth ? 1 : 0);
      return { tier: label, numeric: Math.min(10, numeric) };
    }
  }
  return { tier: truth, numeric: 7 };
}
