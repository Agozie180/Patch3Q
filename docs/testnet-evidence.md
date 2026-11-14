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
| Dual-PQ severity approval | Missing | `SeverityApproved` and `BountyReleased` using program + auditor, or reporter + auditor after escalation |
| ECDSA-only rejection | Local only | Testnet failure receipt or reproducible RPC simulation showing rejection |
| Redacted disclosure | Missing | Optional stretch transaction after resolution and embargo |
| QCAI transaction preflight | Attempted; precompile unavailable | `evidence/qcai-audit.json` records live empty-return failures at Diana block 10034790 |
| Production browser render | Local evidence | `evidence/browser-smoke.json`, two screenshots, and `docs/browser-smoke.md` |
| Demo video | Missing | Public short video URL following `docs/demo-runbook.md` |
| Real-customer dry run | Local synthetic scenario | App preset targets QoreChain's published intake; no report or email was sent |

The QoreChain security page returned HTTP 200 and publicly listed `security@qore.network` during the 2026-11-13 audit.
That verifies the customer framing, not a completed customer test.
