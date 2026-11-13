# Threat model

Patch3Q is designed to reduce the impact of mailbox or storage compromise, establish report ordering, make response deadlines auditable, and prevent a classical signing key alone from producing an accepted severity approval.

## Protected

- Report and PoC confidentiality while stored as a QoreSeal envelope.
- Independent maintainer and auditor recovery.
- Ciphertext, authenticated-metadata, commitment, and case-binding integrity.
- Severity and payout binding through an ML-DSA-87 hybrid signature verified by the QorePQC EVM precompile.
- Escrow release limits, distinct reporter/program/auditor roles, an immutable bounty token, and exact token accounting.
- Replay protection across cases, registry deployments, and EVM chains.

## Not hidden

Timing, envelope size, addresses, deadlines, token amounts, transaction activity, and the fact that a disclosure exists are public metadata.

## Residual limits

The EVM authorization window limits use of a stolen classical transaction key, but it is not treated as the approval itself. Payout still requires a separate valid ML-DSA signature over the exact Patch3Q approval digest.

## Out of scope

Compromised browsers before sealing, stolen recipient vaults, malicious recipients, unsafe redaction, denial of ciphertext availability, and vulnerabilities in unaudited dependencies or contracts remain out of scope for this prototype.
