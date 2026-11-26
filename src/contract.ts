import { parseAbi } from "viem";

import evidence from "../evidence/testnet-v3.json";
import v4Evidence from "../evidence/v4-deployment.json";
import v5Evidence from "../evidence/v5-deployment.json";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

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
  version: number;
  registryAddress: `0x${string}` | null;
  bountyTokenAddress: `0x${string}` | null;
  transactions?: Record<string, unknown>;
  cases?: Record<string, { transactions?: Record<string, unknown> }>;
};

export const currentDeployment = evidence as {
  status: string;
  version: number;
  registryAddress: `0x${string}`;
  bountyTokenAddress: `0x${string}`;
};

export const patch3qRegistryAddress = (
  viteEnv.VITE_PATCH3Q_REGISTRY_ADDRESS || currentDeployment.registryAddress || undefined
) as `0x${string}` | undefined;

export const escrowTokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const patch3qRegistryV4Abi = parseAbi([
  "function configureProgramPolicy(address[] auditors, uint8 auditorThreshold, address[] relayers, uint256 reservePerCase, uint16 maxOpenCases, uint64 acknowledgePeriod, uint64 triagePeriod, uint64 embargoPeriod)",
  "function setProgramPolicyEnabled(bool enabled)",
  "function depositProgramPool(uint256 amount)",
  "function withdrawProgramPool(uint256 amount)",
  "function submitFundedAnonymousCase(address program, bytes32 caseIdHash, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 programRef, bytes32 reporterPqKeyHash, bytes32 payoutCommitment, bytes encryptedBundle)",
  "function acknowledgeCase(bytes32 caseIdHash)",
  "function triageCase(bytes32 caseIdHash)",
  "function resolveCase(bytes32 caseIdHash)",
  "function escalateMissedDeadline(bytes32 caseIdHash)",
  "function approveAnonymousSeverity(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, address payoutRecipient, bytes32 payoutSalt, bytes reporterPqKey, bytes participantPqSignature, address[] auditorSigners, bytes[] auditorPqSignatures)",
  "function approvalDigest(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, address payoutRecipient) view returns (bytes32)",
  "function programPolicyState(address program) view returns (bool exists, bool enabled, uint256 availablePool, uint256 reservePerCase, uint16 maxOpenCases, uint16 openCases, uint8 auditorThreshold, uint256 auditorCount, uint256 relayerCount, uint64 acknowledgePeriod, uint64 triagePeriod, uint64 embargoPeriod)",
  "function programAuditors(address program) view returns (address[])",
  "function programRelayers(address program) view returns (address[])",
  "function caseAuditors(bytes32 caseIdHash) view returns (address[])",
  "function caseState(bytes32 caseIdHash) view returns (uint8 status, uint8 severity, uint8 slaBreaches, uint256 escrowedAmount, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil, address program, address relayer, bytes32 approvalHash, bytes32 redactedReportHash, bytes32 bundleHash, uint8 auditorThreshold)",
  "function bountyToken() view returns (address)",
  "event EncryptedBundlePublished(bytes32 indexed caseIdHash, bytes32 indexed bundleHash, bytes encryptedBundle)",
  "event FundedAnonymousCaseSubmitted(bytes32 indexed caseIdHash, address indexed program, address indexed relayer, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 bundleHash, bytes32 reporterPqKeyHash, bytes32 payoutCommitment, uint256 reservedAmount, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil, uint8 auditorThreshold)",
]);

export const patch3qRegistryV4Address = (
  viteEnv.VITE_PATCH3Q_V4_REGISTRY_ADDRESS || v4Evidence.registryAddress || undefined
) as `0x${string}` | undefined;

export const currentV4Deployment = v4Evidence as {
  status: string;
  registryAddress: `0x${string}`;
  bountyTokenAddress: `0x${string}`;
  deploymentHash: `0x${string}`;
  deploymentBlock: string;
  deployer: `0x${string}`;
};

export const patch3qRegistryV5Abi = [
  ...patch3qRegistryV4Abi,
  ...parseAbi([
    "function configureProgramPolicyWithDecisionGrace(address[] auditors, uint8 auditorThreshold, address[] relayers, uint256 reservePerCase, uint16 maxOpenCases, uint64 acknowledgePeriod, uint64 triagePeriod, uint64 embargoPeriod, uint64 decisionGracePeriod)",
    "function programDecisionGracePeriod(address program) view returns (uint64)",
    "function decisionState(bytes32 caseIdHash) view returns (uint64 decisionBy, bool decisionMissed)",
    "function rejectAnonymousCase(bytes32 caseIdHash, bytes32 rationaleHash, address[] auditorSigners, bytes[] auditorPqSignatures)",
    "function rejectionDigest(bytes32 caseIdHash, bytes32 rationaleHash) view returns (bytes32)",
    "event CaseRejected(bytes32 indexed caseIdHash, uint256 returnedReserve, uint8 auditorApprovals, bytes32 rejectionHash, bytes32 rationaleHash, uint64 timestamp)",
    "event DecisionDeadlineSet(bytes32 indexed caseIdHash, uint64 decisionBy)",
    "event CaseTriaged(bytes32 indexed caseIdHash, uint64 timestamp)",
    "event CaseEscalated(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 timestamp)",
    "event QuorumApprovalRecorded(bytes32 indexed caseIdHash, uint8 severity, uint256 payoutAmount, uint8 auditorApprovals, bytes32 approvalHash, bytes32 rationaleHash)",
    "event BountyReleased(bytes32 indexed caseIdHash, address indexed recipient, uint256 amount)",
  ]),
];
export const patch3qRegistryV5Address = (viteEnv.VITE_PATCH3Q_V5_REGISTRY_ADDRESS || v5Evidence.registryAddress) as `0x${string}`;
export const currentV5Deployment = v5Evidence;
