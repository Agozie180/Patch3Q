import {
  addressFromPublicKey,
  classicalKeyFromPrivate,
  pqKeyFromSeed,
  signMessage,
  verifyMessage,
} from "@qorechain/qoresign";
import { fetchPqKeyStatus, verifyMessageWithChain } from "@qorechain/qoresign/network";
import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  keccak256,
  toBytes,
  zeroAddress,
} from "viem";

import type {
  ApprovalAuthority,
  Patch3QApprovalVault,
  Patch3QBundle,
  SealedPayout,
  Severity,
  V4ApprovalVerificationResult,
  V4SeverityApproval,
  V4SeverityApprovalStatement,
} from "../types.js";
import type { ApprovalSignerKeys } from "./approval.js";
import { fromBase64Url, sha256, toBase64Url, utf8 } from "./encoding.js";
import { bundleToJson } from "./patch3q.js";
import { payoutCommitment, saltedRationaleHash } from "./privacy.js";
import { PATCH3Q_REST_PROXY } from "./protocol.js";
import { v4BundleBytes } from "./v4-bundle.js";

const EVM_CHAIN_ID = 9800 as const;
const V4_APPROVAL_TYPEHASH = keccak256(toBytes(
  "Patch3QV4Approval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,bytes32 bundleHash,bytes32 auditorSetHash,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash,address payoutRecipient)",
));
const SEVERITY_CODES: Record<Severity, number> = {
  informational: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

type SignerInput = Patch3QApprovalVault | ApprovalSignerKeys;

export function keysFrom(input: SignerInput) {
  const classicalPrivateKey = "pqSeed" in input ? fromBase64Url(input.classicalPrivateKey) : input.classicalPrivateKey;
  const pqKey = "pqSeed" in input ? pqKeyFromSeed(fromBase64Url(input.pqSeed)) : input.pqKey;
  const classicalKey = classicalKeyFromPrivate(classicalPrivateKey, "eth_secp256k1");
  const signer = addressFromPublicKey(classicalKey.publicKey, classicalKey.type);
  if ("signer" in input && signer.bech32 !== input.signer) throw new Error("Approval vault signer does not match its classical key.");
  return { classicalKey, pqKey, signer };
}

export function bundleAuditors(bundle: Patch3QBundle): ApprovalAuthority[] {
  const authorities = bundle.approvalAuthorities;
  if (!authorities) return [];
  return authorities.auditors?.length ? authorities.auditors : [authorities.auditor];
}

export function bundleAuditorThreshold(bundle: Patch3QBundle): number {
  return bundle.approvalAuthorities?.auditorThreshold ?? 1;
}

export function v4ParticipantRole(status: number | undefined, localRole: "reporter" | "program"): "reporter" | "program" {
  return status === undefined ? localRole : status === 5 ? "reporter" : "program";
}

export function v4CaseStatus(status: number): string {
  return ["Submitted", "Acknowledged", "Triaged", "Resolved", "Disclosed", "Escalated"][status] ?? `Status ${status}`;
}

export function v4AuditorSetHash(bundle: Patch3QBundle): `0x${string}` {
  const auditors = bundleAuditors(bundle);
  const threshold = bundleAuditorThreshold(bundle);
  if (auditors.length === 0 || threshold < 1 || threshold > auditors.length) throw new Error("Bundle has an invalid auditor quorum.");
  return keccak256(encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint8" }],
    [auditors.map((entry) => entry.evmAddress), threshold],
  ));
}

export async function v4BundleHash(bundle: Patch3QBundle): Promise<`0x${string}`> {
  return sha256(await v4BundleBytes(bundle));
}

async function v4ApprovalDigest(
  bundle: Patch3QBundle,
  registryAddress: `0x${string}`,
  bundleHash: `0x${string}`,
  auditorSetHash: `0x${string}`,
  severity: Severity,
  payoutAtomic: string,
  rationaleHash: `0x${string}`,
  payoutRecipient: `0x${string}`,
): Promise<`0x${string}`> {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint8" }, { type: "uint256" }, { type: "bytes32" }, { type: "address" },
    ],
    [
      V4_APPROVAL_TYPEHASH, BigInt(EVM_CHAIN_ID), registryAddress, await sha256(utf8(bundle.caseId)),
      bundle.envelopeHash, bundle.contentCommitment, bundleHash, auditorSetHash,
      SEVERITY_CODES[severity], BigInt(payoutAtomic), rationaleHash, payoutRecipient,
    ],
  ));
}

function validatePayout(bundle: Patch3QBundle, payout?: SealedPayout): SealedPayout {
  if (bundle.privacy.reporterMode !== "anonymous") throw new Error("V4 accepts anonymous, commitment-bound cases only.");
  if (!payout || !isAddress(payout.recipient, { strict: false })) throw new Error("Decrypt the report to load its sealed payout instruction.");
  const normalized = { recipient: getAddress(payout.recipient.toLowerCase()), salt: payout.salt } as SealedPayout;
  return normalized;
}

export async function createV4QuorumApproval(options: {
  bundle: Patch3QBundle;
  participantRole: "reporter" | "program";
  participant: SignerInput;
  auditors: SignerInput[];
  registryAddress: `0x${string}`;
  severity: Severity;
  payoutAtomic: string;
  rationale: string;
  payout: SealedPayout;
}): Promise<V4SeverityApproval> {
  const { bundle } = options;
  const authorities = bundle.approvalAuthorities;
  if (!authorities) throw new Error("This bundle does not bind approval authorities.");
  if (!isAddress(options.registryAddress) || options.registryAddress === zeroAddress) throw new Error("Configure a V4 registry address.");
  if (!/^\d+$/u.test(options.payoutAtomic) || BigInt(options.payoutAtomic) <= 0n) throw new Error("Payout must be positive atomic units.");
  const rationale = options.rationale.trim();
  if (rationale.length < 12) throw new Error("Add a short severity rationale.");
  const payout = validatePayout(bundle, options.payout);
  if (payoutCommitment(await sha256(utf8(bundle.caseId)), payout) !== bundle.privacy.payoutCommitment) {
    throw new Error("The payout instruction does not open the reporter commitment.");
  }

  const participant = keysFrom(options.participant);
  const expectedParticipant = authorities[options.participantRole];
  if (participant.signer.bech32 !== expectedParticipant.signer ||
      (expectedParticipant.pqPublicKey && toBase64Url(participant.pqKey.publicKey) !== expectedParticipant.pqPublicKey)) {
    throw new Error(`The ${options.participantRole} key is not bound into this bundle.`);
  }
  const expectedAuditors = bundleAuditors(bundle);
  const auditorKeys = options.auditors.map(keysFrom);
  const unique = new Set(auditorKeys.map((entry) => entry.signer.bech32));
  if (unique.size !== auditorKeys.length) throw new Error("Duplicate auditor signatures do not count toward quorum.");
  if (auditorKeys.length < bundleAuditorThreshold(bundle)) throw new Error("Not enough auditor keys to meet the bound quorum.");
  for (const keys of auditorKeys) {
    const authority = expectedAuditors.find((entry) => entry.signer === keys.signer.bech32);
    if (!authority || (authority.pqPublicKey && toBase64Url(keys.pqKey.publicKey) !== authority.pqPublicKey)) {
      throw new Error("An auditor key is not in the bundle's bound auditor set.");
    }
  }

  const rationaleSalt = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
  const rationaleHash = saltedRationaleHash(rationaleSalt, rationale);
  const bundleHash = await v4BundleHash(bundle);
  const auditorSetHash = v4AuditorSetHash(bundle);
  const approvalHash = await v4ApprovalDigest(
    bundle, options.registryAddress, bundleHash, auditorSetHash, options.severity,
    options.payoutAtomic, rationaleHash, payout.recipient,
  );
  const sign = (keys: ReturnType<typeof keysFrom>) => signMessage({
    chainId: bundle.chainId,
    signer: keys.signer.bech32,
    data: hexToBytes(approvalHash),
    classicalKey: keys.classicalKey,
    pqKey: keys.pqKey,
  });
  const statement: V4SeverityApprovalStatement = {
    type: "patch3q.v4-severity-approval-statement",
    version: 1,
    caseId: bundle.caseId,
    chainId: bundle.chainId,
    evmChainId: EVM_CHAIN_ID,
    registryAddress: options.registryAddress,
    envelopeHash: bundle.envelopeHash,
    contentCommitment: bundle.contentCommitment,
    bundleHash,
    auditorSetHash,
    auditorThreshold: bundleAuditorThreshold(bundle),
    severity: options.severity,
    payout: { denom: "tUSDT", atomic: options.payoutAtomic, recipient: payout.recipient, commitmentSalt: payout.salt },
    rationale,
    rationaleSalt,
    rationaleHash,
  };
  return {
    type: "patch3q.v4-severity-approval",
    version: 1,
    statement,
    participantRole: options.participantRole,
    participant: { signer: participant.signer.bech32, signature: sign(participant) },
    auditors: auditorKeys.map((keys) => ({ signer: keys.signer.bech32, evmAddress: keys.signer.hex as `0x${string}`, signature: sign(keys) })),
    approvalHash,
  };
}

export async function verifyAuthority(
  bundle: Patch3QBundle,
  authority: ApprovalAuthority | undefined,
  signer: string,
  signature: V4SeverityApproval["participant"]["signature"],
  digest: `0x${string}`,
  rest: string,
): Promise<{ key: boolean; signature: boolean }> {
  if (!authority || signer !== authority.signer) return { key: false, signature: false };
  try {
    if (authority.source === "qorechain-registry") {
      const current = await fetchPqKeyStatus({ rest, address: signer });
      const key = Boolean(current.registered && current.publicKey && await sha256(current.publicKey) === authority.keyFingerprint);
      if (!key) return { key: false, signature: false };
      await verifyMessageWithChain({ rest, chainId: bundle.chainId, signer, data: hexToBytes(digest), signature, requirePq: true });
      return { key: true, signature: true };
    }
    if (!authority.pqPublicKey) return { key: false, signature: false };
    const publicKey = fromBase64Url(authority.pqPublicKey);
    const key = await sha256(publicKey) === authority.keyFingerprint;
    if (!key) return { key: false, signature: false };
    verifyMessage({ chainId: bundle.chainId, signer, data: hexToBytes(digest), signature, pqPublicKey: publicKey, requirePq: true });
    return { key: true, signature: true };
  } catch {
    return { key: false, signature: false };
  }
}

export async function verifyV4QuorumApproval(
  bundle: Patch3QBundle,
  approval: V4SeverityApproval,
  expectedRegistry?: `0x${string}`,
  expectedParticipantRole?: "reporter" | "program",
  rest: string = PATCH3Q_REST_PROXY,
): Promise<V4ApprovalVerificationResult> {
  const authorities = bundle.approvalAuthorities;
  const payout = approval.statement.payout;
  const checks = {
    statementShape: approval.type === "patch3q.v4-severity-approval" && approval.version === 1 && approval.statement.version === 1 && /^\d+$/u.test(payout.atomic) && BigInt(payout.atomic) > 0n,
    caseBinding: approval.statement.caseId === bundle.caseId && approval.statement.chainId === bundle.chainId,
    evidenceBinding: approval.statement.envelopeHash === bundle.envelopeHash && approval.statement.contentCommitment === bundle.contentCommitment && approval.statement.bundleHash === await v4BundleHash(bundle),
    registryBinding: approval.statement.evmChainId === EVM_CHAIN_ID && isAddress(approval.statement.registryAddress) && approval.statement.registryAddress !== zeroAddress && (!expectedRegistry || approval.statement.registryAddress.toLowerCase() === expectedRegistry.toLowerCase()),
    participantBinding: Boolean(authorities && approval.participant.signer === authorities[approval.participantRole]?.signer && (!expectedParticipantRole || approval.participantRole === expectedParticipantRole)),
    participantKeyBinding: false,
    participantHybridSignature: false,
    auditorSetBinding: approval.statement.auditorSetHash === v4AuditorSetHash(bundle) && approval.statement.auditorThreshold === bundleAuditorThreshold(bundle),
    auditorUniqueness: new Set(approval.auditors.map((entry) => entry.signer)).size === approval.auditors.length,
    auditorQuorum: approval.auditors.length >= bundleAuditorThreshold(bundle),
    auditorKeyBindings: false,
    auditorHybridSignatures: false,
    rationaleBinding: /^0x[0-9a-f]{64}$/u.test(approval.statement.rationaleSalt) && saltedRationaleHash(approval.statement.rationaleSalt, approval.statement.rationale) === approval.statement.rationaleHash,
    payoutBinding: Boolean(payout.recipient && payout.commitmentSalt && payoutCommitment(await sha256(utf8(bundle.caseId)), { recipient: payout.recipient, salt: payout.commitmentSalt }) === bundle.privacy.payoutCommitment),
    approvalHash: false,
  };
  let digest = approval.approvalHash;
  if (payout.recipient && SEVERITY_CODES[approval.statement.severity]) {
    digest = await v4ApprovalDigest(bundle, approval.statement.registryAddress, approval.statement.bundleHash, approval.statement.auditorSetHash, approval.statement.severity, payout.atomic, approval.statement.rationaleHash, payout.recipient);
    checks.approvalHash = digest === approval.approvalHash;
  }
  const participantResult = await verifyAuthority(bundle, authorities?.[approval.participantRole], approval.participant.signer, approval.participant.signature, digest, rest);
  checks.participantKeyBinding = participantResult.key;
  checks.participantHybridSignature = participantResult.signature;
  const expectedAuditors = bundleAuditors(bundle);
  const auditorResults = await Promise.all(approval.auditors.map((entry) => verifyAuthority(
    bundle, expectedAuditors.find((authority) => authority.signer === entry.signer), entry.signer, entry.signature, digest, rest,
  )));
  checks.auditorKeyBindings = auditorResults.every((entry) => entry.key);
  checks.auditorHybridSignatures = auditorResults.every((entry) => entry.signature);
  return { checks, verified: Object.values(checks).every(Boolean) };
}

export function v4ApprovalToJson(approval: V4SeverityApproval): string {
  return JSON.stringify(approval, null, 2);
}

export function parseV4SeverityApproval(value: string): V4SeverityApproval {
  const candidate = JSON.parse(value) as Partial<V4SeverityApproval>;
  if (candidate.type !== "patch3q.v4-severity-approval" || candidate.version !== 1 || !candidate.statement || !candidate.participant || !candidate.auditors?.length || !candidate.approvalHash) {
    throw new Error("Unsupported or incomplete V4 quorum approval.");
  }
  return candidate as V4SeverityApproval;
}
