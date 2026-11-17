// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IQorePQCVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external view returns (bool valid);
}

interface IQorePQCKeyStatus {
    function pqcKeyStatus(address account)
        external view returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

/// @title Patch3QRegistry
/// @notice Public receipts, enforceable deadline evidence, PQ-approved bounty escrow, and disclosure commitments.
/// @dev Report plaintext, exploit material, salts, decryption keys, and unredacted reports must never be submitted here.
contract Patch3QRegistry {
    // Escalated is appended so the numeric values of the original lifecycle
    // states remain stable for already-deployed frontends and indexers.
    enum Status { Submitted, Acknowledged, Triaged, Resolved, Disclosed, Cancelled, Escalated }
    enum Severity { Unset, Informational, Low, Medium, High, Critical }

    uint8 public constant ML_DSA_87_ALGORITHM_ID = 1;
    uint8 public constant ACKNOWLEDGEMENT_BREACH = 1;
    uint8 public constant TRIAGE_BREACH = 2;
    address public constant PQC_VERIFY_PRECOMPILE = 0x0000000000000000000000000000000000000a01;
    address public constant PQC_KEY_STATUS_PRECOMPILE = 0x0000000000000000000000000000000000000a02;
    bytes public constant QORESIGN_MESSAGE_PREFIX = "qorechain-msg-v1|qorechain-diana|";
    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Patch3QSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash)"
    );
    bytes32 public constant ANONYMOUS_APPROVAL_TYPEHASH = keccak256(
        "Patch3QAnonymousSeverityApproval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash,address payoutRecipient)"
    );
    bytes32 public constant PAYOUT_COMMITMENT_TYPEHASH = keccak256(
        "Patch3QPayoutCommitment(bytes32 caseIdHash,address payoutRecipient,bytes32 salt)"
    );

    struct CaseReceipt {
        bool exists;
        address reporter;
        address program;
        address auditor;
        bytes32 envelopeHash;
        bytes32 contentCommitment;
        bytes32 reporterPqKeyHash;
        bytes32 programPqKeyHash;
        bytes32 auditorPqKeyHash;
        bytes32 programRef;
        bytes32 approvalHash;
        bytes32 redactedReportHash;
        uint256 escrowedAmount;
        uint256 payoutAmount;
        uint64 submittedAt;
        uint64 acknowledgedAt;
        uint64 triagedAt;
        uint64 resolvedAt;
        uint64 approvedAt;
        uint64 disclosedAt;
        uint64 acknowledgeBy;
        uint64 triageBy;
        uint64 embargoUntil;
        Severity severity;
        Status status;
        uint8 slaBreaches;
        // Anonymous cases have no reporter account: `reporter` stays zero, `relayer` is whoever anchored the
        // receipt, the reporter's escalation authority is a per-case ML-DSA-87 key known only by its hash, and
        // the payout address stays hidden behind `payoutCommitment` until release.
        bool anonymousReporter;
        address relayer;
        bytes32 payoutCommitment;
    }

    mapping(bytes32 caseIdHash => CaseReceipt receipt) public cases;
    address public immutable bountyToken;
    bool private entered;

    error CaseAlreadyExists();
    error CaseNotFound();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error DeadlineExpired();
    error DeadlineNotMissed();
    error InvalidHash();
    error InvalidPqSignature();
    error InvalidStatus();
    error InvalidToken();
    error NotAuditor();
    error NotProgram();
    error NotReporter();
    error NotParticipant();
    error RolesMustBeDistinct();
    error ApprovalAlreadyRecorded();
    error AuditorPqKeyChanged();
    error ProgramPqKeyChanged();
    error ReporterPqKeyChanged();
    error AuditorPqKeyMissing();
    error EmbargoActive();
    error NothingToRefund();
    error PqcPrecompileUnavailable();
    error Reentrancy();
    error TokenBalanceMismatch();
    error TokenTransferFailed();
    error AnonymousCaseRequired();
    error AccountCaseRequired();
    error PayoutCommitmentMismatch();

    event CaseSubmitted(
        bytes32 indexed caseIdHash,
        address indexed reporter,
        address indexed program,
        address auditor,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 reporterPqKeyHash,
        bytes32 programPqKeyHash,
        bytes32 auditorPqKeyHash,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil
    );
    event AnonymousCaseSubmitted(
        bytes32 indexed caseIdHash,
        address indexed relayer,
        bytes32 reporterPqKeyHash,
        bytes32 payoutCommitment
    );
    event DeadlineBreached(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 deadline, uint64 recordedAt);
    event CaseEscalated(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 timestamp);
    event CaseAcknowledged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla);
    event CaseTriaged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla);
    event CaseResolved(bytes32 indexed caseIdHash, uint64 timestamp);
    event BountyFunded(bytes32 indexed caseIdHash, address indexed token, uint256 amount, uint256 escrowedTotal);
    event SeverityApproved(
        bytes32 indexed caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 approvalHash,
        bytes32 rationaleHash,
        uint64 timestamp
    );
    event BountyReleased(bytes32 indexed caseIdHash, address indexed reporter, address indexed token, uint256 amount);
    event EscrowRefunded(bytes32 indexed caseIdHash, address indexed program, address indexed token, uint256 amount);
    event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp);
    event CaseCancelled(bytes32 indexed caseIdHash, uint64 timestamp);

    constructor(address trustedBountyToken) {
        if (trustedBountyToken == address(0)) revert InvalidAddress();
        if (trustedBountyToken.code.length == 0) revert InvalidToken();
        bountyToken = trustedBountyToken;
    }

    modifier existing(bytes32 caseIdHash) {
        if (!cases[caseIdHash].exists) revert CaseNotFound();
        _;
    }

    modifier onlyProgram(bytes32 caseIdHash) {
        if (msg.sender != cases[caseIdHash].program) revert NotProgram();
        _;
    }

    modifier onlyAuditor(bytes32 caseIdHash) {
        if (msg.sender != cases[caseIdHash].auditor) revert NotAuditor();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    function submitCase(
        address program,
        address auditor,
        bytes32 caseIdHash,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil
    ) external {
        CaseReceipt storage receipt = _storeCase(
            program, auditor, caseIdHash, envelopeHash, contentCommitment, programRef,
            acknowledgeBy, triageBy, embargoUntil
        );
        receipt.reporter = msg.sender;
        receipt.reporterPqKeyHash = keccak256(_registeredPqKey(msg.sender));
        _emitSubmitted(caseIdHash, receipt);
    }

    /// @notice Anchors a case for a reporter who has no on-chain account.
    /// @dev The caller only relays public commitments. The reporter's per-case ML-DSA-87 public key is never
    ///      registered or revealed unless the case escalates, and the payout address is revealed only at release.
    function submitAnonymousCase(
        address program,
        address auditor,
        bytes32 caseIdHash,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil,
        bytes32 reporterPqKeyHash,
        bytes32 payoutCommitment
    ) external {
        if (reporterPqKeyHash == bytes32(0) || payoutCommitment == bytes32(0)) revert InvalidHash();
        CaseReceipt storage receipt = _storeCase(
            program, auditor, caseIdHash, envelopeHash, contentCommitment, programRef,
            acknowledgeBy, triageBy, embargoUntil
        );
        receipt.anonymousReporter = true;
        receipt.relayer = msg.sender;
        receipt.reporterPqKeyHash = reporterPqKeyHash;
        receipt.payoutCommitment = payoutCommitment;
        _emitSubmitted(caseIdHash, receipt);
        emit AnonymousCaseSubmitted(caseIdHash, msg.sender, reporterPqKeyHash, payoutCommitment);
    }

    function payoutCommitmentOf(bytes32 caseIdHash, address payoutRecipient, bytes32 salt)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(PAYOUT_COMMITMENT_TYPEHASH, caseIdHash, payoutRecipient, salt));
    }

    function _storeCase(
        address program,
        address auditor,
        bytes32 caseIdHash,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil
    ) private returns (CaseReceipt storage receipt) {
        if (program == address(0) || auditor == address(0)) revert InvalidAddress();
        if (program == auditor || program == msg.sender || auditor == msg.sender) revert RolesMustBeDistinct();
        if (cases[caseIdHash].exists) revert CaseAlreadyExists();
        if (caseIdHash == bytes32(0) || envelopeHash == bytes32(0) || contentCommitment == bytes32(0)) {
            revert InvalidHash();
        }
        if (
            acknowledgeBy <= block.timestamp || triageBy <= acknowledgeBy ||
            embargoUntil < triageBy
        ) revert InvalidDeadline();

        receipt = cases[caseIdHash];
        receipt.exists = true;
        receipt.program = program;
        receipt.auditor = auditor;
        receipt.envelopeHash = envelopeHash;
        receipt.contentCommitment = contentCommitment;
        receipt.programPqKeyHash = keccak256(_registeredPqKey(program));
        receipt.auditorPqKeyHash = keccak256(_registeredPqKey(auditor));
        receipt.programRef = programRef;
        receipt.submittedAt = uint64(block.timestamp);
        receipt.acknowledgeBy = acknowledgeBy;
        receipt.triageBy = triageBy;
        receipt.embargoUntil = embargoUntil;
        receipt.status = Status.Submitted;
    }

    function _emitSubmitted(bytes32 caseIdHash, CaseReceipt storage receipt) private {
        emit CaseSubmitted(
            caseIdHash, receipt.reporter, receipt.program, receipt.auditor, receipt.envelopeHash,
            receipt.contentCommitment, receipt.reporterPqKeyHash, receipt.programPqKeyHash,
            receipt.auditorPqKeyHash, receipt.programRef, receipt.acknowledgeBy, receipt.triageBy,
            receipt.embargoUntil
        );
    }

    function recordDeadlineBreaches(bytes32 caseIdHash) external existing(caseIdHash) {
        _recordDeadlineBreaches(caseIdHash, cases[caseIdHash]);
    }

    /// @notice Applies the deterministic consequence for a program that misses an acknowledgement or triage SLA.
    /// @dev Blockchains do not execute on wall-clock time by themselves. Any account or keeper may call this after
    ///      the deadline; the case then permanently enters Escalated and the independent auditor may adjudicate
    ///      funded escrow with the reporter. The late program cannot restore its former signing authority.
    function escalateMissedDeadline(bytes32 caseIdHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        uint8 breach;
        if (
            receipt.status == Status.Submitted && receipt.acknowledgedAt == 0 &&
            block.timestamp > receipt.acknowledgeBy
        ) {
            breach = ACKNOWLEDGEMENT_BREACH;
        } else if (
            receipt.status == Status.Acknowledged && receipt.triagedAt == 0 &&
            block.timestamp > receipt.triageBy
        ) {
            breach = TRIAGE_BREACH;
        } else {
            revert DeadlineNotMissed();
        }

        _recordDeadlineBreaches(caseIdHash, receipt);
        receipt.status = Status.Escalated;
        emit CaseEscalated(caseIdHash, breach, uint64(block.timestamp));
    }

    function deadlineState(bytes32 caseIdHash) external view existing(caseIdHash)
        returns (bool acknowledgementMissed, bool triageMissed)
    {
        CaseReceipt storage receipt = cases[caseIdHash];
        acknowledgementMissed =
            (receipt.slaBreaches & ACKNOWLEDGEMENT_BREACH) != 0 ||
            (receipt.acknowledgedAt == 0 && block.timestamp > receipt.acknowledgeBy);
        triageMissed =
            (receipt.slaBreaches & TRIAGE_BREACH) != 0 ||
            (receipt.triagedAt == 0 && block.timestamp > receipt.triageBy);
    }

    function caseState(bytes32 caseIdHash) external view existing(caseIdHash) returns (
        Status status,
        Severity severity,
        uint8 slaBreaches,
        uint256 escrowedAmount,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil,
        address reporter,
        address program,
        address auditor,
        bytes32 approvalHash,
        bytes32 redactedReportHash
    ) {
        CaseReceipt storage receipt = cases[caseIdHash];
        return (
            receipt.status,
            receipt.severity,
            receipt.slaBreaches,
            receipt.escrowedAmount,
            receipt.acknowledgeBy,
            receipt.triageBy,
            receipt.embargoUntil,
            receipt.reporter,
            receipt.program,
            receipt.auditor,
            receipt.approvalHash,
            receipt.redactedReportHash
        );
    }

    function privacyState(bytes32 caseIdHash) external view existing(caseIdHash) returns (
        bool anonymousReporter,
        address relayer,
        bytes32 reporterPqKeyHash,
        bytes32 payoutCommitment
    ) {
        CaseReceipt storage receipt = cases[caseIdHash];
        return (receipt.anonymousReporter, receipt.relayer, receipt.reporterPqKeyHash, receipt.payoutCommitment);
    }

    function acknowledgeCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Submitted || receipt.acknowledgedAt != 0) revert InvalidStatus();
        // Once the SLA expires, the program cannot race a keeper and preserve its vote.
        if (block.timestamp > receipt.acknowledgeBy) revert DeadlineExpired();
        receipt.acknowledgedAt = uint64(block.timestamp);
        receipt.status = Status.Acknowledged;
        emit CaseAcknowledged(caseIdHash, uint64(block.timestamp), true);
    }

    function triageCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (
            receipt.status != Status.Acknowledged || receipt.acknowledgedAt == 0 || receipt.triagedAt != 0
        ) revert InvalidStatus();
        // A missed triage deadline permanently leaves the case eligible for escalation.
        if (block.timestamp > receipt.triageBy) revert DeadlineExpired();
        receipt.triagedAt = uint64(block.timestamp);
        receipt.status = Status.Triaged;
        emit CaseTriaged(caseIdHash, uint64(block.timestamp), true);
    }

    function resolveCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Triaged) revert InvalidStatus();
        _recordDeadlineBreaches(caseIdHash, receipt);
        receipt.resolvedAt = uint64(block.timestamp);
        receipt.status = Status.Resolved;
        emit CaseResolved(caseIdHash, uint64(block.timestamp));
    }

    function fundBounty(bytes32 caseIdHash, uint256 amount)
        external existing(caseIdHash) onlyProgram(caseIdHash) nonReentrant
    {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status == Status.Cancelled || receipt.status == Status.Disclosed) revert InvalidStatus();
        if (receipt.approvalHash != bytes32(0)) revert ApprovalAlreadyRecorded();
        if (amount == 0) revert InvalidAmount();

        uint256 balanceBefore = IERC20Like(bountyToken).balanceOf(address(this));
        _safeTransferFrom(bountyToken, msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20Like(bountyToken).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) revert TokenBalanceMismatch();

        receipt.escrowedAmount += amount;
        emit BountyFunded(caseIdHash, bountyToken, amount, receipt.escrowedAmount);
    }

    function approvalDigest(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash
    ) public view existing(caseIdHash) returns (bytes32) {
        CaseReceipt storage receipt = cases[caseIdHash];
        return keccak256(abi.encode(
            APPROVAL_TYPEHASH,
            block.chainid,
            address(this),
            caseIdHash,
            receipt.envelopeHash,
            receipt.contentCommitment,
            uint8(severity),
            payoutAmount,
            rationaleHash
        ));
    }

    /// @notice Verifies two independent ML-DSA-87 approvals and atomically releases the approved payout.
    /// @dev Normal cases require program + auditor. Escalated cases replace the ghosted program with reporter +
    ///      auditor. The auditor still submits the transaction, adding the network's scoped EVM-window authorization.
    function approveSeverity(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        bytes calldata participantPqSignature,
        bytes calldata auditorPqSignature
    ) external existing(caseIdHash) onlyAuditor(caseIdHash) nonReentrant {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.anonymousReporter) revert AnonymousCaseRequired();
        _checkApprovalInputs(receipt, severity, payoutAmount, rationaleHash, participantPqSignature, auditorPqSignature);

        bytes memory participantPqKey;
        if (receipt.status == Status.Escalated) {
            participantPqKey = _registeredPqKey(receipt.reporter);
            if (keccak256(participantPqKey) != receipt.reporterPqKeyHash) revert ReporterPqKeyChanged();
        } else {
            participantPqKey = _programPqKey(receipt);
        }

        bytes32 digest = approvalDigest(caseIdHash, severity, payoutAmount, rationaleHash);
        _verifyApprovalSignatures(receipt, digest, participantPqKey, participantPqSignature, auditorPqSignature);
        _release(caseIdHash, receipt, severity, payoutAmount, rationaleHash, digest, receipt.reporter);
    }

    function anonymousApprovalDigest(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        address payoutRecipient
    ) public view existing(caseIdHash) returns (bytes32) {
        CaseReceipt storage receipt = cases[caseIdHash];
        return keccak256(abi.encode(
            ANONYMOUS_APPROVAL_TYPEHASH,
            block.chainid,
            address(this),
            caseIdHash,
            receipt.envelopeHash,
            receipt.contentCommitment,
            uint8(severity),
            payoutAmount,
            rationaleHash,
            payoutRecipient
        ));
    }

    /// @notice Releases an anonymous case's bounty to the payout address the reporter sealed at submission.
    /// @dev The payout address and salt must open the reporter's commitment, so neither signer can redirect funds.
    ///      After escalation the reporter signs with the per-case key whose hash was anchored at submission.
    function approveAnonymousSeverity(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        address payoutRecipient,
        bytes32 payoutSalt,
        bytes calldata reporterPqKey,
        bytes calldata participantPqSignature,
        bytes calldata auditorPqSignature
    ) external existing(caseIdHash) onlyAuditor(caseIdHash) nonReentrant {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (!receipt.anonymousReporter) revert AccountCaseRequired();
        _checkApprovalInputs(receipt, severity, payoutAmount, rationaleHash, participantPqSignature, auditorPqSignature);
        if (payoutRecipient == address(0)) revert InvalidAddress();
        if (payoutCommitmentOf(caseIdHash, payoutRecipient, payoutSalt) != receipt.payoutCommitment) {
            revert PayoutCommitmentMismatch();
        }

        bytes memory participantPqKey;
        if (receipt.status == Status.Escalated) {
            if (keccak256(reporterPqKey) != receipt.reporterPqKeyHash) revert ReporterPqKeyChanged();
            participantPqKey = reporterPqKey;
        } else {
            participantPqKey = _programPqKey(receipt);
        }

        bytes32 digest = anonymousApprovalDigest(caseIdHash, severity, payoutAmount, rationaleHash, payoutRecipient);
        _verifyApprovalSignatures(receipt, digest, participantPqKey, participantPqSignature, auditorPqSignature);
        _release(caseIdHash, receipt, severity, payoutAmount, rationaleHash, digest, payoutRecipient);
    }

    function _checkApprovalInputs(
        CaseReceipt storage receipt,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        bytes calldata participantPqSignature,
        bytes calldata auditorPqSignature
    ) private view {
        if (
            receipt.status != Status.Triaged && receipt.status != Status.Resolved &&
            receipt.status != Status.Escalated
        ) revert InvalidStatus();
        if (receipt.approvalHash != bytes32(0)) revert ApprovalAlreadyRecorded();
        if (severity == Severity.Unset || payoutAmount == 0 || payoutAmount > receipt.escrowedAmount) {
            revert InvalidAmount();
        }
        if (
            rationaleHash == bytes32(0) || participantPqSignature.length == 0 ||
            auditorPqSignature.length == 0
        ) revert InvalidHash();
    }

    function _programPqKey(CaseReceipt storage receipt) private view returns (bytes memory programPqKey) {
        programPqKey = _registeredPqKey(receipt.program);
        if (keccak256(programPqKey) != receipt.programPqKeyHash) revert ProgramPqKeyChanged();
    }

    function _verifyApprovalSignatures(
        CaseReceipt storage receipt,
        bytes32 digest,
        bytes memory participantPqKey,
        bytes calldata participantPqSignature,
        bytes calldata auditorPqSignature
    ) private view {
        bytes memory auditorPqKey = _registeredPqKey(receipt.auditor);
        if (keccak256(auditorPqKey) != receipt.auditorPqKeyHash) revert AuditorPqKeyChanged();
        bytes memory message = bytes.concat(QORESIGN_MESSAGE_PREFIX, abi.encodePacked(digest));
        if (!_verifyPq(participantPqKey, participantPqSignature, message)) revert InvalidPqSignature();
        if (!_verifyPq(auditorPqKey, auditorPqSignature, message)) revert InvalidPqSignature();
    }

    function _release(
        bytes32 caseIdHash,
        CaseReceipt storage receipt,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        bytes32 digest,
        address payoutRecipient
    ) private {
        bool wasEscalated = receipt.status == Status.Escalated;
        receipt.approvalHash = digest;
        receipt.severity = severity;
        receipt.payoutAmount = payoutAmount;
        receipt.approvedAt = uint64(block.timestamp);
        receipt.escrowedAmount -= payoutAmount;
        // Reporter + auditor approval is the resolution mechanism after ghosting.
        // Closing the case here lets the redacted disclosure and remainder-refund
        // paths work for both acknowledgement and triage escalations.
        if (wasEscalated) {
            receipt.resolvedAt = uint64(block.timestamp);
            receipt.status = Status.Resolved;
        }
        _safeTransfer(bountyToken, payoutRecipient, payoutAmount);

        emit SeverityApproved(caseIdHash, severity, payoutAmount, digest, rationaleHash, uint64(block.timestamp));
        emit BountyReleased(caseIdHash, payoutRecipient, bountyToken, payoutAmount);
        if (wasEscalated) emit CaseResolved(caseIdHash, uint64(block.timestamp));
    }

    function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        bool anonymousAuditor =
            receipt.anonymousReporter && receipt.approvalHash != bytes32(0) && msg.sender == receipt.auditor;
        if (msg.sender != receipt.reporter && msg.sender != receipt.program && !anonymousAuditor) {
            revert NotParticipant();
        }
        if (receipt.status != Status.Resolved) revert InvalidStatus();
        if (block.timestamp < receipt.embargoUntil) revert EmbargoActive();
        if (redactedReportHash == bytes32(0)) revert InvalidHash();
        receipt.redactedReportHash = redactedReportHash;
        receipt.disclosedAt = uint64(block.timestamp);
        receipt.status = Status.Disclosed;
        emit CaseDisclosed(caseIdHash, redactedReportHash, uint64(block.timestamp));
    }

    function cancelCase(bytes32 caseIdHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (msg.sender != receipt.reporter) revert NotReporter();
        if (
            (receipt.status != Status.Submitted && receipt.status != Status.Escalated) ||
            receipt.acknowledgedAt != 0
        ) revert InvalidStatus();
        _recordDeadlineBreaches(caseIdHash, receipt);
        receipt.status = Status.Cancelled;
        emit CaseCancelled(caseIdHash, uint64(block.timestamp));
    }

    function refundEscrow(bytes32 caseIdHash)
        external existing(caseIdHash) onlyProgram(caseIdHash) nonReentrant
    {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Cancelled && receipt.status != Status.Disclosed) revert InvalidStatus();
        uint256 amount = receipt.escrowedAmount;
        if (amount == 0) revert NothingToRefund();
        receipt.escrowedAmount = 0;
        _safeTransfer(bountyToken, receipt.program, amount);
        emit EscrowRefunded(caseIdHash, receipt.program, bountyToken, amount);
    }

    function _recordDeadlineBreaches(bytes32 caseIdHash, CaseReceipt storage receipt) private {
        uint64 recordedAt = uint64(block.timestamp);
        if (
            receipt.acknowledgedAt == 0 && block.timestamp > receipt.acknowledgeBy &&
            (receipt.slaBreaches & ACKNOWLEDGEMENT_BREACH) == 0
        ) {
            receipt.slaBreaches |= ACKNOWLEDGEMENT_BREACH;
            emit DeadlineBreached(caseIdHash, ACKNOWLEDGEMENT_BREACH, receipt.acknowledgeBy, recordedAt);
        }
        if (
            receipt.triagedAt == 0 && block.timestamp > receipt.triageBy &&
            (receipt.slaBreaches & TRIAGE_BREACH) == 0
        ) {
            receipt.slaBreaches |= TRIAGE_BREACH;
            emit DeadlineBreached(caseIdHash, TRIAGE_BREACH, receipt.triageBy, recordedAt);
        }
    }

    function _registeredPqKey(address account) internal view virtual returns (bytes memory pubkey) {
        (bool success, bytes memory data) = PQC_KEY_STATUS_PRECOMPILE.staticcall(
            abi.encodeCall(IQorePQCKeyStatus.pqcKeyStatus, (account))
        );
        if (!success || data.length == 0) revert PqcPrecompileUnavailable();
        (bool registered, uint8 algorithmId, bytes memory registeredKey) = abi.decode(data, (bool, uint8, bytes));
        if (!registered || algorithmId != ML_DSA_87_ALGORITHM_ID || registeredKey.length == 0) {
            revert AuditorPqKeyMissing();
        }
        return registeredKey;
    }

    function _verifyPq(bytes memory pubkey, bytes calldata signature, bytes memory message)
        internal view virtual returns (bool)
    {
        (bool success, bytes memory data) = PQC_VERIFY_PRECOMPILE.staticcall(
            abi.encodeCall(IQorePQCVerify.pqcVerify, (pubkey, signature, message))
        );
        if (!success || data.length < 32) revert PqcPrecompileUnavailable();
        return abi.decode(data, (bool));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert TokenTransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20Like.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert TokenTransferFailed();
        }
    }
}

/// @notice Permissionless test token for demos only. Never use as a production stablecoin.
contract MockTUSDT {
    string public constant name = "Patch3Q test USDT";
    string public constant symbol = "tUSDT";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        require(permitted >= amount, "allowance");
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "zero address");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "balance");
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
