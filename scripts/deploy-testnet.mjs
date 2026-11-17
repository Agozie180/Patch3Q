import fs from "node:fs";
import path from "node:path";

import { qorechainTestnet } from "@qorechain/evm";
import { deriveUnifiedAccount, validateMnemonic } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function readLocalEnv() {
  const filename = path.join(process.cwd(), ".env");
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(fs.readFileSync(filename, "utf8").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      const raw = line.slice(separator + 1).trim();
      const value = /^(['"]).*\1$/u.test(raw) ? raw.slice(1, -1) : raw;
      return [line.slice(0, separator).trim(), value];
    }));
}

function readArtifact(name) {
  const filename = path.join(process.cwd(), "artifacts", name + ".json");
  if (!fs.existsSync(filename)) throw new Error(`Missing ${filename}; run pnpm compile:contract first.`);
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

const localEnv = readLocalEnv();
const privateKey = process.env.PATCH3Q_DEPLOYER_PRIVATE_KEY ?? localEnv.PATCH3Q_DEPLOYER_PRIVATE_KEY;
const mnemonic = process.env.PATCH3Q_DEPLOYER_MNEMONIC ?? localEnv.PATCH3Q_DEPLOYER_MNEMONIC ??
  localEnv.SEEDPHRASE_WALLET ?? localEnv["SEEDPHRASE-WALLET"];
let account;
if (privateKey && /^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  account = privateKeyToAccount(privateKey);
} else if (mnemonic) {
  if (!validateMnemonic(mnemonic)) throw new Error("The deployment mnemonic is not a valid checksum-correct BIP-39 phrase.");
  const unified = await deriveUnifiedAccount(mnemonic);
  account = privateKeyToAccount(unified.privateKey);
} else {
  throw new Error("Set PATCH3Q_DEPLOYER_PRIVATE_KEY or PATCH3Q_DEPLOYER_MNEMONIC in .env for a funded Diana unified account with an active EVM window.");
}
const transport = http(qorechainTestnet.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: qorechainTestnet, transport });
const walletClient = createWalletClient({ account, chain: qorechainTestnet, transport });
const chainId = await publicClient.getChainId();
if (chainId !== qorechainTestnet.id) {
  throw new Error(`RPC chain mismatch: expected ${qorechainTestnet.id}, received ${chainId}.`);
}

let tokenAddress = process.env.PATCH3Q_TUSDT_ADDRESS ?? localEnv.PATCH3Q_TUSDT_ADDRESS;
let tokenDeployment;
if (tokenAddress) {
  if (!isAddress(tokenAddress) || tokenAddress === zeroAddress) throw new Error("PATCH3Q_TUSDT_ADDRESS is invalid.");
  tokenAddress = getAddress(tokenAddress);
  const tokenCode = await publicClient.getCode({ address: tokenAddress });
  if (!tokenCode || tokenCode === "0x") {
    throw new Error("PATCH3Q_TUSDT_ADDRESS has no contract bytecode on Diana.");
  }
} else {
  const token = readArtifact("MockTUSDT");
  const hash = await walletClient.deployContract({ abi: token.abi, bytecode: token.bytecode });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("MockTUSDT deployment failed.");
  tokenAddress = receipt.contractAddress;
  tokenDeployment = hash;
}

const registry = readArtifact("Patch3QRegistry");
const registryHash = await walletClient.deployContract({
  abi: registry.abi,
  bytecode: registry.bytecode,
  args: [tokenAddress],
});
const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash });
if (registryReceipt.status !== "success" || !registryReceipt.contractAddress) {
  throw new Error("Patch3QRegistry deployment failed.");
}

process.stdout.write(JSON.stringify({
  network: "qorechain-diana",
  chainId,
  deployer: account.address,
  bountyTokenAddress: tokenAddress,
  tokenDeployment: tokenDeployment ?? null,
  registryAddress: registryReceipt.contractAddress,
  registryDeployment: registryHash,
}, null, 2) + "\n");
