// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// TEST/DRY-RUN ONLY. Pulls Chainlink's VRFCoordinatorV2Mock into the compile so
// ProofSettlement (a VRF v2 consumer) can be exercised without a live coordinator
// — MegaETH testnet has no Chainlink VRF deployment yet, so tests + the local
// dry-run stand in a mock coordinator (createSubscription / fund / addConsumer /
// fulfillRandomWords). NOT deployed to mainnet.
import "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";
