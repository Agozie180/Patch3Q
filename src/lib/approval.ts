import {
  addressFromPublicKey,
  classicalKeyFromPrivate,
  parseAddress,
  pqKeyFromSeed,
  signMessage,
  verifyMessage,
} from "@qorechain/qoresign";
import { fetchPqKeyStatus, verifyMessageWithChain } from "@qorechain/qoresign/network";
import { encodeAbiParameters, hexToBytes, isAddress, keccak256, toBytes, zeroAddress } from "viem";

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
const EVM_CHAIN_ID = 9800 as const;
const APPROVAL_TYPEHASH = keccak256(toBytes(
  "Patch3QSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash)",
));
const SEVERITY_CODES: Record<Severity, number> = {
  informational: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

async function severityApprovalDigest(
  bundle: Patch3QBundle,
  registryAddress: `0x${string}`,
  severity: Severity,
  payoutAtomic: string,
  rationaleHash: `0x${string}`,
): Promise<`0x${string}`> {
  const caseIdHash = await sha256(utf8(bundle.caseId));
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      APPROVAL_TYPEHASH,
      BigInt(EVM_CHAIN_ID),
      registryAddress,
      caseIdHash,
      bundle.envelopeHash,
      bundle.contentCommitment,
      SEVERITY_CODES[severity],
      BigInt(payoutAtomic),
      rationaleHash,
    ],
  ));
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

export async function createDemoApprovalAuthority(
  caseId: string,
  role: ApprovalAuthority["role"],
): Promise<{
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
      role,
      signer: signer.bech32,
      evmAddress: signer.hex as `0x${string}`,
      keyFingerprint: await sha256(pqKey.publicKey),
      pqPublicKey: toBase64Url(pqKey.publicKey),
      source: "embedded-demo",
    },
    vault: {
      type: "patch3q.approval-key",
      version: 1,
      caseId,
      role,
      signer: signer.bech32,
      classicalPrivateKey: toBase64Url(classicalPrivateKey),
      pqSeed: toBase64Url(pqSeed),
      warning: "DEMO SECRET — this key can issue bounty approvals for the case. Never publish it.",
    },
  };
}

export async function resolveApprovalAuthority(
  address: string,
  role: ApprovalAuthority["role"],
): Promise<ApprovalAuthority> {
  const signer = parseAddress(address.trim());
  const status = await fetchPqKeyStatus({ rest: PATCH3Q_REST_PROXY, address: signer.bech32 });
  if (!status.registered || !status.publicKey) {
    throw new Error(`The ${role} has no registered ML-DSA-87 key on QoreChain testnet.`);
  }
  return {
    role,
    signer: signer.bech32,
    evmAddress: signer.hex as `0x${string}`,
    keyFingerprint: await sha256(status.publicKey),
    pqPublicKey: toBase64Url(status.publicKey),
    source: "qorechain-registry",
  };
}

export async function createSeverityApproval(options: {
  bundle: Patch3QBundle;
  vaults: { program: Patch3QApprovalVault; auditor: Patch3QApprovalVault };
  registryAddress: `0x${string}`;
  severity: Severity;
  payoutAtomic: string;
  rationale: string;
  now?: Date;
}): Promise<SeverityApproval> {
  const { bundle, vaults } = options;
  const authorities = bundle.approvalAuthorities;
  if (!authorities) throw new Error("This bundle does not bind both approval authorities.");
  if (vaults.program.caseId !== bundle.caseId || vaults.auditor.caseId !== bundle.caseId) {
    throw new Error("An approval vault belongs to a different case.");
  }
  if (vaults.program.role !== "program" || vaults.auditor.role !== "auditor") {
    throw new Error("Load one program vault and one auditor vault.");
  }
  if (!SEVERITIES.has(options.severity)) throw new Error("Choose a supported severity.");
  if (!isAddress(options.registryAddress) || options.registryAddress === zeroAddress) {
    throw new Error("Configure the deployed Patch3Q registry before signing an approval.");
  }
  if (!/^\d+$/u.test(options.payoutAtomic) || BigInt(options.payoutAtomic) <= 0n) {
    throw new Error("Payout must be a positive integer in tUSDT atomic units.");
  }
  const rationale = options.rationale.trim();
  if (rationale.length < 12) throw new Error("Add a short severity rationale before approving payment.");

  const programKeys = approvalKeysFromVault(vaults.program);
  const auditorKeys = approvalKeysFromVault(vaults.auditor);
  for (const [role, keys] of [["program", programKeys], ["auditor", auditorKeys]] as const) {
    const authority = authorities[role];
    if (keys.signer.bech32 !== authority.signer) {
      throw new Error(`The ${role} vault is not the authority bound into this bundle.`);
    }
    if (authority.pqPublicKey && toBase64Url(keys.pqKey.publicKey) !== authority.pqPublicKey) {
      throw new Error(`The ${role} ML-DSA-87 key does not match the bundle authority.`);
    }
  }
  const rationaleHash = keccak256(toBytes(rationale));
  const approvalHash = await severityApprovalDigest(
    bundle,
    options.registryAddress,
    options.severity,
    options.payoutAtomic,
    rationaleHash,
  );
  const statement: SeverityApprovalStatement = {
    type: "patch3q.severity-approval-statement",
    version: 1,
    caseId: bundle.caseId,
    chainId: bundle.chainId,
    evmChainId: EVM_CHAIN_ID,
    registryAddress: options.registryAddress,
    envelopeHash: bundle.envelopeHash,
    contentCommitment: bundle.contentCommitment,
    severity: options.severity,
    payout: { denom: "tUSDT", atomic: options.payoutAtomic },
    rationale,
    rationaleHash,
  };
  const unsigned = {
    type: "patch3q.severity-approval" as const,
    version: 2 as const,
    statement,
    signers: {
      program: programKeys.signer.bech32,
      auditor: auditorKeys.signer.bech32,
    },
    signatures: {
      program: signMessage({
        chainId: bundle.chainId,
        signer: programKeys.signer.bech32,
        data: hexToBytes(approvalHash),
        classicalKey: programKeys.classicalKey,
        pqKey: programKeys.pqKey,
      }),
      auditor: signMessage({
        chainId: bundle.chainId,
        signer: auditorKeys.signer.bech32,
        data: hexToBytes(approvalHash),
        classicalKey: auditorKeys.classicalKey,
        pqKey: auditorKeys.pqKey,
      }),
    },
  };
  return { ...unsigned, approvalHash };
}

export async function verifySeverityApproval(
  bundle: Patch3QBundle,
  approval: SeverityApproval,
  expectedRegistryAddress?: `0x${string}`,
): Promise<ApprovalVerificationResult> {
  const authorities = bundle.approvalAuthorities;
  const checks = {
    statementShape:
      approval.statement.type === "patch3q.severity-approval-statement" &&
      approval.statement.version === 1 && approval.statement.payout.denom === "tUSDT" &&
      /^\d+$/u.test(approval.statement.payout.atomic) && BigInt(approval.statement.payout.atomic) > 0n,
    caseBinding: approval.statement.caseId === bundle.caseId && approval.statement.chainId === bundle.chainId,
    evidenceBinding:
      approval.statement.envelopeHash === bundle.envelopeHash &&
      approval.statement.contentCommitment === bundle.contentCommitment,
    programAuthorityBinding: Boolean(
      authorities && approval.signers.program === authorities.program.signer,
    ),
    auditorAuthorityBinding: Boolean(
      authorities && approval.signers.auditor === authorities.auditor.signer,
    ),
    programKeyBinding: false,
    auditorKeyBinding: false,
    registryBinding:
      approval.statement.evmChainId === EVM_CHAIN_ID &&
      isAddress(approval.statement.registryAddress) &&
      approval.statement.registryAddress !== zeroAddress &&
      (!expectedRegistryAddress ||
        approval.statement.registryAddress.toLowerCase() === expectedRegistryAddress.toLowerCase()),
    rationaleBinding: keccak256(toBytes(approval.statement.rationale)) === approval.statement.rationaleHash,
    approvalHash: false,
    programHybridSignature: false,
    auditorHybridSignature: false,
  };
  let expectedDigest = approval.approvalHash;
  if (
    checks.statementShape && checks.caseBinding && checks.evidenceBinding && checks.registryBinding && checks.rationaleBinding &&
    SEVERITIES.has(approval.statement.severity) && /^\d+$/u.test(approval.statement.payout.atomic)
  ) {
    expectedDigest = await severityApprovalDigest(
      bundle,
      approval.statement.registryAddress,
      approval.statement.severity,
      approval.statement.payout.atomic,
      approval.statement.rationaleHash,
    );
    checks.approvalHash = expectedDigest === approval.approvalHash;
  }

  async function verifyAuthority(role: "program" | "auditor"): Promise<{
    keyBinding: boolean;
    hybridSignature: boolean;
  }> {
    const authority = authorities?.[role];
    const signer = approval.signers[role];
    const signature = approval.signatures[role];
    if (!authority || signer !== authority.signer) return { keyBinding: false, hybridSignature: false };
    try {
      if (authority.source === "qorechain-registry") {
        const current = await fetchPqKeyStatus({ rest: PATCH3Q_REST_PROXY, address: authority.signer });
        const keyBinding = Boolean(
          current.registered && current.publicKey &&
          (await sha256(current.publicKey)) === authority.keyFingerprint,
        );
        if (!keyBinding) return { keyBinding: false, hybridSignature: false };
        await verifyMessageWithChain({
          rest: PATCH3Q_REST_PROXY,
          chainId: bundle.chainId,
          signer,
          data: hexToBytes(expectedDigest),
          signature,
          requirePq: true,
        });
        return { keyBinding: true, hybridSignature: true };
      }
      if (!authority.pqPublicKey) return { keyBinding: false, hybridSignature: false };
      const pqPublicKey = fromBase64Url(authority.pqPublicKey);
      const keyBinding = (await sha256(pqPublicKey)) === authority.keyFingerprint;
      if (!keyBinding) return { keyBinding: false, hybridSignature: false };
      verifyMessage({
        chainId: bundle.chainId,
        signer,
        data: hexToBytes(expectedDigest),
        signature,
        pqPublicKey,
        requirePq: true,
      });
      return { keyBinding: true, hybridSignature: true };
    } catch {
      return { keyBinding: false, hybridSignature: false };
    }
  }

  const [programResult, auditorResult] = await Promise.all([
    verifyAuthority("program"),
    verifyAuthority("auditor"),
  ]);
  checks.programKeyBinding = programResult.keyBinding;
  checks.programHybridSignature = programResult.hybridSignature;
  checks.auditorKeyBinding = auditorResult.keyBinding;
  checks.auditorHybridSignature = auditorResult.hybridSignature;
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
    (candidate.role !== "program" && candidate.role !== "auditor") ||
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
    candidate.version !== 2 ||
    !candidate.statement ||
    !candidate.signers?.program ||
    !candidate.signers?.auditor ||
    !candidate.signatures?.program ||
    !candidate.signatures?.auditor ||
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
  const authority = bundle.approvalAuthorities?.[vault.role];
  if (!authority?.pqPublicKey) throw new Error(`The demo needs an embedded ${vault.role} ML-DSA-87 public key.`);
  const { classicalKey, signer } = approvalKeysFromVault(vault);
  const forgedSignature = signMessage({
    chainId: bundle.chainId,
    signer: signer.bech32,
    data: hexToBytes(approval.approvalHash),
    classicalKey,
  });
  try {
    verifyMessage({
      chainId: bundle.chainId,
      signer: signer.bech32,
      data: hexToBytes(approval.approvalHash),
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
