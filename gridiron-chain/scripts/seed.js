/**
 * Seed script — mints a draft class of 200 prospects and opens the first draft.
 * Run AFTER deploy.js.
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Inline stat generator (mirrors src/engine/PlayerGenerator.js)
const POSITIONS = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
const POSITION_ENUM = { QB:0,RB:1,WR:2,TE:3,OL:4,DL:5,LB:6,CB:7,S:8,K:9,P:10 };

const FIRST = ["Marcus","Tyler","Darius","Jordan","Malik","Devon","Elijah","Xavier","Cameron","Jaylen","Trevor","Caleb","Nathan","Brandon","Derrick","Antonio","Deon","Travon","Rasheed","Quincy","Zach","Hunter","Brayden","Cole","Jake","Ryan","Luke","Evan","Aaron","Chris","Isaiah","Deion","Jamal","Tyrone","Kobe","Lamar","Dwayne","Terrell","Andre","Reggie"];
const LAST  = ["Johnson","Williams","Brown","Jones","Davis","Miller","Wilson","Moore","Taylor","Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Garcia","Martinez","Robinson","Clark","Rodriguez","Lewis","Lee","Walker","Hall","Allen","Young","Hill","Flores","Green","Adams","Nelson","Baker","Carter","Mitchell","Perez","Roberts","Turner","Phillips","Campbell"];

function rand(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }
function name() { return `${FIRST[rand(0,FIRST.length-1)]} ${LAST[rand(0,LAST.length-1)]}`; }

function statBlock(pos, tier) {
  const ranges = { elite:{lo:78,hi:99}, good:{lo:63,hi:80}, average:{lo:48,hi:67}, poor:{lo:35,hi:54} };
  const {lo,hi} = ranges[tier];
  const b = () => rand(lo, hi);
  const l = () => rand(Math.max(30,lo-12), Math.max(45,hi-12));
  switch(pos) {
    case "QB":  return [l(),l(),b(),b(),b(),l(),l(),l(),l(),l(),l()];
    case "RB":  return [b(),b(),b(),b(),l(),b(),l(),l(),l(),l(),l()];
    case "WR":  return [b(),l(),b(),b(),l(),b(),l(),l(),b(),l(),l()];
    case "TE":  return [b(),b(),b(),b(),l(),b(),b(),l(),l(),l(),l()];
    case "OL":  return [l(),b(),b(),b(),l(),l(),b(),l(),l(),l(),l()];
    case "DL":  return [b(),b(),b(),b(),l(),l(),l(),b(),l(),b(),l()];
    case "LB":  return [b(),b(),b(),b(),l(),l(),l(),b(),b(),b(),l()];
    case "CB":  return [b(),l(),b(),b(),l(),l(),l(),l(),b(),b(),l()];
    case "S":   return [b(),b(),b(),b(),l(),l(),l(),l(),b(),b(),l()];
    default:    return [l(),l(),l(),b(),l(),l(),l(),l(),l(),l(),b()]; // K/P
  }
}

function salary(pos, tier) {
  const base = {QB:5000,RB:1500,WR:2500,TE:2000,OL:2000,DL:2000,LB:1500,CB:2000,S:1500,K:500,P:400};
  const mult = {elite:4,good:2.5,average:1.2,poor:0.8};
  return Math.round(base[pos] * mult[tier] * (Math.random()*0.4+0.8)) * 10**18;
}

function makeProspect() {
  const r = Math.random();
  const tier = r < 0.05 ? "elite" : r < 0.25 ? "good" : r < 0.75 ? "average" : "poor";
  const pos  = POSITIONS[rand(0, POSITIONS.length-1)];
  return { name: name(), pos, age: rand(21,24), stats: statBlock(pos, tier), salary: salary(pos, tier), tier };
}

async function main() {
  const addrs = JSON.parse(fs.readFileSync(path.join(__dirname,"../src/contracts/addresses.json")));
  const [deployer] = await ethers.getSigners();

  const playerNFT  = await ethers.getContractAt("PlayerNFT",  addrs.playerNFT,  deployer);
  const draftSys   = await ethers.getContractAt("DraftSystem", addrs.draftSystem, deployer);
  const leagueMgr  = await ethers.getContractAt("LeagueManager", addrs.leagueManager, deployer);

  const DRAFT_SIZE = 200;
  console.log(`Minting ${DRAFT_SIZE} prospects...`);

  const prospectIds = [];
  for (let i = 0; i < DRAFT_SIZE; i++) {
    const p = makeProspect();
    const statsArr = p.stats.map(v => v); // uint8[11]
    const tx = await playerNFT.mint(
      addrs.draftSystem,          // mint to DraftSystem escrow
      p.name,
      POSITION_ENUM[p.pos],
      p.age,
      {
        speed:      statsArr[0], strength:  statsArr[1],
        agility:    statsArr[2], awareness: statsArr[3],
        throwing:   statsArr[4], catching:  statsArr[5],
        blocking:   statsArr[6], passRush:  statsArr[7],
        coverage:   statsArr[8], tackle:    statsArr[9],
        kickPower:  statsArr[10]
      },
      BigInt(Math.round(p.salary)),
      1n  // season 1
    );
    const receipt = await tx.wait();
    // Extract tokenId from PlayerMinted event
    const event = receipt.logs
      .map(l => { try { return playerNFT.interface.parseLog(l); } catch { return null; } })
      .find(e => e && e.name === "PlayerMinted");
    if (event) prospectIds.push(event.args.id);
    if ((i+1) % 20 === 0) console.log(`  ${i+1}/${DRAFT_SIZE} minted`);
  }

  console.log(`\nOpening draft for season 1 with ${prospectIds.length} prospects...`);

  // Default draft order 1..32 (will be updated after first season)
  const order = Array.from({length:32},(_,i)=>i+1);
  await (await draftSys.setDraftOrder(order)).wait();
  await (await draftSys.openDraft(1n, prospectIds.map(BigInt))).wait();

  // Start season 1
  await (await leagueMgr.startSeason()).wait();
  console.log("Season 1 started — phase: FreeAgency");

  console.log("\n=== Seed complete ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
