# Testnet evidence

**Status: verified on Diana.** The current v3 lifecycle ran on 18 Nov 2026 and is recorded in
[`evidence/testnet-v3.json`](../evidence/testnet-v3.json). `pnpm verify:evidence` checks v3 (50/50) and the preserved
v1/v2 generations (62/62), writing [`evidence/verification-v3.json`](../evidence/verification-v3.json) and
[`evidence/verification.json`](../evidence/verification.json).

| Evidence | Produced by | JSON path | Status |
| --- | --- | --- | --- |
| Program, auditor and relayer accounts (qor1 + 0x) | `accounts` | `accounts.*` | Verified |
| ML-DSA-87 key registration with proof of possession | bootstrap-exempt native tx | `native.pqc_<role>` | Verified |
| ML-KEM-1024 recipient key publication | hybrid native tx | `native.kem_<role>` | Verified |
| Role funding and scoped EVM authorization windows | hybrid native tx | `native.fund_<role>`, `native.window_<role>` | Verified |
| MockTUSDT and registry deployment | EVM | `bountyTokenAddress`, `registryAddress`, `evm.*Deployment` | Verified |
| Current v3 token + registry deployment, mint and allowance | EVM | `evidence/testnet-v3.json` | Verified |
| Anonymous case anchored by a relayer | `submitAnonymousCase` | `transactions.caseSubmitted` | Verified |
| Acknowledge, triage, fund, resolve | program | `transactions.{acknowledgement,triage,escrowFunding,resolution}` | Verified |
| Dual-PQ release to the sealed payout address | `approveAnonymousSeverity` | `transactions.severityApprovalAndRelease` | Verified |
| Ghosted case: permissionless escalation | `escalateMissedDeadline` | `transactions.deadlineEscalation` | Verified |
| Reporter (per-case PQ key) + auditor release | `approveAnonymousSeverity` | `transactions.escalatedApprovalAndRelease` | Verified |
| Redacted disclosure after embargo | `discloseCase` | `transactions.redactedDisclosure` | Verified |
| ECDSA-only, redirected payout, relayer release, early escalation and out-of-scope window are all rejected | `eth_call` reverts + a broadcast refused by the node | `negativeTests.*` | Verified |
| Live precompile self-test | `pnpm verify:precompile` | `evidence/precompile-selftest.txt` | Verified |
| QCAI probe | `pnpm audit:qcai` | `evidence/qcai-audit.json`. The precompile returned empty data | Unavailable on public RPC |
| Demo video | manual | README link and `docs/demo-video-transcript.md` | Complete: 84 seconds, hosted with the Vercel demo |

## Public artifacts

- `evidence/testnet-v3.json`: current addresses, every transaction hash, case commitments and negative-test results.
- `evidence/verification-v3.json`: output of the current independent on-chain verifier.
- `evidence/testnet.json`, `evidence/deployment-v2.json` and `evidence/verification.json`: preserved historical evidence.
- `evidence/cases-v3/*.bundle.json`: the two current sealed bundles, ciphertext only. Each hashes to its anchored `envelopeHash`.
- `evidence/cases-v3/case-a-normal.redacted.md`: the current disclosed redacted report.
- `evidence/precompile-selftest.txt`: the live ML-DSA-87 precompile self-test.
- `evidence/browser-home.png`: the production build showing the **Live on Diana** badge.

The private keys and decryption vaults are kept out of the repository (`.env.testnet` and `.patch3q-testnet/` are
git-ignored).
