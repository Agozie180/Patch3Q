# Patch3Q · Encrypted Apps

**Anonymous bug reports. Bounties reserved upfront. If the program misses a deadline, the researcher takes over its payout vote.**

[Open the completed case](https://patch3-q.vercel.app/#missed-deadline) · [Watch the V5 demo](https://patch3-q.vercel.app/demo-v5.mp4)

On Diana, a program accepted and triaged a synthetic report on time, then missed its final decision deadline. The report stayed encrypted. A transaction escalated the case, the researcher and two auditors signed, and the contract paid **2,500 testnet tUSDT** to the committed address. The demo reads four receipts directly from Diana. [Escalation transaction](https://dashboard.qorechain.io/explorer/tx/0x1fd093ec19d8c1905f7215172f6737ceea14b69bf1f10a3afb1992ec18aeaac7) · [Payout transaction](https://dashboard.qorechain.io/explorer/tx/0x9e48cc90a6585c7759daf6c5ebad2d05f6ffa8e9869ea52464a32146ab5464c2)

The browser seals the report with ML-KEM-1024 to registered QoreChain recipients and binds each approval authority's ML-DSA-87 fingerprint. The registry verifies signatures on-chain. The five-case V5 run covers normal payout, two missed deadlines, rejection with reserve return, and escalation after a case was marked resolved without payment. [V5 registry](https://dashboard.qorechain.io/explorer/address/0xba42c59f3982202dbe2358a0d238de098eaf1ddb) · [Evidence](../evidence/v5-lifecycle.json)

Programs opt in and fund their pools. A transaction is required to escalate. Two of three auditors can co-sign a payout or reject a case under the live policy. The cases used synthetic reports, test tokens, and one operator in multiple roles. [Threat model](threat-model.md)

Run `pnpm verify:evidence:v5` for 196 live checks. **Try signing in your browser** works without a wallet and sends no transaction.
