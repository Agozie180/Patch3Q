# Patch3Q competition audit — 2026-11-14

This is a historical re-audit against https://build.qorechain.io/. The public gallery later showed a much smaller,
stronger field, so the early submission-count assumption is no longer used.

> Historical engineering audit, not an official or independent score. The field and rubric evidence changed after this
> document was written. Do not present its self-assigned numeric score to judges; use
> [`judge-one-pager.md`](judge-one-pager.md) for the current, claim-bounded submission framing.

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
- **Contract tests.** Tests cover relayer separation, payout redirection, an ECDSA-only reporter signature,
  per-case key mismatch, deadline races, escalated-case closure and the disclosure rules. The suite now has 29 contract
  tests.
- **Crypto tests.** Six new tests cover anonymous bundles, the payout opening, bucket tampering and rationale salting,
  for 29 in total.
- **UI.** The app has a privacy ledger showing exactly what the chain sees, a payout-wallet generator, and a
  **v3 Live on Diana** badge driven by the current full-lifecycle evidence in `evidence/testnet-v3.json`.
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

`pnpm verify:evidence` re-checks the historical v1/v2 evidence plus the current v3 lifecycle against the live chain.
The README and deployment manifests list every hash.

## Repaired deployment (17 Nov 2026)

The audit fixes are no longer local-only. `Patch3QRegistry` v2 was deployed at
[`0xa7c6ff9db34aadb4301b183864d75d9a36c95b27`](https://dashboard.qorechain.io/explorer/address/0xa7c6ff9db34aadb4301b183864d75d9a36c95b27),
bound to a fresh `MockTUSDT` at
[`0x715a962d04391a0e308fd4fa36af63cec0df3bdc`](https://dashboard.qorechain.io/explorer/address/0x715a962d04391a0e308fd4fa36af63cec0df3bdc).
The deployment transaction is
[`0xc526a2bf…`](https://dashboard.qorechain.io/explorer/tx/0xc526a2bf7fc32f22dc07e791277a477d0dee1e6cc6dcc9c6dc2f4b96a964eebb).

## Current full-lifecycle deployment (18 Nov 2026)

`Patch3QRegistry` v3 is live at
[`0x9ec24151dc741f0c65d708c9410fbae2458f7863`](https://dashboard.qorechain.io/explorer/address/0x9ec24151dc741f0c65d708c9410fbae2458f7863),
bound to `MockTUSDT` at
[`0x2d42cbe73384b8c492da8e0d706aa56141902eb1`](https://dashboard.qorechain.io/explorer/address/0x2d42cbe73384b8c492da8e0d706aa56141902eb1).
I completed both anonymous V3 lifecycle paths, including atomic resolution in the normal and escalated payout
transactions. The verifier passes 50/50 V3 checks in addition to 64/64 preserved v1/v2 checks.

I then deployed V4 and ran its full funded lifecycle: an authorized relayer reserved 2,500 tUSDT from a 25,000 tUSDT
pool, the program acknowledged and triaged the case, and the program plus two unique auditors released the bounty to
the sealed recipient. The live pool now holds 22,500 tUSDT with zero open cases. The V4 verifier passes 49/49 checks.

## Findings, fixes and the tests that pin them

| # | Finding | Fix | Pinned by |
| --- | --- | --- | --- |
| 1 | One signer could approve a payout alone | Two independent ML-DSA-87 signatures, both verified by the precompile | `requires both independent PQ signatures` |
| 2 | A late program could race the keeper after the deadline | Late acknowledgement and triage revert, preserving permissionless escalation | `does not let a late acknowledgement race permissionless escalation`, `does not let a late triage race permissionless escalation` |
| 3 | A triage escalation could strand the case and escrow remainder | Reporter + auditor approval resolves an escalated case; disclosure and remainder refund become reachable | `closes an escalated triage case and unlocks disclosure plus remainder refund` |
| 4 | A signer could rotate keys after submission | The registry snapshots program, auditor and reporter key hashes at submission | `rejects a normal payout after the program rotates its bound PQ key`, `… reporter rotates …`, `… auditor rotates …` |
| 5 | The reporter's account was public on-chain | Anonymous mode: relayer anchoring and a per-case PQ key hash | `anchors without any reporter account and needs no registered reporter key` |
| 6 | Both signers together could redirect the bounty | A sealed payout commitment, with the recipient inside the signed digest | `stops the program and auditor from redirecting the bounty`, `binds the payout recipient into the replay-protected anonymous digest` |
| 7 | Envelope length revealed the PoC size | Padding to size buckets, with the bucket authenticated | `pads every report to a fixed size bucket so length does not leak the PoC` |
| 8 | A short rationale could be guessed from its hash | Salted rationale hash | `salts the rationale so a short decision cannot be guessed from its hash` |
| 9 | A fee-on-transfer token could create unbacked escrow | Exact before/after balance accounting | `rejects fee-on-transfer tokens instead of creating unbacked escrow` |
| 10 | Testnet claims could not be checked | Every hash recorded, plus independent historical and current verifiers | `pnpm verify:evidence`, 64/64 v1/v2 + 50/50 v3 + 49/49 v4, run in CI |
| 11 | The scoped-window negative test recorded a vague RPC error | Record the node's exact refusal text | `negativeTests.scopedWindowBlocksTokenCall` |
| 12 | The UI badge counted the deployment as a case transaction | Count only case transactions (11) | The production screenshot in `evidence/browser-home.png` |
| 13 | The README said the contract forbids a relayer that is the program or the auditor | Corrected: the app refuses it, and the relayer holds no on-chain role either way | README "Contract roles" |
| 14 | The hosted app had no route to Diana's REST API, which lacks CORS | Allowlisted `api/lcd-testnet.ts` proxy | `tests/lcd-proxy.test.ts` |
| 15 | Unused WalletConnect packages retained an unpatched `picomatch` ReDoS advisory | Replaced wagmi/RainbowKit with a direct QoreX + injected EIP-1193 adapter and pinned patched `zod` | `pnpm audit --prod`: no known vulnerabilities |
| 16 | A normal dual-PQ payout from `Triaged` still depended on the program sending a separate resolution transaction before disclosure | A valid dual-PQ payout now atomically marks both normal and escalated cases `Resolved` | `treats a normal dual-PQ payout as resolution and unlocks disclosure` |
| 17 | Browser smoke coverage proved rendering but not the product's cryptographic journey | The self-starting Chrome smoke now seals, independently decrypts, opens the payout commitment, co-signs with two ML-DSA-87 keys and rejects both ECDSA-only forgeries | `pnpm smoke:browser`, `evidence/browser-smoke.json` |
| 18 | Approval vault JSON could remain visible in form controls after signing | The UI labels signing as local-only and clears both secret form values immediately after the approval is created | Full browser journey plus source review |
| 19 | The production entry chunk exceeded Vite's 500 kB warning | React, EVM, QoreChain and crypto code now build as separate cacheable chunks; the application entry is under 100 kB | `pnpm build` |
| 20 | Case-specific funding meant the guarantee could still disappear before deposit | V4 program pools reserve the bounty atomically when an authorized relayer submits a case | 13 V4 contract tests |
| 21 | One auditor was a liveness bottleneck | Configurable, snapshotted auditor sets and unique threshold signatures; the client rehearses 2-of-3 | `tests/v4-client.test.ts` + V4 contract quorum tests |
| 22 | Ciphertext delivery was manual and could disappear | V4 emits the exact encrypted bundle bytes and SHA-256; the UI recovers and verifies them by case ID | `EncryptedBundlePublished`, `src/lib/v4-bundle.ts` |
| 23 | Anyone could otherwise drain a pre-funded pool with fabricated submissions | Only configured, PQ-registered relayers can submit, with a maximum open-case capacity | `lets only an authorized…`, `enforces…capacity` |
| 24 | The UI stopped at V3 even after the protocol upgrade | Fifth workspace configures policy/funding, publishes/recovers bundles, collects quorum, and releases reserve | browser smoke `v4*` assertions |

## Submission and operating choices

1. I am keeping the GitHub repository private unless I deliberately change that submission choice.
2. The 84-second demo and hosted app are already complete; I am leaving the video unchanged.
3. For the submission form, I will use **Encrypted Apps** and the Middle East & Africa region, with the repository,
   hosted demo, video and `public/cover.png` links.
4. The ready-to-post project updates are in `docs/build-in-public.md`.

## Competitive position

The closest competitor seen is SealedMed Referral, which is also an ML-KEM encrypted app with live Diana hashes. Patch3Q
beats it on three points. It has money at stake (escrow with dual-PQ release), it has an adversary built into the
protocol (ghosting leads to permissionless escalation), and its anonymity goes further than encrypting content. Patch3Q
now has its own live Diana hashes plus an independent verifier.

## Scoring note

Do not self-score this project in the submission. The official jury weights are: works as described 25%, verified
QoreChain usage 25%, post-quantum correctness and security 20%, originality 15%, and clarity/UX/documentation 15%.
The evidence in this document supports those criteria; it does not determine the jury's score.
