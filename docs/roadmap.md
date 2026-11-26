# Patch3Q roadmap

## Shipped on Diana

V5 supports encrypted reports, upfront bounty reservation, permissionless escalation after missed deadlines, and a quorum rejection path that returns the reserve. The testnet rehearsal completed five cases. [V5 review](v5-review.md#completed-live-rehearsal)

## Proposed next work, in priority order

| Priority | Work | Completion check |
| --- | --- | --- |
| 1 | Run a testnet rehearsal with separate program, researcher, and auditor operators. Document onboarding, key recovery, and how participants appeal a decision or handle an unavailable quorum. | The operators complete a normal payout and a missed-deadline case and rehearse an unavailable-quorum response. |
| 2 | Rehearse deadline enforcement and encrypted bundle recovery through RPC interruptions and retries. Give operators a way to spot overdue cases and reconcile the pool. | Operators recover the original bundle, escalate an overdue case, and verify the reserve and payout from receipts after an interruption. |
| 3 | Commission an independent review of escrow, signing, and recipient security before considering a pilot with real funds. | Findings that affect fund safety are resolved and checked against reproducible evidence. Pilot operators agree on funding limits and incident procedures. |

The scope stays with opt-in programs and funded pools. The current release covers testnet use. [Threat model](threat-model.md) · [Current operating boundaries](v5-review.md#trust-and-operating-boundaries)
