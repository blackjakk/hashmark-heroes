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

    /// Once locked, team metadata is immutable (owner can freeze after seeding).
    bool public metadataLocked;

    event TeamPurchased(uint256 indexed tokenId, address indexed buyer);
    event PlayerRostered(uint256 indexed teamId, uint256 indexed playerId);
    event PlayerCut(uint256 indexed teamId, uint256 indexed playerId);
    event TeamsSet(uint256 count);
    event MetadataLocked();

    constructor(address _token) ERC721("Gridiron Franchise", "GFRN") Ownable(msg.sender) {
        gridironToken = IERC20(_token);
        // Mint the 32 franchise NFTs to the contract (claimed via purchaseTeam).
        // Team METADATA is seeded post-deploy via setTeams(): its 32×7 string
        // literals, if inlined here, blew the EIP-3860 init-code limit and made
        // the contract undeployable. Keep the constructor lean.
        for (uint256 i = 1; i <= TOTAL_TEAMS; i++) {
            _mint(address(this), i);
        }
    }

    // ─── Team metadata (owner-seeded post-deploy; see scripts/teams.js) ─────────

    /// Batch-set franchise metadata. Owner-only, idempotent, callable in chunks
    /// until `lockMetadata()` freezes it. Data arrives in CALLDATA, so none of it
    /// lives in the contract bytecode (the deployability fix).
    function setTeams(uint256[] calldata ids, Team[] calldata data) external onlyOwner {
        require(!metadataLocked, "TeamNFT: metadata locked");
        require(ids.length == data.length, "TeamNFT: length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            require(ids[i] >= 1 && ids[i] <= TOTAL_TEAMS, "TeamNFT: bad id");
            teams[ids[i]] = data[i];
        }
        emit TeamsSet(ids.length);
    }

    /// Freeze metadata permanently (call once all 32 teams are seeded).
    function lockMetadata() external onlyOwner {
        metadataLocked = true;
        emit MetadataLocked();
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
}
