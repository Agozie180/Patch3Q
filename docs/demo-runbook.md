# Demo runbook

1. Run `pnpm dev` and open the local app.
2. Click **Load QoreChain synthetic customer scenario**, seal it in demo mode, and download the encrypted bundle,
   two decryption vaults, and two independent approval vaults.
3. Open the bundle once as the maintainer and once as the auditor to show independent recovery and all integrity checks.
4. Run `pnpm verify:precompile` to show live ML-DSA verification on Diana.
5. Anchor two synthetic testnet receipts using a deployed registry whose constructor is bound to the designated test token.
6. For the main case, connect the program wallet, acknowledge and triage, then approve and fund the registry-bound token.
7. For the ghosted case, pre-fund escrow, let the acknowledgement deadline pass, and have an unrelated keeper call `escalateMissedDeadline`. Show the `CaseEscalated` event and state change.
8. For the normal case, create matching program + auditor signatures. Show both hybrid checks and both ECDSA-only rejection proofs.
9. For the escalated case, use reporter + auditor signatures, then connect the auditor wallet to submit. The contract re-verifies both ML-DSA signatures before release.
10. Resolve the main case, wait for or configure the embargo, then publish a redacted-report commitment while keeping exploit material encrypted.

Record every address and transaction hash in `docs/testnet-evidence.md` before recording the demo video.

Use only synthetic vulnerability content during public demonstrations.
