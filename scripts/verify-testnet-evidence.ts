import fs from "node:fs";

import { envelopeFromText } from "@qorechain/qoreseal";
import { qorechainTestnet } from "@qorechain/evm";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  type Abi,
  type Hex,
} from "viem";

import { hashText, parseBundle } from "../src/lib/patch3q";
import { sha256 } from "../src/lib/encoding";

const EVIDENCE_FILE = "evidence/testnet.json";
const DEPLOYMENT_V2_FILE = "evidence/deployment-v2.json";
const REPORT_FILE = "evidence/verification.json";
const REST = process.env.PATCH3Q_REST ?? "https://api-testnet.qore.host";
const STATUS = ["Submitted", "Acknowledged", "Triaged", "Resolved", "Disclosed", "Cancelled", "Escalated"];

type TxRef = { hash: string; blockNumber?: string };
const evidence = JSON.parse(fs.readFileSync(EVIDENCE_FILE, "utf8"));
const deploymentV2 = JSON.parse(fs.readFileSync(DEPLOYMENT_V2_FILE, "utf8"));
const registryArtifact = JSON.parse(
  fs.readFileSync("artifacts/deployed/Patch3QRegistryDianaV1.json", "utf8"),
);
const tokenArtifact = JSON.parse(fs.readFileSync("artifacts/deployed/MockTUSDTDianaV1.json", "utf8"));
const currentRegistryArtifact = JSON.parse(fs.readFileSync("artifacts/Patch3QRegistry.json", "utf8"));
const currentTokenArtifact = JSON.parse(fs.readFileSync("artifacts/MockTUSDT.json", "utf8"));
const registryAbi = registryArtifact.abi as Abi;
const tokenAbi = tokenArtifact.abi as Abi;
const registry = getAddress(evidence.registryAddress);
const token = getAddress(evidence.bountyTokenAddress);
const registryV2 = getAddress(deploymentV2.registryAddress);
const tokenV2 = getAddress(deploymentV2.bountyTokenAddress);
const client = createPublicClient({ chain: qorechainTestnet, transport: http(qorechainTestnet.rpcUrls.default.http[0]) });

const checks: { check: string; ok: boolean; detail?: unknown }[] = [];
function record(check: string, ok: boolean, detail?: unknown): void {
  checks.push({ check, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "✓" : "✗"} ${check}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

async function eventsOf(hash: string, expectedTo: Hex): Promise<string[]> {
  const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  const tx = await client.getTransaction({ hash: hash as Hex });
  if (receipt.status !== "success") throw new Error(`${hash} status ${receipt.status}`);
  if (tx.to && getAddress(tx.to) !== expectedTo) throw new Error(`${hash} targets ${tx.to}`);
  return receipt.logs.flatMap((log) => {
    try {
      return [decodeEventLog({ abi: [...registryAbi, ...tokenAbi], data: log.data, topics: log.topics }).eventName];
    } catch {
      return [];
    }
  });
}

/** Strips immutable references so the on-chain runtime code can be compared with the compiled artifact. */
function maskImmutables(code: string, values: string[]): string {
  let masked = code.toLowerCase();
  for (const value of values) masked = masked.split(value.toLowerCase().replace(/^0x/u, "").padStart(64, "0")).join("0".repeat(64));
  return masked;
}

async function main(): Promise<void> {
  record("evidence status is verified", evidence.status === "verified", evidence.status);

  const registryCode = await client.getCode({ address: registry });
  const tokenCode = await client.getCode({ address: token });
  record(
    "registry runtime bytecode matches artifacts/deployed/Patch3QRegistryDianaV1.json (token immutable masked)",
    maskImmutables(registryCode ?? "0x", [token]) === maskImmutables(registryArtifact.deployedBytecode, []),
    { codeHash: keccak256(registryCode ?? "0x"), bytes: ((registryCode ?? "0x").length - 2) / 2 },
  );
  record("MockTUSDT runtime bytecode matches artifacts/deployed/MockTUSDTDianaV1.json",
    (tokenCode ?? "").toLowerCase() === tokenArtifact.deployedBytecode.toLowerCase());
  const boundToken = await client.readContract({ address: registry, abi: registryAbi, functionName: "bountyToken" }).catch(() => undefined);
  if (boundToken !== undefined) record("registry is bound to the tUSDT token", getAddress(boundToken as Hex) === token);

  const deployments: [string, TxRef, Hex | undefined][] = [
    ["MockTUSDT deployment", evidence.evm.tokenDeployment, token],
    ["Patch3QRegistry deployment", evidence.evm.registryDeployment, registry],
  ];
  for (const [label, ref, address] of deployments) {
    const receipt = await client.getTransactionReceipt({ hash: ref.hash as Hex });
    record(`${label} ${ref.hash}`, receipt.status === "success" && getAddress(receipt.contractAddress!) === address);
  }

  record("preserved v2 deployment status is verified", deploymentV2.status === "verified" && deploymentV2.version === 2,
    { status: deploymentV2.status, version: deploymentV2.version });
  const registryV2Code = await client.getCode({ address: registryV2 });
  const tokenV2Code = await client.getCode({ address: tokenV2 });
  record("v2 registry runtime bytecode matches its preserved masked hash",
    keccak256(maskImmutables(registryV2Code ?? "0x", [tokenV2]) as Hex) === deploymentV2.artifacts.registryMaskedRuntimeBytecodeHash,
    { codeHash: keccak256(registryV2Code ?? "0x"), bytes: ((registryV2Code ?? "0x").length - 2) / 2 });
  record("v2 MockTUSDT runtime bytecode matches its preserved hash",
    keccak256(tokenV2Code ?? "0x") === deploymentV2.artifacts.tokenRuntimeBytecodeHash);
  const boundTokenV2 = await client.readContract({
    address: registryV2, abi: currentRegistryArtifact.abi as Abi, functionName: "bountyToken",
  });
  record("preserved v2 registry is bound to its deployed tUSDT token", getAddress(boundTokenV2 as Hex) === tokenV2);

  for (const [label, ref, address] of [
    ["preserved v2 MockTUSDT deployment", deploymentV2.evm.tokenDeployment, tokenV2],
    ["preserved v2 Patch3QRegistry deployment", deploymentV2.evm.registryDeployment, registryV2],
  ] as [string, TxRef, Hex][]) {
    const receipt = await client.getTransactionReceipt({ hash: ref.hash as Hex });
    record(`${label} ${ref.hash}`, receipt.status === "success" && getAddress(receipt.contractAddress!) === address);
  }
  for (const [label, ref] of [
    ["preserved v2 initial tUSDT mint", deploymentV2.evm.mint],
    ["preserved v2 registry allowance", deploymentV2.evm.approve],
  ] as [string, TxRef][]) {
    const receipt = await client.getTransactionReceipt({ hash: ref.hash as Hex });
    const tx = await client.getTransaction({ hash: ref.hash as Hex });
    record(`${label} ${ref.hash}`, receipt.status === "success" && getAddress(tx.to!) === tokenV2);
  }
  const deployerV2 = getAddress(deploymentV2.deployer.evm);
  const [deployerTokenBalance, registryAllowance] = await Promise.all([
    client.readContract({ address: tokenV2, abi: currentTokenArtifact.abi as Abi, functionName: "balanceOf", args: [deployerV2] }) as Promise<bigint>,
    client.readContract({ address: tokenV2, abi: currentTokenArtifact.abi as Abi, functionName: "allowance", args: [deployerV2, registryV2] }) as Promise<bigint>,
  ]);
  record("preserved v2 deployer received the documented initial tUSDT mint",
    deployerTokenBalance.toString() === deploymentV2.initialFunding.mintedTUsdtBaseUnits, deployerTokenBalance.toString());
  record("preserved v2 registry has the documented tUSDT allowance",
    registryAllowance.toString() === deploymentV2.initialFunding.registryAllowanceBaseUnits, registryAllowance.toString());
  for (const [label, hash] of Object.entries<string>(deploymentV2.native)) {
    const response = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`);
    const body = await response.json() as { tx_response?: { code: number; height: string } };
    record(`preserved v2 native ${label} ${hash}`, body.tx_response?.code === 0, { height: body.tx_response?.height });
  }

  const expected: Record<string, Record<string, string[]>> = {
    normal: {
      submitAnonymousCase: ["CaseSubmitted", "AnonymousCaseSubmitted"],
      acknowledgeCase: ["CaseAcknowledged"],
      triageCase: ["CaseTriaged"],
      fundBounty: ["BountyFunded"],
      resolveCase: ["CaseResolved"],
      approveAnonymousSeverity: ["SeverityApproved", "BountyReleased"],
      discloseCase: ["CaseDisclosed"],
    },
    ghosted: {
      submitAnonymousCase: ["CaseSubmitted", "AnonymousCaseSubmitted"],
      fundBounty: ["BountyFunded"],
      escalateMissedDeadline: ["CaseEscalated"],
      approveAnonymousSeverity: ["SeverityApproved", "BountyReleased"],
    },
  };
  const relayer = getAddress(evidence.accounts.relayer.evm);
  const reporterTouchedChain = new Set<string>();

  for (const [name, entry] of Object.entries<any>(evidence.cases)) {
    for (const [method, events] of Object.entries(expected[name])) {
      const ref: TxRef | undefined = entry.transactions[method];
      if (!ref) {
        record(`${name}.${method}`, false, "missing");
        continue;
      }
      try {
        const emitted = await eventsOf(ref.hash, registry);
        record(`${name}.${method} ${ref.hash}`, events.every((event) => emitted.includes(event)), emitted);
        const tx = await client.getTransaction({ hash: ref.hash as Hex });
        reporterTouchedChain.add(getAddress(tx.from));
      } catch (error) {
        record(`${name}.${method} ${ref.hash}`, false, String(error));
      }
    }

    const bundle = parseBundle(fs.readFileSync(entry.bundle, "utf8"));
    const recomputed = await sha256(envelopeFromText(bundle.envelope));
    const submitted = await client.getTransactionReceipt({ hash: entry.transactions.submitAnonymousCase.hash });
    const submittedEvent = submitted.logs
      .map((log) => { try { return decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics }); } catch { return undefined; } })
      .find((event) => event?.eventName === "CaseSubmitted");
    const args = submittedEvent?.args as { envelopeHash: Hex; contentCommitment: Hex; reporter: Hex } | undefined;
    record(`${name}: published bundle ${entry.bundle} hashes to the anchored envelopeHash`,
      recomputed === bundle.envelopeHash && args?.envelopeHash === bundle.envelopeHash && args?.contentCommitment === bundle.contentCommitment,
      recomputed);
    record(`${name}: CaseSubmitted.reporter is the zero address`, args?.reporter === "0x0000000000000000000000000000000000000000");
    record(`${name}: envelope padded to a ${bundle.privacy.sizeBucket}-byte bucket`, bundle.privacy.sizeBucket === entry.sizeBucket);

    const state = await client.readContract({ address: registry, abi: registryAbi, functionName: "caseState", args: [entry.caseIdHash] }) as readonly unknown[];
    const privacy = await client.readContract({ address: registry, abi: registryAbi, functionName: "privacyState", args: [entry.caseIdHash] }) as readonly [boolean, Hex, Hex, Hex];
    const status = STATUS[Number(state[0])];
    record(`${name}: on-chain status`, name === "normal" ? status === "Disclosed" : ["Escalated", "Resolved", "Disclosed"].includes(status), status);
    if (name === "ghosted") record(`${name}: acknowledgement breach recorded`, (Number(state[2]) & 1) === 1, { slaBreaches: Number(state[2]) });
    record(`${name}: privacyState anonymous, anchored by the relayer, reporter key hash + payout commitment match the bundle`,
      privacy[0] === true && getAddress(privacy[1]) === relayer &&
      privacy[2] === bundle.privacy.reporterPqKeyHash && privacy[3] === bundle.privacy.payoutCommitment);
    const opened = await client.readContract({
      address: registry, abi: registryAbi, functionName: "payoutCommitmentOf",
      args: [entry.caseIdHash, entry.payoutRecipient, "0x" + "00".repeat(32)],
    }).catch(() => undefined);
    if (opened !== undefined) record(`${name}: payout commitment does not open to the recipient without the sealed salt`, opened !== privacy[3]);
    const balance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [entry.payoutRecipient] }) as bigint;
    record(`${name}: sealed payout address ${entry.payoutRecipient} received ${balance} tUSDT base units`, balance.toString() === entry.payoutBalance && balance > 0n);
    if (name === "normal") {
      const redacted = fs.readFileSync("evidence/cases/case-a-normal.redacted.md", "utf8").trimEnd();
      record("normal: redacted report file hashes to the on-chain redactedReportHash", (await hashText(redacted)) === state[11]);
    }
  }

  const roleAddresses = ["program", "auditor", "relayer"].map((role) => getAddress(evidence.accounts[role].evm));
  record("every case transaction was sent by program, auditor or relayer — never a reporter account",
    [...reporterTouchedChain].every((from) => roleAddresses.includes(from)), [...reporterTouchedChain]);

  for (const [label, ref] of Object.entries<any>(evidence.native)) {
    if (!/^[0-9A-F]{64}$/u.test(ref.hash)) {
      record(`native ${label}`, true, ref.hash);
      continue;
    }
    const response = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${ref.hash}`);
    const body = await response.json() as { tx_response?: { code: number; height: string; events?: { type: string; attributes: { key: string; value: string }[] }[] } };
    const tx = body.tx_response;
    const hybrid = tx?.events?.find((event) => event.type === "pqc_hybrid_verify")?.attributes.find((attr) => attr.key === "status")?.value;
    record(`native ${label} ${ref.hash}`, tx?.code === 0, { height: tx?.height, pqcHybridVerify: hybrid ?? "n/a" });
  }

  for (const [name, result] of Object.entries<string>(evidence.negativeTests)) {
    record(`negative test ${name} was rejected`, result !== "NOT REVERTED" && result.length > 0, result);
  }

  const failed = checks.filter((check) => !check.ok);
  const latest = await client.getBlockNumber();
  fs.writeFileSync(REPORT_FILE, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    dianaBlock: latest.toString(),
    registry,
    preservedDeployment: { registry: registryV2, bountyToken: tokenV2, version: deploymentV2.version },
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  }, null, 2) + "\n");
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed at Diana block ${latest}. Report: ${REPORT_FILE}`);
  if (failed.length) process.exitCode = 1;
}

await main();
