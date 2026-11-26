# V5 live deployment and review — 25 November 2026

V5 is deployed on QoreChain Diana (EVM chain 9800):
[`0xba42c59f3982202dbe2358a0d238de098eaf1ddb`](https://dashboard.qorechain.io/explorer/address/0xba42c59f3982202dbe2358a0d238de098eaf1ddb).
The deployer is `0x688604db30CcfF6C3BB16fb34D897209475d6bcb`, matching V2 and V4.
The V5 registry is a new address; it reuses V4's six-decimal MockTUSDT token. V3/V4 sources, artifacts,
deployment addresses and historical evidence remain preserved.

## Decision deadlines and rejection

V5 snapshots `decisionBy = triageBy + decisionGracePeriod` at acceptance. The default is seven days;
`configureProgramPolicyWithDecisionGrace` permits one second through 365 days. Later policy changes
cannot change accepted deadlines. Anyone can escalate after expiry, including a case marked resolved without
payment. The reporter replaces the program with the same auditor quorum. Late normal payout and resolution
revert, preventing the program from racing enforcement. Payout exactly at the deadline is valid.

`rejectAnonymousCase` requires the auditor quorum to sign a separate digest binding chain, registry, case,
ciphertext, auditor set, full reserve and salted rationale. It returns the complete reserve, releases capacity
and appends terminal status `Rejected = 6`. It transfers no bounty. Neither program nor reporter can veto this
verdict. Rejected cases cannot be paid, refunded twice, escalated or disclosed. Positive payouts retain V4's
registry-bound wire encoding; rejections use a distinct V5 domain.

## Completed live rehearsal

All reports are synthetic. Short policies made deadline paths reproducible; the operating policy was restored.

| Case | Completed outcome |
| --- | --- |
| Normal | Program + two auditors paid 2,500 tUSDT; redacted disclosure completed |
| Invalid report | Quorum rejected; full 2,500 tUSDT reserve returned |
| Acknowledgement ghost | Escalated; reporter + two auditors paid 1,000 tUSDT; 1,500 returned |
| Decision ghost | Timely acknowledgement/triage, missed decision; reporter + two auditors paid 2,500 tUSDT |
| Resolved but unpaid | Missed decision escalated despite resolved status; quorum rejected and returned full reserve |

Final pool: **19,000 tUSDT**, exactly backed by registry holdings; **zero open cases**.
Restored policy: 24-hour acknowledgement, seven-day triage, 30-day embargo, seven-day decision grace,
ten-case capacity, three auditors, threshold two and the authorized V4 relayer.

Evidence: [deployment](../evidence/v5-deployment.json), [all receipts](../evidence/v5-lifecycle.json),
[keyless verification](../evidence/v5-verification.json), [recipient guard checks](../evidence/v5-recipient-security.json).
Paid recipients have registered ML-DSA-87 keys and closed EVM windows. The node explicitly rejected actual
classical-only one-unit self-transfers. The keyless verifier rechecks identities, key fingerprints and closed
windows, and separately labels recorded broadcast rejections. Operator windows are closed as well.

## Browser behavior and verification

The app defaults to V5 and retains V4 in the registry selector. Recovery scans logs in 9,000-block pages and
verifies bundle SHA-256. The chosen version survives recovery; stale demo results are cleared. The wallet-free
demo uses real encryption and hybrid signatures for both payout authorities and rejection. Synthetic demo
transactions remain disabled even with a connected wallet.

Run `pnpm check`, `pnpm verify:evidence`, `pnpm verify:precompile`, `pnpm keeper:v5` and `pnpm smoke:browser`.
See [review validation](review-validation.md) for the installed-browser matrix and its limits.

## Trust and operating boundaries

The auditor threshold can collude, reject a valid report or become unavailable. External appeals and independent
production operators remain operating requirements. Someone must submit deadline enforcement; payment is not
automatic on a timer. Funding is opt-in.

The browser's fresh-address generator creates an ordinary ECDSA wallet; PQ protection is configured separately.
The three live V5 recipients were registered and checked with closed windows. Owners can grant future EVM
permissions; this rehearsal does not guarantee every future wallet configuration. Testnet tUSDT has no claim
of monetary value. [Watch the V5 walkthrough](https://patch3-q.vercel.app/demo-v5.mp4).
