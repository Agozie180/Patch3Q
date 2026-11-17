# Build-in-public updates (ready to post)

Post these from the Patch3Q project page on build.qorechain.io, one at a time, and on X with `#BuildBeforeQDay`.
Each one is backed by a public transaction.

**1. Repaired v2 live on Diana**

> Patch3Q v2 is live on QoreChain Diana. Its runtime bytecode matches the current artifact and closes the late-action
> deadline race plus escalated-case liveness gap found in the audit. The historical v1 lifecycle remains independently
> reproducible; the app now targets v2.
> https://dashboard.qorechain.io/explorer/tx/0xc526a2bf7fc32f22dc07e791277a477d0dee1e6cc6dcc9c6dc2f4b96a964eebb

**2. Anonymous reporter**

> The first anonymous bug report has been anchored on Diana. A relayer submitted it, and no reporter account exists
> on-chain. The researcher is only a hash of a one-off ML-DSA-87 key, and the payout address is sealed inside the
> ciphertext.
> https://dashboard.qorechain.io/explorer/tx/0xe70e5dfbe514b04841689e37039928f8a8677280c23910c0bb023e7693b5821c

**3. Two post-quantum signatures to pay**

> We released a 2,500 tUSDT bounty only after the contract verified two ML-DSA-87 signatures through the 0x0A01
> precompile. The money went to the sealed address, which nobody saw before this transaction.
> https://dashboard.qorechain.io/explorer/tx/0x1feed50689a38db6df4244455a526685667f88a2868b3bb0b433023bbd76e755

**4. Ghosted? The vendor loses its vote**

> A vendor funded a bounty, then missed its acknowledgement deadline. Six seconds later, a keeper escalated the case,
> and the reporter's per-case PQ key replaced the vendor's vote.
> https://dashboard.qorechain.io/explorer/tx/0x48ebd14d1e8c6effe361692adc2a4b021243db32e1510062ae4372d7acba743e
> Then the reporter and the auditor released the bounty:
> https://dashboard.qorechain.io/explorer/tx/0x02b5dde043293fdf3db6f3dcfc13c22020adb8cfc680d9faf435c415cf430c07

**5. Q-Day attacks rejected live**

> We attacked our own deployment:
> - an ECDSA-only approval was rejected with `InvalidPqSignature`;
> - a redirected payout was rejected with `PayoutCommitmentMismatch`;
> - a relayer trying to release funds was rejected with `NotAuditor`;
> - an early escalation was rejected with `DeadlineNotMissed`;
> - a stolen auditor key outside its scoped EVM window was refused by the node.
>
> Anyone can re-check the v2 deployment and preserved v1 lifecycle with `pnpm verify:evidence` (62/62).
