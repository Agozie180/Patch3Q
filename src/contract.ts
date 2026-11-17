import { parseAbi } from "viem";

import deploymentV2 from "../evidence/deployment-v2.json";
import evidence from "../evidence/testnet.json";

export const patch3qRegistryAbi = parseAbi([
  "function submitCase(address program, address auditor, bytes32 caseIdHash, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "function submitAnonymousCase(address program, address auditor, bytes32 caseIdHash, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil, bytes32 reporterPqKeyHash, bytes32 payoutCommitment)",
  "function acknowledgeCase(bytes32 caseIdHash)",
  "function triageCase(bytes32 caseIdHash)",
  "function resolveCase(bytes32 caseIdHash)",
  "function recordDeadlineBreaches(bytes32 caseIdHash)",
  "function escalateMissedDeadline(bytes32 caseIdHash)",
  "function fundBounty(bytes32 caseIdHash, uint256 amount)",
  "function approveSeverity(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, bytes participantPqSignature, bytes auditorPqSignature)",
  "function approveAnonymousSeverity(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, address payoutRecipient, bytes32 payoutSalt, bytes reporterPqKey, bytes participantPqSignature, bytes auditorPqSignature)",
  "function approvalDigest(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash) view returns (bytes32)",
  "function anonymousApprovalDigest(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, address payoutRecipient) view returns (bytes32)",
  "function payoutCommitmentOf(bytes32 caseIdHash, address payoutRecipient, bytes32 salt) pure returns (bytes32)",
  "function privacyState(bytes32 caseIdHash) view returns (bool anonymousReporter, address relayer, bytes32 reporterPqKeyHash, bytes32 payoutCommitment)",
  "function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash)",
  "function cancelCase(bytes32 caseIdHash)",
  "function refundEscrow(bytes32 caseIdHash)",
  "function bountyToken() view returns (address)",
  "function caseState(bytes32 caseIdHash) view returns (uint8 status, uint8 severity, uint8 slaBreaches, uint256 escrowedAmount, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil, address reporter, address program, address auditor, bytes32 approvalHash, bytes32 redactedReportHash)",
  "function deadlineState(bytes32 caseIdHash) view returns (bool acknowledgementMissed, bool triageMissed)",
  "event CaseSubmitted(bytes32 indexed caseIdHash, address indexed reporter, address indexed program, address auditor, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 reporterPqKeyHash, bytes32 programPqKeyHash, bytes32 auditorPqKeyHash, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "event AnonymousCaseSubmitted(bytes32 indexed caseIdHash, address indexed relayer, bytes32 reporterPqKeyHash, bytes32 payoutCommitment)",
  "event CaseAcknowledged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla)",
  "event CaseTriaged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla)",
  "event CaseResolved(bytes32 indexed caseIdHash, uint64 timestamp)",
  "event DeadlineBreached(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 deadline, uint64 recordedAt)",
  "event CaseEscalated(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 timestamp)",
  "event BountyFunded(bytes32 indexed caseIdHash, address indexed token, uint256 amount, uint256 escrowedTotal)",
  "event SeverityApproved(bytes32 indexed caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 approvalHash, bytes32 rationaleHash, uint64 timestamp)",
  "event BountyReleased(bytes32 indexed caseIdHash, address indexed reporter, address indexed token, uint256 amount)",
  "event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp)",
]);

export const testnetEvidence = evidence as {
  status: string;
  registryAddress: `0x${string}` | null;
  bountyTokenAddress: `0x${string}` | null;
  transactions?: Record<string, unknown>;
  cases?: Record<string, { transactions?: Record<string, unknown> }>;
};

export const currentDeployment = deploymentV2 as {
  status: string;
  version: number;
  registryAddress: `0x${string}`;
  bountyTokenAddress: `0x${string}`;
};

export const patch3qRegistryAddress = (
  import.meta.env.VITE_PATCH3Q_REGISTRY_ADDRESS || currentDeployment.registryAddress || testnetEvidence.registryAddress || undefined
) as `0x${string}` | undefined;

export const escrowTokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
