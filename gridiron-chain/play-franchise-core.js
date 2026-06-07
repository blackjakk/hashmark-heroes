// ─── FRANCHISE MODE ────────────────────────────────────────────────────────
// Full multi-season career mode. Pick a team, play 14-game regular season,
// 8-team playoffs, end-of-season awards, basic offseason (age/retire/rookies).
// State persisted in localStorage so it survives page reloads.

const FRANCHISE_KEY   = "gc_franchise_v1";
const FRANCHISE_WEEKS = 17;
const PLAYOFF_TEAMS   = 8;
const SALARY_CAP_BASE = 200; // $M — grows ~5-9% each offseason

// Inline confirmation state — avoids browser confirm()/alert() dialogs.
let _restructurePending = null; // {teamId,name,pos,currentBase,newProration,freed,remaining}
let _releasePending     = null; // {name,pos,deadPerYr,deadYrs,deadTotal,june1,j1Year1,j1Year2,j1Allowed,j1Used}
let _payCutPending      = null; // {name,pos,currentAav,market,overpayPct,result:null|"accept"|"decline",newAav,cutPct}

// NFL post-June 1 cap rule: each team gets 2 designations per offseason.
// Normal cut: all remaining bonus proration counts as dead cap (spread over
// remaining years in our model). June-1 cut: only this year's proration
// counts in the current cap year; the rest lumps into next year. Saves cap
// NOW at the cost of cap later.
const JUNE1_DESIGNATIONS_PER_TEAM = 2;
function _june1Used(teamId) {
  return ((franchise?._june1Used || {})[teamId]) || 0;
}
function _june1Remaining(teamId) {
  return Math.max(0, JUNE1_DESIGNATIONS_PER_TEAM - _june1Used(teamId));
}
let _resignPreview      = null; // idx of resign row showing year-by-year signing preview

// ── Practice squad system ────────────────────────────────────────────────────
// Each team carries a 6-spot PS roster of young players (≤2 yrs exp, age ≤24).
// Per-spot cost ($0.5M) loads against the cap separately from active roster.
// Players get a weekly "flash roll" — small chance of showing breakout
// upside. Other teams can scout your PS to reveal hidden potential, then
// poach the gem. Auto-spend lets the user burn unused visits at week
// advance so they're not wasted.
const PS_SLOTS         = 6;
const PS_COST_PER_SLOT = 0.5;     // $M
const PS_MAX_AGE       = 24;
const PS_MAX_YEARS_EXP = 2;
const SCOUT_VISITS_PER_WEEK = 2;
const WORKOUT_SLOTS_PER_FA_SEASON = 5;
// Weekly flash probabilities per PS player.
const PS_FLASH_PROBS = {
  small: 0.03,    // +0-1 OVR
  wow:   0.005,   // +3-5 OVR + wire alert
  gem:   0.001,   // +8+ OVR + big wire alert
};

// ── Salary cap helpers ───────────────────────────────────────────────────────
// Per-position rate: fraction of cap that a 100-OVR player would earn.
const CAP_POS_RATE = {
  QB: 0.25, RB: 0.08, WR: 0.12, TE: 0.07, OL: 0.06,
  DL: 0.065, LB: 0.065, CB: 0.09, S: 0.055, K: 0.025, P: 0.022,
};

// ── Cap-RELATIVE salary floors ────────────────────────────────────────────────
// Every meaningful contract value is a fraction of the current cap, so the
// FLOORS must be too. A flat $X minimum (the old code) shrinks to nothing as the
// cap inflates ~7%/yr; since floor-paid players occupy real roster slots, their
// decaying cap-share leaks league cap utilization the longer a franchise runs
// (8-season ~88%, 100-season ~84% — the drift signature of mixed units). These
// fractions reproduce the historical dollar values EXACTLY at the $200M base cap,
// then scale with the cap thereafter. Real NFL min ≈ 0.3% of cap.
const _MIN_SALARY_FRAC    = 0.004;   // 0.4% of cap  → $0.8M at base
const _MIN_SALARY_SPREAD  = 0.0035;  // up to +0.35% → reproduces the old $0.8–1.5M at base
const _ABS_SALARY_FLOOR_FRAC = 0.0025; // hard backstop → $0.5M at base
const _PS_SLOT_FRAC       = 0.0025;  // practice-squad slot → $0.5M at base
function _capRef(cap) {
  return cap
    || (typeof franchise !== "undefined" && franchise && franchise.salaryCap)
    || SALARY_CAP_BASE;
}
// League-minimum veteran salary for the given cap, with a small random spread.
// At the $200M base this returns $0.8–1.5M, identical to the old flat minimum.
function leagueMinSalary(cap) {
  const c = _capRef(cap);
  return Math.round((c * _MIN_SALARY_FRAC + Math.random() * c * _MIN_SALARY_SPREAD) * 10) / 10;
}
// Absolute salary backstop (no contract rounds below this). $0.5M at base.
function absSalaryFloor(cap) {
  return Math.round(_capRef(cap) * _ABS_SALARY_FLOOR_FRAC * 10) / 10;
}

// Render the inner HTML for an "AAV vs current market" cell. A clear
// signal — overpaid is red, bargain is green, within $1M is "≈ Market".
// Caller wraps the result in <td>.
function vsMarketCell(aav, market) {
  const diff = +(aav - market).toFixed(1);
  const cls  = "font-size:.65rem";
  if (Math.abs(diff) < 1.0) {
    return `<span style="color:var(--gray);${cls}">≈ Market</span>`;
  }
  const sign = diff > 0 ? "+" : "−";
  const color = diff > 2 ? "var(--red)" : diff < -2 ? "var(--green-lt)" : "var(--gray)";
  const label = diff > 0 ? "over" : "value";
  return `<span style="color:${color};${cls}">${sign}$${Math.abs(diff).toFixed(1)}M ${label}</span>`;
}

function computeMarketValue(player, cap) {
  const ovr  = player.overall || 70;
  const pos  = player.position;
  const rate = CAP_POS_RATE[pos] || 0.06;
  const capRef = cap || SALARY_CAP_BASE;
  // Base scales from 0 at OVR 55 to rate×cap at OVR 100
  let val = capRef * rate * Math.max(0, (ovr - 55) / 45);
  // Age adjustment
  const age = player.age || 27;
  if (age <= 25)      val *= 1.10;
  else if (age >= 34) val *= 0.75;
  else if (age >= 31) val *= 0.90;
  return Math.max(0.5, Math.round(val * 10) / 10);
}

// Deterministic per-player negotiation factor (0.82–1.22). Drives the
// realistic variance you see on the "vs Market" column — agents,
// leverage, draft pedigree, timing all push real contracts off the
// theoretical market value. Hashed from the player name so the value
// is stable across renders.
function negotiationFactor(p) {
  let h = 0;
  const s = String(p?.name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  // 41 buckets in [-0.20, +0.20], shifted to [0.82, 1.22] with a
  // small tilt: 1st-round picks negotiate harder (skew up),
  // undrafted skew slightly down.
  const base = ((Math.abs(h) % 41) - 20) / 100;
  let tilt = 0;
  if (p?.draftRound === 1) tilt += 0.03;
  else if (p?.draftRound >= 5) tilt -= 0.02;
  else if (p?.draftRound === 0) tilt -= 0.04;
  return Math.max(0.78, Math.min(1.25, 1 + base + tilt));
}

// ── Contract structure helpers ──────────────────────────────────────────────
// Signing bonus as a % of total contract value, prorated over min(years,5).
// Stars get bigger bonuses (more dead cap risk), backups get nothing.
function _signingBonusCalc(aav, years, ovr) {
  let pct = 0;
  if      (ovr >= 90) pct = 0.40;
  else if (ovr >= 85) pct = 0.28;
  else if (ovr >= 80) pct = 0.16;
  else if (ovr >= 75) pct = 0.08;
  const prorationYears = Math.min(years, 5);
  const signingBonus = Math.round(aav * years * pct * 10) / 10;
  const bonusProration = signingBonus > 0
    ? Math.round(signingBonus / prorationYears * 10) / 10
    : 0;
  // Trade kicker: elite players protect against being flipped cheaply.
  // Receiving team absorbs this as a one-time cap hit when they acquire the player.
  const kickerPct = ovr >= 90 ? 0.15 : ovr >= 85 ? 0.10 : ovr >= 82 ? 0.05 : 0;
  const tradeKicker = kickerPct > 0 ? Math.round(aav * kickerPct * 10) / 10 : 0;
  return { signingBonus, bonusProration, tradeKicker };
}

// Per-year base salaries (cap hit = base + bonusProration each year).
// BACKLOADED: ramps from ~65% to ~135% of average base — cheap now, expensive later.
// FRONTLOADED: opposite — player secures money early.
// BALANCED: flat.
function _baseSalarySchedule(aav, years, structure, bonusProration) {
  const basePerYear = aav - bonusProration;
  if (years <= 1 || structure === "BALANCED") {
    return Array(years).fill(Math.round(basePerYear * 10) / 10);
  }
  const spread = 0.35;
  const raw = [];
  for (let i = 0; i < years; i++) {
    const t = i / Math.max(1, years - 1);
    const scale = structure === "BACKLOADED"
      ? 1 - spread / 2 + spread * t
      : 1 + spread / 2 - spread * t;
    raw.push(scale);
  }
  const mean = raw.reduce((s, x) => s + x, 0) / years;
  return raw.map(s => Math.max(0.5, Math.round(basePerYear * (s / mean) * 10) / 10));
}

// Default structure: veterans lean backloaded (team-friendly now),
// young stars tend frontloaded (player secures early money).
function _defaultStructure(age, ovr) {
  if (age <= 25 && ovr >= 82) return "FRONTLOADED";
  if (age >= 30)               return "BACKLOADED";
  return "BALANCED";
}

function generateContract(player, cap, structureOverride) {
  const ovr = player.overall || 70;
  const age = player.age || 25;
  const startSeason = (typeof franchise !== "undefined" && franchise?.season ? franchise.season : 1) + 1;

  // Fix 1: Minimum salary for low-OVR players — 1yr, no signing bonus, zero dead cap.
  // These are the easy "camp cut" candidates that give GMs roster flexibility.
  if (ovr < 70) {
    const minAav = leagueMinSalary(cap);
    return {
      years: 1, remaining: 1, aav: minAav, structure: "BALANCED",
      baseSalaries: [minAav], signingBonus: 0, bonusProration: 0,
      guaranteedYears: 0, guaranteedAAV: minAav, incentives: [], signedAav: minAav,
      signedOvr: ovr, startSeason, _demandCycles: 0,
    };
  }

  const market = computeMarketValue(player, cap);
  const factor = negotiationFactor(player);
  const aav = Math.max(0.5, Math.round(market * factor * 10) / 10);

  // Fix 4: Backup contract length cap — lower-OVR players get shorter deals
  // so there's always a pool of cuttable contracts without long dead-cap tails.
  let minYr = 2, maxYr = 5;
  if (age <= 23)      { minYr = 4; maxYr = 4; }
  else if (ovr >= 88) { minYr = 4; maxYr = 7; }
  else if (ovr >= 82) { minYr = 3; maxYr = 6; }
  else if (ovr >= 76) { minYr = 2; maxYr = 3; } // solid backups: 2-3yr max
  else                { minYr = 1; maxYr = 2; } // fringe starters: 1-2yr only
  maxYr = Math.min(maxYr, Math.max(1, 38 - age));
  // Respect position+age realistic ceiling so AI signings match what the
  // user can offer. _maxContractYears unlocks 10yr for Mahomes-tier young
  // QBs, caps K/P at 4, RB at 5, and ages everyone out by 39/41.
  if (typeof _maxContractYears === "function") {
    maxYr = Math.min(maxYr, _maxContractYears(player));
  }
  const years = Math.max(1, Math.min(10, minYr + Math.floor(Math.random() * (Math.max(minYr, maxYr) - minYr + 1))));
  const structure = structureOverride || _defaultStructure(age, ovr);
  const { signingBonus, bonusProration, tradeKicker } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, structure, bonusProration);
  return {
    years, remaining: years, aav, structure,
    baseSalaries, signingBonus, bonusProration, tradeKicker,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav, incentives: [], signedAav: aav,
    signedOvr: ovr, startSeason, _demandCycles: 0,
  };
}

// NFL-style rookie wage scale (slotted). AAV is anchored on draft
// round + pick, with a small position multiplier so QB / OL / EDGE
// see a premium and K/P see a discount. Deliberately decoupled from
// the player's OVR — a 4th-round QB who happens to be good still
// only signs a 4th-round-money deal.
const _ROOKIE_AAV_BY_ROUND = {
  1: 0.045,    // R1: 4.5% of cap base
  2: 0.018,
  3: 0.012,
  4: 0.008,
  5: 0.0055,
  6: 0.0045,
  7: 0.0038,
  0: 0.0035,   // UDFA — close to league minimum
};
const _ROOKIE_POS_MUL = {
  QB: 1.30, OL: 1.10, DL: 1.05, CB: 1.05, WR: 1.05,
  LB: 1.00, S: 0.95, TE: 0.95, RB: 0.92, K: 0.70, P: 0.70,
};
function rookieContract(player, cap) {
  const round  = player.draftRound ?? 0;
  const pick   = player.draftPick  ?? 1;
  const capRef = cap || SALARY_CAP_BASE;
  const baseRate = _ROOKIE_AAV_BY_ROUND[round] ?? _ROOKIE_AAV_BY_ROUND[7];
  const pickPos = Math.max(0, (pick || 1) - 1);
  const decay = round === 1 ? 1 - (pickPos / 32) * 0.40
              : round === 2 ? 1 - (pickPos / 32) * 0.25
              : round <= 4  ? 1 - (pickPos / 32) * 0.15
              :               1 - (pickPos / 32) * 0.10;
  const posMul = _ROOKIE_POS_MUL[player.position] ?? 1.0;
  const aav = Math.max(0.5, Math.round(capRef * baseRate * decay * posMul * 10) / 10);
  const years = round === 0 ? 3 : 4;
  // Rookies always get balanced/slotted deals — no signing bonus for UDFA,
  // small bonus for drafted players (R1 gets meaningful proration).
  const ovr = player.overall || 70;
  const { signingBonus, bonusProration, tradeKicker } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, "BALANCED", bonusProration);
  // Stamp the same engine-required fields every other contract path
  // stamps: startSeason (cooldown anchor), signedOvr (outperformance
  // baseline — critical for rookies who develop e.g. 70 → 84 OVR over
  // their rookie deal), signedAav (money's worth math), _demandCycles
  // (escalator counter). Without signedOvr stamped at signing, the
  // _backfillDemandFields helper would default it to current OVR at
  // first read — so a developed rookie would appear to have +0
  // outperformance and the engine would never fire mid-rookie demands.
  return {
    years, remaining: years, aav, structure: "BALANCED",
    baseSalaries, signingBonus, bonusProration, tradeKicker,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav,
    signedAav: aav,
    signedOvr: ovr,
    startSeason: (typeof franchise !== "undefined" && franchise?.season ? franchise.season : 1) + 1,
    _demandCycles: 0,
    incentives: [],
  };
}

function assignContracts(rosters, cap) {
  const capTarget = (cap || SALARY_CAP_BASE) * 0.90; // Fix 2: target 90% of cap per roster
  for (const roster of Object.values(rosters)) {
    const freshPlayers = [];
    for (const p of roster) {
      if (!p.contract) {
        p.contract = generateContract(p, cap);
        if ((p.age || 25) > 23) {
          p.contract.remaining = Math.max(1, Math.ceil(Math.random() * p.contract.years));
        }
        freshPlayers.push(p);
      }
    }

    // Fix 2: Cap-aware normalization for fresh rosters.
    // If total cap hit exceeds 90% of cap, scale down lower-OVR players first,
    // then proportionally scale everyone until we're within budget.
    if (freshPlayers.length >= roster.length * 0.8) {
      let totalHit = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
      if (totalHit > capTarget) {
        // First pass: convert OVR<75 players to minimum deals if still over
        for (const p of roster) {
          if (totalHit <= capTarget) break;
          if ((p.overall || 70) < 75 && p.contract && p.contract.bonusProration > 0) {
            const oldHit = currentYearCapHit(p);
            const minAav = leagueMinSalary(cap);
            p.contract = { years:1, remaining:1, aav:minAav, structure:"BALANCED",
              baseSalaries:[minAav], signingBonus:0, bonusProration:0,
              guaranteedYears:0, guaranteedAAV:minAav, incentives:[], signedAav:minAav };
            totalHit -= (oldHit - minAav);
          }
        }
        // Second pass: proportional scale-down of everyone if still over
        totalHit = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
        if (totalHit > capTarget) {
          const scale = capTarget / totalHit;
          for (const p of roster) {
            if (!p.contract) continue;
            p.contract.aav = Math.max(0.5, Math.round(p.contract.aav * scale * 10) / 10);
            const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
            p.contract.signingBonus   = signingBonus;
            p.contract.bonusProration = bonusProration;
            p.contract.baseSalaries   = _baseSalarySchedule(p.contract.aav, p.contract.years || 1, p.contract.structure || "BALANCED", bonusProration);
          }
        }
      }
      // Mark all as having been through the new system
      for (const p of roster) if (p.contract) p.contract.signedAav = p.contract.aav;
      continue;
    }

    // Retrofit older saves: apply negotiation variance, normalise so AAV total is preserved.
    // Only treat as a true legacy save when the bulk of the roster lacks signedAav —
    // otherwise a single fresh signing without the field would clobber every
    // contract on the roster (e.g. a mid-season FA bid going from $27.9M → market $13M).
    const missingCount = roster.filter(p => p.contract && p.contract.signedAav == null).length;
    const isLegacy     = roster.length > 0 && missingCount >= roster.length * 0.5;
    if (!isLegacy) {
      // Stamp signedAav on any individual stragglers so future loads don't trip.
      for (const p of roster) {
        if (p.contract && p.contract.signedAav == null) p.contract.signedAav = p.contract.aav;
      }
    }
    const needsRetrofit = isLegacy;
    if (!needsRetrofit) {
      // Backfill signing-bonus fields for saves that pre-date this feature.
      for (const p of roster) {
        if (!p.contract) continue;
        if (p.contract.bonusProration == null) {
          const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
          p.contract.signingBonus   = signingBonus;
          p.contract.bonusProration = bonusProration;
        }
        if (!p.contract.structure) {
          p.contract.structure = _defaultStructure(p.age || 27, p.overall || 70);
        }
        if (!p.contract.baseSalaries) {
          p.contract.baseSalaries = _baseSalarySchedule(
            p.contract.aav, p.contract.years || 1,
            p.contract.structure, p.contract.bonusProration
          );
        }
        if (!p.contract.incentives) p.contract.incentives = [];
      }
      continue;
    }
    let oldTotal = 0, newTotal = 0;
    for (const p of roster) {
      if (!p.contract) continue;
      p.contract.signedAav = p.contract.aav;
      oldTotal += p.contract.aav;
      const tentative = Math.max(0.5, Math.round(computeMarketValue(p, cap) * negotiationFactor(p) * 10) / 10);
      p.contract.aav = tentative;
      newTotal += tentative;
    }
    if (newTotal > 0 && oldTotal > 0 && Math.abs(newTotal - oldTotal) > 0.01) {
      const scale = oldTotal / newTotal;
      for (const p of roster) {
        if (!p.contract) continue;
        p.contract.aav = Math.max(0.5, Math.round(p.contract.aav * scale * 10) / 10);
      }
    }
    // Now backfill bonus/structure on the retrofitted contracts too.
    for (const p of roster) {
      if (!p.contract) continue;
      if (p.contract.bonusProration == null) {
        const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
        p.contract.signingBonus   = signingBonus;
        p.contract.bonusProration = bonusProration;
      }
      if (!p.contract.structure) p.contract.structure = _defaultStructure(p.age || 27, p.overall || 70);
      if (!p.contract.baseSalaries) {
        p.contract.baseSalaries = _baseSalarySchedule(
          p.contract.aav, p.contract.years || 1,
          p.contract.structure, p.contract.bonusProration
        );
      }
      if (!p.contract.incentives) p.contract.incentives = [];
    }
  }
}

// Cap hit for the current contract year = base salary for this year + bonus proration.
// Falls back to flat AAV for old saves that haven't been backfilled yet.
function currentYearCapHit(player) {
  const c = player.contract;
  if (!c) return 0;
  if (!c.baseSalaries || c.bonusProration == null) return (c.aav || 0) + _ltbeIncentivesTotal(player);
  const yearIndex = Math.max(0, (c.years || 1) - (c.remaining || 1));
  const base = c.baseSalaries[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  return Math.round((base + (c.bonusProration || 0) + _ltbeIncentivesTotal(player)) * 10) / 10;
}

// Dead cap owed if the player is released right now = prorated bonus remaining.
// For old saves without bonusProration, falls back to the old guaranteedYears model.
function deadCapOnRelease(player) {
  const c = player.contract;
  if (!c) return { perYear: 0, years: 0 };
  const remaining = c.remaining || 0;
  const voidYrs = c.voidYears || 0;
  if (c.bonusProration > 0) {
    // Void years accelerate with a release — total dead cap years = remaining + void.
    return { perYear: c.bonusProration, years: remaining + voidYrs };
  }
  // Legacy fallback
  const gYrs = Math.min(remaining, c.guaranteedYears || 0);
  return { perYear: c.guaranteedAAV ?? c.aav ?? 0, years: gYrs };
}

function capUsedByTeam(teamId) {
  const roster = (franchise?.rosters || {})[teamId] || [];
  let used = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
  // Injured Reserve: IR'd players are off the active roster but STILL PAID, so
  // their cap hit counts in full (exactly like the real NFL — IR is roster-spot
  // relief, never cap relief). This is what makes IR a real decision and keeps
  // in-season cap honest.
  used += ((franchise?.ir || {})[teamId] || []).reduce((s, p) => s + currentYearCapHit(p), 0);
  // Practice squad: each PS spot costs PS_COST_PER_SLOT, charged to cap.
  used += psCostForTeam(teamId);
  // Salary refunds: outgoing refunds count against the sender's cap
  // (dead money for the years left on the original deal); incoming
  // refunds offset the receiver's cap.
  for (const r of (franchise?.refunds || [])) {
    if (!r.yearsRemaining || r.yearsRemaining <= 0) continue;
    // Deferred refund (post-June 1 lump): doesn't count until startSeason hits.
    if (r.startSeason && (franchise.season || 1) < r.startSeason) continue;
    if (r.fromTeamId === teamId) used += r.amount;
    else if (r.toTeamId === teamId) used -= r.amount;
  }
  return Math.round(used * 10) / 10;
}

// Summary of a team's outgoing/incoming refunds for display.
function refundsForTeam(teamId) {
  const out = (franchise?.refunds || []).filter(r => r.yearsRemaining > 0 && r.fromTeamId === teamId);
  const inc = (franchise?.refunds || []).filter(r => r.yearsRemaining > 0 && r.toTeamId === teamId);
  return {
    outgoing: out, outgoingTotal: out.reduce((s,r) => s + r.amount, 0),
    incoming: inc, incomingTotal: inc.reduce((s,r) => s + r.amount, 0),
  };
}

function currentCap() {
  return franchise?.salaryCap || SALARY_CAP_BASE;
}

// ── Injured Reserve (IR) system ──────────────────────────────────────────────
// Real-NFL roster mechanic. The active roster is hard-capped at 53; an injured
// player occupies a spot he can't play in. IR moves him OFF the active 53 (so a
// healthy replacement can be signed) while his cap hit stays (see capUsedByTeam).
//   · "return"  — designated to return: out a MINIMUM of IR_RETURN_MIN_WEEKS even
//                 if he heals sooner, and each team has only IR_RETURN_SLOTS_PER_SEASON
//                 of these per year. A real commitment, not a free stash.
//   · "season"  — out for the year; returns (healed) next season.
const ACTIVE_ROSTER_LIMIT       = 53;
const IR_RETURN_MIN_WEEKS       = 4;   // designated-to-return players miss >= this many weeks
const IR_RETURN_SLOTS_PER_SEASON = 8;  // designated-to-return activations allowed per team / season
// Long-injury threshold: only injuries projected this many weeks or longer are
// worth an IR slot (shorter dings just ride next-man-up for a week or two).
const IR_WORTHY_WEEKS           = 4;

function irListForTeam(teamId) {
  if (!franchise) return [];
  if (!franchise.ir) franchise.ir = {};
  if (!franchise.ir[teamId]) franchise.ir[teamId] = [];
  return franchise.ir[teamId];
}
function activeRosterCount(teamId) {
  return ((franchise?.rosters || {})[teamId] || []).length;
}
function rosterSpotsOpen(teamId) {
  return Math.max(0, ACTIVE_ROSTER_LIMIT - activeRosterCount(teamId));
}
function _irReturnsUsed(teamId) {
  return ((franchise && franchise._irReturnsUsed) || {})[teamId] || 0;
}
function irReturnSlotsLeft(teamId) {
  return Math.max(0, IR_RETURN_SLOTS_PER_SEASON - _irReturnsUsed(teamId));
}
// Can this player be placed on IR right now, and with which designation?
// Returns { ok, designation, reason }.
function irEligibility(teamId, player) {
  const inj = player && player.injury;
  if (!inj || !(inj.weeksRemaining > 0)) return { ok: false, reason: "not injured" };
  // Career-ending injuries stay on the active roster so the existing end-of-season
  // retirement pass handles them normally (keeps that pipeline untouched).
  if (inj._careerEnding) return { ok: false, reason: "career-ending — retires off roster" };
  // Out the rest of the year (but recoverable) → season IR (no return slot needed).
  if (inj.weeksRemaining >= FRANCHISE_WEEKS) {
    return { ok: true, designation: "season" };
  }
  // Multi-week but returnable → designated to return (consumes a return slot).
  if (inj.weeksRemaining >= IR_WORTHY_WEEKS) {
    if (irReturnSlotsLeft(teamId) <= 0) return { ok: false, reason: "no return slots left" };
    return { ok: true, designation: "return" };
  }
  return { ok: false, reason: "injury too short for IR" };
}
// Move a player from the active roster to IR. Returns true on success.
function placeOnIr(teamId, player, designation) {
  const roster = (franchise?.rosters || {})[teamId];
  if (!roster) return false;
  const idx = roster.indexOf(player);
  if (idx === -1) return false;
  roster.splice(idx, 1);
  irListForTeam(teamId).push(player);
  player._ir = {
    designation: designation || "season",
    placedSeason: franchise.season,
    placedWeek: franchise.week,
    minReturnWeek: (franchise.week || 1) + IR_RETURN_MIN_WEEKS,
  };
  if (designation === "return") {
    if (!franchise._irReturnsUsed) franchise._irReturnsUsed = {};
    franchise._irReturnsUsed[teamId] = (franchise._irReturnsUsed[teamId] || 0) + 1;
  }
  return true;
}
// Is an IR'd player eligible to be activated THIS season?
function irActivationEligible(player) {
  const m = player && player._ir;
  if (!m || m.designation !== "return") return false;          // season-IR returns next year only
  const healed = !player.injury || !(player.injury.weeksRemaining > 0);
  return healed && (franchise.week || 1) >= m.minReturnWeek;
}
// Move an IR'd player back to the active roster (caller ensures a spot is open).
function activateFromIr(teamId, player) {
  const list = irListForTeam(teamId);
  const idx = list.indexOf(player);
  if (idx === -1) return false;
  if (rosterSpotsOpen(teamId) <= 0) return false;
  list.splice(idx, 1);
  delete player._ir;
  ((franchise.rosters || {})[teamId] || []).push(player);
  return true;
}
// Season rollover: at the new league year, IR players heal and rejoin the active
// roster (the offseason re-sign/trim flow then sorts out the 53). Career-ending
// guys keep their flag so the existing retirement pass still retires them.
function _rolloverIrForNewSeason() {
  if (!franchise || !franchise.ir) return;
  for (const teamId of Object.keys(franchise.ir)) {
    const list = franchise.ir[teamId] || [];
    const roster = (franchise.rosters || {})[teamId];
    if (!roster) { franchise.ir[teamId] = []; continue; }
    for (const p of list) {
      const careerEnding = p.injury && p.injury._careerEnding;
      if (!careerEnding) p.injury = null;   // healed over the offseason
      delete p._ir;
      roster.push(p);
    }
    franchise.ir[teamId] = [];
  }
  franchise._irReturnsUsed = {};
}

// ── Incentive clause system ─────────────────────────────────────────────────
// Contracts carry 0-3 performance bonuses. LTBE (Likely To Be Earned) bonuses
// count against the cap now because the player hit the threshold last season.
// NLTBE bonuses don't count until earned; if earned they hit next year's cap.
const INCENTIVE_TEMPLATES = {
  QB:  [
    { label:"4500+ Pass Yds", stat:"pass_yds", threshold:4500, bonus:1.0 },
    { label:"4000+ Pass Yds", stat:"pass_yds", threshold:4000, bonus:0.75 },
    { label:"35+ Pass TDs",   stat:"pass_td",  threshold:35,   bonus:1.0 },
    { label:"30+ Pass TDs",   stat:"pass_td",  threshold:30,   bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.5 },
  ],
  RB:  [
    { label:"1400+ Rush Yds", stat:"rush_yds", threshold:1400, bonus:1.0 },
    { label:"1200+ Rush Yds", stat:"rush_yds", threshold:1200, bonus:0.75 },
    { label:"1000+ Rush Yds", stat:"rush_yds", threshold:1000, bonus:0.5 },
    { label:"12+ Rush TDs",   stat:"rush_td",  threshold:12,   bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.0 },
  ],
  WR:  [
    { label:"1400+ Rec Yds",  stat:"rec_yds", threshold:1400, bonus:1.0 },
    { label:"1200+ Rec Yds",  stat:"rec_yds", threshold:1200, bonus:0.75 },
    { label:"1000+ Rec Yds",  stat:"rec_yds", threshold:1000, bonus:0.5 },
    { label:"100+ Receptions",stat:"rec",     threshold:100,  bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.0 },
  ],
  TE:  [
    { label:"900+ Rec Yds",  stat:"rec_yds", threshold:900, bonus:0.75 },
    { label:"700+ Rec Yds",  stat:"rec_yds", threshold:700, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,   bonus:1.0 },
  ],
  DL:  [
    { label:"12+ Sacks",     stat:"sk",      threshold:12, bonus:1.0 },
    { label:"10+ Sacks",     stat:"sk",      threshold:10, bonus:0.75 },
    { label:"8+ Sacks",      stat:"sk",      threshold:8,  bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,  bonus:1.0 },
  ],
  LB:  [
    { label:"100+ Tackles",  stat:"tkl",     threshold:100, bonus:0.75 },
    { label:"8+ Sacks",      stat:"sk",      threshold:8,   bonus:0.75 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,   bonus:1.0 },
  ],
  CB:  [
    { label:"6+ INTs",       stat:"int_made",threshold:6, bonus:1.0 },
    { label:"4+ INTs",       stat:"int_made",threshold:4, bonus:0.75 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1, bonus:1.0 },
  ],
  S:   [
    { label:"4+ INTs",       stat:"int_made",threshold:4, bonus:0.75 },
    { label:"80+ Tackles",   stat:"tkl",     threshold:80, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1, bonus:1.0 },
  ],
  OL:  [{ label:"Pro Bowl",  stat:"pro_bowl",threshold:1, bonus:1.0 }],
  K:   [
    { label:"30+ FG Made",   stat:"fg_made", threshold:30, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,  bonus:0.75 },
  ],
};

function _getLastSeasonStat(player, stat) {
  if (stat === "pro_bowl") return 0; // Pro Bowl determined separately
  for (const teamStats of Object.values(franchise?.seasonStats || {})) {
    const row = teamStats[player.name];
    if (row) return row[stat] || 0;
  }
  return 0;
}

function _playerIncentiveWillingness(player) {
  const ovr = player.overall || 70;
  const age = player.age || 27;
  if (ovr >= 88) return 0.04;
  if (ovr >= 82) return 0.10;
  if (age >= 32) return 0.25;
  if (ovr >= 76) return 0.18;
  return 0.22;
}

function _generateIncentives(player, aav) {
  const templates = INCENTIVE_TEMPLATES[player.position] || [];
  if (!templates.length) return [];
  const willingness = _playerIncentiveWillingness(player);
  if (willingness < 0.05) return [];
  const maxVal = aav * willingness;
  const incentives = [];
  let total = 0;
  for (const tmpl of templates) {
    if (total + tmpl.bonus > maxVal + 0.1) continue;
    const lastStat = _getLastSeasonStat(player, tmpl.stat);
    const type = lastStat >= tmpl.threshold ? "LTBE" : "NLTBE";
    incentives.push({ label: tmpl.label, stat: tmpl.stat, threshold: tmpl.threshold, bonus: tmpl.bonus, type });
    total += tmpl.bonus;
    if (incentives.length >= 3) break;
  }
  return incentives;
}

function _ltbeIncentivesTotal(player) {
  return (player.contract?.incentives || [])
    .filter(inc => inc.type === "LTBE")
    .reduce((s, inc) => s + (inc.bonus || 0), 0);
}

// ── Cap projections ─────────────────────────────────────────────────────────
function projectPlayerCapHit(player, yearsAhead) {
  const c = player.contract;
  if (!c) return 0;
  const futureRemaining = (c.remaining || 0) - yearsAhead;
  if (futureRemaining <= 0) return 0;
  const yearIndex = Math.max(0, (c.years || 1) - futureRemaining);
  if (!c.baseSalaries || yearIndex >= c.baseSalaries.length) return c.aav || 0;
  const base = c.baseSalaries[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  return Math.round((base + (c.bonusProration || 0)) * 10) / 10;
}

function projectTeamCap(teamId, yearsAhead) {
  const roster = (franchise?.rosters || {})[teamId] || [];
  return Math.round(roster.reduce((s, p) => s + projectPlayerCapHit(p, yearsAhead), 0) * 10) / 10;
}

// ── Trade value classification ───────────────────────────────────────────────
function _tradeValueTag(player, cap) {
  if (!player.contract) return null;
  const hit = currentYearCapHit(player);
  const market = computeMarketValue(player, cap);
  const remaining = player.contract.remaining || 0;
  if (remaining < 2) return null;
  if (hit < market - 2.5) return "asset";
  if (hit > market + 3.5 && remaining >= 3) return "blocker";
  return null;
}

// ── Contract advisor ─────────────────────────────────────────────────────────
// Returns 2-3 structured contract suggestions for a given player + goal.
function _contractAdvisor(player, goal, cap) {
  const market = computeMarketValue(player, cap || SALARY_CAP_BASE);
  const age = player.age || 27;
  const suggestions = [];
  const struct = _defaultStructure(age, player.overall || 70);

  if (goal === "flex") {
    suggestions.push({
      label:"2yr Flexible", years:2, aav: Math.round(market*1.05*10)/10, structure:"BALANCED",
      note:`Low dead cap — hit FA again in 2 years while still productive`,
    });
    suggestions.push({
      label:"3yr + Voidable", years:3, aav: Math.round(market*0.97*10)/10, structure:"BALANCED",
      teamOption:{ year:3 },
      note:`Slightly below market — you control whether year 3 happens`,
    });
  } else if (goal === "capnow") {
    suggestions.push({
      label:"4yr Backloaded", years:4, aav: Math.round(market*0.95*10)/10, structure:"BACKLOADED",
      note:`Cheap cap hits years 1-2, escalates later — good if you expect future space`,
    });
    suggestions.push({
      label:"3yr Backloaded", years:3, aav: Math.round(market*0.93*10)/10, structure:"BACKLOADED",
      note:`Below market to offset back-heavy structure — shortest backload option`,
    });
  } else if (goal === "lockup") {
    suggestions.push({
      label:"5yr Max", years:5, aav: Math.round(market*1.10*10)/10, structure:"FRONTLOADED",
      note:`Premium to lock him in — high dead cap risk if he declines`,
    });
    suggestions.push({
      label:"4yr Bridge+", years:4, aav: Math.round(market*1.03*10)/10, structure:"FRONTLOADED",
      note:`Player gets paid up front — can extend again when you see how he develops`,
    });
  } else { // lowrisk
    suggestions.push({
      label:"2yr Prove-It", years:2, aav: Math.round(market*0.90*10)/10, structure:"BALANCED",
      note:`Below market, minimal signing bonus — nearly zero dead cap if you cut`,
    });
    suggestions.push({
      label:"1yr Show Deal", years:1, aav: Math.round(market*1.02*10)/10, structure:"BALANCED",
      note:`Zero dead cap commitment — he earns a real deal next offseason`,
    });
  }
  return suggestions;
}

// ── Contract options processing ──────────────────────────────────────────────
// Called at offseason start. Handles expiring team/player options.
// Player options: auto-resolved by market vs option value.
// Team options on user's roster: flagged as _teamOptionPending for UI decision.
function _processContractOptions() {
  if (!franchise) return [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const alerts = [];
  for (const [tidStr, roster] of Object.entries(franchise.rosters || {})) {
    const teamId = Number(tidStr);
    for (const p of roster) {
      const c = p.contract;
      if (!c) continue;
      if (c.playerOption && c.remaining === c.playerOption.year) {
        const market = computeMarketValue(p, cap);
        if (market > c.playerOption.value * 1.08) {
          c.remaining = 0; // Will be caught as expiring
          alerts.push({ type:"playerOpt", teamId, name:p.name, pos:p.position,
            label:`${p.name} opted out — market ($${market.toFixed(1)}M) beat option ($${c.playerOption.value.toFixed(1)}M)` });
        } else {
          alerts.push({ type:"playerOptStay", teamId, name:p.name,
            label:`${p.name} accepted player option ($${c.playerOption.value.toFixed(1)}M)` });
        }
      }
      if (c.teamOption && c.remaining === c.teamOption.year) {
        if (teamId === franchise.chosenTeamId) {
          c._teamOptionPending = true;
        } else {
          const market = computeMarketValue(p, cap);
          if (market < c.teamOption.value * 0.80) c.remaining = 0; // AI declines if player is overpaid
        }
      }
    }
  }
  return alerts;
}


// Converts the current year's base salary into a new signing bonus, prorated
// over remaining years. Frees cap space now; increases dead cap if cut later.
// Limited to once per player per offseason (restructuredSeason guard).
// Uses inline confirmation instead of browser confirm() dialog.
function frnRestructure(teamId, name, pos, voidYearsAdd = 0) {
  // Toggle off if clicking the same player again (only if no void-year change).
  if (_restructurePending?.name === name && _restructurePending?.pos === pos
      && (_restructurePending?.voidYearsAdd || 0) === voidYearsAdd) {
    _restructurePending = null;
    renderFrnAnalytics("mysheet");
    return;
  }
  const roster = franchise?.rosters?.[teamId];
  if (!roster) return;
  const p = roster.find(q => q.name === name && q.position === pos);
  if (!p?.contract) return;
  const c = p.contract;
  const remaining = c.remaining || 0;
  if (remaining < 2) return;
  if (c.restructuredSeason === franchise.season) return;
  const yearIndex = Math.max(0, (c.years || 1) - remaining);
  const currentBase = c.baseSalaries?.[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  if (currentBase < 2.0) return;
  // NFL caps proration at 5 years total; void years extend the denominator
  // but the combined (remaining + existing void + new void) can't exceed 5.
  const existingVoid = c.voidYears || 0;
  const maxNewVoid = Math.max(0, 5 - remaining - existingVoid);
  const vAdd = Math.min(Math.max(0, voidYearsAdd | 0), maxNewVoid);
  const prorationDenom = remaining + vAdd;
  const newProration = Math.round(currentBase / prorationDenom * 10) / 10;
  const freed = Math.round((currentBase - newProration) * 10) / 10;
  const voidDead = Math.round(newProration * (existingVoid + vAdd) * 10) / 10;
  _restructurePending = {
    teamId, name, pos, currentBase, newProration, freed, remaining,
    voidYearsAdd: vAdd, maxNewVoid, existingVoid, voidDead,
  };
  renderFrnAnalytics("mysheet");
}

function frnRestructureConfirm() {
  if (!_restructurePending) return;
  const { teamId, name, pos, currentBase, newProration, freed, voidYearsAdd = 0 } = _restructurePending;
  const roster = franchise?.rosters?.[teamId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p?.contract) { _restructurePending = null; return; }
  const c = p.contract;
  const remaining = c.remaining || 0;
  const yearIndex = Math.max(0, (c.years || 1) - remaining);
  if (c.baseSalaries) c.baseSalaries[yearIndex] = 0;
  c.bonusProration     = Math.round(((c.bonusProration || 0) + newProration) * 10) / 10;
  c.signingBonus       = Math.round(((c.signingBonus   || 0) + currentBase) * 10) / 10;
  if (voidYearsAdd > 0) c.voidYears = (c.voidYears || 0) + voidYearsAdd;
  c.restructuredSeason = franchise.season;
  _restructurePending  = null;
  saveFranchise();
  const voidTag = voidYearsAdd > 0 ? ` (+${voidYearsAdd} void yr${voidYearsAdd > 1 ? "s" : ""})` : "";
  _pushNews({ type: "restructure",
    label: `🔀 Restructured ${p.position} ${name}${voidTag} — freed $${freed.toFixed(1)}M, added $${newProration.toFixed(1)}M/yr dead` });
  renderFrnAnalytics("mysheet");
}

function frnRestructureCancel() {
  _restructurePending = null;
  renderFrnAnalytics("mysheet");
}

// ── Release player (two-step: prompt then confirm) ──────────────────────────
// Toggling the same name closes the pending row. Toggling the June-1 flag
// re-opens the pending row with the alternate dead-cap structure.
function frnReleasePlayer(name, pos, june1 = null) {
  // If already pending this same player with same june1 state, cancel.
  if (_releasePending && _releasePending.name === name && _releasePending.pos === pos
      && (june1 === null || !!_releasePending.june1 === !!june1)) {
    _releasePending = null;
    renderFrnPreseason("roster");
    return;
  }
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p) return;
  const { perYear: deadPerYr, years: deadYrs } = deadCapOnRelease(p);
  const deadTotal = deadPerYr * deadYrs;
  const j1Allowed = _june1Remaining(teamId);
  // Resolve effective june1 state — keep existing if just opening, else use param.
  const wantJune1 = june1 === null ? !!_releasePending?.june1 : !!june1;
  // Can only designate june1 if eligible AND there are 2+ dead years to split.
  const j1Eligible = wantJune1 && j1Allowed > 0 && deadYrs >= 2;
  // June-1 split: current year takes just 1 year of proration; next year takes
  // the remaining (deadYrs - 1) lumped as a single-season hit.
  const j1Year1 = j1Eligible ? Math.round(deadPerYr * 10) / 10 : 0;
  const j1Year2 = j1Eligible ? Math.round(deadPerYr * (deadYrs - 1) * 10) / 10 : 0;
  _releasePending = {
    name, pos, deadPerYr, deadYrs, deadTotal,
    june1: j1Eligible,
    j1Year1, j1Year2,
    j1Allowed, j1Used: _june1Used(teamId),
  };
  renderFrnPreseason("roster");
}

function frnReleasePlayerConfirm() {
  if (!_releasePending) return;
  const { name, pos, deadPerYr, deadYrs, deadTotal, june1, j1Year1, j1Year2 } = _releasePending;
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const idx = roster.findIndex(p => p.name === name && p.position === pos);
  if (idx === -1) { _releasePending = null; renderFrnPreseason("roster"); return; }
  roster.splice(idx, 1);
  if (deadTotal > 0) {
    franchise.refunds = franchise.refunds || [];
    if (june1) {
      // Current year: one year of proration only.
      franchise.refunds.push({
        kind: "dead_cap", fromTeamId: teamId, toTeamId: null,
        amount: j1Year1, yearsRemaining: 1, label: `Dead cap (Jun 1): ${name}`,
      });
      // Next year: lump of remaining years as a single-season hit.
      // startSeason gates it: doesn't count toward cap until that season,
      // and the offseason rollover skips ticking it down until then.
      if (j1Year2 > 0) {
        franchise.refunds.push({
          kind: "dead_cap", fromTeamId: teamId, toTeamId: null,
          amount: j1Year2, yearsRemaining: 1,
          startSeason: (franchise.season || 1) + 1,
          label: `Dead cap (Jun 1 deferred): ${name}`,
        });
      }
      // Consume a designation
      franchise._june1Used = franchise._june1Used || {};
      franchise._june1Used[teamId] = (franchise._june1Used[teamId] || 0) + 1;
    } else {
      franchise.refunds.push({
        kind: "dead_cap", fromTeamId: teamId, toTeamId: null,
        amount: deadPerYr, yearsRemaining: deadYrs, label: `Dead cap: ${name}`,
      });
    }
  }
  _releasePending = null;
  saveFranchise();
  renderFrnPreseason("roster");
}

function frnReleasePlayerCancel() {
  _releasePending = null;
  renderFrnPreseason("roster");
}

// ── Pay-cut negotiation ─────────────────────────────────────────────────────
// Vet on a bloated deal: ask him to take a cut or risk release.
// Accept chance is driven by how overpaid he is, age (older vets have
// fewer alternatives), depth of the requested cut, and OVR leverage
// (stars decline harder). Once accepted, the contract recomputes at
// the new AAV with fresh bonus proration + base schedule.
function _payCutAcceptChance(player, cutPct, market) {
  const aav = player.contract?.aav || 0;
  if (!aav) return 0;
  const newAav = aav * (1 - cutPct);
  // Overpay factor — how much above market the current deal is
  const overpay = market > 0 ? (aav / market) - 1 : 0;   // 0 = fair, +0.5 = 50% over
  // Underpay leverage — if you're cutting an already-fair deal, hard no
  const newVsMarket = market > 0 ? newAav / market : 1;
  // Base chance grows with overpay; collapses if the new offer is below market
  let chance = 0.10;
  chance += Math.max(0, overpay) * 0.80;          // big overpay → big willingness
  chance -= Math.max(0, 1.0 - newVsMarket) * 1.20; // new < market = walk-away
  // Age: older = fewer outside options
  const age = player.age || 26;
  if (age >= 33)      chance += 0.25;
  else if (age >= 30) chance += 0.12;
  else if (age <= 26) chance -= 0.10;
  // Cut depth: steeper asks are insulting
  chance -= Math.max(0, cutPct - 0.10) * 1.4;
  // Stars decline harder (OVR leverage)
  const ovr = player.overall || 70;
  if (ovr >= 90)      chance -= 0.15;
  else if (ovr >= 85) chance -= 0.08;
  // Already-cut-this-season penalty (don't keep asking)
  if (player.contract?.payCutRequestedSeason === franchise?.season) chance -= 0.35;
  return Math.max(0.03, Math.min(0.92, chance));
}

function frnRequestPayCut(name, pos) {
  // Toggle off
  if (_payCutPending?.name === name && _payCutPending?.pos === pos) {
    _payCutPending = null;
    renderFrnAnalytics("mysheet");
    return;
  }
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p?.contract || (p.contract.remaining || 0) < 2) return;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const market = computeMarketValue(p, cap);
  const currentAav = p.contract.aav;
  _payCutPending = {
    name, pos,
    currentAav,
    market,
    overpayPct: market > 0 ? (currentAav / market - 1) : 0,
    result: null,
    newAav: null,
    cutPct: null,
  };
  renderFrnAnalytics("mysheet");
}

function frnPayCutSubmit(cutPct) {
  if (!_payCutPending) return;
  const teamId = franchise.chosenTeamId;
  const p = (franchise.rosters[teamId] || []).find(
    q => q.name === _payCutPending.name && q.position === _payCutPending.pos
  );
  if (!p?.contract) { _payCutPending = null; return; }
  const chance = _payCutAcceptChance(p, cutPct, _payCutPending.market);
  const accepted = Math.random() < chance;
  const newAav = Math.max(0.5, Math.round(p.contract.aav * (1 - cutPct) * 10) / 10);
  _payCutPending.cutPct = cutPct;
  _payCutPending.newAav = newAav;
  _payCutPending.result = accepted ? "accept" : "decline";
  _payCutPending.acceptChance = chance;
  // Stamp the attempt so the same player can't be repeatedly asked
  p.contract.payCutRequestedSeason = franchise.season;
  if (accepted) {
    // Recompute contract at the new AAV — keep years/structure, regenerate
    // bonus proration + base schedule so cap math stays clean.
    const years = p.contract.years || 1;
    const struct = p.contract.structure || "BALANCED";
    const { signingBonus, bonusProration } = _signingBonusCalc(newAav, years, p.overall || 70);
    p.contract.aav = newAav;
    p.contract.signedAav = newAav;
    p.contract.signingBonus = signingBonus;
    p.contract.bonusProration = bonusProration;
    p.contract.baseSalaries = _baseSalarySchedule(newAav, years, struct, bonusProration);
    p.contract.guaranteedAAV = Math.min(p.contract.guaranteedAAV ?? newAav, newAav);
    _pushNews({ type: "extension",
      label: `✓ ${p.position} ${p.name} took a ${Math.round(cutPct*100)}% pay cut — new AAV $${newAav.toFixed(1)}M` });
  } else {
    _pushNews({ type: "extension",
      label: `✗ ${p.position} ${p.name} refused a ${Math.round(cutPct*100)}% pay cut` });
  }
  saveFranchise();
  renderFrnAnalytics("mysheet");
}

function frnPayCutClose() {
  _payCutPending = null;
  renderFrnAnalytics("mysheet");
}

// ── Scouting representation: never expose raw OVR. Players are shown to the
// user via a letter "scout grade" (A+ … F) that approximates perceived
// talent. The grade is deliberately fuzzed against the underlying overall
// so the user can't reverse-engineer the simulator's numbers — it's an
// observer's estimate, not the truth.
// Earned "perception boost" from career accolades. Counters the
// pedigree tilt for late-round breakouts (Brady-style: R6 → -2) and
// the age cliff (-3/-6 for 32+/34+) so a decorated elderly vet still
// grades elite. Capped at +8 so it can fully offset worst-case
// pedigree+age stack (R6 at age 34+ = -8). Without this, an R6
// age-38 99-OVR star caps at grade A (91) and could never reach A+.
function _accoladeGradeOffset(p) {
  if (!p) return 0;
  const pb   = p.proBowls || 0;
  const ap   = p.allPros  || 0;
  const sb   = p.sbRings  || 0;
  const mvp  = p.mvps     || 0;
  const opoy = p.opoys    || 0;
  const dpoy = p.dpoys    || 0;
  const offset = pb * 0.5 + ap * 1.0 + sb * 1.0 + mvp * 3.0 + (opoy + dpoy) * 1.5;
  return Math.min(8, offset);
}

function scoutGrade(p) {
  const band = _playerNoiseBand(p);
  // BAND 0 — owned by user. You watch this player every day, you don't
  // get fooled by their draft pedigree or their age. Show the exact OVR.
  // (Previously the pedigree + age tilts applied here too, which capped
  // a Brady-style R6 age-38 99-OVR own-roster player at grade A. Now
  // they get the A+ they earned.)
  if (band === 0) return Math.max(20, Math.min(99, Math.round(p.overall || 60)));
  // Stable per-player noise from hash of the name. Scaled to ±band,
  // sourced via `(hash mod (2N+1)) - N`.
  let score = p.overall || 60;
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const noise = (Math.abs(h) % (band * 2 + 1)) - band;
  score += noise;
  // Draft pedigree tilt — recency bias in real scouting.
  // Path A: pre-draft prospects have draftRound=null; fall back to
  // _generatedRound (their consensus grade) so scout grade tilt still
  // reflects the projected tier.
  const r = p.draftRound ?? p._generatedRound;
  if (r === 1)      score += 3;
  else if (r === 2) score += 1;
  else if (r >= 5)  score -= 2;
  else if (r === 0) score -= 4;
  // Age cliff penalty in perceived grade.
  const age = p.age || 25;
  if (age >= 34)      score -= 6;
  else if (age >= 32) score -= 3;
  // Accolade offset — earned reputation overrides pedigree/age bias.
  // Brady-style: 5 SBs (5) + 15 Pro Bowls (7.5) + 3 MVPs (9) = 21.5
  // capped at 8 → fully offsets R6+age34 = -8 → grade reflects true OVR.
  score += _accoladeGradeOffset(p);
  return Math.max(20, Math.min(99, Math.round(score)));
}

// Human-readable scouting source — used in tooltips so the user can
// understand why some grades are sharper than others.
function _scoutSourceLabel(p) {
  const band = _playerNoiseBand(p);
  if (band === 0) return "owned";
  // Build a multi-source description so stacking is visible.
  const fr = franchise;
  const season = fr?.season;
  const myId   = fr?.chosenTeamId;
  const parts = [];
  if (p?._facedInPlayoffsSeason != null && season != null && (season - p._facedInPlayoffsSeason) <= 1) parts.push("faced in playoffs");
  if (p?.isProspect && (fr?.draftScouts || []).includes(p.name)) parts.push("draft scout");
  if (p?._apbScoutedSeason != null && season != null && (season - p._apbScoutedSeason) <= 1) parts.push("APB");
  if (p?._postseasonDepthSeason != null && season != null && (season - p._postseasonDepthSeason) <= 1) {
    const d = p._postseasonDepth ?? 0;
    parts.push(d >= 2 ? "reached championship" : d === 1 ? "reached divisional" : "played wild card");
  }
  if (p?._regSeasonFacedSeason != null && season != null && (season - p._regSeasonFacedSeason) <= 1) parts.push("reg-season opp");
  // Practice (skip own team)
  if (myId != null) {
    for (const [tid, roster] of Object.entries(fr.rosters || {})) {
      if (!roster.includes(p)) continue;
      if (Number(tid) === myId) break;
      const intel = fr.scoutingIntel?.[tid];
      if (intel && intel.season === season) {
        parts.push(intel.intensity === "live" ? "live-pads JP" : "joint practice");
      }
      break;
    }
  }
  if (!parts.length && p?.isProspect) parts.push("combine grade");
  if (!parts.length) return `no scouting · ±${band}`;
  const stacked = parts.length > 1 ? " · stacked" : "";
  return `${parts.join(" + ")}${stacked} · ±${band}`;
}

// Has the user scouted this player's team this season (via scrimmage)?
// Returns the noise band for this player's scout grade. Lower = sharper.
//   0 = exact OVR (owned)
//   1 = faced in playoffs as major role
//   2 = APB / reached SB (major) / draft scout / faced in playoffs (minor)
//   3 = reached Divisional (major) / reached SB (minor)
//   4 = Wild Card (major) / reached Divisional (minor)
//   5 = reg-season opponent (major) / Wild Card (minor) / unscouted prospect
//   6 = Live Pads JP / reg-season opponent (minor)
//   7 = Standard JP
//   8 = walk-through (no grade reveal) / unscouted
//
// Two principles in play:
//
// (a) Practice-vs-game: a real regular-season game ALWAYS beats any
//     practice — controlled environment, players self-protect, scripted
//     scenarios. Even Live Pads (±6) lands below reg-season opp (±5).
//
// (b) Coverage asymmetry — practice scouts evenly across the team but
//     games only scout the players who got reps. Standard JP scouts
//     only the depth-chart starters; Live Pads scouts the whole
//     53-man (full-contact bench reps too). Walk-through stamps no-
//     one (revealsGrades:false by design).
//
// (c) Snap-weighting — when a player only appeared in a game as a
//     minor role (low snaps / low touches / minimal stat line), they
//     get bumped one band worse than a major-role flag at the same
//     tier. "Major" is defined per-position in _wasMajorRole.
//
// Stacking: practice + game-tape stacks (different evidence categories),
// -2 for Live Pads + game, -1 for Standard JP + game. Floored at 1.
// Dynamic base noise band for a college prospect based on class year +
// (for seniors) how far into the season we are. Earlier classes are
// fuzzier — you have less film, no combine, body/role unfinished.
// Seniors sharpen as the season progresses toward the draft.
//   FR  ±20 — barely anyone outside your scouts knows them
//   SO  ±16 — a year of film, role/body not set
//   JR  ±12 (undeclared) / ±9 (declared, on every scout's board)
//   SR  ±15 week 1 → ±8 by the final week (combine + senior film)
// "Match real-life: the FA baseline is ±8" — an unscouted senior at
// the draft converges to the same fog as an unknown free agent.
// FRANCHISE_WEEKS is 17 in this game (NFL 17-game season, compressed —
// no in-season bye), so the SR ramp from ±15 → ±8 happens over the
// in-season weeks.
function _collegeProspectBaseBand(p) {
  if (!p?.collegeYear) return 5;  // legacy prospect without class year
  const week = (typeof franchise !== "undefined" && franchise?.week) ? franchise.week : 1;
  const totalWeeks = (typeof FRANCHISE_WEEKS === "number") ? FRANCHISE_WEEKS : 14;
  const srProgress = Math.max(0, Math.min(1, (week - 1) / Math.max(1, totalWeeks - 1)));
  switch (p.collegeYear) {
    case "SR": return Math.round(15 - srProgress * 7);  // 15 → 8
    case "JR": return p.declaredEarly ? 9 : 12;
    case "SO": return 16;
    case "FR": return 20;
    default:   return 8;
  }
}

// Per-category sharpening for college prospect scouting. Upperclassmen
// (JR/SR) gain MORE intel per category — combine measurables, senior
// film, and pro-day workouts cut deeper than what film can tell you
// about a freshman with one year of college tape.
function _collegeProspectSharpening(p, catCount) {
  const isUpper = p?.collegeYear === "JR" || p?.collegeYear === "SR";
  return catCount * (isUpper ? 2 : 1);
}

function _playerNoiseBand(p) {
  if (!p) return 8;
  const fr = franchise;
  if (!fr) return 8;
  const myId  = fr.chosenTeamId;
  const season = fr.season;
  if (season == null) return 8;

  // 0: owned — your roster, you coach them, exact OVR
  if (myId != null) {
    const myRoster = fr.rosters?.[myId] || [];
    if (myRoster.includes(p) ||
        myRoster.some(rp => rp.name === p?.name && rp.position === p?.position)) {
      return 0;
    }
  }

  // Window helper — "set this season or last" (one-year carry).
  const within = (s) => s != null && (season - s) <= 1;

  // Collect every applicable evidence source.
  const bands = [];
  let hasGameTape = false;
  let practiceBand = null; // 6 for live, 7 for standard, null otherwise

  // Faced in playoffs (user game)
  if (within(p._facedInPlayoffsMajor)) {
    bands.push(1); hasGameTape = true;
  } else if (within(p._facedInPlayoffsSeason)) {
    bands.push(2); hasGameTape = true; // minor role — one band worse
  }

  // College prospect — band starts wide (FR especially) and tightens with
  // class year + (for seniors) season progress + scouting categories.
  // Replaces the old hardcoded "±5 unscouted baseline." See
  // _collegeProspectBaseBand for the curve.
  if (p.isProspect) {
    const cats = _draftScoutCategories(p.name);
    const baseBand = _collegeProspectBaseBand(p);
    const sharpening = _collegeProspectSharpening(p, cats.length);
    bands.push(Math.max(1, baseBand - sharpening));
  }
  // Owned-player carryover: a prospect you drafted after scouting them
  // keeps their sharpened read for their first season on your roster.
  if (p._scoutedAtDraftSeason != null && within(p._scoutedAtDraftSeason)) {
    bands.push(Math.max(1, 5 - (p._scoutedAtDraftCats || 1)));
  }

  // APB participation — curated rosters, treat as major
  if (within(p._apbScoutedSeason)) { bands.push(2); hasGameTape = true; }

  // Postseason depth — major role (reached round X as a major contributor)
  if (within(p._postseasonMajorRoundSeason)) {
    const d = p._postseasonMajorRound ?? -1;
    if (d >= 2) bands.push(2);
    else if (d === 1) bands.push(3);
    else if (d === 0) bands.push(4);
    if (d >= 0) hasGameTape = true;
  }
  // Postseason depth — any role (one band worse than major)
  if (within(p._postseasonDepthSeason)) {
    const d = p._postseasonDepth ?? -1;
    if (d >= 2) bands.push(3);
    else if (d === 1) bands.push(4);
    else if (d === 0) bands.push(5);
    if (d >= 0) hasGameTape = true;
  }

  // Regular-season opponent — major vs minor variant
  if (within(p._regSeasonFacedMajor)) {
    bands.push(5); hasGameTape = true;
  } else if (within(p._regSeasonFacedSeason)) {
    bands.push(6); hasGameTape = true; // minor role — one band worse
  }

  // Joint practice — per-player flag (set in _jpRunPractice). Standard
  // JP stamps only starters; Live Pads stamps full roster. Window: this
  // season only (one practice snapshot doesn't carry forward).
  if (p._jpScoutedSeason === season) {
    practiceBand = p._jpScoutedIntensity === "live" ? 6 : 7;
    bands.push(practiceBand);
  } else {
    // Legacy fallback — pre-stamping saves only have team-level
    // scoutingIntel. Apply uniformly (team-wide) so we don't stealth-
    // nerf those saves.
    for (const [tid, roster] of Object.entries(fr.rosters || {})) {
      if (!roster.includes(p)) continue;
      if (Number(tid) === myId) break;
      const intel = fr.scoutingIntel?.[tid];
      if (intel && intel.season === season) {
        practiceBand = intel.intensity === "live" ? 6 : 7;
        bands.push(practiceBand);
      }
      break;
    }
  }

  // (Removed the legacy "unscouted prospect baseline (combine grade only)
  // → bands.push(5)" — the isProspect block above now always pushes a
  // dynamic baseband via _collegeProspectBaseBand, so this fallback is
  // unreachable for prospects.)

  if (!bands.length) return 8;

  // Best individual band wins. Practice + game tape stacks: -2 for
  // Live Pads, -1 for Standard JP. Floored at 1.
  let best = Math.min(...bands);
  if (practiceBand != null && hasGameTape) {
    const stackBonus = practiceBand === 6 ? 2 : 1;
    best = Math.max(1, best - stackBonus);
  }
  return best;
}

function _isPlayerScouted(p) {
  // Backward-compat: returns true for any sharpened read (band ≤ 5).
  return _playerNoiseBand(p) <= 5;
}

// Returns the list of scouting categories assigned to a draft prospect.
// Handles both the new shape (categories array on draftScoutReveals[name])
// and legacy saves (just present in draftScouts[]) which are treated as a
// single generic "film" scout.
function _draftScoutCategories(name) {
  if (!franchise) return [];
  // Merge from BOTH stores — season scouting writes to seasonScoutReveals
  // during weeks 1-18; draft scouting writes to draftScoutReveals during
  // the draft event; frnGoToDraft copies season → draft so the draft
  // board sees both. During the regular season, the noise band system
  // needs to see season reveals too — without this merge, the user
  // could spend a season's worth of credits and the displayed grade
  // would never sharpen.
  const merged = new Set();
  const draftRev = franchise.draftScoutReveals?.[name];
  if (draftRev?.categories && Array.isArray(draftRev.categories)) {
    for (const c of draftRev.categories) merged.add(c);
  } else if ((franchise.draftScouts || []).includes(name)) {
    merged.add("film"); // legacy single-scout entry
  }
  const seasonRev = franchise.seasonScoutReveals?.[name];
  if (seasonRev?.categories && Array.isArray(seasonRev.categories)) {
    for (const c of seasonRev.categories) merged.add(c);
  }
  return [...merged];
}

// Position-value offsets for the consensus board only. Real NFL drafts
// QBs and LTs near the top of every class and almost never spends day-1
// picks on specialists, regardless of raw talent. K/P-at-pick-1 was a
// real bug under pure-OVR sorting.
const _DRAFT_BOARD_POS_VALUE = {
  QB:  5,
  OL:  3,
  DL:  2,
  CB:  1,
  WR:  0,
  RB: -1, S: -1, LB: -1,
  TE: -2,
  K: -15, P: -15,
};

// Stable consensus "big board" score for sorting the draft board. Does
// NOT depend on scout state, so clicking scout doesn't shuffle the board
// out from under the user. Uses true OVR + name-hashed noise + pedigree
// + age cliff + position value. Effectively a "league consensus" view.
function _draftBoardScore(p) {
  let score = p.overall || 60;
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const noise = (Math.abs(h) % 7) - 3;
  score += noise;
  // Path A: pre-draft prospects have draftRound=null; fall back to
  // _generatedRound (their consensus grade) so scout grade tilt still
  // reflects the projected tier.
  const r = p.draftRound ?? p._generatedRound;
  if (r === 1)      score += 3;
  else if (r === 2) score += 1;
  else if (r >= 5)  score -= 2;
  else if (r === 0) score -= 4;
  const age = p.age || 25;
  if (age >= 34)      score -= 6;
  else if (age >= 32) score -= 3;
  score += _DRAFT_BOARD_POS_VALUE[p.position] ?? 0;
  return score;
}

// Did this player have a meaningful in-game role? Used to gate game-
// based scouting flags so a 3rd-string backup who took 4 snaps in a
// blowout doesn't get the same scout sharpening as the starting QB.
// Stats blob shape comes from _stripGameStatsForStorage (per-player
// per-game lines). Position-aware thresholds — what counts as "major"
// differs across positions.
function _wasMajorRole(p) {
  if (!p) return false;
  const pos = p.pos;
  if (pos === "QB") return (p.pass_att || 0) >= 12;
  if (pos === "RB") return (p.rush_att || 0) >= 6 || (p.rec || 0) >= 3;
  if (pos === "WR" || pos === "TE") return (p.rec_tgt || 0) >= 3 || (p.rec || 0) >= 2;
  if (pos === "OL") return ((p.pancakes || 0) + (p.sacks_allowed || 0)) >= 3 || (p.snaps || 0) >= 20;
  if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
    return (p.tkl || 0) >= 3 || (p.sk || 0) > 0 || (p.int_made || 0) > 0
      || (p.pd || 0) >= 2 || (p.ff || 0) > 0;
  }
  if (pos === "K" || pos === "P") return true; // specialists always full role
  return false;
}

// ── Workout system ────────────────────────────────────────────────────────────
// During the FA pool phase the user can spend workout slots to bring a player
// in for a week-long tryout. The workout strips most of the scout-grade noise
// and reveals one position-specific trait — confirming a diamond or exposing
// a workout warrior.

const _WORKOUT_TRAITS = {
  QB:  { pos: ["Elite pocket poise","Quick release","Strong football IQ","Exceptional arm talent"],
         neg: ["Happy feet in the pocket","Slow progression reads","Struggles under pressure","Poor off-platform throws"] },
  RB:  { pos: ["Explosive burst & acceleration","Elite pass protection","Reliable receiver out of backfield","Great vision & patience"],
         neg: ["Fumble concerns noted","Limited receiving ability","One-gear runner","Struggles vs speed in coverage"] },
  WR:  { pos: ["Elite hands — zero drops","Sharp route running","Excellent YAC ability","Quick separation"],
         neg: ["Inconsistent hands — drops noted","Struggles vs press coverage","Limited route tree","Fails to separate at top"] },
  TE:  { pos: ["Versatile inline blocker","Reliable hands in traffic","Surprising athleticism","Runs precise routes"],
         neg: ["Blocking effort inconsistent","Struggles vs athletic ends","Limited route running","Hands need work"] },
  OL:  { pos: ["Excellent pass protection footwork","Nasty in run game","Great line communication","Strong anchor strength"],
         neg: ["Gets beaten by speed rushers","Pass protection concerns","Technique breaks down late","Struggles in space"] },
  DL:  { pos: ["Motor never stops","Elite initial burst","Great hand technique","Finishes every play"],
         neg: ["Effort issues observed","Gets washed out in run game","Limited pass rush plan","Tires quickly"] },
  LB:  { pos: ["Elite instincts & diagnosis","Excellent in coverage","Sideline-to-sideline range","Great blitz timing"],
         neg: ["Slow to diagnose plays","Coverage limitations","Gets lost in zone schemes","Takes poor angles"] },
  CB:  { pos: ["Sticky in man coverage","Great ball skills","Excellent press technique","Smooth transitions"],
         neg: ["Struggles in zone coverage","Too physical — flag risk","False steps at snap","Limited recovery speed"] },
  S:   { pos: ["Exceptional range","Elite run support","Natural ball hawk","Great secondary communication"],
         neg: ["Box skills only — no range","Caught peeking at QB","Inconsistent tackling","Struggles in coverage"] },
  K:   { pos: ["Legitimate leg strength","Elite touch on short kicks","Clutch under pressure"],
         neg: ["Accuracy is a real concern","Distance falls short","Shows nerves in big moments"] },
  P:   { pos: ["Elite hang time","Directional kicking ability","Strong net average"],
         neg: ["Inconsistent in bad weather","Hang time average at best","Directional limitations"] },
};

function _workoutSlotsUsed() {
  const w = franchise._faWorkoutSlots;
  if (!w || w.faPhase !== franchise.season) return 0;
  return w.used || 0;
}
function _workoutSlotsRemaining() {
  return Math.max(0, WORKOUT_SLOTS_PER_FA_SEASON - _workoutSlotsUsed());
}
function _consumeWorkoutSlot() {
  if (!franchise._faWorkoutSlots || franchise._faWorkoutSlots.faPhase !== franchise.season) {
    franchise._faWorkoutSlots = { faPhase: franchise.season, used: 0 };
  }
  franchise._faWorkoutSlots.used += 1;
}

// Compute the sharp grade shown after a workout (±1 noise instead of ±8).
function _computeSharpGrade(p) {
  let score = p.overall || 60;
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  score += ((Math.abs(h) % 3) - 1);
  // Path A: pre-draft prospects have draftRound=null; fall back to
  // _generatedRound (their consensus grade) so scout grade tilt still
  // reflects the projected tier.
  const r = p.draftRound ?? p._generatedRound;
  if (r === 1)      score += 3;
  else if (r === 2) score += 1;
  else if (r >= 5)  score -= 2;
  else if (r === 0) score -= 4;
  const age = p.age || 25;
  if (age >= 34)      score -= 6;
  else if (age >= 32) score -= 3;
  return Math.max(20, Math.min(99, Math.round(score)));
}

function frnFAInviteWorkout(nameOrKey) {
  if (_workoutSlotsRemaining() <= 0) {
    alert(`No workout slots left this offseason (${WORKOUT_SLOTS_PER_FA_SEASON} total).`);
    return;
  }
  const fa = (franchise.freeAgents || []).find(p => p.pid === nameOrKey || p.name === nameOrKey);
  if (!fa) return;

  _consumeWorkoutSlot();
  franchise._faWorkoutResults = franchise._faWorkoutResults || {};

  const ovr = fa.overall || 60;
  const traits = _WORKOUT_TRAITS[fa.position] || _WORKOUT_TRAITS.DL;

  // Result tier — probability driven by true overall so diamonds trend Standout
  const r = Math.random();
  let result;
  if      (ovr >= 85) result = r < 0.50 ? "standout" : r < 0.85 ? "solid" : r < 0.97 ? "mixed" : "bombed";
  else if (ovr >= 75) result = r < 0.25 ? "standout" : r < 0.65 ? "solid" : r < 0.90 ? "mixed" : "bombed";
  else if (ovr >= 65) result = r < 0.10 ? "standout" : r < 0.40 ? "solid" : r < 0.80 ? "mixed" : "bombed";
  else                result = r < 0.03 ? "standout" : r < 0.18 ? "solid" : r < 0.53 ? "mixed" : "bombed";

  const posPool = traits.pos;
  const negPool = traits.neg;
  const posTrait = posPool[Math.floor(Math.random() * posPool.length)];
  const negTrait = negPool[Math.floor(Math.random() * negPool.length)];

  const sharpGrade   = _computeSharpGrade(fa);
  const demandBefore = fa.demandedAAV;

  // Demand shifts: Standout players feel the market, bombers get desperate
  let demandDeltaPct = 0;
  if (result === "standout") demandDeltaPct = +(5 + Math.random() * 8).toFixed(1);
  else if (result === "bombed") demandDeltaPct = -(10 + Math.random() * 12).toFixed(1);
  if (demandDeltaPct !== 0) {
    fa.demandedAAV = Math.max(0.5, +(fa.demandedAAV * (1 + demandDeltaPct / 100)).toFixed(1));
  }

  franchise._faWorkoutResults[fa.name] = { result, posTrait, negTrait, sharpGrade, demandBefore, demandDeltaPct };

  if (result === "standout") {
    fa._workoutHot = true;
    _pushNews({ type: "workout", label: `👀 ${fa.position} ${fa.name}'s workout impresses — rival teams taking notice` });
  }

  saveFranchise();
  renderFrnFA(nameOrKey);
}

function gradeLabel(score) {
  if (score >= 92) return "A+";
  if (score >= 87) return "A";
  if (score >= 82) return "A-";
  if (score >= 77) return "B+";
  if (score >= 72) return "B";
  if (score >= 67) return "B-";
  if (score >= 62) return "C+";
  if (score >= 55) return "C";
  if (score >= 48) return "C-";
  if (score >= 38) return "D";
  return "F";
}

function gradeClass(score) {
  if (score >= 82) return "elite";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  return "poor";
}

// Ownership-aware badge — owned players (current roster) show exact
// OVR, everyone else shows a scout-grade letter with noise. Matches
// the rest of the app's visibility model so you don't have to look at
// a noisy letter grade for your own QB.
function gradeBadge(p) {
  const myId = franchise?.chosenTeamId;
  if (myId != null) {
    const myRoster = franchise?.rosters?.[myId] || [];
    if (myRoster.includes(p) || myRoster.some(rp => rp.name === p?.name && rp.position === p?.position)) {
      const ovr = p.overall || 60;
      return `<span class="tt-ovr tier-${gradeClass(ovr)}" title="OVR — internal rating">${ovr}</span>`;
    }
  }
  const s = scoutGrade(p);
  const source = _scoutSourceLabel(p);
  return `<span class="tt-ovr tier-${gradeClass(s)}" title="Scout grade — ${source}">${gradeLabel(s)}</span>`;
}

// Years-in-league is what the user actually cares about. Calendar years
// don't map cleanly because a real-world year sees multiple in-game
// seasons. Prefer "Yr 3 · R1 #5" over "2026 R1 #5".
function _yearsInLeague(p) {
  if (p?.draftSeason != null && franchise?.season != null) {
    return Math.max(0, (franchise.season - p.draftSeason));
  }
  return Math.max(0, (p?.age || 22) - 22);
}
function draftStr(p) {
  if (!p?.draftRound && !p?.draftYear) return "—";
  // Pre-draft prospects (Path A) have draftRound=null until selected;
  // _generatedRound carries their consensus grade for display. Show
  // "Prospect · ~R3" instead of an empty round number.
  if (p.isProspect) {
    const g = p._generatedRound;
    return g === 0 ? "Prospect · ~UDFA"
         : g       ? `Prospect · ~R${g}`
                   : "Prospect";
  }
  // _yearsInLeague returns seasons COMPLETED. "Yr N" here is read as
  // "N years of experience" — matches the career history table (a
  // player with 1 finished season has 1 row labeled "Yr 1"). 0
  // completed seasons → still in his rookie year.
  const yrs = _yearsInLeague(p);
  const yrTag = yrs === 0 ? "Rookie" : `Yr ${yrs}`;
  // Slip badge — for UDFA-signed rookies who had a draftable consensus
  // grade pre-draft. Surfaces the Brady-via-UDFA narrative: "this guy
  // had a R3 grade but no team picked him." `_slipGrade` is preserved
  // at sign time before draftRound gets clobbered to 0.
  if (p.draftRound === 0 && p._slipGrade > 0) {
    return `${yrTag} · UDFA · ↓ ~R${p._slipGrade} SLIP`;
  }
  if (p.draftRound === 0) return `${yrTag} · UDFA`;
  return `${yrTag} · R${p.draftRound} #${p.draftPick}`;
}

function careerEarningsStr(p) {
  return `$${(p.careerEarnings || 0).toFixed(1)}M`;
}

// Convert hidden internal stats into combine-style measurables that the
// user can see without exposing the raw 0-99 rating. These are stable
// per player (function of p.stats) and read like real combine results.
// ── NFL COMBINE MEASURABLES ─────────────────────────────────────────────────
// Real-NFL pre-draft physical testing: 40-yd, bench, vertical, broad, 3-cone,
// 20-yd shuttle, plus height/weight measurements. Each test pulls from a
// different subset of stats — and is more or less relevant by position.
// QBs don't bench at the combine, OL skip the 3-cone, K/P skip drills entirely.
// Use combineGrade(p) for position-relative letter grades.
function combineMeasurables(p) {
  const [spd=50, str=50, agi=50, /*awr*/, /*thr*/, /*cat*/, blk=50, /*prs*/, /*cov*/, /*tck*/, kpw=50] = p.stats || [];
  const pos = p.position;
  // Bench reps: BLK contributes ~25% (OL/DL functional strength); skill
  // positions read pure raw strength.
  const strScore = ["OL","DL","TE","LB"].includes(pos) ? str * 0.75 + blk * 0.25 : str;
  // 40-yd formula steepened: was 5.15 - (spd-40)*0.0135 which produced
  // 4.35s for SPD 99 (NFL elite ~4.30 ✓) but only 5.15s for SPD 35 (NFL
  // slow OL ~5.50). New: 5.55 - (spd-30)*0.018, so SPD 30 → 5.55s (real-NFL
  // slowest), SPD 99 → 4.31s (Bo Jackson tier). Position SPD distribution
  // (per pos caps in statsFor) drives the realistic per-pos spread.
  return {
    fortyTime:  +(5.55 - (spd - 30) * 0.018).toFixed(2),
    benchReps:  Math.max(2, Math.round(6 + (strScore - 40) * 0.42)),
    coneTime:   +(8.10 - (agi - 40) * 0.026).toFixed(2),
    shuttleTime:+(5.10 - (agi * 0.7 + spd * 0.3 - 40) * 0.020).toFixed(2),
    verticalIn: Math.max(20, Math.round(26 + (spd + agi - 80) * 0.16)),
    broadJumpIn:Math.max(85, Math.round(95 + (spd + agi - 80) * 0.42)),
    heightIn:   _combineHeight(p),
    weightLbs:  _combineWeight(p),
    handSizeIn: pos === "QB" ? +(8.5 + Math.random() * 2.5).toFixed(2) : null,
    armLengthIn:["QB","OL","DL","CB","S"].includes(pos) ? +(31 + Math.random() * 5).toFixed(2) : null,
    kpw,
  };
}
// Height — position-aware. Real NFL position means: WR/CB 5'11"-6'0", QB
// 6'2"-6'4", TE/DL 6'3"-6'5", OL 6'4"-6'6", S 6'0", LB 6'2", RB 5'10"-6'0",
// K/P 6'0"-6'2". Range ±3.5" so positions span their realistic NFL min-max
// (e.g., 5'8" to 6'5" QBs both exist; engine should reflect that).
// Math.round (NOT Math.floor) — floor biases the mean down by ~0.5".
function _combineHeight(p) {
  const pos = p.position;
  const meanIn = { QB:75, RB:71, WR:73, TE:77, OL:77, DL:75, LB:74, CB:71, S:72, K:73, P:73 }[pos] ?? 73;
  return meanIn + Math.round((Math.random() - 0.5) * 7);
}
// Weight — NFL position averages, with stat noise. STR adds mass for trench
// positions; LEAN body type subtracts ~12 lbs. Random noise widened to ±15
// (was ±4) so distribution matches the 50-65 lb NFL ranges (e.g., WR
// 170-235, DL 240-330) rather than the tight 30-lb band we had before.
function _combineWeight(p) {
  const pos = p.position;
  const [, str=50] = p.stats || [];
  const meanLbs = { QB:220, RB:215, WR:200, TE:250, OL:315, DL:280, LB:240, CB:195, S:205, K:200, P:215 }[pos] ?? 220;
  // STR drives weight variance with a logarithmic curve around a position-
  // specific baseline. Diminishing returns at the tails: STR 75->80 adds
  // more weight per point than STR 90->95. Trench positions baseline at
  // 75 (= the new STR min), skill at 60. K/P: no STR scaling.
  const trenchPos = ["OL","DL","TE","LB"].includes(pos);
  const strBase = trenchPos ? 75 : 60;
  const strDelta = str - strBase;
  const trenchScale = trenchPos ? 3.0 : 1.8;
  const strBump = ["K","P"].includes(pos) ? 0
                : Math.sign(strDelta) * Math.log(1 + Math.abs(strDelta)) * trenchScale;
  // BodyType-specific mass adjustment. pickBodyType (play-render.js)
  // returns: HUGE, BIG, TALL_HEAVY, HEAVY_SHORT, BROAD, COMPACT,
  // LEAN, NORMAL, SLENDER, PLUS_SIZE. The map covers all of them so
  // a "HUGE" lineman actually weighs more than a "BIG" one.
  const BODY_WEIGHT_MOD = {
    HUGE:        +25,  // Vince Wilfork tier — true big bodies
    PLUS_SIZE:   +18,
    HEAVY_SHORT: +12,  // Snacks Harrison — short + thick
    TALL_HEAVY:  +10,
    BIG:         +6,
    BROAD:       +5,
    NORMAL:       0,
    COMPACT:     -4,
    SLENDER:    -10,
    LEAN:       -12,
  };
  // K/P always get "LEAN" body type from pickBodyType (for visual
  // rendering — tall thin athletes), but NFL kickers aren't actually
  // 12 lbs underweight. Use NORMAL body mod for K/P specifically.
  const bodyTypeForWeight = ["K", "P"].includes(pos) ? "NORMAL" : p.bodyType;
  const bodyMod = BODY_WEIGHT_MOD[bodyTypeForWeight] ?? 0;
  // Per-player weight spread (±15 lbs) — was Math.random(), which RE-ROLLED a
  // player's effective weight on EVERY effectiveSpeed call (play-to-play noise,
  // not the intended cross-player spread). Seed it by name so the spread is
  // preserved across players but STABLE for a given player.
  let _h = 0; const _nm = p.name || p.pid || pos;
  for (let i = 0; i < _nm.length; i++) _h = (_h * 31 + _nm.charCodeAt(i)) | 0;
  const stableSpread = (Math.abs(_h) % 31) - 15;          // -15..+15, stable per player
  // AGE BLOAT — conditioning slips in the back third of a career; a few lbs creep
  // on past 30 (capped +12 at ~40). Flows into effectiveSpeed as a small drag that
  // REINFORCES the SPD/AGI decline already modeled. Zero for ≤30 so the base
  // distribution / speed calibration is untouched — adds only the decline effect.
  const ageBloat = Math.min(12, Math.max(0, (p.age || 25) - 30) * 1.2);
  return Math.round(meanLbs + strBump + bodyMod + stableSpread + ageBloat);
}
// Per-position test relevance — used by combine event and UI to show only
// drills that matter for the player's position. QBs don't bench at the
// combine; OL/DL skip the 3-cone; K/P don't drill at all.
const COMBINE_TESTS_BY_POS = {
  QB:  { fortyTime:1, benchReps:0, coneTime:0, shuttleTime:0, verticalIn:1, broadJumpIn:1, handSizeIn:1, armLengthIn:1 },
  RB:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:1, verticalIn:1, broadJumpIn:1 },
  WR:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:1, verticalIn:1, broadJumpIn:1 },
  TE:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:0, verticalIn:1, broadJumpIn:1, armLengthIn:1 },
  OL:  { fortyTime:1, benchReps:1, coneTime:0, shuttleTime:0, verticalIn:1, broadJumpIn:1, armLengthIn:1 },
  DL:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:0, verticalIn:1, broadJumpIn:1, armLengthIn:1 },
  LB:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:1, verticalIn:1, broadJumpIn:1 },
  CB:  { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:1, verticalIn:1, broadJumpIn:1, armLengthIn:1 },
  S:   { fortyTime:1, benchReps:1, coneTime:1, shuttleTime:1, verticalIn:1, broadJumpIn:1, armLengthIn:1 },
  K:   { fortyTime:0, benchReps:0, coneTime:0, shuttleTime:0, verticalIn:0, broadJumpIn:0 },
  P:   { fortyTime:0, benchReps:0, coneTime:0, shuttleTime:0, verticalIn:0, broadJumpIn:0 },
};
// Per-position test thresholds (NFL elite / good / avg / below-avg). Each
// test stores [elite, good, avg, below] cutoffs. Lower = better for time
// tests (40/cone/shuttle); higher = better for explosion tests (vert/broad/bench).
const COMBINE_THRESHOLDS = {
  QB:  { fortyTime:[4.55,4.75,4.90,5.10],  verticalIn:[34,30,27,24], broadJumpIn:[115,108,102,95] },
  RB:  { fortyTime:[4.40,4.50,4.60,4.75],  benchReps:[24,20,16,12],  coneTime:[6.85,7.05,7.20,7.40], shuttleTime:[4.10,4.25,4.40,4.55], verticalIn:[40,36,32,28], broadJumpIn:[125,120,115,108] },
  WR:  { fortyTime:[4.35,4.45,4.55,4.70],  benchReps:[20,16,12,8],   coneTime:[6.75,6.95,7.15,7.35], shuttleTime:[4.05,4.20,4.35,4.50], verticalIn:[40,36,32,28], broadJumpIn:[128,122,116,108] },
  TE:  { fortyTime:[4.60,4.75,4.90,5.05],  benchReps:[22,18,14,10],  coneTime:[7.00,7.20,7.40,7.60], verticalIn:[36,32,28,24], broadJumpIn:[122,116,110,103] },
  OL:  { fortyTime:[4.95,5.15,5.30,5.50],  benchReps:[30,25,21,16],  verticalIn:[32,28,24,20], broadJumpIn:[110,105,100,93] },
  DL:  { fortyTime:[4.65,4.85,5.05,5.25],  benchReps:[28,23,19,15],  coneTime:[7.05,7.30,7.55,7.80], verticalIn:[36,32,28,24], broadJumpIn:[120,114,108,100] },
  LB:  { fortyTime:[4.50,4.65,4.80,4.95],  benchReps:[24,20,16,12],  coneTime:[6.90,7.10,7.30,7.50], shuttleTime:[4.10,4.25,4.40,4.55], verticalIn:[38,34,30,26], broadJumpIn:[124,118,112,105] },
  CB:  { fortyTime:[4.35,4.45,4.55,4.70],  benchReps:[16,13,10,7],   coneTime:[6.75,6.95,7.15,7.35], shuttleTime:[4.05,4.20,4.35,4.50], verticalIn:[40,36,32,28], broadJumpIn:[128,122,116,108] },
  S:   { fortyTime:[4.40,4.50,4.60,4.75],  benchReps:[18,15,12,9],   coneTime:[6.85,7.05,7.25,7.45], shuttleTime:[4.10,4.25,4.40,4.55], verticalIn:[38,34,30,26], broadJumpIn:[125,119,113,106] },
};
// Returns letter grade ("A+","A","B+","B","C","D") for a single test value
// given position-specific thresholds. For time tests (lower is better),
// invert the comparison.
function _combineGradeForTest(pos, test, value) {
  const t = COMBINE_THRESHOLDS[pos]?.[test];
  if (!t || value == null) return null;
  const lowerIsBetter = ["fortyTime","coneTime","shuttleTime"].includes(test);
  const [a, b, c, d] = t;
  if (lowerIsBetter) {
    if (value <= a) return "A+";
    if (value <= b) return "A";
    if (value <= c) return "B";
    if (value <= d) return "C";
    return "D";
  }
  if (value >= a) return "A+";
  if (value >= b) return "A";
  if (value >= c) return "B";
  if (value >= d) return "C";
  return "D";
}
// Per-position combine grade summary. Returns object with letter grade
// for each relevant test + a composite "overall combine grade" (A+ to D)
// weighted by position priorities (CBs care about 40 most; OL bench most).
function combineGrade(p) {
  if (!p?.position) return null;
  const cmb = combineMeasurables(p);
  const tests = COMBINE_TESTS_BY_POS[p.position] || {};
  const grades = {};
  // Each position's "priority weights" — how much each test counts toward
  // the composite. Reflects real-NFL scouting bias (CBs live by their 40;
  // OL live by the bench; QB athleticism is secondary to throw mechanics).
  const PRIO = {
    QB:  { fortyTime:0.30, verticalIn:0.20, broadJumpIn:0.20, handSizeIn:0.15, armLengthIn:0.15 },
    RB:  { fortyTime:0.30, broadJumpIn:0.20, coneTime:0.15, verticalIn:0.15, benchReps:0.10, shuttleTime:0.10 },
    WR:  { fortyTime:0.35, verticalIn:0.20, broadJumpIn:0.15, coneTime:0.15, shuttleTime:0.10, benchReps:0.05 },
    TE:  { fortyTime:0.20, benchReps:0.20, broadJumpIn:0.20, verticalIn:0.20, coneTime:0.15, armLengthIn:0.05 },
    OL:  { benchReps:0.40, broadJumpIn:0.25, fortyTime:0.15, verticalIn:0.10, armLengthIn:0.10 },
    DL:  { fortyTime:0.25, benchReps:0.25, broadJumpIn:0.20, verticalIn:0.15, coneTime:0.10, armLengthIn:0.05 },
    LB:  { fortyTime:0.25, coneTime:0.20, verticalIn:0.15, broadJumpIn:0.15, benchReps:0.15, shuttleTime:0.10 },
    CB:  { fortyTime:0.40, verticalIn:0.20, coneTime:0.15, shuttleTime:0.15, broadJumpIn:0.10 },
    S:   { fortyTime:0.30, verticalIn:0.20, broadJumpIn:0.15, coneTime:0.15, shuttleTime:0.10, benchReps:0.10 },
  };
  const weights = PRIO[p.position] || {};
  const GRADE_PTS = { "A+":4, "A":3, "B":2, "C":1, "D":0 };
  let weightedSum = 0, totalWeight = 0;
  for (const [test, included] of Object.entries(tests)) {
    if (!included) continue;
    const grade = _combineGradeForTest(p.position, test, cmb[test]);
    if (!grade) continue;
    grades[test] = grade;
    const w = weights[test] || 0;
    weightedSum += (GRADE_PTS[grade] || 0) * w;
    totalWeight += w;
  }
  const compositePts = totalWeight ? weightedSum / totalWeight : 2;
  const overall = compositePts >= 3.5 ? "A+" : compositePts >= 2.8 ? "A" : compositePts >= 1.8 ? "B" : compositePts >= 0.8 ? "C" : "D";
  return { grades, overall, measurables: cmb };
}

// Assign draft pedigree + career earnings to any roster player missing them.
// At franchise start we retroactively give every player a "draft history"
// based on their age and (hidden) overall, with realistic noise. Rookies
// generated each offseason set their own draftYear via runFrnOffseason.
function assignDraftInfo(rosters, currentYear) {
  for (const roster of Object.values(rosters)) {
    for (const p of roster) {
      if (p.draftYear == null) {
        const yearsInLeague = Math.max(0, (p.age || 22) - 22);
        p.draftYear = currentYear - yearsInLeague;
        // Negative draftSeason — drafted before franchise S1.
        p.draftSeason = (franchise?.season || 1) - yearsInLeague;
        const ovr = p.overall || 70;
        const expectedPick = Math.max(1, Math.min(224,
          Math.round(260 - (ovr - 50) * 4.8 + (Math.random() - 0.5) * 80)
        ));
        if (Math.random() < 0.05 && ovr < 82) {
          p.draftRound = 0; p.draftPick = null;
        } else {
          p.draftRound = Math.min(7, Math.ceil(expectedPick / 32));
          p.draftPick  = ((expectedPick - 1) % 32) + 1;
        }
      }
      if (p.careerEarnings == null) {
        const yearsInLeague = Math.max(0, (p.age || 22) - 22);
        const aav = p.contract?.aav || 1;
        p.careerEarnings = Math.round(yearsInLeague * aav * 0.65 * 10) / 10;
      }
      if (p.potential == null) p.potential = _rollPotential(p);
    }
  }
}

// Hidden ceiling — a player's max OVR. Veterans get a small bump
// above current; rookies and young players get a noisy roll keyed off
// their draft slot. Some 1st-rounders bust (potential < current OVR
// even), some late picks/UDFAs have huge ceilings.
// ⚠ PRIVACY-CRITICAL FIELD — DO NOT EXPOSE THE EXACT NUMBER IN UI.
//
// `p.potential` is the player's ceiling (their max achievable OVR).
// All UI surfaces (gains sheet, scouting panel, player cards, news
// labels, etc.) must redact this to either a tier letter (S/A/B/C/D
// via _ceilingTier) or a qualitative magnitude ("significantly",
// "modestly", "at ceiling"). NEVER render the raw number, the
// to-from numbers on a ceiling bump, or a derived "+N room" that
// trivially reveals the ceiling (postOvr + N = potential).
//
// ⛓ MEGAETH IMPLEMENTATION NOTE
// When this game is ported to the MegaETH on-chain contract, the
// `potential` field MUST be either:
//   (a) kept off-chain entirely (server-authoritative), or
//   (b) stored on-chain only as a commitment / encrypted blob that
//       the client cannot decrypt
// Otherwise clients can read the chain directly and skip the entire
// scouting / "tier reveal" gameplay loop, cheating their way to
// perfect roster decisions. The tier abstraction in the UI is the
// gameplay loop; on-chain exposure would defeat it.
function _rollPotential(p, hintRound, hintBoost = 0) {
  const age = p.age || 22;
  const ovr = p.overall || 70;
  // Vets (25+): potential = current + 0-3 bump (peak players)
  if (age >= 25) return Math.min(99, ovr + Math.floor(Math.random() * 4));
  // Young (22-24): draft pedigree drives mean. `hintRound` lets callers
  // who don't yet have draftRound set (e.g., college FR generation)
  // route potential to the right round-bucket. `hintBoost` adds
  // year-aware headroom — an FR-elite has 4 years to develop so they
  // get a higher potential mean than a SR-elite who arrives already
  // mostly-developed. Without the boost, FR superstars hit ceiling
  // by SO and stop growing (Trevor Lawrence ends college flat at 88).
  const r = p.draftRound || hintRound || 7;
  const meanByRound = { 1: 88, 2: 81, 3: 75, 4: 70, 5: 66, 6: 63, 7: 60, 0: 58 };
  const stdByRound  = { 1: 5,  2: 6,  3: 7,  4: 7,  5: 7,  6: 7,  7: 7,  0: 8 };
  const mean = (meanByRound[r] ?? 65) + hintBoost;
  const std = stdByRound[r] ?? 7;
  // Box-Muller-ish noise
  let u = Math.random() || 1e-9, v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  let potential = Math.round(mean + std * z);
  // Floor at current OVR-2 (so an 80 OVR rookie isn't capped at 70)
  potential = Math.max(ovr - 2, Math.min(99, potential));
  return potential;
}

// Public scouting hint derived from potential ceiling.
// known=true  → accurate label (coached this player 1+ season), prefixed with 📋
// scoutRevealed=true → accurate label, no prefix (lucky scout intel)
// default     → fuzzy label with "?" — noise width scales by draft round,
//               pedigree bias skews R1 optimistic and late rounds pessimistic.
function potentialTag(p, { known = false, scoutRevealed = false } = {}) {
  if (p.potential == null) return "";
  // Pre-draft prospects (Path A) have draftRound=null; fall back to
  // _generatedRound (their consensus grade) so the ceiling chip
  // judges them against the right round expectation. Final fallback
  // is R4 (mid-class). Without this, every camp-body prospect was
  // judged vs R4 expected potential and read as "↗ Late bloomer".
  const r = p.draftRound ?? p._generatedRound ?? 4;
  const expected = { 1:88, 2:81, 3:75, 4:70, 5:66, 6:63, 7:60, 0:58 }[r] ?? 65;
  // Vets past their peak don't have a "ceiling" to talk about — the
  // potential is realized (or not) and growth narrative is over. Show
  // a different summary: HIT POTENTIAL / FELL SHORT / etc.
  const peakAge = p.peakAge ?? 27;
  const isVetPastPeak = (p.age || 0) >= peakAge + 1;
  if (isVetPastPeak && (known || scoutRevealed)) {
    const realized = (p.overall || 0) - p.potential;
    const pre = known ? "📋 " : "";
    if (realized >= 0)    return `${pre}✓ Hit ceiling`;
    if (realized >= -4)   return `${pre}≈ At ceiling`;
    if (realized >= -8)   return `${pre}↘ Under ceiling`;
    return `${pre}▾ Fell short`;
  }

  if (known || scoutRevealed) {
    const delta = p.potential - expected;
    const pre = known ? "📋 " : "";
    if (delta >= 8)  return `${pre}⭐ HIGH CEILING`;
    if (delta >= 4)  return `${pre}↗ Late bloomer`;
    if (delta <= -8) return `${pre}⚠ Bust risk`;
    if (delta <= -4) return `${pre}▾ Capped`;
    return "";
  }

  // Fuzzy path — stable hash noise independent from OVR fuzz (different seed ×53)
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 53 + name.charCodeAt(i)) | 0;
  const noiseWidth = r === 1 ? 6 : r <= 3 ? 8 : 12;
  const pedigreeBias = r === 1 ? 3 : r === 2 ? 1 : r >= 6 ? -3 : r === 5 ? -1 : 0;
  const noise = (Math.abs(h) % (noiseWidth * 2 + 1)) - noiseWidth;
  const perceived = p.potential + noise + pedigreeBias;
  const delta = perceived - expected;
  if (delta >= 8)  return "⭐ LOOKS ELITE?";
  if (delta >= 4)  return "↗ UPSIDE?";
  if (delta <= -8) return "⚠ CONCERNS?";
  if (delta <= -4) return "▾ LIMITED?";
  return "";
}

// True if the user's franchise has coached this player for at least one full season.
function _isKnownPlayer(p) {
  if (!p?.pid) return false;
  return (franchise?.knownPotentialPids || []).includes(p.pid);
}

// ── Coaching staff ────────────────────────────────────────────────────────────
// Full coaching staff: HC (culture + specialty traits), OC, DC, position staff.
// Redesigned for franchise season 2+. Legacy saves are backfilled via
// _backfillCoachingStaff().

const HC_CULTURE_TRAITS = [
  { key:"Disciplinarian", desc:"Injury rate −20%, re-sign rate −10%" },
  { key:"Players' Coach", desc:"Re-sign rate +15%, injury rate +5%" },
  { key:"Business-Like",  desc:"Stable — no modifier, hard to fire" },
];

const HC_SPECIALTY_TRAITS = [
  { key:"Player Developer",  desc:"Young player dev +35%, TEC coaching" },
  { key:"Game Manager",      desc:"Better 4th-down calls, turnovers −12%" },
  { key:"Motivator",         desc:"Late-game boost when trailing ≤7 in Q4" },
  { key:"Roster Builder",    desc:"FA acceptance +20%" },
  { key:"Offensive Minded",  desc:"Team offense +2, OC chemistry bonus" },
  { key:"Defensive Minded",  desc:"Team defense +2, DC chemistry bonus" },
  { key:"Riverboat Gambler", desc:"Aggressive 4th-down (+40%), more 2-pt tries" },
  { key:"Conservative",      desc:"Cautious 4th-down (−35%), kneels earlier" },
];

const OC_TRAITS = [
  { key:"QB Whisperer",    desc:"QB TEC growth ×2, QB AWR ceiling +5" },
  { key:"Air Attack",      desc:"WR TEC growth ×1.5, TE TEC growth ×1.3 — builds the passing corps" },
  { key:"Red Zone Genius", desc:"TE TEC growth ×1.5, RB TEC growth ×1.2 — +1 offense when running WEST COAST" },
  { key:"Run Architect",   desc:"RB TEC growth ×1.5 — develops the ball carrier" },
  { key:"Trench General",  desc:"OL TEC growth ×2, +1 offense when running SMASHMOUTH" },
  { key:"Balanced",        desc:"No modifier — adapts to HC scheme" },
];

const DC_TRAITS = [
  { key:"Pressure Package", desc:"DL TEC growth ×1.5 — +1 defense every game; develops elite pass rushers" },
  { key:"Cover Scheme",     desc:"S TEC growth ×1.5, LB TEC growth ×1.3 — builds zone-reading secondary" },
  { key:"Ball Hawk",        desc:"CB TEC growth ×1.5, S TEC growth ×1.3 — +1 defense every game; develops ball-hawking secondary" },
  { key:"Run Stopper",      desc:"DL TEC growth ×1.2, LB TEC growth ×1.3 — +1 defense vs SMASHMOUTH opponents" },
  { key:"Film Mastermind",  desc:"Player TEC growth +20%, DEVELOP alignment group" },
  { key:"Hybrid",           desc:"No modifier — scheme-agnostic" },
];

// ── Coaching Scheme System (Rock-Paper-Scissors) ──────────────────────────────
// Each OC trait maps to an offensive scheme; each DC trait to a defensive scheme.
// The counter matrix drives OVR modifiers in game sim (+ve = offense advantage).

const OFF_SCHEME_MAP = {
  "Air Attack":      "AIR RAID",
  "QB Whisperer":    "AIR RAID",
  "Red Zone Genius": "WEST COAST",
  "Run Architect":   "SMASHMOUTH",
  "Trench General":  "SMASHMOUTH",
  "Balanced":        "SPREAD OPTION",
};

const DEF_SCHEME_MAP = {
  "Pressure Package": "BLITZ PACKAGE",
  "Cover Scheme":     "COVER 2 ZONE",
  "Ball Hawk":        "MAN PRESS",
  "Run Stopper":      "STACK 46",
  "Film Mastermind":  "COVER 2 ZONE",
  "Hybrid":           "HYBRID ZONE",
};

// Modifier table: row = offensive scheme, col = defensive scheme.
// Positive = offense gains effective OVR; negative = defense gains.
const SCHEME_COUNTER = {
  "AIR RAID": {
    "BLITZ PACKAGE": +7,  // quick release burns over-aggressive rush
    "COVER 2 ZONE":  -5,  // two-deep drops kill timing routes
    "MAN PRESS":     -4,  // physical coverage disrupts receiver releases
    "STACK 46":      +5,  // heavy box can't cover spread receivers
    "HYBRID ZONE":   -4,  // zone flexibility disciplines short-hitting reads
  },
  "SMASHMOUTH": {
    "BLITZ PACKAGE": +4,  // downhill run punishes overloaded A-gap
    "COVER 2 ZONE":  +5,  // power through the middle of zone
    "MAN PRESS":     +3,  // physical run game wins line battles
    "STACK 46":      -8,  // 8-man box is a run-stopper's dream
    "HYBRID ZONE":   +2,  // power run can still punch through
  },
  "SPREAD OPTION": {
    "BLITZ PACKAGE": +3,  // mobile QB exploits vacated blitz lanes
    "COVER 2 ZONE":  +4,  // spread formations flood zone seams
    "MAN PRESS":     -5,  // receivers isolated, limited YAC
    "STACK 46":      +1,  // QB run threat offsets heavy box
    "HYBRID ZONE":   +5,  // multiple receiver levels collapse hybrid assignments
  },
  "WEST COAST": {
    "BLITZ PACKAGE": -4,  // timing routes disrupted by early pressure
    "COVER 2 ZONE":  +6,  // horizontal stretches flood underneath zones
    "MAN PRESS":     +3,  // crossing routes create natural picks
    "STACK 46":      -3,  // compression limits crossing-route depth
    "HYBRID ZONE":   +2,  // short-to-mid route tree exploits zone gaps
  },
};

// Flavor labels for matchup strength
const SCHEME_MATCHUP_LABELS = [
  { min:  6, label: "DOMINANT",    color: "#00e676" },
  { min:  3, label: "FAVORABLE",   color: "#69f0ae" },
  { min: -2, label: "NEUTRAL",     color: "rgba(255,255,255,.45)" },
  { min: -5, label: "UNFAVORABLE", color: "#ffb74d" },
  { min: -99,label: "BAD",         color: "#ef5350" },
];

function _schemeMatchupLabel(mod) {
  return SCHEME_MATCHUP_LABELS.find(e => mod >= e.min) || SCHEME_MATCHUP_LABELS.at(-1);
}

function _getTeamOffScheme(teamId) {
  const ocTrait = franchise?.coaches?.[teamId]?.oc?.trait;
  return OFF_SCHEME_MAP[ocTrait] || "SPREAD OPTION";
}

function _getTeamDefScheme(teamId) {
  const dcTrait = franchise?.coaches?.[teamId]?.dc?.trait;
  return DEF_SCHEME_MAP[dcTrait] || "HYBRID ZONE";
}

// Returns the raw modifier (positive = offense advantage, negative = defense advantage).
function _schemeMatchup(offScheme, defScheme) {
  return (SCHEME_COUNTER[offScheme] || {})[defScheme] ?? 0;
}

const POSITION_COACH_TIERS = {
  Journeyman: { tecMul:1.0, salary:0.5 },
  Good:       { tecMul:1.3, salary:1.2 },
  Elite:      { tecMul:1.6, tecCeilingBonus:3, salary:2.5 },
};
const POSITION_COACH_GROUPS = ["QB","OL","Skill","DL","LB/DB"];

// Depth chart slot definitions — each slot maps to a position group, fill order,
// and which other slots its backup is flex-eligible to cover.
const DEPTH_CHART_SLOTS = {
  offense: [
    { key:"QB",  pos:"QB", snapFloor:95, flex:[] },
    { key:"RB1", pos:"RB", flex:["RB2"] },
    { key:"RB2", pos:"RB", flex:[] },
    { key:"WR1", pos:"WR", flex:["WR2","WR3"] },
    { key:"WR2", pos:"WR", flex:["WR3","WR4"] },
    { key:"WR3", pos:"WR", flex:["WR4"] },
    { key:"WR4", pos:"WR", flex:[] },
    { key:"TE1", pos:"TE", flex:["TE2"] },
    { key:"TE2", pos:"TE", flex:[] },
    { key:"LT",  pos:"OL", flex:["LG"] },
    { key:"LG",  pos:"OL", flex:["LT","C"] },
    { key:"C",   pos:"OL", flex:["LG","RG"] },
    { key:"RG",  pos:"OL", flex:["C","RT"] },
    { key:"RT",  pos:"OL", flex:["RG"] },
  ],
  defense: [
    { key:"DL1", pos:"DL", flex:["DL2"] },
    { key:"DL2", pos:"DL", flex:["DL1","DL3"] },
    { key:"DL3", pos:"DL", flex:["DL2","DL4"] },
    { key:"DL4", pos:"DL", flex:["DL3"] },
    // Goal-line extra DL (5th and 6th rusher on heavy/short-yardage)
    { key:"DL5", pos:"DL", snapFloor:8, flex:["DL6"], pkgOnly:true },
    { key:"DL6", pos:"DL", snapFloor:5, flex:["DL5"], pkgOnly:true },
    { key:"LB1", pos:"LB", flex:["LB2"] },
    { key:"LB2", pos:"LB", flex:["LB1","LB3"] },
    { key:"LB3", pos:"LB", flex:["LB2"] },
    { key:"CB1", pos:"CB", flex:["CB2","NB"] },
    { key:"CB2", pos:"CB", flex:["CB1","NB"] },
    { key:"NB",  pos:"CB", flex:["CB2"] },
    // Dime corner — 6th DB on heavy-coverage downs
    { key:"NB2", pos:"CB", snapFloor:10, flex:["NB"], pkgOnly:true },
    { key:"SS",  pos:"S",  flex:["FS"] },
    { key:"FS",  pos:"S",  flex:["SS"] },
  ],
  specialTeams: [
    { key:"K",   pos:"K", snapFloor:98, flex:[] },
    { key:"P",   pos:"P", snapFloor:98, flex:[] },
    // Return specialists — any speed-skill player (WR/RB/CB/S) can fill.
    // pos:"RET" is a virtual position; the picker offers all eligible
    // players. snapFloor:6 because returners only see the field on
    // change-of-possession plays.
    { key:"KR1", pos:"RET", snapFloor:6, flex:["KR2","PR1"], retEligible:["WR","RB","CB","S"] },
    { key:"PR1", pos:"RET", snapFloor:6, flex:["PR2","KR1"], retEligible:["WR","RB","CB","S"] },
  ],
};

// Slots that represent "full-time" starters — used by code that asks
// "is this player a starter?" for cut decisions, FA priority sort, opponent
// scouting, etc. Package-only extras (DL5/DL6/NB2, ⛺) and returner slots
// (KR1/PR1) are roster depth, NOT the 22 on the field every Sunday —
// counting them inflates the starter count and distorts those decisions.
const _NON_STARTER_SLOTS = new Set();
for (const sd of [
  ...DEPTH_CHART_SLOTS.offense,
  ...DEPTH_CHART_SLOTS.defense,
  ...DEPTH_CHART_SLOTS.specialTeams,
]) {
  if (sd.pkgOnly || sd.pos === "RET") _NON_STARTER_SLOTS.add(sd.key);
}
function _isFullTimeStarterSlot(slotKey) {
  return !_NON_STARTER_SLOTS.has(slotKey);
}

// Keep legacy constant so old saves that reference COACH_TRAITS don't break.
const COACH_TRAITS = [
  { key:"Player Developer",     desc:"Young player growth +35%" },
  { key:"Offensive Guru",       desc:"+2 team offense rating" },
  { key:"Defensive Mastermind", desc:"+2 team defense rating" },
  { key:"Hard-Ass",             desc:"−20% injury chance for your team" },
  { key:"Players' Coach",       desc:"+15% re-signing acceptance" },
];

// ── Coach contract helpers ──────────────────────────────────────────────────
// Coach contracts mirror player contracts in structure: an AAV, a signing
// bonus prorated over the contract length, per-year base salaries, and a
// performance escalator package that triggers on end-of-season results.
// Cap impact = base + proration each year (so big bonuses spread, dead cap
// on early termination = remaining proration).

const COACH_SB_PCT = { hc: 0.30, oc: 0.18, dc: 0.18 };

// Standard escalator package by role. Bumps are FLAT dollars added to
// next year's base when triggered (or refunded same year for one-shots).
function _coachDefaultEscalators(role) {
  if (role === "hc") {
    return [
      { kind:"winRate",      threshold:0.625, bumpAav:0.5, label:"Winning season → +$0.5M/yr",   triggered:[] },
      { kind:"division",                       bumpOnce:0.5, label:"Division title → +$0.5M bonus", triggered:[] },
      { kind:"sbAppearance",                   bumpOnce:1.0, label:"SB appearance → +$1.0M bonus",  triggered:[] },
      { kind:"championship",                   bumpOnce:1.5, label:"Championship → +$1.5M bonus",   triggered:[] },
    ];
  }
  // Coordinators get smaller, fewer escalators
  return [
    { kind:"winRate",      threshold:0.625, bumpAav:0.25, label:"Winning season → +$0.25M/yr", triggered:[] },
    { kind:"sbAppearance",                   bumpOnce:0.5, label:"SB appearance → +$0.5M bonus", triggered:[] },
  ];
}

// Build a structured contract from AAV / Years / Signing Bonus.
// Bases are flat (AAV − proration each year); escalators templated by role.
function _coachContractCreate(aav, years, signingBonus, role) {
  const yrs = Math.max(1, Math.round(years || 1));
  const sb  = Math.max(0, +signingBonus || 0);
  const aavR = Math.max(0.5, +(aav || 1).toFixed(1));
  const proration = sb > 0 ? +(sb / yrs).toFixed(2) : 0;
  const basePerYr = +Math.max(0.5, aavR - proration).toFixed(2);
  const baseSalaries = Array(yrs).fill(basePerYr);
  return {
    salary: aavR,                  // legacy display field (kept for callers reading .salary)
    aav: aavR,
    contractYears: yrs,            // years remaining (decrements each season)
    contractLength: yrs,           // original length (constant)
    signingBonus: +sb.toFixed(1),
    bonusProration: proration,
    baseSalaries,
    escalators: _coachDefaultEscalators(role || "hc"),
  };
}

// Cap hit for the current year = base salary + bonus proration.
// Falls back to flat .salary for un-migrated legacy contracts.
function _coachCapHit(coach) {
  if (!coach) return 0;
  if (coach.baseSalaries && coach.baseSalaries.length) {
    const yrsLeft = Math.max(1, coach.contractYears || 1);
    const yrsTotal = Math.max(yrsLeft, coach.contractLength || yrsLeft);
    const idx = Math.max(0, Math.min(coach.baseSalaries.length - 1, yrsTotal - yrsLeft));
    const base = coach.baseSalaries[idx] ?? 0;
    return +(base + (coach.bonusProration || 0)).toFixed(2);
  }
  return +(coach.salary || 0);
}

// Dead cap if fired today = remaining proration × years left.
function _coachDeadCapOnFire(coach) {
  if (!coach) return 0;
  const yrsLeft = Math.max(0, (coach.contractYears || 0));
  const prore   = coach.bonusProration || 0;
  return +(prore * yrsLeft).toFixed(2);
}

// Apply a structured contract to an existing coach object (extend / renew).
function _coachApplyContract(coach, aav, years, signingBonus, role) {
  if (!coach) return;
  const c = _coachContractCreate(aav, years, signingBonus, role);
  coach.salary          = c.salary;
  coach.aav             = c.aav;
  coach.contractYears   = c.contractYears;
  coach.contractLength  = c.contractLength;
  coach.signingBonus    = c.signingBonus;
  coach.bonusProration  = c.bonusProration;
  coach.baseSalaries    = c.baseSalaries;
  // Preserve previously-triggered escalators if extending (so the same
  // milestone doesn't pay twice across consecutive contracts).
  const oldEsc = coach.escalators || [];
  coach.escalators = c.escalators.map(esc => {
    const prev = oldEsc.find(e => e.kind === esc.kind);
    return prev?.triggered ? { ...esc, triggered: prev.triggered.slice() } : esc;
  });
}

function _rollCoach() {
  const rating = 45 + Math.floor(Math.random() * 45); // 45-89
  const aav = +(2 + (rating - 45) * 0.18 + Math.random() * 1.5).toFixed(1);
  const years = 3 + Math.floor(Math.random() * 3);
  const sb = +(aav * years * COACH_SB_PCT.hc * (0.7 + Math.random() * 0.6)).toFixed(1);
  const base = {
    name: `${pickFirstName()} ${pickLastName()}`,
    rating,
    cultureTrait:   HC_CULTURE_TRAITS[Math.floor(Math.random() * HC_CULTURE_TRAITS.length)].key,
    specialtyTrait: HC_SPECIALTY_TRAITS[Math.floor(Math.random() * HC_SPECIALTY_TRAITS.length)].key,
    age: 42 + Math.floor(Math.random() * 22),
    yearsWithTeam: 0,
    record: { w: 0, l: 0, championships: 0 },
  };
  _coachApplyContract(base, aav, years, sb, "hc");
  return base;
}

function _rollOC() {
  const rating = 40 + Math.floor(Math.random() * 50); // 40-89
  const aav = +(1 + (rating - 40) * 0.06 + Math.random()).toFixed(1);
  const years = 2 + Math.floor(Math.random() * 3);
  const sb = +(aav * years * COACH_SB_PCT.oc * (0.6 + Math.random() * 0.8)).toFixed(1);
  const base = {
    name: `${pickFirstName()} ${pickLastName()}`,
    rating,
    trait: OC_TRAITS[Math.floor(Math.random() * OC_TRAITS.length)].key,
    age: 35 + Math.floor(Math.random() * 25),
    yearsWithTeam: 0,
  };
  _coachApplyContract(base, aav, years, sb, "oc");
  return base;
}

function _rollDC() {
  const rating = 40 + Math.floor(Math.random() * 50);
  const aav = +(1 + (rating - 40) * 0.06 + Math.random()).toFixed(1);
  const years = 2 + Math.floor(Math.random() * 3);
  const sb = +(aav * years * COACH_SB_PCT.dc * (0.6 + Math.random() * 0.8)).toFixed(1);
  const base = {
    name: `${pickFirstName()} ${pickLastName()}`,
    rating,
    trait: DC_TRAITS[Math.floor(Math.random() * DC_TRAITS.length)].key,
    age: 35 + Math.floor(Math.random() * 25),
    yearsWithTeam: 0,
  };
  _coachApplyContract(base, aav, years, sb, "dc");
  return base;
}

// Special Teams Coordinator — smaller scope than OC/DC. Affects K/P
// yips risk, return effectiveness, blocked-kick / fake-play chance.
// Trait pool kept simple: Mr. Reliable (yips risk down), Trickster
// (more fakes), Coverage Coach (better coverage), Returns Guru
// (better KR/PR).
const STC_TRAITS = [
  { key:"Mr. Reliable",   desc:"K/P yips risk halved" },
  { key:"Trickster",      desc:"Fake punts / fake FG attempts more common" },
  { key:"Coverage Coach", desc:"Coverage units stiffen — fewer return TDs allowed" },
  { key:"Returns Guru",   desc:"Return unit produces bigger plays" },
  { key:"Solid Vet",      desc:"Balanced across all ST domains" },
];
function _rollSTC() {
  const rating = 45 + Math.floor(Math.random() * 45);
  const aav = +(0.5 + (rating - 45) * 0.03 + Math.random() * 0.5).toFixed(1);
  const years = 2 + Math.floor(Math.random() * 3);
  const sb = +(aav * years * 0.15 * (0.6 + Math.random() * 0.8)).toFixed(1);
  const base = {
    name: `${pickFirstName()} ${pickLastName()}`,
    rating,
    trait: STC_TRAITS[Math.floor(Math.random() * STC_TRAITS.length)].key,
    age: 35 + Math.floor(Math.random() * 25),
    yearsWithTeam: 0,
  };
  _coachApplyContract(base, aav, years, sb, "dc"); // dc-tier proration
  return base;
}

function _posCoachTierFromRating(r) {
  return r >= 80 ? "Elite" : r >= 65 ? "Good" : "Journeyman";
}

function _rollPositionCoach(group) {
  const roll = Math.random();
  const tier = roll < 0.50 ? "Journeyman" : roll < 0.85 ? "Good" : "Elite";
  const rating = tier === "Elite" ? 80 + Math.floor(Math.random() * 11)
               : tier === "Good"  ? 65 + Math.floor(Math.random() * 15)
               :                    40 + Math.floor(Math.random() * 25);
  return {
    name: `${pickFirstName()} ${pickLastName()}`,
    group,
    rating,
    tier: _posCoachTierFromRating(rating),
    age: 30 + Math.floor(Math.random() * 15),
    yearsWithTeam: 0,
    salary: POSITION_COACH_TIERS[_posCoachTierFromRating(rating)].salary,
  };
}

// Converts a position coach into a coordinator candidate.
// Rating discounted ~88% (deep positional expertise ≠ full play-calling experience).
// Trait auto-assigned from coaching background. Loyalty bond preserved.
function _posCoachToCoord(pc, teamId) {
  const pcR    = pc.rating || 60;
  const coordR = Math.min(84, Math.round(pcR * 0.88));
  const traitFn = {
    "QB":    () => ({ type:"oc", trait:"QB Whisperer" }),
    "OL":    () => ({ type:"oc", trait:"Trench General" }),
    "Skill": () => ({ type:"oc", trait: Math.random() < 0.5 ? "Run Architect" : "Air Attack" }),
    "DL":    () => ({ type:"dc", trait: Math.random() < 0.5 ? "Pressure Package" : "Run Stopper" }),
    "LB/DB": () => ({ type:"dc", trait: Math.random() < 0.5 ? "Cover Scheme" : "Ball Hawk" }),
  };
  const { type, trait } = (traitFn[pc.group] || (() => ({ type:"oc", trait:"Balanced" })))();
  const sal = +(_marketSalaryForCoach({ rating: coordR, trait }, type)).toFixed(1);
  return {
    type,
    coord: {
      name: pc.name,
      rating: coordR,
      trait,
      age: pc.age || 40,
      yearsWithTeam: pc.yearsWithTeam || 0,
      salary: sal,
      contractYears: 2 + Math.floor(Math.random() * 3),
      isFormerPlayer: pc.isFormerPlayer || false,
      formerPos: pc.formerPos,
      peakOvr: pc.peakOvr,
      proBowls: pc.proBowls || 0,
      allPros: pc.allPros || 0,
      sbRings: pc.sbRings || 0,
      careerStatLine: pc.careerStatLine || "",
      careerYears: pc.careerYears || 0,
      developedByTeamId: pc.developedByTeamId || teamId,
    },
  };
}

function _initCoachingStaff() {
  if (!franchise.coaches) franchise.coaches = {};
  for (const t of TEAMS) {
    if (!franchise.coaches[t.id]) {
      const groups = [...POSITION_COACH_GROUPS].sort(() => Math.random() - 0.5).slice(0, 2);
      franchise.coaches[t.id] = {
        hc: _rollCoach(),
        oc: _rollOC(),
        dc: _rollDC(),
        stc: _rollSTC(),
        positionStaff: groups.map(g => _rollPositionCoach(g)),
      };
    } else if (!franchise.coaches[t.id].stc) {
      // Backfill STC on existing staff that predates this feature
      franchise.coaches[t.id].stc = _rollSTC();
    }
  }
}

// ── FRONT OFFICE STAFF ───────────────────────────────────────────────────────
// Four roles per team, each with rating + trait + tenure. Effects layer
// onto roster-wide systems: scout reduces draft bias, trainer reduces
// injury rate, strength coach boosts dev, GM tilts trade evaluation.
const FRONT_OFFICE_TRAITS = {
  gm: [
    { key: "Trade Hawk",     label: "Trade Hawk",     desc: "Aggressive on trades; finds undervalued players" },
    { key: "Cap Wizard",     label: "Cap Wizard",     desc: "Stretches dollars; cheaper extensions" },
    { key: "Builder",        label: "Builder",        desc: "Prefers homegrown talent; draft-focused" },
    { key: "Win-Now",        label: "Win-Now",        desc: "FA-aggressive; pushes for veterans" },
  ],
  scout: [
    { key: "Eye for Talent", label: "Eye for Talent", desc: "Spots gems in late rounds — reveals hidden potential" },
    { key: "Combine Maven",  label: "Combine Maven",  desc: "Decodes measurables; better tier accuracy" },
    { key: "Tape Grinder",   label: "Tape Grinder",   desc: "Film-based scouting; reveals more attributes" },
    { key: "Network Guy",    label: "Network Guy",    desc: "Pre-draft signal — early in-season visits get extra intel" },
  ],
  trainer: [
    { key: "Conditioning",   label: "Conditioning",   desc: "Lower injury rate per game" },
    { key: "Recovery Spec",  label: "Recovery Spec",  desc: "Faster return from soft-tissue injuries" },
    { key: "Sports Sci",     label: "Sports Sci",     desc: "Lowers catastrophic-injury upgrade chance" },
    { key: "Veteran Carer",  label: "Veteran Carer",  desc: "Players age 31+ stay healthier" },
  ],
  strength: [
    { key: "Mass Builder",   label: "Mass Builder",   desc: "OL/DL gain STR faster" },
    { key: "Speed Lab",      label: "Speed Lab",      desc: "Skill positions gain SPD/AGI faster" },
    { key: "Late Bloomer",   label: "Late Bloomer",   desc: "Players 25-29 keep developing" },
    { key: "Iron Will",      label: "Iron Will",      desc: "Stamina + AWR growth boost league-wide" },
  ],
};
function _rollFrontOfficer(role) {
  const rating = 50 + Math.floor(Math.random() * 45);
  const aav = +(0.4 + (rating - 50) * 0.02 + Math.random() * 0.3).toFixed(1);
  const years = 2 + Math.floor(Math.random() * 3);
  const traits = FRONT_OFFICE_TRAITS[role] || [];
  return {
    name: `${pickFirstName()} ${pickLastName()}`,
    role,
    rating,
    trait: traits[Math.floor(Math.random() * traits.length)]?.key || null,
    age: 38 + Math.floor(Math.random() * 25),
    yearsWithTeam: 0,
    contractYears: years,
    salary: aav,
  };
}
function _initFrontOffice() {
  if (!franchise.frontOffice) franchise.frontOffice = {};
  for (const t of TEAMS) {
    if (!franchise.frontOffice[t.id]) {
      franchise.frontOffice[t.id] = {
        gm:       _rollFrontOfficer("gm"),
        scout:    _rollFrontOfficer("scout"),
        trainer:  _rollFrontOfficer("trainer"),
        strength: _rollFrontOfficer("strength"),
      };
    }
  }
}
// Tenure tick at season start — also handles contract expiry → replacement.
function _tickFrontOfficeTenure() {
  if (!franchise.frontOffice) return;
  for (const t of TEAMS) {
    const fo = franchise.frontOffice[t.id];
    if (!fo) continue;
    for (const role of ["gm", "scout", "trainer", "strength"]) {
      const p = fo[role];
      if (!p) { fo[role] = _rollFrontOfficer(role); continue; }
      p.yearsWithTeam = (p.yearsWithTeam || 0) + 1;
      p.age = (p.age || 45) + 1;
      p.contractYears = (p.contractYears || 1) - 1;
      // Contract expired — coin-flip on extension, otherwise hire fresh.
      if (p.contractYears <= 0) {
        const keepProb = clamp(0.35 + (p.rating - 60) / 100, 0.20, 0.85);
        if (Math.random() < keepProb) {
          p.contractYears = 2 + Math.floor(Math.random() * 3);
        } else {
          fo[role] = _rollFrontOfficer(role);
        }
      }
      // Retirement at age 70 — replaced by a fresh hire.
      if (p.age >= 70) fo[role] = _rollFrontOfficer(role);
    }
  }
}
// Effect helpers — applied at use sites.
function _foInjuryMul(teamId) {
  const trainer = franchise.frontOffice?.[teamId]?.trainer;
  if (!trainer) return 1.0;
  // Linear mapping: rating 50 → 1.0, rating 99 → 0.78 (-22%).
  const ratingMul = 1 - (Math.max(50, trainer.rating || 50) - 50) / 220;
  return Math.max(0.65, ratingMul);
}
function _foScoutBiasMul(teamId) {
  const scout = franchise.frontOffice?.[teamId]?.scout;
  if (!scout) return 1.0;
  // Elite scout (99) halves the random bias on prospects (= more accurate
  // tier reads). Low-rated scout (50) leaves bias as-is.
  return Math.max(0.45, 1 - (Math.max(50, scout.rating || 50) - 50) / 100);
}
function _foDevBoost(teamId, p) {
  const sc = franchise.frontOffice?.[teamId]?.strength;
  if (!sc) return 0;
  // +0.1 OVR per yr at rating 50, +0.6 at rating 99. Trait bias picks
  // who benefits the most.
  const base = (Math.max(50, sc.rating || 50) - 50) / 100;
  if (sc.trait === "Mass Builder"  && ["OL", "DL"].includes(p?.position))   return base * 0.7;
  if (sc.trait === "Speed Lab"     && ["WR", "RB", "CB", "S"].includes(p?.position)) return base * 0.7;
  if (sc.trait === "Late Bloomer"  && (p?.age || 25) >= 25 && (p?.age || 0) <= 29) return base * 0.6;
  return base * 0.4;
}

// Migration: add missing oc/dc/positionStaff to existing saves.
// Also maps old single-trait HC to the new cultureTrait / specialtyTrait fields.
function _backfillCoachingStaff() {
  if (!franchise || !franchise.coaches) return;
  const traitMap = {
    "Hard-Ass":            { culture: "Disciplinarian",  specialty: null },
    "Players' Coach":      { culture: "Players' Coach",  specialty: null },
    "Offensive Guru":      { culture: "Business-Like",   specialty: "Offensive Minded" },
    "Defensive Mastermind":{ culture: "Business-Like",   specialty: "Defensive Minded" },
    "Player Developer":    { culture: "Business-Like",   specialty: "Player Developer" },
  };
  // One-time migration: give every coach a structured contract (signing
  // bonus, baseSalaries, escalators). Coaches signed before Tier 3 only
  // had a flat .salary + .contractYears.
  const _migrateContract = (coach, role) => {
    if (!coach) return;
    if (coach.baseSalaries && coach.escalators) return; // already migrated
    const aav   = coach.salary || (role === "hc" ? 4 : 2);
    const years = Math.max(1, coach.contractYears || (role === "hc" ? 3 : 2));
    // Backdate a signing bonus equal to ~1 year of AAV * proration tier.
    // Keeps cap impact stable (base = aav − proration ≈ same as old flat).
    const sb = +(aav * Math.min(years, 5) * (COACH_SB_PCT[role] || 0.2)).toFixed(1);
    _coachApplyContract(coach, aav, years, sb, role);
  };
  for (const t of TEAMS) {
    const staff = franchise.coaches[t.id];
    if (!staff) { franchise.coaches[t.id] = { hc: _rollCoach(), oc: _rollOC(), dc: _rollDC(), positionStaff: [] }; continue; }
    // Backfill HC new fields
    const hc = staff.hc;
    if (hc) {
      if (!hc.cultureTrait || !hc.specialtyTrait) {
        const mapped = traitMap[hc.trait] || { culture: "Business-Like", specialty: null };
        if (!hc.cultureTrait)   hc.cultureTrait   = mapped.culture;
        if (!hc.specialtyTrait) hc.specialtyTrait = mapped.specialty || HC_SPECIALTY_TRAITS[Math.floor(Math.random() * HC_SPECIALTY_TRAITS.length)].key;
      }
      if (hc.rating == null) hc.rating = 55 + Math.floor(Math.random() * 30);
      if (hc.salary == null) hc.salary = +(2 + (hc.rating - 45) * 0.18 + Math.random() * 1.5).toFixed(1);
      if (hc.contractYears == null) hc.contractYears = 2 + Math.floor(Math.random() * 3);
      _migrateContract(hc, "hc");
      // MFF Slice G: analytics-aggressiveness trait (0-100). How much this
      // coach trusts the NFL-analytics 4th-down + 2pt chart vs traditional
      // by-the-book rules. Derived from specialtyTrait so old saves get a
      // sensible value: Riverboat Gambler trends high, Conservative low.
      // Random ±10 keeps within-trait coaches distinct.
      if (hc.analyticsAgg == null) {
        const base = hc.specialtyTrait === "Riverboat Gambler" ? 80
                   : hc.specialtyTrait === "Conservative"      ? 15
                   : hc.specialtyTrait === "Game Manager"      ? 45
                   : hc.specialtyTrait === "Offensive Minded"  ? 55
                   : hc.specialtyTrait === "Defensive Minded"  ? 35
                   : hc.specialtyTrait === "Player Developer"  ? 50
                   :                                              50;
        hc.analyticsAgg = Math.max(0, Math.min(100, Math.round(base + (Math.random() - 0.5) * 20)));
      }
    }
    if (!staff.oc) staff.oc = _rollOC();
    else _migrateContract(staff.oc, "oc");
    if (!staff.dc) staff.dc = _rollDC();
    else _migrateContract(staff.dc, "dc");
    if (!staff.stc) staff.stc = _rollSTC();
    else _migrateContract(staff.stc, "dc");
    if (!staff.positionStaff) {
      const groups = [...POSITION_COACH_GROUPS].sort(() => Math.random() - 0.5).slice(0, 2);
      staff.positionStaff = groups.map(g => _rollPositionCoach(g));
    }
  }
}

// Total coaching salary spend for a team (display only — separate from player cap).
// Cap hit per coach = base salary (this year) + bonus proration, mirroring
// player contracts. Dead-cap refunds from prior firings and one-shot
// performance escalators also count against the coaching budget.
function coachingBudgetUsed(teamId) {
  const c = franchise.coaches?.[teamId];
  if (!c) return 0;
  let total = _coachCapHit(c.hc) + _coachCapHit(c.oc) + _coachCapHit(c.dc);
  for (const ps of (c.positionStaff || [])) total += ps.salary || 0;
  for (const r of (franchise.refunds || [])) {
    if (r.yearsRemaining > 0 && r.fromTeamId === teamId &&
        (r.kind === "coach_dead_cap" || r.kind === "coach_escalator")) {
      total += r.amount || 0;
    }
  }
  return +total.toFixed(2);
}

// Dollars by which a team's coaching spend exceeds the $15M hard line,
// doubled to reflect the player-cap hit. $0 when under the line.
function coachingCapPenalty(teamId) {
  const overage = Math.max(0, coachingBudgetUsed(teamId) - 15);
  return +(overage * 2).toFixed(1);
}

// Player salary cap adjusted downward by any coaching overspend penalty.
// Floored at $150M so extreme coaching spend can't make the cap unworkable.
function effectiveSalaryCap(teamId) {
  return Math.max(150, (franchise.salaryCap || SALARY_CAP_BASE) - coachingCapPenalty(teamId));
}

// Returns the fair-market salary for a coach at their current rating.
function _marketSalaryForCoach(coach, type) {
  const r = coach?.rating || 60;
  if (type === "hc") return +(2 + Math.max(0, r - 45) * 0.18 + 0.5).toFixed(1);
  return +(1 + Math.max(0, r - 40) * 0.06 + 0.3).toFixed(1);
}

// Renew a coach at fair market rate with a default new contract length.
// Loyalty discount multiplies AAV (e.g. 0.87 for "hometown").
function _renewCoachAtMarket(coach, role, loyaltyMul) {
  if (!coach) return;
  const mul = loyaltyMul || 1.0;
  const aav = +(_marketSalaryForCoach(coach, role) * mul).toFixed(1);
  const years = role === "hc" ? (3 + Math.floor(Math.random() * 2))
                              : (2 + Math.floor(Math.random() * 2));
  const sb = +(aav * years * (COACH_SB_PCT[role] || 0.18) * (0.7 + Math.random() * 0.6)).toFixed(1);
  _coachApplyContract(coach, aav, years, sb, role);
}

// Push a departing coach into the FA pool for the next offseason market.
function _coachFAAdd(coach, type) {
  if (!coach || !franchise) return;
  if (!franchise._coachFA) franchise._coachFA = [];
  if (franchise._coachFA.some(c => c.name === coach.name && c.type === type)) return;
  franchise._coachFA.push({ ...coach, type, _faSeason: franchise.season || 1 });
}

// Book a coach's dead cap against the firing team. Prorated bonus hits the
// coaching budget over the remaining years of the original contract (NFL
// "June 1" style is overkill here — we just spread it linearly).
function _bookCoachDeadCap(teamId, coach, role) {
  if (!franchise || !coach || !teamId) return 0;
  const dead = _coachDeadCapOnFire(coach);
  if (dead <= 0) return 0;
  const yrs = Math.max(1, coach.contractYears || 1);
  const perYr = +(dead / yrs).toFixed(2);
  if (!franchise.refunds) franchise.refunds = [];
  franchise.refunds.push({
    kind: "coach_dead_cap",
    label: `Coach dead cap (${role?.toUpperCase()||"COACH"}): ${coach.name}`,
    fromTeamId: teamId,
    toTeamId: null,
    amount: perYr,
    yearsRemaining: yrs,
  });
  return dead;
}

// Dev penalty for exceeding the coaching budget ($15M soft, $18M hard).
function _coachBudgetPenaltyMul(teamId) {
  const used = coachingBudgetUsed(teamId);
  if (used <= 15) return 1.0;
  if (used <= 18) return 0.90;
  return 0.80;
}

// Convert a retired player stub into a coach market candidate.
// Returns null if the position doesn't map to a coordinator role.
function _retiredPlayerToCoach(rp, currentSeason) {
  const pos = rp.pos;
  if (!pos || ["K","P"].includes(pos)) return null;
  const yearsOut = (currentSeason || 1) - (rp.retiredSeason || 1);
  const growthBonus = Math.min(yearsOut - 2, 5) * 0.8;
  const raw = (rp.peakOvr || 70) * 0.35 + (rp.retirementOvr || 65) * 0.25
            + (rp.awr || 70) * 0.40 + growthBonus + (Math.random() * 8 - 4);
  const rating = Math.max(40, Math.min(79, Math.round(raw * 0.82)));
  let type, trait, specialtyTrait, cultureTrait;
  if (pos === "QB") {
    type = Math.random() < 0.65 ? "oc" : "hc";
    trait = rp.archetype === "SCRAMBLER" ? "Balanced" : Math.random() < 0.5 ? "QB Whisperer" : "Air Attack";
  } else if (pos === "OL") {
    type = "oc"; trait = "Trench General";
  } else if (pos === "RB") {
    type = "oc"; trait = "Run Architect";
  } else if (pos === "WR") {
    type = "oc"; trait = Math.random() < 0.5 ? "Air Attack" : "Red Zone Genius";
  } else if (pos === "TE") {
    type = "oc"; trait = Math.random() < 0.5 ? "Red Zone Genius" : "Balanced";
  } else if (pos === "DL") {
    type = "dc"; trait = Math.random() < 0.6 ? "Pressure Package" : "Run Stopper";
  } else if (pos === "LB") {
    type = "dc"; trait = Math.random() < 0.5 ? "Run Stopper" : "Pressure Package";
  } else if (pos === "CB") {
    type = "dc"; trait = Math.random() < 0.5 ? "Cover Scheme" : "Ball Hawk";
  } else if (pos === "S") {
    type = "dc"; trait = Math.random() < 0.5 ? "Ball Hawk" : "Cover Scheme";
  } else {
    return null;
  }
  if (type === "hc") {
    specialtyTrait = "Player Developer";
    cultureTrait = HC_CULTURE_TRAITS[Math.floor(Math.random() * HC_CULTURE_TRAITS.length)].key;
  }
  const salary = _marketSalaryForCoach({ rating }, type);
  return {
    type, name: rp.name, rating,
    trait: type !== "hc" ? trait : undefined,
    specialtyTrait: type === "hc" ? specialtyTrait : undefined,
    cultureTrait:   type === "hc" ? cultureTrait   : undefined,
    age: (rp.retiredAge || 33) + yearsOut,
    salary, contractYears: 2 + Math.floor(Math.random() * 2), yearsWithTeam: 0,
    record: type === "hc" ? { w:0, l:0, championships:0 } : undefined,
    isFormerPlayer: true, formerPos: pos,
    formerTeamId: rp.formerTeamId, formerTeamName: rp.formerTeamName,
    proBowls: rp.proBowls || 0, allPros: rp.allPros || 0, sbRings: rp.sbRings || 0,
    peakOvr: rp.peakOvr, pid: rp.pid,
    careerStatLine: rp.careerStatLine || "", careerYears: rp.careerYears || 0,
  };
}

// ── Practice squad helpers ───────────────────────────────────────────────────
// Eligibility rule: ≤PS_MAX_YEARS_EXP years in league AND ≤PS_MAX_AGE old.
function _psEligible(p) {
  if (!p) return false;
  const yrs = _yearsInLeague(p);
  return yrs <= PS_MAX_YEARS_EXP && (p.age || 22) <= PS_MAX_AGE;
}
// PS cap cost (separate from active roster AAVs).
function psCostForTeam(teamId) {
  const ps = franchise?.practiceSquads?.[teamId] || [];
  // Cap-relative slot cost (≈$0.5M at the $200M base) so PS load doesn't decay
  // to a rounding error as the cap inflates over a long franchise.
  const slot = _capRef() * _PS_SLOT_FRAC;
  return Math.round(ps.length * slot * 10) / 10;
}
// Build initial PS rosters from each team's bench (low-OVR young
// players who aren't starters). Called at franchise creation; gives
// AI teams plausible PS depth without changing the active roster.
function _seedPracticeSquads() {
  if (!franchise.practiceSquads) franchise.practiceSquads = {};
  // Position floors — never poach a player off the active roster if doing
  // so would drop the team below this count. Audit found teams ending up
  // with 0 kickers when the starter K had OVR<72, so the floor is 1 for
  // every single-roster-slot specialty position. Skill/depth positions
  // get a floor matching their spec minus 2 (one starter + one backup).
  const FLOORS = { QB: 2, K: 1, P: 1, TE: 2, RB: 2, WR: 4, OL: 7, DL: 5, LB: 4, CB: 4, S: 3 };
  for (const t of TEAMS) {
    if (franchise.practiceSquads[t.id]?.length) continue;
    const roster = (franchise.rosters[t.id] || []).slice();
    // Find young low-OVR players to seed the PS — by design these are
    // raw prospects who didn't make the active roster cut.
    const candidates = roster
      .filter(p => _psEligible(p) && (p.overall || 0) < 72)
      .sort((a, b) => (a.overall || 0) - (b.overall || 0));
    const ps = [];
    // Live count of active-roster players per position. Decrements as
    // candidates are poached so a position can't be drained below floor.
    const counts = {};
    for (const p of roster) counts[p.position] = (counts[p.position] || 0) + 1;
    for (let i = 0; i < candidates.length && ps.length < PS_SLOTS; i++) {
      const p = candidates[i];
      const floor = FLOORS[p.position] ?? 0;
      if ((counts[p.position] || 0) <= floor) continue;  // would drop below floor — skip
      // Move them off the active roster onto PS.
      const idx = roster.indexOf(p);
      if (idx !== -1) roster.splice(idx, 1);
      counts[p.position] = (counts[p.position] || 0) - 1;
      // Stamp PS metadata for the flash log + cap math.
      p._psFlashLog = [];
      p._psStashedSeason = franchise.season || 1;
      ps.push(p);
    }
    franchise.practiceSquads[t.id] = ps;
    franchise.rosters[t.id] = roster;
  }
}
// Tick down scouted-info expirations (intel lasts a season). Called
// at offseason boundary.
function _expireScoutingIntel() {
  if (!franchise.scoutedPS) franchise.scoutedPS = {};
  for (const name of Object.keys(franchise.scoutedPS)) {
    const info = franchise.scoutedPS[name];
    if (info.season !== franchise.season) delete franchise.scoutedPS[name];
  }
}
// Reset weekly scout visits at advance-week.
function _resetWeeklyScoutVisits() {
  franchise.scoutVisits = franchise.scoutVisits || {};
  franchise.scoutVisits[franchise.chosenTeamId] = {
    week: franchise.week, used: 0, max: SCOUT_VISITS_PER_WEEK,
  };
}
function _scoutVisitsRemaining(teamId) {
  const v = franchise.scoutVisits?.[teamId];
  if (!v || v.week !== franchise.week) return SCOUT_VISITS_PER_WEEK;
  return Math.max(0, (v.max || SCOUT_VISITS_PER_WEEK) - (v.used || 0));
}
function _consumeScoutVisit(teamId) {
  const v = franchise.scoutVisits = franchise.scoutVisits || {};
  if (!v[teamId] || v[teamId].week !== franchise.week) {
    v[teamId] = { week: franchise.week, used: 0, max: SCOUT_VISITS_PER_WEEK };
  }
  v[teamId].used += 1;
}
// Weekly flash roll for every PS player on every team. Splits into
// three tiers and stamps the flash log + emits wire alerts. The
// poach pass uses the flash count to weight rival interest.
function _psWeeklyFlashRoll() {
  const myId = Number(franchise.chosenTeamId);
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const tId = Number(tIdStr);
    const team = getTeam(tId);
    for (const p of ps) {
      if (!p) continue;
      const r = Math.random();
      let kind = null, ovrBoost = 0;
      if (r < PS_FLASH_PROBS.gem) {
        kind = "gem";
        ovrBoost = 8 + Math.floor(Math.random() * 4);
      } else if (r < PS_FLASH_PROBS.gem + PS_FLASH_PROBS.wow) {
        kind = "wow";
        ovrBoost = 3 + Math.floor(Math.random() * 3);
      } else if (r < PS_FLASH_PROBS.gem + PS_FLASH_PROBS.wow + PS_FLASH_PROBS.small) {
        kind = "small";
        ovrBoost = Math.random() < 0.5 ? 1 : 0;
      }
      if (!kind) continue;
      p.overall = Math.min(99, (p.overall || 50) + ovrBoost);
      p._psFlashLog = p._psFlashLog || [];
      p._psFlashLog.push({ week: franchise.week, season: franchise.season, kind, ovrBoost });
      if (p._psFlashLog.length > 12) p._psFlashLog = p._psFlashLog.slice(-12);
      // Wire alert: only big flashes hit the wire (otherwise it's noise).
      if (kind === "gem") {
        const isMine = tId === myId;
        if (isMine) {
          _pushNews({ type:"ps_gem",
            label: `💎 PRACTICE SQUAD GEM: ${p.position} ${p.name} (${p.overall} OVR) — could push for active reps soon` });
        } else {
          // Only league-wide news if we've scouted them (otherwise it's not
          // visible to us in-fiction).
          const intel = franchise.scoutedPS?.[p.name];
          if (intel && intel.byTeamId === myId) {
            _pushNews({ type:"ps_gem",
              label: `💎 ${team?.name} PS gem ${p.position} ${p.name} — grading way up after this week's flash` });
          }
        }
      } else if (kind === "wow") {
        const isMine = tId === myId;
        if (isMine) {
          _pushNews({ type:"ps_flash",
            label: `⭐ Your PS ${p.position} ${p.name} burning starters in practice (+${ovrBoost} OVR)` });
        }
      }
    }
  }
}
// AI poach pass: any team that has scouted a rival's gem can attempt
// to sign him directly to their active roster, forcing the original
// team to either promote (within 1 week) or lose him.
function _psPoachPass() {
  franchise.psPoachAlerts = franchise.psPoachAlerts || [];
  const myId = Number(franchise.chosenTeamId);
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const ownerId = Number(tIdStr);
    if (ownerId === myId) {
      // Only build alerts on the USER's PS (otherwise spam). AI
      // teams quietly handle rival poaches by promoting their gems.
      for (const p of ps) {
        const hasFlashed = (p._psFlashLog || []).some(f =>
          f.season === franchise.season && (f.kind === "wow" || f.kind === "gem"));
        if (!hasFlashed) continue;
        if ((p.overall || 50) < 70) continue;
        // Roll for rival interest — weighted by need at position
        for (const t of TEAMS) {
          if (t.id === ownerId) continue;
          // Skip teams without a positional need
          const myStarters = (franchise.rosters[t.id] || [])
            .filter(rp => rp.position === p.position);
          const topOvr = myStarters[0]?.overall || 50;
          if (topOvr >= 80) continue;
          const chance = 0.04 + Math.max(0, (75 - topOvr)) * 0.005;
          if (Math.random() >= chance) continue;
          // Existing pending alert? Skip dupes.
          if (franchise.psPoachAlerts.some(a => a.playerName === p.name && a.deadlineWeek > franchise.week)) continue;
          franchise.psPoachAlerts.push({
            playerName: p.name, position: p.position,
            ownerTeamId: ownerId, suitorTeamId: t.id,
            deadlineWeek: franchise.week + 1,
            ovrSnapshot: p.overall,
          });
          _pushNews({ type:"ps_poach",
            label: `⚠️ ${t.name} interested in your PS ${p.position} ${p.name} — promote by end of week ${franchise.week + 1} or lose him` });
          break;  // one alert per gem
        }
      }
    } else {
      // AI side — silently promote their own gems if a rival is sniffing.
      for (const p of ps.slice()) {
        const isGem = (p.overall || 50) >= 78 && (p._psFlashLog || []).some(f =>
          (f.kind === "wow" || f.kind === "gem"));
        if (!isGem) continue;
        if (Math.random() < 0.25) {
          _psPromote(ownerId, p, { silent: true });
        }
      }
    }
  }
  // Expire stale alerts
  franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.deadlineWeek >= franchise.week);
  // If user's alert deadline has passed without promotion, the player walks.
  for (const a of franchise.psPoachAlerts.slice()) {
    if (a.deadlineWeek < franchise.week) {
      // Sign him to the suitor's roster on a minimum deal
      const ps = franchise.practiceSquads[a.ownerTeamId] || [];
      const idx = ps.findIndex(p => p.name === a.playerName);
      if (idx !== -1) {
        const player = ps.splice(idx, 1)[0];
        player.contract = { years: 2, remaining: 2, aav: 1.0,
          guaranteedYears: 1, guaranteedAAV: 1.0, signedAav: 1.0,
          startSeason: (franchise.season || 1),
          signedOvr: player.overall || 65 };
        if (typeof _clearGrudgeFlags === "function") _clearGrudgeFlags(player);
        (franchise.rosters[a.suitorTeamId] || []).push(player);
        _pushNews({ type:"ps_lost",
          label: `❌ Lost ${player.position} ${player.name} — signed by ${getTeam(a.suitorTeamId)?.name} off your PS` });
      }
    }
  }
  franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.deadlineWeek >= franchise.week);
}
// Promote a PS player to the active roster.
function _psPromote(teamId, player, opts = {}) {
  const ps = franchise.practiceSquads[teamId] || [];
  const idx = ps.indexOf(player);
  if (idx === -1) return false;
  ps.splice(idx, 1);
  // Sign to a 2-year minimum deal — user can extend later via re-sign flow.
  player.contract = {
    years: 2, remaining: 2, aav: 1.0,
    guaranteedYears: 1, guaranteedAAV: 1.0,
    signedAav: 1.0,
    startSeason: (franchise.season || 1),
    signedOvr: player.overall || 65,
  };
  delete player._psFlashLog; delete player._psStashedSeason;
  (franchise.rosters[teamId] || []).push(player);
  // Cancel any pending poach alert for this player.
  if (franchise.psPoachAlerts) {
    franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.playerName !== player.name);
  }
  if (!opts.silent) {
    const team = getTeam(teamId);
    _pushNews({ type:"ps_promote",
      label: `⬆️ Promoted ${player.position} ${player.name} to ${team?.name || "active"} roster` });
  }
  return true;
}
// Scout a rival PS player — reveals potential and tightens grade noise.
function _psScout(scoutingTeamId, playerName) {
  if (_scoutVisitsRemaining(scoutingTeamId) <= 0) return false;
  _consumeScoutVisit(scoutingTeamId);
  franchise.scoutedPS = franchise.scoutedPS || {};
  franchise.scoutedPS[playerName] = {
    byTeamId: scoutingTeamId,
    season: franchise.season,
    week: franchise.week,
    fidelity: "standard",
  };
  return true;
}
// Auto-spend unused visits when the user advances the week. Picks the
// most flash-y, highest-rated unscouted rival PS players first.
function _psAutoSpendVisits() {
  const myId = Number(franchise.chosenTeamId);
  let remaining = _scoutVisitsRemaining(myId);
  if (remaining <= 0) return 0;
  const targets = [];
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const tId = Number(tIdStr);
    if (tId === myId) continue;
    for (const p of ps) {
      if (franchise.scoutedPS?.[p.name]) continue;
      const flashCount = (p._psFlashLog || [])
        .filter(f => f.kind === "wow" || f.kind === "gem").length;
      const score = (p.overall || 50) + flashCount * 10;
      targets.push({ p, score });
    }
  }
  targets.sort((a, b) => b.score - a.score);
  let scouted = 0;
  for (let i = 0; i < remaining && i < targets.length; i++) {
    if (_psScout(myId, targets[i].p.name)) scouted++;
  }
  if (scouted > 0) {
    _pushNews({ type:"ps_scout",
      label: `🔍 Auto-scouted ${scouted} PS player${scouted === 1 ? "" : "s"} this week` });
  }
  return scouted;
}

let franchise = null;
// Temporary "draft" league generated when the user clicks New Game.
// Lets the team picker show real per-team data (ratings, scout
// bullets, depth charts) before they commit to a team. Cleared once
// they pick or start fresh.
let franchiseDraft = null;

// ── Persistence ──────────────────────────────────────────────────────────────
// ── Save slots ────────────────────────────────────────────────────────────────
// Multiple named franchises. Slot metadata (id, name, timestamp, summary)
// lives at FRANCHISE_SLOTS_KEY; each slot's actual data lives at
// gc_franchise_v1_slot_<id>. The original single-save key is migrated to
// slot 1 the first time a multi-slot session sees it.
const FRANCHISE_SLOTS_KEY = "gc_franchise_slots_v1";

function _readSlotsMeta() {
  try {
    return JSON.parse(localStorage.getItem(FRANCHISE_SLOTS_KEY))
      || { slots: [], activeSlotId: null };
  } catch { return { slots: [], activeSlotId: null }; }
}
function _writeSlotsMeta(meta) {
  try { localStorage.setItem(FRANCHISE_SLOTS_KEY, JSON.stringify(meta)); } catch {}
}
function _slotDataKey(id) { return `gc_franchise_v1_slot_${id}`; }

// Backfill TEC (stats[11]) and _awrCeiling on players from saves that predate
// the technique stat. Estimates from flavor + archetype so saves stay coherent.
function _backfillTEC() {
  if (!franchise) return;
  const highTecArchs = new Set(["TECHNICIAN","FIELD_GENERAL","GAME_MANAGER","ROUTE_RUNNER",
    "SHUTDOWN","SLOT_CB","COVER","BOX","BLOCKING","POSSESSION","SLOT","WORKHORSE",
    "RECEIVING","ANCHOR"]);
  const lowTecArchs = new Set(["POWER","SPEED","THUMPER","RED_ZONE","GUNSLINGER",
    "DUAL_THREAT","PHYSICAL","PENETRATOR"]);
  const stamp = p => {
    if (!p.stats) return;
    while (p.stats.length < 12) p.stats.push(68);
    // Only backfill — don't overwrite if already explicitly set (not the placeholder 68)
    if (p.stats[11] !== 68 && p.stats[11] != null) {
      if (p._awrCeiling == null) {
        p._awrCeiling = p.flavor === "HIGH_FOOTBALL_IQ" ? 88
                      : p.flavor === "RAW_ATHLETE"       ? 63 : 73;
      }
      return;
    }
    const fl = p.flavor;
    if      (fl === "RAW_ATHLETE")       p.stats[11] = 72;
    else if (fl === "HIGH_FOOTBALL_IQ")  p.stats[11] = 58;
    else if (highTecArchs.has(p.archetype)) p.stats[11] = 75;
    else if (lowTecArchs.has(p.archetype))  p.stats[11] = 63;
    else p.stats[11] = 68;
    if (p._awrCeiling == null) {
      p._awrCeiling = fl === "HIGH_FOOTBALL_IQ" ? 88
                    : fl === "RAW_ATHLETE"       ? 63 : 73;
    }
    if (p.position) p.overall = calcOverall(p.position, p.stats);
  };
  for (const roster of Object.values(franchise.rosters || {})) roster.forEach(stamp);
  for (const squad  of Object.values(franchise.practiceSquads || {})) squad.forEach(stamp);
  (franchise.freeAgents || []).forEach(stamp);
}

// Backfill coachable onto legacy saves that predate the tag.
function _backfillCoachable() {
  if (!franchise) return;
  const stamp = p => {
    if (p.coachable != null) return;
    const fl = p.flavor;
    p.coachable = Math.random() < (fl === "HIGH_FOOTBALL_IQ" ? 0.45 : fl === "RAW_ATHLETE" ? 0.10 : 0.25);
  };
  for (const roster of Object.values(franchise.rosters || {})) roster.forEach(stamp);
  for (const squad  of Object.values(franchise.practiceSquads || {})) squad.forEach(stamp);
  (franchise.freeAgents || []).forEach(stamp);
}

// Backfill physical peak ages onto legacy saves that predate the system.
function _backfillPhysicalPeak() {
  if (!franchise) return;
  const stamp = p => {
    if (p._physicalPeak) return;
    const fl = p.flavor;
    if (fl === "RAW_ATHLETE") {
      p._physicalPeak = { spd:{peak:23,onset:26}, agi:{peak:24,onset:27}, str:{peak:26,onset:29} };
    } else if (fl === "HIGH_FOOTBALL_IQ") {
      p._physicalPeak = { spd:{peak:27,onset:30}, agi:{peak:28,onset:31}, str:{peak:29,onset:33} };
    } else {
      p._physicalPeak = { spd:{peak:25,onset:28}, agi:{peak:26,onset:29}, str:{peak:28,onset:31} };
    }
  };
  for (const roster of Object.values(franchise.rosters || {})) roster.forEach(stamp);
  for (const squad  of Object.values(franchise.practiceSquads || {})) squad.forEach(stamp);
  (franchise.freeAgents || []).forEach(stamp);
}

// ── Depth Chart & Snap Shares ────────────────────────────────────────────────

// Compute optimal starterPct for one slot given starter + backup + rule.
function _computeOptimalPct(starter, backup, snapFloor, snapCeil) {
  const floor = snapFloor ?? 35;
  const ceil  = snapCeil  ?? 98;
  if (!starter) return { starterPct: ceil, manual: false };
  const sOvr    = starter.overall ?? 60;
  const bOvr    = backup?.overall ?? 55;
  const stamina = starter._stamina ?? 75;
  const age     = starter.age ?? 25;
  let base = 60 + (sOvr - bOvr) * 0.6;
  if      (stamina < 55) base = Math.min(base, 52);
  else if (stamina < 65) base = Math.min(base, 62);
  if      (age >= 36)    base -= 10;
  else if (age >= 33)    base -= 5;
  return { starterPct: Math.round(Math.min(ceil, Math.max(floor, base))), manual: false };
}

// Build a fresh depth chart + snap shares for one team from their current roster.
// Sorts each position group by overall descending, fills slots in order, marks
// any player not placed as Unassigned (not in depthChart at all).
// Pure compute: returns { dc, ss } for the given team's auto-by-OVR chart
// without mutating franchise state. Used by both _initDepthChart (apply)
// and the depth chart UI's "would-change" preview / misplaced highlight.
// Slot-specific stat weighting for auto-depth-chart assignment.
// Without this, all OL players just sort by OVR and the highest-OVR
// OL always lands at LT (even if his stat profile screams "Center").
// Same problem at DL — interior vs edge are different skill sets.
// The stat array index order is:
//   [0]spd  [1]str  [2]agi  [3]awr  [4]thr  [5]cat
//   [6]blk  [7]prs  [8]cov  [9]tck  [10]kpw
const _SLOT_FIT_WEIGHTS = {
  // OL slots — each gets a different stat mix
  LT:  { weights: { 2:.30, 6:.30, 7:.30, 1:.10 }, label: "Pass-protector" },
  LG:  { weights: { 6:.45, 1:.40, 3:.15 },        label: "Interior power" },
  C:   { weights: { 3:.30, 6:.40, 1:.20, 2:.10 }, label: "Snap + IQ" },
  RG:  { weights: { 6:.45, 1:.40, 3:.15 },        label: "Interior power" },
  RT:  { weights: { 6:.35, 1:.30, 7:.25, 2:.10 }, label: "Balanced T/G" },
  // DL slots — DL1/DL4 are edge (pass-rush), DL2/DL3 are interior (run-stop)
  DL1: { weights: { 7:.40, 0:.30, 2:.15, 1:.15 }, label: "Edge rusher" },
  DL2: { weights: { 1:.40, 9:.30, 6:.10, 7:.20 }, label: "Interior DT" },
  DL3: { weights: { 1:.40, 9:.30, 6:.10, 7:.20 }, label: "Interior DT" },
  DL4: { weights: { 7:.40, 0:.30, 2:.15, 1:.15 }, label: "Edge rusher" },
  // Goal-line extras — interior run-stop heavy
  DL5: { weights: { 1:.50, 9:.30, 6:.20 },        label: "GL nose tackle" },
  DL6: { weights: { 1:.50, 9:.30, 6:.20 },        label: "GL run-stuffer" },
  // Dime corner — slot coverage specialist
  NB2: { weights: { 8:.45, 2:.30, 0:.25 },        label: "Dime slot CB" },
};

// Archetypes that naturally fit each depth chart slot.
// Used to bias the auto-depth-chart toward players whose archetype
// matches the slot's intended role (e.g., SLOT_CB at the NB slot,
// SPEED DL at edge slots, MAULER OL at interior guard slots).
// The game's archetype system already exists — this just wires it
// into the depth chart's auto-fit logic.
//
// IMPORTANT: every slot referenced by PERSONNEL_PACKAGES MUST have an
// entry here (even an empty array). The PACKAGES tab computes "scheme
// fit %" by dividing archetype matches by filled slots; a missing
// entry silently lowers the package's fit % since `fit.includes(...)`
// returns false. If you add a new slot to a package, add it here.
const SLOT_ARCHETYPE_FIT = {
  // QB — no strong preference; all archetypes can start
  // RB
  RB1: ["WORKHORSE","ELUSIVE","POWER"],
  RB2: ["RECEIVING","SPEED","ELUSIVE"],
  // WR — outside vs slot distinction
  WR1: ["DEEP_THREAT","ROUTE_RUNNER","RED_ZONE"],
  WR2: ["POSSESSION","ROUTE_RUNNER","RED_ZONE"],
  WR3: ["SLOT","ROUTE_RUNNER"],
  WR4: ["DEEP_THREAT","POSSESSION","SLOT","ROUTE_RUNNER","RED_ZONE"],
  // TE
  TE1: ["RECEIVING","HYBRID"],
  TE2: ["BLOCKING","HYBRID"],
  // OL
  LT:  ["ATHLETIC","TECHNICIAN"],
  LG:  ["ANCHOR","MAULER","PLUG"],
  C:   ["TECHNICIAN","ANCHOR"],
  RG:  ["ANCHOR","MAULER","PLUG"],
  RT:  ["MAULER","TECHNICIAN","ATHLETIC"],
  // DL — edges (DL1/4) want pass-rush archetypes, interior (DL2/3) want power
  DL1: ["SPEED","PENETRATOR","TWEENER"],
  DL2: ["POWER","TECHNICIAN"],
  DL3: ["POWER","TECHNICIAN"],
  DL4: ["SPEED","PENETRATOR","TWEENER"],
  DL5: ["POWER","TECHNICIAN"],  // GL run-stuffers
  DL6: ["POWER","TECHNICIAN"],
  // LB
  LB1: ["SIGNAL","THUMPER","HYBRID"],
  LB2: ["COVER","HYBRID","SIGNAL"],
  LB3: ["BLITZER","THUMPER","HYBRID"],
  // CB — boundary vs slot/nickel
  CB1: ["SHUTDOWN","BALL_HAWK"],
  CB2: ["SHUTDOWN","PHYSICAL","ZONE"],
  NB:  ["SLOT_CB"],
  NB2: ["SLOT_CB","ZONE"],
  // S — strong vs free
  SS:  ["BOX","HYBRID"],
  FS:  ["BALL_HAWK","CENTER_FIELD","HYBRID"],
};

// Returns true if the player's archetype is a "natural fit" for the slot.
// Used by UI badges and the auto-fit score boost.
function _slotFitsArchetype(player, slotKey) {
  if (!player?.archetype) return false;
  const fit = SLOT_ARCHETYPE_FIT[slotKey];
  return !!(fit && fit.includes(player.archetype));
}

// Slot fit score for a player — combines OVR (baseline), slot-specific
// stat weighting (specialization), and archetype match (scheme fit).
//   OVR        : 55% weight — a great player should usually win
//   stat spec  : 35% weight — slot-relevant stats break ties
//   archetype  : +5 bonus   — natural archetype match (≈ 5 OVR worth)
// So a 78-OVR archetype-matched player beats an 80-OVR mismatched one,
// but a 70 doesn't beat an 80 just from archetype match.
function _slotFitScore(player, slotKey) {
  const ovr = player.overall || 60;
  const spec = _SLOT_FIT_WEIGHTS[slotKey];
  const archBonus = _slotFitsArchetype(player, slotKey) ? 5 : 0;

  if (!spec) {
    // No stat-spec for this slot — pure OVR + archetype bonus
    return ovr + archBonus;
  }
  const stats = player.stats || [];
  let weighted = 0;
  let totalW = 0;
  for (const [idx, w] of Object.entries(spec.weights)) {
    weighted += (stats[Number(idx)] ?? 50) * w;
    totalW += w;
  }
  const fit = totalW > 0 ? weighted / totalW : 50;
  return ovr * 0.55 + fit * 0.35 + archBonus;
}

function _computeAutoDepthChart(teamId) {
  const roster = franchise.rosters[teamId] || [];
  const byPos = {};
  for (const p of roster) {
    if (!byPos[p.position]) byPos[p.position] = [];
    byPos[p.position].push(p);
  }
  for (const grp of Object.values(byPos)) grp.sort((a,b) => (b.overall||60) - (a.overall||60));

  const used = new Set();
  const dc = {};
  const ss = {};
  const allSlots = [
    ...DEPTH_CHART_SLOTS.offense,
    ...DEPTH_CHART_SLOTS.defense,
    ...DEPTH_CHART_SLOTS.specialTeams,
  ];

  // Three-pass starter assignment:
  //   Pass 1 — SPECIALTY slots only (≤ 2 archetype fits, narrow role).
  //            For each, ONLY consider players whose archetype matches.
  //            Without this, a high-OVR SLOT_CB would be greedily grabbed
  //            by the CB1 slot (processed first) instead of NB where
  //            they belong. Specialty slots include NB (only SLOT_CB),
  //            WR3 (SLOT/ROUTE), C (TECHNICIAN/ANCHOR), interior DL,
  //            etc. — slots whose role is narrow enough that a generic
  //            archetype shouldn't fill them when a specialist exists.
  //   Pass 2 — Remaining non-RET slots in declaration order.
  //            Picks by `_slotFitScore` (OVR + stat spec + archetype bonus).
  //   Pass 3 — RET slots (KR1/PR1). Drawn from speed-skill positions
  //            with their own usedAsReturner set so returners can ALSO
  //            be starters elsewhere.
  const SPECIALTY_FIT_MAX = 2;
  const retSlots = allSlots.filter(sd => sd.pos === "RET");
  const positionSlots = allSlots.filter(sd => sd.pos !== "RET");

  const _assignStarter = (slotDef, candidates) => {
    if (!candidates.length) return false;
    candidates.sort((a, b) => _slotFitScore(b, slotDef.key) - _slotFitScore(a, slotDef.key));
    const starter = candidates[0];
    used.add(starter.pid);
    dc[slotDef.key] = {
      starter:   starter.pid,
      backup:    null,
      flex:      slotDef.flex,
      snapFloor: slotDef.snapFloor ?? 35,
      snapCeil:  slotDef.snapCeil  ?? 98,
    };
    return true;
  };

  // Pass 1 — specialty slots, archetype-matched candidates only
  for (const slotDef of positionSlots) {
    const fit = SLOT_ARCHETYPE_FIT[slotDef.key];
    if (!fit || fit.length > SPECIALTY_FIT_MAX) continue;
    const candidates = (byPos[slotDef.pos] || []).filter(p =>
      !used.has(p.pid) && fit.includes(p.archetype)
    );
    _assignStarter(slotDef, candidates);
  }

  // Pass 2 — every remaining slot, full pool
  for (const slotDef of positionSlots) {
    if (dc[slotDef.key]) continue;
    const pool = (byPos[slotDef.pos] || []).filter(p => !used.has(p.pid));
    if (!_assignStarter(slotDef, pool)) {
      dc[slotDef.key] = {
        starter: null, backup: null,
        flex:      slotDef.flex,
        snapFloor: slotDef.snapFloor ?? 35,
        snapCeil:  slotDef.snapCeil  ?? 98,
      };
    }
  }

  // Returner pass — KR1/PR1. Eligible positions per slot. Sort by
  // speed+agility (the returner traits). Doesn't share the global
  // `used` set since returners ALSO play their normal position; they
  // just see the field on change-of-possession plays.
  const usedAsReturner = new Set();
  const _isHealthyForReturning = p =>
    !(p.injury?.weeksRemaining > 0) && !p.onIR;
  for (const slotDef of retSlots) {
    const eligibleFor = slotDef.retEligible || ["WR", "RB", "CB", "S"];
    const pool = roster
      .filter(p =>
        eligibleFor.includes(p.position) &&
        !usedAsReturner.has(p.pid) &&
        _isHealthyForReturning(p)
      )
      .sort((a, b) => {
        const aSpd = (a.stats || [])[0] ?? 50;
        const aAgi = (a.stats || [])[2] ?? 50;
        const bSpd = (b.stats || [])[0] ?? 50;
        const bAgi = (b.stats || [])[2] ?? 50;
        return (bSpd + bAgi) - (aSpd + aAgi);
      });
    const starter = pool[0] || null;
    dc[slotDef.key] = {
      starter:   starter?.pid ?? null,
      backup:    null,
      flex:      slotDef.flex,
      snapFloor: slotDef.snapFloor ?? 6,
      snapCeil:  slotDef.snapCeil  ?? 98,
    };
    if (starter) usedAsReturner.add(starter.pid);
  }

  const slotsByPos = {};
  for (const sd of allSlots) {
    if (!slotsByPos[sd.pos]) slotsByPos[sd.pos] = [];
    slotsByPos[sd.pos].push(sd);
  }
  const cascadePos = new Set(
    Object.entries(slotsByPos)
      .filter(([pos, slots]) => slots.length > 1 && pos !== "S")
      .map(([pos]) => pos)
  );

  const usedBackup = new Set();
  for (const slotDef of allSlots) {
    const posSlots = slotsByPos[slotDef.pos];
    const slotIdx  = posSlots.findIndex(s => s.key === slotDef.key);
    let backupPid  = null;

    if (slotDef.pos === "RET") {
      // Returner backups come from the same speed-skill pool, excluding
      // anyone already assigned as a returner.
      const eligibleFor = slotDef.retEligible || ["WR", "RB", "CB", "S"];
      const pool = roster
        .filter(p => eligibleFor.includes(p.position)
                  && p.pid !== dc[slotDef.key]?.starter
                  && !usedAsReturner.has(p.pid)
                  && _isHealthyForReturning(p))
        .sort((a, b) => ((b.stats?.[0]??50) + (b.stats?.[2]??50)) - ((a.stats?.[0]??50) + (a.stats?.[2]??50)));
      if (pool[0]) { backupPid = pool[0].pid; usedAsReturner.add(pool[0].pid); }
    } else if (cascadePos.has(slotDef.pos) && slotIdx < posSlots.length - 1) {
      backupPid = dc[posSlots[slotIdx + 1].key]?.starter ?? null;
    } else {
      const groupStarterPids = new Set(posSlots.map(s => dc[s.key]?.starter).filter(Boolean));
      const backup = (byPos[slotDef.pos] || [])
        .find(p => !groupStarterPids.has(p.pid) && !usedBackup.has(p.pid)) ?? null;
      if (backup) { backupPid = backup.pid; usedBackup.add(backup.pid); }
    }

    dc[slotDef.key].backup = backupPid;
    const starterObj = dc[slotDef.key].starter ? roster.find(p => p.pid === dc[slotDef.key].starter) : null;
    const backupObj  = backupPid ? roster.find(p => p.pid === backupPid) : null;
    ss[slotDef.key] = _computeOptimalPct(starterObj, backupObj, slotDef.snapFloor, slotDef.snapCeil);
  }

  return { dc, ss };
}

function _initDepthChart(teamId) {
  if (!franchise.depthChart) franchise.depthChart = {};
  if (!franchise.snapShares) franchise.snapShares = {};
  // Preserve manual snap share overrides across auto-rebuilds. The user
  // intent ("I want 50/50 RB committee") should outlive a roster shuffle.
  const manualOverrides = {};
  const existing = franchise.snapShares[teamId] || {};
  for (const [key, val] of Object.entries(existing)) {
    if (val?.manual) manualOverrides[key] = { ...val };
  }
  const { dc, ss } = _computeAutoDepthChart(teamId);
  franchise.depthChart[teamId] = dc;
  franchise.snapShares[teamId] = { ...ss, ...manualOverrides };
}

// Re-run the optimizer for all non-manual slots on a team.
// Call after any roster change (signing, trade, injury return).
function _optimizeSnapShares(teamId) {
  if (!franchise.depthChart?.[teamId]) { _initDepthChart(teamId); return; }
  const dc    = franchise.depthChart[teamId];
  const ss    = franchise.snapShares[teamId] || {};
  const byPid = {};
  for (const p of franchise.rosters[teamId] || []) byPid[p.pid] = p;
  for (const [key, slot] of Object.entries(dc)) {
    if (ss[key]?.manual) continue;
    const starter = slot.starter ? byPid[slot.starter] : null;
    const backup  = slot.backup  ? byPid[slot.backup]  : null;
    ss[key] = _computeOptimalPct(starter, backup, slot.snapFloor, slot.snapCeil);
  }
  franchise.snapShares[teamId] = ss;
}

// Backfill stamina onto legacy saves.
function _backfillStamina() {
  if (!franchise) return;
  const stamp = p => {
    if (p._stamina != null) return;
    const fl = p.flavor;
    p._stamina = fl === "RAW_ATHLETE"      ? 82 + Math.floor(Math.random() * 14)
               : fl === "HIGH_FOOTBALL_IQ" ? 50 + Math.floor(Math.random() * 19)
               : 68 + Math.floor(Math.random() * 15);
  };
  for (const roster of Object.values(franchise.rosters || {})) roster.forEach(stamp);
  for (const squad  of Object.values(franchise.practiceSquads || {})) squad.forEach(stamp);
  (franchise.freeAgents || []).forEach(stamp);
}

// Backfill replay clips array onto legacy saves that predate the highlight
// system. We can't reconstruct old highlights (sim games drop their plays
// once stored), so historical games won't be replayable — but the array
// being defined keeps frnReplayClip / _trimReplayClips / week-recap from
// crashing, and new games will populate it going forward.
function _backfillReplayClips() {
  if (!franchise) return;
  if (!Array.isArray(franchise.replayClips)) franchise.replayClips = [];
}

// Backfill depth chart + snap shares for any team that doesn't have one yet,
// AND patch in any slot keys added in newer versions (RB2, DL5, DL6, NB2,
// KR1, PR1, etc.). Without the slot-level patch, legacy saves keep their
// old slot set and the new UI shows "— empty —" forever.
//
// Conflict-aware: respects existing starter assignments. A player already
// in use elsewhere won't be picked for a new slot. Returner slots (pos:
// "RET") are exempt from the conflict set since returners double up with
// their normal position.
function _backfillDepthChart() {
  if (!franchise) return;
  const allSlots = [
    ...DEPTH_CHART_SLOTS.offense,
    ...DEPTH_CHART_SLOTS.defense,
    ...DEPTH_CHART_SLOTS.specialTeams,
  ];
  for (const teamId of Object.keys(franchise.rosters || {})) {
    const tid = Number(teamId);
    if (!franchise.depthChart?.[tid]) {
      _initDepthChart(tid);
      continue;
    }
    const existing = franchise.depthChart[tid];
    const missing = allSlots.filter(sd => !existing[sd.key]);
    if (missing.length === 0) continue;

    const used = new Set();
    for (const slot of Object.values(existing)) {
      if (slot?.starter) used.add(slot.starter);
    }
    const roster = franchise.rosters[tid] || [];
    if (!franchise.snapShares) franchise.snapShares = {};
    if (!franchise.snapShares[tid]) franchise.snapShares[tid] = {};

    for (const sd of missing) {
      let starter = null;
      if (sd.pos === "RET") {
        const eligible = sd.retEligible || ["WR","RB","CB","S"];
        const pool = roster
          .filter(p => eligible.includes(p.position))
          .sort((a, b) =>
            ((b.stats?.[0]??50) + (b.stats?.[2]??50)) -
            ((a.stats?.[0]??50) + (a.stats?.[2]??50))
          );
        starter = pool[0] || null;
      } else {
        const pool = roster.filter(p => p.position === sd.pos && !used.has(p.pid));
        // _slotFitScore handles the no-weights case (returns ovr + archBonus),
        // so we can use it uniformly here. A SLOT_CB filling a freshly-added
        // NB slot via backfill now gets the same archetype bonus that a fresh
        // auto-set would give it.
        pool.sort((a, b) => _slotFitScore(b, sd.key) - _slotFitScore(a, sd.key));
        starter = pool[0] || null;
        if (starter) used.add(starter.pid);
      }
      existing[sd.key] = {
        starter: starter?.pid ?? null,
        backup: null,
        flex: sd.flex,
        snapFloor: sd.snapFloor ?? 35,
        snapCeil:  sd.snapCeil  ?? 98,
      };
      franchise.snapShares[tid][sd.key] = _computeOptimalPct(starter, null, sd.snapFloor, sd.snapCeil);
    }
    _optimizeSnapShares(tid);
  }
}

// Backfill pid onto any player object that doesn't have one (legacy saves).
// ── Injury repair migration ──────────────────────────────────────────────
// Old saves carry these specific bugs:
//   (a) `p.injury` set but no matching injuryHistory entry this season —
//       the pre-fix mid-game injury path didn't always log the history row,
//       so onset display reads as blank and recovery tracking is broken.
//   (b) `weeksRemaining` exceeds the maximum duration for that injury type
//       (e.g., a torn ACL with 50w remaining — engine never ticked properly).
//   (c) `p.injury` is set with weeksRemaining = 0 — was supposed to clear
//       at recovery but didn't on the old code path.
//   (d) Cross-season orphan: `p.injury` from a prior season that should
//       have rehabbed away during offseason but didn't (no offseason tick).
//
// One-shot, gated by `franchise._injuriesRepaired_v1`. Stashes the result
// list on `franchise._injuryRepairReport` so the UI can surface it once.
const _INJURY_MAX_WEEKS = {
  "torn ACL": 24, "chronic concussion syndrome": 16, "labrum tear": 20,
  "Lisfranc fracture": 18, "torn achilles": 32, "chronic hamstring": 6,
  "concussion": 8, "hamstring": 6, "ankle sprain": 6, "knee": 12,
  "shoulder": 6, "rib": 4, "back": 5, "groin": 4, "calf": 5,
  "wrist": 4, "hand": 3, "neck": 6, "abdomen": 4, "achilles": 16,
};
function _repairInjuries() {
  if (!franchise || franchise._injuriesRepaired_v1) return;
  const fixes = [];
  for (const [tidStr, roster] of Object.entries(franchise.rosters || {})) {
    for (const p of roster) {
      if (!p?.injury) continue;
      const wr = p.injury.weeksRemaining;
      // (c) Active injury with weeksRemaining = 0 → clear (recovery missed)
      if (wr != null && wr <= 0) {
        fixes.push({ name: p.name, pos: p.position, kind: "stale-zero", label: p.injury.label });
        p.injury = null;
        continue;
      }
      // (b) Implausibly long remaining → cap at catalog max
      const catMax = _INJURY_MAX_WEEKS[p.injury.label] || 24;
      if (wr > catMax + 8) {
        const before = wr;
        p.injury.weeksRemaining = catMax;
        fixes.push({ name: p.name, pos: p.position, kind: "capped", label: p.injury.label, from: before, to: catMax });
      }
      // (a) + (d) Inspect injuryHistory for a matching entry this season
      const hist = p.injuryHistory || [];
      const thisSeasonMatch = hist.find(h =>
        h.season === franchise.season && h.label === p.injury.label);
      if (!thisSeasonMatch) {
        // Could be a prior-season carryover that never cleared (d), OR a
        // pre-fix mid-game injury where the history row was lost (a).
        const priorMatch = [...hist].reverse().find(h => h.label === p.injury.label);
        const seasonsAgo = priorMatch?.season != null
          ? (franchise.season || 1) - priorMatch.season : null;
        if (seasonsAgo != null && seasonsAgo >= 1) {
          // Prior-season match: this should have rehabbed across the
          // offseason. Clear the injury and apply rehab penalty as if
          // it had completed naturally.
          fixes.push({ name: p.name, pos: p.position, kind: "cleared-prior", label: p.injury.label, seasonsAgo });
          if (typeof _applyRehabPenalty === "function") {
            try { _applyRehabPenalty(p, Number(tidStr), !!p.injury._catastrophic); }
            catch (_e) {}
          }
          p.injury = null;
        } else {
          // No history match at all — backfill a synthetic onset entry
          // anchored at current week so the banner can display something.
          p.injuryHistory = hist;
          p.injuryHistory.push({
            label: p.injury.label, week: franchise.week || 1,
            season: franchise.season || 1,
            weeks: p.injury.weeksRemaining,
            catastrophic: !!p.injury._catastrophic,
            careerEnding: !!p.injury._careerEnding,
            cause: "unknown",
            _backfilled: true,
          });
          fixes.push({ name: p.name, pos: p.position, kind: "backfilled-history", label: p.injury.label });
        }
      }
    }
  }
  franchise._injuriesRepaired_v1 = true;
  if (fixes.length) {
    franchise._injuryRepairReport = {
      fixes, total: fixes.length, repairedAtSeason: franchise.season,
      seenByUser: false,
    };
  }
}

function _backfillPlayerPids() {
  if (!franchise) return;
  const seen = new Set();
  const stamp = p => {
    if (!p.pid) p.pid = Math.random().toString(36).slice(2, 10);
    // Guarantee uniqueness within this save
    while (seen.has(p.pid)) p.pid = Math.random().toString(36).slice(2, 10);
    seen.add(p.pid);
  };
  for (const roster of Object.values(franchise.rosters || {})) roster.forEach(stamp);
  for (const squad of Object.values(franchise.practiceSquads || {})) squad.forEach(stamp);
  (franchise.freeAgents || []).forEach(stamp);
}

function _migrateLegacySave() {
  const meta = _readSlotsMeta();
  if (meta.slots.length > 0) return;
  let raw = null;
  try { raw = localStorage.getItem(FRANCHISE_KEY); } catch {}
  if (!raw) return;
  try {
    const id = 1;
    localStorage.setItem(_slotDataKey(id), raw);
    localStorage.removeItem(FRANCHISE_KEY);
    const parsed = JSON.parse(raw);
    const team = TEAMS.find(t => t.id === parsed.chosenTeamId);
    meta.slots.push({
      id, name: team ? `${team.city} ${team.name}` : "Slot 1",
      lastSaved: Date.now(),
      summary: { season: parsed.season, week: parsed.week, teamId: parsed.chosenTeamId, phase: parsed.phase },
    });
    meta.activeSlotId = id;
    _writeSlotsMeta(meta);
  } catch {}
}

let _saveFranchiseTimer = null;
// ── IndexedDB primary store ──────────────────────────────────────────────────
// Unlimited capacity (hundreds of MB possible). localStorage is now a
// fast-path mirror; IDB is the canonical source of truth.
const _IDB_DB = "gridiron_chain";
const _IDB_STORE = "franchise_saves";
let _idbPromise = null;
function _idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
}
function _idbPut(slotId, value) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, "readwrite");
    tx.objectStore(_IDB_STORE).put(value, String(slotId));
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}
function _idbGet(slotId) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, "readonly");
    const req = tx.objectStore(_IDB_STORE).get(String(slotId));
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  }));
}
function _idbDelete(slotId) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, "readwrite");
    tx.objectStore(_IDB_STORE).delete(String(slotId));
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}

// Ask the browser to make our storage persistent — it survives eviction
// pressure when the user is low on disk. Fired once per session on first save.
let _persistRequested = false;
function _requestPersistentStorage() {
  if (_persistRequested) return;
  _persistRequested = true;
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(granted => {
      console.log(`[storage] persistent storage ${granted ? "granted" : "denied"}`);
    }).catch(() => {});
  }
}

function saveFranchise() {
  if (!franchise) return;
  if (_saveFranchiseTimer) clearTimeout(_saveFranchiseTimer);
  _saveFranchiseTimer = setTimeout(_flushSaveFranchise, 600);
}
function _flushSaveFranchise() {
  _saveFranchiseTimer = null;
  if (!franchise) return;
  const meta = _readSlotsMeta();
  let activeId = meta.activeSlotId;
  if (!activeId) {
    activeId = (meta.slots.reduce((m,s)=>Math.max(m,s.id),0) || 0) + 1;
    meta.slots.push({ id: activeId, name: "New Franchise", lastSaved: Date.now(), summary: {} });
    meta.activeSlotId = activeId;
  }
  const slot = meta.slots.find(s => s.id === activeId);
  if (!slot) { meta.activeSlotId = null; _writeSlotsMeta(meta); return; }
  const team = getTeam(franchise.chosenTeamId);
  const standing = franchise.standings?.[franchise.chosenTeamId];
  slot.lastSaved = Date.now();
  slot.summary = {
    season: franchise.season, week: franchise.week,
    teamId: franchise.chosenTeamId,
    teamName: team ? `${team.city} ${team.name}` : "?",
    phase: franchise.phase,
    record: standing ? `${standing.w}-${standing.l}${standing.t?`-${standing.t}`:""}` : "0-0",
  };
  if ((slot.name === "New Franchise" || slot.name === "Untitled") && team) {
    slot.name = `${team.city} ${team.name}`;
  }
  _writeSlotsMeta(meta);
  franchise._saveStamp = Date.now();
  // Always-on: ask for persistent storage so the IDB store doesn't get evicted.
  _requestPersistentStorage();
  // Async write to IDB — primary store, no size limit. Fire and forget.
  _idbPut(activeId, franchise).catch(e => console.warn("[IDB save] failed:", e));

  let payload;
  try { payload = JSON.stringify(franchise); }
  catch (e) { console.error("[save] JSON serialize failed:", e); _saveLastError = "serialize:" + e.message; return; }
  // Proactively trim if payload is approaching the 5MB safe zone — most browsers
  // hard-cap localStorage around 5-10MB per origin.
  if (payload.length > 4_000_000) {
    console.warn(`[save] payload ${(payload.length/1024/1024).toFixed(2)}MB — proactively trimming`);
    _trimFranchiseForStorage();
    try { payload = JSON.stringify(franchise); } catch {}
  }
  try {
    localStorage.setItem(_slotDataKey(activeId), payload);
    _saveLastError = null;
    _saveLastSize = payload.length;
  } catch (e) {
    // localStorage hit quota — that's OK, IDB has the canonical save.
    // We still want a localStorage entry so sync loads find SOMETHING, so try
    // trimming and retry once.
    console.warn(`[save] localStorage full (${(payload.length/1024/1024).toFixed(2)}MB) — IDB has the full save. Trimming localStorage cache.`);
    _trimFranchiseForStorage();
    try {
      const trimmed = JSON.stringify(franchise);
      localStorage.setItem(_slotDataKey(activeId), trimmed);
      _saveLastError = null;
      _saveLastSize = trimmed.length;
    } catch (e2) {
      // Even trimmed version doesn't fit. Just remove the stale entry — load
      // will fall through to IDB.
      try { localStorage.removeItem(_slotDataKey(activeId)); } catch {}
      _saveLastError = `idb-only:${(payload.length/1024/1024).toFixed(2)}MB`;
      _saveLastSize = 0;
    }
  }
}
let _saveLastError = null;
let _saveLastSize = 0;

// Diagnostic: prints a save-size breakdown by section to the console.
// Call from the browser devtools: `frnSaveDiagnostics()`. Useful for
// confirming that long franchise runs aren't bloating storage and that
// the auto-trim threshold (4MB) is nowhere close.
function frnSaveDiagnostics() {
  if (!franchise) { console.log("[diag] no franchise loaded"); return; }
  const sizeOf = (val) => {
    try { return new Blob([JSON.stringify(val)]).size; } catch { return 0; }
  };
  const fmt = (b) => b > 1_000_000 ? `${(b/1_000_000).toFixed(2)} MB`
                  : b > 1_000     ? `${(b/1_000).toFixed(1)} KB`
                  : `${b} B`;
  const total = sizeOf(franchise);
  const sections = [
    ["rosters",            franchise.rosters],
    ["history",            franchise.history],
    ["hallOfFame",         franchise.hallOfFame],
    ["_hofEligible",       franchise._hofEligible],
    ["news",               franchise.news],
    ["schedule",           franchise.schedule],
    ["coaches",            franchise.coaches],
    ["practiceSquads",     franchise.practiceSquads],
    ["freeAgents",         franchise.freeAgents],
    ["_retiredPlayerPool", franchise._retiredPlayerPool],
    ["_posCoachPool",      franchise._posCoachPool],
    ["_coachMarket",       franchise._coachMarket],
    ["_coachFA",           franchise._coachFA],
    ["seasonStats",        franchise.seasonStats],
    ["seasonHighlights",   franchise.seasonHighlights],
    ["picks",              franchise.picks],
    ["draftClass",         franchise.draftClass],
  ].map(([k, v]) => ({ key: k, bytes: sizeOf(v), pct: 0 }));
  for (const s of sections) s.pct = total ? Math.round(s.bytes / total * 1000) / 10 : 0;
  sections.sort((a, b) => b.bytes - a.bytes);
  console.log(`%c[save diagnostics] Season ${franchise.season} · Week ${franchise.week} · Total: ${fmt(total)}${total > 4_000_000 ? " (NEAR TRIM THRESHOLD)" : ""}`,
    "color:#f5c542;font-weight:700;font-size:.9rem");
  console.table(sections.filter(s => s.bytes > 0).map(s => ({
    section: s.key, size: fmt(s.bytes), pct: `${s.pct}%`,
  })));
  if (franchise.hallOfFame?.length || franchise._hofEligible?.length) {
    console.log(`[HOF] inducted: ${franchise.hallOfFame?.length || 0} · on ballot: ${franchise._hofEligible?.length || 0}`);
  }
  return { totalBytes: total, sections };
}

// Drop the heaviest non-essential payloads when localStorage is full. Stats and
// scoring timelines for prior weeks aren't needed for save resume — only the
// current week's games and aggregated seasonStats matter for continuity.
function _trimFranchiseForStorage() {
  if (!franchise) return;
  const curWeek  = franchise.week || 1;
  const userTeam = franchise.chosenTeamId;

  // Drop only play-by-play scoring timelines from old games — keep per-game
  // player stats (g.stats) so the full game log remains available.
  (franchise.schedule || []).forEach(g => {
    if (g.played && g.week < curWeek - 1) {
      delete g.scoring;
    }
  });

  // MFF EPA playLog: drop any seasons earlier than the current one (their
  // frozen epaSummary is what survives). Defensive safety net — the season
  // rollover already does this, but if a save is loaded mid-trim or a legacy
  // save predates the rollover hook, this cleans it up. IDB has no size cap
  // so this is purely a localStorage-mirror trim.
  if (franchise.playLog && franchise.season != null) {
    for (const k of Object.keys(franchise.playLog)) {
      if (Number(k) < franchise.season) delete franchise.playLog[k];
    }
  }

  // Trim news/highlights/chat — bumped from 30 → 150 so multi-season
  // playthroughs keep enough news to scroll back through a full season
  // of context. The hard cap in _pushNews is 500; this storage-pressure
  // trim is the safety net, not the default.
  if (franchise.news?.length > 150)           franchise.news            = franchise.news.slice(-150);
  if (franchise.seasonHighlights?.length > 60) franchise.seasonHighlights = franchise.seasonHighlights.slice(-60);
  if (franchise.chat?.length > 40)            franchise.chat            = franchise.chat.slice(-40);

  // Per-player trimming: CPU rosters carry veterans with many seasons of
  // per-season stats — cap aggressively since only the user's own team needs
  // the full history. injuryHistory only needs 3+ entries for the injury-prone
  // flag, so cap at 4 everywhere.
  const _trimPlayerList = (players, isCPU) => {
    for (const p of players) {
      if (p.injuryHistory?.length > 4) p.injuryHistory = p.injuryHistory.slice(-4);
      const historyCap = isCPU ? 10 : 20;
      const careerCap  = isCPU ? 10 : 20;
      if (p.careerHistory?.length > historyCap) p.careerHistory = p.careerHistory.slice(-historyCap);
      if (p.career?.length      > careerCap)  p.career         = p.career.slice(-careerCap);
    }
  };

  for (const [tidStr, roster] of Object.entries(franchise.rosters || {}))
    _trimPlayerList(roster, Number(tidStr) !== userTeam);

  for (const [tidStr, squad] of Object.entries(franchise.practiceSquads || {}))
    _trimPlayerList(squad, Number(tidStr) !== userTeam);
}
window.addEventListener("beforeunload", () => { if (_saveFranchiseTimer) _flushSaveFranchise(); });

function loadFranchise() {
  _migrateLegacySave();
  const meta = _readSlotsMeta();
  if (!meta.activeSlotId) { franchise = null; return; }
  const slotId = meta.activeSlotId;
  try {
    const raw = localStorage.getItem(_slotDataKey(slotId));
    if (raw) {
      franchise = JSON.parse(raw);
      if (franchise && franchise.pendingFranchiseGame) franchise.pendingFranchiseGame = null;
      _backfillPlayerPids(); _backfillTEC(); _backfillCoachingStaff(); _backfillCoachable(); _backfillPhysicalPeak(); _backfillStamina(); _backfillDepthChart(); _backfillReplayClips(); if(typeof _backfillCollegePipeline==="function")_backfillCollegePipeline(); if(typeof _backfillSeasonScout==="function")_backfillSeasonScout(); if(typeof _backfillPinnedProspects==="function")_backfillPinnedProspects(); _repairInjuries();
      // Race the IDB read — if IDB has a newer save (lastSaved timestamp via
      // _saveLastFlush on franchise), use it. Otherwise keep the sync result.
      _idbGet(slotId).then(idbFranchise => {
        if (!idbFranchise) return;
        const lsTime = franchise?._saveStamp || 0;
        const idbTime = idbFranchise._saveStamp || 0;
        if (idbTime > lsTime) {
          franchise = idbFranchise;
          if (franchise.pendingFranchiseGame) franchise.pendingFranchiseGame = null;
          _backfillPlayerPids(); _backfillTEC(); _backfillCoachingStaff(); _backfillCoachable(); _backfillPhysicalPeak(); _backfillStamina(); _backfillDepthChart(); _backfillReplayClips(); if(typeof _backfillCollegePipeline==="function")_backfillCollegePipeline(); if(typeof _backfillSeasonScout==="function")_backfillSeasonScout(); if(typeof _backfillPinnedProspects==="function")_backfillPinnedProspects(); _repairInjuries();
          if (typeof showFranchiseDashboard === "function") showFranchiseDashboard();
        }
      }).catch(() => {});
    } else {
      franchise = null;
      // Async IDB fallback — common case is localStorage cleared but IDB intact.
      _idbGet(slotId).then(idbFranchise => {
        if (!idbFranchise) return;
        franchise = idbFranchise;
        if (franchise.pendingFranchiseGame) franchise.pendingFranchiseGame = null;
        _backfillPlayerPids(); _backfillTEC(); _backfillCoachingStaff(); _backfillCoachable(); _backfillPhysicalPeak(); _backfillStamina(); _backfillDepthChart(); _backfillReplayClips(); if(typeof _backfillCollegePipeline==="function")_backfillCollegePipeline(); if(typeof _backfillSeasonScout==="function")_backfillSeasonScout(); if(typeof _backfillPinnedProspects==="function")_backfillPinnedProspects(); _repairInjuries();
        if (typeof showFranchiseDashboard === "function") showFranchiseDashboard();
      }).catch(() => {});
    }
  } catch { franchise = null; }
}

function frnSwitchSlot(id) {
  const meta = _readSlotsMeta();
  if (!meta.slots.find(s => s.id === id)) return;
  meta.activeSlotId = id;
  _writeSlotsMeta(meta);
  loadFranchise();
  if (franchise) showFranchiseDashboard();
  else renderFrnStartScreen();
}

// ─── Slot row "⋯" popover menu (rename / delete) ──────────────────────────
// Destructive actions (delete) live one click deeper than friendly ones,
// physically separated from Load. Avoids the "✗ right next to ✎" misclick trap.
function _frnCloseSlotMenu() {
  document.querySelectorAll(".frn-slot-menu.open").forEach(m => m.classList.remove("open"));
}
function _frnToggleSlotMenu(id, ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  const m = document.getElementById("frnSlotMenu" + id);
  if (!m) return;
  const wasOpen = m.classList.contains("open");
  _frnCloseSlotMenu();
  if (!wasOpen) m.classList.add("open");
}
// Click anywhere else to dismiss any open slot menu.
document.addEventListener("click", (e) => {
  if (e.target.closest(".frn-slot-menu-wrap")) return;
  _frnCloseSlotMenu();
});

// ─── Styled confirm modal ──────────────────────────────────────────────────
// Promise<boolean> returning replacement for `confirm()`. Use for any action
// where the user could lose work — especially destructive ops (delete, release,
// trade-confirm). Body accepts an HTML string for rich context (slot summary,
// cap impact, etc.). The `danger:true` variant tints the confirm button red.
// `requireTypeName` adds a "type the name to confirm" gate — set to the exact
// string the user must type. Used for high-value destructive ops.
function _frnConfirmModal(opts) {
  return new Promise((resolve) => {
    const o = opts || {};
    const id = "frnConfirmModal_" + Date.now();
    const wrap = document.createElement("div");
    wrap.className = "frn-modal-backdrop";
    wrap.id = id;
    const safeTitle = o.title || "Confirm";
    const safeBody  = o.body  || "";
    const okLabel   = o.confirmLabel || "Confirm";
    const noLabel   = o.cancelLabel  || "Cancel";
    const danger    = !!o.danger;
    const typeName  = o.requireTypeName || "";
    const typeGate  = typeName
      ? `<div class="frn-modal-type-gate">
           <label style="font-size:.72rem;color:var(--gray);display:block;margin-bottom:.3rem">
             Type <b style="color:var(--gold)">${typeName.replace(/</g,"&lt;")}</b> to confirm:
           </label>
           <input type="text" class="frn-modal-type-input" autocomplete="off" />
         </div>`
      : "";
    wrap.innerHTML = `
      <div class="frn-modal ${danger ? "danger" : ""}" role="dialog" aria-modal="true">
        <div class="frn-modal-title">${safeTitle}</div>
        <div class="frn-modal-body">${safeBody}</div>
        ${typeGate}
        <div class="frn-modal-footer">
          <button class="btn btn-outline frn-modal-cancel">${noLabel}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-gold"} frn-modal-confirm" ${typeName ? "disabled" : ""}>${okLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const cancelBtn = wrap.querySelector(".frn-modal-cancel");
    const okBtn     = wrap.querySelector(".frn-modal-confirm");
    const typeInp   = wrap.querySelector(".frn-modal-type-input");
    const close = (result) => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(result); };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      // Enter to confirm only when the typing gate isn't blocking
      if (e.key === "Enter" && !okBtn.disabled) close(true);
    };
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => { if (!okBtn.disabled) close(true); });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });   // click-backdrop to dismiss
    if (typeInp) {
      typeInp.addEventListener("input", () => {
        okBtn.disabled = typeInp.value.trim() !== typeName;
      });
      setTimeout(() => typeInp.focus(), 30);
    } else {
      setTimeout(() => cancelBtn.focus(), 30);   // default focus on Cancel (safer)
    }
    document.addEventListener("keydown", onKey);
  });
}

async function frnDeleteSlot(id) {
  const meta = _readSlotsMeta();
  const slot = meta.slots.find(s => s.id === id);
  if (!slot) return;
  // Build a rich summary so the user knows exactly what they're nuking, not
  // just a name. High-value franchises (>=5 seasons) get an additional
  // type-the-name gate — at that point the franchise has real investment and
  // a misclick should not be enough.
  const sm = slot.summary || {};
  const seasons  = sm.season || 1;
  const phase    = sm.phase || "—";
  const team     = sm.teamName || "—";
  const record   = sm.record || "—";
  const saved    = slot.lastSaved ? new Date(slot.lastSaved).toLocaleString() : "—";
  const highValue = seasons >= 5;
  const safeName = String(slot.name).replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const body = `
    <div class="frn-delete-summary">
      <div class="frn-delete-row"><span>Franchise</span><b>${safeName}</b></div>
      <div class="frn-delete-row"><span>Team</span><b>${team}</b></div>
      <div class="frn-delete-row"><span>Progress</span><b>Season ${seasons} · ${phase} · ${record}</b></div>
      <div class="frn-delete-row"><span>Last saved</span><b>${saved}</b></div>
    </div>
    <div class="frn-delete-warn">This <b>cannot be undone</b>. The save data and all career history will be permanently erased.</div>
  `;
  const ok = await _frnConfirmModal({
    title: `Delete "${slot.name}"?`,
    body,
    confirmLabel: "Delete franchise",
    cancelLabel: "Keep it",
    danger: true,
    requireTypeName: highValue ? slot.name : null,
  });
  if (!ok) return;
  meta.slots = meta.slots.filter(s => s.id !== id);
  if (meta.activeSlotId === id) {
    meta.activeSlotId = null;
    franchise = null;
  }
  _writeSlotsMeta(meta);
  try { localStorage.removeItem(_slotDataKey(id)); } catch {}
  _idbDelete(id).catch(() => {});
  renderFrnStartScreen();
}

// ── Export / Import save to file ─────────────────────────────────────────────
function frnExportSave() {
  if (!franchise) { alert("No franchise to export."); return; }
  const team = getTeam(franchise.chosenTeamId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const teamSlug = team ? `${team.city}_${team.name}`.replace(/\s+/g, "_") : "franchise";
  const filename = `gridiron_${teamSlug}_S${franchise.season}W${franchise.week}_${stamp}.json`;
  const payload = JSON.stringify({ __gridironSave: 1, exportedAt: Date.now(), franchise }, null, 0);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

async function frnImportSave() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed.__gridironSave ? parsed.franchise : parsed;
      if (!incoming || !incoming.chosenTeamId || !incoming.rosters) {
        alert("That doesn't look like a Hashmark Heroes save file.");
        return;
      }
      if (franchise && !await _frnConfirm("Importing will replace your current active franchise. Continue?")) return;
      franchise = incoming;
      _flushSaveFranchise();
      if (typeof showFranchiseDashboard === "function") showFranchiseDashboard();
    } catch (e) {
      alert("Failed to import save: " + e.message);
    }
  };
  input.click();
}

function frnRenameSlot(id) {
  const meta = _readSlotsMeta();
  const slot = meta.slots.find(s => s.id === id);
  if (!slot) return;
  const newName = prompt("Rename franchise:", slot.name);
  if (!newName || !newName.trim()) return;
  slot.name = newName.trim().slice(0, 40);
  _writeSlotsMeta(meta);
  renderFrnStartScreen();
}

// ── Schedule — 17 games over 17 weeks via Berger round-robin ─────────────────
// 32 teams × 17 games = 544 team-games / 2 = 272 games total, packed into
// 17 weeks of 16 games each. Berger circle method gives each team 17 unique
// opponents (out of 31 possible). No bye weeks — matches the NFL 17-game
// total but compresses to 17 weeks instead of 18 (no in-season rest week).
function generateFranchiseSchedule() {
  const arr = TEAMS.map(t => t.id);
  const n   = arr.length;   // 32
  const schedule = [];
  for (let week = 1; week <= FRANCHISE_WEEKS; week++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      const homeId = (i + week) % 2 === 0 ? a : b;
      const awayId = homeId === a ? b : a;
      schedule.push({ week, homeId, awayId, homeScore: null, awayScore: null, played: false });
    }
    // Rotate arr[1..n-1] right by 1 position (arr[0] is fixed)
    const last = arr.pop();
    arr.splice(1, 0, last);
  }
  return schedule;
}

// ── Standings helpers ────────────────────────────────────────────────────────
function initStandings() {
  return Object.fromEntries(TEAMS.map(t => [t.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 }]));
}
// Compute per-team division + conference + head-to-head records from
// franchise.schedule. NFL-style tiebreakers: when two teams have the
// same W-L%, prefer the one with the better division record, then
// conference record, then head-to-head, then point differential.
function _detailedRecord(teamId) {
  const team = getTeam(teamId);
  if (!team) return null;
  const out = {
    divW: 0, divL: 0, divT: 0,
    confW: 0, confL: 0, confT: 0,
    pointDiff: 0,
    h2h: {},   // { otherTeamId: [w, l, t] }
  };
  for (const g of (franchise.schedule || [])) {
    if (!g.played) continue;
    let me, them, myScore, themScore, themId;
    if (g.homeId === teamId)      { me = team; themId = g.awayId; myScore = g.homeScore; themScore = g.awayScore; }
    else if (g.awayId === teamId) { me = team; themId = g.homeId; myScore = g.awayScore; themScore = g.homeScore; }
    else continue;
    them = getTeam(themId);
    if (!them) continue;
    const won = myScore > themScore;
    const tied = myScore === themScore;
    out.pointDiff += myScore - themScore;
    if (them.division === me.division) {
      if (won) out.divW++; else if (tied) out.divT++; else out.divL++;
    }
    if (them.conference === me.conference) {
      if (won) out.confW++; else if (tied) out.confT++; else out.confL++;
    }
    out.h2h[themId] = out.h2h[themId] || [0, 0, 0];
    if (won) out.h2h[themId][0]++;
    else if (tied) out.h2h[themId][2]++;
    else out.h2h[themId][1]++;
  }
  return out;
}
function _winPct(w, l, t) {
  const total = (w + l + t);
  return total ? (w * 2 + t) / (total * 2) : 0;
}
function standingsSorted() {
  return Object.entries(franchise.standings)
    .map(([id, s]) => {
      const detailed = _detailedRecord(+id);
      return { id: +id, team: getTeam(+id), ...s, detailed };
    })
    .sort((a, b) => {
      const pA = _winPct(a.w, a.l, a.t);
      const pB = _winPct(b.w, b.l, b.t);
      if (pA !== pB) return pB - pA;
      // Division record
      const aDiv = _winPct(a.detailed?.divW || 0, a.detailed?.divL || 0, a.detailed?.divT || 0);
      const bDiv = _winPct(b.detailed?.divW || 0, b.detailed?.divL || 0, b.detailed?.divT || 0);
      if (aDiv !== bDiv) return bDiv - aDiv;
      // Conference record
      const aConf = _winPct(a.detailed?.confW || 0, a.detailed?.confL || 0, a.detailed?.confT || 0);
      const bConf = _winPct(b.detailed?.confW || 0, b.detailed?.confL || 0, b.detailed?.confT || 0);
      if (aConf !== bConf) return bConf - aConf;
      // Head-to-head (only meaningful for the two teams being compared)
      const h2hA = a.detailed?.h2h?.[b.id];
      const h2hB = b.detailed?.h2h?.[a.id];
      if (h2hA && h2hB) {
        const aPct = _winPct(h2hA[0], h2hA[1], h2hA[2]);
        const bPct = _winPct(h2hB[0], h2hB[1], h2hB[2]);
        if (aPct !== bPct) return bPct - aPct;
      }
      // Point differential, then raw wins.
      return (b.detailed?.pointDiff || 0) - (a.detailed?.pointDiff || 0) || b.w - a.w;
    });
}
function recordFranchiseResult(homeId, awayId, homeScore, awayScore) {
  const h = franchise.standings[homeId], a = franchise.standings[awayId];
  if (!h || !a) return;
  h.pf += homeScore; h.pa += awayScore;
  a.pf += awayScore; a.pa += homeScore;
  if (homeScore > awayScore)      { h.w++; a.l++; }
  else if (awayScore > homeScore) { a.w++; h.l++; }
  else                            { h.t++; a.t++; }
  // Roll injuries for both teams — contact path (hit-driven) and
  // non-contact path (stress/exertion-driven). Both fire per game.
  _rollGameInjuries(homeId);
  _rollGameInjuries(awayId);
  if (typeof _rollNonContactInjuries === "function") {
    _rollNonContactInjuries(homeId);
    _rollNonContactInjuries(awayId);
  }
  // News: blowouts and upsets
  const home = getTeam(homeId), away = getTeam(awayId);
  if (!home || !away) return;
  const diff = Math.abs(homeScore - awayScore);
  const winner  = homeScore > awayScore ? home : away;
  const loser   = homeScore > awayScore ? away : home;
  const winScore = Math.max(homeScore, awayScore);
  const loseScore= Math.min(homeScore, awayScore);
  if (diff >= 24) {
    _pushNews({ type:"blowout", label: `🔥 ${winner.name} blow out ${loser.name} ${winScore}-${loseScore}` });
  }
  // Upset = team rated 10+ lower won
  const winRtg = frnTeamRating(winner.id), lossRtg = frnTeamRating(loser.id);
  const winPower = winRtg.off + winRtg.def, lossPower = lossRtg.off + lossRtg.def;
  if (lossPower - winPower >= 14 && diff >= 7) {
    _pushNews({ type:"upset", label: `⚡ UPSET: ${winner.name} (${winRtg.off}/${winRtg.def}) over ${loser.name} (${lossRtg.off}/${lossRtg.def}) ${winScore}-${loseScore}` });
  }
}

// ── Assign initial ages to all franchise rosters ─────────────────────────────
function assignFranchiseAges(rosters) {
  for (const roster of Object.values(rosters)) {
    for (const p of roster) {
      if (p.age == null) {
        const base = p.overall >= 85 ? 26 : p.overall >= 75 ? 24 : 22;
        p.age = base + Math.floor(Math.random() * 7);
      }
    }
  }
}

// ── Realistic team-by-team roster generation ─────────────────────────────────
// Each franchise universe assigns every team a "talent tier": a handful of
// powerhouses with stacked rosters, a tier of solid contenders, an average
// middle pack, and a few rebuilders short on talent. Per-slot tier rolls
// (elite/good/average/poor) are drawn from a distribution that depends on
// both the team's tier and the depth-chart slot — so a powerhouse's starter
// is much more likely to be elite, a rebuilder's 3rd-stringer is usually a
// scrub, etc. Playbook bias still bumps the starter at the team's identity
// positions (Air Raid → QB/WR, Ground & Pound → RB/OL, etc).

// Distribution table: SLOT_TIER_DIST[slotIdx][teamTier] = {tier: prob}
// slotIdx is clamped to [0..3] — slot 0 = starter, 1 = 2nd-string,
// 2 = 3rd-string, 3+ = deep depth.
const SLOT_TIER_DIST = {
  0: {
    powerhouse: { elite:0.45, good:0.40, average:0.13, poor:0.02 },
    contender:  { elite:0.18, good:0.55, average:0.22, poor:0.05 },
    average:    { elite:0.06, good:0.42, average:0.42, poor:0.10 },
    rebuilding: { elite:0.02, good:0.22, average:0.46, poor:0.30 },
  },
  1: {
    powerhouse: { elite:0.05, good:0.40, average:0.45, poor:0.10 },
    contender:  { elite:0.02, good:0.28, average:0.50, poor:0.20 },
    average:    { elite:0.01, good:0.18, average:0.48, poor:0.33 },
    rebuilding: { elite:0.00, good:0.08, average:0.38, poor:0.54 },
  },
  2: {
    powerhouse: { elite:0.00, good:0.18, average:0.48, poor:0.34 },
    contender:  { elite:0.00, good:0.10, average:0.42, poor:0.48 },
    average:    { elite:0.00, good:0.06, average:0.36, poor:0.58 },
    rebuilding: { elite:0.00, good:0.03, average:0.27, poor:0.70 },
  },
  3: {
    powerhouse: { elite:0.00, good:0.06, average:0.40, poor:0.54 },
    contender:  { elite:0.00, good:0.04, average:0.34, poor:0.62 },
    average:    { elite:0.00, good:0.02, average:0.28, poor:0.70 },
    rebuilding: { elite:0.00, good:0.01, average:0.20, poor:0.79 },
  },
};

function weightedTierPick(dist) {
  const total = (dist.elite||0) + (dist.good||0) + (dist.average||0) + (dist.poor||0);
  let r = Math.random() * total;
  if ((r -= dist.elite   || 0) < 0) return "elite";
  if ((r -= dist.good    || 0) < 0) return "good";
  if ((r -= dist.average || 0) < 0) return "average";
  return "poor";
}

// 32 teams: 4 powerhouses, 10 contenders, 12 average, 6 rebuilding.
function assignTeamTiers() {
  const tiers = [
    ...Array(4 ).fill("powerhouse"),
    ...Array(10).fill("contender"),
    ...Array(12).fill("average"),
    ...Array(6 ).fill("rebuilding"),
  ];
  // Fisher-Yates shuffle
  for (let i = tiers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }
  const out = {};
  TEAMS.forEach((t, i) => out[t.id] = tiers[i]);
  return out;
}

function genFranchiseRoster(team, blockNames, teamTier) {
  const pb = getPlaybook(team);
  const used = new Set(blockNames || []);
  const r = [];

  for (const [pos, count] of Object.entries(ROSTER_SLOTS)) {
    const pbBias = pb.tierBias?.[pos]; // "elite" or "good" or undefined

    for (let i = 0; i < count; i++) {
      const slotIdx = Math.min(i, 3);
      const dist = { ...SLOT_TIER_DIST[slotIdx][teamTier] };

      // Starter at a playbook-favored position gets bumped toward the top
      if (i === 0) {
        if (pbBias === "elite") {
          dist.elite   = (dist.elite   || 0) + 0.20;
          dist.poor    = (dist.poor    || 0) * 0.3;
          dist.average = (dist.average || 0) * 0.6;
        } else if (pbBias === "good") {
          dist.elite   = (dist.elite   || 0) + 0.06;
          dist.good    = (dist.good    || 0) + 0.10;
          dist.poor    = (dist.poor    || 0) * 0.6;
        }
      }

      const tier   = weightedTierPick(dist);
      const player = genUniquePlayer(pos, tier, used);
      used.add(player.name);
      r.push(player);
    }
  }
  assignTeamJerseyNumbers(r);
  return r;
}

// ── Mode switching ───────────────────────────────────────────────────────────
// Two top-level modes: "franchise" (default, the polished career UI) and
// "testing" (legacy team-selector + sim/debug tools). Tab buttons drive this.
function setAppMode(mode) {
  try {
    document.body.classList.remove("mode-franchise", "mode-testing");
    document.body.classList.add(`mode-${mode}`);
    $("franchiseHome").style.display = mode === "franchise" ? "block" : "none";
    $("testingPanel").style.display  = mode === "testing"   ? "block" : "none";
    // Dev-tools footer link: hide when in testing mode (the testing panel has
    // its own "Back to Franchise" button so the user has a clear way home).
    const _devFt = $("devToolsFooter");
    if (_devFt) _devFt.style.display = mode === "testing" ? "none" : "block";
    // Legacy mode-tab buttons may not exist (removed from front page). Guard.
    const _mfb = $("modeFranchiseBtn"); if (_mfb) _mfb.classList.toggle("active", mode === "franchise");
    const _mtb = $("modeTestingBtn");   if (_mtb) _mtb.classList.toggle("active", mode === "testing");
    if (mode === "franchise") showFranchiseHome();
  } catch (err) {
    console.error("setAppMode error:", err);
  }
}

// ── Show franchise home ──────────────────────────────────────────────────────
// Always lands on the start screen so the user can explicitly choose New or
// Load. From there we render either the dashboard or the team picker.
function showFranchiseHome() {
  $("franchiseHome").style.display = "block";
  loadFranchise();
  renderFrnStartScreen();
}

// Build a summary string for a saved franchise (shown on the Load button)
function frnSaveSummary() {
  if (!franchise) return null;
  const team  = getTeam(franchise.chosenTeamId);
  const s     = franchise.standings?.[franchise.chosenTeamId] || { w:0, l:0 };
  const phase = franchise.phase || "regular";
  const phaseLabel =
    phase === "regular"   ? `Season ${franchise.season} · Week ${franchise.week} of ${FRANCHISE_WEEKS}` :
    phase === "playoffs"  ? `Season ${franchise.season} · Playoffs` :
    phase === "awards"    ? `Season ${franchise.season} · Awards` :
    phase === "offseason" ? `Season ${franchise.season} · Offseason` :
    `Season ${franchise.season}`;
  const name = team ? `${team.city} ${team.name}` : "—";
  return `${name} · ${phaseLabel} · ${s.w}-${s.l}`;
}

// Start screen — landing UI listing all saved franchises (multi-slot)
function renderFrnStartScreen() {
  _migrateLegacySave();
  // Hide the in-loop nav rail + app shell — the start screen has its own
  // identity (welcome card) and a slot list as nav.
  const _navEl = document.getElementById("frnNavBar");  if (_navEl) _navEl.style.display = "none";
  const _shEl  = document.getElementById("frnAppShell"); if (_shEl)  _shEl.style.display  = "none";
  const _ftEl  = document.getElementById("frnAppFooter"); if (_ftEl) _ftEl.style.display  = "none";
  const meta = _readSlotsMeta();
  const slots = (meta.slots || []).slice().sort((a,b) => (b.lastSaved||0) - (a.lastSaved||0));

  const slotsHtml = slots.length ? slots.map(s => {
    const sm = s.summary || {};
    const phaseLabel = sm.phase === "preseason" ? "Preseason"
                     : sm.phase === "free_agency" ? "Free Agency"
                     : sm.phase === "regular" ? `W${sm.week||"?"}`
                     : sm.phase === "playoffs" ? "Playoffs"
                     : sm.phase === "awards" ? "Awards"
                     : sm.phase === "offseason" ? "Offseason"
                     : sm.phase || "—";
    const isActive = meta.activeSlotId === s.id;
    return `<div class="frn-slot ${isActive?"active":""}">
      <div class="frn-slot-info">
        <div class="frn-slot-name">${s.name}</div>
        <div class="frn-slot-summary">
          ${sm.teamName ? sm.teamName + " · " : ""}Season ${sm.season || 1} · ${phaseLabel}
          ${sm.record ? " · " + sm.record : ""}
        </div>
        <div class="frn-slot-time">${s.lastSaved ? new Date(s.lastSaved).toLocaleString() : ""}</div>
      </div>
      <div class="frn-slot-actions">
        <button class="btn btn-gold" onclick="frnSwitchSlot(${s.id})">▶ Load</button>
        <div class="frn-slot-menu-wrap">
          <button class="btn btn-outline frn-slot-menu-btn" onclick="_frnToggleSlotMenu(${s.id}, event)" aria-label="More actions">⋯</button>
          <div class="frn-slot-menu" id="frnSlotMenu${s.id}">
            <button class="frn-slot-menu-item" onclick="_frnCloseSlotMenu();frnRenameSlot(${s.id})">✎ Rename</button>
            <button class="frn-slot-menu-item danger" onclick="_frnCloseSlotMenu();frnDeleteSlot(${s.id})">🗑 Delete franchise…</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join("") : `<div style="color:var(--gray);font-size:.78rem;padding:.75rem;text-align:center;font-style:italic">
      No franchises yet. Start a new one below.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="frn-welcome">
      <div class="frn-welcome-title">🏈 HASHMARK HEROES</div>
      <div class="frn-welcome-sub">American Football Manager</div>
      <div class="frn-welcome-feats">
        <div class="frn-welcome-feat"><strong>14</strong> regular-season games</div>
        <div class="frn-welcome-feat"><strong>8-team</strong> playoff bracket</div>
        <div class="frn-welcome-feat">Real <strong>MVP awards</strong></div>
        <div class="frn-welcome-feat">FA bidding wars</div>
        <div class="frn-welcome-feat">Career stats + HOF</div>
      </div>
    </div>

    <div class="frn-card-title" style="margin-top:1rem">📂 YOUR FRANCHISES (${slots.length})</div>
    <div class="frn-slots-list">${slotsHtml}</div>

    <div style="margin-top:1rem">
      <button class="frn-start-btn frn-start-new" onclick="frnQuickStart()" style="width:100%">
        <div class="frn-start-icon">🚀</div>
        <div class="frn-start-title">QUICK START</div>
        <div class="frn-start-sub">Random top team · skip preseason · play your first game in 30 seconds</div>
      </button>
      <div class="frn-start-alt-row">
        <button class="frn-start-alt" onclick="renderFrnStoryPicker()">
          <div class="frn-start-alt-title">Choose Your Story →</div>
          <div class="frn-start-alt-sub">3 archetypes: Win Now · Rising · Rebuild</div>
        </button>
        <button class="frn-start-alt" onclick="frnStartNew()">
          <div class="frn-start-alt-title">Browse All 32 Teams →</div>
          <div class="frn-start-alt-sub">Pick any team — full picker</div>
        </button>
      </div>
    </div>
  `;
}

// "New Game" handler — clears active slot so the next saveFranchise()
// allocates a new one. Existing franchises are untouched.
function frnStartNew() {
  const meta = _readSlotsMeta();
  meta.activeSlotId = null;
  _writeSlotsMeta(meta);
  franchise = null;
  franchiseDraft = _buildDraftLeague();
  renderFrnTeamPicker();
}

// ─── Quick Start ───────────────────────────────────────────────────────────
// 30-second path from cold start → playing your first game. Picks a random
// POWERHOUSE team (highest tier = best new-player experience), skips the
// 32-team picker AND the preseason/FA phases, drops the user directly into
// Week 1 with a top-tier roster. They can manage the team anytime, but their
// first interaction is sim-a-game, not roster-management. Friction matters
// most in the first 60 seconds.
function frnQuickStart() {
  // Guarded: _buildDraftLeague (below) and the skip-to-Week-1 logic run outside
  // startFranchise's own guard, so wrap the whole thing → a clean "try again"
  // message instead of a stranded half-state.
  try {
    const meta = _readSlotsMeta();
    meta.activeSlotId = null;
    _writeSlotsMeta(meta);
    franchise = null;
    franchiseDraft = _buildDraftLeague();
    // Pick a random powerhouse from the freshly-generated league
    const tiers = franchiseDraft.teamTiers;
    const powerhouses = TEAMS.filter(t => tiers[t.id] === "powerhouse");
    const choice = powerhouses[Math.floor(Math.random() * powerhouses.length)] || TEAMS[0];
    // startFranchise renders its own error + returns false on failure; bail so we
    // don't run the skip-to-Week-1 logic below on a null franchise.
    if (!startFranchise(choice.id)) return;
    // Skip preseason + free agency entirely — drop straight into Week 1, so the
    // new user's first action is a real game.
    franchise.phase = "regular";
    franchise.freeAgents = [];
    franchise._faOffers = {};
    franchise._faResults = null;
    saveFranchise();
    showFranchiseDashboard();
  } catch (err) {
    console.error("[frnQuickStart] failed:", err);
    try { franchise = null; franchiseDraft = null; } catch (_e) {}
    _frnRenderCreateError(err);
  }
}

// ─── "Choose Your Story" archetype picker ──────────────────────────────────
// Replaces the 32-team grid with a curated 3-archetype × 2-3-teams view. Maps
// internal team tiers to user-facing narrative archetypes:
//   WIN NOW  = powerhouse — vet cores, championship NOW
//   RISING   = contender  — young rosters, dynasty arc
//   REBUILD  = rebuilding — bottom of the league, long game
function renderFrnStoryPicker() {
  // Build (or reuse) the candidate league so we can read team tiers.
  if (!franchiseDraft) franchiseDraft = _buildDraftLeague();
  const tiers = franchiseDraft.teamTiers;
  const byTier = { powerhouse: [], contender: [], rebuilding: [] };
  for (const t of TEAMS) if (byTier[tiers[t.id]]) byTier[tiers[t.id]].push(t);
  // Hand-pick the first 3 of each (the league is randomized per session).
  const picks = {
    WIN_NOW: byTier.powerhouse.slice(0, 3),
    RISING:  byTier.contender.slice(0, 3),
    REBUILD: byTier.rebuilding.slice(0, 3),
  };
  // Mean OVR for the team's top-22 (gives a real "talent level" badge).
  const teamRating = (t) => {
    const roster = (franchiseDraft.rosters && franchiseDraft.rosters[t.id]) || [];
    const top = roster.slice().sort((a, b) => (b.overall||0) - (a.overall||0)).slice(0, 22);
    if (!top.length) return 70;
    return Math.round(top.reduce((s, p) => s + (p.overall||0), 0) / top.length);
  };
  const teamCard = (t) => {
    const rating = teamRating(t);
    return `<button class="frn-story-team" onclick="renderFrnTeamDetail(${t.id})">
      <div class="frn-story-team-name">${t.city} ${t.name}</div>
      <div class="frn-story-team-rating">Roster OVR <b>${rating}</b></div>
    </button>`;
  };
  const archetypes = [
    { key: "WIN_NOW", icon: "🏆", title: "WIN NOW",
      pitch: "Veteran core, championship window <b>right now</b>. Win the Super Bowl in 2-3 seasons or it's over.",
      diff:  "Easier short-term · cap problems · aging stars" },
    { key: "RISING", icon: "⚡", title: "RISING",
      pitch: "Young star + draft capital. <b>Build a dynasty</b> over the next 4-5 years.",
      diff:  "Medium difficulty · long arc · highest ceiling" },
    { key: "REBUILD", icon: "🔧", title: "REBUILD",
      pitch: "Bottom of the league. <b>Blank slate</b>. How long until you're a contender?",
      diff:  "Hard short-term · patient game · cathartic payoff" },
  ];
  $("frnHomeContent").innerHTML = `
    <div class="frn-welcome">
      <div class="frn-welcome-title" style="font-size:1.1rem">CHOOSE YOUR STORY</div>
      <div class="frn-welcome-sub" style="font-size:.78rem">Pick the kind of franchise you want to run — each archetype is a different rhythm</div>
    </div>
    <div class="frn-story-grid">
      ${archetypes.map(a => `
        <div class="frn-story-card frn-story-${a.key.toLowerCase()}">
          <div class="frn-story-head">
            <span class="frn-story-icon">${a.icon}</span>
            <span class="frn-story-title">${a.title}</span>
          </div>
          <div class="frn-story-pitch">${a.pitch}</div>
          <div class="frn-story-diff">${a.diff}</div>
          <div class="frn-story-teams">
            ${picks[a.key].map(teamCard).join("")}
            ${picks[a.key].length === 0 ? '<div class="frn-story-empty">No teams in this tier this season.</div>' : ""}
          </div>
        </div>
      `).join("")}
    </div>
    <div style="margin-top:1.25rem;display:flex;gap:.5rem;justify-content:center;font-size:.74rem;color:var(--gray)">
      <a href="#" onclick="event.preventDefault();renderFrnTeamPicker()" style="color:var(--gold-lt);text-decoration:underline">Browse all 32 teams instead →</a>
      <span>·</span>
      <a href="#" onclick="event.preventDefault();renderFrnStartScreen()" style="color:var(--gray);text-decoration:underline">← Back</a>
    </div>
  `;
}

// Build a fresh candidate league: rosters, ages, contracts, team tiers.
// Used by the picker so hover/detail screens show real data, and reused
// by startFranchise() if the user goes through and commits.
function _buildDraftLeague() {
  const rosters = {};
  const usedNames = new Set();
  const teamTiers = assignTeamTiers();
  for (const t of TEAMS) {
    const roster = genFranchiseRoster(t, usedNames, teamTiers[t.id]);
    roster.forEach(p => usedNames.add(p.name));
    rosters[t.id] = roster;
  }
  assignFranchiseAges(rosters);
  assignContracts(rosters, SALARY_CAP_BASE);
  const currentYear = new Date().getFullYear();
  assignDraftInfo(rosters, currentYear);
  // Stamp the player's current team into their pre-existing career
  // history so veterans show realistic team logos / city names per
  // season (with occasional former-team trades for ~25% of vets).
  assignCareerTeams(rosters);
  return { rosters, teamTiers };
}

// Reroll the draft league while staying on the picker.
async function frnRerollLeague() {
  if (!await _frnConfirm("Reroll the entire league? Every team's roster will be regenerated.")) return;
  franchiseDraft = _buildDraftLeague();
  renderFrnTeamPicker();
}

// "Load Game" handler — opens the saved franchise dashboard
function frnLoadGame() {
  loadFranchise();
  if (!franchise) {
    alert("No saved franchise found.");
    renderFrnStartScreen();
    return;
  }
  showFranchiseDashboard();
}

// Backwards-compat shims — old code paths still call these names
function openFranchiseModal()  { setAppMode("franchise"); showFranchiseHome(); }
function closeFranchiseModal() { /* no-op: franchise is inline now */ }

// ── Initialize new franchise ─────────────────────────────────────────────────
// Graceful fallback for a franchise CREATION failure (distinct from a render
// crash — here no franchise exists yet, so the user is sent back to start, not
// "Home"). Used by startFranchise + frnQuickStart.
function _frnRenderCreateError(err) {
  const host = (typeof $ === "function") ? $("frnHomeContent") : document.getElementById("frnHomeContent");
  const fh   = (typeof $ === "function") ? $("franchiseHome")  : document.getElementById("franchiseHome");
  if (fh) fh.style.display = "block";
  if (!host) { if (typeof renderFrnStartScreen === "function") renderFrnStartScreen(); return; }
  const safeMsg = String((err && err.message) || err || "unknown error").replace(/</g, "&lt;");
  host.innerHTML = `
    <div class="frn-welcome" style="max-width:520px;margin:2rem auto;text-align:center">
      <div class="frn-welcome-title" style="color:var(--gold)">⚠ Couldn't start that franchise</div>
      <div class="frn-welcome-sub" style="margin-top:.5rem">Something went wrong building the league — no franchise was created. Pick a team and try again, or reload.</div>
      <div style="margin-top:1.1rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-gold" onclick="(typeof renderFrnStartScreen==='function'?renderFrnStartScreen():location.reload())">← Back to start</button>
        <button class="btn" onclick="location.reload()">⟳ Reload</button>
      </div>
      <details style="margin-top:1.1rem;text-align:left;font-size:.65rem;color:var(--gray)">
        <summary style="cursor:pointer;color:var(--gold)">Technical details</summary>
        <div style="margin-top:.4rem;font-family:monospace;white-space:pre-wrap;word-break:break-word">${safeMsg}</div>
      </details>
    </div>`;
}

function startFranchise(teamId) {
  // If the user came through the picker, the draft already has fresh rosters,
  // ages, and contracts. Reuse them so the detail-page preview is exactly
  // what they get. Otherwise (legacy entry points) generate fresh.
  // Wrapped: franchise CREATION (build league, generate schedule, init systems)
  // runs OUTSIDE the dashboard's render boundary, so an unguarded throw here
  // would escape the click handler and strand the user on a half-built screen
  // with a broken `franchise` global. On failure: discard the partial state and
  // show a clean "try again" message. (showFranchiseDashboard at the end has its
  // own boundary, so a render glitch is handled there, not here.)
  try {
  const draft = franchiseDraft || _buildDraftLeague();
  franchise = {
    chosenTeamId: teamId,
    season:  1,
    week:    1,
    phase:   "preseason",
    rosters:        draft.rosters,
    teamTiers:      draft.teamTiers,
    salaryCap:      SALARY_CAP_BASE,
    schedule:       generateFranchiseSchedule(),
    standings:      initStandings(),
    playoffBracket: null,
    history:        [],
    pendingFranchiseGame: null,
    _offChanges:    null,
    seasonStats:    {},
    seasonHighlights: [],
    superBowlGame:  null,
    ir:             {},   // teamId -> [injured-reserve players] (off the active 53, still paid)
    _irReturnsUsed: {},   // teamId -> designated-to-return activations used this season
  };
  franchiseDraft = null;
  _initFranchisePicks();
  _initCoachingStaff();
  _initFrontOffice();
  _seedPracticeSquads();
  if (typeof _seedCollegePipeline === "function") _seedCollegePipeline();
  saveFranchise();
  showFranchiseDashboard();
  return true;
  } catch (err) {
    console.error("[startFranchise] creation failed:", err);
    // Discard the half-built franchise so no broken global lingers, show a clean
    // "try again" message, and return false so callers (e.g. frnQuickStart) bail
    // instead of running post-creation logic on a null franchise.
    try { franchise = null; franchiseDraft = null; } catch (_e) {}
    _frnRenderCreateError(err);
    return false;
  }
}

