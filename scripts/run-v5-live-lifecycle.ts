import fs from "node:fs";
import path from "node:path";
import { buildRegisterPqcKeyMsg, evmToQor, fetchEvmWindow, fetchPqcStatus, generatePqcRecoveryCode,
  isRegisteredPqcKey, signProofOfPossession, unifiedAccountFromSeed } from "@qorechain/sdk";
import { encodeFunctionData, hexToBytes, keccak256, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { actors, CHAIN_ID, nativeWrite, openWindow, pause, publicClient as client, readJson, REST, wallet, writeJson } from "./lib/v5-testnet.js";
import { createV4QuorumApproval, verifyV4QuorumApproval } from "../src/lib/v4-approval.js";
import { createV5Rejection, verifyV5Rejection } from "../src/lib/v5-rejection.js";
import { fetchV4Bundle, v4BundleHex } from "../src/lib/v4-bundle.js";
import { bundleToJson, hashText, openBundle, parseBundle, sealReport } from "../src/lib/patch3q.js";
import { bytesToHex, fromBase64, fromBase64Url } from "../src/lib/encoding.js";

if (fs.existsSync("evidence/v5-lifecycle.json") && readJson("evidence/v5-lifecycle.json").status === "verified") {
  console.log("V5 rehearsal is already complete. Re-verifying public evidence without sending transactions.");
  await import("./verify-v5-evidence.js");
  process.exit(process.exitCode ?? 0);
}

const { env, program, auditorOne, auditorTwo, relayer, policy: oldPolicy } = await actors();
const deployment = readJson("evidence/v5-deployment.json");
const registry = deployment.registryAddress as Hex;
const token = deployment.bountyTokenAddress as Hex;
const abi = readJson("artifacts/Patch3QRegistryV5.json").abi;
const tokenAbi = readJson("artifacts/MockTUSDT.json").abi;
const local = ".patch3q-testnet/v5-live";
const stateFile = path.join(local, "state.json");
const secretsFile = path.join(local, "secrets.json");
const state = readJson(stateFile, { native: {}, transactions: {}, cases: {}, negativeTests: {} });
const secrets = readJson(secretsFile, { recipients: {}, reporters: {} });
const reserve = 2_500_000_000n;
const pool = 25_000_000_000n;
const programKemSeed = readJson(".patch3q-testnet/v4-live/secrets.json").programKemSeed;
if (!programKemSeed || !env.PATCH3Q_PROGRAM_KEM_SEED || !env.PATCH3Q_AUDITOR_KEM_SEED) throw new Error("Required existing recipient decryption seeds are missing.");
if (deployment.deployer.toLowerCase() !== program.evm.toLowerCase()) throw new Error("V5 deployment is not owned by the seed-derived V2/V4 program.");
const save = () => writeJson(stateFile, state);

async function tx(key: string, account: any, functionName: string, args: any[], address = registry, contractAbi = abi) {
  if (!state.transactions[key]) {
    const signer = wallet(account);
    const { request } = await client.simulateContract({ address, abi: contractAbi, functionName, args, account: signer.account } as any);
    const hash = await signer.writeContract(request as any);
    state.transactions[key] = { hash }; save();
  }
  const receipt = await client.waitForTransactionReceipt({ hash: state.transactions[key].hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${key} reverted.`);
  state.transactions[key] = { hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(),
    explorer: `https://dashboard.qorechain.io/explorer/tx/${receipt.transactionHash}` }; save();
  return state.transactions[key];
}
async function ensureWindow(name: string, account: any, targets: Hex[]) {
  const existing = await fetchEvmWindow({ rest: REST, address: account.cosmos });
  if (!existing.live || BigInt(existing.remainingTxs ?? 0) < 20n) {
    state.native[name] = await openWindow(account, targets, 40n); save();
  }
}
async function recipient(name: string, paid: boolean) {
  if (!secrets.recipients[name]) {
    secrets.recipients[name] = { privateKey: generatePrivateKey(), recoveryCode: generatePqcRecoveryCode() };
    writeJson(secretsFile, secrets);
  }
  const account = unifiedAccountFromSeed(hexToBytes(secrets.recipients[name].privateKey), { recoveryCode: secrets.recipients[name].recoveryCode });
  if (paid) {
    const status = await fetchPqcStatus({ rest: REST, address: account.cosmos });
    if (!status.registered) {
      if (!state.native[`fund-${name}`]) {
        state.native[`fund-${name}`] = await nativeWrite(program, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: { fromAddress: program.cosmos, toAddress: account.cosmos, amount: [{ denom: "uqor", amount: "300000" }] } }]); save();
      }
      const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: account.cosmos, keypair: account.pqc });
      state.native[`pqc-${name}`] = await nativeWrite(account, [buildRegisterPqcKeyMsg(account.cosmos, { pqcKeypair: account.pqc, proofOfPossession })], "classical"); save();
    }
    if (!isRegisteredPqcKey(await fetchPqcStatus({ rest: REST, address: account.cosmos }), account.pqc.publicKey)) throw new Error("Payout recipient PQ registration did not match its local key.");
  }
  return account;
}
async function caseState(name: string) { return client.readContract({ address: registry, abi, functionName: "caseState", args: [state.cases[name].caseIdHash] }) as Promise<any>; }
async function makeCase(name: string, paid: boolean) {
  const payoutAccount = await recipient(name, paid);
  const file = `evidence/cases-v5/${name}.bundle.json`;
  if (!state.cases[name]) {
    const latest = await client.getBlock();
    const estimate = Number(latest.timestamp) + 15;
    const result = await sealReport({ mode: "testnet", reporterMode: "anonymous", payoutAddress: payoutAccount.evm,
      maintainerAddress: program.cosmos, auditorAddresses: oldPolicy.auditors.map((address: string) => evmToQor(address)), auditorThreshold: 2, rest: REST,
      report: { title: `Synthetic V5 rehearsal: ${name}`, program: "Patch3Q V5 Diana rehearsal", asset: "Synthetic verifier",
        severity: "critical", reporterAlias: "anonymous researcher", summary: "Synthetic data for the V5 lifecycle proof.",
        impact: "Demonstrates enforceable deadlines, private evidence and quorum authorization.", reproduction: "Reproduce only the synthetic lifecycle recorded here.",
        remediation: "Require independent PQ approvals and a snapshotted funded deadline.", embargoUntil: new Date((estimate + 180) * 1000).toISOString() },
      now: new Date(Number(latest.timestamp) * 1000), deadlines: { acknowledgeBy: new Date((estimate + 60) * 1000),
        triageBy: new Date((estimate + 120) * 1000), embargoUntil: new Date((estimate + 180) * 1000) } });
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bundleToJson(result.bundle) + "\n");
    secrets.reporters[name] = result.approvalVaults!.find((entry) => entry.role === "reporter"); writeJson(secretsFile, secrets);
    state.cases[name] = { caseId: result.bundle.caseId, caseIdHash: await hashText(result.bundle.caseId), bundleFile: file,
      payoutRecipient: payoutAccount.evm, payoutQor: payoutAccount.cosmos, paidRecipientPqRegistered: paid }; save();
  }
  const entry = state.cases[name]; const bundle = parseBundle(fs.readFileSync(file, "utf8"));
  if (!state.transactions[`${name}.submit`]) {
    const before = await client.readContract({ address: registry, abi, functionName: "programPolicyState", args: [program.evm] }) as any;
    entry.reservation = { poolBefore: before[2].toString(), openBefore: Number(before[5]) }; save();
    await tx(`${name}.submit`, relayer, "submitFundedAnonymousCase", [program.evm, entry.caseIdHash, bundle.envelopeHash,
      bundle.contentCommitment, await hashText(`patch3q:${bundle.caseId}`), bundle.privacy.reporterPqKeyHash, bundle.privacy.payoutCommitment, await v4BundleHex(bundle)]);
    const after = await client.readContract({ address: registry, abi, functionName: "programPolicyState", args: [program.evm] }) as any;
    if (after[2] !== BigInt(entry.reservation.poolBefore) - reserve || after[5] !== entry.reservation.openBefore + 1) throw new Error("Submission reservation accounting mismatch.");
    entry.reservation.poolAfter = after[2].toString(); entry.reservation.openAfter = Number(after[5]); save();
  }
  const recovered = await fetchV4Bundle({ registryAddress: registry, caseId: bundle.caseId, fromBlock: BigInt(deployment.deploymentBlock) });
  if (bundleToJson(recovered.bundle) !== bundleToJson(bundle)) throw new Error("Chain-recovered ciphertext differs from the local bundle.");
  const decryption = [];
  for (const [role, seed] of [["maintainer", programKemSeed], ["auditor", env.PATCH3Q_PROGRAM_KEM_SEED], ["auditor", env.PATCH3Q_AUDITOR_KEM_SEED]]) {
    const opened = await openBundle(bundle, { type: "patch3q.demo-key", version: 1, caseId: bundle.caseId, role: role as any,
      label: "Existing registered recipient", seed, warning: "Local testnet secret" });
    if (!opened.verified || !opened.payload.payout) throw new Error("Independent recipient decryption failed.");
    decryption.push(true); if (!entry.payout) entry.payout = opened.payload.payout;
  }
  const receipt = await caseState(name); const decision = await client.readContract({ address: registry, abi, functionName: "decisionState", args: [entry.caseIdHash] }) as any;
  entry.bundleHash = recovered.bundleHash; entry.recoveredFromTransaction = recovered.transactionHash;
  entry.decryptionVerified = decryption; entry.deadlines = { acknowledgeBy: receipt[4].toString(), triageBy: receipt[5].toString(), embargoUntil: receipt[6].toString(), decisionBy: decision[0].toString() }; save();
  console.log(`  ${name}: reserved ${reserve}, recovered ciphertext, three recipients verified`);
  return bundle;
}
const signerKeys = (role: "program" | "auditor", account: any) => ({ role, classicalPrivateKey: hexToBytes(account.privateKey), pqKey: account.pqc });
async function approval(name: string, role: "program" | "reporter", amount = reserve) {
  const entry = state.cases[name]; const bundle = parseBundle(fs.readFileSync(entry.bundleFile, "utf8"));
  const packet = await createV4QuorumApproval({ bundle, participantRole: role,
    participant: role === "program" ? signerKeys("program", program) : secrets.reporters[name],
    auditors: [signerKeys("auditor", auditorOne), signerKeys("auditor", auditorTwo)], registryAddress: registry,
    severity: "critical", payoutAtomic: amount.toString(), rationale: `Synthetic V5 ${name}: independent quorum confirmed the lifecycle.`, payout: entry.payout });
  if (!(await verifyV4QuorumApproval(bundle, packet, registry, role, REST)).verified) throw new Error("Hybrid quorum approval failed independent verification.");
  const file = `evidence/cases-v5/${name}.${role}.approval.json`; writeJson(file, packet);
  entry.approvalFile = file; entry.approvalHash = packet.approvalHash; entry.payoutAmount = amount.toString(); save();
  return packet;
}
function approvalArgs(name: string, packet: any) {
  const reporterKey = parseBundle(fs.readFileSync(state.cases[name].bundleFile, "utf8")).approvalAuthorities!.reporter.pqPublicKey;
  return [state.cases[name].caseIdHash, 5, BigInt(packet.statement.payout.atomic), packet.statement.rationaleHash,
    packet.statement.payout.recipient, packet.statement.payout.commitmentSalt,
    packet.participantRole === "reporter" ? bytesToHex(fromBase64Url(reporterKey!)) : "0x",
    bytesToHex(fromBase64(packet.participant.signature.pq.signature)), packet.auditors.map((entry: any) => entry.evmAddress),
    packet.auditors.map((entry: any) => bytesToHex(fromBase64(entry.signature.pq.signature)))];
}
async function negative(key: string, functionName: string, args: any[], errorName: string, account = relayer) {
  if (state.negativeTests[key]) return;
  const block = await client.getBlockNumber({ cacheTime: 0 });
  let rejected = false;
  try { await client.simulateContract({ address: registry, abi, functionName, args, account: wallet(account).account, blockNumber: block } as any); }
  catch (error) { rejected = String(error).includes(errorName); }
  if (!rejected) throw new Error(`${key} did not reject with ${errorName}.`);
  state.negativeTests[key] = { rejected, error: errorName, block: block.toString(), functionName, sender: account.evm,
    calldata: encodeFunctionData({ abi, functionName, args } as any) }; save(); console.log(`  negative ${key}: ${errorName}`);
}
async function release(name: string, role: "program" | "reporter", amount = reserve) {
  if (state.transactions[`${name}.release`]) return;
  const packet = await approval(name, role, amount);
  await tx(`${name}.release`, relayer, "approveAnonymousSeverity", approvalArgs(name, packet));
}
async function reject(name: string) {
  if (state.transactions[`${name}.reject`]) return;
  const entry = state.cases[name]; const bundle = parseBundle(fs.readFileSync(entry.bundleFile, "utf8"));
  const verdict = await createV5Rejection({ bundle, registryAddress: registry, reservedAmount: reserve.toString(),
    rationale: `Synthetic ${name}: auditors independently rejected an invalid duplicate report.`,
    auditors: [signerKeys("auditor", auditorOne), signerKeys("auditor", auditorTwo)] });
  if (!(await verifyV5Rejection(bundle, verdict, registry, reserve.toString(), REST)).verified) throw new Error("V5 rejection signatures failed independent verification.");
  const args = [entry.caseIdHash, verdict.statement.rationaleHash, verdict.auditors.map((item) => item.evmAddress), verdict.auditors.map((item) => bytesToHex(fromBase64(item.signature.pq!.signature)))];
  await negative(`${name}.singleAuditor`, "rejectAnonymousCase", [args[0], args[1], [verdict.auditors[0].evmAddress], [args[3][0]]], "AuditorQuorumNotMet");
  await negative(`${name}.duplicateAuditor`, "rejectAnonymousCase", [args[0], args[1], [verdict.auditors[0].evmAddress, verdict.auditors[0].evmAddress], [args[3][0], args[3][0]]], "DuplicateAuthority");
  const file = `evidence/cases-v5/${name}.rejection.json`; writeJson(file, verdict); entry.rejectionFile = file; save();
  await tx(`${name}.reject`, relayer, "rejectAnonymousCase", args);
  await negative(`${name}.replayRejection`, "rejectAnonymousCase", args, "ApprovalAlreadyRecorded");
}
async function triage(name: string) {
  await tx(`${name}.acknowledge`, program, "acknowledgeCase", [state.cases[name].caseIdHash]);
  await tx(`${name}.triage`, program, "triageCase", [state.cases[name].caseIdHash]);
}
async function waitDeadline(deadline: bigint, label: string) {
  while ((await client.getBlock()).timestamp <= deadline) {
    console.log(`  waiting for ${label}: ${deadline}`); await pause(10_000);
  }
}

console.log("1. Open scoped V5 operational windows and configure the short synthetic policy");
await ensureWindow("programWindow", program, [registry, token]); await ensureWindow("relayerWindow", relayer, [registry]);
await tx("configureSyntheticPolicy", program, "configureProgramPolicyWithDecisionGrace", [oldPolicy.auditors, 2, oldPolicy.relayers, reserve, 10, 60n, 120n, 180n, 60n]);
await tx("mintPoolTokens", program, "mint", [program.evm, pool], token, tokenAbi);
await tx("approvePool", program, "approve", [registry, pool], token, tokenAbi);
await tx("depositPool", program, "depositProgramPool", [pool]);

console.log("2. Normal funded case, independent decryption and program + two-auditor payout");
await tx("configureNormalCasePolicy", program, "configureProgramPolicyWithDecisionGrace", [oldPolicy.auditors, 2, oldPolicy.relayers, reserve, 10, 60n, 120n, 180n, 3600n]);
await makeCase("normal", true); await triage("normal");
if (!state.transactions["normal.release"]) {
  const packet = await approval("normal", "program"); const args = approvalArgs("normal", packet);
  const classical = packet.participant.signature.classical!.signature;
  await negative("normal.ecdsaOnly", "approveAnonymousSeverity", [...args.slice(0, 7), bytesToHex(fromBase64(classical)), ...args.slice(8)], "InvalidPqSignature");
  await negative("normal.singleAuditor", "approveAnonymousSeverity", [...args.slice(0, 8), [packet.auditors[0].evmAddress], [args[9][0]]], "AuditorQuorumNotMet");
  await negative("normal.duplicateAuditor", "approveAnonymousSeverity", [...args.slice(0, 8), [packet.auditors[0].evmAddress, packet.auditors[0].evmAddress], [args[9][0], args[9][0]]], "DuplicateAuthority");
  const redirect = [...args]; redirect[4] = auditorOne.evm;
  await negative("normal.redirectedPayout", "approveAnonymousSeverity", redirect, "PayoutCommitmentMismatch");
  await tx("normal.release", relayer, "approveAnonymousSeverity", args);
}
console.log("3. Quorum rejection returns the entire reserve and frees capacity");
await tx("configureDeadlinePolicy", program, "configureProgramPolicyWithDecisionGrace", [oldPolicy.auditors, 2, oldPolicy.relayers, reserve, 10, 60n, 120n, 180n, 60n]);
await makeCase("rejected", false); await reject("rejected");

console.log("4. Prepare acknowledgement ghosting, post-triage ghosting, and resolved-without-payout ghosting");
await makeCase("ack-ghost", true);
await makeCase("decision-ghost", true); await triage("decision-ghost");
await negative("decision-ghost.earlyEscalation", "escalateMissedDeadline", [state.cases["decision-ghost"].caseIdHash], "DeadlineNotMissed");
await makeCase("resolved-ghost", false); await triage("resolved-ghost");
await tx("resolved-ghost.resolve", program, "resolveCase", [state.cases["resolved-ghost"].caseIdHash]);

console.log("5. Restore normal production policy; accepted case deadlines must stay unchanged");
await tx("restoreProductionPolicy", program, "configureProgramPolicy", [oldPolicy.auditors, 2, oldPolicy.relayers, reserve, 10, 86400n, 604800n, 2592000n]);
for (const name of ["decision-ghost", "resolved-ghost"]) {
  const decision = await client.readContract({ address: registry, abi, functionName: "decisionState", args: [state.cases[name].caseIdHash] }) as any;
  if (decision[0].toString() !== state.cases[name].deadlines.decisionBy) throw new Error("Policy change rewrote an accepted decision deadline.");
}

await waitDeadline(BigInt(state.cases["ack-ghost"].deadlines.acknowledgeBy), "acknowledgement expiry");
await tx("ack-ghost.escalate", relayer, "escalateMissedDeadline", [state.cases["ack-ghost"].caseIdHash]);
await release("ack-ghost", "reporter", 1_000_000_000n);
await waitDeadline(BigInt(state.cases["decision-ghost"].deadlines.decisionBy), "post-triage decision expiry");
if (!state.transactions["decision-ghost.escalate"]) {
  const late = await approval("decision-ghost", "program");
  await negative("decision-ghost.lateProgramPayout", "approveAnonymousSeverity", approvalArgs("decision-ghost", late), "DeadlineExpired");
  await negative("decision-ghost.lateResolve", "resolveCase", [state.cases["decision-ghost"].caseIdHash], "DeadlineExpired", program);
}
await tx("decision-ghost.escalate", relayer, "escalateMissedDeadline", [state.cases["decision-ghost"].caseIdHash]);
await release("decision-ghost", "reporter");
await waitDeadline(BigInt(state.cases["resolved-ghost"].deadlines.decisionBy), "resolved decision expiry");
await tx("resolved-ghost.escalate", relayer, "escalateMissedDeadline", [state.cases["resolved-ghost"].caseIdHash]);
await reject("resolved-ghost");

console.log("6. Complete redacted disclosure after the on-chain embargo");
await waitDeadline(BigInt(state.cases.normal.deadlines.embargoUntil), "normal disclosure embargo");
const redacted = "Synthetic V5 rehearsal: funded private reporting, independent quorum, deadline escalation and safe rejection were verified. No real vulnerability is disclosed.\n";
fs.writeFileSync("evidence/cases-v5/normal.redacted.md", redacted);
await tx("normal.disclose", program, "discloseCase", [state.cases.normal.caseIdHash, await hashText(redacted)]);

const expected = { normal: [4, 0], rejected: [6, 0], "ack-ghost": [3, 1], "decision-ghost": [3, 4], "resolved-ghost": [6, 4] };
for (const [name, outcome] of Object.entries(expected)) {
  const receipt = await caseState(name); if (Number(receipt[0]) !== outcome[0] || Number(receipt[2]) !== outcome[1] || receipt[3] !== 0n) throw new Error(`${name} final state mismatch.`);
  state.cases[name].finalStatus = Number(receipt[0]); state.cases[name].slaBreaches = Number(receipt[2]);
  if (state.cases[name].payoutAmount) {
    const balance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [state.cases[name].payoutRecipient] }) as bigint;
    if (balance !== BigInt(state.cases[name].payoutAmount)) throw new Error("Recipient did not receive the exact approved payout.");
    state.cases[name].payoutBalance = balance.toString();
  }
}
const finalPolicy = await client.readContract({ address: registry, abi, functionName: "programPolicyState", args: [program.evm] }) as any;
const finalBalance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [registry] }) as bigint;
const grace = await client.readContract({ address: registry, abi, functionName: "programDecisionGracePeriod", args: [program.evm] }) as bigint;
if (finalPolicy[2] !== 19_000_000_000n || finalPolicy[5] !== 0 || finalBalance !== finalPolicy[2] || grace !== 604800n) throw new Error("Final pool, capacity or restored policy mismatch.");
save();
const publicCases = Object.fromEntries(Object.entries(state.cases).map(([name, raw]) => {
  const { payout: _privateOpening, ...entry } = raw as any;
  if (!entry.payoutAmount) { delete entry.payoutRecipient; delete entry.payoutQor; delete entry.paidRecipientPqRegistered; }
  return [name, entry];
}));
writeJson("evidence/v5-lifecycle.json", { schemaVersion: 1, status: "verified", completedAt: new Date().toISOString(),
  network: CHAIN_ID, chainId: 9800, registryAddress: registry, bountyTokenAddress: token,
  program: { evm: program.evm, qor: program.cosmos }, relayer: { evm: relayer.evm, qor: relayer.cosmos }, auditors: oldPolicy.auditors,
  threshold: 2, reservePerCase: reserve.toString(), initialPool: pool.toString(), ...state, cases: publicCases,
  finalState: { availablePool: finalPolicy[2].toString(), openCases: Number(finalPolicy[5]), tokenBalance: finalBalance.toString(),
    decisionGracePeriod: grace.toString(), acknowledgePeriod: finalPolicy[9].toString(), triagePeriod: finalPolicy[10].toString(), embargoPeriod: finalPolicy[11].toString() } });
writeJson("evidence/v5-deployment.json", { ...deployment, status: "lifecycle-verified", lifecycleEvidence: "evidence/v5-lifecycle.json" });
console.log("V5 live lifecycle completed: five cases, normal and escalated payouts, two rejection refunds, redacted disclosure, restored policy, 19,000 tUSDT pool and zero open cases.");
