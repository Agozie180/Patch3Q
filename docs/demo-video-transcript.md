# Patch3Q V5 demo transcript

[Watch the V5 demo](https://patch3-q.vercel.app/demo-v5.mp4)

A bug bounty program reviewed a private report, then missed its final decision deadline. Patch3Q let the researcher and two auditors release the reserved bounty without the program's signature.

The researcher sealed a synthetic report in the browser. Patch3Q uses ML-KEM-1024 and registered QoreChain keys, so only the program and its configured auditors can decrypt the report. When the funded program accepted the case, the contract reserved 2,500 testnet tUSDT.

The program acknowledged the case and reviewed it on time. Then it missed the final decision deadline. Anyone could submit the escalation transaction. The contract replaced the program as a required payout signer with the researcher's per-case key. The same two-of-three auditor quorum still applied.

The researcher and two auditors signed. The contract checked their ML-DSA-87 signatures and paid the committed address. Open the hosted case to check the four receipts against Diana.

Programs opt in and fund the pool. Auditors still decide the claim. This was a synthetic case with test tokens. You can try signing in the browser without a wallet.
