# Testnet evidence checklist

Patch3Q must not be described as testnet-complete until every required item below has a public value and can be
independently replayed on QoreChain Diana.

| Evidence | Current status | Required proof |
| --- | --- | --- |
| Registry deployment | Missing | Contract address, deployment transaction, constructor token address, verified bytecode |
| tUSDT deployment/designation | Missing | Token address and transaction or canonical test-token reference |
| Sealed QoreChain-targeted case | Missing | Synthetic bundle hash plus `CaseSubmitted` transaction |
| Maintainer acknowledgement | Missing | Successful transaction before deadline |
| Missed-deadline consequence | Missing | A separate synthetic case, expired deadline, `CaseEscalated` transaction and event |
| Triage and escrow funding | Missing | Transactions and resulting `caseState`/token balances |
| PQ severity approval | Missing | `SeverityApproved` and `BountyReleased` transaction using the Diana precompile |
| ECDSA-only rejection | Local only | Testnet failure receipt or reproducible RPC simulation showing rejection |
| Redacted disclosure | Missing | Optional stretch transaction after resolution and embargo |
| QCAI contract audit | Missing | Published QCAI report, findings, fixes, and rerun result |
| Demo video | Missing | Public short video URL following `docs/demo-runbook.md` |
| Real-customer dry run | Missing | Synthetic drop addressed to QoreChain's published `security@qore.network` process |

The QoreChain security page returned HTTP 200 and publicly listed `security@qore.network` during the 2026-11-13 audit.
That verifies the customer framing, not a completed customer test.
