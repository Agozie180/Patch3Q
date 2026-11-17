# Testnet evidence

**Status: verified on Diana.** The lifecycle run happened on 15 Nov 2026 between 00:32 and 00:50 WAT
(23:32–23:50 UTC on 14 Nov), at EVM blocks 10101249–10101909. The repaired v2 contracts were deployed on 17 Nov 2026
at blocks 10278631–10278637. `pnpm verify:evidence` checks both generations (62/62) and writes
[`evidence/verification.json`](../evidence/verification.json). The hashes are in
[`evidence/testnet.json`](../evidence/testnet.json) and [`evidence/deployment-v2.json`](../evidence/deployment-v2.json).

| Evidence | Produced by | JSON path | Status |
| --- | --- | --- | --- |
| Program, auditor and relayer accounts (qor1 + 0x) | `accounts` | `accounts.*` | Verified |
| ML-DSA-87 key registration with proof of possession | bootstrap-exempt native tx | `native.pqc_<role>` | Verified |
| ML-KEM-1024 recipient key publication | hybrid native tx | `native.kem_<role>` | Verified |
| Role funding and scoped EVM authorization windows | hybrid native tx | `native.fund_<role>`, `native.window_<role>` | Verified |
| MockTUSDT and registry deployment | EVM | `bountyTokenAddress`, `registryAddress`, `evm.*Deployment` | Verified |
| Current v2 token + registry deployment, mint and allowance | EVM | `evidence/deployment-v2.json` | Verified |
| Anonymous case anchored by a relayer | `submitAnonymousCase` | `transactions.caseSubmitted` | Verified |
| Acknowledge, triage, fund, resolve | program | `transactions.{acknowledgement,triage,escrowFunding,resolution}` | Verified |
| Dual-PQ release to the sealed payout address | `approveAnonymousSeverity` | `transactions.severityApprovalAndRelease` | Verified |
| Ghosted case: permissionless escalation | `escalateMissedDeadline` | `transactions.deadlineEscalation` | Verified |
| Reporter (per-case PQ key) + auditor release | `approveAnonymousSeverity` | `transactions.escalatedApprovalAndRelease` | Verified |
| Redacted disclosure after embargo | `discloseCase` | `transactions.redactedDisclosure` | Verified |
| ECDSA-only, redirected payout, relayer release, early escalation and out-of-scope window are all rejected | `eth_call` reverts + a broadcast refused by the node | `negativeTests.*` | Verified |
| Live precompile self-test | `pnpm verify:precompile` | `evidence/precompile-selftest.txt` | Verified |
| QCAI probe | `pnpm audit:qcai` | `evidence/qcai-audit.json`. The precompile returned empty data | Unavailable on public RPC |
| Demo video | manual | README link | Pending |

## Public artifacts

- `evidence/testnet.json`: addresses, every transaction hash with its explorer link, case commitments and negative-test results.
- `evidence/deployment-v2.json`: current registry/token addresses, deployment receipts, native authorization steps,
  initial mint and allowance.
- `evidence/verification.json`: output of the independent on-chain verifier.
- `evidence/cases/*.bundle.json`: the two sealed bundles, ciphertext only. Each hashes to its anchored `envelopeHash`.
- `evidence/cases/case-a-normal.redacted.md`: the disclosed redacted report. It hashes to the on-chain `redactedReportHash`.
- `evidence/precompile-selftest.txt`: the live ML-DSA-87 precompile self-test.
- `evidence/browser-home.png`: the production build showing the **Live on Diana** badge.

The private keys and decryption vaults are kept out of the repository (`.env.testnet` and `.patch3q-testnet/` are
git-ignored).
