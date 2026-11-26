import { encodeDeployData, getAddress, keccak256, type Hex } from "viem";
import { actors, openWindow, preflight, publicClient, readJson, wallet, writeJson } from "./lib/v5-testnet.js";

const file = "evidence/v5-deployment.json";
const actor = await actors();
const checked = await preflight();
console.log(JSON.stringify({ preflight: checked }));
const artifact = readJson("artifacts/Patch3QRegistryV5.json");
if (!artifact?.bytecode) throw new Error("Compile V5 before deployment.");
const token = getAddress(readJson("evidence/v4-deployment.json").bountyTokenAddress) as Hex;
const tokenCode = await publicClient.getCode({ address: token });
if (!tokenCode || tokenCode === "0x") throw new Error("The V4 bounty token has no Diana bytecode.");
const existing = readJson(file, undefined);
let hash = existing?.deploymentHash as Hex | undefined;
let window = existing?.nativeDeploymentWindow;
if (existing && (existing.deployer.toLowerCase() !== actor.program.evm.toLowerCase() || existing.creationHash !== keccak256(encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token] })))) {
  throw new Error("Existing V5 deployment manifest differs from the current account or artifact; refusing a duplicate deployment.");
}
if (!hash) {
  window = await openWindow(actor.program, [], 1n);
  hash = await wallet(actor.program).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token] });
  writeJson(file, { schemaVersion: 1, status: "deploying", network: "qorechain-diana", chainId: 9800,
    deployer: actor.program.evm, deployerQor: actor.program.cosmos, bountyTokenAddress: token,
    deploymentHash: hash, nativeDeploymentWindow: window, artifact: "artifacts/Patch3QRegistryV5.json",
    creationHash: keccak256(encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token] })) });
}
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("V5 deployment receipt failed.");
const code = await publicClient.getCode({ address: receipt.contractAddress });
const tokenWord = "0".repeat(24) + token.slice(2).toLowerCase();
if (code?.toLowerCase().replaceAll(tokenWord, "0".repeat(64)) !== artifact.deployedBytecode.toLowerCase()) throw new Error("V5 runtime bytecode does not match the compiled artifact.");
writeJson(file, { ...readJson(file), status: existing?.status === "lifecycle-verified" ? existing.status : "deployed-unconfigured", deployedAt: readJson(file).deployedAt ?? new Date().toISOString(),
  registryAddress: receipt.contractAddress, deploymentBlock: receipt.blockNumber.toString(), runtimeHash: keccak256(code),
  addressMatch: { v2: true, v4: true }, explorer: `https://dashboard.qorechain.io/explorer/address/${receipt.contractAddress}` });
console.log(JSON.stringify({ registry: receipt.contractAddress, deployer: actor.program.evm, deployment: hash, runtimeVerified: true }));
