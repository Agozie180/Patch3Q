# Testnet evidence checklist

`pnpm testnet:e2e` writes every item below to `evidence/testnet.json`. Patch3Q must not be described as
testnet-complete until that file reports `"status": "verified"` and each hash resolves on
`https://dashboard.qorechain.io/explorer/tx/<hash>`.

| Evidence | Produced by | JSON path |
| --- | --- | --- |
| Program, auditor and relayer accounts (qor1 + 0x) | `accounts` | `accounts.*` |
| ML-DSA-87 key registration with proof of possession | bootstrap-exempt native tx | `native.pqc_<role>` |
| ML-KEM-1024 recipient key publication | hybrid native tx | `native.kem_<role>` |
| Role funding and scoped EVM authorization windows | hybrid native tx | `native.fund_<role>`, `native.window_<role>` |
| MockTUSDT and registry deployment | EVM | `bountyTokenAddress`, `registryAddress`, `evm.*Deployment` |
| Anonymous case anchored by a relayer | `submitAnonymousCase` | `transactions.caseSubmitted` |
| Acknowledge, triage, fund, resolve | program | `transactions.{acknowledgement,triage,escrowFunding,resolution}` |
| Dual-PQ release to the sealed payout address | `approveAnonymousSeverity` | `transactions.severityApprovalAndRelease` |
| Ghosted case: permissionless escalation | `escalateMissedDeadline` | `transactions.deadlineEscalation` |
| Reporter (per-case PQ key) + auditor release | `approveAnonymousSeverity` | `transactions.escalatedApprovalAndRelease` |
| Redacted disclosure after embargo | `disclose` | `transactions.redactedDisclosure` |
| ECDSA-only, redirected payout, relayer release, early escalation and out-of-scope window are all rejected | `eth_call` against Diana | `negativeTests.*` |
| Live precompile self-test | `pnpm verify:precompile` | console output |
| QCAI probe | `pnpm audit:qcai` | `evidence/qcai-audit.json`. The precompile returned empty data |
| Demo video | manual | README link |

## Blocker

The Diana faucet requires a signed-in QoreChain dashboard account. It allows one claim per 24 hours and gives 100 QOR.
Claim it once for the **program** qor1 address printed by `pnpm testnet:status`, then rerun `pnpm testnet:e2e`. The
script funds the other roles itself.
