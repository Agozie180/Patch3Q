import {
  addressFromPublicKey,
  classicalKeyFromPrivate,
  parseAddress,
  pqKeyFromSeed,
  signMessage,
  verifyMessage,
} from "@qorechain/qoresign";
import { fetchPqKeyStatus, verifyMessageWithChain } from "@qorechain/qoresign/network";

import type {
  ApprovalAuthority,
  ApprovalVerificationResult,
  Patch3QApprovalVault,
  Patch3QBundle,
  Severity,
  SeverityApproval,
  SeverityApprovalStatement,
} from "../types.js";
import { fromBase64Url, randomBytes, sha256, toBase64Url, utf8 } from "./encoding.js";
import { PATCH3Q_REST_PROXY } from "./protocol.js";

const SEVERITIES = new Set<Severity>(["critical", "high", "medium", "low", "informational"]);

function approvalStatementText(statement: SeverityApprovalStatement): string {
  return JSON.stringify({
    type: statement.type,
    version: statement.version,
    caseId: statement.caseId,
    chainId: statement.chainId,
    envelopeHash: statement.envelopeHash,
    contentCommitment: statement.contentCommitment,
    severity: statement.severity,
    payout: {
      denom: statement.payout.denom,
      atomic: statement.payout.atomic,
    },
    rationale: statement.rationale,
    approvedAt: statement.approvedAt,
  });
}

function approvalHashInput(approval: Omit<SeverityApproval, "approvalHash">): Uint8Array {
  return utf8(JSON.stringify({
    type: approval.type,
    version: approval.version,
    statement: JSON.parse(approvalStatementText(approval.statement)) as SeverityApprovalStatement,
    signer: approval.signer,
    signature: approval.signature,
  }));
}

function approvalKeysFromVault(vault: Patch3QApprovalVault) {
  const classicalPrivateKey = fromBase64Url(vault.classicalPrivateKey);
  const pqSeed = fromBase64Url(vault.pqSeed);
  if (classicalPrivateKey.length !== 32 || pqSeed.length !== 32) {
    throw new Error("Approval vault key material must be 32 bytes.");
  }
  const classicalKey = classicalKeyFromPrivate(classicalPrivateKey, "eth_secp256k1");
  const pqKey = pqKeyFromSeed(pqSeed);
  const signer = addressFromPublicKey(classicalKey.publicKey, classicalKey.type);
  if (signer.bech32 !== vault.signer) throw new Error("Approval vault signer does not match its classical key.");
  return { classicalKey, pqKey, signer };
}

function freshClassicalPrivateKey(): Uint8Array {
  for (;;) {
    const candidate = randomBytes(32);
    try {
      classicalKeyFromPrivate(candidate, "eth_secp256k1");
      return candidate;
    } catch {
      // The chance of an invalid secp256k1 scalar is negligible; retry safely.
    }
  }
}

export async function createDemoApprovalAuthority(caseId: string): Promise<{
  authority: ApprovalAuthority;
  vault: Patch3QApprovalVault;
}> {
  const classicalPrivateKey = freshClassicalPrivateKey();
  const pqSeed = randomBytes(32);
  const classicalKey = classicalKeyFromPrivate(classicalPrivateKey, "eth_secp256k1");
  const pqKey = pqKeyFromSeed(pqSeed);
  const signer = addressFromPublicKey(classicalKey.publicKey, classicalKey.type);
  return {
    authority: {
      role: "auditor",
      signer: signer.bech32,
      evmAddress: signer.hex as `0x${string}`,
      keyFingerprint: (await sha256(pqKey.publicKey)).slice(0, 18),
      pqPublicKey: toBase64Url(pqKey.publicKey),
      source: "embedded-demo",
    },
    vault: {
      type: "patch3q.approval-key",
      version: 1,
      caseId,
      role: "auditor",
      signer: signer.bech32,
      classicalPrivateKey: toBase64Url(classicalPrivateKey),
      pqSeed: toBase64Url(pqSeed),
      warning: "DEMO SECRET — this key can issue bounty approvals for the case. Never publish it.",
    },
  };
}

export async function resolveApprovalAuthority(address: string): Promise<ApprovalAuthority> {
  const signer = parseAddress(address.trim());
  const status = await fetchPqKeyStatus({ rest: PATCH3Q_REST_PROXY, address: signer.bech32 });
  if (!status.registered || !status.publicKey) {
    throw new Error("The auditor has no registered ML-DSA-87 key on QoreChain testnet.");
  }
  return {
    role: "auditor",
    signer: signer.bech32,
    evmAddress: signer.hex as `0x${string}`,
    keyFingerprint: (await sha256(status.publicKey)).slice(0, 18),
    pqPublicKey: toBase64Url(status.publicKey),
    source: "qorechain-registry",
  };
}

export async function createSeverityApproval(options: {
  bundle: Patch3QBundle;
  vault: Patch3QApprovalVault;
  severity: Severity;
  payoutAtomic: string;
  rationale: string;
  now?: Date;
}): Promise<SeverityApproval> {
  const { bundle, vault } = options;
  const authority = bundle.approvalAuthority;
  if (!authority) throw new Error("This bundle does not bind an approval authority.");
  if (vault.caseId !== bundle.caseId) throw new Error("This approval vault belongs to a different case.");
  if (!SEVERITIES.has(options.severity)) throw new Error("Choose a supported severity.");
  if (!/^\d+$/u.test(options.payoutAtomic) || BigInt(options.payoutAtomic) <= 0n) {
    throw new Error("Payout must be a positive integer in test-fUSD atomic units.");
  }
  const rationale = options.rationale.trim();
  if (rationale.length < 12) throw new Error("Add a short severity rationale before approving payment.");

  const { classicalKey, pqKey, signer } = approvalKeysFromVault(vault);
  if (signer.bech32 !== authority.signer) throw new Error("The vault is not the auditor bound into this bundle.");
  if (authority.pqPublicKey && toBase64Url(pqKey.publicKey) !== authority.pqPublicKey) {
    throw new Error("The vault ML-DSA-87 key does not match the bundle authority.");
  }
  const statement: SeverityApprovalStatement = {
    type: "patch3q.severity-approval-statement",
    version: 1,
    caseId: bundle.caseId,
    chainId: bundle.chainId,
    envelopeHash: bundle.envelopeHash,
    contentCommitment: bundle.contentCommitment,
    severity: options.severity,
    payout: { denom: "test-fUSD", atomic: options.payoutAtomic },
    rationale,
    approvedAt: (options.now ?? new Date()).toISOString(),
  };
  const unsigned = {
    type: "patch3q.severity-approval" as const,
    version: 1 as const,
    statement,
    signer: signer.bech32,
    signature: signMessage({
      chainId: bundle.chainId,
      signer: signer.bech32,
      data: approvalStatementText(statement),
      classicalKey,
      pqKey,
    }),
  };
  return { ...unsigned, approvalHash: await sha256(approvalHashInput(unsigned)) };
}

export async function verifySeverityApproval(
  bundle: Patch3QBundle,
  approval: SeverityApproval,
): Promise<ApprovalVerificationResult> {
  const authority = bundle.approvalAuthority;
  const checks = {
    caseBinding: approval.statement.caseId === bundle.caseId && approval.statement.chainId === bundle.chainId,
    evidenceBinding:
      approval.statement.envelopeHash === bundle.envelopeHash &&
      approval.statement.contentCommitment === bundle.contentCommitment,
    authorityBinding: Boolean(authority && approval.signer === authority.signer),
    approvalHash: false,
    hybridSignature: false,
  };
  const unsigned = {
    type: approval.type,
    version: approval.version,
    statement: approval.statement,
    signer: approval.signer,
    signature: approval.signature,
  };
  checks.approvalHash = (await sha256(approvalHashInput(unsigned))) === approval.approvalHash;

  if (authority && checks.authorityBinding) {
    try {
      if (authority.source === "qorechain-registry") {
        await verifyMessageWithChain({
          rest: PATCH3Q_REST_PROXY,
          chainId: bundle.chainId,
          signer: approval.signer,
          data: approvalStatementText(approval.statement),
          signature: approval.signature,
          requirePq: true,
        });
      } else {
        if (!authority.pqPublicKey) throw new Error("Demo authority is missing its ML-DSA-87 public key.");
        verifyMessage({
          chainId: bundle.chainId,
          signer: approval.signer,
          data: approvalStatementText(approval.statement),
          signature: approval.signature,
          pqPublicKey: fromBase64Url(authority.pqPublicKey),
          requirePq: true,
        });
      }
      checks.hybridSignature = true;
    } catch {
      checks.hybridSignature = false;
    }
  }
  return { checks, verified: Object.values(checks).every(Boolean) };
}

export function parseApprovalVault(value: string): Patch3QApprovalVault {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Approval vault must be a JSON object.");
  const candidate = parsed as Partial<Patch3QApprovalVault>;
  if (
    candidate.type !== "patch3q.approval-key" ||
    candidate.version !== 1 ||
    !candidate.caseId ||
    !candidate.signer ||
    !candidate.classicalPrivateKey ||
    !candidate.pqSeed
  ) {
    throw new Error("Unsupported or incomplete Patch3Q approval vault.");
  }
  return candidate as Patch3QApprovalVault;
}

export function parseSeverityApproval(value: string): SeverityApproval {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Approval must be a JSON object.");
  const candidate = parsed as Partial<SeverityApproval>;
  if (
    candidate.type !== "patch3q.severity-approval" ||
    candidate.version !== 1 ||
    !candidate.statement ||
    !candidate.signer ||
    !candidate.signature ||
    !candidate.approvalHash
  ) {
    throw new Error("Unsupported or incomplete Patch3Q severity approval.");
  }
  return candidate as SeverityApproval;
}

export async function demonstrateClassicalOnlyForgeryRejection(
  bundle: Patch3QBundle,
  approval: SeverityApproval,
  vault: Patch3QApprovalVault,
): Promise<boolean> {
  const authority = bundle.approvalAuthority;
  if (!authority?.pqPublicKey) throw new Error("The demo needs an embedded auditor ML-DSA-87 public key.");
  const { classicalKey, signer } = approvalKeysFromVault(vault);
  const forgedSignature = signMessage({
    chainId: bundle.chainId,
    signer: signer.bech32,
    data: approvalStatementText(approval.statement),
    classicalKey,
  });
  try {
    verifyMessage({
      chainId: bundle.chainId,
      signer: signer.bech32,
      data: approvalStatementText(approval.statement),
      signature: forgedSignature,
      pqPublicKey: fromBase64Url(authority.pqPublicKey),
      requirePq: true,
    });
    return false;
  } catch {
    return true;
  }
}

export function approvalVaultToJson(vault: Patch3QApprovalVault): string {
  return JSON.stringify(vault, null, 2);
}

export function approvalToJson(approval: SeverityApproval): string {
  return JSON.stringify(approval, null, 2);
}
