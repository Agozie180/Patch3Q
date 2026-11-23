# 3-minute demo video script

Hackathon limit: 3 minutes or less. Use synthetic vulnerability content only. Record at 1920×1080.

The video opens with the moment that cannot be faked: an ECDSA-only approval rejected by the live contract. Then it
shows the guardrails before the happy path.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00–0:15 | `evidence/testnet-v3.json` → `negativeTests`, then the case A release on the explorer | "This bounty escrow is live on QoreChain. I signed a payout with the auditor's ECDSA key only. The contract rejected it with `InvalidPqSignature`. On Q-Day, that ECDSA key is all an attacker has. Here's the real payout, which needed two ML-DSA-87 signatures." |
| 0:15–0:30 | Cover → app hero | "Patch3Q is pre-funded disclosure escrow: report anonymously, and if a participating vendor misses its SLA, the chain permanently replaces its vote with the reporter's. The independent auditor still co-signs." |
| 0:30–0:55 | Load the synthetic scenario. Anonymous mode is on and a payout wallet is generated → **Seal report** | "No wallet. The report is padded and sealed with ML-KEM-1024 to the maintainer and an independent auditor, whose keys come from QoreChain's key registry. The payout address is sealed inside the ciphertext too." |
| 0:55–1:10 | Privacy ledger panel | "This is everything the chain will ever see: hashes, deadlines, an amount. No reporter, no payout address, no report size." |
| 1:10–1:25 | **Verify & open** as the maintainer, then as the auditor | "Two independent recoveries. Change one byte and every check fails." |
| 1:25–1:55 | Explorer: the case B escalation `0xc764f928…`, then the release `0x4408d550…` | "This vendor funded a bounty and then ghosted. After the deadline, a keeper escalated, and the vendor lost its vote. The reporter's one-off post-quantum key and the auditor released 1,000 tUSDT to the sealed address and resolved the case." |
| 1:55–2:20 | Terminal: `pnpm verify:evidence` scrolling to both all-passed lines | "Don't trust me, re-run it. The verifier checks the current v3 lifecycle and preserved deployments: receipts, events, bytecode, balances, commitments, and every rejected attack." |
| 2:20–2:45 | README "Measured on Diana" table | "A dual post-quantum payout costs 477 thousand gas. Escalation costs 39 thousand. Two different reports are the same 54,971 bytes after padding." |
| 2:45–3:00 | README hero | "Anonymous, encrypted and post-quantum, enforced by QoreChain's PQC precompile. Patch3Q. Build before Q-Day." |

## 90-second cut (for social posts)

Use these segments: 0:00–0:30, then 1:25–1:55, then 1:55–2:20 trimmed to the verifier's all-passed line, then 2:45–3:00.

## Recording checklist

1. Run `pnpm verify:evidence` once before recording, so the output is cached and the terminal is warm.
2. Run `pnpm dev`, and check that the header shows **v3 live on Diana · 10 verified v3 case transactions**.
3. Open explorer tabs for `0x7a19b4ba…` (case A release), `0xc764f928…` (case B escalation) and `0x4408d550…`
   (case B release). The full hashes are in the README.
4. Record at least two takes. Upload the video publicly, for example as an unlisted YouTube video, and add the URL to
   the README links table and the submission form.
