import fs from "node:fs";
import path from "node:path";

import { qorechainTestnet } from "@qorechain/evm";
import { deriveUnifiedAccount, validateMnemonic } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function readEnvFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(fs.readFileSync(filename, "utf8").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "")];
    }));
}

const root = process.cwd();
const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "Patch3QRegistryV4.json"), "utf8"));
const deploymentFile = path.join(root, "evidence", "v4-deployment.json");
const deployment = fs.existsSync(deploymentFile) ? JSON.parse(fs.readFileSync(deploymentFile, "utf8")) : {};
const localEnv = { ...readEnvFile(path.join(root, ".env")), ...readEnvFile(path.join(root, ".env.testnet")) };
const rawRegistry = process.env.PATCH3Q_V4_REGISTRY_ADDRESS ?? localEnv.PATCH3Q_V4_REGISTRY_ADDRESS ?? deployment.registryAddress;
if (!rawRegistry || !isAddress(rawRegistry)) throw new Error("Configure PATCH3Q_V4_REGISTRY_ADDRESS or deploy v4 first.");
const registryAddress = getAddress(rawRegistry);
const fromBlock = BigInt(process.env.PATCH3Q_V4_FROM_BLOCK ?? localEnv.PATCH3Q_V4_FROM_BLOCK ?? deployment.deploymentBlock ?? 0);
const transport = http(qorechainTestnet.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: qorechainTestnet, transport });
const latestBlock = await publicClient.getBlock();
const submissions = await publicClient.getContractEvents({
  address: registryAddress,
  abi: artifact.abi,
  eventName: "FundedAnonymousCaseSubmitted",
  fromBlock,
  toBlock: latestBlock.number,
  strict: true,
});
const caseIds = [...new Set(submissions.map((event) => event.args.caseIdHash))];
const eligible = [];
for (const caseIdHash of caseIds) {
  const state = await publicClient.readContract({
    address: registryAddress,
    abi: artifact.abi,
    functionName: "caseState",
    args: [caseIdHash],
  });
  const status = Number(state[0]);
  const deadline = status === 0 ? state[4] : status === 1 ? state[5] : undefined;
  if (deadline !== undefined && latestBlock.timestamp > deadline) {
    eligible.push({ caseIdHash, status, deadline: deadline.toString() });
  }
}

const broadcast = process.argv.includes("--broadcast");
const results = [];
if (broadcast && eligible.length > 0) {
  const privateKey = process.env.PATCH3Q_KEEPER_PRIVATE_KEY ?? localEnv.PATCH3Q_KEEPER_PRIVATE_KEY;
  const mnemonic = process.env.PATCH3Q_KEEPER_MNEMONIC ?? localEnv.PATCH3Q_KEEPER_MNEMONIC;
  let account;
  if (privateKey && /^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
    account = privateKeyToAccount(privateKey);
  } else if (mnemonic) {
    if (!validateMnemonic(mnemonic)) throw new Error("PATCH3Q_KEEPER_MNEMONIC is invalid.");
    const unified = await deriveUnifiedAccount(mnemonic);
    account = privateKeyToAccount(unified.privateKey);
  } else {
    throw new Error("Broadcast mode requires PATCH3Q_KEEPER_PRIVATE_KEY or PATCH3Q_KEEPER_MNEMONIC.");
  }
  const walletClient = createWalletClient({ account, chain: qorechainTestnet, transport });
  for (const item of eligible) {
    const { request } = await publicClient.simulateContract({
      account,
      address: registryAddress,
      abi: artifact.abi,
      functionName: "escalateMissedDeadline",
      args: [item.caseIdHash],
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    results.push({ ...item, hash, success: receipt.status === "success" });
  }
}

process.stdout.write(`${JSON.stringify({
  network: "qorechain-diana",
  registryAddress,
  scannedFrom: fromBlock.toString(),
  scannedTo: latestBlock.number.toString(),
  eligible,
  broadcast,
  results,
}, null, 2)}\n`);
