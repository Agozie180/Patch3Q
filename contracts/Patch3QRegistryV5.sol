// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20LikeV5 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IQorePQCVerifyV5 {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external view returns (bool valid);
}

interface IQorePQCKeyStatusV5 {
    function pqcKeyStatus(address account)
        external view returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

/// @title Patch3QRegistryV5
/// @notice Pre-funded disclosure policies, durable encrypted-bundle publication, quorum adjudication and SLA escalation.
/// @dev Local review candidate. V3/V4 remain unchanged. Positive payouts retain the V4 wire format, bound to this registry.
contract Patch3QRegistryV5 {
    enum Status { Submitted, Acknowledged, Triaged, Resolved, Disclosed, Escalated, Rejected }
    enum Severity { Unset, Informational, Low, Medium, High, Critical }

    uint8 public constant ML_DSA_87_ALGORITHM_ID = 1;
    uint8 public constant ACKNOWLEDGEMENT_BREACH = 1;
    uint8 public constant TRIAGE_BREACH = 2;
    uint8 public constant DECISION_BREACH = 4;
    uint64 public constant DECISION_GRACE_PERIOD = 7 days;
    uint8 public constant MAX_AUDITORS = 5;
    uint8 public constant MAX_RELAYERS = 5;
    uint256 public constant MAX_BUNDLE_BYTES = 128 * 1024;
    uint64 public constant MAX_POLICY_PERIOD = 365 days;
    address public constant PQC_VERIFY_PRECOMPILE = 0x0000000000000000000000000000000000000a01;
    address public constant PQC_KEY_STATUS_PRECOMPILE = 0x0000000000000000000000000000000000000a02;
    bytes public constant QORESIGN_MESSAGE_PREFIX = "qorechain-msg-v1|qorechain-diana|";

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Patch3QV4Approval(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,bytes32 bundleHash,bytes32 auditorSetHash,uint8 severity,uint256 payoutAmount,bytes32 rationaleHash,address payoutRecipient)"
    );
    bytes32 public constant PAYOUT_COMMITMENT_TYPEHASH = keccak256(
        "Patch3QPayoutCommitment(bytes32 caseIdHash,address payoutRecipient,bytes32 salt)"
    );

    bytes32 public constant REJECTION_TYPEHASH = keccak256(
        "Patch3QV5Rejection(uint256 chainId,address registry,bytes32 caseIdHash,bytes32 envelopeHash,bytes32 contentCommitment,bytes32 bundleHash,bytes32 auditorSetHash,uint256 reservedAmount,bytes32 rationaleHash)"
    );

    struct ProgramPolicy {
        bool exists;
        bool enabled;
        uint8 auditorThreshold;
        uint16 maxOpenCases;
        uint16 openCases;
        uint64 acknowledgePeriod;
        uint64 triagePeriod;
        uint64 embargoPeriod;
        uint64 decisionGracePeriod;
        uint256 reservePerCase;
        uint256 availablePool;
    }

    struct CaseReceipt {
        bool exists;
        bool capacityReleased;
        address program;
        address relayer;
        bytes32 envelopeHash;
        bytes32 contentCommitment;
        bytes32 bundleHash;
        bytes32 reporterPqKeyHash;
        bytes32 programPqKeyHash;
        bytes32 auditorSetHash;
        bytes32 payoutCommitment;
        bytes32 approvalHash;
        bytes32 redactedReportHash;
        bytes32 programRef;
        uint256 escrowedAmount;
        uint256 payoutAmount;
        uint64 submittedAt;
        uint64 acknowledgedAt;
        uint64 triagedAt;
        uint64 resolvedAt;
        uint64 disclosedAt;
        uint64 acknowledgeBy;
        uint64 triageBy;
        uint64 embargoUntil;
        uint64 decisionBy;
        Severity severity;
        Status status;
        uint8 slaBreaches;
        uint8 auditorThreshold;
    }

    mapping(address program => ProgramPolicy policy) private policies;
    mapping(address program => address[] auditors) private policyAuditors;
    mapping(address program => mapping(address auditor => bool member)) private policyAuditorMembers;
    mapping(address program => address[] relayers) private policyRelayers;
    mapping(address program => mapping(address relayer => bool member)) private policyRelayerMembers;

    mapping(bytes32 caseIdHash => CaseReceipt receipt) private receipts;
    mapping(bytes32 caseIdHash => address[] auditors) private receiptAuditors;
    mapping(bytes32 caseIdHash => mapping(address auditor => bytes32 keyHash)) private receiptAuditorKeyHashes;

    address public immutable bountyToken;
    bool private entered;

    error ApprovalAlreadyRecorded();
    error AuditorKeyChanged();
    error AuditorQuorumNotMet();
    error BundleTooLarge();
    error CaseAlreadyExists();
    error CaseCapacityReached();
    error CaseNotFound();
    error DeadlineExpired();
    error DeadlineNotMissed();
    error DuplicateAuthority();
    error InsufficientProgramPool();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidBundle();
    error InvalidConfiguration();
    error InvalidHash();
    error InvalidPqSignature();
    error InvalidStatus();
    error InvalidToken();
    error NotAuditor();
    error NotProgram();
    error NotRelayer();
    error PayoutCommitmentMismatch();
    error PolicyDisabled();
    error PolicyNotFound();
    error PqcPrecompileUnavailable();
    error ProgramKeyChanged();
    error Reentrancy();
    error ReporterKeyChanged();
    error TokenBalanceMismatch();
    error TokenTransferFailed();

    event ProgramPolicyConfigured(
        address indexed program,
        uint8 auditorThreshold,
        uint16 maxOpenCases,
        uint256 reservePerCase,
        uint64 acknowledgePeriod,
        uint64 triagePeriod,
        uint64 embargoPeriod
    );
    event ProgramPolicyStatusChanged(address indexed program, bool enabled);
    event ProgramPoolDeposited(address indexed program, uint256 amount, uint256 availablePool);
    event ProgramPoolWithdrawn(address indexed program, uint256 amount, uint256 availablePool);
    event FundedAnonymousCaseSubmitted(
        bytes32 indexed caseIdHash,
        address indexed program,
        address indexed relayer,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 bundleHash,
        bytes32 reporterPqKeyHash,
        bytes32 payoutCommitment,
        uint256 reservedAmount,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil,
        uint8 auditorThreshold
    );
    event EncryptedBundlePublished(bytes32 indexed caseIdHash, bytes32 indexed bundleHash, bytes encryptedBundle);
    event DeadlineBreached(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 deadline, uint64 recordedAt);
    event CaseEscalated(bytes32 indexed caseIdHash, uint8 indexed breach, uint64 timestamp);
    event CaseAcknowledged(bytes32 indexed caseIdHash, uint64 timestamp);
    event CaseTriaged(bytes32 indexed caseIdHash, uint64 timestamp);
    event CaseResolved(bytes32 indexed caseIdHash, uint64 timestamp);
    event QuorumApprovalRecorded(
        bytes32 indexed caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        uint8 auditorApprovals,
        bytes32 approvalHash,
        bytes32 rationaleHash
    );
    event BountyReleased(bytes32 indexed caseIdHash, address indexed recipient, uint256 amount);
    event ProgramPoolRemainderReturned(bytes32 indexed caseIdHash, address indexed program, uint256 amount);
    event DecisionDeadlineSet(bytes32 indexed caseIdHash, uint64 decisionBy);
    event ProgramDecisionGraceConfigured(address indexed program, uint64 decisionGracePeriod);
    event CaseRejected(bytes32 indexed caseIdHash, uint256 returnedReserve, uint8 auditorApprovals, bytes32 rejectionHash, bytes32 rationaleHash, uint64 timestamp);
    event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp);

    constructor(address trustedBountyToken) {
        if (trustedBountyToken == address(0)) revert InvalidAddress();
        if (trustedBountyToken.code.length == 0) revert InvalidToken();
        bountyToken = trustedBountyToken;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    modifier existing(bytes32 caseIdHash) {
        if (!receipts[caseIdHash].exists) revert CaseNotFound();
        _;
    }

    modifier onlyProgram(bytes32 caseIdHash) {
        if (msg.sender != receipts[caseIdHash].program) revert NotProgram();
        _;
    }

    function configureProgramPolicy(
        address[] calldata auditors,
        uint8 auditorThreshold,
        address[] calldata relayers,
        uint256 reservePerCase,
        uint16 maxOpenCases,
        uint64 acknowledgePeriod,
        uint64 triagePeriod,
        uint64 embargoPeriod
    ) external {
        _configureProgramPolicy(auditors, auditorThreshold, relayers, reservePerCase, maxOpenCases,
            acknowledgePeriod, triagePeriod, embargoPeriod, DECISION_GRACE_PERIOD);
    }

    function configureProgramPolicyWithDecisionGrace(
        address[] calldata auditors,
        uint8 auditorThreshold,
        address[] calldata relayers,
        uint256 reservePerCase,
        uint16 maxOpenCases,
        uint64 acknowledgePeriod,
        uint64 triagePeriod,
        uint64 embargoPeriod,
        uint64 decisionGracePeriod
    ) external {
        _configureProgramPolicy(auditors, auditorThreshold, relayers, reservePerCase, maxOpenCases,
            acknowledgePeriod, triagePeriod, embargoPeriod, decisionGracePeriod);
    }

    function _configureProgramPolicy(
        address[] calldata auditors,
        uint8 auditorThreshold,
        address[] calldata relayers,
        uint256 reservePerCase,
        uint16 maxOpenCases,
        uint64 acknowledgePeriod,
        uint64 triagePeriod,
        uint64 embargoPeriod,
        uint64 decisionGracePeriod
    ) private {
        if (
            auditors.length == 0 || auditors.length > MAX_AUDITORS ||
            auditorThreshold == 0 || auditorThreshold > auditors.length ||
            relayers.length == 0 || relayers.length > MAX_RELAYERS ||
            reservePerCase == 0 || maxOpenCases == 0 ||
            acknowledgePeriod == 0 || triagePeriod <= acknowledgePeriod || embargoPeriod < triagePeriod ||
            embargoPeriod > MAX_POLICY_PERIOD || decisionGracePeriod == 0 || decisionGracePeriod > MAX_POLICY_PERIOD
        ) revert InvalidConfiguration();

        _registeredPqKey(msg.sender);
        ProgramPolicy storage policy = policies[msg.sender];
        if (policy.openCases > maxOpenCases) revert InvalidConfiguration();

        _clearPolicyMembers(msg.sender);
        for (uint256 i = 0; i < auditors.length; ++i) {
            address auditor = auditors[i];
            if (auditor == address(0) || auditor == msg.sender || policyAuditorMembers[msg.sender][auditor]) {
                revert DuplicateAuthority();
            }
            _registeredPqKey(auditor);
            policyAuditorMembers[msg.sender][auditor] = true;
            policyAuditors[msg.sender].push(auditor);
        }
        for (uint256 i = 0; i < relayers.length; ++i) {
            address relayer = relayers[i];
            if (
                relayer == address(0) || relayer == msg.sender ||
                policyAuditorMembers[msg.sender][relayer] || policyRelayerMembers[msg.sender][relayer]
            ) revert DuplicateAuthority();
            _registeredPqKey(relayer);
            policyRelayerMembers[msg.sender][relayer] = true;
            policyRelayers[msg.sender].push(relayer);
        }

        policy.exists = true;
        policy.enabled = true;
        policy.auditorThreshold = auditorThreshold;
        policy.maxOpenCases = maxOpenCases;
        policy.acknowledgePeriod = acknowledgePeriod;
        policy.triagePeriod = triagePeriod;
        policy.embargoPeriod = embargoPeriod;
        policy.decisionGracePeriod = decisionGracePeriod;
        policy.reservePerCase = reservePerCase;

        emit ProgramPolicyConfigured(
            msg.sender, auditorThreshold, maxOpenCases, reservePerCase,
            acknowledgePeriod, triagePeriod, embargoPeriod
        );
        emit ProgramDecisionGraceConfigured(msg.sender, decisionGracePeriod);
    }

    function programDecisionGracePeriod(address program) external view returns (uint64) {
        return policies[program].decisionGracePeriod;
    }

    function setProgramPolicyEnabled(bool enabled) external {
        ProgramPolicy storage policy = policies[msg.sender];
        if (!policy.exists) revert PolicyNotFound();
        policy.enabled = enabled;
        emit ProgramPolicyStatusChanged(msg.sender, enabled);
    }

    function depositProgramPool(uint256 amount) external nonReentrant {
        ProgramPolicy storage policy = policies[msg.sender];
        if (!policy.exists) revert PolicyNotFound();
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = IERC20LikeV5(bountyToken).balanceOf(address(this));
        _safeTransferFrom(bountyToken, msg.sender, address(this), amount);
        uint256 afterBalance = IERC20LikeV5(bountyToken).balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert TokenBalanceMismatch();
        policy.availablePool += amount;
        emit ProgramPoolDeposited(msg.sender, amount, policy.availablePool);
    }

    function withdrawProgramPool(uint256 amount) external nonReentrant {
        ProgramPolicy storage policy = policies[msg.sender];
        if (!policy.exists) revert PolicyNotFound();
        if (amount == 0 || amount > policy.availablePool) revert InvalidAmount();
        policy.availablePool -= amount;
        _safeTransfer(bountyToken, msg.sender, amount);
        emit ProgramPoolWithdrawn(msg.sender, amount, policy.availablePool);
    }

    function submitFundedAnonymousCase(
        address program,
        bytes32 caseIdHash,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 programRef,
        bytes32 reporterPqKeyHash,
        bytes32 payoutCommitment,
        bytes calldata encryptedBundle
    ) external {
        ProgramPolicy storage policy = policies[program];
        if (!policy.exists) revert PolicyNotFound();
        if (!policy.enabled) revert PolicyDisabled();
        if (!policyRelayerMembers[program][msg.sender]) revert NotRelayer();
        if (policy.openCases >= policy.maxOpenCases) revert CaseCapacityReached();
        if (policy.availablePool < policy.reservePerCase) revert InsufficientProgramPool();
        if (receipts[caseIdHash].exists) revert CaseAlreadyExists();
        if (
            caseIdHash == bytes32(0) || envelopeHash == bytes32(0) || contentCommitment == bytes32(0) ||
            reporterPqKeyHash == bytes32(0) || payoutCommitment == bytes32(0)
        ) revert InvalidHash();
        if (encryptedBundle.length == 0) revert InvalidBundle();
        if (encryptedBundle.length > MAX_BUNDLE_BYTES) revert BundleTooLarge();

        bytes32 bundleHash = sha256(encryptedBundle);
        CaseReceipt storage receipt = receipts[caseIdHash];
        receipt.exists = true;
        receipt.program = program;
        receipt.relayer = msg.sender;
        receipt.envelopeHash = envelopeHash;
        receipt.contentCommitment = contentCommitment;
        receipt.bundleHash = bundleHash;
        receipt.reporterPqKeyHash = reporterPqKeyHash;
        receipt.programPqKeyHash = keccak256(_registeredPqKey(program));
        receipt.payoutCommitment = payoutCommitment;
        receipt.programRef = programRef;
        receipt.escrowedAmount = policy.reservePerCase;
        receipt.submittedAt = uint64(block.timestamp);
        receipt.acknowledgeBy = uint64(block.timestamp) + policy.acknowledgePeriod;
        receipt.triageBy = uint64(block.timestamp) + policy.triagePeriod;
        receipt.decisionBy = receipt.triageBy + policy.decisionGracePeriod;
        receipt.embargoUntil = uint64(block.timestamp) + policy.embargoPeriod;
        receipt.status = Status.Submitted;
        receipt.auditorThreshold = policy.auditorThreshold;

        address[] storage auditors = policyAuditors[program];
        address[] memory snapshot = new address[](auditors.length);
        for (uint256 i = 0; i < auditors.length; ++i) {
            address auditor = auditors[i];
            snapshot[i] = auditor;
            receiptAuditors[caseIdHash].push(auditor);
            receiptAuditorKeyHashes[caseIdHash][auditor] = keccak256(_registeredPqKey(auditor));
        }
        receipt.auditorSetHash = keccak256(abi.encode(snapshot, policy.auditorThreshold));

        policy.availablePool -= policy.reservePerCase;
        policy.openCases += 1;

        emit FundedAnonymousCaseSubmitted(
            caseIdHash, program, msg.sender, envelopeHash, contentCommitment, bundleHash,
            reporterPqKeyHash, payoutCommitment, receipt.escrowedAmount,
            receipt.acknowledgeBy, receipt.triageBy, receipt.embargoUntil, receipt.auditorThreshold
        );
        emit EncryptedBundlePublished(caseIdHash, bundleHash, encryptedBundle);
        emit DecisionDeadlineSet(caseIdHash, receipt.decisionBy);
    }

    function acknowledgeCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (receipt.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp > receipt.acknowledgeBy) revert DeadlineExpired();
        receipt.acknowledgedAt = uint64(block.timestamp);
        receipt.status = Status.Acknowledged;
        emit CaseAcknowledged(caseIdHash, uint64(block.timestamp));
    }

    function triageCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (receipt.status != Status.Acknowledged) revert InvalidStatus();
        if (block.timestamp > receipt.triageBy) revert DeadlineExpired();
        receipt.triagedAt = uint64(block.timestamp);
        receipt.status = Status.Triaged;
        emit CaseTriaged(caseIdHash, uint64(block.timestamp));
    }

    function resolveCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (receipt.status != Status.Triaged) revert InvalidStatus();
        if (block.timestamp > receipt.decisionBy) revert DeadlineExpired();
        receipt.resolvedAt = uint64(block.timestamp);
        receipt.status = Status.Resolved;
        emit CaseResolved(caseIdHash, uint64(block.timestamp));
    }

    function escalateMissedDeadline(bytes32 caseIdHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        uint8 breach;
        if (receipt.status == Status.Submitted && block.timestamp > receipt.acknowledgeBy) {
            breach = ACKNOWLEDGEMENT_BREACH;
        } else if (receipt.status == Status.Acknowledged && block.timestamp > receipt.triageBy) {
            breach = TRIAGE_BREACH;
        } else if (
            (receipt.status == Status.Triaged || receipt.status == Status.Resolved) &&
            receipt.approvalHash == bytes32(0) && block.timestamp > receipt.decisionBy
        ) {
            breach = DECISION_BREACH;
        } else {
            revert DeadlineNotMissed();
        }
        _recordDeadlineBreaches(caseIdHash, receipt);
        receipt.status = Status.Escalated;
        emit CaseEscalated(caseIdHash, breach, uint64(block.timestamp));
    }

    function approveAnonymousSeverity(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        address payoutRecipient,
        bytes32 payoutSalt,
        bytes calldata reporterPqKey,
        bytes calldata participantPqSignature,
        address[] calldata auditorSigners,
        bytes[] calldata auditorPqSignatures
    ) external existing(caseIdHash) nonReentrant {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (
            receipt.status != Status.Triaged && receipt.status != Status.Resolved &&
            receipt.status != Status.Escalated
        ) revert InvalidStatus();
        if (receipt.approvalHash != bytes32(0)) revert ApprovalAlreadyRecorded();
        if (receipt.status != Status.Escalated && block.timestamp > receipt.decisionBy) revert DeadlineExpired();
        if (
            severity == Severity.Unset || payoutAmount == 0 || payoutAmount > receipt.escrowedAmount ||
            rationaleHash == bytes32(0) || payoutRecipient == address(0) || participantPqSignature.length == 0
        ) revert InvalidAmount();
        if (payoutCommitmentOf(caseIdHash, payoutRecipient, payoutSalt) != receipt.payoutCommitment) {
            revert PayoutCommitmentMismatch();
        }

        bytes memory participantPqKey;
        if (receipt.status == Status.Escalated) {
            if (keccak256(reporterPqKey) != receipt.reporterPqKeyHash) revert ReporterKeyChanged();
            participantPqKey = reporterPqKey;
        } else {
            participantPqKey = _registeredPqKey(receipt.program);
            if (keccak256(participantPqKey) != receipt.programPqKeyHash) revert ProgramKeyChanged();
        }

        bytes32 digest = approvalDigest(caseIdHash, severity, payoutAmount, rationaleHash, payoutRecipient);
        bytes memory message = bytes.concat(QORESIGN_MESSAGE_PREFIX, abi.encodePacked(digest));
        if (!_verifyPq(participantPqKey, participantPqSignature, message)) revert InvalidPqSignature();
        uint8 approvals = _verifyAuditorQuorum(
            caseIdHash, receipt, auditorSigners, auditorPqSignatures, message
        );
        _release(caseIdHash, receipt, severity, payoutAmount, rationaleHash, payoutRecipient, digest, approvals);
    }

    /// @notice The snapshotted auditor quorum may reject an invalid report without a program or reporter veto.
    /// @dev A separate signed domain authorizes only returning the full reserve, never a bounty payment.
    function rejectAnonymousCase(
        bytes32 caseIdHash,
        bytes32 rationaleHash,
        address[] calldata auditorSigners,
        bytes[] calldata auditorPqSignatures
    ) external existing(caseIdHash) nonReentrant {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (receipt.approvalHash != bytes32(0)) revert ApprovalAlreadyRecorded();
        if (receipt.status == Status.Disclosed || receipt.status == Status.Rejected) revert InvalidStatus();
        if (rationaleHash == bytes32(0)) revert InvalidHash();
        bytes32 digest = rejectionDigest(caseIdHash, rationaleHash);
        bytes memory message = bytes.concat(QORESIGN_MESSAGE_PREFIX, abi.encodePacked(digest));
        uint8 approvals = _verifyAuditorQuorum(caseIdHash, receipt, auditorSigners, auditorPqSignatures, message);
        _recordDeadlineBreaches(caseIdHash, receipt);
        uint256 reserve = receipt.escrowedAmount;
        receipt.approvalHash = digest;
        receipt.escrowedAmount = 0;
        receipt.resolvedAt = uint64(block.timestamp);
        receipt.status = Status.Rejected;
        _releaseCapacity(receipt);
        policies[receipt.program].availablePool += reserve;
        emit ProgramPoolRemainderReturned(caseIdHash, receipt.program, reserve);
        emit CaseRejected(caseIdHash, reserve, approvals, digest, rationaleHash, uint64(block.timestamp));
    }

    function rejectionDigest(bytes32 caseIdHash, bytes32 rationaleHash)
        public view existing(caseIdHash) returns (bytes32)
    {
        CaseReceipt storage receipt = receipts[caseIdHash];
        return keccak256(abi.encode(
            REJECTION_TYPEHASH, block.chainid, address(this), caseIdHash,
            receipt.envelopeHash, receipt.contentCommitment, receipt.bundleHash,
            receipt.auditorSetHash, receipt.escrowedAmount, rationaleHash
        ));
    }

    function decisionState(bytes32 caseIdHash) external view existing(caseIdHash)
        returns (uint64 decisionBy, bool decisionMissed)
    {
        CaseReceipt storage receipt = receipts[caseIdHash];
        return (receipt.decisionBy, receipt.approvalHash == bytes32(0) &&
            (receipt.status == Status.Triaged || receipt.status == Status.Resolved) &&
            block.timestamp > receipt.decisionBy);
    }

    function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        if (receipt.status != Status.Resolved || receipt.approvalHash == bytes32(0)) revert InvalidStatus();
        if (block.timestamp < receipt.embargoUntil) revert DeadlineExpired();
        if (redactedReportHash == bytes32(0)) revert InvalidHash();
        if (msg.sender != receipt.program && receiptAuditorKeyHashes[caseIdHash][msg.sender] == bytes32(0)) {
            revert NotAuditor();
        }
        receipt.redactedReportHash = redactedReportHash;
        receipt.disclosedAt = uint64(block.timestamp);
        receipt.status = Status.Disclosed;
        emit CaseDisclosed(caseIdHash, redactedReportHash, uint64(block.timestamp));
    }

    function approvalDigest(
        bytes32 caseIdHash,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        address payoutRecipient
    ) public view existing(caseIdHash) returns (bytes32) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        return keccak256(abi.encode(
            APPROVAL_TYPEHASH,
            block.chainid,
            address(this),
            caseIdHash,
            receipt.envelopeHash,
            receipt.contentCommitment,
            receipt.bundleHash,
            receipt.auditorSetHash,
            uint8(severity),
            payoutAmount,
            rationaleHash,
            payoutRecipient
        ));
    }

    function payoutCommitmentOf(bytes32 caseIdHash, address payoutRecipient, bytes32 salt)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(PAYOUT_COMMITMENT_TYPEHASH, caseIdHash, payoutRecipient, salt));
    }

    function programPolicyState(address program) external view returns (
        bool exists,
        bool enabled,
        uint256 availablePool,
        uint256 reservePerCase,
        uint16 maxOpenCases,
        uint16 openCases,
        uint8 auditorThreshold,
        uint256 auditorCount,
        uint256 relayerCount,
        uint64 acknowledgePeriod,
        uint64 triagePeriod,
        uint64 embargoPeriod
    ) {
        ProgramPolicy storage policy = policies[program];
        return (
            policy.exists, policy.enabled, policy.availablePool, policy.reservePerCase,
            policy.maxOpenCases, policy.openCases, policy.auditorThreshold,
            policyAuditors[program].length, policyRelayers[program].length,
            policy.acknowledgePeriod, policy.triagePeriod, policy.embargoPeriod
        );
    }

    function programAuditors(address program) external view returns (address[] memory) {
        return policyAuditors[program];
    }

    function programRelayers(address program) external view returns (address[] memory) {
        return policyRelayers[program];
    }

    function caseAuditors(bytes32 caseIdHash) external view existing(caseIdHash) returns (address[] memory) {
        return receiptAuditors[caseIdHash];
    }

    function caseState(bytes32 caseIdHash) external view existing(caseIdHash) returns (
        Status status,
        Severity severity,
        uint8 slaBreaches,
        uint256 escrowedAmount,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil,
        address program,
        address relayer,
        bytes32 approvalHash,
        bytes32 redactedReportHash,
        bytes32 bundleHash,
        uint8 auditorThreshold
    ) {
        CaseReceipt storage receipt = receipts[caseIdHash];
        return (
            receipt.status, receipt.severity, receipt.slaBreaches, receipt.escrowedAmount,
            receipt.acknowledgeBy, receipt.triageBy, receipt.embargoUntil,
            receipt.program, receipt.relayer, receipt.approvalHash, receipt.redactedReportHash,
            receipt.bundleHash, receipt.auditorThreshold
        );
    }

    function _verifyAuditorQuorum(
        bytes32 caseIdHash,
        CaseReceipt storage receipt,
        address[] calldata auditorSigners,
        bytes[] calldata auditorPqSignatures,
        bytes memory message
    ) private view returns (uint8 approvals) {
        if (auditorSigners.length != auditorPqSignatures.length) revert AuditorQuorumNotMet();
        for (uint256 i = 0; i < auditorSigners.length; ++i) {
            address auditor = auditorSigners[i];
            bytes32 expectedKeyHash = receiptAuditorKeyHashes[caseIdHash][auditor];
            if (expectedKeyHash == bytes32(0)) revert NotAuditor();
            for (uint256 j = 0; j < i; ++j) {
                if (auditorSigners[j] == auditor) revert DuplicateAuthority();
            }
            bytes memory auditorPqKey = _registeredPqKey(auditor);
            if (keccak256(auditorPqKey) != expectedKeyHash) revert AuditorKeyChanged();
            if (!_verifyPq(auditorPqKey, auditorPqSignatures[i], message)) revert InvalidPqSignature();
            approvals += 1;
        }
        if (approvals < receipt.auditorThreshold) revert AuditorQuorumNotMet();
    }

    function _release(
        bytes32 caseIdHash,
        CaseReceipt storage receipt,
        Severity severity,
        uint256 payoutAmount,
        bytes32 rationaleHash,
        address payoutRecipient,
        bytes32 digest,
        uint8 auditorApprovals
    ) private {
        uint256 remainder = receipt.escrowedAmount - payoutAmount;
        receipt.approvalHash = digest;
        receipt.severity = severity;
        receipt.payoutAmount = payoutAmount;
        receipt.escrowedAmount = 0;
        receipt.resolvedAt = uint64(block.timestamp);
        receipt.status = Status.Resolved;
        _releaseCapacity(receipt);
        if (remainder > 0) {
            policies[receipt.program].availablePool += remainder;
            emit ProgramPoolRemainderReturned(caseIdHash, receipt.program, remainder);
        }
        _safeTransfer(bountyToken, payoutRecipient, payoutAmount);
        emit QuorumApprovalRecorded(
            caseIdHash, severity, payoutAmount, auditorApprovals, digest, rationaleHash
        );
        emit BountyReleased(caseIdHash, payoutRecipient, payoutAmount);
        emit CaseResolved(caseIdHash, uint64(block.timestamp));
    }

    function _releaseCapacity(CaseReceipt storage receipt) private {
        if (receipt.capacityReleased) return;
        receipt.capacityReleased = true;
        ProgramPolicy storage policy = policies[receipt.program];
        if (policy.openCases > 0) policy.openCases -= 1;
    }

    function _recordDeadlineBreaches(bytes32 caseIdHash, CaseReceipt storage receipt) private {
        _recordDecisionBreach(caseIdHash, receipt);
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

    function _recordDecisionBreach(bytes32 caseIdHash, CaseReceipt storage receipt) private {
        if (receipt.approvalHash == bytes32(0) &&
            (receipt.status == Status.Triaged || receipt.status == Status.Resolved) &&
            block.timestamp > receipt.decisionBy && (receipt.slaBreaches & DECISION_BREACH) == 0) {
            receipt.slaBreaches |= DECISION_BREACH;
            emit DeadlineBreached(caseIdHash, DECISION_BREACH, receipt.decisionBy, uint64(block.timestamp));
        }
    }

    function _clearPolicyMembers(address program) private {
        address[] storage oldAuditors = policyAuditors[program];
        for (uint256 i = 0; i < oldAuditors.length; ++i) {
            delete policyAuditorMembers[program][oldAuditors[i]];
        }
        delete policyAuditors[program];
        address[] storage oldRelayers = policyRelayers[program];
        for (uint256 i = 0; i < oldRelayers.length; ++i) {
            delete policyRelayerMembers[program][oldRelayers[i]];
        }
        delete policyRelayers[program];
    }

    function _registeredPqKey(address account) internal view virtual returns (bytes memory pubkey) {
        (bool success, bytes memory data) = PQC_KEY_STATUS_PRECOMPILE.staticcall(
            abi.encodeCall(IQorePQCKeyStatusV5.pqcKeyStatus, (account))
        );
        if (!success || data.length == 0) revert PqcPrecompileUnavailable();
        (bool registered, uint8 algorithmId, bytes memory registeredKey) = abi.decode(data, (bool, uint8, bytes));
        if (!registered || algorithmId != ML_DSA_87_ALGORITHM_ID || registeredKey.length == 0) {
            revert PqcPrecompileUnavailable();
        }
        return registeredKey;
    }

    function _verifyPq(bytes memory pubkey, bytes calldata signature, bytes memory message)
        internal view virtual returns (bool)
    {
        (bool success, bytes memory data) = PQC_VERIFY_PRECOMPILE.staticcall(
            abi.encodeCall(IQorePQCVerifyV5.pqcVerify, (pubkey, signature, message))
        );
        if (!success || data.length < 32) revert PqcPrecompileUnavailable();
        return abi.decode(data, (bool));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20LikeV5.transfer, (to, amount)));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert TokenTransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        if (token.code.length == 0) revert InvalidToken();
        (bool success, bytes memory data) = token.call(
            abi.encodeCall(IERC20LikeV5.transferFrom, (from, to, amount))
        );
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert TokenTransferFailed();
        }
    }
}
