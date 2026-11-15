# Patch3Q competition audit — 2026-11-14

This is a re-audit against https://build.qorechain.io/, judging the entry as one of about 2,000 submissions.

## 10-second test

**Before:** "post-quantum vulnerability-disclosure and bug-bounty escrow". That was accurate, but it was the third
encrypted-report app in a judge's queue.

**After:** *"Report a bug anonymously. Get paid only when two post-quantum signatures agree. If the vendor ghosts you,
the chain takes their vote away."* The headline has a clear hero (the researcher), a villain (the ghosting vendor and
Q-Day) and a mechanism a judge can check (two ML-DSA-87 signatures verified on-chain).

## What changed in this audit

- **Privacy.** Anonymous reporter mode is now the default:
  - relayer anchoring (`submitAnonymousCase`)
  - a per-case ML-DSA-87 reporter key known only by its hash
  - a sealed payout address with an on-chain commitment opened at release (`approveAnonymousSeverity`)
  - size-bucket padding
  - salted rationale hashes
- **Contract tests.** Eight new tests cover relayer separation, payout redirection, an ECDSA-only reporter signature,
  per-case key mismatch, use of the account-mode entry point and the disclosure rules. The suite now has 25 contract
  tests.
- **Crypto tests.** Six new tests cover anonymous bundles, the payout opening, bucket tampering and rationale salting,
  for 29 in total.
- **UI.** The app has a privacy ledger showing exactly what the chain sees, a payout-wallet generator, a
  **Live on Diana** badge driven by `evidence/testnet.json`, and new hero copy.
- **Testnet.** `pnpm testnet:e2e` is a one-command, resumable Diana run. It covers key registration, scoped windows,
  deployment, two anonymous cases (normal and ghosted), and Q-Day negative tests replayed with `eth_call`.
- **Submission requirements.** The README has the credits section the rules require. The repo now has `AI_USAGE.md`,
  a 16:9 cover at `public/cover.png`, a 3-minute video script (the earlier script ran five minutes) and a Q-Day Drill
  plan.

## Testnet run (15 Nov 2026, 00:32–00:50 WAT)

The faucet was claimed for the program account, and `pnpm testnet:e2e` completed on Diana with exit code 0:

- 10 native transactions: key registration, KEM publication, role funding and scoped windows
- 2 deployments
- 11 case transactions across a normal case and a ghosted case
- 5 rejected Q-Day attacks

`pnpm verify:evidence` re-checks all of it against the live chain, and 49/49 checks pass. The README lists every hash.

## Findings, fixes and the tests that pin them

| # | Finding | Fix | Pinned by |
| --- | --- | --- | --- |
| 1 | One signer could approve a payout alone | Two independent ML-DSA-87 signatures, both verified by the precompile | `requires both independent PQ signatures` |
| 2 | A late program could undo an escalation by acting after the deadline | `Escalated` permanently removes the program's vote | `does not let a late program undo acknowledgement escalation`, `… triage escalation` |
| 3 | A signer could rotate keys after submission | The registry snapshots program, auditor and reporter key hashes at submission | `rejects a normal payout after the program rotates its bound PQ key`, `… reporter rotates …`, `… auditor rotates …` |
| 4 | The reporter's account was public on-chain | Anonymous mode: relayer anchoring and a per-case PQ key hash | `anchors without any reporter account and needs no registered reporter key` |
| 5 | Both signers together could redirect the bounty | A sealed payout commitment, with the recipient inside the signed digest | `stops the program and auditor from redirecting the bounty`, `binds the payout recipient into the replay-protected anonymous digest` |
| 6 | Envelope length revealed the PoC size | Padding to size buckets, with the bucket authenticated | `pads every report to a fixed size bucket so length does not leak the PoC` |
| 7 | A short rationale could be guessed from its hash | Salted rationale hash | `salts the rationale so a short decision cannot be guessed from its hash` |
| 8 | A fee-on-transfer token could create unbacked escrow | Exact before/after balance accounting | `rejects fee-on-transfer tokens instead of creating unbacked escrow` |
| 9 | Testnet claims could not be checked | Every hash recorded, plus an independent verifier | `pnpm verify:evidence`, 49/49, run in CI |
| 10 | The scoped-window negative test recorded a vague RPC error | Record the node's exact refusal text | `negativeTests.scopedWindowBlocksTokenCall` |
| 11 | The UI badge counted the deployment as a case transaction | Count only case transactions (11) | The production screenshot in `evidence/browser-home.png` |
| 12 | The README said the contract forbids a relayer that is the program or the auditor | Corrected: the app refuses it, and the relayer holds no on-chain role either way | README "Contract roles" |
| 13 | The hosted app had no route to Diana's REST API, which lacks CORS | Allowlisted `api/lcd-testnet.ts` proxy | `tests/lcd-proxy.test.ts` |

## Remaining (human-only)

1. **Make the GitHub repository public.** The rules require a public repo, and `Agozie180/Patch3Q` is currently private.
2. **Q-Day Drill registration** closes on 17 Nov 2026 at 23:59 UTC (18 Nov, 00:59 WAT).
3. **Video.** Record it from `docs/demo-runbook.md`, keep it under 3 minutes, and add the link to the README.
4. **Hosted demo.** Confirm the publish and choose **public** visibility, then add the URL to the README links table.
5. **Submission form.** Choose **Encrypted Apps** and the Middle East & Africa region. Link the repo, the video and
   `public/cover.png`.
6. **Build-in-public.** Post the ready-made updates in `docs/build-in-public.md` from the project page.
7. **Repository description.** Set it to: *Anonymous, post-quantum bug-bounty escrow on QoreChain: ML-KEM-1024 sealed
   reports, 2 × ML-DSA-87 verified on-chain, live on Diana.*

## Competitive position

The closest competitor seen is SealedMed Referral, which is also an ML-KEM encrypted app with live Diana hashes. Patch3Q
beats it on three points. It has money at stake (escrow with dual-PQ release), it has an adversary built into the
protocol (ghosting leads to permissionless escalation), and its anonymity goes further than encrypting content. Patch3Q
now has its own live Diana hashes plus an independent verifier.

## Score

| Criterion | Before | Now (live on Diana) | With video + drill |
| --- | --- | --- | --- |
| Problem and story | 9/10 | 10/10 | 10/10 |
| Encrypted-app fit | 14/15 | 15/15 | 15/15 |
| Cryptographic implementation | 14/15 | 14/15 | 14/15 |
| Smart-contract core | 13/15 | 14/15 | 14/15 |
| Threat model and honesty | 9/10 | 10/10 | 10/10 |
| Tests and reproducibility | 9/10 | 10/10 | 10/10 |
| Testnet evidence | 0/15 | 14/15 | 15/15 |
| Demo, customer and build-in-public | 2/10 | 4/10 | 8/10 |
| **Total** | **70** | **91** | **96** |

The top-quality award threshold is 70/100. Most of the remaining points come from the video.
