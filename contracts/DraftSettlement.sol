// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";

/// @title DraftSettlement — optimistic, challenge-by-re-derivation settlement of a
/// league-genesis FANTASY DRAFT, with a Chainlink VRF v2 pool seed.
/// @notice The on-chain tier (S3) of FANTASY_DRAFT_DESIGN.md. Off-chain, the whole
/// draft is the pure function (poolSeed + settings + pickTape) → 32 rosters; the
/// league server mints artifactHash = sha256(poolSeed, year, rounds, order, tape)
/// and resultHash = sha256(derived rosters), and ANY client re-derives + verifies
/// (play-league-client.js shows the VERIFIED badge; server/draft-verify.js is the
/// standalone referee tool). This contract makes that contract trustless:
///
///   1. UNFORGEABLE POOL SEED (Chainlink VRF v2). `openDraft` requests a
///      verifiable random word; the callback fixes `seed = keccak(word, draftId)`.
///      The off-chain generator's uint32 poolSeed MUST be derived as
///      `uint32(uint256(seed))` (see `poolSeed()`); nobody — commissioner, server
///      operator, or GM — can re-roll for a favorable player pool. This closes
///      the one seed surface the off-chain tier leaves to the server.
///   2. BONDED PROPOSE. After the draft completes off-chain, a runner posts the
///      claimed `(artifactHash, resultHash)` with a bond. artifactHash binds the
///      INPUTS {poolSeed, year, rounds, order, tape}; resultHash the OUTCOME.
///   3. OPTIMISTIC CHALLENGE. Anyone may, within `challengeWindow`, post a
///      CONFLICTING resultHash with a matching bond. Re-deriving the public
///      artifact is deterministic (the seeded generator draws every value from
///      one mulberry32 stream), so an honest challenger always reproduces the
///      true resultHash.
///   4. SETTLE. Unchallenged → finalize, bond reclaimed. Challenged → the
///      `resolver` re-derives the artifact (server/draft-verify.js) and supplies
///      the canonical resultHash; the matching side takes both bonds.
///
/// The chain never replays the draft — it adjudicates hashes of a public,
/// independently re-derivable artifact. `LeagueManager.ingestGenesisDraft` then
/// PULLS the finalized hashes as the league's immutable roster genesis.
///
/// LIMITATION (documented, not hidden): the artifact commits to the tape the
/// server published. A server that FABRICATES a GM's pick produces a valid,
/// re-derivable artifact — hash adjudication ALONE can't catch it. CLOSED at
/// the off-chain artifact layer (2026-07): key-registered GMs sign every pick
/// (ECDSA P-256 over hh-pick|leagueId|i|teamId|pid; auto-picks league-server-
/// signed; full sigTape + keys served with the draft state and re-verified by
/// league-probe's referee recipe). On-chain signature adjudication inside this
/// contract remains a future tier; today a challenger presents the signed
/// artifact off-chain and the wronged GM's on-chain recourse is still the
/// challenge window before ingestion.
contract DraftSettlement is VRFConsumerBaseV2, Ownable {
    VRFCoordinatorV2Interface public immutable COORDINATOR;
    uint256 public immutable bondAmount;       // wei required to propose or challenge
    uint256 public immutable challengeWindow;  // seconds a proposal stays open

    // VRF config (owner-settable for testnet/mainnet wiring).
    uint64  public subscriptionId;
    bytes32 public keyHash;
    uint32  public callbackGasLimit = 200000;
    uint16  public constant REQUEST_CONFIRMATIONS = 3;
    uint32  public constant NUM_WORDS = 1;

    address public resolver;                   // the re-derivation referee (defaults to owner)

    enum Status {
        None,         // 0 unknown
        AwaitingSeed, // 1 VRF requested, awaiting fulfillment
        Seeded,       // 2 pool seed fixed; draft may run off-chain
        Proposed,     // 3 bonded result posted; challenge window open
        Challenged,   // 4 conflicting bonded result; awaiting resolve
        Finalized,    // 5 settled
        Voided        // 6 cancelled
    }

    struct Draft {
        address opener;        // who opened it (informational; ids should be coordinator-chosen)
        uint256 vrfRequestId;
        bytes32 seed;          // canonical; off-chain poolSeed = uint32(uint256(seed))
        Status  status;
        // ── settlement ──
        address proposer;
        uint256 proposerBond;
        bytes32 artifactHash;  // sha256(poolSeed, year, rounds, order, tape) — league-server canonical
        bytes32 resultHash;    // sha256(order-mapped rosters of pids)
        uint64  proposedAt;
        address challenger;
        uint256 challengerBond;
        bytes32 chResultHash;
        // ── outcome ──
        bytes32 finalArtifactHash;
        bytes32 finalResultHash;
    }

    mapping(bytes32 => Draft) public drafts;            // draftId => Draft
    mapping(uint256 => bytes32) public requestToDraft;  // VRF requestId => draftId
    mapping(address => uint256) public withdrawable;    // pull-payment ledger

    event DraftOpened(bytes32 indexed draftId, address indexed opener);
    event SeedRequested(bytes32 indexed draftId, uint256 indexed requestId);
    event Seeded(bytes32 indexed draftId, bytes32 seed, uint32 poolSeed);
    event Proposed(bytes32 indexed draftId, address indexed proposer, bytes32 artifactHash, bytes32 resultHash);
    event Challenged(bytes32 indexed draftId, address indexed challenger, bytes32 resultHash);
    event Finalized(bytes32 indexed draftId, bytes32 artifactHash, bytes32 resultHash, bool disputed);
    event Resolved(bytes32 indexed draftId, bytes32 correctResultHash, address winner);
    event Voided(bytes32 indexed draftId);
    event Withdrawal(address indexed who, uint256 amount);
    event ResolverChanged(address indexed resolver);
    event VrfConfigChanged(uint64 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit);

    constructor(
        address _vrfCoordinator,
        uint64  _subscriptionId,
        bytes32 _keyHash,
        uint256 _bondAmount,
        uint256 _challengeWindow
    ) VRFConsumerBaseV2(_vrfCoordinator) Ownable(msg.sender) {
        COORDINATOR     = VRFCoordinatorV2Interface(_vrfCoordinator);
        subscriptionId  = _subscriptionId;
        keyHash         = _keyHash;
        bondAmount      = _bondAmount;
        challengeWindow = _challengeWindow;
        resolver        = msg.sender;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "DS: not resolver");
        _;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setResolver(address r) external onlyOwner {
        require(r != address(0), "DS: zero resolver");
        resolver = r;
        emit ResolverChanged(r);
    }

    function setVrfConfig(uint64 _subscriptionId, bytes32 _keyHash, uint32 _callbackGasLimit) external onlyOwner {
        subscriptionId   = _subscriptionId;
        keyHash          = _keyHash;
        callbackGasLimit = _callbackGasLimit;
        emit VrfConfigChanged(_subscriptionId, _keyHash, _callbackGasLimit);
    }

    // ─── 1. Open + VRF pool seed ────────────────────────────────────────────

    /// Open a draft and REQUEST its VRF pool seed. Permissionless — the id
    /// should be an unpredictable, coordinator-chosen value (same discipline as
    /// ProofSettlement matchIds) so a griefer can't squat the league's intended
    /// draftId. The seed exists BEFORE any pick: the off-chain lobby locks its
    /// settings, opens the draft here, waits for `Seeded`, and only then builds
    /// the pool from `poolSeed(draftId)`.
    function openDraft(bytes32 draftId) external returns (uint256 requestId) {
        Draft storage d = drafts[draftId];
        require(d.status == Status.None, "DS: exists");
        d.opener = msg.sender;
        d.status = Status.AwaitingSeed;
        requestId = COORDINATOR.requestRandomWords(keyHash, subscriptionId, REQUEST_CONFIRMATIONS, callbackGasLimit, NUM_WORDS);
        d.vrfRequestId = requestId;
        requestToDraft[requestId] = draftId;
        emit DraftOpened(draftId, msg.sender);
        emit SeedRequested(draftId, requestId);
    }

    /// VRF callback — fixes the canonical seed. MUST NOT revert (Chainlink best
    /// practice), so a stray/duplicate fulfillment is ignored.
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        bytes32 draftId = requestToDraft[requestId];
        Draft storage d = drafts[draftId];
        if (d.status != Status.AwaitingSeed) return;
        d.seed   = keccak256(abi.encodePacked(randomWords[0], draftId));
        d.status = Status.Seeded;
        emit Seeded(draftId, d.seed, uint32(uint256(d.seed)));
    }

    /// The uint32 the off-chain generator must use as its mulberry32 poolSeed.
    function poolSeed(bytes32 draftId) external view returns (uint32) {
        Draft storage d = drafts[draftId];
        require(uint8(d.status) >= uint8(Status.Seeded), "DS: not seeded");
        return uint32(uint256(d.seed));
    }

    // ─── 2. Bonded propose / 3. challenge ───────────────────────────────────

    function propose(bytes32 draftId, bytes32 artifactHash, bytes32 resultHash) external payable {
        Draft storage d = drafts[draftId];
        require(d.status == Status.Seeded, "DS: not seeded");
        require(msg.value == bondAmount, "DS: bad bond");
        require(artifactHash != bytes32(0) && resultHash != bytes32(0), "DS: empty hash");
        d.proposer     = msg.sender;
        d.proposerBond = msg.value;
        d.artifactHash = artifactHash;
        d.resultHash   = resultHash;
        d.proposedAt   = uint64(block.timestamp);
        d.status       = Status.Proposed;
        emit Proposed(draftId, msg.sender, artifactHash, resultHash);
    }

    function challenge(bytes32 draftId, bytes32 resultHash) external payable {
        Draft storage d = drafts[draftId];
        require(d.status == Status.Proposed, "DS: not proposed");
        require(block.timestamp <= d.proposedAt + challengeWindow, "DS: window closed");
        require(msg.value == bondAmount, "DS: bad bond");
        require(resultHash != d.resultHash, "DS: not a conflict");
        require(msg.sender != d.proposer, "DS: self challenge");
        d.challenger     = msg.sender;
        d.challengerBond = msg.value;
        d.chResultHash   = resultHash;
        d.status         = Status.Challenged;
        emit Challenged(draftId, msg.sender, resultHash);
    }

    // ─── 4. Settle ──────────────────────────────────────────────────────────

    function finalize(bytes32 draftId) external {
        Draft storage d = drafts[draftId];
        require(d.status == Status.Proposed, "DS: not proposed");
        require(block.timestamp > d.proposedAt + challengeWindow, "DS: window open");
        d.status            = Status.Finalized;
        d.finalArtifactHash = d.artifactHash;
        d.finalResultHash   = d.resultHash;
        _credit(d.proposer, d.proposerBond);
        emit Finalized(draftId, d.artifactHash, d.resultHash, false);
    }

    /// Resolve a DISPUTED draft. The resolver re-derives the public artifact
    /// (server/draft-verify.js) and supplies the canonical resultHash. The
    /// matching side takes the whole pot; if NEITHER matches, both bonds are
    /// slashed to the treasury and the draft is voided.
    function resolve(bytes32 draftId, bytes32 correctResultHash) external onlyResolver {
        Draft storage d = drafts[draftId];
        require(d.status == Status.Challenged, "DS: not challenged");
        uint256 pot = d.proposerBond + d.challengerBond;
        if (correctResultHash == d.resultHash) {
            d.status            = Status.Finalized;
            d.finalArtifactHash = d.artifactHash;
            d.finalResultHash   = d.resultHash;
            _credit(d.proposer, pot);
            emit Resolved(draftId, correctResultHash, d.proposer);
            emit Finalized(draftId, d.artifactHash, d.resultHash, true);
        } else if (correctResultHash == d.chResultHash) {
            // The challenger proved the proposed rosters wrong. The artifact
            // itself remains the public record; the draft is voided so an
            // honest proposal can be re-run against the same seed.
            d.status = Status.Voided;
            _credit(d.challenger, pot);
            emit Resolved(draftId, correctResultHash, d.challenger);
            emit Voided(draftId);
        } else {
            d.status = Status.Voided;
            _credit(owner(), pot);
            emit Resolved(draftId, correctResultHash, address(0));
            emit Voided(draftId);
        }
    }

    /// Owner escape hatch for drafts stuck before a proposal (e.g. VRF never
    /// fulfilled). Cannot touch a draft that already carries bonds.
    function voidStuck(bytes32 draftId) external onlyOwner {
        Draft storage d = drafts[draftId];
        require(d.status == Status.AwaitingSeed || d.status == Status.Seeded, "DS: has stake");
        d.status = Status.Voided;
        emit Voided(draftId);
    }

    // ─── Pull-payment withdrawals ───────────────────────────────────────────

    function _credit(address who, uint256 amount) internal {
        if (amount > 0) withdrawable[who] += amount;
    }

    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "DS: nothing to withdraw");
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "DS: transfer failed");
        emit Withdrawal(msg.sender, amount);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getDraft(bytes32 draftId) external view returns (Draft memory) {
        return drafts[draftId];
    }

    /// Lean settlement view for consumers (LeagueManager genesis ingestion):
    /// the PROVEN draft artifact/result of a finalized draft + its seed.
    function settledDraft(bytes32 draftId) external view returns (
        bool finalized, bytes32 artifactHash, bytes32 resultHash, bytes32 seed
    ) {
        Draft storage d = drafts[draftId];
        finalized = d.status == Status.Finalized;
        return (finalized, d.finalArtifactHash, d.finalResultHash, d.seed);
    }
}
