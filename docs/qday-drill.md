# Q-Day Drill plan

The Q-Day Drill gives the attacker the ECDSA key of a participating account. Registration closes on
**17 Nov 2026 at 23:59 UTC** (18 Nov, 00:59 WAT), and the drill runs on 18 Nov.

## What we enter

The current **program** account is `qor15p2d4k946fmjqmr7nw9dydkuwk7xej6grxu5z4`
(`0xa054dAd8B5D277206c7e9B8aD236dc75Bc6cCB48`). The current v3 registry is
`0x9ec24151dc741f0c65d708c9410fbae2458f7863`; any new drill case should target v3.

## Why the attacker gets nothing

| Attacker action with the ECDSA key | Result |
| --- | --- |
| Decrypt any case bundle | Impossible. The envelopes use ML-KEM-1024 and the ECDSA key is not a decryption key |
| Approve a payout | Reverts. The registry requires two ML-DSA-87 signatures through the `0x…0A01` precompile |
| Redirect a payout to the attacker | Reverts with `PayoutCommitmentMismatch`, and the signatures do not cover the attacker's address |
| Move native QOR | The SDK documents that mainnet enforces the ML-DSA-87 hybrid extension. On Diana, keep the program's native balance low; the bounty sits in the escrow contract, not the account |
| Use the auditor's or relayer's EVM window against other contracts | Rejected. Those windows are scoped to the registry |
| Learn who the researcher is | Impossible. There is no reporter account, only a per-case key hash |

## Before the drill

1. Register before the deadline at https://build.qorechain.io/.
2. Reduce the program account's EVM window to the minimum, or let it expire, so the drill tests the PQ layer and not
   an open classical window.
3. Leave one funded, unresolved synthetic case live as bait. Both rehearsal cases are already paid out, so run one
   more case before the drill.
4. Record the block height and the escrow balance before and after the drill in a separate drill evidence file.
