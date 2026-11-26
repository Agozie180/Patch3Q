# V3 lifecycle on Diana

Moved out of the README to keep it focused on the current V5 deployment. Current V5 cases: [`evidence/v5-lifecycle.json`](../evidence/v5-lifecycle.json) and [`pnpm verify:evidence:v5`](../README.md#try-it-locally).
The V3 registry completed both anonymous lifecycles on 18 November 2026. `pnpm verify:evidence` checks receipts,
events, case state, balances, bundle commitments, and deployed bytecode. [V3 verification](../evidence/verification-v3.json)

**Case A: normal lifecycle, anonymous reporter, 2,500 tUSDT**

| Step | Who sent it | Transaction |
| --- | --- | --- |
| Anchor the sealed case (`submitAnonymousCase`) | Relayer | [`0x79b9ea57…`](https://dashboard.qorechain.io/explorer/tx/0x79b9ea57e910117d2919d4c19f87848b664f93c55ed5f752702a04143d654ee5) |
| Acknowledge within the SLA | Program | [`0xb32f32ad…`](https://dashboard.qorechain.io/explorer/tx/0xb32f32ad7ce49db495225ae2e59c40121ad8dededb96ec367f56d170fd17243a) |
| Triage within the SLA | Program | [`0x68edd99a…`](https://dashboard.qorechain.io/explorer/tx/0x68edd99a71f86ca6b994196b8497bc90669af2a122dc549012ce4edd8ccdddcd) |
| Fund the escrow | Program | [`0xb2baf938…`](https://dashboard.qorechain.io/explorer/tx/0xb2baf9388185ac392529b080d9bd3da43d287b3df5e42a1cc826de8223921a9b) |
| **Program + auditor ML-DSA-87 approvals atomically resolve the case and pay the sealed address** | Auditor | [`0x7a19b4ba…`](https://dashboard.qorechain.io/explorer/tx/0x7a19b4ba453d50a846e97eb48a1a3484ca9a0abf885ae30b290b074d7becb4e1) |
| Redacted disclosure after the embargo | Auditor | [`0x7b97c6b5…`](https://dashboard.qorechain.io/explorer/tx/0x7b97c6b525df661b94238c9c42986144f575706098ab332620439fd747e726a4) |

**Case B: the program ghosts the researcher, 1,000 tUSDT**

| Step | Who sent it | Transaction |
| --- | --- | --- |
| Anchor the sealed case | Relayer | [`0x832a7601…`](https://dashboard.qorechain.io/explorer/tx/0x832a76011ec1e09d7376540d1b68e7c9f9fd388d220106baed9459304a4f9a06) |
| Fund the escrow, then miss the acknowledgement deadline | Program | [`0x165a7907…`](https://dashboard.qorechain.io/explorer/tx/0x165a790701fdd05114074699fbc428ead18486f68e0d17b89f783b936e61b568) |
| **Permissionless escalation: the program loses its vote** | Relayer acting as keeper | [`0xc764f928…`](https://dashboard.qorechain.io/explorer/tx/0xc764f928bc1e04039add0619157d0d869b703b294b26911b87048526835ced90) |
| **Reporter's per-case ML-DSA-87 key + auditor release the bounty and resolve the case** | Auditor | [`0x4408d550…`](https://dashboard.qorechain.io/explorer/tx/0x4408d550a83fd80eef544bac1216c0643af2d55fa0dbc9a2a3c47f6ad2d035d2) |

No reporter account signed any transaction. Both payouts went to fresh per-case addresses that were
sealed inside the ciphertext and have never sent a transaction.

**Q-Day attacks, replayed against the live contracts**

| Attack | Diana's answer |
| --- | --- |
| Auditor approval signed with ECDSA only | `InvalidPqSignature` |
| Payout redirected to the auditor's address | `PayoutCommitmentMismatch` |
| Relayer tries to release the escrow | `NotAuditor` |
| Escalation before the deadline | `DeadlineNotMissed` |
| Auditor key used against another contract | The node refuses the transaction: the window "does not list [the token] as an allowed recipient" |

The 10 current native transactions are listed under `native` in [`evidence/testnet-v3.json`](../evidence/testnet-v3.json): key
registration with proof of possession, ML-KEM-1024 key publication, role funding and scoped EVM windows. Every
hybrid-signed one reports `pqc_hybrid_verify: verified`. The sealed bundles are published in
[`evidence/cases-v3/`](../evidence/cases-v3), and each one hashes to its anchored `envelopeHash`. They are ciphertext only.

Reproduce it:

```sh
pnpm verify:evidence    # read-only: checks every claim above against Diana
pnpm verify:precompile  # live ML-DSA-87 precompile self-test

# or redeploy everything from scratch with your own accounts:
pnpm deploy:testnet     # contracts only; reads private key or mnemonic from .env
pnpm testnet:accounts   # writes .env.testnet (git-ignored)
pnpm testnet:status     # prints qor1 addresses; claim the faucet for the program address
pnpm testnet:e2e:v3     # isolated/resumable: keys, windows, deployment, both cases, negative tests
```
