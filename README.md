# Patch3Q

Patch3Q is a post-quantum vulnerability-disclosure and bug-bounty escrow dApp for QoreChain. Researchers encrypt a report and proof of concept locally, give the maintainer and an independent auditor separate recovery paths, and publish only commitments and deadlines on-chain.

## Implemented and locally verifiable

- Local multi-recipient sealing with QoreSeal and ML-KEM-1024.
- Hybrid ML-KEM-1024 + X25519 demo envelopes and QoreChain-registered ML-KEM testnet recipients.
- Salted plaintext commitments, ciphertext hashes, authenticated public deadlines, and case binding.
- An authenticated reporter authority in every bundle; the anchor workspace refuses a wallet that is not that reporter.
- Independent maintainer and auditor decryption.
- Two independent ML-DSA-87 + secp256k1 hybrid severity approvals with QoreSign.
- On-chain verification of both ML-DSA-87 signatures through QoreChain's `0x…0A01` PQC precompile before escrow release.
- A runnable proof that a classical-only approval is rejected, plus a live Diana precompile self-test.
- QoreChain receipt lifecycle: submitted, acknowledged, triaged, resolved, and disclosed.
- Immutable trusted-token escrow, exact balance accounting, and atomic payout after dual PQ verification.
- Permissionless enforcement of missed acknowledgement and triage deadlines. Enforcement moves the case to
  `Escalated`, permanently replaces the ghosted program signer with the reporter, and retains the independent auditor.
- Redacted disclosure commitments after resolution and embargo.
- No application backend and no plaintext upload path.

## Not yet proven on testnet

This repository does **not** currently contain a Diana deployment address, deployment transaction, end-to-end case
transaction hashes or demo-video URL. A reproducible QCAI probe is committed, but the documented AI precompiles
returned empty data on the public Diana RPC, so no QCAI score is claimed. See [the competition audit](docs/competition-audit.md)
and [evidence checklist](docs/testnet-evidence.md).

## Security flow

1. The researcher composes the report and optional PoC in the browser.
2. Patch3Q adds a random 32-byte salt, hashes the confidential payload, and encrypts one envelope for both recipients.
3. Public deadlines and the bound program/auditor authorities are authenticated as QoreSeal AAD.
4. The researcher anchors the case ID hash, envelope hash, content commitment, three PQ-key snapshots, and deadlines.
5. The program acknowledges, triages, and funds the bounty escrow. If it misses a deadline, anyone can move the case
   to `Escalated`; this is permissionless enforcement, not autonomous timer execution.
6. The program and auditor sign the same replay-protected digest. After escalation, the reporter replaces the ghosted program.
7. The registry verifies both ML-DSA-87 signatures through QoreChain's PQC precompile before releasing funds.
8. After the fix and embargo, a redacted report is saved off-chain and only its hash is committed on-chain.

## Important QoreChain distinction

QoreChain's native lane carries hybrid transaction signatures. The EVM transaction is protected by a PQ-authorized window, while Patch3Q separately verifies the payout instruction's ML-DSA signature inside contract execution. Patch3Q therefore:

- hybrid-signs the severity decision twice off-chain with QoreSign;
- verifies both signatures against the PQ keys snapshotted at submission;
- binds it to the Diana chain ID and deployed registry address;
- verifies both raw ML-DSA-87 signatures with the QorePQC EVM precompile; and
- requires the bound auditor account to submit the payout transaction.

The authorization window alone is not treated as proof of the severity decision.

## Run locally

Requirements: Node.js 20+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The demo mode needs no wallet or network and generates separate decryption vaults plus reporter, program, and auditor approval vaults.

Never publish or commit a vault file. Anyone holding one can decrypt or approve its case.

## Verify the project

```sh
pnpm check
```

This runs TypeScript checking, cryptographic tests, contract-invariant tests, Solidity compilation, and the production build. Solidity artifacts are written to `artifacts/Patch3QRegistry.json` and `artifacts/MockTUSDT.json`.

A production headless-Chrome render and its limitations are documented in
[`docs/browser-smoke.md`](docs/browser-smoke.md).

To verify the live Diana ML-DSA precompile independently:

```sh
pnpm verify:precompile
```

To reproduce the live QCAI availability/risk probe and regenerate `evidence/qcai-audit.json`:

```sh
pnpm audit:qcai
```

The audited lockfile has no moderate, high, or critical production advisories under
`pnpm audit --prod --audit-level moderate`. One low-severity `deepmerge` advisory remains in RainbowKit's styling
dependency and has no published patched version.

## Testnet setup

1. Export `PATCH3Q_DEPLOYER_PRIVATE_KEY` for a funded Diana EVM account with an active authorization window. Optionally export `PATCH3Q_TUSDT_ADDRESS`; otherwise the script deploys `MockTUSDT`.
2. Run `pnpm deploy:testnet`. It prints the token address, registry address, and deployment transaction hashes. Copy them into the evidence files; never commit the private key.
3. `Patch3QRegistry` is permanently bound to the constructor token and will never accept a different token.
4. Copy `.env.example` to `.env` and set:

```env
VITE_PATCH3Q_REGISTRY_ADDRESS=0xYourRegistry
```

5. Start the app and choose **QoreChain testnet** when sealing.
6. Connect the reporter wallet, then enter both the maintainer/program and auditor QoreChain addresses. All three accounts need registered ML-DSA-87 keys; both recipients also need registered ML-KEM keys.
7. Anchor the case with the same reporter wallet authenticated inside the sealed bundle.
8. Connect the program wallet, acknowledge, triage, approve the registry-bound token, and fund escrow.
9. Import matching program + auditor approvals for a normal case, or reporter + auditor approvals after escalation, then connect the auditor wallet to release the bounty. In-browser approval-vault creation is intentionally limited to local demo mode.

EVM writes require an injected signing wallet with a live QoreChain EVM authorization window. QoreX can currently be used for connection and reads.

## Contract roles and constraints

- Reporter: creates and may cancel a still-unacknowledged case.
- Program: acknowledges, triages, resolves, funds escrow, and may refund any remainder after cancellation or disclosure.
- Program + auditor: independently sign a normal severity approval.
- Reporter + auditor: independently sign after a missed deadline moves the case to `Escalated`.
- Auditor: submits the co-signed decision and releases at most the escrowed amount.
- Reporter or program: publishes the redacted-report commitment only after resolution and embargo.

Token transfers use checks-effects-interactions, a reentrancy guard, contract-code checks, and exact before/after balance accounting. Fee-on-transfer and fake-token deposits are rejected.

## Threat model and current limits

Patch3Q protects report confidentiality at rest, provides first-report and deadline evidence, detects ciphertext/AAD changes, and requires the PQ approval layer. It does not hide timing, envelope size, public accounts, recipient authority, token amounts, or transaction activity. Browser compromise before sealing, recipient-key theft, unsafe vault sharing, and malicious redaction remain out of scope.

Reporter identity is authenticated inside the bundle and enforced by the application at anchoring, but the Solidity contract cannot decrypt QoreSeal AAD. An actor bypassing the application can anchor copied ciphertext under a different reporter account; recipients and the auditor must reject any on-chain role set that does not match the authenticated bundle. A future submission-authorization PQ signature should make this contract-enforceable.

The demo stores encrypted bundles and redacted reports wherever the user chooses; production needs an availability layer for ciphertext without turning that layer into a plaintext custodian. QoreSeal is pre-1.0 and should receive external cryptographic review before production use.
