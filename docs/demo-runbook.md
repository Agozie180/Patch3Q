# Demo runbook

1. Run `pnpm dev` and open the local app.
2. Seal a synthetic report in demo mode and download the encrypted bundle plus the three separate vault files.
3. Open the bundle once as the maintainer and once as the auditor to show independent recovery and all integrity checks.
4. Anchor the receipt on QoreChain Diana testnet using a deployed registry.
5. Connect the program wallet, approve test-fUSD, fund escrow, acknowledge, and triage the case.
6. Use the auditor approval vault to sign severity and payout. Show that the hybrid signature passes and the ECDSA-only forgery is rejected.
7. Connect the auditor wallet and anchor the approval to release escrow.
8. Resolve the case, wait for or configure the embargo, then publish a redacted-report commitment while keeping exploit material encrypted.

Use only synthetic vulnerability content during public demonstrations.
