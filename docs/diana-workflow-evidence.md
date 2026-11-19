# Diana workflow evidence

## Verified on chain

The current v3 contracts were deployed, funded and fully rehearsed on 18 Nov 2026:

- `Patch3QRegistry` v3: [`0x9ec24151dc741f0c65d708c9410fbae2458f7863`](https://dashboard.qorechain.io/explorer/address/0x9ec24151dc741f0c65d708c9410fbae2458f7863)
- `MockTUSDT`: [`0x2d42cbe73384b8c492da8e0d706aa56141902eb1`](https://dashboard.qorechain.io/explorer/address/0x2d42cbe73384b8c492da8e0d706aa56141902eb1)
- Full evidence: [`evidence/testnet-v3.json`](../evidence/testnet-v3.json)

The public Diana EVM RPC (`https://evm-testnet.qore.host`, chain ID `9800`) carried a complete Patch3Q run:

- Deployed `MockTUSDT` and `Patch3QRegistry` bound to it.
- Case A (normal): relayer anchor → acknowledge → triage → fund → program + auditor atomic ML-DSA-87 resolution/release → redacted
  disclosure after embargo.
- Case B (ghosted): relayer anchor → fund → missed acknowledgement → permissionless `escalateMissedDeadline` → reporter
  per-case ML-DSA-87 key + auditor atomic resolution/release.
- Negative tests replayed live: `InvalidPqSignature`, `PayoutCommitmentMismatch`, `NotAuditor`, `DeadlineNotMissed`,
  and an out-of-scope EVM window refusal by the node.

Canonical record: [`evidence/testnet-v3.json`](../evidence/testnet-v3.json). Independent re-read:
[`evidence/verification-v3.json`](../evidence/verification-v3.json) via `pnpm verify:evidence`; **50/50 current checks
pass**, plus 62/62 preserved v1/v2 checks.

Sealed bundles (ciphertext only): [`evidence/cases-v3/`](../evidence/cases-v3/). Each `envelopeHash` matches the anchored
case on Diana.

## Reproduce without deployer keys

These commands need only the public RPC and committed artifacts/evidence:

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
3. `pnpm testnet:e2e:v3` — isolated/resumable: keys, KEM publication, scoped windows, deploy, both cases, negative tests.

For contracts only, put a valid `PATCH3Q_DEPLOYER_PRIVATE_KEY` or `PATCH3Q_DEPLOYER_MNEMONIC` in `.env`, ensure the
unified account has a registered ML-DSA-87 key and open EVM authorization window, then run `pnpm deploy:testnet`.
The full rehearsal path uses the three role keys in `.env.testnet`. Both paths follow the
[EVM window reference](https://docs.qorechain.io/developer-guide/evm-window-reference/).

Never add a transaction hash to a testnet evidence file until a receipt and emitted events have been read back from
Diana and `pnpm verify:evidence` passes.

## QCAI probe

`pnpm audit:qcai` was run against Diana; documented AI precompiles `0x…0B01` and `0x…0B02` returned empty data on the
public endpoint used. See [`evidence/qcai-audit.json`](../evidence/qcai-audit.json) and [`qcai-audit.md`](qcai-audit.md).
No QCAI score is claimed.
