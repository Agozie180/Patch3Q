# QCAI preflight artifact

Patch3Q includes a reproducible QCAI transaction-risk probe:

```sh
pnpm audit:qcai
```

The command compiles `Patch3QRegistry`, hashes its creation and deployed bytecode, and calls QoreChain's documented
`aiRiskScore` and `aiAnomalyCheck` precompiles for deployment and representative submit, acknowledge, escalate,
fund, dual-PQ approval, and disclosure calldata. The machine-readable result is
[`evidence/qcai-audit.json`](../evidence/qcai-audit.json).

## Verified result (latest artifact)

Values below match [`evidence/qcai-audit.json`](../evidence/qcai-audit.json); re-run `pnpm audit:qcai` to refresh.

- Diana RPC: `https://evm-testnet.qore.host`
- Chain ID: `9800`
- Observed block: see `blockNumber` in the artifact (e.g. `10102147` on the 2026-11-14 run)
- Creation bytecode hash: `0x735e8de2a4e448cfb3f125443e1decbfd291bc03f67c1ea5e121069bb283d9ad`
- Deployed bytecode hash: `0xb4c07ec746fa30149542bb3f5dbc704e184a27f3dd73fa82e9ab990b7ae00f11`
- QCAI result: **unavailable on the public Diana RPC used by this run** (`precompile-unavailable-on-public-diana-rpc`)

Every call to `0x0000000000000000000000000000000000000B01` and `0x0000000000000000000000000000000000000B02`
returned empty `0x` data, which the official SDK could not decode. The artifact records each failed call rather than
inventing scores. This proves the audit was attempted against live Diana at a fixed block; it does not prove QCAI
approved the contract.

QCAI is an advisory transaction-risk service, not a source-code audit. Even a successful score would not replace
contract review, invariants, fuzzing, or a third-party security assessment.
