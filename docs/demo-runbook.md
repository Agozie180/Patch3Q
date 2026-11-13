# Demo runbook

1. Run `pnpm dev` and open the local app.
2. Seal a synthetic report in demo mode and download the encrypted bundle plus the three separate vault files.
3. Open the bundle once as the maintainer and once as the auditor to show independent recovery and all integrity checks.
4. Run `pnpm verify:precompile` to show live ML-DSA verification on Diana.
5. Anchor a testnet-recipient receipt using a deployed registry whose constructor is bound to the designated test token.
6. Connect the program wallet, acknowledge and triage the case, then approve and fund the registry-bound token.
7. Use the auditor approval vault or an externally signed testnet approval to sign severity and payout. Show that the hybrid signature passes and the ECDSA-only forgery is rejected.
8. Connect the auditor wallet and submit the approval. The contract re-verifies the ML-DSA signature before release.
9. Resolve the case, wait for or configure the embargo, then publish a redacted-report commitment while keeping exploit material encrypted.

Use only synthetic vulnerability content during public demonstrations.
