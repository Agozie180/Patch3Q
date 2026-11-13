# Architecture

Patch3Q has three layers:

1. The browser creates a salted confidential payload and seals it to maintainer and auditor recipients with QoreSeal.
2. QoreSign binds the auditor's ML-DSA-87 and secp256k1 signatures to the case, evidence commitments, severity, and payout.
3. `Patch3QRegistry` records lifecycle deadlines, escrows an ERC-20 bounty, releases an approved payout, and anchors a redacted-disclosure hash.

The encrypted bundle and redacted report remain off-chain. Only hashes, public deadlines, roles, amounts, and lifecycle events are public.

The QoreChain EVM lane is quantum-ready through a PQ-authorized EVM window. It does not carry the native lane's hybrid signature inside an Ethereum transaction, so the Solidity contract anchors the already-verified QoreSign approval hash rather than claiming to verify ML-DSA itself.
