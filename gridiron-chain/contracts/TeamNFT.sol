// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice 32 fictional franchise NFTs — one per team in GridironChain
contract TeamNFT is ERC721, Ownable {
    uint256 public constant TOTAL_TEAMS = 32;
    uint256 public constant TEAM_PRICE  = 5_000 * 10 ** 18; // 5 000 GRID

    IERC20 public immutable gridironToken;

    struct Team {
        string  name;
        string  city;
        string  conference; // "AFC" | "NFC"
        string  division;   // "North"|"South"|"East"|"West"
        string  primaryColor;
        string  secondaryColor;
        string  mascot;
    }

    mapping(uint256 => Team)       public teams;
    mapping(uint256 => uint256[])  private _rosters; // teamId → playerNFT ids

    event TeamPurchased(uint256 indexed tokenId, address indexed buyer);
    event PlayerRostered(uint256 indexed teamId, uint256 indexed playerId);
    event PlayerCut(uint256 indexed teamId, uint256 indexed playerId);

    constructor(address _token) ERC721("Gridiron Franchise", "GFRN") Ownable(msg.sender) {
        gridironToken = IERC20(_token);
        _initTeams();
        for (uint256 i = 1; i <= TOTAL_TEAMS; i++) {
            _mint(address(this), i);
        }
    }

    // ─── Ownership ──────────────────────────────────────────────────────────

    function purchaseTeam(uint256 tokenId) external {
        require(ownerOf(tokenId) == address(this), "TeamNFT: already owned");
        gridironToken.transferFrom(msg.sender, owner(), TEAM_PRICE);
        _transfer(address(this), msg.sender, tokenId);
        emit TeamPurchased(tokenId, msg.sender);
    }

    // ─── Roster management (called by DraftSystem / FreeAgency) ─────────────

    function addToRoster(uint256 teamId, uint256 playerId) external {
        require(ownerOf(teamId) == msg.sender || msg.sender == owner(), "TeamNFT: unauthorized");
        _rosters[teamId].push(playerId);
        emit PlayerRostered(teamId, playerId);
    }

    function removeFromRoster(uint256 teamId, uint256 playerId) external {
        require(ownerOf(teamId) == msg.sender || msg.sender == owner(), "TeamNFT: unauthorized");
        uint256[] storage r = _rosters[teamId];
        for (uint256 i = 0; i < r.length; i++) {
            if (r[i] == playerId) {
                r[i] = r[r.length - 1];
                r.pop();
                emit PlayerCut(teamId, playerId);
                return;
            }
        }
    }

    function getRoster(uint256 teamId) external view returns (uint256[] memory) {
        return _rosters[teamId];
    }

    function getTeam(uint256 teamId) external view returns (Team memory) {
        return teams[teamId];
    }

    function availableTeams() external view returns (uint256[] memory ids) {
        uint256 count;
        for (uint256 i = 1; i <= TOTAL_TEAMS; i++) {
            if (ownerOf(i) == address(this)) count++;
        }
        ids = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= TOTAL_TEAMS; i++) {
            if (ownerOf(i) == address(this)) ids[idx++] = i;
        }
    }

    // ─── Internal: 32 fictional teams ───────────────────────────────────────

    function _t(
        uint256 id,
        string memory city,
        string memory name,
        string memory mascot,
        string memory conf,
        string memory div,
        string memory c1,
        string memory c2
    ) internal {
        teams[id] = Team(name, city, conf, div, c1, c2, mascot);
    }

    function _initTeams() internal {
        // ── AFC East ─────────────────────────────────────────────────────────
        _t(1,  "New Albion",   "Kraken",     "Kraken",     "AFC","East","#00264D","#C8A900");
        _t(2,  "Stonehaven",   "Titans",     "Titan",      "AFC","East","#4B92DB","#C8102E");
        _t(3,  "Ironport",     "Wolves",     "Wolf",       "AFC","East","#1A1A1A","#C0392B");
        _t(4,  "Coldwater",    "Buccaneers", "Buccaneer",  "AFC","East","#0072CE","#E8C100");
        // ── AFC North ────────────────────────────────────────────────────────
        _t(5,  "Steelforge",   "Hammers",    "Hammer",     "AFC","North","#FFB612","#101820");
        _t(6,  "Riverdale",    "Grizzlies",  "Grizzly",    "AFC","North","#FB4F14","#003831");
        _t(7,  "Coalport",     "Ravens",     "Raven",      "AFC","North","#241773","#000000");
        _t(8,  "Lakewood",     "Bulldogs",   "Bulldog",    "AFC","North","#0B162A","#C83803");
        // ── AFC South ────────────────────────────────────────────────────────
        _t(9,  "Sunbelt",      "Vipers",     "Viper",      "AFC","South","#002244","#B0B7BC");
        _t(10, "Palmetto",     "Jaguars",    "Jaguar",     "AFC","South","#006778","#D7A22A");
        _t(11, "Bayou",        "Gators",     "Gator",      "AFC","South","#03202F","#D3BC8D");
        _t(12, "Redrock",      "Stallions",  "Stallion",   "AFC","South","#4F2683","#C8A900");
        // ── AFC West ─────────────────────────────────────────────────────────
        _t(13, "Desert",       "Scorpions",  "Scorpion",   "AFC","West","#002244","#C60C30");
        _t(14, "Silicon",      "Raiders",    "Raider",     "AFC","West","#101820","#A5ACAF");
        _t(15, "Cascade",      "Thunder",    "Thunder",    "AFC","West","#002C5F","#FB4F14");
        _t(16, "Frontier",     "Outlaws",    "Outlaw",     "AFC","West","#E31837","#002A5C");
        // ── NFC East ─────────────────────────────────────────────────────────
        _t(17, "Capitol",      "Sentinels",  "Sentinel",   "NFC","East","#003594","#C60C30");
        _t(18, "Metro",        "Predators",  "Predator",   "NFC","East","#004C54","#A5ACAF");
        _t(19, "Eastport",     "Eagles",     "Eagle",      "NFC","East","#004C54","#69BE28");
        _t(20, "Colonial",     "Minutemen",  "Minuteman",  "NFC","East","#003366","#C8A900");
        // ── NFC North ────────────────────────────────────────────────────────
        _t(21, "Great Lakes",  "Frost",      "Frost",      "NFC","North","#4F2683","#FFC62F");
        _t(22, "Ironwood",     "Vikings",    "Viking",     "NFC","North","#4F2683","#FFC62F");
        _t(23, "Prairie",      "Wolves",     "Wolf",       "NFC","North","#203731","#FFB612");
        _t(24, "Blizzard",     "Bears",      "Bear",       "NFC","North","#0B162A","#C83803");
        // ── NFC South ────────────────────────────────────────────────────────
        _t(25, "Magnolia",     "Saints",     "Saint",      "NFC","South","#D3BC8D","#101820");
        _t(26, "Gulf",         "Marauders",  "Marauder",   "NFC","South","#D50A0A","#346B38");
        _t(27, "Swamp",        "Kings",      "King",       "NFC","South","#002244","#D3BC8D");
        _t(28, "Peach State",  "Falcons",    "Falcon",     "NFC","South","#A71930","#000000");
        // ── NFC West ─────────────────────────────────────────────────────────
        _t(29, "Pacific",      "Surge",      "Surge",      "NFC","West","#002244","#C8A900");
        _t(30, "Redwood",      "Giants",     "Giant",      "NFC","West","#0B2265","#A71930");
        _t(31, "Canyon",       "Hawks",      "Hawk",       "NFC","West","#002244","#69BE28");
        _t(32, "Volcanic",     "Fury",       "Fury",       "NFC","West","#97233F","#000000");
    }
}
