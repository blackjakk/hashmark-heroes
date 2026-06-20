# Deploying the GridironChain contracts (MegaETH)

The on-chain layer is **optional** — the game and H2H server run with no chain at
all. This deploys the franchise/settlement contracts when you want on-chain
identity + proven results. Toolchain is Hardhat (solc 0.8.20); deps are in
`package.json` and not committed.

## What gets deployed (`scripts/deploy.js`, in order)

1. `GridironToken` (GRID) — mints the initial supply to the deployer.
2. `TeamNFT` — 32 franchise NFTs; metadata is **seeded post-deploy** in chunks
   from `scripts/teams.js` (the literals can't live in the constructor — EIP-3860).
3. `PlayerNFT`, `DraftSystem`, `FreeAgency`.
4. `LeagueManager`.
5. `ProofSettlement` — the VRF-seeded optimistic settlement contract, then
   `LeagueManager.setProofSettlement(...)` links it as the proven-result source,
   and the resolver is set (if `RESOLVER` is provided).
6. Minter permissions + 100 000 GRID prize pool funding.

## Prerequisites

- **Node + deps**: `npm install`
- **A funded deployer key** on the target chain (testnet ETH from the MegaETH faucet).
- **The current MegaETH RPC + chainId.** ⚠️ The committed default
  (`carrot.megaeth.com`) is **stale** — carrot now answers at `/rpc` and reports
  chainId **6343**, while the config/thirdweb pair is **6342**. Confirm both
  against MegaETH's official docs and set them explicitly.
- **(Production VRF only)** a Chainlink **VRF v2 coordinator** address on the
  chain + a **funded subscription** + a **key hash**. MegaETH testnet has no
  Chainlink VRF deployment today, so without these the deploy auto-stands-up a
  `VRFCoordinatorV2Mock` (fine for testing; randomness is not production-grade).

## Environment variables

```bash
# required for any real deploy
export PRIVATE_KEY=0x<funded-deployer-key>
export MEGAETH_RPC_URL=https://<megaeth-official-rpc>
export MEGAETH_CHAIN_ID=<6342-or-current>      # MUST match the RPC's chainId

# optional settlement params (sensible defaults shown)
export SETTLEMENT_BOND=0.01                     # ETH bond to propose/challenge
export CHALLENGE_WINDOW=3600                    # seconds
export RESOLVER=0x<dispute-referee-multisig>    # defaults to the deployer

# optional — real Chainlink VRF (omit to auto-deploy a mock)
export VRF_COORDINATOR=0x<coordinator>
export VRF_SUBSCRIPTION_ID=<subId>
export VRF_KEY_HASH=0x<gas-lane-key-hash>
```

## Steps

```bash
npm install
npx hardhat compile

# 1. DRY-RUN on the in-process node (no key/funds, no addresses written) —
#    proves the whole stack deploys + wires. Should print "(dry-run …)".
npx hardhat run scripts/deploy.js

# 2. REAL deploy to MegaETH (after setting the env vars above)
npx hardhat run scripts/deploy.js --network megaeth
#    → writes src/contracts/addresses.json
```

## After a real deploy

- **If you used a real VRF coordinator**, register `ProofSettlement` as a
  **consumer** on your subscription (the script does this automatically only for
  the mock). Do it via the Chainlink UI or `VRFCoordinatorV2.addConsumer(subId,
  proofSettlement)`. Until then `openMatch` (which calls `requestRandomWords`)
  will revert.
- **Fund** the subscription with LINK so `fulfillRandomWords` callbacks are paid.
- The off-chain authority should adopt the on-chain VRF seed as the game seed so
  the artifact re-sims against the committed randomness (see
  `INGAME_CLOCK_AND_MULTIPLAYER.md` — the server already runs portable/bit-exact).

## Verify a settled match (anyone, no trust)

```bash
node server/verify-artifact.js <artifact-url | artifact.json | ->
# exit 0 = PROVEN, 1 = MISMATCH (grounds for an on-chain challenge)
```

## Notes

- Contract sizes are within EVM limits (TeamNFT init 10 KB / runtime 8.8 KB after
  the metadata move). Verify with `npx hardhat test` (37 tests, incl. a
  deploy-within-limits assertion).
- `npm run deploy` / `deploy:local` / `seed` shortcuts are in `package.json`.
