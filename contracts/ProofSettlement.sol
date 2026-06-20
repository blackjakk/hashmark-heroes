// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProofSettlement — optimistic, challenge-by-re-sim match settlement.
/// @notice Replaces the trust hole in `LeagueManager.recordResult(scores)` (an
/// `onlyOwner` function that takes scores on faith). Here a match outcome is
/// *proven from a re-simmable artifact*, never typed in by an admin:
///
///   1. COMMIT–REVEAL SEED. Both players commit `keccak(matchId,addr,nonce)`
///      before kickoff, then reveal. The canonical game seed is
///      `keccak(nonceHome, nonceAway)` — unforgeable, since neither side can
///      pick it alone and the first committer can't see the other's nonce.
///   2. BONDED PROPOSE. A runner posts the claimed `(artifactHash, resultHash,
///      score)` with a bond. `artifactHash` binds the INPUTS {seed,rosters,tape};
///      `resultHash` binds the OUTCOME (server/result-hash.js canonical hash).
///   3. OPTIMISTIC CHALLENGE. Anyone may, within `challengeWindow`, post a
///      CONFLICTING `resultHash` with a matching bond. Re-simming the artifact
///      is deterministic ((seed+inputs)->hash), so an honest challenger can
///      always reproduce the true resultHash and dispute a false one.
///   4. SETTLE. Unchallenged after the window -> the proposal finalizes and the
///      proposer reclaims their bond. Challenged -> the `resolver` (the re-sim
///      referee; a multisig today, an on-chain verifier / optimistic-rollup
///      fraud proof later) supplies the canonical `resultHash`; the side that
///      matches it takes BOTH bonds, the lying side is slashed.
///
/// The chain never recomputes the game — it adjudicates *hashes* of a public,
/// independently re-simmable artifact. That is the whole anti-cheat claim:
/// outcomes are PROVEN, not asserted. Bonds and the challenge window are deploy
/// parameters; the seed source is swappable (commit-reveal now, VRF later).
contract ProofSettlement is Ownable {
    /// Required bond (wei) to propose or to challenge.
    uint256 public immutable bondAmount;
    /// Seconds a proposal stays open to challenge before it can finalize.
    uint256 public immutable challengeWindow;
    /// The re-sim referee that adjudicates disputes (defaults to the owner).
    address public resolver;

    enum Status {
        None,        // 0 unknown match
        Committing,  // 1 opened; awaiting commits/reveals
        Seeded,      // 2 both revealed; canonical seed fixed
        Proposed,    // 3 a bonded result is posted; challenge window open
        Challenged,  // 4 a conflicting bonded result was posted; awaiting resolve
        Finalized,   // 5 settled (unchallenged or resolved)
        Voided       // 6 cancelled (both sides wrong, or owner void)
    }

    struct Match {
        address home;
        address away;
        bytes32 commitHome;
        bytes32 commitAway;
        bool    revealedHome;
        bool    revealedAway;
        bytes32 nonceHome;
        bytes32 nonceAway;
        bytes32 seed;          // canonical, set once both revealed
        Status  status;
        // ── settlement ──
        address proposer;
        uint256 proposerBond;
        bytes32 artifactHash;  // INPUTS hash {seed,rosters,tape}
        bytes32 resultHash;    // OUTCOME hash (the proposed truth)
        uint8   homeScore;
        uint8   awayScore;
        uint64  proposedAt;
        address challenger;
        uint256 challengerBond;
        bytes32 chResultHash;  // the challenger's conflicting outcome
        uint8   chHomeScore;
        uint8   chAwayScore;
        // ── outcome of settlement ──
        bytes32 finalResultHash;
        uint8   finalHomeScore;
        uint8   finalAwayScore;
    }

    mapping(bytes32 => Match) public matches;       // matchId => Match
    mapping(address => uint256) public withdrawable; // pull-payment ledger

    event MatchOpened(bytes32 indexed matchId, address home, address away);
    event Committed(bytes32 indexed matchId, address indexed who);
    event Revealed(bytes32 indexed matchId, address indexed who);
    event Seeded(bytes32 indexed matchId, bytes32 seed);
    event Proposed(bytes32 indexed matchId, address indexed proposer, bytes32 artifactHash, bytes32 resultHash, uint8 homeScore, uint8 awayScore);
    event Challenged(bytes32 indexed matchId, address indexed challenger, bytes32 resultHash, uint8 homeScore, uint8 awayScore);
    event Finalized(bytes32 indexed matchId, bytes32 resultHash, uint8 homeScore, uint8 awayScore, bool disputed);
    event Resolved(bytes32 indexed matchId, bytes32 correctResultHash, address winner);
    event Voided(bytes32 indexed matchId);
    event Withdrawal(address indexed who, uint256 amount);
    event ResolverChanged(address indexed resolver);

    constructor(uint256 _bondAmount, uint256 _challengeWindow) Ownable(msg.sender) {
        bondAmount      = _bondAmount;
        challengeWindow = _challengeWindow;
        resolver        = msg.sender;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "PS: not resolver");
        _;
    }

    function setResolver(address r) external onlyOwner {
        require(r != address(0), "PS: zero resolver");
        resolver = r;
        emit ResolverChanged(r);
    }

    // ─── 1. Open + commit-reveal seed ───────────────────────────────────────

    /// Open a match shell for two players. Permissionless: it only wires the
    /// commit slots for the two named addresses, so it cannot be used to grief.
    function openMatch(bytes32 matchId, address home, address away) external {
        require(home != address(0) && away != address(0) && home != away, "PS: bad players");
        Match storage m = matches[matchId];
        require(m.status == Status.None, "PS: exists");
        m.home   = home;
        m.away   = away;
        m.status = Status.Committing;
        emit MatchOpened(matchId, home, away);
    }

    /// Commit `keccak256(abi.encodePacked(matchId, msg.sender, nonce))`. Binding
    /// the hash to matchId+sender stops the opponent copying your commitment.
    function commit(bytes32 matchId, bytes32 commitHash) external {
        Match storage m = matches[matchId];
        require(m.status == Status.Committing, "PS: not committing");
        if (msg.sender == m.home) {
            require(m.commitHome == bytes32(0), "PS: home committed");
            m.commitHome = commitHash;
        } else if (msg.sender == m.away) {
            require(m.commitAway == bytes32(0), "PS: away committed");
            m.commitAway = commitHash;
        } else {
            revert("PS: not a player");
        }
        emit Committed(matchId, msg.sender);
    }

    /// Reveal a nonce; when both sides have revealed, the canonical seed is set.
    function reveal(bytes32 matchId, bytes32 nonce) external {
        Match storage m = matches[matchId];
        require(m.status == Status.Committing, "PS: not committing");
        bytes32 expect = keccak256(abi.encodePacked(matchId, msg.sender, nonce));
        if (msg.sender == m.home) {
            require(m.commitHome != bytes32(0), "PS: home not committed");
            require(!m.revealedHome, "PS: home revealed");
            require(expect == m.commitHome, "PS: bad reveal");
            m.nonceHome    = nonce;
            m.revealedHome = true;
        } else if (msg.sender == m.away) {
            require(m.commitAway != bytes32(0), "PS: away not committed");
            require(!m.revealedAway, "PS: away revealed");
            require(expect == m.commitAway, "PS: bad reveal");
            m.nonceAway    = nonce;
            m.revealedAway = true;
        } else {
            revert("PS: not a player");
        }
        emit Revealed(matchId, msg.sender);
        if (m.revealedHome && m.revealedAway) {
            m.seed   = keccak256(abi.encodePacked(m.nonceHome, m.nonceAway));
            m.status = Status.Seeded;
            emit Seeded(matchId, m.seed);
        }
    }

    // ─── 2. Bonded propose / 3. challenge ───────────────────────────────────

    /// Post the claimed outcome with a bond. Permissionless: any runner (a
    /// player, the server, a third party) may settle a seeded match.
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

    /// Dispute a proposal within the window with a CONFLICTING result + bond.
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

    /// Finalize an UNCHALLENGED proposal once the window has elapsed. The
    /// proposer reclaims their bond and the proposed outcome becomes canonical.
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
    /// (obtained by re-simming the public artifact). The matching side takes the
    /// whole pot (own bond back + the loser's slashed bond); if NEITHER matches,
    /// both bonds are slashed to the treasury and the match is voided.
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
            // Both were wrong — neither earns the pot.
            m.status = Status.Voided;
            _credit(owner(), pot);
            emit Resolved(matchId, correctResultHash, address(0));
            emit Voided(matchId);
        }
    }

    /// Owner escape hatch for matches stuck before a proposal (e.g. a player
    /// never reveals). Cannot touch a match that already carries bonds.
    function voidStuck(bytes32 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        require(m.status == Status.Committing || m.status == Status.Seeded, "PS: has stake");
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

    /// Compute the canonical seed a match WILL have for two nonces (off-chain
    /// helper; mirrors `reveal`).
    function seedFor(bytes32 nonceHome, bytes32 nonceAway) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(nonceHome, nonceAway));
    }

    /// The commitment a player should post for a given nonce.
    function commitFor(bytes32 matchId, address player, bytes32 nonce) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(matchId, player, nonce));
    }
}
