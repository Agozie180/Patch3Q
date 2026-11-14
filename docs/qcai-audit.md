# QCAI preflight artifact

Patch3Q includes a reproducible QCAI transaction-risk probe:

```sh
pnpm audit:qcai
```

The command compiles `Patch3QRegistry`, hashes its creation and deployed bytecode, and calls QoreChain's documented
`aiRiskScore` and `aiAnomalyCheck` precompiles for deployment and representative submit, acknowledge, escalate,
fund, dual-PQ approval, and disclosure calldata. The machine-readable result is
[`evidence/qcai-audit.json`](../evidence/qcai-audit.json).

## Verified result on 2026-11-13

- Diana RPC: `https://evm-testnet.qore.host`
- Chain ID: `9800`
- Observed block: `10034790`
- Compiled creation bytecode: `0x5a58552537365aafd44a5921267a412e1d298d755cc0317dba99e5be916d850d`
- Compiled deployed bytecode: `0xe430bb2b22b55235ed561a056288fbb21452168884588ea82539625c00350b11`
- QCAI result: **unavailable on the public Diana RPC used by this run**

Every call to `0x0000000000000000000000000000000000000B01` and `0x0000000000000000000000000000000000000B02`
returned empty `0x` data, which the official SDK could not decode. The artifact records each failed call rather than
inventing scores. This proves the audit was attempted against live Diana at a fixed block; it does not prove QCAI
approved the contract.

QCAI is an advisory transaction-risk service, not a source-code audit. Even a successful score would not replace
contract review, invariants, fuzzing, or a third-party security assessment.
