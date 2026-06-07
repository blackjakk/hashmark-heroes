const { ethers } = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying GridironChain contracts");
  console.log("Deployer :", deployer.address);
  console.log("Network  :", (await ethers.provider.getNetwork()).name);

  // ── 1. GRID token ──────────────────────────────────────────────────────────
  const Token = await ethers.getContractFactory("GridironToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("GridironToken :", tokenAddr);

  // ── 2. TeamNFT ─────────────────────────────────────────────────────────────
  const TeamNFT = await ethers.getContractFactory("TeamNFT");
  const teamNFT = await TeamNFT.deploy(tokenAddr);
  await teamNFT.waitForDeployment();
  const teamAddr = await teamNFT.getAddress();
  console.log("TeamNFT       :", teamAddr);

  // ── 3. PlayerNFT ───────────────────────────────────────────────────────────
  const PlayerNFT = await ethers.getContractFactory("PlayerNFT");
  const playerNFT = await PlayerNFT.deploy();
  await playerNFT.waitForDeployment();
  const playerAddr = await playerNFT.getAddress();
  console.log("PlayerNFT     :", playerAddr);

  // ── 4. DraftSystem ─────────────────────────────────────────────────────────
  const DraftSystem = await ethers.getContractFactory("DraftSystem");
  const draftSystem = await DraftSystem.deploy(playerAddr, teamAddr, tokenAddr);
  await draftSystem.waitForDeployment();
  const draftAddr = await draftSystem.getAddress();
  console.log("DraftSystem   :", draftAddr);

  // ── 5. FreeAgency ──────────────────────────────────────────────────────────
  const FreeAgency = await ethers.getContractFactory("FreeAgency");
  const freeAgency = await FreeAgency.deploy(playerAddr, teamAddr, tokenAddr);
  await freeAgency.waitForDeployment();
  const freeAgencyAddr = await freeAgency.getAddress();
  console.log("FreeAgency    :", freeAgencyAddr);

  // ── 6. LeagueManager ───────────────────────────────────────────────────────
  const LeagueManager = await ethers.getContractFactory("LeagueManager");
  const leagueMgr = await LeagueManager.deploy(teamAddr, tokenAddr);
  await leagueMgr.waitForDeployment();
  const leagueAddr = await leagueMgr.getAddress();
  console.log("LeagueManager :", leagueAddr);

  // ── Permissions ────────────────────────────────────────────────────────────
  await (await playerNFT.setMinter(draftAddr, true)).wait();
  await (await playerNFT.setMinter(freeAgencyAddr, true)).wait();
  console.log("Minter permissions granted to DraftSystem and FreeAgency");

  // Fund league prize pool (100 000 GRID)
  const prizeAmount = ethers.parseEther("100000");
  await (await token.approve(leagueAddr, prizeAmount)).wait();
  await (await leagueMgr.fundPrizePool(prizeAmount)).wait();
  console.log("Prize pool funded: 100 000 GRID");

  // ── Persist addresses ──────────────────────────────────────────────────────
  const addresses = {
    gridironToken: tokenAddr,
    teamNFT:       teamAddr,
    playerNFT:     playerAddr,
    draftSystem:   draftAddr,
    freeAgency:    freeAgencyAddr,
    leagueManager: leagueAddr,
    network:       (await ethers.provider.getNetwork()).name,
    deployedAt:    new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "../src/contracts");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "addresses.json"), JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved → src/contracts/addresses.json");
  console.log("\n=== Deployment complete ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
