import { parseAbi } from "viem";

export const patch3qRegistryAbi = parseAbi([
  "function submitCase(address program, address auditor, bytes32 caseIdHash, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 approvalAuthorityHash, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "function acknowledgeCase(bytes32 caseIdHash)",
  "function triageCase(bytes32 caseIdHash)",
  "function resolveCase(bytes32 caseIdHash)",
  "function fundBounty(bytes32 caseIdHash, address token, uint256 amount)",
  "function approveSeverity(bytes32 caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 approvalHash)",
  "function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash)",
  "function cancelCase(bytes32 caseIdHash)",
  "function refundEscrow(bytes32 caseIdHash)",
  "event CaseSubmitted(bytes32 indexed caseIdHash, address indexed reporter, address indexed program, address auditor, bytes32 envelopeHash, bytes32 contentCommitment, bytes32 approvalAuthorityHash, bytes32 programRef, uint64 acknowledgeBy, uint64 triageBy, uint64 embargoUntil)",
  "event BountyFunded(bytes32 indexed caseIdHash, address indexed token, uint256 amount, uint256 escrowedTotal)",
  "event SeverityApproved(bytes32 indexed caseIdHash, uint8 severity, uint256 payoutAmount, bytes32 approvalHash, uint64 timestamp)",
  "event BountyReleased(bytes32 indexed caseIdHash, address indexed reporter, address indexed token, uint256 amount)",
  "event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp)",
]);

export const patch3qRegistryAddress = import.meta.env.VITE_PATCH3Q_REGISTRY_ADDRESS as `0x${string}` | undefined;

export const escrowTokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
