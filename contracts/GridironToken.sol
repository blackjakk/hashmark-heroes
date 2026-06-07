// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice GRID — the in-game currency for GridironChain on MegaETH
contract GridironToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10 ** 18;
    uint256 public constant FAUCET_AMOUNT  = 50_000   * 10 ** 18;
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    mapping(address => uint256) public lastFaucetTime;

    event Faucet(address indexed recipient, uint256 amount);

    constructor() ERC20("Gridiron Token", "GRID") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Testnet faucet — one use per 24 h per address
    function faucet() external {
        require(
            block.timestamp >= lastFaucetTime[msg.sender] + FAUCET_COOLDOWN,
            "GRID: cooldown active"
        );
        lastFaucetTime[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner can mint rewards / prizes
    function mintReward(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
