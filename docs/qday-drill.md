# Q-Day Drill plan

The Q-Day Drill gives the attacker the ECDSA key of a participating account. Registration closes on
**17 Nov 2026 at 23:59 UTC** (18 Nov, 00:59 WAT), and the drill runs on 18 Nov.

## What we enter

The **program** account `qor1hfxnr2fr4camsk54qmvjjlkdfddgt9gpmu6fwv` (`0xBa4D31a923aE3Bb85A9506D9297ecd4B5a859501`).
It owns both historical rehearsal cases on preserved v1 registry `0xb6b92510cd9ca5a1e7eac761243b51d73f619962`.
The current v2 registry is `0xa7c6ff9db34aadb4301b183864d75d9a36c95b27`; a new drill case should target v2.

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
4. Record the block height and the escrow balance before and after the drill in `evidence/testnet.json`.
