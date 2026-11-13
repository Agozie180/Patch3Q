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

export interface ConfidentialReport {
  type: "patch3q.report";
  version: 1;
  caseId: string;
  createdAt: string;
  salt: string;
  report: ReportDraft;
  attachment?: ReportAttachment;
}

export interface PublicMetadata {
  acknowledgeBy: string;
  triageBy: string;
  embargoUntil: string;
}

export interface ApprovalAuthority {
  role: "auditor";
  signer: string;
  evmAddress: `0x${string}`;
  keyFingerprint: string;
  pqPublicKey?: string;
  source: "embedded-demo" | "qorechain-registry";
}

export interface BundleRecipient {
  role: "maintainer" | "auditor";
  label: string;
  address?: string;
  keyFingerprint?: string;
}

export interface Patch3QBundle {
  type: "patch3q.bundle";
  version: 1;
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
  approvalAuthority?: ApprovalAuthority;
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
  role: "auditor";
  signer: string;
  classicalPrivateKey: string;
  pqSeed: string;
  warning: string;
}

export interface SeverityApprovalStatement {
  type: "patch3q.severity-approval-statement";
  version: 1;
  caseId: string;
  chainId: "qorechain-diana";
  envelopeHash: `0x${string}`;
  contentCommitment: `0x${string}`;
  severity: Severity;
  payout: {
    denom: "test-fUSD";
    atomic: string;
  };
  rationale: string;
  approvedAt: string;
}

export interface SeverityApproval {
  type: "patch3q.severity-approval";
  version: 1;
  statement: SeverityApprovalStatement;
  signer: string;
  signature: MessageSignature;
  approvalHash: `0x${string}`;
}

export interface SealResult {
  bundle: Patch3QBundle;
  vaults: Patch3QKeyVault[];
  approvalVault?: Patch3QApprovalVault;
}

export interface IntegrityChecks {
  envelopeHash: boolean;
  contentCommitment: boolean;
  authenticatedMetadata: boolean;
  caseBinding: boolean;
}

export interface OpenResult {
  payload: ConfidentialReport;
  checks: IntegrityChecks;
  verified: boolean;
}

export interface ApprovalChecks {
  caseBinding: boolean;
  evidenceBinding: boolean;
  authorityBinding: boolean;
  approvalHash: boolean;
  hybridSignature: boolean;
}

export interface ApprovalVerificationResult {
  checks: ApprovalChecks;
  verified: boolean;
}
