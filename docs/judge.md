# Patch3Q judge guide

Patch3Q is a post-quantum bug bounty escrow. An accepted report reserves its bounty upfront. If the program misses a deadline, the researcher takes its place as a payout signer and the auditor quorum still has to approve the payment. [Project brief](judge-one-pager.md)

1. [Open the completed case](https://patch3-q.vercel.app/#missed-deadline). Wait for **Four receipts confirmed on Diana**. Follow the escalation and payout receipts to see the researcher and two auditors authorize **2,500 testnet tUSDT** to the committed address.
2. Try **Try signing in your browser** to verify a quorum approval with no wallet or transaction. [Short video](https://patch3-q.vercel.app/demo-v5.mp4) · [Runbook](demo-runbook.md)
3. Run `pnpm verify:evidence:v5` from the repository to reproduce 196 checks across the five completed V5 cases. It reads Diana without signing or broadcasting transactions. [Deployment](../evidence/v5-deployment.json) · [Recorded results](../evidence/v5-verification.json)

| Jury criterion | Where to look |
| --- | --- |
| Works as described (25%) | The completed case shows the reserve, timely triage, escalation, and payout. [Five-case record](../evidence/v5-lifecycle.json) |
| Verified QoreChain usage (25%) | Diana deployment and lifecycle receipts, including native PQ key registration and scoped EVM windows. [Testnet evidence](testnet-evidence.md) |
| Post-quantum correctness and security (20%) | Client-side ML-KEM-1024 sealing, on-chain ML-DSA-87 verification, and the quorum and recipient checks. [Threat model](threat-model.md) · [V5 verification](../evidence/v5-verification.json) |
| Originality (15%) | Funds are reserved at acceptance. A missed deadline changes who signs the payout while keeping the same auditor threshold. [V5 review](v5-review.md) |
| Clarity, UX, and documentation (15%) | The public walkthrough leads to four receipts, followed by a wallet-free exercise. [Demo runbook](demo-runbook.md) |

The rehearsal used synthetic reports, test tokens, and one operator in multiple roles. Programs opt in and fund their pools. Escalation requires a transaction, and the auditor quorum can refuse payout. [Operating boundaries](v5-review.md#trust-and-operating-boundaries)

## Run locally

Use Node.js 22 and pnpm 10.33.4. If you already have the repository, start with `pnpm install` from its root.

```sh
git clone https://github.com/Agozie180/Patch3Q.git
cd Patch3Q
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173), choose **Load QoreChain synthetic customer scenario**, then click **Seal report**. Open **Verify & open** and use one of the demo vaults to decrypt it. The local demo needs no wallet or API key.
