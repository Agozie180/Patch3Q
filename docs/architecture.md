# Architecture

Patch3Q has three layers:

1. **Browser.** It builds a salted confidential payload that contains the report, the PoC and, in anonymous mode, the
   sealed payout opening. It pads the payload to a size bucket and seals it with QoreSeal (ML-KEM-1024) to recipient
   keys published on QoreChain's PQC key registry. The bundle's AAD authenticates the roles, the deadlines, the
   privacy profile and the approval authorities.
2. **QoreSign.** Two independent ML-DSA-87 + secp256k1 signatures bind the chain, the registry, the case, the evidence
   commitments, the severity, the amount, the salted rationale hash and, in anonymous mode, the payout recipient.
3. **`Patch3QRegistry`.** It snapshots the program and auditor ML-DSA keys, plus the reporter key or its hash, at
   submission. It records the lifecycle and SLA breaches and moves missed cases to `Escalated`. It escrows one
   immutable token, verifies both signatures with `IQorePQC.pqcVerify` at `0x…0A01`, opens the payout commitment, pays
   the recipient, and anchors a hash of the redacted disclosure.

## Two reporter modes

| | Account mode | Anonymous mode (default) |
| --- | --- | --- |
| Anchors the case | Reporter wallet | Any relayer (`submitAnonymousCase`) |
| Reporter on-chain | Address + registered PQ key | `keccak256` of a per-case ML-DSA-87 key |
| Payout recipient | Reporter address | Sealed address, opened at release |
| Release call | `approveSeverity` | `approveAnonymousSeverity` |
| Cancel before acknowledgement | Reporter | Not available. There is no reporter account |

The EVM lane is protected by PQ-authorized windows opened with hybrid native transactions. The windows for the auditor
and the relayer are scoped to the registry. Patch3Q never treats a window as the severity decision. Only the two
precompile-verified ML-DSA-87 signatures release funds.
