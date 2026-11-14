import { parseAbi } from "viem";

export const patch3qRegistryAbi = parseAbi([
  "function submitCase(address program, address auditor, bytes32 caseIdHash, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "function acknowledgeCase(bytes32 caseIdHash)",
  "function triageCase(bytes32 caseIdHash)",
  "function resolveCase(bytes32 caseIdHash)",
  "function recordDeadlineBreaches(bytes32 caseIdHash)",
  "function escalateMissedDeadline(bytes32 caseIdHash)",
  "function fundBounty(bytes32 caseIdHash, uint256 amount)",
  "function approveSeverity(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 rationaleHash, bytes participantPqSignature, bytes auditorPqSignature)",
  "function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash)",
  "function cancelCase(bytes32 caseIdHash)",
  "function refundEscrow(bytes32 caseIdHash)",
  "function bountyToken() view returns (address)",
  "function caseState(bytes32 caseIdHash) view returns (uint8 status, uint8 severity, uint8 slaBreaches, uint256 escrowedAmount, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil, address reporter, address program, address auditor, bytes32 approvalHash, bytes32 redactedReportHash)",
  "function deadlineState(bytes32 caseIdHash) view returns (bool acknowledgementMissed, bool triageMissed)",
  "event CaseSubmitted(bytes32 indexed caseIdHash, address indexed reporter, address indexed program, address auditor, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 reporterPqKeyHash, bytes32 programPqKeyHash, bytes32 auditorPqKeyHash, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "event DeadlineBreached(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 deadline, uint64 recordedAt)",
  "event CaseEscalated(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 timestamp)",
  "event BountyFunded(bytes32 indexed caseIdHash, address indexed token, uint256 amount, uint256 escrowedTotal)",
  "event SeverityApproved(bytes32 indexed caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 approvalHash, bytes32 rationaleHash, uint64 timestamp)",
  "event BountyReleased(bytes32 indexed caseIdHash, address indexed reporter, address indexed token, uint256 amount)",
  "event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp)",
]);

export const patch3qRegistryAddress = import.meta.env.VITE_PATCH3Q_REGISTRY_ADDRESS as `0x${string}` | undefined;

export const escrowTokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
