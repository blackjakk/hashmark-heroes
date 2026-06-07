// Deterministic random helpers. All randomness is seeded by an RNG passed into
// generators so the same seed always produces the same draft class / player.
// This is essential for the future Mega League where multiple clients must
// deterministically reproduce identical games.

// xorshift32 — fast, deterministic, good enough for game logic
export function makeRng(seed) {
  let state = (seed | 0) || 1;
  return function () {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Convert to [0, 1)
    return ((state >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}

// Box-Muller for normal distribution
export function normal(rng, mean = 0, sd = 1) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function randInt(rng, lo, hi) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

export function randFloat(rng, lo, hi) {
  return rng() * (hi - lo) + lo;
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Weighted choice from a {key: weight} table
export function weighted(rng, table) {
  const entries = Object.entries(table);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

export function round1(v) { return Math.round(v * 10) / 10; }
export function round2(v) { return Math.round(v * 100) / 100; }
