# QoreChain project page

**Tagline**

Anonymous bug reports. Bounties reserved upfront. Miss a deadline, and the researcher takes over the program’s payout vote.

**Demo URL**

https://patch3-q.vercel.app/#missed-deadline

**Video URL**

https://patch3-q.vercel.app/demo-v5.mp4

**Diana testnet registry**

0xba42c59f3982202dbe2358a0d238de098eaf1ddb

**About**

A program reviewed a private bug report on time and reserved 2,500 testnet tUSDT, then missed its final decision deadline. Patch3Q let the researcher replace the program as payout signer. Two auditors co-signed, and the contract paid the committed address. Open the demo to see all four receipts verified on QoreChain Diana. This was a synthetic testnet case.

Patch3Q encrypts bug reports in the browser. Participating programs fund a pool, and the contract sets aside a bounty for each accepted case. Anyone can submit an escalation after a missed deadline. Auditors still assess the claim, and a quorum can reject a report and return its reserve.

**How it’s made**

The browser uses QoreSeal and ML-KEM-1024 with registered QoreChain recipient keys. The authenticated report binds the ML-DSA-87 fingerprints of the approval authorities. An authorized relayer anchors the encrypted report, so the researcher needs no wallet to appear on-chain as the sender. The Solidity registry snapshots case deadlines and the auditor quorum and checks post-quantum signatures with QoreChain’s precompile. Five V5 cases ran on Diana, including a normal payout, a final-decision escalation, and a rejection that returned the full reserve. The GitHub repo includes a keyless verifier.
