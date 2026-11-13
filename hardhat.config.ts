import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  paths: {
    sources: "./contracts",
    cache: "./hardhat-cache",
    artifacts: "./hardhat-artifacts",
    tests: {
      nodejs: "./contract-tests",
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.30",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
    },
  },
});
