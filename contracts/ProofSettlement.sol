// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";

/// @title ProofSettlement — optimistic, challenge-by-re-sim match settlement with
/// a Chainlink VRF v2 game seed.
/// @notice Replaces the trust hole in `LeagueManager.recordResult(scores)` (an
/// `onlyOwner` function that takes scores on faith). A match outcome is *proven
/// from a re-simmable artifact*, never typed in by an admin:
///
///   1. UNFORGEABLE SEED (Chainlink VRF v2). `openMatch` requests a verifiable
///      random word from the VRF coordinator; the callback fixes the canonical
///      game seed `keccak(randomWord, matchId)`. No participant — or the
///      operator — can pick or predict it, and there is no commit/reveal step to
///      grief by withholding a reveal.
///   2. BONDED PROPOSE. A runner posts the claimed `(artifactHash, resultHash,
///      score)` with a bond. `artifactHash` binds the INPUTS {seed,rosters,tape};
///      `resultHash` binds the OUTCOME (server/result-hash.js canonical hash).
///   3. OPTIMISTIC CHALLENGE. Anyone may, within `challengeWindow`, post a
///      CONFLICTING `resultHash` with a matching bond. Re-simming the artifact is
///      deterministic ((seed+inputs)->hash, bit-exact in portable math), so an
///      honest challenger can always reproduce the true resultHash.
///   4. SETTLE. Unchallenged after the window -> finalize, proposer reclaims bond.
///      Challenged -> the `resolver` (the re-sim referee; a multisig today, an
///      on-chain verifier / fraud proof later) supplies the canonical resultHash;
///      the matching side takes BOTH bonds, the lying side is slashed.
///
/// The chain never recomputes the game — it adjudicates *hashes* of a public,
/// independently re-simmable artifact (verify with server/verify-artifact.js).
/// Bonds + window are deploy params; the VRF subscription/keyHash are settable.
///
/// NOTE: the VRF seed is the *canonical* game seed; the off-chain match must be
/// simulated with it (the server sources `m.seed` from this contract's seed) for
/// the artifact to re-sim against the on-chain-committed randomness.
contract ProofSettlement is VRFConsumerBaseV2, Ownable {
    VRFCoordinatorV2Interface public immutable COORDINATOR;
    uint256 public immutable bondAmount;       // wei required to propose or challenge
    uint256 public immutable challengeWindow;  // seconds a proposal stays open

    // VRF config (owner-settable for testnet/mainnet wiring).
    uint64  public subscriptionId;
    bytes32 public keyHash;
    uint32  public callbackGasLimit = 200000;
    uint16  public constant REQUEST_CONFIRMATIONS = 3;
    uint32  public constant NUM_WORDS = 1;

    address public resolver;                   // the re-sim referee (defaults to owner)

    enum Status {
        None,         // 0 unknown
        AwaitingSeed, // 1 VRF requested, awaiting fulfillment
        Seeded,       // 2 seed fixed; ready to settle
        Proposed,     // 3 bonded result posted; challenge window open
        Challenged,   // 4 conflicting bonded result; awaiting resolve
        Finalized,    // 5 settled
        Voided        // 6 cancelled
    }

    struct Match {
        address home;
        address away;
        uint256 vrfRequestId;
        bytes32 seed;          // canonical, set in the VRF callback
        Status  status;
        // ── settlement ──
        address proposer;
        uint256 proposerBond;
        bytes32 artifactHash;
        bytes32 resultHash;
        uint8   homeScore;
        uint8   awayScore;
        uint64  proposedAt;
        address challenger;
        uint256 challengerBond;
        bytes32 chResultHash;
        uint8   chHomeScore;
        uint8   chAwayScore;
        // ── outcome ──
        bytes32 finalResultHash;
        uint8   finalHomeScore;
        uint8   finalAwayScore;
    }

    mapping(bytes32 => Match) public matches;        // matchId => Match
    mapping(uint256 => bytes32) public requestToMatch; // VRF requestId => matchId
    mapping(address => uint256) public withdrawable;   // pull-payment ledger

    event MatchOpened(bytes32 indexed matchId, address home, address away);
    event SeedRequested(bytes32 indexed matchId, uint256 indexed requestId);
    event Seeded(bytes32 indexed matchId, bytes32 seed);
    event Proposed(bytes32 indexed matchId, address indexed proposer, bytes32 artifactHash, bytes32 resultHash, uint8 homeScore, uint8 awayScore);
    event Challenged(bytes32 indexed matchId, address indexed challenger, bytes32 resultHash, uint8 homeScore, uint8 awayScore);
    event Finalized(bytes32 indexed matchId, bytes32 resultHash, uint8 homeScore, uint8 awayScore, bool disputed);
    event Resolved(bytes32 indexed matchId, bytes32 correctResultHash, address winner);
    event Voided(bytes32 indexed matchId);
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
        require(msg.sender == resolver, "PS: not resolver");
        _;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setResolver(address r) external onlyOwner {
        require(r != address(0), "PS: zero resolver");
        resolver = r;
        emit ResolverChanged(r);
    }

    function setVrfConfig(uint64 _subscriptionId, bytes32 _keyHash, uint32 _callbackGasLimit) external onlyOwner {
        subscriptionId   = _subscriptionId;
        keyHash          = _keyHash;
        callbackGasLimit = _callbackGasLimit;
        emit VrfConfigChanged(_subscriptionId, _keyHash, _callbackGasLimit);
    }

    // ─── 1. Open + VRF seed ─────────────────────────────────────────────────

    /// Open a match for two players and REQUEST a VRF seed. Permissionless: it
    /// wires the two named addresses and kicks off randomness; the callback fixes
    /// the seed. (The contract must be an approved consumer on `subscriptionId`.)
    function openMatch(bytes32 matchId, address home, address away) external returns (uint256 requestId) {
        require(home != address(0) && away != address(0) && home != away, "PS: bad players");
        Match storage m = matches[matchId];
        require(m.status == Status.None, "PS: exists");
        m.home   = home;
        m.away   = away;
        m.status = Status.AwaitingSeed;
        requestId = COORDINATOR.requestRandomWords(keyHash, subscriptionId, REQUEST_CONFIRMATIONS, callbackGasLimit, NUM_WORDS);
        m.vrfRequestId = requestId;
        requestToMatch[requestId] = matchId;
        emit MatchOpened(matchId, home, away);
        emit SeedRequested(matchId, requestId);
    }

    /// VRF callback — fixes the canonical seed. MUST NOT revert (Chainlink best
    /// practice), so a stray/duplicate fulfillment is ignored.
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        bytes32 matchId = requestToMatch[requestId];
        Match storage m = matches[matchId];
        if (m.status != Status.AwaitingSeed) return;
        m.seed   = keccak256(abi.encodePacked(randomWords[0], matchId));
        m.status = Status.Seeded;
        emit Seeded(matchId, m.seed);
    }

    // ─── 2. Bonded propose / 3. challenge ───────────────────────────────────

    function propose(
        bytes32 matchId,
        bytes32 artifactHash,
        bytes32 resultHash,
        uint8   homeScore,
        uint8   awayScore
    ) external payable {
        Match storage m = matches[matchId];
        require(m.status == Status.Seeded, "PS: not seeded");
        require(msg.value == bondAmount, "PS: bad bond");
        require(resultHash != bytes32(0), "PS: empty result");
        m.proposer     = msg.sender;
        m.proposerBond = msg.value;
        m.artifactHash = artifactHash;
        m.resultHash   = resultHash;
        m.homeScore    = homeScore;
        m.awayScore    = awayScore;
        m.proposedAt   = uint64(block.timestamp);
        m.status       = Status.Proposed;
        emit Proposed(matchId, msg.sender, artifactHash, resultHash, homeScore, awayScore);
    }

    function challenge(
        bytes32 matchId,
        bytes32 resultHash,
        uint8   homeScore,
        uint8   awayScore
    ) external payable {
        Match storage m = matches[matchId];
        require(m.status == Status.Proposed, "PS: not proposed");
        require(block.timestamp <= m.proposedAt + challengeWindow, "PS: window closed");
        require(msg.value == bondAmount, "PS: bad bond");
        require(resultHash != m.resultHash, "PS: not a conflict");
        require(msg.sender != m.proposer, "PS: self challenge");
        m.challenger     = msg.sender;
        m.challengerBond = msg.value;
        m.chResultHash   = resultHash;
        m.chHomeScore    = homeScore;
        m.chAwayScore    = awayScore;
        m.status         = Status.Challenged;
        emit Challenged(matchId, msg.sender, resultHash, homeScore, awayScore);
    }

    // ─── 4. Settle ──────────────────────────────────────────────────────────

    function finalize(bytes32 matchId) external {
        Match storage m = matches[matchId];
        require(m.status == Status.Proposed, "PS: not proposed");
        require(block.timestamp > m.proposedAt + challengeWindow, "PS: window open");
        m.status          = Status.Finalized;
        m.finalResultHash = m.resultHash;
        m.finalHomeScore  = m.homeScore;
        m.finalAwayScore  = m.awayScore;
        _credit(m.proposer, m.proposerBond);
        emit Finalized(matchId, m.resultHash, m.homeScore, m.awayScore, false);
    }

    /// Resolve a DISPUTED match. The resolver supplies the canonical resultHash
    /// (from re-simming the public artifact). The matching side takes the whole
    /// pot; if NEITHER matches, both bonds are slashed to the treasury and the
    /// match is voided.
    function resolve(bytes32 matchId, bytes32 correctResultHash) external onlyResolver {
        Match storage m = matches[matchId];
        require(m.status == Status.Challenged, "PS: not challenged");
        uint256 pot = m.proposerBond + m.challengerBond;
        if (correctResultHash == m.resultHash) {
            m.status          = Status.Finalized;
            m.finalResultHash = m.resultHash;
            m.finalHomeScore  = m.homeScore;
            m.finalAwayScore  = m.awayScore;
            _credit(m.proposer, pot);
            emit Resolved(matchId, correctResultHash, m.proposer);
            emit Finalized(matchId, m.resultHash, m.homeScore, m.awayScore, true);
        } else if (correctResultHash == m.chResultHash) {
            m.status          = Status.Finalized;
            m.finalResultHash = m.chResultHash;
            m.finalHomeScore  = m.chHomeScore;
            m.finalAwayScore  = m.chAwayScore;
            _credit(m.challenger, pot);
            emit Resolved(matchId, correctResultHash, m.challenger);
            emit Finalized(matchId, m.chResultHash, m.chHomeScore, m.chAwayScore, true);
        } else {
            m.status = Status.Voided;
            _credit(owner(), pot);
            emit Resolved(matchId, correctResultHash, address(0));
            emit Voided(matchId);
        }
    }

    /// Owner escape hatch for matches stuck before a proposal (e.g. VRF never
    /// fulfilled). Cannot touch a match that already carries bonds.
    function voidStuck(bytes32 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        require(m.status == Status.AwaitingSeed || m.status == Status.Seeded, "PS: has stake");
        m.status = Status.Voided;
        emit Voided(matchId);
    }

    // ─── Pull-payment withdrawals ───────────────────────────────────────────

    function _credit(address who, uint256 amount) internal {
        if (amount > 0) withdrawable[who] += amount;
    }

    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "PS: nothing to withdraw");
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "PS: transfer failed");
        emit Withdrawal(msg.sender, amount);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    /// Lean settlement view for consumers (e.g. LeagueManager standings): the
    /// canonical, PROVEN outcome of a finalized match + the two seats it was
    /// played between (a consumer binds those to its own team registry).
    function settledResult(bytes32 matchId) external view returns (
        bool finalized, bytes32 resultHash, uint8 homeScore, uint8 awayScore, address home, address away
    ) {
        Match storage m = matches[matchId];
        finalized = m.status == Status.Finalized;
        return (finalized, m.finalResultHash, m.finalHomeScore, m.finalAwayScore, m.home, m.away);
    }
}
