# Build-in-public updates (ready to post)

Post these from the Patch3Q project page on build.qorechain.io, one at a time, and on X with `#BuildBeforeQDay`.
Each one is backed by a public transaction.

**1. Current v3 lifecycle live on Diana**

> Patch3Q v3 is live on QoreChain Diana. Its runtime bytecode matches the current artifact, and its full normal and
> ghosted lifecycles prove that pre-funded dual-PQ payouts atomically resolve cases. If the program misses its SLA,
> its vote is permanently replaced by the reporter's; the independent auditor remains required.
> https://dashboard.qorechain.io/explorer/tx/0xbc6da259b223a46a767ad1094d029f797469cd47cfb5f40da27f6fc514b76297

**2. Anonymous reporter**

> The first anonymous bug report has been anchored on Diana. A relayer submitted it, and no reporter account exists
> on-chain. The researcher is only a hash of a one-off ML-DSA-87 key, and the payout address is sealed inside the
> ciphertext.
> https://dashboard.qorechain.io/explorer/tx/0x79b9ea57e910117d2919d4c19f87848b664f93c55ed5f752702a04143d654ee5

**3. Two post-quantum signatures to pay**

> We released a 2,500 tUSDT bounty only after the contract verified two ML-DSA-87 signatures through the 0x0A01
> precompile. The money went to the sealed address, which nobody saw before this transaction.
> https://dashboard.qorechain.io/explorer/tx/0x7a19b4ba453d50a846e97eb48a1a3484ca9a0abf885ae30b290b074d7becb4e1

**4. Ghosted? The vendor loses its vote**

> A vendor funded a bounty, then missed its acknowledgement deadline. Six seconds later, a keeper escalated the case,
> and the reporter's per-case PQ key replaced the vendor's vote.
> https://dashboard.qorechain.io/explorer/tx/0xc764f928bc1e04039add0619157d0d869b703b294b26911b87048526835ced90
> Then the reporter and the auditor released the bounty:
> https://dashboard.qorechain.io/explorer/tx/0x4408d550a83fd80eef544bac1216c0643af2d55fa0dbc9a2a3c47f6ad2d035d2

**5. Q-Day attacks rejected live**

> We attacked our own deployment:
> - an ECDSA-only approval was rejected with `InvalidPqSignature`;
> - a redirected payout was rejected with `PayoutCommitmentMismatch`;
> - a relayer trying to release funds was rejected with `NotAuditor`;
> - an early escalation was rejected with `DeadlineNotMissed`;
> - a stolen auditor key outside its scoped EVM window was refused by the node.
>
> Anyone can re-check every deployment with `pnpm verify:evidence` (64/64 v1/v2 + 50/50 v3 + 49/49 v4).

**6. Pre-funded V4 quorum payout**

> I completed Patch3Q V4's full funded lifecycle on Diana. Submission atomically reserved 2,500 tUSDT from the
> program pool, and the program plus two unique auditors released it to the sealed payout address. The case closed,
> capacity returned to zero open cases, and 22,500 tUSDT remains backed in the pool.
> https://dashboard.qorechain.io/explorer/tx/0x87351ae1fa8c26cd0b68b21e198734087516eba2b0bdd8cedd6a65d2355dba8b
> https://dashboard.qorechain.io/explorer/tx/0xbbcd7b33038fb729ab5f5a0b5db18d7805f871b41df271cb799a4425b2421575
