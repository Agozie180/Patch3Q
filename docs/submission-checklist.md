# Submission checklist

This applies the pre-submission checklist from the Hackathon-Winning Playbook to Patch3Q. The circuit is crypto
protocol, so judges score the repository and the live contract.

## The thing

- [x] One defensible thesis, enforced in code, with tests that prove it: "ECDSA-only signatures cannot authorize an
      escrow payout or decrypt a sealed report." See the README [V3 security checks](../README.md#v3-security-checks)
      and the [V5 verification report](../evidence/v5-verification.json).
- [x] Live V5 cases use browser ML-KEM-1024 sealing to registered keys and on-chain ML-DSA-87 checks for the
      required participant and two of three auditors.
- [x] Local checks cover 54 client/crypto/proxy cases and 78 contract cases. CI runs without API keys.
- [x] Prize surface: Encrypted Apps, plus Best AI-Native, People's Choice, Regional (Middle East &
      Africa) and Top-Quality. The rules allow one category per project. The recorded Diana QCAI probe returned empty
      data. [Event rules](https://build.qorechain.io/rules) · [Probe results](../evidence/qcai-audit.json)

## Verifiability

- [x] The v1 lifecycle deploy has explorer links and bytecode matched to its preserved artifact.
- [x] The repaired v2 registry and fresh MockTUSDT are deployed, funded and recorded in `evidence/deployment-v2.json`;
      `pnpm verify:evidence` checks its preserved masked runtime hash and source commit.
- [x] The preserved v3 registry is deployed and fully rehearsed in `evidence/testnet-v3.json`; 50/50 current checks pass,
      including atomic normal and escalated resolution.
- [x] V4 is deployed and fully rehearsed in `evidence/v4-lifecycle.json`; 49/49 checks cover the funded pool,
      reservation, compressed bundle recovery, acknowledgement, triage, 2-of-3 payout and final accounting.
- [x] Zero-setup hosted demo at [`https://patch3-q.vercel.app`](https://patch3-q.vercel.app), verified through the complete browser journey.
- [x] Every quantified claim has a reproduction command (README "Measured on Diana").
- [x] Demo mode needs no wallet or network. `pnpm smoke:browser` now self-starts preview and completes seal → verify → dual-PQ approval.

- [x] V5 is deployed with the V2/V4 deployer; all five live cases completed, production policy restored,
      pool fully backed at 19,000 tUSDT and zero open cases. See [V5 review](v5-review.md).

## Presentation

- [x] README and judge brief lead with the V5 missed-decision payout and link the four Diana receipts.
- [x] The hosted demo checks those receipts and offers a wallet-free signing exercise.
- [x] The narrated [V5 video](https://patch3-q.vercel.app/demo-v5.mp4) runs about 71 seconds. See the [runbook](demo-runbook.md) and [transcript](demo-video-transcript.md).

## Honesty

- [x] Limitations and negative scoping, a self-audit with 24 findings, and fixes pinned by tests
      ([`competition-audit.md`](competition-audit.md)).
- [x] No simulated numbers. The QCAI score is explicitly not claimed. The single-operator rehearsal is disclosed.

## Hygiene

- [x] No secrets in history. `.env.testnet` and `.patch3q-testnet/` are git-ignored, and no agent instruction files
      are committed.
- [x] `pnpm audit --prod` reports no known vulnerabilities; the WalletConnect/`picomatch` dependency path was removed.
- [x] Public repository visibility independently checked on 25 Nov 2026.

## Submission actions outside the codebase

- Use the [gallery copy](gallery-v5.md) to update the public QoreChain project fields.
