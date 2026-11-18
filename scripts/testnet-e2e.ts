/**
 * Patch3Q end-to-end rehearsal on QoreChain Diana.
 *
 *   pnpm testnet:accounts   create .env.testnet with three throwaway accounts (program, auditor, relayer)
 *   pnpm testnet:status     balances, ML-DSA-87 / ML-KEM-1024 registrations and EVM windows
 *   pnpm testnet:e2e        fund, register, deploy, and run two anonymous cases; writes evidence/testnet.json
 *
 * Only the program account needs the faucet. It forwards QOR to the auditor and relayer.
 * The reporter never has an account: each case uses a per-case ML-DSA-87 key and a fresh payout address.
 * Progress is checkpointed in .patch3q-testnet/state.json, so a rerun resumes where it stopped.
 */
import fs from "node:fs";
import path from "node:path";

import { StargateClient } from "@cosmjs/stargate";
import { evmWindowCost, evmWindowStatus, qorechainTestnet } from "@qorechain/evm";
import { generateSealKeys, sealKeysFromSeed } from "@qorechain/qoreseal";
import { signMessage, classicalKeyFromPrivate } from "@qorechain/qoresign";
import {
  EthNativeSigner,
  KEM_ALGORITHM_ML_KEM_1024,
  bank,
  buildRegisterPqcKeyMsg,
  fetchKemKey,
  fetchPqcStatus,
  generatePqcRecoveryCode,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  pqcMsg,
  signProofOfPossession,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  type Abi,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createSeverityApproval, verifySeverityApproval, type ApprovalSignerKeys } from "../src/lib/approval.js";
import { bytesToHex, fromBase64, fromBase64Url, toBase64Url } from "../src/lib/encoding.js";
import { bundleToJson, hashText, openBundle, sealReport } from "../src/lib/patch3q.js";
import type { Patch3QApprovalVault, Patch3QBundle, Patch3QKeyVault, ReportDraft, SealedPayout } from "../src/types.js";

const CHAIN_ID = "qorechain-diana";
const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const EXPLORER = "https://dashboard.qorechain.io/explorer/tx/";
const RUN_ID = process.argv[3]?.trim();
const ENV_FILE = path.resolve(".env.testnet");
const STATE_DIR = path.resolve(RUN_ID ? `.patch3q-testnet/${RUN_ID}` : ".patch3q-testnet");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const EVIDENCE_FILE = path.resolve(RUN_ID ? `evidence/testnet-${RUN_ID}.json` : "evidence/testnet.json");
const CASES_DIR = path.resolve(RUN_ID ? `evidence/cases-${RUN_ID}` : "evidence/cases");
const UQOR = 1_000_000n;
const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "150000" }], gas: "1200000" };
const ROLES = ["program", "auditor", "relayer"] as const;
type Role = (typeof ROLES)[number];
const SEVERITY_CRITICAL = 5;
const SEVERITY_HIGH = 4;

interface NativeTx { hash: string; explorer: string; pqcHybridVerify?: string }
interface EvmTx { hash: Hex; explorer: string; blockNumber?: string }
interface CaseState {
  caseId: string;
  caseIdHash: Hex;
  bundleFile: string;
  bundle: Patch3QBundle;
  reporterVault: Patch3QApprovalVault;
  payout: SealedPayout;
  txs: Record<string, EvmTx>;
  opened?: { auditorVerified: boolean; programVerified: boolean };
}
interface State {
  native: Record<string, NativeTx>;
  evm: Record<string, EvmTx>;
  tokenAddress?: Hex;
  registryAddress?: Hex;
  cases: Record<string, CaseState>;
  negativeTests: Record<string, string>;
}

// ---------------------------------------------------------------- env + accounts

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) return {};
  const entries = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const);
  return Object.fromEntries(entries);
}

function createAccounts(): void {
  if (fs.existsSync(ENV_FILE)) {
    console.log(`${path.basename(ENV_FILE)} already exists; keeping the same accounts.`);
    return;
  }
  const lines = [
    "# Patch3Q throwaway Diana testnet accounts. NEVER commit this file or reuse these keys on mainnet.",
    "# Fund only the PROGRAM address from the faucet; the script forwards QOR to the other two.",
  ];
  for (const role of ROLES) {
    const upper = role.toUpperCase();
    lines.push(`PATCH3Q_${upper}_PRIVATE_KEY=${generatePrivateKey()}`);
    lines.push(`PATCH3Q_${upper}_RECOVERY_CODE=${generatePqcRecoveryCode()}`);
    if (role !== "relayer") lines.push(`PATCH3Q_${upper}_KEM_SEED=${toBase64Url(generateSealKeys().seed)}`);
  }
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`Created ${path.basename(ENV_FILE)}.`);
}

function account(role: Role, env = readEnv()): UnifiedAccount {
  const upper = role.toUpperCase();
  const key = env[`PATCH3Q_${upper}_PRIVATE_KEY`];
  const recoveryCode = env[`PATCH3Q_${upper}_RECOVERY_CODE`];
  if (!key || !recoveryCode) throw new Error(`Missing ${role} keys: run pnpm testnet:accounts first.`);
  return unifiedAccountFromSeed(hexToBytes(key as Hex), { recoveryCode });
}

function kemSeed(role: "program" | "auditor", env = readEnv()): Uint8Array {
  const seed = env[`PATCH3Q_${role.toUpperCase()}_KEM_SEED`];
  if (!seed) throw new Error(`Missing ${role} ML-KEM seed in .env.testnet.`);
  return fromBase64Url(seed);
}

function signerKeys(role: "program" | "auditor", acc: UnifiedAccount): ApprovalSignerKeys {
  return { role, classicalPrivateKey: hexToBytes(acc.privateKey as Hex), pqKey: acc.pqc };
}

// ---------------------------------------------------------------- chain helpers

const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) return { native: {}, evm: {}, cases: {}, negativeTests: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
}

function saveState(state: State): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function balanceUqor(address: string): Promise<bigint> {
  const response = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uqor`);
  if (!response.ok) return 0n;
  const body = await response.json() as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (response.status === 404) throw new Error(`${address} does not exist on chain yet: fund it first.`);
  if (!response.ok) throw new Error(`account query failed: HTTP ${response.status}`);
  const body = await response.json() as { account?: Record<string, unknown> };
  const raw = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(raw.account_number ?? "0"), sequence: BigInt(raw.sequence ?? "0") };
}

async function hybridVerifyStatus(hash: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`);
    if (response.ok) {
      const body = await response.json() as {
        tx_response?: { events?: Array<{ type: string; attributes: Array<{ key: string; value: string }> }> };
      };
      const event = body.tx_response?.events?.find((entry) => entry.type === "pqc_hybrid_verify");
      return event?.attributes.find((attribute) => attribute.key === "status")?.value ?? "classical-only";
    }
    await sleep(2_000);
  }
  return undefined;
}

async function broadcastNative(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
): Promise<NativeTx> {
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    const result = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID, accountNumber, sequence, fee: NATIVE_FEE, messages,
    });
    if (result.code !== 0) throw new Error(`native tx failed (code ${result.code}): ${result.rawLog ?? ""}`);
    await sleep(3_000);
    return {
      hash: result.transactionHash,
      explorer: EXPLORER + result.transactionHash,
      pqcHybridVerify: mode === "hybrid" ? await hybridVerifyStatus(result.transactionHash) : "classical (registration)",
    };
  } finally {
    transport.disconnect();
  }
}

async function step<T>(state: State, label: string, done: () => boolean, run: () => Promise<T>): Promise<void> {
  if (done()) {
    console.log(`  ✓ ${label} (already done)`);
    return;
  }
  process.stdout.write(`  … ${label}\n`);
  await run();
  saveState(state);
  console.log(`  ✓ ${label}`);
}

function readArtifact(name: string): { abi: Abi; bytecode: Hex } {
  const file = path.resolve("artifacts", name + ".json");
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}; run pnpm compile:contract first.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function wallet(acc: UnifiedAccount) {
  return createWalletClient({
    account: privateKeyToAccount(acc.privateKey as Hex),
    chain: qorechainTestnet,
    transport: http(qorechainTestnet.rpcUrls.default.http[0]),
  });
}

async function evmWrite(
  acc: UnifiedAccount,
  request: { address: Hex; abi: Abi; functionName: string; args: readonly unknown[] },
): Promise<EvmTx> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { request: simulated } = await publicClient.simulateContract({
        ...request,
        account: privateKeyToAccount(acc.privateKey as Hex),
      } as Parameters<typeof publicClient.simulateContract>[0]);
      const hash = await wallet(acc).writeContract(simulated as Parameters<ReturnType<typeof wallet>["writeContract"]>[0]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${request.functionName} reverted in ${hash}`);
      return { hash, explorer: EXPLORER + hash, blockNumber: receipt.blockNumber.toString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 3 && /nonce|underpriced|already known|wait for confirmations/iu.test(message)) {
        await sleep(6_000);
        continue;
      }
      throw error;
    }
  }
}

async function revertName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NOT REVERTED";
  } catch (error) {
    if (error instanceof BaseError) {
      const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.shortMessage;
      return error.details ? error.details.replace(/\s*\[cosmossdk[^\]]*\]/u, "") : error.shortMessage;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

async function chainNow(): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function waitUntil(unixSeconds: number, label: string): Promise<void> {
  for (;;) {
    const now = await chainNow();
    if (now > unixSeconds) return;
    console.log(`    waiting ${unixSeconds - now + 1}s for ${label}`);
    await sleep(Math.min(30, unixSeconds - now + 2) * 1_000);
  }
}

// ---------------------------------------------------------------- status

async function status(): Promise<void> {
  const env = readEnv();
  for (const role of ROLES) {
    const acc = account(role, env);
    const [balance, pqc, window] = await Promise.all([
      balanceUqor(acc.cosmos),
      fetchPqcStatus({ rest: REST, address: acc.cosmos }).catch(() => undefined),
      evmWindowStatus({ rest: REST, address: acc.cosmos }).catch(() => undefined),
    ]);
    const kem = role === "relayer" ? undefined : await fetchKemKey({ rest: REST, address: acc.cosmos }).catch(() => undefined);
    console.log(`${role.padEnd(8)} ${acc.cosmos}  ${acc.evm}`);
    console.log(`         balance ${(Number(balance) / 1e6).toFixed(3)} QOR · ML-DSA-87 ${pqc?.registered ? (isRegisteredPqcKey(pqc, acc.pqc.publicKey) === false ? "WRONG KEY" : "registered") : "not registered"}` +
      (role === "relayer" ? "" : ` · ML-KEM-1024 ${kem?.found ? "published" : "not published"}`) +
      ` · EVM window ${window?.found ? (window.live ? `live (${window.remainingTxs} txs left)` : "expired") : "none"}`);
  }
}

// ---------------------------------------------------------------- the run

const SYNTHETIC_REPORT: ReportDraft = {
  title: "Synthetic Diana rehearsal: duplicate signer accepted in threshold verification",
  program: "Patch3Q rehearsal program",
  asset: "Synthetic verifier used only for the Patch3Q testnet rehearsal",
  severity: "critical",
  reporterAlias: "researcher-zero",
  summary: "A synthetic threshold verifier counts the same signer twice. This is rehearsal data, not a live vulnerability.",
  impact: "In the rehearsal scenario an attacker satisfies quorum without two independent signers.",
  reproduction: "1. Create one valid signature.\n2. Submit the same signer twice.\n3. Observe the threshold accepted.",
  remediation: "Reject duplicate signer identifiers before accumulating signature weight.",
  embargoUntil: "2030-01-01",
};

async function sealCase(
  name: string,
  program: UnifiedAccount,
  auditor: UnifiedAccount,
  offsets: { ack: number; triage: number; embargo: number },
): Promise<CaseState> {
  const now = await chainNow();
  const payoutWallet = privateKeyToAccount(generatePrivateKey());
  const sealed = await sealReport({
    report: { ...SYNTHETIC_REPORT, title: `${SYNTHETIC_REPORT.title} (${name})` },
    mode: "testnet",
    reporterMode: "anonymous",
    payoutAddress: payoutWallet.address,
    maintainerAddress: program.cosmos,
    auditorAddress: auditor.cosmos,
    rest: REST,
    now: new Date(now * 1000),
    deadlines: {
      acknowledgeBy: new Date((now + offsets.ack) * 1000),
      triageBy: new Date((now + offsets.triage) * 1000),
      embargoUntil: new Date((now + offsets.embargo) * 1000),
    },
  });
  const reporterVault = sealed.approvalVaults?.find((vault) => vault.role === "reporter");
  if (!reporterVault || !sealed.payout) throw new Error("Anonymous seal did not return the reporter key and payout.");
  fs.mkdirSync(CASES_DIR, { recursive: true });
  const bundleFile = path.join(CASES_DIR, `${name}.bundle.json`);
  fs.writeFileSync(bundleFile, bundleToJson(sealed.bundle) + "\n");
  return {
    caseId: sealed.bundle.caseId,
    caseIdHash: await hashText(sealed.bundle.caseId),
    bundleFile: path.relative(process.cwd(), bundleFile),
    bundle: sealed.bundle,
    reporterVault,
    payout: sealed.payout,
    txs: {},
  };
}

function recipientVault(bundle: Patch3QBundle, role: "maintainer" | "auditor", seed: Uint8Array): Patch3QKeyVault {
  return { type: "patch3q.demo-key", version: 1, caseId: bundle.caseId, role, label: role, seed: toBase64Url(seed), warning: "testnet" };
}

async function submitArgs(entry: CaseState, program: UnifiedAccount, auditor: UnifiedAccount) {
  const { bundle } = entry;
  return [
    program.evm, auditor.evm, entry.caseIdHash, bundle.envelopeHash, bundle.contentCommitment,
    await hashText(program.cosmos.toLowerCase()),
    BigInt(Math.floor(Date.parse(bundle.publicMetadata.acknowledgeBy) / 1000)),
    BigInt(Math.floor(Date.parse(bundle.publicMetadata.triageBy) / 1000)),
    BigInt(Math.floor(Date.parse(bundle.publicMetadata.embargoUntil) / 1000)),
    bundle.privacy.reporterPqKeyHash, bundle.privacy.payoutCommitment,
  ] as const;
}

async function run(): Promise<void> {
  const env = readEnv();
  const program = account("program", env);
  const auditor = account("auditor", env);
  const relayer = account("relayer", env);
  const state = loadState();
  const registryAbi = readArtifact("Patch3QRegistry").abi;
  const tokenAbi = readArtifact("MockTUSDT").abi;

  const programBalance = await balanceUqor(program.cosmos);
  if (programBalance < 30n * UQOR && !state.registryAddress) {
    console.log(`\nThe program account holds ${(Number(programBalance) / 1e6).toFixed(3)} QOR.`);
    console.log(`Claim the faucet for ${program.cosmos} at https://dashboard.qorechain.io/faucet, then rerun.\n`);
    process.exitCode = 2;
    return;
  }

  console.log("\n1. Accounts and post-quantum keys");
  for (const [role, acc] of [["auditor", auditor], ["relayer", relayer]] as const) {
    await step(state, `fund ${role} with 12 QOR (hybrid-signed bank send)`, () => Boolean(state.native[`fund_${role}`]), async () => {
      if ((await balanceUqor(acc.cosmos)) >= 6n * UQOR) {
        state.native[`fund_${role}`] = { hash: "pre-funded", explorer: "" };
        return;
      }
      await ensurePqc(program, state, "program");
      state.native[`fund_${role}`] = await broadcastNative(program, "hybrid", [
        bank.send({ fromAddress: program.cosmos, toAddress: acc.cosmos, amount: [{ denom: "uqor", amount: (12n * UQOR).toString() }] }),
      ]);
    });
  }
  for (const [role, acc] of [["program", program], ["auditor", auditor], ["relayer", relayer]] as const) {
    await ensurePqc(acc, state, role);
  }
  for (const [role, acc] of [["program", program], ["auditor", auditor]] as const) {
    await step(state, `publish ${role} ML-KEM-1024 key (MsgRegisterKEMKey)`, () => Boolean(state.native[`kem_${role}`]), async () => {
      const publicKey = sealKeysFromSeed(kemSeed(role, env)).mlkemPublicKey;
      const current = await fetchKemKey({ rest: REST, address: acc.cosmos });
      if (current.found && current.key && bytesToHex(current.key.publicKey) === bytesToHex(publicKey)) {
        state.native[`kem_${role}`] = { hash: "already-published", explorer: "" };
        return;
      }
      state.native[`kem_${role}`] = await broadcastNative(acc, "hybrid", [
        pqcMsg.registerKemKey({ sender: acc.cosmos, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey }),
      ]);
    });
  }

  console.log("\n2. EVM authorization windows and deployment");
  await openWindow(state, "program", program, { blocks: 3000n, maxTxs: 24n });
  await step(state, "deploy MockTUSDT bounty token", () => Boolean(state.tokenAddress), async () => {
    const artifact = readArtifact("MockTUSDT");
    const hash = await wallet(program).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("MockTUSDT deployment failed");
    state.tokenAddress = receipt.contractAddress;
    state.evm.tokenDeployment = { hash, explorer: EXPLORER + hash, blockNumber: receipt.blockNumber.toString() };
  });
  await step(state, "deploy Patch3QRegistry", () => Boolean(state.registryAddress), async () => {
    const artifact = readArtifact("Patch3QRegistry");
    const hash = await wallet(program).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [state.tokenAddress] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Patch3QRegistry deployment failed");
    state.registryAddress = receipt.contractAddress;
    state.evm.registryDeployment = { hash, explorer: EXPLORER + hash, blockNumber: receipt.blockNumber.toString() };
  });
  const registry = state.registryAddress as Hex;
  const token = state.tokenAddress as Hex;
  await step(state, "mint 10,000 tUSDT to the program", () => Boolean(state.evm.mint), async () => {
    state.evm.mint = await evmWrite(program, { address: token, abi: tokenAbi, functionName: "mint", args: [program.evm, 10_000_000_000n] });
  });
  await step(state, "approve the registry to pull bounty escrow", () => Boolean(state.evm.approve), async () => {
    state.evm.approve = await evmWrite(program, { address: token, abi: tokenAbi, functionName: "approve", args: [registry, 10_000_000_000n] });
  });
  await openWindow(state, "auditor", auditor, { blocks: 3000n, maxTxs: 8n, allowedTargets: [registry] });
  await openWindow(state, "relayer", relayer, { blocks: 3000n, maxTxs: 8n, allowedTargets: [registry] });

  console.log("\n3. Seal two anonymous cases in the browser library");
  await step(state, "seal case A (normal lifecycle) to the registered ML-KEM keys", () => Boolean(state.cases.normal), async () => {
    state.cases.normal = await sealCase("case-a-normal", program, auditor, { ack: 300, triage: 600, embargo: 900 });
  });
  await step(state, "seal case B (ghosted program) to the registered ML-KEM keys", () => Boolean(state.cases.ghosted), async () => {
    state.cases.ghosted = await sealCase("case-b-ghosted", program, auditor, { ack: 120, triage: 240, embargo: 300 });
  });
  const caseA = state.cases.normal;
  const caseB = state.cases.ghosted;

  console.log("\n4. Recipients decrypt independently with their registered ML-KEM keys");
  for (const entry of [caseA, caseB]) {
    await step(state, `program and auditor open ${entry.caseId}`, () => Boolean(entry.opened), async () => {
      const programOpen = await openBundle(entry.bundle, recipientVault(entry.bundle, "maintainer", kemSeed("program", env)));
      const auditorOpen = await openBundle(entry.bundle, recipientVault(entry.bundle, "auditor", kemSeed("auditor", env)));
      if (!programOpen.verified || !auditorOpen.verified) throw new Error("A recipient could not verify the sealed case.");
      if (auditorOpen.payload.payout?.recipient !== entry.payout.recipient) throw new Error("Sealed payout mismatch.");
      entry.opened = { programVerified: programOpen.verified, auditorVerified: auditorOpen.verified };
    });
  }

  console.log("\n5. Anchor both cases through the relayer (no reporter account)");
  for (const entry of [caseA, caseB]) {
    await step(state, `relay ${entry.caseId}`, () => Boolean(entry.txs.submitAnonymousCase), async () => {
      entry.txs.submitAnonymousCase = await evmWrite(relayer, {
        address: registry, abi: registryAbi, functionName: "submitAnonymousCase", args: await submitArgs(entry, program, auditor),
      });
    });
  }

  console.log("\n6. Case A: program acknowledges, triages and funds within SLA");
  for (const [functionName, args] of [
    ["acknowledgeCase", [caseA.caseIdHash]],
    ["triageCase", [caseA.caseIdHash]],
    ["fundBounty", [caseA.caseIdHash, 2_500_000_000n]],
  ] as const) {
    await step(state, `A.${functionName}`, () => Boolean(caseA.txs[functionName]), async () => {
      caseA.txs[functionName] = await evmWrite(program, { address: registry, abi: registryAbi, functionName, args });
    });
  }

  console.log("\n7. Negative tests against live Diana state (eth_call reverts, plus one broadcast refused by the node)");
  const needNegativeTests = Object.keys(state.negativeTests).length < 5;
  const auditorAccount = privateKeyToAccount(auditor.privateKey as Hex);
  const approvalA = await createSeverityApproval({
    bundle: caseA.bundle,
    participantRole: "program",
    vaults: { participant: signerKeys("program", program), auditor: signerKeys("auditor", auditor) },
    registryAddress: registry,
    severity: "critical",
    payoutAtomic: "2500000000",
    rationale: "Synthetic rehearsal: duplicate signer bypasses quorum; critical impact.",
    payout: caseA.payout,
  });
  const programSig = bytesToHex(fromBase64(approvalA.signatures.participant.pq!.signature));
  const auditorSig = bytesToHex(fromBase64(approvalA.signatures.auditor.pq!.signature));
  const ecdsaOnly = signMessage({
    chainId: CHAIN_ID,
    signer: auditor.cosmos,
    data: hexToBytes(approvalA.approvalHash),
    classicalKey: classicalKeyFromPrivate(hexToBytes(auditor.privateKey as Hex), "eth_secp256k1"),
  });
  const approveArgs = (recipient: Hex, salt: Hex, participant: Hex, auditorSignature: Hex) => [
    caseA.caseIdHash, SEVERITY_CRITICAL, 2_500_000_000n, approvalA.statement.rationaleHash, recipient, salt, "0x",
    participant, auditorSignature,
  ] as const;
  if (needNegativeTests) state.negativeTests.ecdsaOnlyAuditorApproval = await revertName(publicClient.simulateContract({
    address: registry, abi: registryAbi, functionName: "approveAnonymousSeverity", account: auditorAccount,
    args: approveArgs(caseA.payout.recipient, caseA.payout.salt, programSig, bytesToHex(fromBase64(ecdsaOnly.classical.signature))),
  }));
  if (needNegativeTests) state.negativeTests.redirectedPayoutToAuditor = await revertName(publicClient.simulateContract({
    address: registry, abi: registryAbi, functionName: "approveAnonymousSeverity", account: auditorAccount,
    args: approveArgs(auditor.evm as Hex, caseA.payout.salt, programSig, auditorSig),
  }));
  if (needNegativeTests) state.negativeTests.relayerCannotReleaseEscrow = await revertName(publicClient.simulateContract({
    address: registry, abi: registryAbi, functionName: "approveAnonymousSeverity", account: privateKeyToAccount(relayer.privateKey as Hex),
    args: approveArgs(caseA.payout.recipient, caseA.payout.salt, programSig, auditorSig),
  }));
  if (needNegativeTests) state.negativeTests.prematureEscalation = await revertName(publicClient.simulateContract({
    address: registry, abi: registryAbi, functionName: "escalateMissedDeadline", account: privateKeyToAccount(relayer.privateKey as Hex),
    args: [caseA.caseIdHash],
  }));
  if (needNegativeTests) state.negativeTests.scopedWindowBlocksTokenCall = await revertName(evmWrite(auditor, {
    address: token, abi: tokenAbi, functionName: "mint", args: [auditor.evm, 1n],
  }));
  saveState(state);
  for (const [name, result] of Object.entries(state.negativeTests)) console.log(`  ✓ ${name}: ${result}`);

  console.log("\n8. Case A: two ML-DSA-87 approvals verified by the 0x0A01 precompile release the bounty");
  await step(state, "A.approveAnonymousSeverity (program + auditor)", () => Boolean(caseA.txs.approveAnonymousSeverity), async () => {
    const offchain = await verifySeverityApproval(caseA.bundle, approvalA, registry, "program", REST);
    if (!offchain.verified) throw new Error("Off-chain approval verification failed: " + JSON.stringify(offchain.checks));
    caseA.txs.approveAnonymousSeverity = await evmWrite(auditor, {
      address: registry, abi: registryAbi, functionName: "approveAnonymousSeverity",
      args: approveArgs(caseA.payout.recipient, caseA.payout.salt, programSig, auditorSig),
    });
  });

  console.log("\n9. Case B: the program funds a standing bounty, then ghosts the acknowledgement deadline");
  await step(state, "B.fundBounty", () => Boolean(caseB.txs.fundBounty), async () => {
    caseB.txs.fundBounty = await evmWrite(program, {
      address: registry, abi: registryAbi, functionName: "fundBounty", args: [caseB.caseIdHash, 1_000_000_000n],
    });
  });
  await step(state, "B.escalateMissedDeadline by the relayer acting as keeper", () => Boolean(caseB.txs.escalateMissedDeadline), async () => {
    await waitUntil(Math.floor(Date.parse(caseB.bundle.publicMetadata.acknowledgeBy) / 1000) + 2, "case B acknowledgement deadline");
    caseB.txs.escalateMissedDeadline = await evmWrite(relayer, {
      address: registry, abi: registryAbi, functionName: "escalateMissedDeadline", args: [caseB.caseIdHash],
    });
  });
  await step(state, "B.approveAnonymousSeverity (per-case reporter key + auditor)", () => Boolean(caseB.txs.approveAnonymousSeverity), async () => {
    const approvalB = await createSeverityApproval({
      bundle: caseB.bundle,
      participantRole: "reporter",
      vaults: { participant: caseB.reporterVault, auditor: signerKeys("auditor", auditor) },
      registryAddress: registry,
      severity: "high",
      payoutAtomic: "1000000000",
      rationale: "Synthetic rehearsal: the program missed its acknowledgement deadline; the escrow consequence applies.",
      payout: caseB.payout,
    });
    const offchain = await verifySeverityApproval(caseB.bundle, approvalB, registry, "reporter", REST);
    if (!offchain.verified) throw new Error("Off-chain escalated approval failed: " + JSON.stringify(offchain.checks));
    const reporterKey = bytesToHex(fromBase64Url(caseB.bundle.approvalAuthorities!.reporter.pqPublicKey!));
    caseB.txs.approveAnonymousSeverity = await evmWrite(auditor, {
      address: registry, abi: registryAbi, functionName: "approveAnonymousSeverity",
      args: [
        caseB.caseIdHash, SEVERITY_HIGH, 1_000_000_000n, approvalB.statement.rationaleHash, caseB.payout.recipient,
        caseB.payout.salt, reporterKey,
        bytesToHex(fromBase64(approvalB.signatures.participant.pq!.signature)),
        bytesToHex(fromBase64(approvalB.signatures.auditor.pq!.signature)),
      ],
    });
  });

  console.log("\n10. Case A: publish the redacted disclosure commitment after the embargo");
  await step(state, "A.discloseCase", () => Boolean(caseA.txs.discloseCase), async () => {
    await waitUntil(Math.floor(Date.parse(caseA.bundle.publicMetadata.embargoUntil) / 1000) + 2, "case A embargo");
    const redacted = "Patch3Q rehearsal disclosure: duplicate signer entries were accepted by a synthetic verifier. Fixed by rejecting duplicates.";
    fs.writeFileSync(path.join(CASES_DIR, "case-a-normal.redacted.md"), redacted + "\n");
    caseA.txs.discloseCase = await evmWrite(program, {
      address: registry, abi: registryAbi, functionName: "discloseCase", args: [caseA.caseIdHash, await hashText(redacted)],
    });
  });

  await writeEvidence(state, { program, auditor, relayer }, tokenAbi);
  console.log(`\nDone. Evidence written to ${path.relative(process.cwd(), EVIDENCE_FILE)}.`);
}

async function ensurePqc(acc: UnifiedAccount, state: State, role: Role): Promise<void> {
  await step(state, `register ${role} ML-DSA-87 key with proof of possession`, () => Boolean(state.native[`pqc_${role}`]), async () => {
    const status = await fetchPqcStatus({ rest: REST, address: acc.cosmos });
    if (status.registered) {
      if (isRegisteredPqcKey(status, acc.pqc.publicKey) === false) throw new Error(`${role} has a different PQC key registered.`);
      state.native[`pqc_${role}`] = { hash: "already-registered", explorer: "" };
      return;
    }
    const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: acc.cosmos, keypair: acc.pqc });
    state.native[`pqc_${role}`] = await broadcastNative(acc, "classical", [
      buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession }),
    ]);
  });
}

async function openWindow(
  state: State,
  role: Role,
  acc: UnifiedAccount,
  options: { blocks: bigint; maxTxs: bigint; allowedTargets?: Hex[] },
): Promise<void> {
  const label = options.allowedTargets ? `open ${role} EVM window scoped to the registry` : `open ${role} EVM window`;
  await step(state, label, () => false, async () => {
    const current = await evmWindowStatus({ rest: REST, address: acc.cosmos }).catch(() => undefined);
    if (current?.found && current.live && BigInt(current.remainingTxs ?? 0) >= 4n && state.native[`window_${role}`]) return;
    const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
    state.native[`window_${role}`] = await broadcastNative(acc, "hybrid", [
      openEvmWindowMsg({
        sender: acc.cosmos,
        blocks: options.blocks,
        maxTxs: options.maxTxs,
        maxValue: perTx * options.maxTxs,
        ...(options.allowedTargets ? { allowedTargets: options.allowedTargets } : {}),
      }),
    ]);
    await sleep(8_000);
  });
}

async function writeEvidence(
  state: State,
  accounts: Record<Role, UnifiedAccount>,
  tokenAbi: Abi,
): Promise<void> {
  const caseA = state.cases.normal;
  const caseB = state.cases.ghosted;
  const balances = async (recipient: Hex) =>
    (await publicClient.readContract({ address: state.tokenAddress!, abi: tokenAbi, functionName: "balanceOf", args: [recipient] })) as bigint;
  const evidence = {
    network: CHAIN_ID,
    evmChainId: 9800,
    status: "verified",
    generatedAt: new Date().toISOString(),
    registryAddress: state.registryAddress,
    bountyTokenAddress: state.tokenAddress,
    accounts: Object.fromEntries(Object.entries(accounts).map(([role, acc]) => [role, { qor: acc.cosmos, evm: acc.evm }])),
    reporterAccount: "none — both cases are anonymous; the reporter never signed a transaction",
    transactions: {
      deployment: state.evm.registryDeployment?.hash,
      caseSubmitted: caseA.txs.submitAnonymousCase?.hash,
      acknowledgement: caseA.txs.acknowledgeCase?.hash,
      triage: caseA.txs.triageCase?.hash,
      escrowFunding: caseA.txs.fundBounty?.hash,
      resolution: caseA.txs.approveAnonymousSeverity?.hash,
      severityApprovalAndRelease: caseA.txs.approveAnonymousSeverity?.hash,
      redactedDisclosure: caseA.txs.discloseCase?.hash,
      deadlineEscalation: caseB.txs.escalateMissedDeadline?.hash,
      escalatedApprovalAndRelease: caseB.txs.approveAnonymousSeverity?.hash,
    },
    native: state.native,
    evm: state.evm,
    cases: Object.fromEntries(await Promise.all(Object.entries(state.cases).map(async ([name, entry]) => [name, {
      caseId: entry.caseId,
      caseIdHash: entry.caseIdHash,
      bundle: entry.bundleFile,
      envelopeHash: entry.bundle.envelopeHash,
      contentCommitment: entry.bundle.contentCommitment,
      sizeBucket: entry.bundle.privacy.sizeBucket,
      reporterPqKeyHash: entry.bundle.privacy.reporterPqKeyHash,
      payoutCommitment: entry.bundle.privacy.payoutCommitment,
      payoutRecipient: entry.payout.recipient,
      payoutBalance: (await balances(entry.payout.recipient)).toString(),
      recipientsDecrypted: entry.opened,
      transactions: entry.txs,
    }]))),
    negativeTests: state.negativeTests,
    externalEvidence: {
      qcaiAuditArtifact: "evidence/qcai-audit.json",
      demoVideoUrl: null,
      buildInPublicUrl: null,
    },
  };
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2) + "\n");
}

const commands: Record<string, () => Promise<void> | void> = { accounts: createAccounts, status, run };
const command = process.argv[2] ?? "run";
const handler = commands[command];
if (!handler) {
  console.error(`Unknown command "${command}". Use: accounts | status | run`);
  process.exit(1);
}
Promise.resolve(handler()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
