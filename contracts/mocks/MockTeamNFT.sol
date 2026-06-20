// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/// @notice TEST-ONLY minimal team-ownership registry. The real TeamNFT seeds 32
/// franchises (with name/city/colors strings) in its constructor, whose init
/// code exceeds the EIP-3860 limit on the in-process test net. LeagueManager's
/// proven-result path only reads `ownerOf(teamId)`, so this stand-in exercises
/// the exact owner-binding in `ingestResult` without the heavyweight deploy.
/// NOT for production — see contracts/TeamNFT.sol for the real ERC-721.
contract MockTeamNFT {
    mapping(uint256 => address) private _owners;

    function setOwner(uint256 teamId, address who) external {
        _owners[teamId] = who;
    }

    function ownerOf(uint256 teamId) external view returns (address) {
        address o = _owners[teamId];
        require(o != address(0), "MockTeamNFT: no owner");
        return o;
    }
}
