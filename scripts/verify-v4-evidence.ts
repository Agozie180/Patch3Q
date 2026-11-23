import fs from "node:fs";
import path from "node:path";

import { qorechainTestnet } from "@qorechain/evm";
import { fetchKemKey } from "@qorechain/sdk";
import { createPublicClient, decodeEventLog, encodeDeployData, getAddress, hexToBytes, http, keccak256, sha256 as viemSha256 } from "viem";

import { v4BundleHash, parseV4SeverityApproval, verifyV4QuorumApproval } from "../src/lib/v4-approval.js";
import { parseV4BundleBytes } from "../src/lib/v4-bundle.js";
import { hashText, parseBundle } from "../src/lib/patch3q.js";

const root = process.cwd();
const deployment = JSON.parse(fs.readFileSync(path.join(root, "evidence", "v4-deployment.json"), "utf8"));
const artifact = JSON.parse(fs.readFileSync(path.join(root, deployment.artifact), "utf8"));
const policy = deployment.policyEvidence
  ? JSON.parse(fs.readFileSync(path.join(root, deployment.policyEvidence), "utf8"))
  : undefined;
const lifecycle = deployment.lifecycleEvidence
  ? JSON.parse(fs.readFileSync(path.join(root, deployment.lifecycleEvidence), "utf8"))
  : undefined;
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
const checks: Array<{ check: string; passed: boolean; actual?: string }> = [];
const record = (check: string, passed: boolean, actual?: unknown) => checks.push({ check, passed, ...(actual === undefined ? {} : { actual: String(actual) }) });

const [receipt, transaction, runtime, chainId] = await Promise.all([
  client.getTransactionReceipt({ hash: deployment.deploymentHash }),
  client.getTransaction({ hash: deployment.deploymentHash }),
  client.getCode({ address: deployment.registryAddress }),
  client.getChainId(),
]);
record("Diana chain ID is 9800", chainId === 9800, chainId);
record("deployment receipt succeeded", receipt.status === "success", receipt.status);
record("receipt contract matches manifest", receipt.contractAddress?.toLowerCase() === deployment.registryAddress.toLowerCase(), receipt.contractAddress);
record("deployment block matches manifest", receipt.blockNumber.toString() === deployment.deploymentBlock, receipt.blockNumber);
record("deployment sender is the verified V2 wallet", transaction.from.toLowerCase() === deployment.deployer.toLowerCase(), transaction.from);
const expectedInput = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [deployment.bountyTokenAddress] });
record("creation bytecode and constructor argument match", transaction.input.toLowerCase() === expectedInput.toLowerCase(), keccak256(transaction.input));
record("deployed runtime is non-empty", Boolean(runtime && runtime !== "0x"), runtime ? (runtime.length - 2) / 2 : 0);

const bountyToken = await client.readContract({
  address: deployment.registryAddress,
  abi: artifact.abi,
  functionName: "bountyToken",
});
record("immutable bounty token matches manifest", getAddress(bountyToken) === getAddress(deployment.bountyTokenAddress), bountyToken);
const expectedRuntime = artifact.deployedBytecode.toLowerCase();
const tokenWord = `${"0".repeat(24)}${deployment.bountyTokenAddress.slice(2).toLowerCase()}`;
const normalizedRuntime = runtime?.toLowerCase().replaceAll(tokenWord, "0".repeat(64));
record("runtime bytecode matches compiled V4 artifact after immutable masking", normalizedRuntime === expectedRuntime, runtime ? keccak256(runtime) : "0x");

if (policy) {
  const [state, auditors, relayers, registryTokenBalance] = await Promise.all([
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "programPolicyState", args: [policy.program] }),
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "programAuditors", args: [policy.program] }),
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "programRelayers", args: [policy.program] }),
    client.readContract({ address: deployment.bountyTokenAddress, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [deployment.registryAddress] }),
  ]);
  record("V4 program policy exists and is enabled", state[0] && state[1]);
  const expectedAvailablePool = lifecycle?.finalState.availablePool ?? policy.state.availablePool;
  const expectedOpenCases = lifecycle?.finalState.openCases ?? policy.state.openCases;
  record("available pool matches current evidence", state[2].toString() === expectedAvailablePool, state[2]);
  record("reserve per case matches policy", state[3].toString() === policy.reservePerCase, state[3]);
  record("open-case capacity matches policy", Number(state[4]) === policy.maxOpenCases, state[4]);
  record("open case count matches current evidence", Number(state[5]) === expectedOpenCases, state[5]);
  record("auditor threshold is 2-of-3", Number(state[6]) === 2 && auditors.length === 3, `${state[6]}-of-${auditors.length}`);
  record("ordered auditor snapshot policy matches evidence", JSON.stringify(auditors.map((entry) => entry.toLowerCase())) === JSON.stringify(policy.auditors.map((entry: string) => entry.toLowerCase())));
  record("authorized relayer policy matches evidence", JSON.stringify(relayers.map((entry) => entry.toLowerCase())) === JSON.stringify(policy.relayers.map((entry: string) => entry.toLowerCase())));
  record("registry token balance backs available pool", registryTokenBalance >= state[2], registryTokenBalance);
  for (const [name, hash] of Object.entries(policy.transactions as Record<string, unknown>)) {
    if (typeof hash !== "string" || !hash.startsWith("0x")) continue;
    const policyReceipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
    record(`policy transaction ${name} succeeded`, policyReceipt.status === "success", hash);
  }
}

if (lifecycle) {
  record("V4 lifecycle evidence is marked verified", lifecycle.status === "verified", lifecycle.status);
  record("lifecycle registry matches deployment", getAddress(lifecycle.registryAddress) === getAddress(deployment.registryAddress), lifecycle.registryAddress);
  record("lifecycle token matches deployment", getAddress(lifecycle.bountyTokenAddress) === getAddress(deployment.bountyTokenAddress), lifecycle.bountyTokenAddress);

  const bundle = parseBundle(fs.readFileSync(path.join(root, lifecycle.bundleFile), "utf8"));
  const approval = parseV4SeverityApproval(fs.readFileSync(path.join(root, lifecycle.approvalFile), "utf8"));
  record("lifecycle case ID hashes to the committed case ID", await hashText(bundle.caseId) === lifecycle.caseIdHash, lifecycle.caseIdHash);
  record("compressed bundle hashes to the on-chain bundle commitment", await v4BundleHash(bundle) === lifecycle.bundleHash, lifecycle.bundleHash);
  record("recovered bundle hash matches submitted bundle hash", lifecycle.recoveredBundleHash === lifecycle.bundleHash, lifecycle.recoveredBundleHash);
  record("program independently decrypted and verified the recovered bundle", lifecycle.programDecryptionVerified === true);

  const txNames = ["submit", "acknowledge", "triage", "release"] as const;
  const expectedSenders = {
    submit: lifecycle.relayer.evm,
    acknowledge: lifecycle.program.evm,
    triage: lifecycle.program.evm,
    release: lifecycle.relayer.evm,
  };
  const receipts: Record<string, Awaited<ReturnType<typeof client.getTransactionReceipt>>> = {};
  for (const name of txNames) {
    const ref = lifecycle.transactions[name];
    const [txReceipt, tx] = await Promise.all([
      client.getTransactionReceipt({ hash: ref.hash }),
      client.getTransaction({ hash: ref.hash }),
    ]);
    receipts[name] = txReceipt;
    record(`lifecycle ${name} transaction succeeded`, txReceipt.status === "success", ref.hash);
    record(`lifecycle ${name} sender and target match`,
      getAddress(tx.from) === getAddress(expectedSenders[name]) && getAddress(tx.to!) === getAddress(deployment.registryAddress),
      `${tx.from} -> ${tx.to}`);
  }

  const submitEvents = receipts.submit.logs.flatMap((log) => {
    try { return [decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics })]; } catch { return []; }
  });
  const published = submitEvents.find((event) => event.eventName === "EncryptedBundlePublished") as
    | { args: { caseIdHash: `0x${string}`; bundleHash: `0x${string}`; encryptedBundle: `0x${string}` } }
    | undefined;
  record("submission emitted the funded reservation and durable bundle events",
    submitEvents.some((event) => event.eventName === "FundedAnonymousCaseSubmitted") && Boolean(published));
  if (published) {
    record("published bytes hash to the lifecycle bundle commitment", viemSha256(published.args.encryptedBundle) === lifecycle.bundleHash, published.args.bundleHash);
    const recovered = await parseV4BundleBytes(hexToBytes(published.args.encryptedBundle));
    record("published compressed bytes recover the exact case", recovered.caseId === bundle.caseId && await hashText(recovered.caseId) === lifecycle.caseIdHash, recovered.caseId);
  }

  const releaseEvents = receipts.release.logs.flatMap((log) => {
    try { return [decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics })]; } catch { return []; }
  });
  record("release emitted quorum approval and bounty payment",
    releaseEvents.some((event) => event.eventName === "QuorumApprovalRecorded") && releaseEvents.some((event) => event.eventName === "BountyReleased"));

  const [caseState, caseAuditors, currentPolicy, payoutBalance, registryBalance] = await Promise.all([
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "caseState", args: [lifecycle.caseIdHash] }),
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "caseAuditors", args: [lifecycle.caseIdHash] }),
    client.readContract({ address: deployment.registryAddress, abi: artifact.abi, functionName: "programPolicyState", args: [lifecycle.program.evm] }),
    client.readContract({ address: deployment.bountyTokenAddress, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [lifecycle.payout.recipient] }),
    client.readContract({ address: deployment.bountyTokenAddress, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [deployment.registryAddress] }),
  ]);
  record("case resolved at Critical severity with no escrow left", Number(caseState[0]) === 3 && Number(caseState[1]) === 5 && caseState[3] === 0n, `${caseState[0]}/${caseState[1]}/${caseState[3]}`);
  record("case approval hash matches the verified quorum approval", caseState[9] === approval.approvalHash && approval.approvalHash === lifecycle.approvalHash, caseState[9]);
  record("case snapshots the configured ordered 2-of-3 auditor set",
    Number(caseState[12]) === 2 && JSON.stringify(caseAuditors.map((entry) => entry.toLowerCase())) === JSON.stringify(lifecycle.auditors.map((entry: string) => entry.toLowerCase())));
  record("full 2,500 tUSDT reserve reached the sealed payout address", payoutBalance.toString() === lifecycle.payout.amount, payoutBalance);
  record("pool decreased from 25,000 to 22,500 tUSDT and capacity was released",
    lifecycle.reservation.poolBefore === "25000000000" && lifecycle.reservation.poolAfterSubmission === "22500000000" &&
    currentPolicy[2].toString() === "22500000000" && Number(currentPolicy[5]) === 0 && registryBalance.toString() === "22500000000",
    `${currentPolicy[2]}/${currentPolicy[5]}/${registryBalance}`);

  const deadlineOffset = (onchain: bigint, iso: string) => Number(onchain) - Math.floor(Date.parse(iso) / 1000);
  const offsets = [
    deadlineOffset(caseState[4], bundle.publicMetadata.acknowledgeBy),
    deadlineOffset(caseState[5], bundle.publicMetadata.triageBy),
    deadlineOffset(caseState[6], bundle.publicMetadata.embargoUntil),
  ];
  record("bundle SLA schedule and authoritative on-chain deadlines use one consistent submission offset",
    offsets.every((offset) => offset === offsets[0]) && Math.abs(offsets[0]) <= 600, offsets.join(","));

  const approvalVerification = await verifyV4QuorumApproval(bundle, approval, deployment.registryAddress, "program", "https://api-testnet.qore.host");
  record("program plus two unique auditors independently verify against live PQ keys", approvalVerification.verified,
    Object.entries(approvalVerification.checks).filter(([, passed]) => !passed).map(([name]) => name).join(",") || "all checks pass");

  const kemTx = await fetch(`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${lifecycle.transactions.programKem.hash}`).then((response) => response.json()) as {
    tx?: { body?: { messages?: Array<{ "@type"?: string; sender?: string }> } };
    tx_response?: { code?: number };
  };
  const kem = await fetchKemKey({ rest: "https://api-testnet.qore.host", address: lifecycle.program.qor });
  record("V2 program published its ML-KEM-1024 key with a successful native transaction",
    kemTx.tx_response?.code === 0 && kemTx.tx?.body?.messages?.[0]?.["@type"] === "/qorechain.pqc.v1.MsgRegisterKEMKey" &&
    kemTx.tx.body.messages[0].sender === lifecycle.program.qor && kem.found,
    lifecycle.transactions.programKem.hash);
}

const report = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  registryAddress: deployment.registryAddress,
  deploymentHash: deployment.deploymentHash,
  passed: checks.filter((entry) => entry.passed).length,
  total: checks.length,
  checks,
};
fs.writeFileSync(path.join(root, "evidence", "v4-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.passed !== report.total) process.exitCode = 1;
