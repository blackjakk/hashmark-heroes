// DraftSettlement.test.js — proves the on-chain fantasy-draft settlement
// (FANTASY_DRAFT_DESIGN.md S3): VRF pool seed, bonded propose/challenge,
// challenge window, finalize, slash-on-dispute, void-on-successful-challenge
// (a draft has no coherent "challenger's genesis" — re-run against the same
// seed), and LeagueManager.ingestGenesisDraft pulling the proven artifact as
// the season's immutable roster genesis. Run: npx hardhat test
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BOND = ethers.parseEther("0.1");
const WINDOW = 3600;
const KEY_HASH = ethers.id("test-key-hash");
const BASE_FEE = ethers.parseEther("0.1");
const GAS_PRICE_LINK = 1_000_000_000n;

const draftId = ethers.id("league-9e98-genesis-draft");
const ARTIFACT = ethers.id("inputs:{poolSeed,year,rounds,order,tape}");
const TRUTH = ethers.id("canonical-rosters-hash");
const LIE = ethers.id("tampered-rosters-hash");

const S = { None: 0n, AwaitingSeed: 1n, Seeded: 2n, Proposed: 3n, Challenged: 4n, Finalized: 5n, Voided: 6n };

const eventArg = (rc, iface, name, arg) => {
  for (const l of rc.logs) {
    try { const p = iface.parseLog(l); if (p && p.name === name) return p.args[arg]; } catch (e) {}
  }
  return undefined;
};

describe("DraftSettlement (VRF pool seed) + LeagueManager genesis ingestion", function () {
  let vrf, ds, subId, owner, runner, challenger, other;

  beforeEach(async function () {
    [owner, runner, challenger, other] = await ethers.getSigners();
    vrf = await ethers.deployContract("VRFCoordinatorV2Mock", [BASE_FEE, GAS_PRICE_LINK]);
    const rc = await (await vrf.createSubscription()).wait();
    subId = eventArg(rc, vrf.interface, "SubscriptionCreated", "subId");
    await vrf.fundSubscription(subId, ethers.parseEther("100"));
    ds = await ethers.deployContract("DraftSettlement", [await vrf.getAddress(), subId, KEY_HASH, BOND, WINDOW]);
    await vrf.addConsumer(subId, await ds.getAddress());
  });

  async function seedDraft(id = draftId, word = null) {
    const rc = await (await ds.openDraft(id)).wait();
    const requestId = eventArg(rc, ds.interface, "SeedRequested", "requestId");
    if (word === null) await vrf.fulfillRandomWords(requestId, await ds.getAddress());
    else await vrf.fulfillRandomWordsWithOverride(requestId, await ds.getAddress(), [word]);
    return requestId;
  }
  async function proposed(by = runner, rh = TRUTH) {
    await seedDraft();
    await ds.connect(by).propose(draftId, ARTIFACT, rh, { value: BOND });
  }

  describe("VRF pool seed", function () {
    it("openDraft requests randomness and sits AwaitingSeed", async function () {
      const rc = await (await ds.openDraft(draftId)).wait();
      expect(eventArg(rc, ds.interface, "DraftOpened", "opener")).to.equal(owner.address);
      const d = await ds.getDraft(draftId);
      expect(d.status).to.equal(S.AwaitingSeed);
      await expect(ds.openDraft(draftId)).to.be.revertedWith("DS: exists");
    });

    it("fulfillment fixes seed = keccak(word, draftId) and exposes the uint32 poolSeed", async function () {
      await seedDraft(draftId, 777n);
      const d = await ds.getDraft(draftId);
      expect(d.status).to.equal(S.Seeded);
      const expected = ethers.keccak256(ethers.solidityPacked(["uint256", "bytes32"], [777n, draftId]));
      expect(d.seed).to.equal(expected);
      // The off-chain generator's derivation contract: uint32(uint256(seed)).
      expect(await ds.poolSeed(draftId)).to.equal(BigInt(expected) & 0xFFFFFFFFn);
    });

    it("poolSeed reverts before the seed exists", async function () {
      await ds.openDraft(draftId);
      await expect(ds.poolSeed(draftId)).to.be.revertedWith("DS: not seeded");
    });

    it("stray duplicate fulfillment is ignored (no revert, no state change)", async function () {
      const requestId = await seedDraft();
      const before = (await ds.getDraft(draftId)).seed;
      await expect(vrf.fulfillRandomWords(requestId, await ds.getAddress())).to.be.reverted; // mock: already fulfilled
      expect((await ds.getDraft(draftId)).seed).to.equal(before);
    });
  });

  describe("propose / challenge guards", function () {
    it("cannot propose before the seed, without the exact bond, or with empty hashes", async function () {
      await ds.openDraft(draftId);
      await expect(ds.propose(draftId, ARTIFACT, TRUTH, { value: BOND })).to.be.revertedWith("DS: not seeded");
      const rc = await ds.getDraft(draftId);
      await vrf.fulfillRandomWords(rc.vrfRequestId, await ds.getAddress());
      await expect(ds.propose(draftId, ARTIFACT, TRUTH, { value: 1n })).to.be.revertedWith("DS: bad bond");
      await expect(ds.propose(draftId, ARTIFACT, ethers.ZeroHash, { value: BOND })).to.be.revertedWith("DS: empty hash");
    });

    it("challenge requires a real conflict, the bond, the window, and a third party", async function () {
      await proposed();
      await expect(ds.connect(challenger).challenge(draftId, TRUTH, { value: BOND })).to.be.revertedWith("DS: not a conflict");
      await expect(ds.connect(challenger).challenge(draftId, LIE, { value: 1n })).to.be.revertedWith("DS: bad bond");
      await expect(ds.connect(runner).challenge(draftId, LIE, { value: BOND })).to.be.revertedWith("DS: self challenge");
      await time.increase(WINDOW + 1);
      await expect(ds.connect(challenger).challenge(draftId, LIE, { value: BOND })).to.be.revertedWith("DS: window closed");
    });
  });

  describe("settlement paths", function () {
    it("unchallenged → finalize after the window; proposer reclaims the bond", async function () {
      await proposed();
      await expect(ds.finalize(draftId)).to.be.revertedWith("DS: window open");
      await time.increase(WINDOW + 1);
      await ds.finalize(draftId);
      const d = await ds.getDraft(draftId);
      expect(d.status).to.equal(S.Finalized);
      expect(d.finalResultHash).to.equal(TRUTH);
      expect(await ds.withdrawable(runner.address)).to.equal(BOND);
      const [fin, ah, rh] = await ds.settledDraft(draftId);
      expect(fin).to.equal(true);
      expect(ah).to.equal(ARTIFACT);
      expect(rh).to.equal(TRUTH);
    });

    it("honest proposer beats a lying challenger and takes the pot", async function () {
      await proposed(runner, TRUTH);
      await ds.connect(challenger).challenge(draftId, LIE, { value: BOND });
      await ds.resolve(draftId, TRUTH);
      const d = await ds.getDraft(draftId);
      expect(d.status).to.equal(S.Finalized);
      expect(d.finalResultHash).to.equal(TRUTH);
      expect(await ds.withdrawable(runner.address)).to.equal(BOND * 2n);
      expect(await ds.withdrawable(challenger.address)).to.equal(0n);
    });

    it("successful challenge VOIDS the draft (no challenger-genesis) and pays the challenger", async function () {
      await proposed(runner, LIE);                       // proposer lied
      await ds.connect(challenger).challenge(draftId, TRUTH, { value: BOND });
      await ds.resolve(draftId, TRUTH);
      const d = await ds.getDraft(draftId);
      expect(d.status).to.equal(S.Voided);               // re-run an honest proposal vs the same seed
      expect(await ds.withdrawable(challenger.address)).to.equal(BOND * 2n);
      const [fin] = await ds.settledDraft(draftId);
      expect(fin).to.equal(false);                       // a voided draft can never be ingested
    });

    it("neither side right → both slashed to the treasury, draft voided", async function () {
      await proposed(runner, LIE);
      await ds.connect(challenger).challenge(draftId, ethers.id("also-wrong"), { value: BOND });
      await ds.resolve(draftId, TRUTH);
      expect((await ds.getDraft(draftId)).status).to.equal(S.Voided);
      expect(await ds.withdrawable(owner.address)).to.equal(BOND * 2n);
    });

    it("only the resolver resolves; withdraw pays out and zeroes the ledger", async function () {
      await proposed(runner, TRUTH);
      await ds.connect(challenger).challenge(draftId, LIE, { value: BOND });
      await expect(ds.connect(other).resolve(draftId, TRUTH)).to.be.revertedWith("DS: not resolver");
      await ds.resolve(draftId, TRUTH);
      const before = await ethers.provider.getBalance(runner.address);
      await (await ds.connect(runner).withdraw()).wait();
      expect(await ds.withdrawable(runner.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(runner.address)).to.be.greaterThan(before);
      await expect(ds.connect(runner).withdraw()).to.be.revertedWith("DS: nothing to withdraw");
    });

    it("voidStuck only touches bond-free drafts", async function () {
      await seedDraft();
      await ds.voidStuck(draftId);
      expect((await ds.getDraft(draftId)).status).to.equal(S.Voided);
      const id2 = ethers.id("second");
      await seedDraft(id2);
      await ds.connect(runner).propose(id2, ARTIFACT, TRUTH, { value: BOND });
      await expect(ds.voidStuck(id2)).to.be.revertedWith("DS: has stake");
    });
  });

  describe("LeagueManager.ingestGenesisDraft", function () {
    let lm, team, gridToken;

    beforeEach(async function () {
      gridToken = await ethers.deployContract("GridironToken");
      team = await ethers.deployContract("TeamNFT", [await gridToken.getAddress()]);
      lm = await ethers.deployContract("LeagueManager", [await team.getAddress(), await gridToken.getAddress()]);
      await lm.setDraftSettlement(await ds.getAddress());
      await lm.startSeason();                     // → FreeAgency (a roster-building phase)
    });

    async function finalized(rh = TRUTH) {
      await proposed(runner, rh);
      await time.increase(WINDOW + 1);
      await ds.finalize(draftId);
    }

    it("pulls a finalized draft as the season's genesis, exactly once", async function () {
      await finalized();
      await expect(lm.connect(other).ingestGenesisDraft(draftId))   // permissionless: data is proven
        .to.emit(lm, "GenesisDraftSettled");
      const g = await lm.genesisDrafts(1);
      expect(g.set).to.equal(true);
      expect(g.artifactHash).to.equal(ARTIFACT);
      expect(g.resultHash).to.equal(TRUTH);
      await expect(lm.ingestGenesisDraft(draftId)).to.be.revertedWith("LM: genesis already set");
    });

    it("rejects unfinalized drafts and wrong phases", async function () {
      await seedDraft();
      await ds.connect(runner).propose(draftId, ARTIFACT, TRUTH, { value: BOND });
      await expect(lm.ingestGenesisDraft(draftId)).to.be.revertedWith("LM: not finalized");
      await time.increase(WINDOW + 1);
      await ds.finalize(draftId);
      // advance past the roster-building phases: FreeAgency → Draft → PreSeason
      await lm.advancePhase();                    // Draft (still allowed)
      await lm.advancePhase();                    // PreSeason (not allowed)
      await expect(lm.ingestGenesisDraft(draftId)).to.be.revertedWith("LM: wrong phase");
    });

    it("a voided (successfully challenged) draft can never become genesis", async function () {
      await proposed(runner, LIE);
      await ds.connect(challenger).challenge(draftId, TRUTH, { value: BOND });
      await ds.resolve(draftId, TRUTH);           // → Voided
      await expect(lm.ingestGenesisDraft(draftId)).to.be.revertedWith("LM: not finalized");
    });

    it("owner wiring guards", async function () {
      await expect(lm.connect(other).setDraftSettlement(await ds.getAddress())).to.be.reverted;
      await expect(lm.setDraftSettlement(ethers.ZeroAddress)).to.be.revertedWith("LM: zero settlement");
    });
  });
});
