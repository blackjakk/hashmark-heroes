// LeagueManager.test.js — proves the PROVEN-outcome wiring: a match settled in
// ProofSettlement (Chainlink VRF seed → bonded propose → finalize/resolve) is
// pulled into LeagueManager standings via ingestResult(), with NO typed-in
// scores and a team-owner binding that rejects spoofed matches.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BOND = ethers.parseEther("0.1");
const WINDOW = 3600;
const HOME_ID = 1n, AWAY_ID = 2n;

const KEY_HASH = ethers.id("key-hash");
const BASE_FEE = ethers.parseEther("0.1");
const GAS_PRICE_LINK = 1_000_000_000n;
const artifactHash = ethers.id("inputs");
const TRUTH = ethers.id("canonical-result");
const LIE = ethers.id("tampered-result");

const eventArg = (rc, iface, name, arg) => {
  for (const l of rc.logs) { try { const p = iface.parseLog(l); if (p && p.name === name) return p.args[arg]; } catch (e) {} }
  return undefined;
};

describe("LeagueManager × ProofSettlement (proven standings)", function () {
  let gt, team, ps, lm, vrf, subId;
  let owner, homeOwner, awayOwner, runner, challenger, other;

  // Acquire a franchise NFT through the real GRID purchase flow → ownerOf(teamId).
  async function buyTeam(buyer, teamId) {
    const price = await team.TEAM_PRICE();
    await gt.mintReward(buyer.address, price);
    await gt.connect(buyer).approve(await team.getAddress(), price);
    await team.connect(buyer).purchaseTeam(teamId);
  }

  // Open a match and fulfill its VRF request → Seeded (mock coordinator).
  async function seedOnchain(matchId, homeSigner, awaySigner) {
    const rc = await (await ps.openMatch(matchId, homeSigner.address, awaySigner.address)).wait();
    const requestId = eventArg(rc, ps.interface, "SeedRequested", "requestId");
    await vrf.fulfillRandomWords(requestId, await ps.getAddress());
  }

  // Settle a ProofSettlement match (happy path) between two seats with a result.
  async function settle(matchId, homeSigner, awaySigner, hs, as_, rh = TRUTH) {
    await seedOnchain(matchId, homeSigner, awaySigner);
    await ps.connect(runner).propose(matchId, artifactHash, rh, hs, as_, { value: BOND });
    await time.increase(WINDOW + 1);
    await ps.finalize(matchId);
  }

  const game = (homeId, awayId, week, matchId) =>
    [homeId, awayId, week, 0, 0, false, matchId, ethers.ZeroHash];

  beforeEach(async function () {
    [owner, homeOwner, awayOwner, runner, challenger, other] = await ethers.getSigners();
    gt = await ethers.deployContract("GridironToken");
    team = await ethers.deployContract("TeamNFT", [await gt.getAddress()]);   // real, now-deployable NFT
    vrf = await ethers.deployContract("VRFCoordinatorV2Mock", [BASE_FEE, GAS_PRICE_LINK]);
    const subRc = await (await vrf.createSubscription()).wait();
    subId = eventArg(subRc, vrf.interface, "SubscriptionCreated", "subId");
    await vrf.fundSubscription(subId, ethers.parseEther("100"));
    ps = await ethers.deployContract("ProofSettlement", [await vrf.getAddress(), subId, KEY_HASH, BOND, WINDOW]);
    await vrf.addConsumer(subId, await ps.getAddress());
    lm = await ethers.deployContract("LeagueManager", [await team.getAddress(), await gt.getAddress()]);
    await lm.setProofSettlement(await ps.getAddress());
    await buyTeam(homeOwner, HOME_ID);   // ownerOf(HOME_ID) = homeOwner
    await buyTeam(awayOwner, AWAY_ID);
    // season 1 → advance to PreSeason so setSchedule is allowed
    await lm.startSeason();   // FreeAgency
    await lm.advancePhase();  // Draft
    await lm.advancePhase();  // PreSeason
    await lm.setSchedule([game(HOME_ID, AWAY_ID, 1, ethers.id("g0"))]);
  });

  describe("setProofSettlement", function () {
    it("only owner, non-zero", async function () {
      await expect(lm.connect(other).setProofSettlement(await ps.getAddress()))
        .to.be.revertedWithCustomError(lm, "OwnableUnauthorizedAccount");
      await expect(lm.setProofSettlement(ethers.ZeroAddress)).to.be.revertedWith("LM: zero settlement");
      expect(await lm.proofSettlement()).to.equal(await ps.getAddress());
    });
  });

  describe("ingestResult — happy path", function () {
    it("pulls a finalized home win into standings (no typed-in score)", async function () {
      await settle(ethers.id("g0"), homeOwner, awayOwner, 24, 17, TRUTH);
      await expect(lm.ingestResult(0))
        .to.emit(lm, "GameRecorded").withArgs(1, 1, HOME_ID, AWAY_ID, 24, 17)
        .and.to.emit(lm, "GameSettled").withArgs(1, 0, ethers.id("g0"), TRUTH, 24, 17);

      const hr = await lm.getRecord(1, HOME_ID);
      const ar = await lm.getRecord(1, AWAY_ID);
      expect(hr.wins).to.equal(1n); expect(hr.losses).to.equal(0n);
      expect(hr.pointsFor).to.equal(24n); expect(hr.pointsAgainst).to.equal(17n);
      expect(ar.losses).to.equal(1n); expect(ar.wins).to.equal(0n);
      expect(ar.pointsFor).to.equal(17n); expect(ar.pointsAgainst).to.equal(24n);

      const sched = await lm.getSchedule(1);
      expect(sched[0].played).to.equal(true);
      expect(sched[0].homeScore).to.equal(24);
      expect(sched[0].resultHash).to.equal(TRUTH);   // provenance recorded
    });

    it("is permissionless — anyone can trigger ingestion of proven data", async function () {
      await settle(ethers.id("g0"), homeOwner, awayOwner, 13, 31, TRUTH);
      await lm.connect(other).ingestResult(0);     // not owner, still works
      const ar = await lm.getRecord(1, AWAY_ID);
      expect(ar.wins).to.equal(1n);                // away win recorded correctly
    });

    it("records ties symmetrically", async function () {
      await settle(ethers.id("g0"), homeOwner, awayOwner, 20, 20, TRUTH);
      await lm.ingestResult(0);
      const hr = await lm.getRecord(1, HOME_ID);
      const ar = await lm.getRecord(1, AWAY_ID);
      expect(hr.ties).to.equal(1n); expect(ar.ties).to.equal(1n);
      expect(hr.wins).to.equal(0n); expect(ar.losses).to.equal(0n);
    });
  });

  describe("ingestResult — guards", function () {
    it("rejects when no settlement is configured", async function () {
      const lm2 = await ethers.deployContract("LeagueManager", [await team.getAddress(), await gt.getAddress()]);
      await lm2.startSeason(); await lm2.advancePhase(); await lm2.advancePhase();
      await lm2.setSchedule([game(HOME_ID, AWAY_ID, 1, ethers.id("g0"))]);
      await expect(lm2.ingestResult(0)).to.be.revertedWith("LM: no settlement");
    });

    it("rejects a game with no linked matchId", async function () {
      await lm.setSchedule([game(HOME_ID, AWAY_ID, 2, ethers.ZeroHash)]);  // gameIdx 1
      await expect(lm.ingestResult(1)).to.be.revertedWith("LM: no matchId");
    });

    it("rejects an unfinalized match", async function () {
      // open + seed + propose but DON'T finalize (still in challenge window)
      const mid = ethers.id("g0");
      await seedOnchain(mid, homeOwner, awayOwner);
      await ps.connect(runner).propose(mid, artifactHash, TRUTH, 24, 17, { value: BOND });
      await expect(lm.ingestResult(0)).to.be.revertedWith("LM: not finalized");
    });

    it("rejects double ingestion", async function () {
      await settle(ethers.id("g0"), homeOwner, awayOwner, 24, 17, TRUTH);
      await lm.ingestResult(0);
      await expect(lm.ingestResult(0)).to.be.revertedWith("LM: already played");
    });
  });

  describe("ingestResult — anti-spoof team binding", function () {
    it("rejects a finalized match whose seats aren't the franchise owners", async function () {
      // a valid, finalized match — but played between the WRONG addresses
      // (runner & challenger), not the home/away franchise owners.
      await settle(ethers.id("g0"), runner, challenger, 99, 0, TRUTH);
      await expect(lm.ingestResult(0)).to.be.revertedWith("LM: team/owner mismatch");
    });

    it("rejects when only one seat matches (home spoofed)", async function () {
      await settle(ethers.id("g0"), other, awayOwner, 7, 3, TRUTH);
      await expect(lm.ingestResult(0)).to.be.revertedWith("LM: team/owner mismatch");
    });
  });

  describe("disputed match settles into standings via the resolved truth", function () {
    it("a slashed false proposal yields the challenger's truth in the standings", async function () {
      const mid = ethers.id("g0");
      await seedOnchain(mid, homeOwner, awayOwner);
      // proposer LIES (28-0); challenger posts the canonical TRUTH (21-24)
      await ps.connect(runner).propose(mid, artifactHash, LIE, 28, 0, { value: BOND });
      await ps.connect(challenger).challenge(mid, TRUTH, 21, 24, { value: BOND });
      await ps.resolve(mid, TRUTH);    // re-sim referee confirms the truth
      // standings must reflect the RESOLVED truth (away win 24-21), not the lie
      await lm.ingestResult(0);
      const hr = await lm.getRecord(1, HOME_ID);
      const ar = await lm.getRecord(1, AWAY_ID);
      expect(ar.wins).to.equal(1n); expect(hr.losses).to.equal(1n);
      expect(hr.pointsFor).to.equal(21n); expect(ar.pointsFor).to.equal(24n);
      const sched = await lm.getSchedule(1);
      expect(sched[0].resultHash).to.equal(TRUTH);
    });
  });
});
