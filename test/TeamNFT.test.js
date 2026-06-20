// TeamNFT.test.js — proves the slimmed TeamNFT is DEPLOYABLE (the 32-team string
// literals no longer live in the constructor → init code under the EIP-3860
// limit, runtime under EIP-170) and that metadata still works via the post-deploy
// batch setter. The deploy succeeding in beforeEach IS the headline fix: the old
// constructor reverted with "init code length ... max allowed by EIP-3860".
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { TEAMS, toStructTuple } = require("../scripts/teams.js");

describe("TeamNFT (slimmed, deployable)", function () {
  let gt, team, owner, buyer, other;
  let TEAM_PRICE;

  beforeEach(async function () {
    [owner, buyer, other] = await ethers.getSigners();
    gt = await ethers.deployContract("GridironToken");
    team = await ethers.deployContract("TeamNFT", [await gt.getAddress()]);  // ← was undeployable
    TEAM_PRICE = await team.TEAM_PRICE();
  });

  it("deploys within EVM size limits (init < EIP-3860, runtime < EIP-170)", async function () {
    const addr = await team.getAddress();
    const runtime = await ethers.provider.getCode(addr);
    const runtimeBytes = (runtime.length - 2) / 2;        // strip 0x
    expect(runtimeBytes).to.be.lessThan(24576);           // EIP-170 deployed-size cap
    // init code = factory bytecode + constructor; well under EIP-3860's 49152.
    const initBytes = (TeamNFT_initLength(await ethers.getContractFactory("TeamNFT"))) / 2;
    expect(initBytes).to.be.lessThan(49152);
  });

  it("mints all 32 franchise NFTs to the contract", async function () {
    const addr = await team.getAddress();
    expect(await team.ownerOf(1)).to.equal(addr);
    expect(await team.ownerOf(32)).to.equal(addr);
    expect((await team.availableTeams()).length).to.equal(32);
  });

  describe("setTeams (post-deploy metadata)", function () {
    it("seeds metadata in chunks and getTeam returns it", async function () {
      const CHUNK = 8;
      for (let i = 0; i < TEAMS.length; i += CHUNK) {
        const slice = TEAMS.slice(i, i + CHUNK);
        await team.setTeams(slice.map(t => t.id), slice.map(toStructTuple));
      }
      const t1 = await team.getTeam(1);
      expect(t1.city).to.equal("New Albion");
      expect(t1.name).to.equal("Kraken");
      expect(t1.conference).to.equal("AFC");
      expect(t1.primaryColor).to.equal("#00264D");
      const t32 = await team.getTeam(32);
      expect(t32.name).to.equal("Fury");
      expect(t32.division).to.equal("West");
    });

    it("guards: only owner, matching lengths, valid id range", async function () {
      const one = [toStructTuple(TEAMS[0])];
      await expect(team.connect(other).setTeams([1], one))
        .to.be.revertedWithCustomError(team, "OwnableUnauthorizedAccount");
      await expect(team.setTeams([1, 2], one)).to.be.revertedWith("TeamNFT: length mismatch");
      await expect(team.setTeams([0], one)).to.be.revertedWith("TeamNFT: bad id");
      await expect(team.setTeams([33], one)).to.be.revertedWith("TeamNFT: bad id");
    });

    it("lockMetadata freezes further edits", async function () {
      await team.setTeams([1], [toStructTuple(TEAMS[0])]);
      await expect(team.connect(other).lockMetadata())
        .to.be.revertedWithCustomError(team, "OwnableUnauthorizedAccount");
      await team.lockMetadata();
      expect(await team.metadataLocked()).to.equal(true);
      await expect(team.setTeams([2], [toStructTuple(TEAMS[1])]))
        .to.be.revertedWith("TeamNFT: metadata locked");
    });
  });

  it("purchaseTeam still transfers ownership for GRID", async function () {
    await gt.mintReward(buyer.address, TEAM_PRICE);
    await gt.connect(buyer).approve(await team.getAddress(), TEAM_PRICE);
    await team.connect(buyer).purchaseTeam(5);
    expect(await team.ownerOf(5)).to.equal(buyer.address);
    expect((await team.availableTeams()).length).to.equal(31);
    // can't buy an already-owned franchise
    await expect(team.connect(other).purchaseTeam(5)).to.be.revertedWith("TeamNFT: already owned");
  });
});

// Deployment (init) bytecode length in hex chars, minus the 0x prefix.
function TeamNFT_initLength(factory) {
  const bytecode = factory.bytecode; // creation bytecode (no constructor args here are strings)
  return bytecode.length - 2;
}
