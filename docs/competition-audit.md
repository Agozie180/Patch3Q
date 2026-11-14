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

## Remaining (human-only)

1. **Q-Day Drill registration** closes on 17 Nov 2026 at 23:59 UTC (18 Nov, 00:59 WAT).
2. **Video.** Record it from `docs/demo-runbook.md`, keep it under 3 minutes, and add the link to the README.
3. **Submission form.** Choose **Encrypted Apps** and link the repo, the video and `public/cover.png`.
4. Optional: post the hashes under `#BuildBeforeQDay` for build-in-public credit.

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
