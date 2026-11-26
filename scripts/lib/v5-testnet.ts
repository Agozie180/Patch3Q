import fs from "node:fs";
import path from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import { evmWindowCost, qorechainTestnet } from "@qorechain/evm";
import { EthNativeSigner, deriveUnifiedAccount, fetchPqcStatus, isRegisteredPqcKey, openEvmWindowMsg,
  unifiedAccountFromSeed, validateMnemonic, type UnifiedAccount } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, formatEther, hexToBytes, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wordlist } from "../../node_modules/.pnpm/@scure+bip39@1.6.0/node_modules/@scure/bip39/wordlists/english.js";

export const REST = "https://api-testnet.qore.host";
export const RPC = "https://rpc-testnet.qore.host";
export const CHAIN_ID = "qorechain-diana";
export const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0], { timeout: 30_000 }) });
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const readJson = <T = any>(file: string, fallback?: T): T => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback as T;
export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry, 2) + "\n");
}
export function readEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/u, "$2")]; }));
}

export async function actors() {
  const env = { ...readEnv(".env.testnet"), ...readEnv(".env") };
  const expected = readJson("evidence/deployment-v2.json").deployer;
  const v4 = readJson("evidence/v4-deployment.json");
  if (expected.evm.toLowerCase() !== v4.deployer.toLowerCase()) throw new Error("V2 and V4 deployer manifests disagree.");
  const phrase = env["SEEDPHRASE-WALLET"] ?? env.SEEDPHRASE_WALLET ?? env.PATCH3Q_DEPLOYER_MNEMONIC;
  if (!phrase) throw new Error("No deployment seed phrase was found in .env.");
  let program: UnifiedAccount | undefined;
  if (validateMnemonic(phrase)) {
    program = await deriveUnifiedAccount(phrase);
  } else {
    // Preserve the established V4 recovery procedure; never print or rewrite the phrase.
    const words = phrase.trim().toLowerCase().split(/\s+/u);
    const invalid = words.map((word, i) => wordlist.includes(word) ? -1 : i).filter((i) => i >= 0);
    if (invalid.length !== 1) throw new Error("The seed phrase is invalid and cannot be recovered by the established one-word procedure.");
    for (const replacement of wordlist) {
      const candidateWords = [...words]; candidateWords[invalid[0]] = replacement;
      const candidate = candidateWords.join(" ");
      if (!validateMnemonic(candidate)) continue;
      const account = await deriveUnifiedAccount(candidate);
      if (account.evm.toLowerCase() === expected.evm.toLowerCase()) { program = account; break; }
    }
  }
  if (!program || program.evm.toLowerCase() !== expected.evm.toLowerCase() || program.cosmos !== expected.qor) {
    throw new Error("Seed-derived account does not match the verified V2/V4 deployer.");
  }
  const auditorOne = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_PROGRAM_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_PROGRAM_RECOVERY_CODE });
  const auditorTwo = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_AUDITOR_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_AUDITOR_RECOVERY_CODE });
  const relayer = unifiedAccountFromSeed(hexToBytes(env.PATCH3Q_RELAYER_PRIVATE_KEY as Hex), { recoveryCode: env.PATCH3Q_RELAYER_RECOVERY_CODE });
  const policy = readJson("evidence/v4-policy.json");
  if (auditorOne.evm.toLowerCase() !== policy.auditors[0].toLowerCase() || auditorTwo.evm.toLowerCase() !== policy.auditors[1].toLowerCase() || relayer.evm.toLowerCase() !== policy.relayers[0].toLowerCase()) {
    throw new Error("Operational accounts do not match the verified V4 policy.");
  }
  for (const account of [program, auditorOne, auditorTwo, relayer]) {
    if (!isRegisteredPqcKey(await fetchPqcStatus({ rest: REST, address: account.cosmos }), account.pqc.publicKey)) throw new Error("A local PQ key does not match its registered Diana key.");
  }
  return { env, program, auditorOne, auditorTwo, relayer, policy };
}

export async function nativeWrite(account: UnifiedAccount, messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], mode: "hybrid" | "classical" = "hybrid") {
  const response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${account.cosmos}`);
  if (!response.ok) throw new Error("Could not read the account sequence.");
  const body = await response.json() as any;
  const raw = body.account?.base_account ?? body.account;
  const transport = await StargateClient.connect(RPC);
  try {
    const signer = new EthNativeSigner(account, { signMode: mode, rest: REST });
    const result = await signer.signAndBroadcast(transport, { chainId: CHAIN_ID,
      accountNumber: BigInt(raw.account_number), sequence: BigInt(raw.sequence),
      fee: { amount: [{ denom: "uqor", amount: "150000" }], gas: "1200000" }, messages });
    if (result.code !== 0) throw new Error(`Native transaction rejected with code ${result.code}: ${result.rawLog ?? ""}`);
    return { hash: result.transactionHash, explorer: `https://dashboard.qorechain.io/explorer/tx/${result.transactionHash}` };
  } finally { transport.disconnect(); }
}
export async function openWindow(account: UnifiedAccount, targets: Hex[], maxTxs = 30n) {
  const cost = evmWindowCost({ gas: 10_000_000n, maxFeePerGas: 250_000_000_000n });
  const result = await nativeWrite(account, [openEvmWindowMsg({ sender: account.cosmos, blocks: 3000n, maxTxs, maxValue: cost * maxTxs, allowedTargets: targets })]);
  await pause(3000); return result;
}
export function wallet(account: UnifiedAccount) {
  return createWalletClient({ account: privateKeyToAccount(account.privateKey as Hex), chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
}
export async function evmWrite(account: UnifiedAccount, request: { address: Hex; abi: Abi; functionName: string; args?: readonly unknown[] }) {
  const signer = wallet(account);
  const { request: simulated } = await publicClient.simulateContract({ ...request, account: signer.account } as any);
  const hash = await signer.writeContract(simulated as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
  return { hash, blockNumber: receipt.blockNumber.toString(), explorer: `https://dashboard.qorechain.io/explorer/tx/${hash}` };
}
export async function preflight() {
  const { program, relayer } = await actors();
  const chain = await publicClient.getChainId();
  if (chain !== 9800) throw new Error("RPC is not Diana chain 9800.");
  const balance = await publicClient.getBalance({ address: program.evm as Hex });
  if (balance === 0n) throw new Error("Seed-derived deployer has no Diana funds.");
  return { chainId: chain, deployer: program.evm, qor: program.cosmos, matchesV2AndV4: true,
    balanceQOR: formatEther(balance), relayer: relayer.evm };
}
