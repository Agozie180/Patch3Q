# Architecture

Patch3Q has three layers:

1. The browser creates a salted confidential payload and seals it to maintainer and auditor recipients with QoreSeal.
2. QoreSign binds the auditor's ML-DSA-87 and secp256k1 signatures to the chain, registry, case, evidence commitments, severity, rationale, and payout.
3. `Patch3QRegistry` verifies the ML-DSA signature with QoreChain's PQC precompile, records lifecycle and SLA breaches, escrows one immutable trusted token, releases an approved payout, and anchors a redacted-disclosure hash.

The encrypted bundle and redacted report remain off-chain. Only hashes, public deadlines, roles, amounts, and lifecycle events are public.

The QoreChain EVM lane is quantum-ready through a PQ-authorized EVM window. Patch3Q does not treat that window as the severity decision: the registry separately calls `IQorePQC.pqcVerify` at `0x0000000000000000000000000000000000000a01` and releases escrow only when the bound auditor's registered ML-DSA-87 key verifies the exact approval digest.
