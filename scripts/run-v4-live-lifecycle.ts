import fs from "node:fs";
import path from "node:path";

import { StargateClient } from "@cosmjs/stargate";
import { evmWindowCost, qorechainTestnet } from "@qorechain/evm";
import { generateSealKeys, sealKeysFromSeed } from "@qorechain/qoreseal";
import {
  EthNativeSigner,
  KEM_ALGORITHM_ML_KEM_1024,
  deriveUnifiedAccount,
  evmToQor,
  fetchKemKey,
  fetchPqcStatus,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  pqcMsg,
  unifiedAccountFromSeed,
  validateMnemonic,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { wordlist } from "../node_modules/.pnpm/@scure+bip39@1.6.0/node_modules/@scure/bip39/wordlists/english.js";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  http,
  type Abi,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createV4QuorumApproval, verifyV4QuorumApproval, v4ApprovalToJson, v4BundleHash } from "../src/lib/v4-approval.js";
import { fetchV4Bundle, v4BundleHex } from "../src/lib/v4-bundle.js";
import { bytesToHex, fromBase64, fromBase64Url, toBase64Url } from "../src/lib/encoding.js";
import { bundleToJson, hashText, openBundle, parseBundle, sealReport } from "../src/lib/patch3q.js";
import type { Patch3QKeyVault, ReportDraft, SealedPayout, V4SeverityApproval } from "../src/types.js";

const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const EXPLORER = "https://dashboard.qorechain.io/explorer/tx/";
const CHAIN_ID = "qorechain-diana";
const EXPECTED_PROGRAM = "0x688604db30ccff6c3bb16fb34d897209475d6bcb";
const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "150000" }], gas: "1200000" };
const LOCAL_DIR = path.resolve(".patch3q-testnet", "v4-live");
const STATE_FILE = path.join(LOCAL_DIR, "state.json");
const SECRETS_FILE = path.join(LOCAL_DIR, "secrets.json");
const EVIDENCE_FILE = path.resolve("evidence", "v4-lifecycle.json");
const CASES_DIR = path.resolve("evidence", "cases-v4");
const BUNDLE_FILE = path.join(CASES_DIR, "funded-quorum.bundle.json");
const APPROVAL_FILE = path.join(CASES_DIR, "funded-quorum.approval.json");

type TxEvidence = { hash: string; blockNumber?: string; explorer: string };
type LocalState = {
  native: Record<string, TxEvidence>;
  evm: Record<string, TxEvidence>;
  caseId?: string;
  caseIdHash?: Hex;
};
type LocalSecrets = {
  programKemSeed?: string;
  payoutPrivateKey?: Hex;
  payout?: SealedPayout;
};

function readEnv(filename: string): Record<string, string> {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(fs.readFileSync(filename, "utf8").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, "")];
    }));
}

function readJson<T>(filename: string, fallback: T): T {
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) as T : fallback;
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function recoverProgram(raw: string): Promise<{ mnemonic: string; account: UnifiedAccount; repairedPosition: number | null }> {
  if (validateMnemonic(raw)) {
    const account = await deriveUnifiedAccount(raw);
    if (account.evm.toLowerCase() === EXPECTED_PROGRAM) return { mnemonic: raw, account, repairedPosition: null };
  }
  const words = raw.trim().toLowerCase().split(/\s+/u);
  const invalid = words.map((word, index) => wordlist.includes(word) ? -1 : index).filter((index) => index >= 0);
  if (invalid.length !== 1) throw new Error(`Expected one invalid mnemonic word; found ${invalid.length}.`);
  const position = invalid[0];
  for (const replacement of wordlist) {
    const candidateWords = [...words];
    candidateWords[position] = replacement;
    const candidate = candidateWords.join(" ");
    if (!validateMnemonic(candidate)) continue;
    const account = await deriveUnifiedAccount(candidate);
    if (account.evm.toLowerCase() === EXPECTED_PROGRAM) return { mnemonic: candidate, account, repairedPosition: position + 1 };
  }
  throw new Error("The in-memory mnemonic repair did not match the verified V2 deployer.");
}

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!response.ok) throw new Error(`Account query failed for ${address}: HTTP ${response.status}.`);
  const body = await response.json() as { account?: Record<string, unknown> };
  const raw = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(raw.account_number ?? "0"), sequence: BigInt(raw.sequence ?? "0") };
}

async function broadcastNative(account: UnifiedAccount, messages: Parameters<EthNativeSigner["sign"]>[0]["messages"]): Promise<TxEvidence> {
  const { accountNumber, sequence } = await accountSequence(account.cosmos);
  const signer = new EthNativeSigner(account, { signMode: "hybrid", rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    const result = await signer.signAndBroadcast(transport, { chainId: CHAIN_ID, accountNumber, sequence, fee: NATIVE_FEE, messages });
    if (result.code !== 0) throw new Error(`Native transaction failed (code ${result.code}): ${result.rawLog ?? ""}`);
    return { hash: result.transactionHash, explorer: EXPLORER + result.transactionHash };
  } finally {
    transport.disconnect();
  }
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function evmWrite(
  account: UnifiedAccount,
  client: ReturnType<typeof createPublicClient>,
  request: { address: Hex; abi: Abi; functionName: string; args: readonly unknown[] },
): Promise<TxEvidence> {
  const wallet = createWalletClient({ account: privateKeyToAccount(account.privateKey as Hex), chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
  const { request: simulated } = await client.simulateContract({ ...request, account: privateKeyToAccount(account.privateKey as Hex) } as Parameters<typeof client.simulateContract>[0]);
  const hash = await wallet.writeContract(simulated as Parameters<typeof wallet.writeContract>[0]);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${request.functionName} reverted in ${hash}.`);
  return { hash, blockNumber: receipt.blockNumber.toString(), explorer: EXPLORER + hash };
}

function approvalKeys(role: "program" | "auditor", account: UnifiedAccount) {
  return { role, classicalPrivateKey: hexToBytes(account.privateKey as Hex), pqKey: account.pqc };
}

const env = { ...readEnv(".env"), ...readEnv(".env.testnet") };
const recovered = await recoverProgram(env["SEEDPHRASE-WALLET"] ?? "");
const program = recovered.account;
const auditorOne = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_PROGRAM_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_PROGRAM_RECOVERY_CODE });
const auditorTwo = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_AUDITOR_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_AUDITOR_RECOVERY_CODE });
const relayer = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_RELAYER_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_RELAYER_RECOVERY_CODE });
const deployment = readJson<Record<string, string>>("evidence/v4-deployment.json", {});
const policy = readJson<Record<string, any>>("evidence/v4-policy.json", {});
const registry = getAddress(deployment.registryAddress) as Hex;
const token = getAddress(deployment.bountyTokenAddress) as Hex;
const artifact = readJson<{ abi: Abi }>("artifacts/Patch3QRegistryV4.json", { abi: [] });
const tokenArtifact = readJson<{ abi: Abi }>("artifacts/MockTUSDT.json", { abi: [] });
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
const state = readJson<LocalState>(STATE_FILE, { native: {}, evm: {} });
const secrets = readJson<LocalSecrets>(SECRETS_FILE, {});

if (program.evm.toLowerCase() !== policy.program.toLowerCase()) throw new Error("Recovered program does not match the configured V4 policy.");
if (auditorOne.evm.toLowerCase() !== policy.auditors[0].toLowerCase() || auditorTwo.evm.toLowerCase() !== policy.auditors[1].toLowerCase()) {
  throw new Error("The local quorum keys do not match the first two configured V4 auditors.");
}
if (relayer.evm.toLowerCase() !== policy.relayers[0].toLowerCase()) throw new Error("The local relayer key does not match the configured V4 relayer.");
const programPqc = await fetchPqcStatus({ rest: REST, address: program.cosmos });
if (isRegisteredPqcKey(programPqc, program.pqc.publicKey) !== true) throw new Error("The recovered V2 program PQC key does not match Diana.");

console.log("1. Publish the V2 program ML-KEM-1024 key");
if (!secrets.programKemSeed) {
  secrets.programKemSeed = toBase64Url(generateSealKeys().seed);
  writeJson(SECRETS_FILE, secrets);
}
const programKem = sealKeysFromSeed(fromBase64Url(secrets.programKemSeed));
const existingKem = await fetchKemKey({ rest: REST, address: program.cosmos });
if (!existingKem.found) {
  state.native.programKem = await broadcastNative(program, [
    pqcMsg.registerKemKey({ sender: program.cosmos, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: programKem.mlkemPublicKey }),
  ]);
  writeJson(STATE_FILE, state);
  await sleep(5_000);
} else if (!existingKem.key || bytesToHex(existingKem.key.publicKey) !== bytesToHex(programKem.mlkemPublicKey)) {
  throw new Error("The V2 program already has a different KEM key; refusing to overwrite it without its local seed.");
}
console.log(`   ✓ ${program.cosmos}`);

console.log("2. Open fresh EVM windows scoped to the V4 registry");
if (!state.native.programWindow) {
  const perTx = evmWindowCost({ gas: 2_000_000n, maxFeePerGas: 250_000_000_000n });
  state.native.programWindow = await broadcastNative(program, [openEvmWindowMsg({ sender: program.cosmos, blocks: 3000n, maxTxs: 3n, maxValue: perTx * 3n, allowedTargets: [registry] })]);
  writeJson(STATE_FILE, state);
  await sleep(5_000);
}
if (!state.native.relayerWindow) {
  const perTx = evmWindowCost({ gas: 10_000_000n, maxFeePerGas: 250_000_000_000n });
  state.native.relayerWindow = await broadcastNative(relayer, [openEvmWindowMsg({ sender: relayer.cosmos, blocks: 3000n, maxTxs: 3n, maxValue: perTx * 3n, allowedTargets: [registry] })]);
  writeJson(STATE_FILE, state);
  await sleep(8_000);
}
console.log("   ✓ program and relayer windows are live");

console.log("3. Seal one anonymous 2-of-3 V4 case");
let bundle;
if (fs.existsSync(BUNDLE_FILE)) {
  bundle = parseBundle(fs.readFileSync(BUNDLE_FILE, "utf8"));
} else {
  const policyState = await client.readContract({ address: registry, abi: artifact.abi, functionName: "programPolicyState", args: [program.evm] }) as readonly [boolean, boolean, bigint, bigint, number, number, number, bigint, bigint, bigint, bigint, bigint];
  const latest = await client.getBlock();
  const estimatedSubmission = Number(latest.timestamp) + 15;
  if (!secrets.payoutPrivateKey) secrets.payoutPrivateKey = generatePrivateKey();
  const payoutWallet = privateKeyToAccount(secrets.payoutPrivateKey);
  const report: ReportDraft = {
    title: "Synthetic V4 rehearsal: duplicate quorum signer",
    program: "Patch3Q V4 Diana rehearsal",
    asset: "Synthetic threshold-verification fixture",
    severity: "critical",
    reporterAlias: "anonymous researcher",
    summary: "A synthetic verifier counts one auditor twice. This report exists only to prove the funded V4 lifecycle.",
    impact: "A broken implementation could satisfy quorum without independent auditors.",
    reproduction: "1. Produce one valid auditor signature.\n2. Submit it twice.\n3. Confirm that a correct implementation rejects the duplicate.",
    remediation: "Deduplicate auditor identities before counting threshold signatures.",
    embargoUntil: new Date((estimatedSubmission + Number(policyState[11])) * 1000).toISOString(),
  };
  const sealed = await sealReport({
    report,
    mode: "testnet",
    reporterMode: "anonymous",
    payoutAddress: payoutWallet.address,
    maintainerAddress: program.cosmos,
    auditorAddresses: policy.auditors.map((address: string) => evmToQor(address)),
    auditorThreshold: Number(policy.threshold),
    rest: REST,
    now: new Date(Number(latest.timestamp) * 1000),
    deadlines: {
      acknowledgeBy: new Date((estimatedSubmission + Number(policyState[9])) * 1000),
      triageBy: new Date((estimatedSubmission + Number(policyState[10])) * 1000),
      embargoUntil: new Date((estimatedSubmission + Number(policyState[11])) * 1000),
    },
  });
  if (!sealed.payout) throw new Error("The anonymous V4 seal did not return a payout opening.");
  secrets.payout = sealed.payout;
  writeJson(SECRETS_FILE, secrets);
  bundle = sealed.bundle;
  fs.mkdirSync(CASES_DIR, { recursive: true });
  fs.writeFileSync(BUNDLE_FILE, `${bundleToJson(bundle)}\n`);
}
state.caseId = bundle.caseId;
state.caseIdHash = await hashText(bundle.caseId);
writeJson(STATE_FILE, state);
console.log(`   ✓ ${bundle.caseId}`);

console.log("4. Relay, reserve 2,500 tUSDT, and publish the encrypted bundle");
const beforePolicy = await client.readContract({ address: registry, abi: artifact.abi, functionName: "programPolicyState", args: [program.evm] });
if (!state.evm.submit) {
  state.evm.submit = await evmWrite(relayer, client, {
    address: registry,
    abi: artifact.abi,
    functionName: "submitFundedAnonymousCase",
    args: [program.evm, state.caseIdHash, bundle.envelopeHash, bundle.contentCommitment, await hashText(`patch3q:${bundle.caseId}`), bundle.privacy.reporterPqKeyHash, bundle.privacy.payoutCommitment, await v4BundleHex(bundle)],
  });
  writeJson(STATE_FILE, state);
}
const submittedPolicy = await client.readContract({ address: registry, abi: artifact.abi, functionName: "programPolicyState", args: [program.evm] });
const submittedCase = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [state.caseIdHash] });
if (submittedPolicy[2] !== beforePolicy[2] - beforePolicy[3] || submittedPolicy[5] !== beforePolicy[5] + 1) throw new Error("The V4 submission did not reserve exactly one funded case.");
console.log(`   ✓ pool ${beforePolicy[2]} → ${submittedPolicy[2]} atomic; open cases ${beforePolicy[5]} → ${submittedPolicy[5]}`);

console.log("5. Recover, hash-check, and decrypt the bundle from the event log");
const recoveredBundle = await fetchV4Bundle({ registryAddress: registry, caseId: bundle.caseId, fromBlock: BigInt(deployment.deploymentBlock) });
if (bundleToJson(recoveredBundle.bundle) !== bundleToJson(bundle)) throw new Error("Recovered V4 bundle differs from the submitted bundle.");
const programVault: Patch3QKeyVault = { type: "patch3q.demo-key", version: 1, caseId: bundle.caseId, role: "maintainer", label: "V2 program", seed: secrets.programKemSeed, warning: "local Diana rehearsal secret" };
const opened = await openBundle(recoveredBundle.bundle, programVault);
if (!opened.verified || !opened.payload.payout) throw new Error("The V2 program could not verify and decrypt the recovered V4 bundle.");
if (!secrets.payout || opened.payload.payout.recipient.toLowerCase() !== secrets.payout.recipient.toLowerCase()) throw new Error("Recovered payout opening does not match the local case secret.");
console.log(`   ✓ ${recoveredBundle.bundleHash}`);

console.log("6. Acknowledge and triage from the verified V2 program account");
let currentCase = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [state.caseIdHash] });
if (Number(currentCase[0]) === 0) {
  state.evm.acknowledge = await evmWrite(program, client, { address: registry, abi: artifact.abi, functionName: "acknowledgeCase", args: [state.caseIdHash] });
  writeJson(STATE_FILE, state);
}
currentCase = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [state.caseIdHash] });
if (Number(currentCase[0]) === 1) {
  state.evm.triage = await evmWrite(program, client, { address: registry, abi: artifact.abi, functionName: "triageCase", args: [state.caseIdHash] });
  writeJson(STATE_FILE, state);
}
currentCase = await client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [state.caseIdHash] });
if (Number(currentCase[0]) !== 2) throw new Error(`Expected Triaged status, received ${currentCase[0]}.`);
console.log("   ✓ on-chain status is Triaged");

console.log("7. Create and independently verify program + 2-of-3 auditor approval");
let approval: V4SeverityApproval;
if (fs.existsSync(APPROVAL_FILE)) {
  approval = JSON.parse(fs.readFileSync(APPROVAL_FILE, "utf8")) as V4SeverityApproval;
} else {
  approval = await createV4QuorumApproval({
    bundle,
    participantRole: "program",
    participant: approvalKeys("program", program),
    auditors: [approvalKeys("auditor", auditorOne), approvalKeys("auditor", auditorTwo)],
    registryAddress: registry,
    severity: "critical",
    payoutAtomic: policy.reservePerCase,
    rationale: "Critical synthetic threshold bypass confirmed in the V4 Diana rehearsal.",
    payout: secrets.payout!,
  });
  fs.writeFileSync(APPROVAL_FILE, `${v4ApprovalToJson(approval)}\n`);
}
const approvalVerification = await verifyV4QuorumApproval(bundle, approval, registry, "program", REST);
if (!approvalVerification.verified) throw new Error(`V4 quorum approval failed verification: ${JSON.stringify(approvalVerification.checks)}`);
console.log(`   ✓ ${approval.approvalHash}`);

console.log("8. Release the full reserved bounty through the relayer");
if (!state.evm.release) {
  const participantPq = approval.participant.signature.pq?.signature;
  const auditorPq = approval.auditors.map((entry) => entry.signature.pq?.signature);
  if (!participantPq || auditorPq.some((entry) => !entry)) throw new Error("The V4 approval is missing a PQ signature.");
  state.evm.release = await evmWrite(relayer, client, {
    address: registry,
    abi: artifact.abi,
    functionName: "approveAnonymousSeverity",
    args: [
      state.caseIdHash,
      5,
      BigInt(approval.statement.payout.atomic),
      approval.statement.rationaleHash,
      approval.statement.payout.recipient,
      approval.statement.payout.commitmentSalt,
      "0x",
      bytesToHex(fromBase64(participantPq)),
      approval.auditors.map((entry) => entry.evmAddress),
      auditorPq.map((entry) => bytesToHex(fromBase64(entry!))),
    ],
  });
  writeJson(STATE_FILE, state);
}

const [finalPolicy, finalCase, registryBalance, payoutBalance, caseAuditors] = await Promise.all([
  client.readContract({ address: registry, abi: artifact.abi, functionName: "programPolicyState", args: [program.evm] }),
  client.readContract({ address: registry, abi: artifact.abi, functionName: "caseState", args: [state.caseIdHash] }),
  client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [registry] }) as Promise<bigint>,
  client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [approval.statement.payout.recipient] }) as Promise<bigint>,
  client.readContract({ address: registry, abi: artifact.abi, functionName: "caseAuditors", args: [state.caseIdHash] }),
]);
if (Number(finalCase[0]) !== 3 || finalCase[3] !== 0n || finalPolicy[5] !== 0 || payoutBalance < BigInt(policy.reservePerCase)) {
  throw new Error("The V4 release did not resolve the case, clear capacity, and pay the sealed recipient.");
}

const lifecycle = {
  schemaVersion: 1,
  status: "verified",
  completedAt: new Date().toISOString(),
  network: CHAIN_ID,
  chainId: 9800,
  registryAddress: registry,
  bountyTokenAddress: token,
  program: { qor: program.cosmos, evm: program.evm },
  relayer: { qor: relayer.cosmos, evm: relayer.evm },
  auditors: policy.auditors,
  auditorThreshold: Number(policy.threshold),
  caseId: bundle.caseId,
  caseIdHash: state.caseIdHash,
  bundleFile: path.relative(process.cwd(), BUNDLE_FILE).replaceAll("\\", "/"),
  bundleHash: await v4BundleHash(bundle),
  recoveredBundleHash: recoveredBundle.bundleHash,
  recoveredFromTransaction: recoveredBundle.transactionHash,
  programDecryptionVerified: opened.verified,
  approvalFile: path.relative(process.cwd(), APPROVAL_FILE).replaceAll("\\", "/"),
  approvalHash: approval.approvalHash,
  approvalVerification: approvalVerification.checks,
  payout: { recipient: approval.statement.payout.recipient, amount: approval.statement.payout.atomic, balance: payoutBalance.toString() },
  transactions: { ...state.native, ...state.evm },
  reservation: {
    poolBefore: beforePolicy[2].toString(),
    poolAfterSubmission: submittedPolicy[2].toString(),
    openCasesBefore: Number(beforePolicy[5]),
    openCasesAfterSubmission: Number(submittedPolicy[5]),
    reservedAmount: submittedCase[3].toString(),
  },
  finalState: {
    status: Number(finalCase[0]),
    severity: Number(finalCase[1]),
    escrowedAmount: finalCase[3].toString(),
    availablePool: finalPolicy[2].toString(),
    openCases: Number(finalPolicy[5]),
    registryTokenBalance: registryBalance.toString(),
    approvalHash: finalCase[9],
    onchainDeadlines: { acknowledgeBy: finalCase[4].toString(), triageBy: finalCase[5].toString(), embargoUntil: finalCase[6].toString() },
    bundleDeadlines: bundle.publicMetadata,
    caseAuditors,
  },
};
writeJson(EVIDENCE_FILE, lifecycle);

deployment.status = "lifecycle-verified";
deployment.lifecycleEvidence = "evidence/v4-lifecycle.json";
writeJson("evidence/v4-deployment.json", deployment);

console.log("9. V4 lifecycle completed and evidence written");
console.log(`   ✓ ${EVIDENCE_FILE}`);
console.log(`   ✓ payout ${approval.statement.payout.atomic} atomic to ${approval.statement.payout.recipient}`);
