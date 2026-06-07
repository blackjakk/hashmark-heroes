// 32 fictional franchises — matches TeamNFT.sol token IDs 1-32

const TEAMS = [
  // ── AFC East ───────────────────────────────────────────────────────────────
  { id:1,  city:"New Albion",  name:"Kraken",     mascot:"Kraken",    conference:"AFC", division:"East",  primary:"#00264D", secondary:"#C8A900", emoji:"🦑" },
  { id:2,  city:"Stonehaven",  name:"Titans",     mascot:"Titan",     conference:"AFC", division:"East",  primary:"#4B92DB", secondary:"#C8102E", emoji:"⚡" },
  { id:3,  city:"Ironport",    name:"Wolves",     mascot:"Wolf",      conference:"AFC", division:"East",  primary:"#1A1A1A", secondary:"#C0392B", emoji:"🐺" },
  { id:4,  city:"Coldwater",   name:"Buccaneers", mascot:"Buccaneer", conference:"AFC", division:"East",  primary:"#0072CE", secondary:"#E8C100", emoji:"🏴‍☠️" },

  // ── AFC North ──────────────────────────────────────────────────────────────
  { id:5,  city:"Steelforge",  name:"Hammers",    mascot:"Hammer",    conference:"AFC", division:"North", primary:"#FFB612", secondary:"#101820", emoji:"🔨" },
  { id:6,  city:"Riverdale",   name:"Grizzlies",  mascot:"Grizzly",   conference:"AFC", division:"North", primary:"#FB4F14", secondary:"#003831", emoji:"🐻" },
  { id:7,  city:"Coalport",    name:"Ravens",     mascot:"Raven",     conference:"AFC", division:"North", primary:"#241773", secondary:"#000000", emoji:"🦅" },
  { id:8,  city:"Lakewood",    name:"Bulldogs",   mascot:"Bulldog",   conference:"AFC", division:"North", primary:"#0B162A", secondary:"#C83803", emoji:"🐶" },

  // ── AFC South ──────────────────────────────────────────────────────────────
  { id:9,  city:"Sunbelt",     name:"Vipers",     mascot:"Viper",     conference:"AFC", division:"South", primary:"#002244", secondary:"#B0B7BC", emoji:"🐍" },
  { id:10, city:"Palmetto",    name:"Jaguars",    mascot:"Jaguar",    conference:"AFC", division:"South", primary:"#006778", secondary:"#D7A22A", emoji:"🐆" },
  { id:11, city:"Bayou",       name:"Gators",     mascot:"Gator",     conference:"AFC", division:"South", primary:"#03202F", secondary:"#D3BC8D", emoji:"🐊" },
  { id:12, city:"Redrock",     name:"Stallions",  mascot:"Stallion",  conference:"AFC", division:"South", primary:"#4F2683", secondary:"#C8A900", emoji:"🐎" },

  // ── AFC West ───────────────────────────────────────────────────────────────
  { id:13, city:"Desert",      name:"Scorpions",  mascot:"Scorpion",  conference:"AFC", division:"West",  primary:"#002244", secondary:"#C60C30", emoji:"🦂" },
  { id:14, city:"Silicon",     name:"Raiders",    mascot:"Raider",    conference:"AFC", division:"West",  primary:"#101820", secondary:"#A5ACAF", emoji:"⚔️" },
  { id:15, city:"Cascade",     name:"Thunder",    mascot:"Thunder",   conference:"AFC", division:"West",  primary:"#002C5F", secondary:"#FB4F14", emoji:"⛈️" },
  { id:16, city:"Frontier",    name:"Outlaws",    mascot:"Outlaw",    conference:"AFC", division:"West",  primary:"#E31837", secondary:"#002A5C", emoji:"🤠" },

  // ── NFC East ───────────────────────────────────────────────────────────────
  { id:17, city:"Capitol",     name:"Sentinels",  mascot:"Sentinel",  conference:"NFC", division:"East",  primary:"#003594", secondary:"#C60C30", emoji:"🛡️" },
  { id:18, city:"Metro",       name:"Predators",  mascot:"Predator",  conference:"NFC", division:"East",  primary:"#004C54", secondary:"#A5ACAF", emoji:"🦁" },
  { id:19, city:"Eastport",    name:"Eagles",     mascot:"Eagle",     conference:"NFC", division:"East",  primary:"#004C54", secondary:"#69BE28", emoji:"🦅" },
  { id:20, city:"Colonial",    name:"Minutemen",  mascot:"Minuteman", conference:"NFC", division:"East",  primary:"#003366", secondary:"#C8A900", emoji:"🎯" },

  // ── NFC North ──────────────────────────────────────────────────────────────
  { id:21, city:"Great Lakes", name:"Frost",      mascot:"Frost",     conference:"NFC", division:"North", primary:"#4F2683", secondary:"#FFC62F", emoji:"❄️" },
  { id:22, city:"Ironwood",    name:"Vikings",    mascot:"Viking",    conference:"NFC", division:"North", primary:"#4B2E83", secondary:"#FFC62F", emoji:"🪓" },
  { id:23, city:"Prairie",     name:"Wolves",     mascot:"Wolf",      conference:"NFC", division:"North", primary:"#203731", secondary:"#FFB612", emoji:"🐺" },
  { id:24, city:"Blizzard",    name:"Bears",      mascot:"Bear",      conference:"NFC", division:"North", primary:"#0B162A", secondary:"#C83803", emoji:"🐻" },

  // ── NFC South ──────────────────────────────────────────────────────────────
  { id:25, city:"Magnolia",    name:"Saints",     mascot:"Saint",     conference:"NFC", division:"South", primary:"#D3BC8D", secondary:"#101820", emoji:"⚜️" },
  { id:26, city:"Gulf",        name:"Marauders",  mascot:"Marauder",  conference:"NFC", division:"South", primary:"#D50A0A", secondary:"#346B38", emoji:"🏴" },
  { id:27, city:"Swamp",       name:"Kings",      mascot:"King",      conference:"NFC", division:"South", primary:"#002244", secondary:"#D3BC8D", emoji:"👑" },
  { id:28, city:"Peach State", name:"Falcons",    mascot:"Falcon",    conference:"NFC", division:"South", primary:"#A71930", secondary:"#000000", emoji:"🦅" },

  // ── NFC West ───────────────────────────────────────────────────────────────
  { id:29, city:"Pacific",     name:"Surge",      mascot:"Surge",     conference:"NFC", division:"West",  primary:"#002244", secondary:"#C8A900", emoji:"🌊" },
  { id:30, city:"Redwood",     name:"Giants",     mascot:"Giant",     conference:"NFC", division:"West",  primary:"#0B2265", secondary:"#A71930", emoji:"🌲" },
  { id:31, city:"Canyon",      name:"Hawks",      mascot:"Hawk",      conference:"NFC", division:"West",  primary:"#002244", secondary:"#69BE28", emoji:"🦅" },
  { id:32, city:"Volcanic",    name:"Fury",       mascot:"Fury",      conference:"NFC", division:"West",  primary:"#97233F", secondary:"#000000", emoji:"🌋" },
];

export default TEAMS;

export function getTeam(id) {
  return TEAMS.find(t => t.id === Number(id)) || null;
}

export function getConferenceTeams(conf) {
  return TEAMS.filter(t => t.conference === conf);
}

export function getDivisionTeams(conf, div) {
  return TEAMS.filter(t => t.conference === conf && t.division === div);
}
