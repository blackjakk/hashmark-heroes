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
      url: process.env.MEGAETH_RPC_URL || "https://carrot.megaeth.com",
      chainId: 6342,
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
