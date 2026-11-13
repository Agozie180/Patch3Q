// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Patch3QRegistry
/// @notice Public receipts, deadlines, and bounty escrow for encrypted vulnerability disclosures.
/// @dev Report plaintext, exploit material, salts, and decryption keys must never be submitted here.
contract Patch3QRegistry {
    enum Status { Submitted, Acknowledged, Triaged, Resolved, Disclosed, Cancelled }
    enum Severity { Unset, Informational, Low, Medium, High, Critical }

    struct CaseReceipt {
        bool exists;
        address reporter;
        address program;
        address auditor;
        address bountyToken;
        bytes32 envelopeHash;
        bytes32 contentCommitment;
        bytes32 approvalAuthorityHash;
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
    }

    mapping(bytes32 caseIdHash => CaseReceipt receipt) public cases;
    bool private entered;

    error CaseAlreadyExists();
    error CaseNotFound();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidHash();
    error InvalidStatus();
    error InvalidToken();
    error NotAuditor();
    error NotProgram();
    error NotReporter();
    error NotParticipant();
    error ApprovalAlreadyRecorded();
    error EmbargoActive();
    error NothingToRefund();
    error Reentrancy();
    error TokenTransferFailed();

    event CaseSubmitted(
        bytes32 indexed caseIdHash,
        address indexed reporter,
        address indexed program,
        address auditor,
        bytes32 envelopeHash,
        bytes32 contentCommitment,
        bytes32 approvalAuthorityHash,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil
    );
    event CaseAcknowledged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla);
    event CaseTriaged(bytes32 indexed caseIdHash, uint64 timestamp, bool withinSla);
    event CaseResolved(bytes32 indexed caseIdHash, uint64 timestamp);
    event BountyFunded(bytes32 indexed caseIdHash, address indexed token, uint256 amount, uint256 escrowedTotal);
    event SeverityApproved(bytes32 indexed caseIdHash, Severity severity, uint256 payoutAmount, bytes32 approvalHash, uint64 timestamp);
    event BountyReleased(bytes32 indexed caseIdHash, address indexed reporter, address indexed token, uint256 amount);
    event EscrowRefunded(bytes32 indexed caseIdHash, address indexed program, address indexed token, uint256 amount);
    event CaseDisclosed(bytes32 indexed caseIdHash, bytes32 redactedReportHash, uint64 timestamp);
    event CaseCancelled(bytes32 indexed caseIdHash, uint64 timestamp);

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
        bytes32 approvalAuthorityHash,
        bytes32 programRef,
        uint64 acknowledgeBy,
        uint64 triageBy,
        uint64 embargoUntil
    ) external {
        if (program == address(0) || auditor == address(0)) revert InvalidAddress();
        if (cases[caseIdHash].exists) revert CaseAlreadyExists();
        if (
            caseIdHash == bytes32(0) || envelopeHash == bytes32(0) ||
            contentCommitment == bytes32(0) || approvalAuthorityHash == bytes32(0)
        ) revert InvalidHash();
        if (acknowledgeBy <= block.timestamp || triageBy < acknowledgeBy || embargoUntil <= block.timestamp) {
            revert InvalidDeadline();
        }

        CaseReceipt storage receipt = cases[caseIdHash];
        receipt.exists = true;
        receipt.reporter = msg.sender;
        receipt.program = program;
        receipt.auditor = auditor;
        receipt.envelopeHash = envelopeHash;
        receipt.contentCommitment = contentCommitment;
        receipt.approvalAuthorityHash = approvalAuthorityHash;
        receipt.programRef = programRef;
        receipt.submittedAt = uint64(block.timestamp);
        receipt.acknowledgeBy = acknowledgeBy;
        receipt.triageBy = triageBy;
        receipt.embargoUntil = embargoUntil;
        receipt.status = Status.Submitted;

        emit CaseSubmitted(
            caseIdHash, msg.sender, program, auditor, envelopeHash, contentCommitment,
            approvalAuthorityHash, programRef, acknowledgeBy, triageBy, embargoUntil
        );
    }

    function acknowledgeCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Submitted) revert InvalidStatus();
        receipt.acknowledgedAt = uint64(block.timestamp);
        receipt.status = Status.Acknowledged;
        emit CaseAcknowledged(caseIdHash, uint64(block.timestamp), block.timestamp <= receipt.acknowledgeBy);
    }

    function triageCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Acknowledged) revert InvalidStatus();
        receipt.triagedAt = uint64(block.timestamp);
        receipt.status = Status.Triaged;
        emit CaseTriaged(caseIdHash, uint64(block.timestamp), block.timestamp <= receipt.triageBy);
    }

    function resolveCase(bytes32 caseIdHash) external existing(caseIdHash) onlyProgram(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status != Status.Triaged) revert InvalidStatus();
        receipt.resolvedAt = uint64(block.timestamp);
        receipt.status = Status.Resolved;
        emit CaseResolved(caseIdHash, uint64(block.timestamp));
    }

    function fundBounty(bytes32 caseIdHash, address token, uint256 amount)
        external existing(caseIdHash) onlyProgram(caseIdHash) nonReentrant
    {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (receipt.status == Status.Cancelled || receipt.status == Status.Disclosed) revert InvalidStatus();
        if (token == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (receipt.bountyToken == address(0)) receipt.bountyToken = token;
        else if (receipt.bountyToken != token) revert InvalidToken();

        _safeTransferFrom(token, msg.sender, address(this), amount);
        receipt.escrowedAmount += amount;
        emit BountyFunded(caseIdHash, token, amount, receipt.escrowedAmount);
    }

    /// @notice Records a hybrid-signed approval commitment and atomically releases its approved payout.
    /// @dev Clients verify approvalHash with QoreSign. QoreChain's EVM authorization window prevents
    ///      an ECDSA key alone from submitting this auditor-only call.
    function approveSeverity(bytes32 caseIdHash, Severity severity, uint256 payoutAmount, bytes32 approvalHash)
        external existing(caseIdHash) onlyAuditor(caseIdHash) nonReentrant
    {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (
            receipt.status != Status.Acknowledged &&
            receipt.status != Status.Triaged &&
            receipt.status != Status.Resolved
        ) revert InvalidStatus();
        if (receipt.approvalHash != bytes32(0)) revert ApprovalAlreadyRecorded();
        if (severity == Severity.Unset || payoutAmount == 0 || payoutAmount > receipt.escrowedAmount) {
            revert InvalidAmount();
        }
        if (approvalHash == bytes32(0)) revert InvalidHash();

        receipt.approvalHash = approvalHash;
        receipt.severity = severity;
        receipt.payoutAmount = payoutAmount;
        receipt.approvedAt = uint64(block.timestamp);
        receipt.escrowedAmount -= payoutAmount;
        _safeTransfer(receipt.bountyToken, receipt.reporter, payoutAmount);

        emit SeverityApproved(caseIdHash, severity, payoutAmount, approvalHash, uint64(block.timestamp));
        emit BountyReleased(caseIdHash, receipt.reporter, receipt.bountyToken, payoutAmount);
    }

    function discloseCase(bytes32 caseIdHash, bytes32 redactedReportHash) external existing(caseIdHash) {
        CaseReceipt storage receipt = cases[caseIdHash];
        if (msg.sender != receipt.reporter && msg.sender != receipt.program) revert NotParticipant();
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
        if (receipt.status != Status.Submitted) revert InvalidStatus();
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
        _safeTransfer(receipt.bountyToken, receipt.program, amount);
        emit EscrowRefunded(caseIdHash, receipt.program, receipt.bountyToken, amount);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20Like.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }
}

/// @notice Permissionless test token for demos only. Never use as a production stablecoin.
contract MockFUSD {
    string public constant name = "Patch3Q test fUSD";
    string public constant symbol = "fUSD";
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
