import fs from "node:fs";
import { qorechainTestnet } from "@qorechain/evm";
import { fetchEvmWindow, fetchPqcStatus, pqcStatusPublicKey } from "@qorechain/sdk";
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeDeployData, getAddress, http, keccak256, sha256, type Hex } from "viem";
import { parseBundle, bundleToJson, hashText } from "../src/lib/patch3q.js";
import { parseV4BundleBytes } from "../src/lib/v4-bundle.js";
import { v4BundleHash, verifyV4QuorumApproval } from "../src/lib/v4-approval.js";
import { verifyV5Rejection } from "../src/lib/v5-rejection.js";

const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const deployment = read("evidence/v5-deployment.json");
const evidence = read("evidence/v5-lifecycle.json");
const security = read("evidence/v5-recipient-security.json");
const artifact = read(deployment.artifact);
const v2 = read("evidence/deployment-v2.json");
const v4 = read("evidence/v4-deployment.json");
const tokenAbi = read("artifacts/MockTUSDT.json").abi;
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0], { timeout: 30_000 }) });
const registry = getAddress(deployment.registryAddress);
const token = getAddress(deployment.bountyTokenAddress);
const checks: { check: string; passed: boolean; detail?: unknown }[] = [];
const record = (check: string, passed: boolean, detail?: unknown) => {
  checks.push({ check, passed, ...(detail === undefined ? {} : { detail }) }); console.log(`${passed ? "PASS" : "FAIL"} ${check}`);
};
const [receipt, transaction, code, chainId] = await Promise.all([client.getTransactionReceipt({ hash: deployment.deploymentHash }),
  client.getTransaction({ hash: deployment.deploymentHash }), client.getCode({ address: registry }), client.getChainId()]);
record("Diana chain is 9800", chainId === 9800);
record("V5 deployment succeeded at the manifest address", receipt.status === "success" && receipt.contractAddress?.toLowerCase() === registry.toLowerCase());
record("Seed deployer matches V2, V4 and the actual deployment sender", transaction.from.toLowerCase() === deployment.deployer.toLowerCase() && transaction.from.toLowerCase() === v2.deployer.evm.toLowerCase() && transaction.from.toLowerCase() === v4.deployer.toLowerCase());
record("V5 uses the preserved V4 bounty token", token.toLowerCase() === v4.bountyTokenAddress.toLowerCase());
record("Creation bytecode and constructor match the compiled artifact", transaction.input === encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token] }));
const tokenWord = "0".repeat(24) + token.slice(2).toLowerCase();
record("Runtime bytecode matches the compiled V5 artifact", code?.toLowerCase().replaceAll(tokenWord, "0".repeat(64)) === artifact.deployedBytecode.toLowerCase());
record("Runtime hash matches deployment evidence", Boolean(code && keccak256(code) === deployment.runtimeHash));
for (const name of ["program", "relayer"] as const) {
  const operator = security.operators[name];
  const window = await fetchEvmWindow({ rest: "https://api-testnet.qore.host", address: evidence[name].qor });
  record(`${name}: operator identity and closed EVM window`, operator.address.toLowerCase() === evidence[name].evm.toLowerCase()
    && operator.qor === evidence[name].qor && operator.evmWindowClosed === true && !window.live);
}
for (const [name, ref] of Object.entries({ ...evidence.native, deploymentWindow: deployment.nativeDeploymentWindow }) as [string, any][]) {
  const response = await fetch(`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${ref.hash}`);
  const body = await response.json() as any;
  const native = body.tx_response;
  record(`${name}: native transaction succeeded`, response.ok && Number(native?.code) === 0);
  if (!name.startsWith("pqc-")) {
    const hybrid = native?.events?.find((event: any) => event.type === "pqc_hybrid_verify")?.attributes.find((attribute: any) => attribute.key === "status")?.value;
    record(`${name}: native hybrid signature verified on chain`, hybrid === "verified");
  }
}
const receipts: Record<string, any> = {};
for (const [name, ref] of Object.entries(evidence.transactions) as [string, any][]) {
  const [txReceipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: ref.hash }), client.getTransaction({ hash: ref.hash })]);
  receipts[name] = txReceipt;
  record(`${name}: confirmed receipt`, txReceipt.status === "success" && txReceipt.blockNumber.toString() === ref.blockNumber);
  const tokenOperation = ["mintPoolTokens", "approvePool"].includes(name);
  record(`${name}: correct target`, tx.to?.toLowerCase() === (tokenOperation ? token : registry).toLowerCase());
  const relayed = name.endsWith(".submit") || name.endsWith(".release") || name.endsWith(".reject") || name.endsWith(".escalate");
  record(`${name}: correct program or relayer sender`, tx.from.toLowerCase() === (relayed ? evidence.relayer.evm : evidence.program.evm).toLowerCase());
}
for (const [name, entry] of Object.entries(evidence.cases) as [string, any][]) {
  const bundle = parseBundle(fs.readFileSync(entry.bundleFile, "utf8"));
  const state = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [entry.caseIdHash] }) as any;
  const decision = await client.readContract({ address: registry, abi: artifact.abi, functionName: "decisionState", args: [entry.caseIdHash] }) as any;
  record(`${name}: case ID commitment`, await hashText(bundle.caseId) === entry.caseIdHash);
  record(`${name}: ciphertext SHA-256 matches chain`, await v4BundleHash(bundle) === state[11] && entry.bundleHash === state[11]);
  const submitLogs = receipts[`${name}.submit`].logs.map((log: any) => { try { return decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }); } catch { return undefined; } });
  const published = submitLogs.find((log: any) => log?.eventName === "EncryptedBundlePublished");
  const recovered = published ? await parseV4BundleBytes(Buffer.from(published.args.encryptedBundle.slice(2), "hex")) : undefined;
  record(`${name}: exact encrypted bundle recovered from its submission receipt`, Boolean(recovered && bundleToJson(recovered) === bundleToJson(bundle)));
  record(`${name}: funded reserve is correct`, submitLogs.some((log: any) => log?.eventName === "FundedAnonymousCaseSubmitted" && log.args.reservedAmount === BigInt(evidence.reservePerCase)));
  record(`${name}: immutable accepted decision deadline`, decision[0].toString() === entry.deadlines.decisionBy && decision[0] === state[5] + (name === "normal" ? 3600n : 60n));
  record(`${name}: final status, breach flags and cleared reserve`, Number(state[0]) === entry.finalStatus && Number(state[2]) === entry.slaBreaches && state[3] === 0n);
  record(`${name}: three recorded independent recipient opens`, entry.decryptionVerified.length === 3 && entry.decryptionVerified.every(Boolean));
  record(`${name}: exactly four registered-address recipients and 2-of-3 bound quorum`, bundle.recipients.length === 4 && bundle.approvalAuthorities?.auditors?.length === 3 && bundle.approvalAuthorities.auditorThreshold === 2);
  if (entry.approvalFile) {
    const approval = read(entry.approvalFile);
    const role = name === "normal" ? "program" : "reporter";
    const verified = await verifyV4QuorumApproval(bundle, approval, registry, role, "https://api-testnet.qore.host");
    record(`${name}: real hybrid quorum independently verifies`, verified.verified && approval.approvalHash === state[9]);
    const balance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [entry.payoutRecipient] }) as bigint;
    record(`${name}: exact payout reached its sealed recipient`, balance === BigInt(entry.payoutAmount));
    const pq = await fetchPqcStatus({ rest: "https://api-testnet.qore.host", address: entry.payoutQor });
    record(`${name}: paid recipient has registered ML-DSA-87 key`, pq.registered && pqcStatusPublicKey(pq)?.length === 2592);
    const protectedRecipient = security.recipients[name];
    const key = pqcStatusPublicKey(pq);
    const window = await fetchEvmWindow({ rest: "https://api-testnet.qore.host", address: entry.payoutQor });
    record(`${name}: recipient identity and registered PQ fingerprint match security evidence`, protectedRecipient?.address.toLowerCase() === entry.payoutRecipient.toLowerCase()
      && protectedRecipient.qor === entry.payoutQor && Boolean(key && sha256(key) === protectedRecipient.registeredPqKeyHash));
    record(`${name}: recipient EVM window remains closed`, protectedRecipient.evmWindowClosed === true && !window.live);
    record(`${name}: recorded classical transfer rejection explicitly identifies the authorization guard`, protectedRecipient.classicalOnlyTransferRejected === true
      && /no (?:active|open).*evm.*window|evm.*window.*(closed|expired|required|not.*open)|hybrid.*required/iu.test(protectedRecipient.rejection));
  }
  if (entry.rejectionFile) {
    const verdict = read(entry.rejectionFile);
    record(`${name}: real rejection quorum independently verifies`, (await verifyV5Rejection(bundle, verdict, registry, evidence.reservePerCase, "https://api-testnet.qore.host")).verified && verdict.rejectionHash === state[9]);
    const rejectLogs = receipts[`${name}.reject`].logs.map((log: any) => { try { return decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }); } catch { return undefined; } });
    record(`${name}: rejection returned the entire reserve`, rejectLogs.some((log: any) => log?.eventName === "CaseRejected" && log.args.returnedReserve === BigInt(evidence.reservePerCase)));
    record(`${name}: rejection emitted no bounty transfer`, !rejectLogs.some((log: any) => log?.eventName === "BountyReleased"));
  }
  if (name.includes("ghost")) {
    const logs = receipts[`${name}.escalate`].logs.map((log: any) => { try { return decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }); } catch { return undefined; } });
    record(`${name}: permissionless escalation recorded the expected breach`, logs.some((log: any) => log?.eventName === "CaseEscalated" && Number(log.args.breach) === (name === "ack-ghost" ? 1 : 4)));
  }
}
for (const [name, test] of Object.entries(evidence.negativeTests) as [string, any][]) {
  const decoded = decodeFunctionData({ abi: artifact.abi, data: test.calldata });
  let rejected = false;
  try { await client.simulateContract({ address: registry, abi: artifact.abi, functionName: decoded.functionName,
    args: decoded.args, account: test.sender ?? evidence.relayer.evm, blockNumber: BigInt(test.replayBlock ?? test.block) } as any); }
  catch (error) { rejected = String(error).includes(test.error); }
  record(`${name}: independently replayed historical rejection`, rejected, test.error);
}
const policy = await client.readContract({ address: registry, abi: artifact.abi, functionName: "programPolicyState", args: [evidence.program.evm] }) as any;
const grace = await client.readContract({ address: registry, abi: artifact.abi, functionName: "programDecisionGracePeriod", args: [evidence.program.evm] }) as bigint;
const balance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [registry] }) as bigint;
record("Production policy restored: 24h acknowledgement, 7d triage, 30d embargo, 7d decision grace", policy[9] === 86400n && policy[10] === 604800n && policy[11] === 2592000n && grace === 604800n);
record("Production 2-of-3 quorum and ten-case capacity", policy[6] === 2 && policy[4] === 10 && policy[7] === 3n);
record("Pool is backed by exactly 19,000 tUSDT with zero open cases", policy[2] === 19_000_000_000n && balance === policy[2] && policy[5] === 0);
const redacted = fs.readFileSync("evidence/cases-v5/normal.redacted.md", "utf8");
const normalState = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [evidence.cases.normal.caseIdHash] }) as any;
record("Completed redacted disclosure commitment", normalState[10] === await hashText(redacted) && normalState[0] === 4);
const report = { generatedAt: new Date().toISOString(), network: "qorechain-diana", registryAddress: registry,
  passed: checks.filter((check) => check.passed).length, total: checks.length, checks };
fs.writeFileSync("evidence/v5-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(`${report.passed}/${report.total} V5 checks passed.`);
if (report.passed !== report.total) process.exitCode = 1;
