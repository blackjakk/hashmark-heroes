// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice On-chain player cards with full stat sheets
contract PlayerNFT is ERC721, Ownable {
    uint256 private _nextId = 1;

    enum Position { QB, RB, WR, TE, OL, DL, LB, CB, S, K, P }

    struct Stats {
        uint8 speed;
        uint8 strength;
        uint8 agility;
        uint8 awareness;
        uint8 throwing;     // QB
        uint8 catching;     // WR / TE / RB
        uint8 blocking;     // OL / TE
        uint8 passRush;     // DL / LB
        uint8 coverage;     // CB / S / LB
        uint8 tackle;       // LB / S / DL
        uint8 kickPower;    // K / P
    }

    struct Player {
        string   name;
        Position position;
        uint8    age;
        uint8    overall;
        uint256  teamId;        // 0 = free agent
        uint256  contractYears;
        uint256  salary;        // GRID tokens / season
        Stats    stats;
        uint256  season;        // draft class / signing season
    }

    mapping(uint256 => Player)  public players;
    mapping(address => bool)    public authorizedMinters;

    event PlayerMinted(uint256 indexed id, string name, Position pos, uint8 overall);
    event PlayerSigned(uint256 indexed id, uint256 teamId, uint256 numYears, uint256 salary);
    event PlayerReleased(uint256 indexed id);

    modifier onlyAuth() {
        require(authorizedMinters[msg.sender] || msg.sender == owner(), "PlayerNFT: unauthorized");
        _;
    }

    constructor() ERC721("Gridiron Player", "GPLR") Ownable(msg.sender) {}

    // ─── Auth ────────────────────────────────────────────────────────────────

    function setMinter(address who, bool allowed) external onlyOwner {
        authorizedMinters[who] = allowed;
    }

    // ─── Minting ─────────────────────────────────────────────────────────────

    function mint(
        address      to,
        string memory name,
        Position     position,
        uint8        age,
        Stats memory stats,
        uint256      salary,
        uint256      season
    ) external onlyAuth returns (uint256 id) {
        id = _nextId++;
        _mint(to, id);
        uint8 overall = _overall(position, stats);
        players[id] = Player({
            name:          name,
            position:      position,
            age:           age,
            overall:       overall,
            teamId:        0,
            contractYears: 0,
            salary:        salary,
            stats:         stats,
            season:        season
        });
        emit PlayerMinted(id, name, position, overall);
    }

    // ─── Signing / releasing ─────────────────────────────────────────────────

    function sign(uint256 id, uint256 teamId, uint256 numYears, uint256 salary) external onlyAuth {
        players[id].teamId        = teamId;
        players[id].contractYears = numYears;
        players[id].salary        = salary;
        emit PlayerSigned(id, teamId, numYears, salary);
    }

    function release(uint256 id) external onlyAuth {
        players[id].teamId        = 0;
        players[id].contractYears = 0;
        emit PlayerReleased(id);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getPlayer(uint256 id) external view returns (Player memory) {
        return players[id];
    }

    function totalMinted() external view returns (uint256) {
        return _nextId - 1;
    }

    // ─── Overall calculation ─────────────────────────────────────────────────

    function _overall(Position pos, Stats memory s) internal pure returns (uint8) {
        uint256 v;
        if      (pos == Position.QB)  v = s.speed*10 + s.agility*15 + s.awareness*25 + s.throwing*50;
        else if (pos == Position.RB)  v = s.speed*35 + s.strength*20 + s.agility*25 + s.catching*20;
        else if (pos == Position.WR)  v = s.speed*30 + s.agility*25 + s.catching*35 + s.awareness*10;
        else if (pos == Position.TE)  v = s.speed*20 + s.catching*40 + s.blocking*30 + s.strength*10;
        else if (pos == Position.OL)  v = s.strength*35 + s.blocking*45 + s.agility*20;
        else if (pos == Position.DL)  v = s.strength*35 + s.passRush*40 + s.speed*25;
        else if (pos == Position.LB)  v = s.passRush*25 + s.coverage*25 + s.tackle*30 + s.speed*20;
        else if (pos == Position.CB)  v = s.speed*30 + s.agility*25 + s.coverage*35 + s.awareness*10;
        else if (pos == Position.S)   v = s.speed*25 + s.coverage*35 + s.tackle*30 + s.awareness*10;
        else                          v = s.kickPower*50 + s.awareness*50; // K / P
        return uint8(v / 100);
    }
}
