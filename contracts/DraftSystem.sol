// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PlayerNFT.sol";
import "./TeamNFT.sol";
import "./GridironToken.sol";

/// @notice Annual player draft — worst team picks first, 7 rounds.
/// @dev LIVE / on-the-clock upgrade:
///      • ordered picks with a per-pick on-chain DEADLINE (block.timestamp);
///      • permissionless AUTO-PICK on timeout from a team's pre-committed queue
///        (a keeper/anyone can advance a stalled draft — trustless);
///      • PROPOSE/ACCEPT pick trades (trade up / down) during the draft.
///      The team on the clock is `picks[season][currentPickIdx].teamId`, and its
///      controller is simply `teamNFT.ownerOf(teamId)` — so wiring the off-chain
///      action-sourced draft to this contract is 1:1 (see DRAFT_REWORK.md).
contract DraftSystem is Ownable, ReentrancyGuard {
    PlayerNFT     public immutable playerNFT;
    TeamNFT       public immutable teamNFT;
    GridironToken public immutable grid;

    uint256 public constant ROUNDS   = 7;
    uint256 public constant TEAMS    = 32;
    uint256 public constant PICK_FEE = 50 * 10 ** 18; // 50 GRID per (manual) pick activation

    // ─── Static draft state ────────────────────────────────────────────────────
    uint256 public currentSeason;
    bool    public draftOpen;
    uint256[32] public draftOrder;       // teamIds worst→best
    uint256[]   public prospects;        // playerNFT ids available this season

    struct Pick {
        uint256 teamId;     // current owner (mutated by trades — source of truth)
        uint8   round;
        uint8   slot;       // 1-32 within the round
        uint256 playerId;   // 0 = not yet used
        bool    used;
    }

    mapping(uint256 => Pick[]) public picks;                                  // season → 224 picks
    mapping(uint256 => mapping(uint256 => uint256[])) public teamPickIndices; // ORIGINAL allocation (pre-trade)
    mapping(uint256 => mapping(uint256 => bool)) public prospectTaken;        // season → prospectIdx → taken

    // ─── LIVE / on-the-clock state ─────────────────────────────────────────────
    uint256 public currentPickIdx;   // index into picks[currentSeason] that is ON THE CLOCK
    uint256 public pickDeadline;     // block.timestamp by which the on-clock team must pick
    uint256 public pickClock = 90;   // seconds per pick (owner-configurable)

    // teamId → ranked prospect indices (their "big board") — used by auto-pick on timeout
    mapping(uint256 => uint256[]) public queues;

    // ─── Trade offers (propose / accept) ───────────────────────────────────────
    struct TradeOffer {
        address   proposer;   // captured at propose-time (pays gridOut)
        uint256   fromTeam;   // proposer's team (sends picksOut + gridOut)
        uint256   toTeam;     // counterparty (sends picksIn)
        uint256[] picksOut;   // pick indices owned by fromTeam
        uint256[] picksIn;    // pick indices owned by toTeam
        uint256   gridOut;    // optional GRID sweetener from proposer → counterparty
        bool      active;
    }
    TradeOffer[] public offers;

    // ─── Events (the off-chain front-end subscribes to these to re-render live) ──
    event DraftOpened(uint256 indexed season, uint256 prospects);
    event DraftClosed(uint256 indexed season);
    event OnTheClock(uint256 indexed season, uint256 indexed pickIdx, uint256 indexed teamId, uint256 deadline);
    event PickMade(uint256 indexed season, uint256 indexed teamId, uint256 indexed playerId, uint8 round, uint8 slot, bool auto_);
    event QueueSet(uint256 indexed teamId, uint256 length);
    event TradeProposed(uint256 indexed offerId, uint256 indexed fromTeam, uint256 indexed toTeam);
    event TradeAccepted(uint256 indexed offerId, uint256 fromTeam, uint256 toTeam);
    event TradeCancelled(uint256 indexed offerId);

    constructor(address _player, address _team, address _token) Ownable(msg.sender) {
        playerNFT = PlayerNFT(_player);
        teamNFT   = TeamNFT(_team);
        grid      = GridironToken(_token);
    }

    // ─── Commissioner controls ─────────────────────────────────────────────────
    function setDraftOrder(uint256[32] calldata order) external onlyOwner { draftOrder = order; }
    function setPickClock(uint256 secs) external onlyOwner { require(secs >= 5, "clock too short"); pickClock = secs; }

    function openDraft(uint256 season, uint256[] calldata prospectIds) external onlyOwner {
        require(!draftOpen, "already open");
        Pick[] storage seasonPicks = picks[season];
        require(seasonPicks.length == 0, "season already seeded");
        currentSeason = season;
        draftOpen     = true;
        delete prospects;
        for (uint256 i; i < prospectIds.length; i++) prospects.push(prospectIds[i]);
        // Build the pick board (worst→best each round).
        for (uint8 r = 1; r <= ROUNDS; r++) {
            for (uint8 s = 1; s <= TEAMS; s++) {
                uint256 teamId = draftOrder[s - 1];
                uint256 idx    = seasonPicks.length;
                seasonPicks.push(Pick({ teamId: teamId, round: r, slot: s, playerId: 0, used: false }));
                teamPickIndices[season][teamId].push(idx);
            }
        }
        currentPickIdx = 0;
        pickDeadline   = block.timestamp + pickClock;
        emit DraftOpened(season, prospectIds.length);
        _emitClock();
    }

    function closeDraft() external onlyOwner { draftOpen = false; emit DraftClosed(currentSeason); }

    // ─── On-the-clock pick (ordered, manual) ───────────────────────────────────
    /// @param prospectIdx index in prospects[]
    function selectPlayer(uint256 prospectIdx) external nonReentrant {
        require(draftOpen, "not open");
        Pick storage p = picks[currentSeason][currentPickIdx];
        require(teamNFT.ownerOf(p.teamId) == msg.sender, "not your pick");
        grid.transferFrom(msg.sender, address(this), PICK_FEE);
        _commitPick(p, prospectIdx, false);
        _advance();
    }

    // ─── Auto-pick on timeout (permissionless — keeper/anyone advances a stall) ──
    function forcePick() external nonReentrant {
        require(draftOpen, "not open");
        require(block.timestamp > pickDeadline, "clock still running");
        Pick storage p = picks[currentSeason][currentPickIdx];
        _commitPick(p, _bestFromQueue(p.teamId), true); // no fee on auto-pick (GM forfeited their action)
        _advance();
    }

    function _commitPick(Pick storage p, uint256 prospectIdx, bool auto_) internal {
        require(!p.used, "pick used");
        require(prospectIdx < prospects.length, "bad prospect idx");
        require(!prospectTaken[currentSeason][prospectIdx], "prospect gone");
        prospectTaken[currentSeason][prospectIdx] = true; // effects before interactions
        uint256 pid = prospects[prospectIdx];
        p.used     = true;
        p.playerId = pid;
        playerNFT.sign(pid, p.teamId, 4, playerNFT.getPlayer(pid).salary); // 4-yr rookie deal
        teamNFT.addToRoster(p.teamId, pid);
        emit PickMade(currentSeason, p.teamId, pid, p.round, p.slot, auto_);
    }

    function _advance() internal {
        uint256 total = picks[currentSeason].length;
        do { currentPickIdx++; } while (currentPickIdx < total && picks[currentSeason][currentPickIdx].used);
        if (currentPickIdx >= total) { draftOpen = false; emit DraftClosed(currentSeason); }
        else { pickDeadline = block.timestamp + pickClock; _emitClock(); }
    }

    function _emitClock() internal {
        Pick storage p = picks[currentSeason][currentPickIdx];
        emit OnTheClock(currentSeason, currentPickIdx, p.teamId, pickDeadline);
    }

    // First not-taken prospect from the team's queue; fallback to first available.
    function _bestFromQueue(uint256 teamId) internal view returns (uint256) {
        uint256[] storage q = queues[teamId];
        for (uint256 i; i < q.length; i++) {
            uint256 idx = q[i];
            if (idx < prospects.length && !prospectTaken[currentSeason][idx]) return idx;
        }
        for (uint256 i; i < prospects.length; i++) {
            if (!prospectTaken[currentSeason][i]) return i;
        }
        revert("no prospects left");
    }

    // ─── Pre-committed queue / big board ───────────────────────────────────────
    function setQueue(uint256 teamId, uint256[] calldata prospectIdxs) external {
        require(teamNFT.ownerOf(teamId) == msg.sender, "not your team");
        queues[teamId] = prospectIdxs;
        emit QueueSet(teamId, prospectIdxs.length);
    }

    // ─── Trade up / down: propose & accept ─────────────────────────────────────
    function proposeTrade(
        uint256 fromTeam, uint256 toTeam,
        uint256[] calldata picksOut, uint256[] calldata picksIn,
        uint256 gridOut
    ) external returns (uint256 offerId) {
        require(teamNFT.ownerOf(fromTeam) == msg.sender, "not your team");
        require(fromTeam != toTeam, "same team");
        _requireOwnedUnused(picksOut, fromTeam);
        _requireOwnedUnused(picksIn,  toTeam);
        offers.push(TradeOffer({
            proposer: msg.sender, fromTeam: fromTeam, toTeam: toTeam,
            picksOut: picksOut, picksIn: picksIn, gridOut: gridOut, active: true
        }));
        offerId = offers.length - 1;
        emit TradeProposed(offerId, fromTeam, toTeam);
    }

    /// @notice Counterparty accepts → atomic pick-ownership swap (+ optional GRID).
    ///         If the on-clock pick changes hands, the clock resets for the new owner.
    function acceptTrade(uint256 offerId) external nonReentrant {
        TradeOffer storage o = offers[offerId];
        require(o.active, "offer inactive");
        require(teamNFT.ownerOf(o.toTeam) == msg.sender, "not counterparty");
        _requireOwnedUnused(o.picksOut, o.fromTeam); // re-validate (ownership/used may have changed)
        _requireOwnedUnused(o.picksIn,  o.toTeam);
        o.active = false; // effects before interactions

        Pick[] storage sp = picks[currentSeason];
        bool clockTouched;
        for (uint256 i; i < o.picksOut.length; i++) {
            sp[o.picksOut[i]].teamId = o.toTeam;
            if (o.picksOut[i] == currentPickIdx) clockTouched = true;
        }
        for (uint256 i; i < o.picksIn.length; i++) {
            sp[o.picksIn[i]].teamId = o.fromTeam;
            if (o.picksIn[i] == currentPickIdx) clockTouched = true;
        }
        if (o.gridOut > 0) grid.transferFrom(o.proposer, msg.sender, o.gridOut);
        if (clockTouched && draftOpen) { pickDeadline = block.timestamp + pickClock; _emitClock(); }
        emit TradeAccepted(offerId, o.fromTeam, o.toTeam);
    }

    function cancelTrade(uint256 offerId) external {
        TradeOffer storage o = offers[offerId];
        require(o.active, "offer inactive");
        require(teamNFT.ownerOf(o.fromTeam) == msg.sender, "not proposer");
        o.active = false;
        emit TradeCancelled(offerId);
    }

    function _requireOwnedUnused(uint256[] memory idxs, uint256 teamId) internal view {
        Pick[] storage sp = picks[currentSeason];
        for (uint256 i; i < idxs.length; i++) {
            Pick storage p = sp[idxs[i]];
            require(p.teamId == teamId, "pick not owned by team");
            require(!p.used, "pick already used");
        }
    }

    // ─── Views ─────────────────────────────────────────────────────────────────
    function onTheClock() external view returns (uint256 pickIdx, uint256 teamId, uint256 deadline, uint8 round, uint8 slot) {
        Pick storage p = picks[currentSeason][currentPickIdx];
        return (currentPickIdx, p.teamId, pickDeadline, p.round, p.slot);
    }

    function getProspects() external view returns (uint256[] memory) { return prospects; }

    function getOffer(uint256 offerId) external view returns (TradeOffer memory) { return offers[offerId]; }
    function offerCount() external view returns (uint256) { return offers.length; }

    function getRoundPicks(uint256 season, uint8 round) external view returns (Pick[] memory out) {
        Pick[] storage all = picks[season];
        uint256 cnt;
        for (uint256 i; i < all.length; i++) if (all[i].round == round) cnt++;
        out = new Pick[](cnt);
        uint256 j;
        for (uint256 i; i < all.length; i++) if (all[i].round == round) out[j++] = all[i];
    }

    /// @notice Picks a team CURRENTLY owns (post-trade) — scans by live teamId,
    ///         unlike teamPickIndices which is the original allocation.
    function getTeamPicksLive(uint256 season, uint256 teamId) external view returns (Pick[] memory out) {
        Pick[] storage all = picks[season];
        uint256 cnt;
        for (uint256 i; i < all.length; i++) if (all[i].teamId == teamId) cnt++;
        out = new Pick[](cnt);
        uint256 j;
        for (uint256 i; i < all.length; i++) if (all[i].teamId == teamId) out[j++] = all[i];
    }

    // Commissioner can withdraw pick fees for prize pool / operations.
    function withdrawFees(address to) external onlyOwner { grid.transfer(to, grid.balanceOf(address(this))); }
}
