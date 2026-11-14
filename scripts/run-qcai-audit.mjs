import fs from "node:fs";
import path from "node:path";

import {
  AI_ANOMALY_CHECK_ADDRESS,
  AI_RISK_SCORE_ADDRESS,
  RISK_LEVEL_UNSAFE_THRESHOLD,
  aiAnomalyCheck,
  aiRiskScore,
  qorechainTestnet,
} from "@qorechain/evm";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  zeroHash,
} from "viem";

const root = process.cwd();
const artifactPath = path.join(root, "artifacts", "Patch3QRegistry.json");
if (!fs.existsSync(artifactPath)) {
  throw new Error("Missing artifacts/Patch3QRegistry.json; run pnpm compile:contract first.");
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const rpcUrl = process.env.PATCH3Q_EVM_RPC_URL || qorechainTestnet.rpcUrls.default.http[0];
const client = createPublicClient({ chain: qorechainTestnet, transport: http(rpcUrl) });
const chainId = await client.getChainId();
if (chainId !== qorechainTestnet.id) {
  throw new Error(`RPC chain mismatch: expected ${qorechainTestnet.id}, received ${chainId}.`);
}

const addresses = {
  reporter: "0x1000000000000000000000000000000000000001",
  program: "0x2000000000000000000000000000000000000002",
  auditor: "0x3000000000000000000000000000000000000003",
  token: "0x4000000000000000000000000000000000000004",
};
const caseIdHash = keccak256(toBytes("P3Q-QCAI-AUDIT-CASE"));
const envelopeHash = keccak256(toBytes("synthetic-encrypted-envelope"));
const contentCommitment = keccak256(toBytes("synthetic-salted-report"));
const programRef = keccak256(toBytes("security@qore.network"));
const rationaleHash = keccak256(toBytes("critical authorization bypass with direct loss"));
const now = Math.floor(Date.now() / 1000);

const samples = [
  {
    name: "deploy-registry",
    functionName: "constructor(address)",
    data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [addresses.token] }),
  },
  {
    name: "submit-sealed-case",
    functionName: "submitCase",
    data: encodeFunctionData({
      abi: artifact.abi,
      functionName: "submitCase",
      args: [
        addresses.program,
        addresses.auditor,
        caseIdHash,
        envelopeHash,
        contentCommitment,
        programRef,
        BigInt(now + 86_400),
        BigInt(now + 604_800),
        BigInt(now + 2_592_000),
      ],
    }),
  },
  {
    name: "acknowledge-case",
    functionName: "acknowledgeCase",
    data: encodeFunctionData({ abi: artifact.abi, functionName: "acknowledgeCase", args: [caseIdHash] }),
  },
  {
    name: "escalate-missed-deadline",
    functionName: "escalateMissedDeadline",
    data: encodeFunctionData({ abi: artifact.abi, functionName: "escalateMissedDeadline", args: [caseIdHash] }),
  },
  {
    name: "fund-bounty",
    functionName: "fundBounty",
    data: encodeFunctionData({ abi: artifact.abi, functionName: "fundBounty", args: [caseIdHash, 2_500_000_000n] }),
  },
  {
    name: "dual-pq-approve-and-release",
    functionName: "approveSeverity",
    data: encodeFunctionData({
      abi: artifact.abi,
      functionName: "approveSeverity",
      args: [caseIdHash, 5, 2_500_000_000n, rationaleHash, "0x1234", "0x5678"],
    }),
  },
  {
    name: "publish-redacted-commitment",
    functionName: "discloseCase",
    data: encodeFunctionData({
      abi: artifact.abi,
      functionName: "discloseCase",
      args: [caseIdHash, keccak256(toBytes("synthetic redacted report"))],
    }),
  },
];

const scoredTransactions = [];
for (const sample of samples) {
  const base = {
    name: sample.name,
    functionName: sample.functionName,
    calldataHash: keccak256(sample.data),
    calldataBytes: (sample.data.length - 2) / 2,
  };
  try {
    const risk = await aiRiskScore(client, sample.data);
    scoredTransactions.push({
      ...base,
      status: "returned",
      score: risk.score.toString(),
      level: risk.level,
      belowSdkUnsafeThreshold: risk.level < RISK_LEVEL_UNSAFE_THRESHOLD,
    });
  } catch (error) {
    scoredTransactions.push({
      ...base,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const anomalyInputs = [
  { name: "zero-native-value-contract-call", sender: addresses.reporter, amount: 0n },
  { name: "synthetic-native-value-stress-case", sender: addresses.program, amount: 2_500_000_000n },
];
const anomalyChecks = [];
for (const input of anomalyInputs) {
  const base = { name: input.name, sender: input.sender, amount: input.amount.toString() };
  try {
    const result = await aiAnomalyCheck(client, input.sender, input.amount);
    anomalyChecks.push({
      ...base,
      status: "returned",
      anomalyScore: result.anomalyScore.toString(),
      flagged: result.flagged,
    });
  } catch (error) {
    anomalyChecks.push({
      ...base,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const blockNumber = await client.getBlockNumber();
const qcaiAvailable = scoredTransactions.every((item) => item.status === "returned") &&
  anomalyChecks.every((item) => item.status === "returned");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  network: "qorechain-diana",
  chainId,
  rpcUrl,
  blockNumber: blockNumber.toString(),
  status: qcaiAvailable ? "completed" : "precompile-unavailable-on-public-diana-rpc",
  precompiles: {
    aiRiskScore: AI_RISK_SCORE_ADDRESS,
    aiAnomalyCheck: AI_ANOMALY_CHECK_ADDRESS,
  },
  sdkUnsafeLevelThreshold: RISK_LEVEL_UNSAFE_THRESHOLD,
  contract: {
    artifact: "artifacts/Patch3QRegistry.json",
    compiler: artifact.compiler,
    creationBytecodeHash: keccak256(artifact.bytecode),
    deployedBytecodeHash: artifact.deployedBytecode === "0x" ? zeroHash : keccak256(artifact.deployedBytecode),
  },
  methodology: {
    risk: "Live eth_call to QCAI aiRiskScore(bytes) for compiled creation bytecode and representative Patch3Q calldata.",
    anomaly: "Live eth_call to QCAI aiAnomalyCheck(address,uint256) using clearly synthetic addresses and native-value amounts.",
  },
  transactions: scoredTransactions,
  anomalies: anomalyChecks,
  limitations: [
    "QCAI results are advisory transaction-risk signals, not a source-code security proof.",
    "Representative calldata is synthetic and was not broadcast; this artifact contains no deployment or lifecycle transaction hashes.",
    "The anomaly amount is native EVM value. Patch3Q bounty amounts are ERC-20 units and are represented inside calldata instead.",
    "A score can change when QCAI models or chain state change; the block number and bytecode hashes make this run reproducible.",
  ],
};

const outputArgIndex = process.argv.indexOf("--output");
const outputPath = outputArgIndex >= 0
  ? path.resolve(root, process.argv[outputArgIndex + 1])
  : path.join(root, "evidence", "qcai-audit.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ output: path.relative(root, outputPath), ...report }, null, 2) + "\n");
