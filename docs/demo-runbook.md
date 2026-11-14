# 3-minute demo video script

Hackathon limit: 3 minutes or less. Use synthetic vulnerability content only. Record at 1920×1080.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00–0:12 | Cover image, then the app hero | "Bug-bounty reports are today's most valuable secrets, and on Q-Day every ECDSA key is broken. Patch3Q is an anonymous, post-quantum bounty escrow on QoreChain." |
| 0:12–0:40 | Load the synthetic scenario. Anonymous mode is on and a payout wallet is generated | "The researcher never connects a wallet. The report is padded and sealed with ML-KEM-1024 to the maintainer and an independent auditor. The payout address is sealed inside the ciphertext too." |
| 0:40–1:00 | Privacy ledger panel | "Here's everything the chain will see: hashes, deadlines and an amount. No reporter identity, no payout address, no report size." |
| 1:00–1:25 | Open the bundle as the maintainer, then as the auditor. All checks are green | "Two independent recoveries. Change one byte and every check fails." |
| 1:25–1:50 | `evidence/testnet.json` and the explorer: `AnonymousCaseSubmitted`, ack, triage, fund | "This is live on Diana. A relayer anchored the case and the program funded 2,500 tUSDT of escrow." |
| 1:50–2:15 | The ghosted case on the explorer: `CaseEscalated`, then `BountyReleased` | "This vendor missed its deadline. A keeper escalated, and the vendor lost its vote. The reporter's per-case post-quantum key and the auditor released the bounty." |
| 2:15–2:40 | The `negativeTests` block in the evidence file | "Q-Day test. An ECDSA-only signature reverts. Redirecting the payout reverts. The relayer can't touch the funds. The scoped EVM window blocks a stolen key from calling other contracts." |
| 2:40–3:00 | README "In 10 seconds" table | "Anonymous, encrypted, post-quantum, and enforced by QoreChain's PQC precompile. Patch3Q. Build before Q-Day." |

## Recording checklist

1. Run `pnpm testnet:e2e` until `evidence/testnet.json` reports `"status": "verified"`.
2. Run `pnpm dev`, and check that the header shows **Live on Diana**.
3. Keep the explorer tabs for the transaction hashes in the evidence file open.
4. Upload the video publicly, for example as an unlisted YouTube video, and add the URL to the README and the submission form.
