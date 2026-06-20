// ProofSettlement.test.js — proves the optimistic proof-settlement contract:
// commit-reveal seed, bonded propose/challenge, challenge window, finalize, and
// slash-on-dispute. Run: npx hardhat test
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BOND = ethers.parseEther("0.1");
const WINDOW = 3600; // 1 hour

const matchId = ethers.id("season1-week1-NYG-DAL");
const nonceH = ethers.id("home-secret-nonce");
const nonceA = ethers.id("away-secret-nonce");
const artifactHash = ethers.id("inputs:{seed,rosters,tape}");
const TRUTH = ethers.id("canonical-result-hash");       // what re-sim produces
const LIE = ethers.id("tampered-result-hash");          // a cheat / wrong claim

const commitOf = (mid, who, nonce) =>
  ethers.solidityPackedKeccak256(["bytes32", "address", "bytes32"], [mid, who, nonce]);
const seedOf = (nh, na) =>
  ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [nh, na]);

// Status enum mirror
const S = { None: 0n, Committing: 1n, Seeded: 2n, Proposed: 3n, Challenged: 4n, Finalized: 5n, Voided: 6n };

describe("ProofSettlement", function () {
  let ps, owner, home, away, runner, challenger, other;

  beforeEach(async function () {
    [owner, home, away, runner, challenger, other] = await ethers.getSigners();
    ps = await ethers.deployContract("ProofSettlement", [BOND, WINDOW]);
  });

  async function openAndSeed() {
    await ps.openMatch(matchId, home.address, away.address);
    await ps.connect(home).commit(matchId, commitOf(matchId, home.address, nonceH));
    await ps.connect(away).commit(matchId, commitOf(matchId, away.address, nonceA));
    await ps.connect(home).reveal(matchId, nonceH);
    await ps.connect(away).reveal(matchId, nonceA);
  }
  async function proposed(by = runner, rh = TRUTH) {
    await openAndSeed();
    await ps.connect(by).propose(matchId, artifactHash, rh, 24, 17, { value: BOND });
  }

  describe("commit-reveal seed", function () {
    it("opens a match and tracks both players", async function () {
      await expect(ps.openMatch(matchId, home.address, away.address))
        .to.emit(ps, "MatchOpened").withArgs(matchId, home.address, away.address);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Committing);
      expect(m.home).to.equal(home.address);
      expect(m.away).to.equal(away.address);
    });

    it("rejects re-open, self-match, and a non-player commit", async function () {
      await ps.openMatch(matchId, home.address, away.address);
      await expect(ps.openMatch(matchId, home.address, away.address)).to.be.revertedWith("PS: exists");
      await expect(ps.openMatch(ethers.id("m2"), home.address, home.address)).to.be.revertedWith("PS: bad players");
      await expect(ps.connect(other).commit(matchId, commitOf(matchId, other.address, nonceH)))
        .to.be.revertedWith("PS: not a player");
    });

    it("fixes the canonical seed = keccak(nonceHome, nonceAway) once both reveal", async function () {
      await ps.openMatch(matchId, home.address, away.address);
      await ps.connect(home).commit(matchId, commitOf(matchId, home.address, nonceH));
      await ps.connect(away).commit(matchId, commitOf(matchId, away.address, nonceA));
      await ps.connect(home).reveal(matchId, nonceH);
      // one side revealed → still Committing, no seed yet
      expect((await ps.getMatch(matchId)).status).to.equal(S.Committing);
      await expect(ps.connect(away).reveal(matchId, nonceA))
        .to.emit(ps, "Seeded").withArgs(matchId, seedOf(nonceH, nonceA));
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Seeded);
      expect(m.seed).to.equal(seedOf(nonceH, nonceA));
    });

    it("rejects a reveal whose nonce doesn't match the commitment", async function () {
      await ps.openMatch(matchId, home.address, away.address);
      await ps.connect(home).commit(matchId, commitOf(matchId, home.address, nonceH));
      await expect(ps.connect(home).reveal(matchId, ethers.id("wrong"))).to.be.revertedWith("PS: bad reveal");
    });

    it("seed is unforgeable — depends on BOTH nonces (neither side controls it)", async function () {
      // changing either side's nonce changes the seed → a player who commits
      // first cannot steer the seed without knowing the opponent's nonce.
      expect(seedOf(nonceH, nonceA)).to.not.equal(seedOf(ethers.id("other"), nonceA));
      expect(seedOf(nonceH, nonceA)).to.not.equal(seedOf(nonceH, ethers.id("other")));
      // contract pure helpers agree with the off-chain computation
      expect(await ps.seedFor(nonceH, nonceA)).to.equal(seedOf(nonceH, nonceA));
      expect(await ps.commitFor(matchId, home.address, nonceH)).to.equal(commitOf(matchId, home.address, nonceH));
    });
  });

  describe("propose", function () {
    it("requires a seeded match, the exact bond, and a non-empty result", async function () {
      await expect(ps.connect(runner).propose(matchId, artifactHash, TRUTH, 24, 17, { value: BOND }))
        .to.be.revertedWith("PS: not seeded");
      await openAndSeed();
      await expect(ps.connect(runner).propose(matchId, artifactHash, TRUTH, 24, 17, { value: BOND / 2n }))
        .to.be.revertedWith("PS: bad bond");
      await expect(ps.connect(runner).propose(matchId, artifactHash, ethers.ZeroHash, 24, 17, { value: BOND }))
        .to.be.revertedWith("PS: empty result");
    });

    it("stores the bonded proposal and locks the bond", async function () {
      await openAndSeed();
      const tx = await ps.connect(runner).propose(matchId, artifactHash, TRUTH, 24, 17, { value: BOND });
      await expect(tx).to.emit(ps, "Proposed").withArgs(matchId, runner.address, artifactHash, TRUTH, 24, 17);
      await expect(tx).to.changeEtherBalances([runner, ps], [-BOND, BOND]);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Proposed);
      expect(m.proposer).to.equal(runner.address);
      expect(m.resultHash).to.equal(TRUTH);
      expect(m.homeScore).to.equal(24);
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
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Challenged);
      expect(m.challenger).to.equal(challenger.address);
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
      await expect(ps.finalize(matchId))
        .to.emit(ps, "Finalized").withArgs(matchId, TRUTH, 24, 17, false);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Finalized);
      expect(m.finalResultHash).to.equal(TRUTH);
      expect(await ps.withdrawable(runner.address)).to.equal(BOND);
      // pull-payment: proposer withdraws exactly their bond back
      await expect(ps.connect(runner).withdraw()).to.changeEtherBalance(runner, BOND);
      expect(await ethers.provider.getBalance(await ps.getAddress())).to.equal(0);
    });
  });

  describe("resolve (disputed)", function () {
    async function disputed() {
      await proposed(runner, TRUTH);                                   // proposer claims truth
      await ps.connect(challenger).challenge(matchId, LIE, 14, 21, { value: BOND }); // challenger lies
    }

    it("only the resolver may resolve", async function () {
      await disputed();
      await expect(ps.connect(other).resolve(matchId, TRUTH)).to.be.revertedWith("PS: not resolver");
    });

    it("honest proposer wins the whole pot when re-sim confirms their hash", async function () {
      await disputed();
      await expect(ps.resolve(matchId, TRUTH))
        .to.emit(ps, "Resolved").withArgs(matchId, TRUTH, runner.address)
        .and.to.emit(ps, "Finalized").withArgs(matchId, TRUTH, 24, 17, true);
      expect(await ps.withdrawable(runner.address)).to.equal(BOND * 2n);
      expect(await ps.withdrawable(challenger.address)).to.equal(0);
      const m = await ps.getMatch(matchId);
      expect(m.status).to.equal(S.Finalized);
      expect(m.finalResultHash).to.equal(TRUTH);
    });

    it("CHEAT STORY: a false proposal is slashed; the honest challenger's truth settles", async function () {
      // proposer posts the LIE, challenger posts the canonical TRUTH (from
      // re-simming the public artifact). The resolver (re-sim referee) confirms
      // TRUTH → the cheating proposer's bond is slashed to the challenger.
      await openAndSeed();
      await ps.connect(runner).propose(matchId, artifactHash, LIE, 99, 0, { value: BOND });
      await ps.connect(challenger).challenge(matchId, TRUTH, 24, 17, { value: BOND });
      await expect(ps.resolve(matchId, TRUTH))
        .to.emit(ps, "Resolved").withArgs(matchId, TRUTH, challenger.address);
      expect(await ps.withdrawable(challenger.address)).to.equal(BOND * 2n);
      expect(await ps.withdrawable(runner.address)).to.equal(0);
      const m = await ps.getMatch(matchId);
      expect(m.finalResultHash).to.equal(TRUTH);   // the real outcome settles
      expect(m.finalHomeScore).to.equal(24);
      expect(m.finalAwayScore).to.equal(17);
    });

    it("voids and slashes BOTH bonds to the treasury when neither hash is correct", async function () {
      await disputed();
      const third = ethers.id("a-third-different-result");
      await expect(ps.resolve(matchId, third))
        .to.emit(ps, "Voided").withArgs(matchId);
      expect(await ps.withdrawable(owner.address)).to.equal(BOND * 2n);
      expect((await ps.getMatch(matchId)).status).to.equal(S.Voided);
    });
  });

  describe("admin: resolver + voidStuck + withdraw guards", function () {
    it("owner can rotate the resolver; the new resolver can adjudicate", async function () {
      await expect(ps.setResolver(ethers.ZeroAddress)).to.be.revertedWith("PS: zero resolver");
      await expect(ps.connect(other).setResolver(other.address))
        .to.be.revertedWithCustomError(ps, "OwnableUnauthorizedAccount");
      await ps.setResolver(other.address);
      await proposed(runner, TRUTH);
      await ps.connect(challenger).challenge(matchId, LIE, 0, 0, { value: BOND });
      await ps.connect(other).resolve(matchId, TRUTH);   // new resolver works
      expect(await ps.withdrawable(runner.address)).to.equal(BOND * 2n);
    });

    it("voidStuck clears a pre-stake match but refuses one carrying bonds", async function () {
      await openAndSeed();
      await expect(ps.connect(other).voidStuck(matchId))
        .to.be.revertedWithCustomError(ps, "OwnableUnauthorizedAccount");
      await ps.voidStuck(matchId);
      expect((await ps.getMatch(matchId)).status).to.equal(S.Voided);
      // a proposed (bonded) match cannot be voided this way
      const m2 = ethers.id("m2");
      await ps.openMatch(m2, home.address, away.address);
      await ps.connect(home).commit(m2, commitOf(m2, home.address, nonceH));
      await ps.connect(away).commit(m2, commitOf(m2, away.address, nonceA));
      await ps.connect(home).reveal(m2, nonceH);
      await ps.connect(away).reveal(m2, nonceA);
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
