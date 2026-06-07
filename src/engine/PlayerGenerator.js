// ─── Player generation for off-chain simulation ───────────────────────────────

export const POSITIONS = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];

export const POSITION_ENUM = { QB:0, RB:1, WR:2, TE:3, OL:4, DL:5, LB:6, CB:7, S:8, K:9, P:10 };
export const ENUM_POSITION = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];

// Standard 53-man roster breakdown per team
export const ROSTER_SLOTS = { QB:3, RB:4, WR:6, TE:3, OL:8, DL:6, LB:5, CB:5, S:3, K:1, P:1 };

const FIRST = [
  "Marcus","Tyler","Darius","Jordan","Malik","Devon","Elijah","Xavier","Cameron","Jaylen",
  "Trevor","Caleb","Nathan","Brandon","Derrick","Antonio","Deon","Travon","Rasheed","Quincy",
  "Zach","Hunter","Brayden","Cole","Jake","Ryan","Luke","Evan","Aaron","Chris",
  "Isaiah","Deion","Jamal","Tyrone","Kobe","Lamar","Dwayne","Terrell","Andre","Reggie",
  "DeSean","Davante","Stefon","Amari","Cooper","Tee","Travis","Kelce","George","Patrick",
];
const LAST = [
  "Johnson","Williams","Brown","Jones","Davis","Miller","Wilson","Moore","Taylor","Anderson",
  "Thomas","Jackson","White","Harris","Martin","Thompson","Garcia","Martinez","Robinson","Clark",
  "Rodriguez","Lewis","Lee","Walker","Hall","Allen","Young","Hill","Flores","Green",
  "Adams","Nelson","Baker","Carter","Mitchell","Perez","Roberts","Turner","Phillips","Campbell",
  "Evans","Edwards","Collins","Stewart","Sanchez","Morris","Rogers","Reed","Cook","Morgan",
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

export function randomName() {
  return `${FIRST[rand(0, FIRST.length - 1)]} ${LAST[rand(0, LAST.length - 1)]}`;
}

// Returns array: [speed,strength,agility,awareness,throwing,catching,blocking,passRush,coverage,tackle,kickPower]
export function generateStats(position, tier = "average") {
  const r = {
    elite:   { lo: 78, hi: 99 },
    good:    { lo: 63, hi: 80 },
    average: { lo: 48, hi: 67 },
    poor:    { lo: 35, hi: 54 },
  }[tier] || { lo: 48, hi: 67 };

  const b = () => rand(r.lo, r.hi);
  const l = () => rand(Math.max(30, r.lo - 14), Math.max(45, r.hi - 14));

  switch (position) {
    case "QB": return [l(), l(), b(), b(), b(), l(), l(), l(), l(), l(), l()];
    case "RB": return [b(), b(), b(), b(), l(), b(), l(), l(), l(), l(), l()];
    case "WR": return [b(), l(), b(), b(), l(), b(), l(), l(), b(), l(), l()];
    case "TE": return [b(), b(), b(), b(), l(), b(), b(), l(), l(), l(), l()];
    case "OL": return [l(), b(), b(), b(), l(), l(), b(), l(), l(), l(), l()];
    case "DL": return [b(), b(), b(), b(), l(), l(), l(), b(), l(), b(), l()];
    case "LB": return [b(), b(), b(), b(), l(), l(), l(), b(), b(), b(), l()];
    case "CB": return [b(), l(), b(), b(), l(), l(), l(), l(), b(), b(), l()];
    case "S":  return [b(), b(), b(), b(), l(), l(), l(), l(), b(), b(), l()];
    default:   return [l(), l(), l(), b(), l(), l(), l(), l(), l(), l(), b()]; // K/P
  }
}

export function calcOverall(position, stats) {
  const [spd, str, agi, awr, thr, cat, blk, prs, cov, tck, kpw] = stats;
  let v;
  switch (position) {
    case "QB": v = spd*10 + agi*15 + awr*25 + thr*50; break;
    case "RB": v = spd*35 + str*20 + agi*25 + cat*20; break;
    case "WR": v = spd*30 + agi*25 + cat*35 + awr*10; break;
    case "TE": v = spd*20 + cat*40 + blk*30 + str*10; break;
    case "OL": v = str*35 + blk*45 + agi*20;           break;
    case "DL": v = str*35 + prs*40 + spd*25;           break;
    case "LB": v = prs*25 + cov*25 + tck*30 + spd*20; break;
    case "CB": v = spd*30 + agi*25 + cov*35 + awr*10; break;
    case "S":  v = spd*25 + cov*35 + tck*30 + awr*10; break;
    default:   v = kpw*50 + awr*50;                    break;
  }
  return Math.min(99, Math.max(40, Math.round(v / 100)));
}

export function generatePlayer(position, tier = "average") {
  const stats = generateStats(position, tier);
  const overall = calcOverall(position, stats);
  const age = (position === "K" || position === "P") ? rand(22, 38) : rand(21, 33);

  const salaryBase = { QB:5000, RB:1500, WR:2500, TE:2000, OL:2000, DL:2000, LB:1500, CB:2000, S:1500, K:500, P:400 };
  const tierMult   = { elite:4.2, good:2.5, average:1.2, poor:0.7 };
  const salary = Math.round(salaryBase[position] * (tierMult[tier] || 1.2) * (0.8 + Math.random() * 0.4));

  return {
    name:     randomName(),
    position,
    age,
    stats,
    overall,
    salary,
    contractYears: tier === "elite" ? rand(3, 5) : tier === "good" ? rand(2, 4) : rand(1, 3),
    tier,
  };
}

export function generateDraftClass(size = 200) {
  const prospects = [];
  const dist = [
    { tier: "elite",   n: Math.floor(size * 0.05) },
    { tier: "good",    n: Math.floor(size * 0.22) },
    { tier: "average", n: Math.floor(size * 0.50) },
    { tier: "poor",    n: size - Math.floor(size * 0.77) },
  ];

  for (const { tier, n } of dist) {
    for (let i = 0; i < n; i++) {
      const pos = POSITIONS[rand(0, POSITIONS.length - 1)];
      prospects.push(generatePlayer(pos, tier));
    }
  }
  return prospects.sort((a, b) => b.overall - a.overall);
}

// Generate a full 53-man roster for a team (used for local simulation)
export function generateRoster(teamId) {
  const roster = [];
  for (const [pos, count] of Object.entries(ROSTER_SLOTS)) {
    for (let i = 0; i < count; i++) {
      const tier = i === 0 ? "good" : i === 1 ? "average" : "poor";
      roster.push({ id: null, teamId, ...generatePlayer(pos, tier) });
    }
  }
  return roster;
}
