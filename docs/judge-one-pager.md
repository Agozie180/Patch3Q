# Patch3Q judge one-pager

## Category

Encrypted Apps

## Title

Patch3Q — pre-funded bug bounties with enforceable anti-ghosting rules

## Gallery tagline

Seal a vulnerability anonymously. If a funded program misses its SLA, it permanently loses its payout vote.

## Ten-second pitch

Patch3Q encrypts a vulnerability report in the browser for the program and an independent auditor quorum. V4 accepts
cases only against a pre-funded program pool, publishes the ciphertext durably, and reserves the bounty atomically. A
program that misses its SLA loses its vote: the reporter's one-off ML-DSA-87 key replaces it while any configured
threshold of snapshotted auditors can co-sign.

## Why it is different

- Sealed Disclosure and DeadDrop protect the report; Patch3Q also makes a funded SLA breach change payout authority.
- Postmark provides PQ bounty verdicts; Patch3Q additionally hides the report, reporter account and payout address.
- The payout address is committed at submission, so even both legitimate signers cannot redirect the bounty.
- Live Diana evidence covers a normal case, a ghosted case, permissionless escalation, dual-PQ payout and rejected
  classical-only approval.
- I ran the separate V4 registry with a 25,000 tUSDT pool, ten-case capacity and a live 2-of-3 payout.

## Honest boundary

Patch3Q cannot force an unregistered program to fund a bounty. The auditor threshold must still remain honest and
available; quorum removes one signer as a liveness bottleneck but is not an appeal court. Both the V3 lifecycles and
the complete V4 funded-pool lifecycle are verifiable on Diana.

## Judge proof path

1. Run `pnpm test` and `pnpm test:contract`: 42 client/crypto/app tests and 42 contract tests.
2. Run `pnpm verify:evidence`: 163/163 checks re-read bytecode, receipts, balances, V4 policy and lifecycle state from Diana.
3. Inspect the ghosted case: `0xc764f928…` removes the program vote; `0x4408d550…` releases 1,000 tUSDT with reporter
   + auditor ML-DSA-87 approvals.
4. Inspect the V4 lifecycle: `0x87351ae1…` reserves 2,500 tUSDT; `0xbbcd7b33…` completes the 2-of-3 payout and returns
   capacity to zero open cases with 22,500 tUSDT left in the pool.
5. Open the hosted app and complete the local seal → independent open → dual-PQ approval journey.

## Honest operating boundaries

- define an external auditor appeal/governance process beyond the on-chain quorum;
- operate a production relayer/keeper network instead of the user-supplied hackathon infrastructure.
