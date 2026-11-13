# Threat model

Patch3Q is designed to reduce the impact of mailbox or storage compromise, establish report ordering, make response deadlines auditable, and prevent a classical signing key alone from producing an accepted severity approval.

## Protected

- Report and PoC confidentiality while stored as a QoreSeal envelope.
- Independent maintainer and auditor recovery.
- Ciphertext, authenticated-metadata, commitment, and case-binding integrity.
- Severity and payout binding through an ML-DSA-87 hybrid signature.
- Escrow release limits and role separation in the registry contract.

## Not hidden

Timing, envelope size, addresses, deadlines, token amounts, transaction activity, and the fact that a disclosure exists are public metadata.

## Out of scope

Compromised browsers before sealing, stolen recipient vaults, malicious recipients, unsafe redaction, denial of ciphertext availability, and vulnerabilities in unaudited dependencies or contracts remain out of scope for this prototype.
