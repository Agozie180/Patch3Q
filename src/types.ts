import type { MessageSignature } from "@qorechain/qoresign";

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export interface ReportDraft {
  title: string;
  program: string;
  asset: string;
  severity: Severity;
  reporterAlias: string;
  summary: string;
  impact: string;
  reproduction: string;
  remediation: string;
  embargoUntil: string;
}

export interface ReportAttachment {
  name: string;
  mediaType: string;
  size: number;
  sha256: `0x${string}`;
  data: string;
}

export interface SealedPayout {
  recipient: `0x${string}`;
  salt: `0x${string}`;
}

export interface ConfidentialReport {
  type: "patch3q.report";
  version: 1;
  caseId: string;
  createdAt: string;
  salt: string;
  report: ReportDraft;
  attachment?: ReportAttachment;
  /** Anonymous cases only: the payout address, readable solely by the recipients. */
  payout?: SealedPayout;
  /** Filler that rounds the plaintext up to a fixed size bucket. */
  padding?: string;
}

export type ReporterMode = "account" | "anonymous";

export interface PrivacyProfile {
  reporterMode: ReporterMode;
  /** keccak256 of the per-case ML-DSA-87 public key, anchored instead of a reporter account. */
  reporterPqKeyHash?: `0x${string}`;
  /** Commitment to the sealed payout address; opened only when the bounty is released. */
  payoutCommitment?: `0x${string}`;
  /** Every plaintext is padded to one of a few fixed sizes so ciphertext length reveals little. */
  sizeBucket: number;
}

export interface PublicMetadata {
  acknowledgeBy: string;
  triageBy: string;
  embargoUntil: string;
}

export interface ApprovalAuthority {
  role: "reporter" | "program" | "auditor";
  signer: string;
  evmAddress: `0x${string}`;
  keyFingerprint: string;
  pqPublicKey?: string;
  source: "embedded-demo" | "per-case" | "qorechain-registry";
}

export interface BundleRecipient {
  role: "maintainer" | "auditor";
  label: string;
  address?: string;
  keyFingerprint?: string;
}

export interface Patch3QBundle {
  type: "patch3q.bundle";
  version: 5;
  caseId: string;
  chainId: "qorechain-diana";
  purpose: "patch3q:vulnerability-report:v1";
  aad: string;
  envelope: string;
  envelopeHash: `0x${string}`;
  contentCommitment: `0x${string}`;
  createdAt: string;
  mode: "demo" | "testnet";
  sealMode: "hybrid" | "mlkem";
  anonymous: boolean;
  recipients: BundleRecipient[];
  publicMetadata: PublicMetadata;
  privacy: PrivacyProfile;
  approvalAuthorities?: {
    reporter: ApprovalAuthority;
    program: ApprovalAuthority;
    auditor: ApprovalAuthority;
    /** Full ordered auditor set for V4. `auditor` remains the V3-compatible primary. */
    auditors?: ApprovalAuthority[];
    auditorThreshold?: number;
  };
}

export interface Patch3QKeyVault {
  type: "patch3q.demo-key";
  version: 1;
  caseId: string;
  role: "maintainer" | "auditor";
  label: string;
  seed: string;
  warning: string;
}

export interface Patch3QApprovalVault {
  type: "patch3q.approval-key";
  version: 1;
  caseId: string;
  role: "reporter" | "program" | "auditor";
  signer: string;
  classicalPrivateKey: string;
  pqSeed: string;
  warning: string;
}

export interface SeverityApprovalStatement {
  type: "patch3q.severity-approval-statement";
  version: 2;
  caseId: string;
  chainId: "qorechain-diana";
  evmChainId: 9800;
  registryAddress: `0x${string}`;
  envelopeHash: `0x${string}`;
  contentCommitment: `0x${string}`;
  severity: Severity;
  payout: {
    denom: "tUSDT";
    atomic: string;
    /** Anonymous cases: the sealed payout address and the salt that opens its on-chain commitment. */
    recipient?: `0x${string}`;
    commitmentSalt?: `0x${string}`;
  };
  rationale: string;
  /** Random salt so a short rationale cannot be guessed from its public hash. */
  rationaleSalt: `0x${string}`;
  rationaleHash: `0x${string}`;
}

export interface SeverityApproval {
  type: "patch3q.severity-approval";
  version: 4;
  statement: SeverityApprovalStatement;
  participantRole: "reporter" | "program";
  signers: {
    participant: string;
    auditor: string;
  };
  signatures: {
    participant: MessageSignature;
    auditor: MessageSignature;
  };
  approvalHash: `0x${string}`;
}

export interface V4SeverityApprovalStatement extends Omit<SeverityApprovalStatement, "type" | "version"> {
  type: "patch3q.v4-severity-approval-statement";
  version: 1;
  bundleHash: `0x${string}`;
  auditorSetHash: `0x${string}`;
  auditorThreshold: number;
}

export interface V4AuditorSignature {
  signer: string;
  evmAddress: `0x${string}`;
  signature: MessageSignature;
}

export interface V4SeverityApproval {
  type: "patch3q.v4-severity-approval";
  version: 1;
  statement: V4SeverityApprovalStatement;
  participantRole: "reporter" | "program";
  participant: {
    signer: string;
    signature: MessageSignature;
  };
  auditors: V4AuditorSignature[];
  approvalHash: `0x${string}`;
}

export interface V4ApprovalChecks {
  statementShape: boolean;
  caseBinding: boolean;
  evidenceBinding: boolean;
  registryBinding: boolean;
  participantBinding: boolean;
  participantKeyBinding: boolean;
  participantHybridSignature: boolean;
  auditorSetBinding: boolean;
  auditorUniqueness: boolean;
  auditorQuorum: boolean;
  auditorKeyBindings: boolean;
  auditorHybridSignatures: boolean;
  rationaleBinding: boolean;
  payoutBinding: boolean;
  approvalHash: boolean;
}

export interface V4ApprovalVerificationResult {
  checks: V4ApprovalChecks;
  verified: boolean;
}

export interface SealResult {
  bundle: Patch3QBundle;
  vaults: Patch3QKeyVault[];
  approvalVaults?: Patch3QApprovalVault[];
  /** The reporter's own copy of the sealed payout instruction. */
  payout?: SealedPayout;
}

export interface IntegrityChecks {
  envelopeHash: boolean;
  contentCommitment: boolean;
  attachmentHash: boolean;
  authenticatedMetadata: boolean;
  caseBinding: boolean;
  payoutBinding: boolean;
  sizeBucket: boolean;
}

export interface OpenResult {
  payload: ConfidentialReport;
  checks: IntegrityChecks;
  verified: boolean;
}

export interface ApprovalChecks {
  statementShape: boolean;
  caseBinding: boolean;
  evidenceBinding: boolean;
  participantRoleBinding: boolean;
  participantAuthorityBinding: boolean;
  auditorAuthorityBinding: boolean;
  participantKeyBinding: boolean;
  auditorKeyBinding: boolean;
  registryBinding: boolean;
  rationaleBinding: boolean;
  payoutBinding: boolean;
  approvalHash: boolean;
  participantHybridSignature: boolean;
  auditorHybridSignature: boolean;
}

export interface ApprovalVerificationResult {
  checks: ApprovalChecks;
  verified: boolean;
}
