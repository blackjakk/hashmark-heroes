// 80 fictional colleges across 8 conferences in 3 tiers.
// Conference names are placeholders — easy to swap.

export const CONFERENCES = [
  // ── ELITE TIER (3 conferences × 12 schools = 36) ────────────────────
  { id: "ACL", name: "Atlantic Coast League",    tier: "ELITE",
    schools: ["Westshore U","Bayview State","Coastal Tech","Charleston Royals","Norfolk Maritime","Carolina Pines","Tidewater U","Cape Bay","Newport Hall","Annapolis Naval","Richmond Falls","Savannah Magnolia"] },
  { id: "GPC", name: "Great Plains Conference",  tier: "ELITE",
    schools: ["Heartland U","Cornbelt State","Prairie Ridge","Iron Plains","Sioux Valley","Lakeshore U","Northern Lights","Bluebird State","Wheatfield","Steel Plains","Forge Valley","Ironforge U"] },
  { id: "PAC", name: "Pacific Athletic Conf.",   tier: "ELITE",
    schools: ["Bay Area U","Sierra Tech","Pacific Crest","Redwood State","Sunset U","Surf City","Goldcoast","Cascade Pines","Mariner U","Tidepool State","Pacific Polytechnic","Westwood"] },

  // ── MID TIER (3 conferences × 10 schools = 30) ──────────────────────
  { id: "MWA", name: "Mountain West Athletic",   tier: "MID",
    schools: ["Highpeak U","Alpine State","Glacier Tech","Summit Valley","Ridgeline","Pinecrest","Aspen Hill","Snowfall U","Rockslide","Boulder Pass"] },
  { id: "AEC", name: "American Eastern Conf.",   tier: "MID",
    schools: ["Eastport U","Hudson Valley","Liberty Hall","Provident State","Old Mill","Founders U","Quaker Tech","Cobblestone","Capital East","Greenwich"] },
  { id: "HC",  name: "Heartland Conference",     tier: "MID",
    schools: ["Cornfield U","Tractor Tech","Silo State","Meadowlark","Cottonwood","Riverbend","Mill Creek","Hayfield U","Barnyard State","Crossroads"] },

  // ── SUB TIER (2 conferences × 7 schools = 14) ───────────────────────
  { id: "FC",  name: "Frontier Conference",      tier: "SUB",
    schools: ["Borderlands U","Outpost State","Frontier Pass","Saddle Ridge","Dustbowl","Wagon Wheel","Lariat State"] },
  { id: "CL",  name: "Coastal League",           tier: "SUB",
    schools: ["Lighthouse U","Driftwood State","Saltmarsh","Beachhead","Pierpoint","Harborview","Reef Bay"] },
];

// Build a lookup: school name → { conference, tier }
const SCHOOL_INDEX = {};
for (const c of CONFERENCES) {
  for (const s of c.schools) {
    SCHOOL_INDEX[s] = { school: s, conferenceId: c.id, conferenceName: c.name, tier: c.tier };
  }
}

export function getCollegeInfo(schoolName) {
  return SCHOOL_INDEX[schoolName] || null;
}

export function allSchools() {
  return Object.values(SCHOOL_INDEX);
}

export function schoolsByTier(tier) {
  return Object.values(SCHOOL_INDEX).filter(s => s.tier === tier);
}

// Pick a school for a player based on their true rookie tier and the recruiting bias table.
// `weighted` from random.js handles the actual roll.
import { weighted, pick } from "./random.js";
import { RECRUITING_BIAS } from "./constants.js";

export function pickCollege(rng, rookieTier) {
  const bias = RECRUITING_BIAS[rookieTier];
  const targetTier = weighted(rng, bias);
  const candidates = schoolsByTier(targetTier);
  return pick(rng, candidates);
}
