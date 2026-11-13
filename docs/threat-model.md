# Threat model

Patch3Q is designed to reduce the impact of mailbox or storage compromise, establish report ordering, make response deadlines auditable, and prevent a classical signing key alone from producing an accepted severity approval.

## Protected

- Report and PoC confidentiality while stored as a QoreSeal envelope.
- Independent maintainer and auditor recovery.
- Ciphertext, authenticated-metadata, commitment, and case-binding integrity.
- Severity and payout binding through an ML-DSA-87 hybrid signature verified by the QorePQC EVM precompile.
- Escrow release limits, distinct reporter/program/auditor roles, an immutable bounty token, and exact token accounting.
- Replay protection across cases, registry deployments, and EVM chains.
- Authenticated bundle metadata, including recipient roles, seal mode, anonymity setting, deadlines, and approval authority.

## Not hidden

Timing, envelope size, addresses, recipient authority, deadlines, token amounts, transaction activity, and the fact that a disclosure exists are public metadata. QoreSeal's anonymous recipient hints do not make the surrounding Patch3Q workflow metadata-private.

## Residual limits

The EVM authorization window limits use of a stolen classical transaction key, but it is not treated as the approval itself. Payout still requires a separate valid ML-DSA signature over the exact Patch3Q approval digest.

Deadline enforcement is permissionless but not autonomous. A researcher, auditor, or keeper must submit the enforcement transaction after the timestamp. If no bounty was funded before a program ghosts, escalation cannot manufacture funds.

## Out of scope

Compromised browsers before sealing, stolen recipient vaults, malicious recipients, unsafe redaction, denial of ciphertext availability, chain or precompile failure, timestamp manipulation within normal block-production bounds, and vulnerabilities in unaudited dependencies or contracts remain out of scope for this prototype.

The lockfile uses targeted overrides to remove known moderate/high advisories in unused wallet-connector branches.
Those Zod overrides intentionally violate peer ranges in Coinbase and WalletConnect internals that Patch3Q does not
enable. Enabling those connectors requires separate compatibility testing. A low-severity unpatched `deepmerge`
advisory remains through RainbowKit's Vanilla Extract styling dependency.
