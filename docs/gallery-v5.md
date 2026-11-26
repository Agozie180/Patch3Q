# Patch3Q · Encrypted Apps

**Tagline**

Anonymous bug reports. Bounties reserved upfront. Miss a deadline, lose your payout vote.

**Demo URL**

https://patch3-q.vercel.app/#missed-deadline

**Video URL**

https://youtu.be/RBpziQWC418

**Diana testnet registry**

0xba42c59f3982202dbe2358a0d238de098eaf1ddb

**Mock tUSDT token, if the form accepts a second address**

0x2D42CBe73384b8C492da8E0d706AA56141902eB1

**About**

A researcher can find a serious vulnerability, report it responsibly, and still be left chasing a response and a payment. The program receiving the report controls what happens next. If it goes silent, the researcher holds a dangerous finding and an unenforceable promise.

I built Patch3Q to give that silence a concrete consequence.

Patch3Q is an anonymous bug-bounty escrow on QoreChain. A participating program funds a pool. When an authorized relayer submits a case, the contract sets aside its bounty immediately. A case can only be accepted if the pool can cover it. The researcher encrypts the report in the browser for the program and its auditors and can report without using their own wallet on-chain. The payout address stays sealed until release.

Normally, a payout requires the program and two of three auditors to sign under the deployed policy. If the program misses its acknowledgement, triage, or final decision deadline, anyone can submit an escalation transaction. The researcher takes the program’s place as a payout signer. Two of the same three auditors still have to approve the claim.

On Diana testnet, a program acknowledged and triaged a synthetic report on time, then missed its final decision deadline. The researcher and two auditors signed, and the contract paid **2,500 testnet tUSDT** to the address committed when the report was filed. The demo lets you check the reservation, triage, escalation, and payout transactions without a wallet. In a separate case, two auditors rejected an invalid report and the full reserve went back to the program’s pool.

**How it’s made**

Patch3Q uses React and TypeScript for the browser app and Solidity for escrow, deadlines, and payouts. Encryption, decryption, and approval verification run locally. The app has no plaintext upload path.

QoreSeal encrypts the report with ML-KEM-1024 using keys from QoreChain’s recipient key registry. The encrypted bundle binds the ML-DSA-87 fingerprints of the approval authorities. Reports are padded into fixed size buckets to reduce what their length gives away. The researcher uses a fresh signing key per case, and the payout address and secret salt stay inside the encrypted report. The contract checks that the recipient matches the commitment before releasing funds.

The registry reserves the bounty and records the case’s deadlines and auditor set at submission. The program can’t withdraw that reserve or replace the case’s auditors afterward. The registry publishes the encrypted bundle in transaction logs so it can be recovered from chain history and checked against its SHA-256 hash.

QoreChain’s `pqcVerify` precompile checks the ML-DSA-87 signatures before settlement. Each payout approval is tied to the chain, registry, case, encrypted report, auditor set, severity, payout amount, rationale commitment, and recipient. Duplicate or insufficient auditor signatures and classical-only signatures fail verification. QoreSign supplies the hybrid approval messages, the QoreChain SDK handles key registration and scoped EVM windows, and QoreX connects through EIP-6963.

V4 proved that a funded case could go from reservation to payment with two auditors. V5 adds a final decision deadline, even when a case is marked resolved without payment, and lets the auditor quorum reject an invalid report and return the reserve. Run `pnpm verify:evidence:v5` without keys to check all five Diana cases, including the contract’s `DeadlineExpired` rejection of a late program payout. [Verification report](../evidence/v5-verification.json)

## Festival form selections

**Network:** QoreChain Diana testnet, `qorechain-diana`, EVM chain ID `9800`.

**Network features**

- [x] **EVM window (incl. scoped)**. The V5 relayer window was scoped to the registry. The program window allowed the registry and mock bounty token. [Relayer window](https://dashboard.qorechain.io/explorer/tx/C3D54893F19B5FC9164813923F68C05891FA9151BA7637560ECB61E00C1C1E8D)
- [x] **Hybrid ML-DSA-87 transactions**. Diana verified the native program and relayer window transactions as hybrid-signed. [Program window](https://dashboard.qorechain.io/explorer/tx/FCC1929E4C283D51C9EA527F215CCCB11C315600E7654631B6FBE71C771EE340)
- [x] **PQC key registration with proof of possession**. The V5 payout recipient’s registration transaction carries a proof of possession. [Registration](https://dashboard.qorechain.io/explorer/tx/AD8871CBAAF4723F9C3F60EB9A27744E159170D878F887CB0EED67D42F7D18B9)
- [x] **QoreSeal and the encryption key registry**. The app encrypts in the browser to registered QoreChain recipients. [ML-KEM key registration](https://dashboard.qorechain.io/explorer/tx/0E259C91817259797D089D9A95765A56F28C2D70C252A71B12860805229E77F2)
- [x] **Solidity PQC key status**. The V5 registry calls `pqcKeyStatus` to check registered ML-DSA-87 keys.
- [x] **Solidity PQC signature check**. The V5 registry calls `pqcVerify` for payout and rejection signatures. The two Solidity boxes currently show **Declared** on the event site. [V5 contract](../contracts/Patch3QRegistryV5.sol) · [Payout receipt](https://dashboard.qorechain.io/explorer/tx/0x9e48cc90a6585c7759daf6c5ebad2d05f6ffa8e9869ea52464a32146ab5464c2)
- [ ] **Test tokens fUSD, fETH, fBTC**. Patch3Q uses MockTUSDT for the bounty.
- [ ] **QCAI risk/anomaly checks**, if offered. The testnet probe returned empty data. [Probe results](../evidence/qcai-audit.json)

**Kits and SDKs**

- [x] **QoreChain SDK**. `@qorechain/sdk` for accounts, key registration, native hybrid transactions, and EVM windows. `@qorechain/evm` provides the Diana EVM preset and helpers.
- [x] **QoreSeal**. `@qorechain/qoreseal` for in-browser ML-KEM-1024 encryption and decryption.
- [x] **QoreSign**. `@qorechain/qoresign` for hybrid approval messages.
- [x] **QoreX integrations**. `@qorechain/qorex-types` for direct QoreX detection and connection.
- [ ] **qorechain-pqc**. Remove the existing declaration for the separately listed kit. The app uses QoreSeal, QoreSign, and QoreChain’s native PQC features.
- [ ] **Wallet adapter**. The festival uses this label for its Cosmos-wallet kit. Patch3Q has its own EVM wallet connector and uses QoreX integrations.
