# Patch3Q

Patch3Q is a post-quantum vulnerability-disclosure and bug-bounty escrow dApp for QoreChain. Researchers encrypt a report and proof of concept locally, give the maintainer and an independent auditor separate recovery paths, and publish only commitments and deadlines on-chain.

## What works

- Local multi-recipient sealing with QoreSeal and ML-KEM-1024.
- Hybrid ML-KEM-1024 + X25519 demo envelopes and QoreChain-registered ML-KEM testnet recipients.
- Salted plaintext commitments, ciphertext hashes, authenticated public deadlines, and case binding.
- Independent maintainer and auditor decryption.
- ML-DSA-87 + secp256k1 hybrid severity approvals with QoreSign.
- A runnable proof that a stolen classical key cannot produce an accepted approval when the PQ layer is required.
- QoreChain receipt lifecycle: submitted, acknowledged, triaged, resolved, and disclosed.
- ERC-20/test-fUSD escrow funding and atomic payout after auditor approval.
- Redacted disclosure commitments after resolution and embargo.
- No application backend and no plaintext upload path.

## Security flow

1. The researcher composes the report and optional PoC in the browser.
2. Patch3Q adds a random 32-byte salt, hashes the confidential payload, and encrypts one envelope for both recipients.
3. Public deadlines and the bound auditor authority are authenticated as QoreSeal AAD.
4. The researcher anchors the case ID hash, envelope hash, content commitment, auditor commitment, and deadlines.
5. The program acknowledges, triages, and funds the bounty escrow.
6. The auditor signs the exact evidence hashes, severity, rationale, and payout with QoreSign's hybrid signature.
7. The approval hash is anchored and the contract releases the approved amount to the reporter.
8. After the fix and embargo, a redacted report is saved off-chain and only its hash is committed on-chain.

## Important QoreChain distinction

QoreChain's native lane carries hybrid transaction signatures. The EVM lane does not carry an ML-DSA signature inside the Ethereum transaction; it is protected by a PQ-authorized EVM window. Patch3Q therefore:

- hybrid-signs the severity decision off-chain with QoreSign;
- verifies that signature against the bound auditor key;
- anchors its hash in the EVM registry; and
- relies on QoreChain's authorization-window rule to prevent an ECDSA key alone from submitting acknowledgement or payout transactions.

The Solidity contract deliberately does not claim to verify ML-DSA on-chain.

## Run locally

Requirements: Node.js 20+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The demo mode needs no wallet or network and generates separate local vault files for the maintainer, auditor, and approval authority.

Never publish or commit a vault file. Anyone holding one can decrypt or approve its case.

## Verify the project

```sh
pnpm check
```

This runs TypeScript checking, cryptographic tests, Solidity compilation, and the production build. Solidity artifacts are written to `artifacts/Patch3QRegistry.json` and `artifacts/MockFUSD.json`.

## Testnet setup

1. Deploy `MockFUSD` for a hackathon-only token, or use the designated test-fUSD contract.
2. Deploy `Patch3QRegistry`.
3. Copy `.env.example` to `.env` and set:

```env
VITE_PATCH3Q_REGISTRY_ADDRESS=0xYourRegistry
```

4. Start the app and choose **QoreChain testnet** when sealing.
5. Enter both the maintainer and auditor QoreChain addresses. Both need registered ML-KEM keys; the auditor also needs a registered ML-DSA-87 key.
6. Anchor the case with the reporter wallet.
7. Connect the program wallet, approve test-fUSD, fund escrow, acknowledge, and triage.
8. Connect the auditor wallet, import or create the signed approval, and release the bounty.

EVM writes require an injected signing wallet with a live QoreChain EVM authorization window. QoreX can currently be used for connection and reads.

## Contract roles and constraints

- Reporter: creates and may cancel a still-unacknowledged case.
- Program: acknowledges, triages, resolves, funds escrow, and may refund any remainder after cancellation or disclosure.
- Auditor: records one severity approval and releases at most the escrowed amount.
- Reporter or program: publishes the redacted-report commitment only after resolution and embargo.

Token transfers use checks-effects-interactions, a reentrancy guard, and safe handling for ERC-20 tokens that return either `true` or no value.

## Threat model and current limits

Patch3Q protects report confidentiality at rest, provides first-report and deadline evidence, detects ciphertext/AAD changes, and requires the PQ approval layer. It does not hide timing, envelope size, public accounts, token amounts, or transaction activity. Browser compromise before sealing, recipient-key theft, unsafe vault sharing, and malicious redaction remain out of scope.

The demo stores encrypted bundles and redacted reports wherever the user chooses; production needs an availability layer for ciphertext without turning that layer into a plaintext custodian. QoreSeal is pre-1.0 and should receive external cryptographic review before production use.
