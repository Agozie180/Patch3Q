# Diana workflow evidence

## Verified on chain

The current v2 contracts were deployed and funded on 17 Nov 2026:

- `Patch3QRegistry` v2: [`0xa7c6ff9db34aadb4301b183864d75d9a36c95b27`](https://dashboard.qorechain.io/explorer/address/0xa7c6ff9db34aadb4301b183864d75d9a36c95b27)
- `MockTUSDT`: [`0x715a962d04391a0e308fd4fa36af63cec0df3bdc`](https://dashboard.qorechain.io/explorer/address/0x715a962d04391a0e308fd4fa36af63cec0df3bdc)
- Deployment manifest: [`evidence/deployment-v2.json`](../evidence/deployment-v2.json)

The full lifecycle rehearsal below ran on the preserved v1 contracts on 15 Nov 2026.

The public Diana EVM RPC (`https://evm-testnet.qore.host`, chain ID `9800`) carried a complete Patch3Q run:

- Deployed `MockTUSDT` and `Patch3QRegistry` bound to it.
- Case A (normal): relayer anchor → acknowledge → triage → fund → resolve → program + auditor ML-DSA-87 release → redacted
  disclosure after embargo.
- Case B (ghosted): relayer anchor → fund → missed acknowledgement → permissionless `escalateMissedDeadline` → reporter
  per-case ML-DSA-87 key + auditor release.
- Negative tests replayed live: `InvalidPqSignature`, `PayoutCommitmentMismatch`, `NotAuditor`, `DeadlineNotMissed`,
  and an out-of-scope EVM window refusal by the node.

Canonical record: [`evidence/testnet.json`](../evidence/testnet.json). Independent re-read:
[`evidence/verification.json`](../evidence/verification.json) via `pnpm verify:evidence`. The verifier checks the current
v2 deployment and the preserved v1 lifecycle in one pass; **62/62 checks pass**.

Sealed bundles (ciphertext only): [`evidence/cases/`](../evidence/cases/). Each `envelopeHash` matches the anchored
case on Diana.

## Reproduce without deployer keys

These commands need only the public RPC, the preserved v2 runtime hashes/source commit and committed v1 deployed artifacts:

```sh
pnpm verify:evidence      # receipts, events, bytecode, balances, negative tests
pnpm verify:precompile    # ML-DSA-87 domain used by Patch3Q approvals
pnpm audit:qcai           # optional QCAI probe (may return unavailable on public RPC)
```

CI runs `pnpm check` and re-verifies Diana evidence on each push (see `.github/workflows/ci.yml`).

## Run a new deployment (optional)

The committed hashes describe contracts and cases that remain on Diana. To replay the protocol with your own roles:

1. `pnpm testnet:accounts` — writes `.env.testnet` (git-ignored).
2. Fund the program `qor1` from the [Diana faucet](https://dashboard.qorechain.io/faucet).
3. `pnpm testnet:e2e` — resumable: keys, KEM publication, scoped windows, deploy, both cases, negative tests.

For contracts only, put a valid `PATCH3Q_DEPLOYER_PRIVATE_KEY` or `PATCH3Q_DEPLOYER_MNEMONIC` in `.env`, ensure the
unified account has a registered ML-DSA-87 key and open EVM authorization window, then run `pnpm deploy:testnet`.
The full rehearsal path uses the three role keys in `.env.testnet`. Both paths follow the
[EVM window reference](https://docs.qorechain.io/developer-guide/evm-window-reference/).

Never add a transaction hash to `evidence/testnet.json` until a receipt and emitted events have been read back from
Diana and `pnpm verify:evidence` passes.

## QCAI probe

`pnpm audit:qcai` was run against Diana; documented AI precompiles `0x…0B01` and `0x…0B02` returned empty data on the
public endpoint used. See [`evidence/qcai-audit.json`](../evidence/qcai-audit.json) and [`qcai-audit.md`](qcai-audit.md).
No QCAI score is claimed.
