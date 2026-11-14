# Patch3Q competition audit — 2026-11-13

## Verdict

Patch3Q has a credible encrypted-disclosure prototype and a much stronger security story than a typical UI-only
hackathon entry. It is not yet a winning submission because the repository has no public testnet evidence trail. In a
field of 2,000 entries, a judge cannot award points for a deployment, customer run, QCAI audit, or video that is not
linked.

## Verified in the implementation

- Browser-side QoreSeal multi-recipient encryption with separate maintainer and auditor recovery paths.
- A random 32-byte salt inside the committed plaintext and a SHA-256 ciphertext commitment.
- Authenticated deadlines, recipient metadata, seal settings, case identity, and program/auditor approval authorities.
- Full-length reporter/program/auditor PQ-key snapshots and rotation rejection in contract tests.
- Two-party QoreSign hybrid approval generation and explicit ECDSA-only rejection tests for both signers.
- A live `pnpm verify:precompile` run during this audit successfully verified the exact QoreSign approval domain on Diana.
- Replay protection across chain ID, registry address, case, ciphertext, content commitment, severity, payout, and rationale.
- An immutable escrow token, exact deposit accounting, reentrancy protection, and one approved payout.
- Permissionless deadline enforcement with an explicit `Escalated` state. Normal payout requires program + auditor;
  escalated payout requires reporter + auditor.
- Explicit metadata and availability limits in the threat model.

## Implemented but not externally evidenced

- Diana PQC precompile use is reproducible and passed live during the audit, but there is no committed CI log or public attestation URL.
- The UI supports anchoring, lifecycle actions, funding, approval, payout, and disclosure, but no end-to-end testnet
  transaction set is published.
- Demo-vault approvals are correctly restricted to local proof; a testnet approval must be produced by the owner of the registered auditor key and imported.
- The QoreChain key registry is used for testnet recipients and auditor approval keys, but no real registered accounts
  are identified in evidence.
- The scoped EVM authorization-window claim is documented but not demonstrated by a testnet negative test.

## Incomplete or absent

- No deployed registry address or token address in repository configuration or documentation.
- No transaction hashes, explorer links, verified bytecode, or machine-readable evidence manifest.
- A QCAI probe artifact now exists, but Diana's public RPC returned empty data from both documented AI precompiles;
  therefore there is no score or QCAI approval to claim.
- No short demo video.
- No completed synthetic delivery to QoreChain's published security process.
- No build-in-public feed or `#BuildBeforeQDay` evidence.
- A static production host must provide the `/lcd-testnet` reverse proxy used for key-registry reads; Vite supplies it only during local development and preview.
- A production HTTP smoke test passed for `/` and the generated JavaScript asset. A reproducible 1440×1400 headless Chrome run rendered the home and two-party approval workspaces with no captured page errors; the separate sandbox-browser host remained unavailable.
- The production dependency audit has no moderate/high/critical findings. One low-severity `deepmerge` advisory has no patched release, and targeted Zod overrides produce peer warnings in unused Coinbase/WalletConnect branches.
- The two-independent-PQ-party protocol gap is fixed in code and tests, but still lacks a Diana transaction receipt.
- Deadline enforcement needs a transaction from a person or keeper. It is deterministic and permissionless, not an
  autonomous cron job.

## Brutal judge score

Current evidence-backed score: **70/100**.

- Problem and story: 9/10
- Encrypted-app fit: 14/15
- Cryptographic implementation: 14/15
- Smart-contract core: 13/15
- Threat model and honesty: 9/10
- Test coverage and reproducibility: 9/10 (`19` browser/crypto tests and `15` contract tests pass in Ubuntu WSL, plus a production headless-browser render)
- Testnet evidence: 0/15
- Demo/customer/build-in-public evidence: 2/10

The fastest path to a finalist-grade entry is not more surface area. Deploy this exact core, record the ghosted-case
escalation and funded payout on Diana, publish every hash, run the requested QCAI review, and film the five-minute
story without touching roadmap features.
