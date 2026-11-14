# AI usage

This file is the AI-usage disclosure for the Best AI-Native award.

## Where AI was used

- **Pair programming.** AI coding agents (Cursor) helped write the TypeScript privacy library, the anonymous
  reporter mode in `Patch3QRegistry.sol`, contract and crypto tests, the resumable Diana end-to-end script, and the
  documentation.
- **Adversarial review.** The agents were asked to judge the entry as one of about 2,000 submissions and to attack its
  claims. That review produced the dual-PQ approval requirement, the explicit `Escalated` state, the sealed payout
  commitment, size buckets and salted rationale hashes. See [`docs/competition-audit.md`](docs/competition-audit.md).
- **QCAI probe.** `pnpm audit:qcai` tries QoreChain's on-chain AI precompiles against the registry. On the public Diana
  RPC they returned empty data, and the result is recorded in [`evidence/qcai-audit.json`](evidence/qcai-audit.json)
  without a score being claimed.

## What humans own

The product decisions, threat model acceptance, key custody, the faucet claim and the submission are owned by the
team. Every AI-written change is covered by `pnpm check`, with crypto tests, contract tests and a production build.

## What AI never sees

The app processes no real vulnerability data. Reports are encrypted in the browser, and no report content is sent to
any AI service. Demo content is synthetic.
