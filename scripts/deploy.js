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

  // Seed franchise metadata post-deploy (chunked; data rides in calldata, not in
  // the contract bytecode — see scripts/teams.js / TeamNFT.setTeams).
  const { TEAMS, toStructTuple } = require("./teams.js");
  const CHUNK = 8;
  for (let i = 0; i < TEAMS.length; i += CHUNK) {
    const slice = TEAMS.slice(i, i + CHUNK);
    await (await teamNFT.setTeams(slice.map(t => t.id), slice.map(toStructTuple))).wait();
  }
  console.log(`TeamNFT metadata seeded: ${TEAMS.length} teams`);

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

  // ── 7. ProofSettlement (VRF-seeded optimistic settlement) ────────────────────
  // Seed source = Chainlink VRF v2. Supply VRF_COORDINATOR + VRF_SUBSCRIPTION_ID
  // + VRF_KEY_HASH for a real coordinator; with none set (local dry-run, or a
  // chain without Chainlink VRF such as MegaETH testnet today) the script stands
  // up a VRFCoordinatorV2Mock so the whole stack still deploys + wires.
  const eventArg = (rc, iface, name, arg) => {
    for (const l of rc.logs) { try { const p = iface.parseLog(l); if (p && p.name === name) return p.args[arg]; } catch (e) {} }
  };
  const BOND   = ethers.parseEther(process.env.SETTLEMENT_BOND || "0.01");
  const WINDOW = Number(process.env.CHALLENGE_WINDOW || 3600);
  const keyHash = process.env.VRF_KEY_HASH || ethers.ZeroHash;
  let vrfCoordinator = process.env.VRF_COORDINATOR;
  let subId = process.env.VRF_SUBSCRIPTION_ID;
  let vrfMockAddr = null;
  if (vrfCoordinator) {
    if (!subId) throw new Error("VRF_COORDINATOR set but VRF_SUBSCRIPTION_ID missing");
  } else {
    console.log("  (no VRF_COORDINATOR — deploying VRFCoordinatorV2Mock for this network)");
    const Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    const mock = await Mock.deploy(ethers.parseEther("0.1"), 1_000_000_000n);
    await mock.waitForDeployment();
    vrfMockAddr = await mock.getAddress();
    vrfCoordinator = vrfMockAddr;
    const rc = await (await mock.createSubscription()).wait();
    subId = eventArg(rc, mock.interface, "SubscriptionCreated", "subId");
    await (await mock.fundSubscription(subId, ethers.parseEther("100"))).wait();
  }
  const ProofSettlement = await ethers.getContractFactory("ProofSettlement");
  const settlement = await ProofSettlement.deploy(vrfCoordinator, subId, keyHash, BOND, WINDOW);
  await settlement.waitForDeployment();
  const settlementAddr = await settlement.getAddress();
  console.log("ProofSettlement:", settlementAddr, `(bond ${ethers.formatEther(BOND)} ETH, window ${WINDOW}s, sub ${subId})`);
  if (vrfMockAddr) {
    const mock = await ethers.getContractAt("VRFCoordinatorV2Mock", vrfMockAddr);
    await (await mock.addConsumer(subId, settlementAddr)).wait();
  }
  // Link LeagueManager to its proven-result source (replaces the recordResult hole).
  await (await leagueMgr.setProofSettlement(settlementAddr)).wait();
  console.log("LeagueManager → ProofSettlement linked");
  if (process.env.RESOLVER) {
    await (await settlement.setResolver(process.env.RESOLVER)).wait();
    console.log("Resolver set  :", process.env.RESOLVER);
  }

  // ── 8. DraftSettlement (VRF-seeded fantasy-draft genesis settlement) ────────
  // Same VRF wiring + bond/window as ProofSettlement; the resolver's referee
  // tool is server/draft-verify.js (re-derives the artifact via draft-host).
  const DraftSettlement = await ethers.getContractFactory("DraftSettlement");
  const draftSettlement = await DraftSettlement.deploy(vrfCoordinator, subId, keyHash, BOND, WINDOW);
  await draftSettlement.waitForDeployment();
  const draftSettlementAddr = await draftSettlement.getAddress();
  console.log("DraftSettlement:", draftSettlementAddr, `(bond ${ethers.formatEther(BOND)} ETH, window ${WINDOW}s, sub ${subId})`);
  if (vrfMockAddr) {
    const mock = await ethers.getContractAt("VRFCoordinatorV2Mock", vrfMockAddr);
    await (await mock.addConsumer(subId, draftSettlementAddr)).wait();
  }
  await (await leagueMgr.setDraftSettlement(draftSettlementAddr)).wait();
  console.log("LeagueManager → DraftSettlement linked (genesis-draft ingestion)");
  if (process.env.RESOLVER) {
    await (await draftSettlement.setResolver(process.env.RESOLVER)).wait();
  }

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
    gridironToken:  tokenAddr,
    teamNFT:        teamAddr,
    playerNFT:      playerAddr,
    draftSystem:    draftAddr,
    freeAgency:     freeAgencyAddr,
    leagueManager:  leagueAddr,
    proofSettlement: settlementAddr,
    vrfCoordinator: vrfCoordinator,
    vrfMock:        vrfMockAddr,        // null on a real-coordinator deploy
    vrfSubscription: String(subId),
    network:        (await ethers.provider.getNetwork()).name,
    deployedAt:     new Date().toISOString(),
  };

  const net = (await ethers.provider.getNetwork()).name;
  if (net === "hardhat") {
    // Ephemeral in-process node = a DRY-RUN; don't clobber the committed
    // addresses.json with throwaway addresses.
    console.log("\n(dry-run on the in-process hardhat network — addresses NOT written)");
    console.log("\n=== Deployment complete (dry-run) ===");
    return;
  }
  const outDir = path.join(__dirname, "../src/contracts");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "addresses.json"), JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved → src/contracts/addresses.json");
  console.log("\n=== Deployment complete ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
