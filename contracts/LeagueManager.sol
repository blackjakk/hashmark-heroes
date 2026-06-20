// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./TeamNFT.sol";
import "./GridironToken.sol";

/// @notice The proven-outcome view of ProofSettlement (see ProofSettlement.sol).
interface IProofSettlement {
    function settledResult(bytes32 matchId) external view returns (
        bool finalized, bytes32 resultHash, uint8 homeScore, uint8 awayScore, address home, address away
    );
}

/// @notice Manages seasons, game results, standings, and the championship
contract LeagueManager is Ownable {
    TeamNFT       public immutable teamNFT;
    GridironToken public immutable grid;

    // Championship prize: 100 000 GRID to the winning team's owner
    uint256 public constant CHAMPION_PRIZE = 100_000 * 10 ** 18;

    enum Phase {
        Offseason,    // 0
        FreeAgency,   // 1
        Draft,        // 2
        PreSeason,    // 3
        RegularSeason,// 4
        Playoffs,     // 5
        GrandFinal    // 6
    }

    struct Game {
        uint256 homeTeamId;
        uint256 awayTeamId;
        uint8   week;
        uint8   homeScore;
        uint8   awayScore;
        bool    played;
        bytes32 matchId;     // links to the ProofSettlement match (proven outcome)
        bytes32 resultHash;  // canonical OUTCOME hash recorded at ingestion
    }

    struct Record {
        uint16 wins;
        uint16 losses;
        uint16 ties;
        uint32 pointsFor;
        uint32 pointsAgainst;
    }

    uint256 public season;
    Phase   public phase;

    /// The settlement contract that proves match outcomes (set by the owner).
    IProofSettlement public proofSettlement;

    // season → games
    mapping(uint256 => Game[]) public schedule;
    // season → teamId → record
    mapping(uint256 => mapping(uint256 => Record)) public records;
    // season → champion teamId
    mapping(uint256 => uint256) public champions;

    // Playoff bracket storage (flat: 14 slots — 7 AFC + 7 NFC seeds)
    mapping(uint256 => uint256[14]) public playoffSeeds;

    event SeasonStarted(uint256 indexed season, Phase phase);
    event PhaseAdvanced(uint256 indexed season, Phase phase);
    event GameRecorded(uint256 indexed season, uint8 week, uint256 home, uint256 away, uint8 hs, uint8 as_);
    event GameSettled(uint256 indexed season, uint256 indexed gameIdx, bytes32 matchId, bytes32 resultHash, uint8 hs, uint8 as_);
    event ProofSettlementSet(address indexed settlement);
    event PlayoffsSet(uint256 indexed season, uint256[14] seeds);
    event ChampionCrowned(uint256 indexed season, uint256 indexed teamId, address owner_);

    constructor(address _team, address _token) Ownable(msg.sender) {
        teamNFT = TeamNFT(_team);
        grid    = GridironToken(_token);
    }

    // ─── Season flow ──────────────────────────────────────────────────────────

    function startSeason() external onlyOwner {
        season++;
        phase = Phase.FreeAgency;
        emit SeasonStarted(season, phase);
    }

    function advancePhase() external onlyOwner {
        require(phase != Phase.GrandFinal, "LM: already final");
        phase = Phase(uint8(phase) + 1);
        emit PhaseAdvanced(season, phase);
    }

    // ─── Schedule ─────────────────────────────────────────────────────────────

    function setSchedule(Game[] calldata games) external onlyOwner {
        require(phase == Phase.PreSeason || phase == Phase.RegularSeason, "LM: wrong phase");
        for (uint256 i; i < games.length; i++) schedule[season].push(games[i]);
    }

    function clearSchedule() external onlyOwner {
        delete schedule[season];
    }

    // ─── Game results — PROVEN, never typed in ──────────────────────────────────

    /// Point the league at its settlement contract (the proven-outcome source).
    function setProofSettlement(address ps) external onlyOwner {
        require(ps != address(0), "LM: zero settlement");
        proofSettlement = IProofSettlement(ps);
        emit ProofSettlementSet(ps);
    }

    /// @notice Pull a FINALIZED match's outcome from ProofSettlement into the
    /// standings. This replaces the old `recordResult(scores)` trust hole: nobody
    /// types a score in — the score comes from a settled (proven, re-simmable)
    /// match. Permissionless, because the data is already proven; the only checks
    /// are that the match is finalized and bound to THIS game's teams (the two
    /// settled seats must be the current owners of the home/away franchises).
    /// @dev The schedule's `matchId` must be an unpredictable, coordinator-chosen
    /// id so it cannot be front-run/opened by a griefer in ProofSettlement; the
    /// owner-binding here then ties the proven seats to the right franchises.
    function ingestResult(uint256 gameIdx) external {
        require(address(proofSettlement) != address(0), "LM: no settlement");
        Game storage g = schedule[season][gameIdx];
        require(!g.played, "LM: already played");
        require(g.matchId != bytes32(0), "LM: no matchId");

        (bool finalized, bytes32 rh, uint8 hs, uint8 as_, address mHome, address mAway) =
            proofSettlement.settledResult(g.matchId);
        require(finalized, "LM: not finalized");
        require(
            mHome == teamNFT.ownerOf(g.homeTeamId) && mAway == teamNFT.ownerOf(g.awayTeamId),
            "LM: team/owner mismatch"
        );

        g.homeScore  = hs;
        g.awayScore  = as_;
        g.resultHash = rh;
        g.played     = true;
        _applyStandings(g.homeTeamId, g.awayTeamId, hs, as_);

        emit GameRecorded(season, g.week, g.homeTeamId, g.awayTeamId, hs, as_);
        emit GameSettled(season, gameIdx, g.matchId, rh, hs, as_);
    }

    function _applyStandings(uint256 homeTeamId, uint256 awayTeamId, uint8 homeScore, uint8 awayScore) internal {
        Record storage hr = records[season][homeTeamId];
        Record storage ar = records[season][awayTeamId];

        hr.pointsFor      += homeScore;
        hr.pointsAgainst  += awayScore;
        ar.pointsFor      += awayScore;
        ar.pointsAgainst  += homeScore;

        if      (homeScore > awayScore) { hr.wins++;   ar.losses++; }
        else if (awayScore > homeScore) { ar.wins++;   hr.losses++; }
        else                            { hr.ties++;   ar.ties++;   }
    }

    // ─── Playoffs ─────────────────────────────────────────────────────────────

    /// @param seeds 14-element array: [afc1..afc7, nfc1..nfc7]
    function setPlayoffSeeds(uint256[14] calldata seeds) external onlyOwner {
        require(phase == Phase.Playoffs, "LM: not playoffs");
        playoffSeeds[season] = seeds;
        emit PlayoffsSet(season, seeds);
    }

    // ─── Champion ─────────────────────────────────────────────────────────────

    function crownChampion(uint256 teamId) external onlyOwner {
        require(phase == Phase.Playoffs || phase == Phase.GrandFinal, "LM: wrong phase");
        champions[season] = teamId;
        phase             = Phase.GrandFinal;

        address franchiseOwner = teamNFT.ownerOf(teamId);
        if (grid.balanceOf(address(this)) >= CHAMPION_PRIZE) {
            grid.transfer(franchiseOwner, CHAMPION_PRIZE);
        }
        emit ChampionCrowned(season, teamId, franchiseOwner);
    }

    // Fund the prize pool
    function fundPrizePool(uint256 amount) external onlyOwner {
        grid.transferFrom(msg.sender, address(this), amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getRecord(uint256 s, uint256 teamId) external view returns (Record memory) {
        return records[s][teamId];
    }

    function getSchedule(uint256 s) external view returns (Game[] memory) {
        return schedule[s];
    }

    function getWeekGames(uint256 s, uint8 week) external view returns (Game[] memory out) {
        Game[] storage all = schedule[s];
        uint256 cnt;
        for (uint256 i; i < all.length; i++) if (all[i].week == week) cnt++;
        out = new Game[](cnt);
        uint256 j;
        for (uint256 i; i < all.length; i++) if (all[i].week == week) out[j++] = all[i];
    }

    function getAllRecords(uint256 s) external view
        returns (uint256[] memory teamIds, Record[] memory recs)
    {
        teamIds = new uint256[](32);
        recs    = new Record[](32);
        for (uint256 i; i < 32; i++) {
            teamIds[i] = i + 1;
            recs[i]    = records[s][i + 1];
        }
    }
}
