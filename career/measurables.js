// Computes visible combine measurables from hidden stats + adds gaussian noise.
// This is the inverse-direction mapping a GM tries to reverse-engineer.

import { normal, clamp, round1, round2, randInt } from "./random.js";
import { HAND_SIZE, ARM_LENGTH } from "./constants.js";

// Map a 0–99 stat to a measurement scale.
// Returns time/distance such that stat=99 → bestVal, stat=50 → midVal, stat=0 → worstVal
// Linear interpolation; weight penalty added by caller where relevant.
function statToScale(stat, worstVal, midVal, bestVal) {
  // Two-segment linear (worst→mid for 0..50, mid→best for 50..99)
  if (stat <= 50) {
    const t = stat / 50;
    return worstVal + (midVal - worstVal) * t;
  } else {
    const t = (stat - 50) / 49;
    return midVal + (bestVal - midVal) * t;
  }
}

// 10-yard split (seconds) — burst-dominated
function compute10Split(rng, hidden, weight) {
  const true_ = statToScale(hidden.burst, 1.85, 1.65, 1.42);
  const wPenalty = Math.max(0, weight - 220) * 0.0006;
  return round2(true_ + wPenalty + normal(rng, 0, 0.025));
}

// 40-yard dash — blend of burst (45%) + top_speed (50%) + small acceleration term
function compute40(rng, hidden, weight) {
  const blend = hidden.burst * 0.45 + hidden.top_speed * 0.50 + hidden.balance * 0.05;
  const true_ = statToScale(blend, 5.40, 4.85, 4.20);
  const wPenalty = Math.max(0, weight - 200) * 0.0011;
  return round2(true_ + wPenalty + normal(rng, 0, 0.040));
}

// 100-yard time — top_speed dominated
function compute100(rng, hidden, weight) {
  const blend = hidden.top_speed * 0.75 + hidden.burst * 0.15 + hidden.stamina_pool * 0.10;
  const true_ = statToScale(blend, 12.5, 11.1, 9.85);
  const wPenalty = Math.max(0, weight - 200) * 0.004;
  return round2(true_ + wPenalty + normal(rng, 0, 0.10));
}

// 20-yard shuttle — COD + lateral_quickness dominated
function computeShuttle(rng, hidden, weight) {
  const lat = hidden.lateral_quickness ?? 50;
  const blend = hidden.cod * 0.45 + lat * 0.30 + hidden.burst * 0.15 + hidden.balance * 0.10;
  const true_ = statToScale(blend, 4.85, 4.30, 3.95);
  const wPenalty = Math.max(0, weight - 220) * 0.0010;
  return round2(true_ + wPenalty + normal(rng, 0, 0.06));
}

// 3-cone drill — COD + burst + lateral combo
function computeThreeCone(rng, hidden, weight) {
  const lat = hidden.lateral_quickness ?? 50;
  const blend = hidden.cod * 0.45 + lat * 0.20 + hidden.burst * 0.20 + hidden.balance * 0.15;
  const true_ = statToScale(blend, 7.95, 7.05, 6.45);
  const wPenalty = Math.max(0, weight - 220) * 0.0014;
  return round2(true_ + wPenalty + normal(rng, 0, 0.08));
}

// Vertical jump (inches) — explosive_power dominated
function computeVertical(rng, hidden, weight) {
  const blend = hidden.explosive_power * 0.90 + hidden.functional_strength * 0.10;
  const true_ = statToScale(blend, 24, 33, 46);
  const wPenalty = Math.max(0, weight - 230) * 0.025;
  return Math.round(true_ - wPenalty + normal(rng, 0, 1.5));
}

// Broad jump (inches)
function computeBroad(rng, hidden, weight) {
  const blend = hidden.explosive_power * 0.70 + hidden.balance * 0.15 + hidden.burst * 0.15;
  const true_ = statToScale(blend, 96, 116, 135);
  const wPenalty = Math.max(0, weight - 230) * 0.05;
  return Math.round(true_ - wPenalty + normal(rng, 0, 2.5));
}

// Bench press @ 225lb
function computeBench(rng, hidden, weight) {
  const sizeBoost = Math.max(0, (weight - 220)) * 0.05;
  const blend = hidden.functional_strength;
  const true_ = statToScale(blend, 6, 18, 38);
  return Math.max(0, Math.round(true_ + sizeBoost + normal(rng, 0, 1.2)));
}

// Hand size (inches) — derived from height with mild noise
function computeHandSize(rng, height) {
  const heightFactor = (height - 73) * 0.05;
  const v = HAND_SIZE.mean + heightFactor + normal(rng, 0, HAND_SIZE.sd);
  return round1(clamp(v, HAND_SIZE.min, HAND_SIZE.max));
}

// Arm length (inches) — strongly correlates with height
function computeArmLength(rng, height) {
  const heightFactor = (height - 73) * 0.45;
  const v = ARM_LENGTH.mean + heightFactor + normal(rng, 0, ARM_LENGTH.sd * 0.6);
  return round1(clamp(v, ARM_LENGTH.min, ARM_LENGTH.max));
}

export function generateMeasurables(rng, position, height, weight, hidden) {
  return {
    height,           // inches
    weight,           // lbs
    forty:      compute40(rng, hidden, weight),
    splitTen:   compute10Split(rng, hidden, weight),
    hundred:    compute100(rng, hidden, weight),
    shuttle:    computeShuttle(rng, hidden, weight),
    threeCone:  computeThreeCone(rng, hidden, weight),
    vertical:   computeVertical(rng, hidden, weight),
    broadJump:  computeBroad(rng, hidden, weight),
    benchReps:  computeBench(rng, hidden, weight),
    handSize:   computeHandSize(rng, height),
    armLength:  computeArmLength(rng, height),
  };
}

// Format helpers for display
export function formatHeight(inches) {
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return `${ft}'${inch}"`;
}
export function formatHandSize(inches) {
  const whole = Math.floor(inches);
  const frac = inches - whole;
  const eighths = Math.round(frac * 8);
  if (eighths === 0) return `${whole}"`;
  if (eighths === 8) return `${whole + 1}"`;
  return `${whole} ${eighths}/8"`;
}
