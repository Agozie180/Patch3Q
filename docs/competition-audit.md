# Patch3Q competition audit — 2026-11-13

## Verdict

Patch3Q has a credible encrypted-disclosure prototype and a much stronger security story than a typical UI-only
hackathon entry. It is not yet a winning submission because the repository has no public testnet evidence trail. In a
field of 2,000 entries, a judge cannot award points for a deployment, customer run, QCAI audit, or video that is not
linked.

## Verified in the implementation

- Browser-side QoreSeal multi-recipient encryption with separate maintainer and auditor recovery paths.
- A random 32-byte salt inside the committed plaintext and a SHA-256 ciphertext commitment.
- Authenticated deadlines, recipient metadata, seal settings, case identity, and auditor approval authority.
- Full-length PQ key fingerprints and rejection of a rotated auditor key in both browser and contract paths.
- QoreSign hybrid approval generation and an explicit ECDSA-only rejection test.
- A live `pnpm verify:precompile` run during this audit successfully verified the exact QoreSign approval domain on Diana.
- Replay protection across chain ID, registry address, case, ciphertext, content commitment, severity, payout, and rationale.
- An immutable escrow token, exact deposit accounting, reentrancy protection, and one approved payout.
- Permissionless deadline enforcement with an explicit `Escalated` state and auditor adjudication of pre-funded escrow.
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
- No QCAI audit artifact. A normal self-audit must not be relabelled as QCAI output.
- No short demo video.
- No completed synthetic delivery to QoreChain's published security process.
- No build-in-public feed or `#BuildBeforeQDay` evidence.
- A static production host must provide the `/lcd-testnet` reverse proxy used for key-registry reads; Vite supplies it only during local development and preview.
- A production HTTP smoke test passed for `/` and the generated JavaScript asset. A visual background-browser run was not possible because the machine's browser-access host returned no browser surfaces.
- The production dependency audit has no moderate/high/critical findings. One low-severity `deepmerge` advisory has no patched release, and targeted Zod overrides produce peer warnings in unused Coinbase/WalletConnect branches.
- Escrow approval is one auditor's hybrid signature plus the auditor transaction sender; it is not two independent
  parties each providing a PQ signature. If the judging rubric literally requires maintainer-and-auditor PQ
  co-signatures, this remains a protocol gap.
- Deadline enforcement needs a transaction from a person or keeper. It is deterministic and permissionless, not an
  autonomous cron job.

## Brutal judge score

Current evidence-backed score: **69/100**.

- Problem and story: 9/10
- Encrypted-app fit: 14/15
- Cryptographic implementation: 14/15
- Smart-contract core: 13/15
- Threat model and honesty: 9/10
- Test coverage and reproducibility: 8/10 (`16` browser/crypto tests and `12` contract tests pass in Ubuntu WSL)
- Testnet evidence: 0/15
- Demo/customer/build-in-public evidence: 2/10

The fastest path to a finalist-grade entry is not more surface area. Deploy this exact core, record the ghosted-case
escalation and funded payout on Diana, publish every hash, run the requested QCAI review, and film the five-minute
story without touching roadmap features.
