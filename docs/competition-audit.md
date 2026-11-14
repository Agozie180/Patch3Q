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

## Remaining blockers (human-only)

1. **Faucet.** It requires a signed-in QoreChain dashboard account. Claim it for the program address from
   `pnpm testnet:status`, then run `pnpm testnet:e2e`. Until that happens, testnet evidence scores 0.
2. **Q-Day Drill registration** closes on 17 Nov 2026 at 23:59 UTC.
3. **Video.** Record it after the evidence is verified, and keep it under 3 minutes.
4. **Submission form.** Choose **Encrypted Apps** and link the repo, the video and the cover.

## Competitive position

The closest competitor seen is SealedMed Referral, which is also an ML-KEM encrypted app with live Diana hashes. Patch3Q
beats it on three points. It has money at stake (escrow with dual-PQ release), it has an adversary built into the
protocol (ghosting leads to permissionless escalation), and its anonymity goes further than encrypting content. That
lead only counts once Patch3Q also has live hashes.

## Score

| Criterion | Before | Now, without testnet | With `testnet:e2e` + video |
| --- | --- | --- | --- |
| Problem and story | 9/10 | 10/10 | 10/10 |
| Encrypted-app fit | 14/15 | 15/15 | 15/15 |
| Cryptographic implementation | 14/15 | 14/15 | 14/15 |
| Smart-contract core | 13/15 | 14/15 | 14/15 |
| Threat model and honesty | 9/10 | 10/10 | 10/10 |
| Tests and reproducibility | 9/10 | 10/10 | 10/10 |
| Testnet evidence | 0/15 | 0/15 | 14/15 |
| Demo, customer and build-in-public | 2/10 | 4/10 | 8/10 |
| **Total** | **70** | **77** | **95** |

The top-quality award threshold is 70/100. Most of the remaining points come from the faucet claim and the video.
