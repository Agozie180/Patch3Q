import fs from "node:fs";
import path from "node:path";

import { qorechainTestnet } from "@qorechain/evm";
import { deriveUnifiedAccount, validateMnemonic } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function readEnvFile(filename) {
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

function readJson(filename) {
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : undefined;
}

const root = process.cwd();
const localEnv = {
  ...readEnvFile(path.join(root, ".env")),
  ...readEnvFile(path.join(root, ".env.testnet")),
};
const privateKey = process.env.PATCH3Q_DEPLOYER_PRIVATE_KEY ?? localEnv.PATCH3Q_DEPLOYER_PRIVATE_KEY;
const mnemonic = process.env.PATCH3Q_DEPLOYER_MNEMONIC ?? localEnv.PATCH3Q_DEPLOYER_MNEMONIC ??
  localEnv.SEEDPHRASE_WALLET ?? localEnv["SEEDPHRASE-WALLET"];
let account;
if (privateKey && /^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  account = privateKeyToAccount(privateKey);
} else if (mnemonic) {
  if (!validateMnemonic(mnemonic)) throw new Error("The deployment mnemonic is not a valid BIP-39 phrase.");
  const unified = await deriveUnifiedAccount(mnemonic);
  account = privateKeyToAccount(unified.privateKey);
} else {
  throw new Error("Set PATCH3Q_DEPLOYER_PRIVATE_KEY or PATCH3Q_DEPLOYER_MNEMONIC for the v4 deployment.");
}

const v3Evidence = readJson(path.join(root, "evidence", "testnet-v3.json"));
const rawToken = process.env.PATCH3Q_V4_TUSDT_ADDRESS ?? localEnv.PATCH3Q_V4_TUSDT_ADDRESS ??
  process.env.PATCH3Q_TUSDT_ADDRESS ?? localEnv.PATCH3Q_TUSDT_ADDRESS ?? v3Evidence?.bountyTokenAddress;
if (!rawToken || !isAddress(rawToken) || rawToken === zeroAddress) {
  throw new Error("Set PATCH3Q_V4_TUSDT_ADDRESS or keep a valid v3 bountyTokenAddress in evidence/testnet-v3.json.");
}
const tokenAddress = getAddress(rawToken);
const artifact = readJson(path.join(root, "artifacts", "Patch3QRegistryV4.json"));
if (!artifact?.bytecode) throw new Error("Run pnpm compile:contract before deploying v4.");

const transport = http(qorechainTestnet.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: qorechainTestnet, transport });
const walletClient = createWalletClient({ account, chain: qorechainTestnet, transport });
const tokenCode = await publicClient.getCode({ address: tokenAddress });
if (!tokenCode || tokenCode === "0x") throw new Error("The configured v4 bounty token has no Diana bytecode.");

const deploymentHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [tokenAddress],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Patch3QRegistryV4 deployment failed.");

const report = {
  schemaVersion: 1,
  status: "deployed-unconfigured",
  deployedAt: new Date().toISOString(),
  network: "qorechain-diana",
  chainId: qorechainTestnet.id,
  deployer: account.address,
  bountyTokenAddress: tokenAddress,
  registryAddress: receipt.contractAddress,
  deploymentHash,
  deploymentBlock: receipt.blockNumber.toString(),
  artifact: "artifacts/Patch3QRegistryV4.json",
};
fs.writeFileSync(path.join(root, "evidence", "v4-deployment.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
