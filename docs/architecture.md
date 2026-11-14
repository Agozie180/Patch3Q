# Architecture

Patch3Q has three layers:

1. The browser creates a salted confidential payload and seals it to maintainer and auditor recipients with QoreSeal.
2. QoreSign binds two independent ML-DSA-87 and secp256k1 signatures to the chain, registry, case, evidence commitments, severity, rationale, and payout.
3. `Patch3QRegistry` verifies both ML-DSA signatures with QoreChain's PQC precompile, records lifecycle and SLA breaches, moves missed cases into an explicit `Escalated` state, escrows one immutable trusted token, releases an approved payout, and anchors a redacted-disclosure hash.

The encrypted bundle and redacted report remain off-chain. Only hashes, public deadlines, roles, amounts, and lifecycle events are public.

Deadline enforcement is deterministic and permissionless rather than autonomous: any account or keeper may submit the enforcement transaction after the timestamp. Normal payout requires program + auditor PQ signatures. An escalated case replaces the ghosted program with the reporter, so release requires reporter + auditor PQ signatures and cannot be decided by the auditor alone.

The QoreChain EVM lane is quantum-ready through a PQ-authorized EVM window. Patch3Q does not treat that window as the severity decision: the registry separately calls `IQorePQC.pqcVerify` at `0x0000000000000000000000000000000000000a01` twice and releases escrow only when both snapshotted registered ML-DSA-87 keys verify the exact approval digest.
