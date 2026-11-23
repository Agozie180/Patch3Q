# Architecture

Patch3Q has three layers and two compatible registry generations:

1. **Browser.** It builds a salted confidential payload that contains the report, the PoC and, in anonymous mode, the
   sealed payout opening. It pads the payload to a size bucket and seals it with QoreSeal (ML-KEM-1024) to recipient
   keys published on QoreChain's PQC key registry. The bundle's AAD authenticates the roles, the deadlines, the
   privacy profile and the approval authorities.
2. **QoreSign.** Hybrid ML-DSA-87 + secp256k1 signatures bind the chain, registry, case, evidence commitments,
   exact encrypted-bundle hash, auditor-set hash, severity, amount, salted rationale and payout recipient.
3. **Registries.** Live V3 snapshots one auditor. V4 snapshots an ordered auditor set and threshold, plus the reporter
   and program keys. Both record lifecycle and SLA breaches, verify ML-DSA-87 signatures with `IQorePQC.pqcVerify` at
   `0x…0A01`, open the payout commitment and pay the sealed recipient. V4 additionally reserves funds from a program
   pool and publishes exact encrypted-bundle bytes whose SHA-256 is part of the approval digest.

## Two reporter modes

| | Account mode | Anonymous mode (default) |
| --- | --- | --- |
| Anchors the case | Reporter wallet | Any relayer (`submitAnonymousCase`) |
| Reporter on-chain | Address + registered PQ key | `keccak256` of a per-case ML-DSA-87 key |
| Payout recipient | Reporter address | Sealed address, opened at release |
| Release call | `approveSeverity` | `approveAnonymousSeverity` |
| Cancel before acknowledgement | Reporter | Not available. There is no reporter account |

The EVM lane is protected by PQ-authorized windows opened with hybrid native transactions. Auditor and relayer windows
are scoped to the registry. Patch3Q never treats a window as the severity decision. Only the required participant plus
the snapshotted auditor threshold can release funds.

## Guarantee boundary

Patch3Q enforces consequences for a participating, pre-funded program; it is not a collection mechanism against an
unregistered vendor. V3 can prove an SLA breach before funding but cannot create money. V4 accepts a report only when
the program pool has enough available balance and atomically reserves that balance. A threshold of the snapshotted
auditor set remains intentionally required: one unavailable auditor no longer freezes a 2-of-3 case, while the
threshold prevents the reporter or program from unilaterally paying a fabricated claim.
