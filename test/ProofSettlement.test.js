// ProofSettlement.test.js — proves the optimistic proof-settlement contract with
// a Chainlink VRF v2 seed: VRF request/fulfill, bonded propose/challenge,
// challenge window, finalize, and slash-on-dispute. Uses Chainlink's
// VRFCoordinatorV2Mock (MegaETH testnet has no live coordinator). Run: npx hardhat test
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BOND = ethers.parseEther("0.1");
const WINDOW = 3600;
const KEY_HASH = ethers.id("test-key-hash");
const BASE_FEE = ethers.parseEther("0.1");      // mock LINK base fee per request
const GAS_PRICE_LINK = 1_000_000_000n;          // mock LINK/gas

const matchId = ethers.id("season1-week1-NYG-DAL");
const artifactHash = ethers.id("inputs:{seed,rosters,tape}");
const TRUTH = ethers.id("canonical-result-hash");
const LIE = ethers.id("tampered-result-hash");

const S = { None: 0n, AwaitingSeed: 1n, Seeded: 2n, Proposed: 3n, Challenged: 4n, Finalized: 5n, Voided: 6n };

const eventArg = (rc, iface, name, arg) => {
  for (const l of rc.logs) {
    try { const p = iface.parseLog(l); if (p && p.name === name) return p.args[arg]; } catch (e) {}
  }
  return undefined;
};

describe("ProofSettlement (VRF v2 seed)", function () {
  let vrf, ps, subId, owner, home, away, runner, challenger, other;

  beforeEach(async function () {
    [owner, home, away, runner, challenger, other] = await ethers.getSigners();
    vrf = await ethers.deployContract("VRFCoordinatorV2Mock", [BASE_FEE, GAS_PRICE_LINK]);
    const rc = await (await vrf.createSubscription()).wait();
    subId = eventArg(rc, vrf.interface, "SubscriptionCreated", "subId");
    await vrf.fundSubscription(subId, ethers.parseEther("100")); // 100 LINK
    ps = await ethers.deployContract("ProofSettlement", [await vrf.getAddress(), subId, KEY_HASH, BOND, WINDOW]);
    await vrf.addConsumer(subId, await ps.getAddress());
  });

  // open a match + fulfill the VRF request → Seeded. Returns the requestId used.
  async function seedMatch(mid = matchId, h = home, a = away, word = null) {
    const rc = await (await ps.openMatch(mid, h.address, a.address)).wait();
    const requestId = eventArg(rc, ps.interface, "SeedRequested", "requestId");
    if (word === null) await vrf.fulfillRandomWords(requestId, await ps.getAddress());
    else await vrf.fulfillRandomWordsWithOverride(requestId, await ps.getAddress(), [word]);
    return requestId;
  }
  async function proposed(by = runner, rh = TRUTH) {
    await seedMatch();
    await ps.connect(by).propose(matchId, artifactHash, rh, 24, 17, { value: BOND });
  }

  describe("VRF seed", function () {
    it("openMatch requests VRF randomness and sits AwaitingSeed", async function () {
      const rc = await (await ps.openMatch(matchId, home.address, away.address)).wait();
      expect(eventArg(rc, ps.interface, "MatchOpened", "home")).to.equal(home.address);
      const requestId = eventArg(rc, ps.interface, "SeedRequested", "requestId");
      expect(requestId).to.not.be.undefined;
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.AwaitingSeed);
      expect(m.seed).to.equal(ethers.ZeroHash);          // no seed until fulfilled
    });

    it("the VRF callback fixes seed = keccak(randomWord, matchId) and flips to Seeded", async function () {
      const rc = await (await ps.openMatch(matchId, home.address, away.address)).wait();
      const requestId = eventArg(rc, ps.interface, "SeedRequested", "requestId");
      const word = 123456789n;
      await expect(vrf.fulfillRandomWordsWithOverride(requestId, await ps.getAddress(), [word]))
        .to.emit(ps, "Seeded");
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Seeded);
      expect(m.seed).to.equal(ethers.solidityPackedKeccak256(["uint256", "bytes32"], [word, matchId]));
    });

    it("only the VRF coordinator can fulfill (callback is access-controlled)", async function () {
      const rc = await (await ps.openMatch(matchId, home.address, away.address)).wait();
      const requestId = eventArg(rc, ps.interface, "SeedRequested", "requestId");
      // a non-coordinator calling the raw callback is rejected by VRFConsumerBaseV2
      await expect(ps.connect(other).rawFulfillRandomWords(requestId, [7])).to.be.reverted;
    });

    it("rejects re-open and self-match", async function () {
      await ps.openMatch(matchId, home.address, away.address);
      await expect(ps.openMatch(matchId, home.address, away.address)).to.be.revertedWith("PS: exists");
      await expect(ps.openMatch(ethers.id("m2"), home.address, home.address)).to.be.revertedWith("PS: bad players");
    });
  });

  describe("propose", function () {
    it("requires a seeded match, the exact bond, and a non-empty result", async function () {
      // not seeded yet: open but don't fulfill the VRF request
      await ps.openMatch(matchId, home.address, away.address);   // AwaitingSeed
      await expect(ps.connect(runner).propose(matchId, artifactHash, TRUTH, 24, 17, { value: BOND }))
        .to.be.revertedWith("PS: not seeded");
      // a separate, fully seeded match for the bond/result guards
      const m2 = ethers.id("m2");
      await seedMatch(m2);
      await expect(ps.connect(runner).propose(m2, artifactHash, TRUTH, 24, 17, { value: BOND / 2n }))
        .to.be.revertedWith("PS: bad bond");
      await expect(ps.connect(runner).propose(m2, artifactHash, ethers.ZeroHash, 24, 17, { value: BOND }))
        .to.be.revertedWith("PS: empty result");
    });

    it("stores the bonded proposal and locks the bond", async function () {
      await seedMatch();
      const tx = await ps.connect(runner).propose(matchId, artifactHash, TRUTH, 24, 17, { value: BOND });
      await expect(tx).to.emit(ps, "Proposed").withArgs(matchId, runner.address, artifactHash, TRUTH, 24, 17);
      await expect(tx).to.changeEtherBalances([runner, ps], [-BOND, BOND]);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Proposed);
      expect(m.proposer).to.equal(runner.address);
      expect(m.resultHash).to.equal(TRUTH);
    });
  });

  describe("challenge", function () {
    it("requires the window open, the exact bond, a real conflict, and not self", async function () {
      await proposed();
      await expect(ps.connect(challenger).challenge(matchId, TRUTH, 24, 17, { value: BOND }))
        .to.be.revertedWith("PS: not a conflict");
      await expect(ps.connect(runner).challenge(matchId, LIE, 0, 0, { value: BOND }))
        .to.be.revertedWith("PS: self challenge");
      await expect(ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND / 2n }))
        .to.be.revertedWith("PS: bad bond");
    });

    it("rejects a challenge after the window has closed", async function () {
      await proposed();
      await time.increase(WINDOW + 1);
      await expect(ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND }))
        .to.be.revertedWith("PS: window closed");
    });

    it("records a conflicting challenge and locks the second bond", async function () {
      await proposed();
      const tx = await ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND });
      await expect(tx).to.emit(ps, "Challenged").withArgs(matchId, challenger.address, LIE, 14, 21);
      await expect(tx).to.changeEtherBalances([challenger, ps], [-BOND, BOND]);
      expect((await ps.getMatch(matchId)).status).to.equal(S.Challenged);
      expect(await ethers.provider.getBalance(await ps.getAddress())).to.equal(BOND * 2n);
    });
  });

  describe("finalize (unchallenged)", function () {
    it("only after the window, and not while challenged", async function () {
      await proposed();
      await expect(ps.finalize(matchId)).to.be.revertedWith("PS: window open");
      await ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND });
      await time.increase(WINDOW + 1);
      await expect(ps.finalize(matchId)).to.be.revertedWith("PS: not proposed");
    });

    it("settles the proposed result and refunds the proposer's bond", async function () {
      await proposed();
      await time.increase(WINDOW + 1);
      await expect(ps.finalize(matchId)).to.emit(ps, "Finalized").withArgs(matchId, TRUTH, 24, 17, false);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Finalized);
      expect(m.finalResultHash).to.equal(TRUTH);
      expect(await ps.withdrawable(runner.address)).to.equal(BOND);
      await expect(ps.connect(runner).withdraw()).to.changeEtherBalance(runner, BOND);
      expect(await ethers.provider.getBalance(await ps.getAddress())).to.equal(0);
    });
  });

  describe("resolve (disputed)", function () {
    async function disputed() {
      await proposed(runner, TRUTH);
      await ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND });
    }

    it("only the resolver may resolve", async function () {
      await disputed();
      await expect(ps.connect(other).resolve(matchId, TRUTH)).to.be.revertedWith("PS: not resolver");
    });

    it("honest proposer wins the whole pot when re-sim confirms their hash", async function () {
      await disputed();
      await expect(ps.resolve(matchId, TRUTH))
        .to.emit(ps, "Resolved").withArgs(matchId, TRUTH, runner.address);
      expect(await ps.withdrawable(runner.address)).to.equal(BOND * 2n);
      expect(await ps.withdrawable(challenger.address)).to.equal(0);
      expect((await ps.getMatch(matchId)).finalResultHash).to.equal(TRUTH);
    });

    it("CHEAT STORY: a false proposal is slashed; the honest challenger's truth settles", async function () {
      await seedMatch();
      await ps.connect(runner).propose(matchId, artifactHash, LIE, 99, 0, { value: BOND });
      await ps.connect(challenger).challenge(matchId, TRUTH, 24, 17, { value: BOND });
      await expect(ps.resolve(matchId, TRUTH))
        .to.emit(ps, "Resolved").withArgs(matchId, TRUTH, challenger.address);
      expect(await ps.withdrawable(challenger.address)).to.equal(BOND * 2n);
      expect(await ps.withdrawable(runner.address)).to.equal(0);
      const m = await ps.getMatch(matchId);
      expect(m.finalResultHash).to.equal(TRUTH);
      expect(m.finalHomeScore).to.equal(24);
      expect(m.finalAwayScore).to.equal(17);
    });

    it("voids and slashes BOTH bonds to the treasury when neither hash is correct", async function () {
      await disputed();
      await expect(ps.resolve(matchId, ethers.id("a-third-result")))
        .to.emit(ps, "Voided").withArgs(matchId);
      expect(await ps.withdrawable(owner.address)).to.equal(BOND * 2n);
      expect((await ps.getMatch(matchId)).status).to.equal(S.Voided);
    });
  });

  describe("admin: resolver + vrf config + voidStuck + withdraw guards", function () {
    it("owner can rotate the resolver; the new resolver can adjudicate", async function () {
      await expect(ps.setResolver(ethers.ZeroAddress)).to.be.revertedWith("PS: zero resolver");
      await expect(ps.connect(other).setResolver(other.address))
        .to.be.revertedWithCustomError(ps, "OwnableUnauthorizedAccount");
      await ps.setResolver(other.address);
      await proposed(runner, TRUTH);
      await ps.connect(challenger).challenge(matchId, LIE, 0, 0, { value: BOND });
      await ps.connect(other).resolve(matchId, TRUTH);
      expect(await ps.withdrawable(runner.address)).to.equal(BOND * 2n);
    });

    it("owner can update the VRF config", async function () {
      const newKey = ethers.id("new-key");
      await expect(ps.connect(other).setVrfConfig(9, newKey, 500000))
        .to.be.revertedWithCustomError(ps, "OwnableUnauthorizedAccount");
      await expect(ps.setVrfConfig(9, newKey, 500000)).to.emit(ps, "VrfConfigChanged").withArgs(9, newKey, 500000);
      expect(await ps.keyHash()).to.equal(newKey);
      expect(await ps.callbackGasLimit()).to.equal(500000);
    });

    it("voidStuck clears a pre-stake match but refuses one carrying bonds", async function () {
      await seedMatch();
      await expect(ps.connect(other).voidStuck(matchId))
        .to.be.revertedWithCustomError(ps, "OwnableUnauthorizedAccount");
      await ps.voidStuck(matchId);
      expect((await ps.getMatch(matchId)).status).to.equal(S.Voided);
      const m2 = ethers.id("m2");
      await seedMatch(m2);
      await ps.connect(runner).propose(m2, artifactHash, TRUTH, 1, 0, { value: BOND });
      await expect(ps.voidStuck(m2)).to.be.revertedWith("PS: has stake");
    });

    it("withdraw is single-shot and rejects empty balances", async function () {
      await expect(ps.connect(other).withdraw()).to.be.revertedWith("PS: nothing to withdraw");
      await proposed();
      await time.increase(WINDOW + 1);
      await ps.finalize(matchId);
      await ps.connect(runner).withdraw();
      await expect(ps.connect(runner).withdraw()).to.be.revertedWith("PS: nothing to withdraw");
    });
  });

  it("bond accounting: contract holds exactly the locked bonds, zero after payout", async function () {
    const addr = await ps.getAddress();
    expect(await ethers.provider.getBalance(addr)).to.equal(0);
    await proposed();
    expect(await ethers.provider.getBalance(addr)).to.equal(BOND);
    await ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND });
    expect(await ethers.provider.getBalance(addr)).to.equal(BOND * 2n);
    await ps.resolve(matchId, TRUTH);
    await ps.connect(runner).withdraw();
    expect(await ethers.provider.getBalance(addr)).to.equal(0);
  });
});
