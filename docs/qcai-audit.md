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
- Observed block: `10278834` on the 2026-11-17 refresh
- Creation bytecode hash: `0x54b09b02d0260b15e496bf3c98b106b9dfe1a05f1c21156bd540eb34c25680f6`
- Deployed bytecode hash: `0x50957b91f55195d6e7bc90b200dc0be47753f0e5005cfd0855ea8aa7157a0f0c`
- QCAI result: **unavailable on the public Diana RPC used by this run** (`precompile-unavailable-on-public-diana-rpc`)

Every call to `0x0000000000000000000000000000000000000B01` and `0x0000000000000000000000000000000000000B02`
returned empty `0x` data, which the official SDK could not decode. The artifact records each failed call rather than
inventing scores. This proves the audit was attempted against live Diana at a fixed block; it does not prove QCAI
approved the contract.

QCAI is an advisory transaction-risk service, not a source-code audit. Even a successful score would not replace
contract review, invariants, fuzzing, or a third-party security assessment.
