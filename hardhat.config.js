require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    megaeth: {
      // The old default (carrot.megaeth.com) is stale: carrot now lives at /rpc
      // and reports chainId 6343. The thirdweb endpoint below is a working 6342
      // pair matching the configured chainId. ALWAYS override BOTH with MegaETH's
      // current official RPC + chainId from their docs before a real deploy.
      url: process.env.MEGAETH_RPC_URL || "https://6342.rpc.thirdweb.com",
      chainId: Number(process.env.MEGAETH_CHAIN_ID || 6342),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  etherscan: {
    apiKey: {
      megaeth: process.env.MEGAETH_EXPLORER_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "megaeth",
        chainId: 6342,
        urls: {
          apiURL: "https://www.megaexplorer.xyz/api",
          browserURL: "https://www.megaexplorer.xyz",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    artifacts: "./src/contracts/artifacts",
  },
};
