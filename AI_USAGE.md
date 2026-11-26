# AI usage

This is Patch3Q's disclosure for the Best AI-Native Build award. AI was used as a review and engineering system, not
as a feature claim pasted onto the product.

## Workflow

| Stage | AI role | Human control | Verifiable output |
| --- | --- | --- | --- |
| Product framing | Challenge the original “encrypted disclosure” pitch against a crowded hackathon field | Chose the ghosted-researcher problem and accepted the narrower product scope | README thesis and comparison table |
| Threat modelling | Act as an attacker holding every classical ECDSA key and look for privacy, escrow and deadline failures | Decided which threats were in scope and rejected claims that could not be demonstrated | [`docs/threat-model.md`](docs/threat-model.md), [`docs/competition-audit.md`](docs/competition-audit.md) |
| Protocol design | Propose invariants and failure cases before implementation | Approved the dual-party authority model and lifecycle semantics | `Patch3QRegistry.sol` and 29 contract tests |
| Pair programming | Draft TypeScript, Solidity, tests, scripts and documentation under review | Reviewed diffs, ran the code and retained responsibility for every merge | `pnpm check`, browser evidence and Diana evidence |
| Adversarial QA | Judge the finished entry end to end, compare it with the live event field and find claims unsupported by evidence | Chose and implemented the fixes; kept unresolved items explicit | Findings 1–19 in the competition audit |
| Evidence verification | Build independent scripts that re-read receipts, bytecode, balances and event logs instead of trusting prose | Supplied the testnet accounts and approved broadcasts | `pnpm verify:evidence`: 64/64 v1/v2 + 50/50 v3 + 49/49 v4 checks |

The agents used during development included Cursor and OpenAI Codex. The latest Codex audit led directly to:

- normal dual-PQ payout becoming an atomic resolution, preventing post-payment disclosure deadlock;
- a browser journey that actually seals, decrypts and verifies a report, opens the payout commitment, produces two
  ML-DSA-87 approvals and proves both ECDSA-only forgeries fail;
- approval-vault form values being cleared immediately after signing;
- preservation of v2 bytecode hashes when the v3 candidate artifact changed;
- production bundle splitting and live Vercel verification.

## Important adversarial findings produced with AI

The review did not merely generate code. It found and pinned protocol failures:

1. One signer could originally approve a payout alone.
2. A late program could race permissionless deadline escalation.
3. Two legitimate signers could redirect an anonymous payout.
4. Key rotation could invalidate the authority assumed at submission.
5. Report length and short rationale hashes leaked avoidable information.
6. A fee-on-transfer token could create unbacked accounting.
7. A normal payout could leave the case stuck in `Triaged` until the program sent another transaction.

Each accepted finding has a code change and a named regression test in [`docs/competition-audit.md`](docs/competition-audit.md).

## Validation discipline

AI output is not treated as evidence. Changes must pass:

```sh
pnpm check              # typecheck, 54 client/crypto/proxy tests, 78 contract tests, production build
pnpm smoke:browser      # complete local browser cryptographic journey
pnpm verify:evidence    # 359 checks across V1–V5; includes recorded recipient guard evidence
pnpm verify:precompile  # exact QoreSign domain accepted by Diana
pnpm audit --prod       # dependency advisory check
```

The same browser journey is also run against [`https://patch3-q.vercel.app`](https://patch3-q.vercel.app).

## Human responsibility

Humans own the product decisions, scope, threat-model acceptance, private-key custody, faucet claims, transaction
broadcasts, public statements and submission. AI did not authorize a transaction or decide that a security claim was
true; reproducible tests and chain receipts did.

## Data boundary

Real vulnerability reports must never be provided to the assistant. The user authorized local testnet key use
for V5 deployment; scripts read ignored environment/recovery files in memory without printing them. Private vaults,
recipient keys and recovery material remain ignored and are excluded from hosted uploads. Reports are encrypted locally in the browser. All repository examples and live cases use synthetic content.

## QCAI disclosure

`pnpm audit:qcai` probes QoreChain's on-chain AI precompiles against representative registry bytecode and calldata.
The public Diana RPC returned empty data, so Patch3Q records the unavailable result in
[`evidence/qcai-audit.json`](evidence/qcai-audit.json) and does not invent or claim an AI risk score.
