// teams.js — the 32 GridironChain franchises. Moved OUT of TeamNFT's constructor
// (its inline string literals blew the EIP-3860 init-code limit, making the
// contract undeployable). The owner now seeds this metadata post-deploy via
// TeamNFT.setTeams(ids, data) — data travels in calldata, not in the contract
// bytecode. deploy.js consumes this; the TeamNFT test uses a slice of it.
"use strict";

const TEAMS = [
  { id: 1,  city: "New Albion",  name: "Kraken",     mascot: "Kraken",    conference: "AFC", division: "East",  primaryColor: "#00264D", secondaryColor: "#C8A900" },
  { id: 2,  city: "Stonehaven",  name: "Titans",     mascot: "Titan",     conference: "AFC", division: "East",  primaryColor: "#4B92DB", secondaryColor: "#C8102E" },
  { id: 3,  city: "Ironport",    name: "Wolves",     mascot: "Wolf",      conference: "AFC", division: "East",  primaryColor: "#1A1A1A", secondaryColor: "#C0392B" },
  { id: 4,  city: "Coldwater",   name: "Buccaneers", mascot: "Buccaneer", conference: "AFC", division: "East",  primaryColor: "#0072CE", secondaryColor: "#E8C100" },
  { id: 5,  city: "Steelforge",  name: "Hammers",    mascot: "Hammer",    conference: "AFC", division: "North", primaryColor: "#FFB612", secondaryColor: "#101820" },
  { id: 6,  city: "Riverdale",   name: "Grizzlies",  mascot: "Grizzly",   conference: "AFC", division: "North", primaryColor: "#FB4F14", secondaryColor: "#003831" },
  { id: 7,  city: "Coalport",    name: "Ravens",     mascot: "Raven",     conference: "AFC", division: "North", primaryColor: "#241773", secondaryColor: "#000000" },
  { id: 8,  city: "Lakewood",    name: "Bulldogs",   mascot: "Bulldog",   conference: "AFC", division: "North", primaryColor: "#0B162A", secondaryColor: "#C83803" },
  { id: 9,  city: "Sunbelt",     name: "Vipers",     mascot: "Viper",     conference: "AFC", division: "South", primaryColor: "#002244", secondaryColor: "#B0B7BC" },
  { id: 10, city: "Palmetto",    name: "Jaguars",    mascot: "Jaguar",    conference: "AFC", division: "South", primaryColor: "#006778", secondaryColor: "#D7A22A" },
  { id: 11, city: "Bayou",       name: "Gators",     mascot: "Gator",     conference: "AFC", division: "South", primaryColor: "#03202F", secondaryColor: "#D3BC8D" },
  { id: 12, city: "Redrock",     name: "Stallions",  mascot: "Stallion",  conference: "AFC", division: "South", primaryColor: "#4F2683", secondaryColor: "#C8A900" },
  { id: 13, city: "Desert",      name: "Scorpions",  mascot: "Scorpion",  conference: "AFC", division: "West",  primaryColor: "#002244", secondaryColor: "#C60C30" },
  { id: 14, city: "Silicon",     name: "Raiders",    mascot: "Raider",    conference: "AFC", division: "West",  primaryColor: "#101820", secondaryColor: "#A5ACAF" },
  { id: 15, city: "Cascade",     name: "Thunder",    mascot: "Thunder",   conference: "AFC", division: "West",  primaryColor: "#002C5F", secondaryColor: "#FB4F14" },
  { id: 16, city: "Frontier",    name: "Outlaws",    mascot: "Outlaw",    conference: "AFC", division: "West",  primaryColor: "#E31837", secondaryColor: "#002A5C" },
  { id: 17, city: "Capitol",     name: "Sentinels",  mascot: "Sentinel",  conference: "NFC", division: "East",  primaryColor: "#003594", secondaryColor: "#C60C30" },
  { id: 18, city: "Metro",       name: "Predators",  mascot: "Predator",  conference: "NFC", division: "East",  primaryColor: "#004C54", secondaryColor: "#A5ACAF" },
  { id: 19, city: "Eastport",    name: "Eagles",     mascot: "Eagle",     conference: "NFC", division: "East",  primaryColor: "#004C54", secondaryColor: "#69BE28" },
  { id: 20, city: "Colonial",    name: "Minutemen",  mascot: "Minuteman", conference: "NFC", division: "East",  primaryColor: "#003366", secondaryColor: "#C8A900" },
  { id: 21, city: "Great Lakes", name: "Frost",      mascot: "Frost",     conference: "NFC", division: "North", primaryColor: "#4F2683", secondaryColor: "#FFC62F" },
  { id: 22, city: "Ironwood",    name: "Vikings",    mascot: "Viking",    conference: "NFC", division: "North", primaryColor: "#4F2683", secondaryColor: "#FFC62F" },
  { id: 23, city: "Prairie",     name: "Wolves",     mascot: "Wolf",      conference: "NFC", division: "North", primaryColor: "#203731", secondaryColor: "#FFB612" },
  { id: 24, city: "Blizzard",    name: "Bears",      mascot: "Bear",      conference: "NFC", division: "North", primaryColor: "#0B162A", secondaryColor: "#C83803" },
  { id: 25, city: "Magnolia",    name: "Saints",     mascot: "Saint",     conference: "NFC", division: "South", primaryColor: "#D3BC8D", secondaryColor: "#101820" },
  { id: 26, city: "Gulf",        name: "Marauders",  mascot: "Marauder",  conference: "NFC", division: "South", primaryColor: "#D50A0A", secondaryColor: "#346B38" },
  { id: 27, city: "Swamp",       name: "Kings",      mascot: "King",      conference: "NFC", division: "South", primaryColor: "#002244", secondaryColor: "#D3BC8D" },
  { id: 28, city: "Peach State", name: "Falcons",    mascot: "Falcon",    conference: "NFC", division: "South", primaryColor: "#A71930", secondaryColor: "#000000" },
  { id: 29, city: "Pacific",     name: "Surge",      mascot: "Surge",     conference: "NFC", division: "West",  primaryColor: "#002244", secondaryColor: "#C8A900" },
  { id: 30, city: "Redwood",     name: "Giants",     mascot: "Giant",     conference: "NFC", division: "West",  primaryColor: "#0B2265", secondaryColor: "#A71930" },
  { id: 31, city: "Canyon",      name: "Hawks",      mascot: "Hawk",      conference: "NFC", division: "West",  primaryColor: "#002244", secondaryColor: "#69BE28" },
  { id: 32, city: "Volcanic",    name: "Fury",       mascot: "Fury",      conference: "NFC", division: "West",  primaryColor: "#97233F", secondaryColor: "#000000" },
];

// Solidity Team struct order: (name, city, conference, division, primaryColor, secondaryColor, mascot).
function toStructTuple(t) {
  return [t.name, t.city, t.conference, t.division, t.primaryColor, t.secondaryColor, t.mascot];
}

module.exports = { TEAMS, toStructTuple };
