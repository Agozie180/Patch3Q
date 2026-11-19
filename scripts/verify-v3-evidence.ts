import fs from "node:fs";
import path from "node:path";

import { qorechainTestnet } from "@qorechain/evm";
import { envelopeFromText } from "@qorechain/qoreseal";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  type Abi,
  type Hex,
} from "viem";

import { sha256 } from "../src/lib/encoding";
import { hashText, parseBundle } from "../src/lib/patch3q";

const EVIDENCE_FILE = "evidence/testnet-v3.json";
const REPORT_FILE = "evidence/verification-v3.json";
const REST = process.env.PATCH3Q_REST ?? "https://api-testnet.qore.host";
const STATUS = ["Submitted", "Acknowledged", "Triaged", "Resolved", "Disclosed", "Cancelled", "Escalated"];

type TxRef = { hash: string; blockNumber?: string };
type Check = { check: string; ok: boolean; detail?: unknown };

const evidence = JSON.parse(fs.readFileSync(EVIDENCE_FILE, "utf8"));
const registryArtifact = JSON.parse(fs.readFileSync("artifacts/Patch3QRegistry.json", "utf8"));
const tokenArtifact = JSON.parse(fs.readFileSync("artifacts/MockTUSDT.json", "utf8"));
const registryAbi = registryArtifact.abi as Abi;
const tokenAbi = tokenArtifact.abi as Abi;
const registry = getAddress(evidence.registryAddress);
const token = getAddress(evidence.bountyTokenAddress);
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });
const checks: Check[] = [];

function record(check: string, ok: boolean, detail?: unknown): void {
  checks.push({ check, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "✓" : "✗"} ${check}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

function maskImmutables(code: string, values: string[]): string {
  let masked = code.toLowerCase();
  for (const value of values) {
    masked = masked.split(value.toLowerCase().replace(/^0x/u, "").padStart(64, "0")).join("0".repeat(64));
  }
  return masked;
}

async function eventsOf(ref: TxRef): Promise<{ events: string[]; from: Hex }> {
  const hash = ref.hash as Hex;
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  if (receipt.status !== "success") throw new Error(`${hash} status ${receipt.status}`);
  if (!transaction.to || getAddress(transaction.to) !== registry) throw new Error(`${hash} does not target the v3 registry`);
  const events = receipt.logs.flatMap((log) => {
    try {
      return [decodeEventLog({ abi: [...registryAbi, ...tokenAbi], data: log.data, topics: log.topics }).eventName];
    } catch {
      return [];
    }
  });
  return { events, from: getAddress(transaction.from) };
}

async function main(): Promise<void> {
  record("v3 evidence status and version are verified", evidence.status === "verified" && evidence.version === 3,
    { status: evidence.status, version: evidence.version });

  const [registryCode, tokenCode] = await Promise.all([
    client.getCode({ address: registry }),
    client.getCode({ address: token }),
  ]);
  record("v3 registry runtime matches the current compiled artifact (token immutable masked)",
    maskImmutables(registryCode ?? "0x", [token]) === maskImmutables(registryArtifact.deployedBytecode, []),
    { codeHash: keccak256(registryCode ?? "0x"), bytes: ((registryCode ?? "0x").length - 2) / 2 });
  record("v3 MockTUSDT runtime matches the current compiled artifact",
    (tokenCode ?? "").toLowerCase() === tokenArtifact.deployedBytecode.toLowerCase(),
    { codeHash: keccak256(tokenCode ?? "0x") });
  const boundToken = await client.readContract({ address: registry, abi: registryAbi, functionName: "bountyToken" });
  record("v3 registry is bound to the documented bounty token", getAddress(boundToken as Hex) === token);

  for (const [label, ref, address] of [
    ["v3 MockTUSDT deployment", evidence.evm.tokenDeployment, token],
    ["v3 Patch3QRegistry deployment", evidence.evm.registryDeployment, registry],
  ] as [string, TxRef, Hex][]) {
    const receipt = await client.getTransactionReceipt({ hash: ref.hash as Hex });
    record(`${label} ${ref.hash}`, receipt.status === "success" && getAddress(receipt.contractAddress!) === address);
  }

  const expected: Record<string, Record<string, string[]>> = {
    normal: {
      submitAnonymousCase: ["CaseSubmitted", "AnonymousCaseSubmitted"],
      acknowledgeCase: ["CaseAcknowledged"],
      triageCase: ["CaseTriaged"],
      fundBounty: ["BountyFunded"],
      approveAnonymousSeverity: ["SeverityApproved", "BountyReleased", "CaseResolved"],
      discloseCase: ["CaseDisclosed"],
    },
    ghosted: {
      submitAnonymousCase: ["CaseSubmitted", "AnonymousCaseSubmitted"],
      fundBounty: ["BountyFunded"],
      escalateMissedDeadline: ["DeadlineBreached", "CaseEscalated"],
      approveAnonymousSeverity: ["SeverityApproved", "BountyReleased", "CaseResolved"],
    },
  };
  const transactionSenders = new Set<string>();
  const relayer = getAddress(evidence.accounts.relayer.evm);

  for (const [name, entry] of Object.entries<any>(evidence.cases)) {
    for (const [method, requiredEvents] of Object.entries(expected[name])) {
      const ref: TxRef | undefined = entry.transactions[method];
      if (!ref) {
        record(`v3 ${name}.${method}`, false, "missing");
        continue;
      }
      try {
        const result = await eventsOf(ref);
        transactionSenders.add(result.from);
        record(`v3 ${name}.${method} ${ref.hash}`,
          requiredEvents.every((event) => result.events.includes(event)), result.events);
      } catch (error) {
        record(`v3 ${name}.${method} ${ref.hash}`, false, String(error));
      }
    }

    const bundleFile = path.normalize(entry.bundle);
    const bundle = parseBundle(fs.readFileSync(bundleFile, "utf8"));
    const recomputedEnvelopeHash = await sha256(envelopeFromText(bundle.envelope));
    const submitted = await client.getTransactionReceipt({ hash: entry.transactions.submitAnonymousCase.hash as Hex });
    const submittedEvent = submitted.logs
      .map((log) => {
        try { return decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics }); } catch { return undefined; }
      })
      .find((event) => event?.eventName === "CaseSubmitted");
    const args = submittedEvent?.args as { envelopeHash: Hex; contentCommitment: Hex; reporter: Hex } | undefined;
    record(`v3 ${name}: bundle hashes match the anchored commitments`,
      recomputedEnvelopeHash === bundle.envelopeHash && args?.envelopeHash === bundle.envelopeHash &&
      args?.contentCommitment === bundle.contentCommitment, recomputedEnvelopeHash);
    record(`v3 ${name}: reporter account is absent on-chain`,
      args?.reporter === "0x0000000000000000000000000000000000000000");
    record(`v3 ${name}: envelope uses the documented 16384-byte privacy bucket`,
      bundle.privacy.sizeBucket === 16384 && entry.sizeBucket === 16384);

    const [state, privacy] = await Promise.all([
      client.readContract({ address: registry, abi: registryAbi, functionName: "caseState", args: [entry.caseIdHash] }) as Promise<readonly unknown[]>,
      client.readContract({ address: registry, abi: registryAbi, functionName: "privacyState", args: [entry.caseIdHash] }) as Promise<readonly [boolean, Hex, Hex, Hex]>,
    ]);
    const status = STATUS[Number(state[0])];
    record(`v3 ${name}: final on-chain status`, name === "normal" ? status === "Disclosed" : status === "Resolved", status);
    if (name === "ghosted") {
      record("v3 ghosted: acknowledgement breach is recorded", (Number(state[2]) & 1) === 1,
        { slaBreaches: Number(state[2]) });
    }
    record(`v3 ${name}: privacy commitments and relayer binding match the bundle`,
      privacy[0] && getAddress(privacy[1]) === relayer && privacy[2] === bundle.privacy.reporterPqKeyHash &&
      privacy[3] === bundle.privacy.payoutCommitment);
    const wrongOpening = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "payoutCommitmentOf",
      args: [entry.caseIdHash, entry.payoutRecipient, `0x${"00".repeat(32)}`],
    });
    record(`v3 ${name}: payout commitment rejects an unknown salt`, wrongOpening !== privacy[3]);
    const payoutBalance = await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [entry.payoutRecipient],
    }) as bigint;
    record(`v3 ${name}: sealed payout recipient received the documented amount`,
      payoutBalance.toString() === entry.payoutBalance && payoutBalance > 0n, payoutBalance.toString());

    if (name === "normal") {
      const redactedFile = bundleFile.replace(/\.bundle\.json$/u, ".redacted.md");
      const redacted = fs.readFileSync(redactedFile, "utf8").trimEnd();
      record("v3 normal: redacted report hashes to the disclosed on-chain commitment",
        (await hashText(redacted)) === state[11]);
      record("v3 normal: payout approval and resolution are the same atomic transaction",
        evidence.transactions.resolution === entry.transactions.approveAnonymousSeverity.hash);
    } else {
      record("v3 ghosted: reporter/auditor payout atomically resolves the escalated case",
        status === "Resolved" && entry.transactions.approveAnonymousSeverity.hash === evidence.transactions.escalatedApprovalAndRelease);
    }
  }

  const roleAddresses = ["program", "auditor", "relayer"].map((role) => getAddress(evidence.accounts[role].evm));
  record("v3 case transactions were sent only by program, auditor or relayer",
    [...transactionSenders].every((sender) => roleAddresses.includes(sender)), [...transactionSenders]);

  for (const [label, ref] of Object.entries<any>(evidence.native)) {
    const response = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${ref.hash}`);
    const body = await response.json() as {
      tx_response?: { code: number; height: string; events?: { type: string; attributes: { key: string; value: string }[] }[] };
    };
    const transaction = body.tx_response;
    const hybrid = transaction?.events?.find((event) => event.type === "pqc_hybrid_verify")
      ?.attributes.find((attribute) => attribute.key === "status")?.value;
    record(`v3 native ${label} ${ref.hash}`, transaction?.code === 0,
      { height: transaction?.height, pqcHybridVerify: hybrid ?? "n/a" });
  }

  const expectedFailures: Record<string, string> = {
    ecdsaOnlyAuditorApproval: "InvalidPqSignature",
    redirectedPayoutToAuditor: "PayoutCommitmentMismatch",
    relayerCannotReleaseEscrow: "NotAuditor",
    prematureEscalation: "DeadlineNotMissed",
  };
  for (const [name, expectedFailure] of Object.entries(expectedFailures)) {
    record(`v3 negative test ${name}`, evidence.negativeTests[name] === expectedFailure, evidence.negativeTests[name]);
  }
  record("v3 negative test scopedWindowBlocksTokenCall",
    /does not admit this transaction/iu.test(evidence.negativeTests.scopedWindowBlocksTokenCall),
    evidence.negativeTests.scopedWindowBlocksTokenCall);

  const failed = checks.filter((check) => !check.ok);
  const latest = await client.getBlockNumber();
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify({
    verifiedAt: new Date().toISOString(),
    dianaBlock: latest.toString(),
    currentDeployment: { version: 3, registry, bountyToken: token },
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  }, null, 2)}\n`);
  console.log(`\n${checks.length - failed.length}/${checks.length} v3 checks passed at Diana block ${latest}. Report: ${REPORT_FILE}`);
  if (failed.length) process.exitCode = 1;
}

await main();
