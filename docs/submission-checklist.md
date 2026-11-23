# Submission checklist

This applies the pre-submission checklist from the Hackathon-Winning Playbook to Patch3Q. The circuit is crypto
protocol, so judges score the repository and the live contract.

## The thing

- [x] One defensible thesis, enforced in code, with tests that prove it: "An attacker holding every ECDSA key gets
      nothing." See the README "The thesis, enforced" table.
- [x] The features that top the rubric are built and demonstrated live: ML-KEM-1024 sealing to registered keys, and a
      payout gated by two on-chain ML-DSA-87 signatures.
- [x] Reads like a product: 41 client/crypto/proxy tests, 42 contract tests, CI (`.github/workflows/ci.yml`), one design system, no API keys needed.
- [x] Prize surface: Encrypted Apps, plus Q-Day Survivor, Best AI-Native, People's Choice, Regional (Middle East &
      Africa) and Top-Quality. The Post-Quantum dApp bounty fits too, but projects enter only one category, and its
      QCAI requirement cannot be met on the public RPC.

## Verifiability

- [x] The v1 lifecycle deploy has explorer links and bytecode matched to its preserved artifact.
- [x] The repaired v2 registry and fresh MockTUSDT are deployed, funded and recorded in `evidence/deployment-v2.json`;
      `pnpm verify:evidence` checks its preserved masked runtime hash and source commit.
- [x] The current v3 registry is deployed and fully rehearsed in `evidence/testnet-v3.json`; 50/50 current checks pass,
      including atomic normal and escalated resolution.
- [x] V4 is deployed and fully rehearsed in `evidence/v4-lifecycle.json`; 49/49 checks cover the funded pool,
      reservation, compressed bundle recovery, acknowledgement, triage, 2-of-3 payout and final accounting.
- [x] Zero-setup hosted demo at [`https://patch3-q.vercel.app`](https://patch3-q.vercel.app), verified through the complete browser journey.
- [x] Every quantified claim has a reproduction command (README "Measured on Diana").
- [x] Demo mode needs no wallet or network. `pnpm smoke:browser` now self-starts preview and completes seal → verify → dual-PQ approval.

## Presentation

- [x] README: ghosting-first pitch, 90-second demo, comparison table, **Proven on Diana** / **Still outstanding**,
      collapsed technical detail, badges, links table, Mermaid diagrams, requirement mapping, used/not-used table,
      measured table, limitations and disclosures.
- [x] A scripted demo that opens on the guardrail: [`demo-runbook.md`](demo-runbook.md), 3 minutes plus a 90-second cut.
- [x] An 84-second narrated public demo is linked from the README, with a checked-in transcript and the verified browser journey as its source material.

## Honesty

- [x] Limitations and negative scoping, a self-audit with 15 findings, and fixes pinned by tests
      ([`competition-audit.md`](competition-audit.md)).
- [x] No simulated numbers. The QCAI score is explicitly not claimed. The single-operator rehearsal is disclosed.

## Hygiene

- [x] No secrets in history. `.env.testnet` and `.patch3q-testnet/` are git-ignored, and no agent instruction files
      are committed.
- [x] `pnpm audit --prod` reports no known vulnerabilities; the WalletConnect/`picomatch` dependency path was removed.
- [x] Repository visibility is an explicit owner choice: it remains private for now.

## Submission actions outside the codebase

- Repository description and ready-to-post updates are in [`competition-audit.md`](competition-audit.md) and
  [`build-in-public.md`](build-in-public.md).
- The final form submission is an owner action; the technical V4 lifecycle has no unfinished step.
