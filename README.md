# Patch3Q

![Patch3Q — anonymous, post-quantum bug-bounty escrow on QoreChain](public/cover.png)

**Report a vulnerability anonymously. Get paid only when two post-quantum signatures agree. If the vendor ghosts you, the chain takes their vote away.**

Patch3Q is a post-quantum bug-bounty escrow for QoreChain. The researcher seals the report in the browser with
ML-KEM-1024. The chain sees only hashes, deadlines and money. Every payout must carry two ML-DSA-87 signatures, and
the registry verifies them through QoreChain's `0x…0A01` PQC precompile before any token moves.

| In 10 seconds | |
| --- | --- |
| Who it is for | Security researchers and the projects that need their reports before Q-Day |
| What is new | An anonymous reporter: no wallet, no on-chain identity, payout address sealed inside the ciphertext |
| Why post-quantum matters | An attacker holding every ECDSA key still cannot decrypt the report or release the escrow |
| Proof | ML-KEM-1024 envelope · 2 × ML-DSA-87 verified on-chain · 0 identity on-chain |
| Category | **Encrypted Apps** (also eligible for Best AI-Native; see [`AI_USAGE.md`](AI_USAGE.md)) |

## What privacy you get

Most disclosure tools encrypt the report but leak the researcher. Patch3Q's default **anonymous mode** hides the
researcher as well.

| Data | Where it lives | Who can read it |
| --- | --- | --- |
| Report, PoC, rationale | QoreSeal envelope (ML-KEM-1024) | Maintainer and auditor only |
| Researcher identity | Nowhere. A relayer anchors the case | Nobody |
| Researcher authority | `keccak256` of a per-case ML-DSA-87 key | Whoever holds the per-case vault |
| Payout address | Sealed in the envelope; chain stores `keccak256(typehash, case, recipient, salt)` | Revealed only by the release transaction |
| Report size | Padded to 16 KiB / 64 KiB / 256 KiB / 1 MiB buckets | Bucket only |
| Severity rationale | Salted hash `keccak256(salt ‖ rationale)` | Signers only; cannot be guessed from common wording |
| Deadlines, amounts, lifecycle | Public on-chain | Everyone, by design. This is what makes ghosting provable |

Account mode is still available for researchers who want public credit.

## The story the contract enforces

1. **Seal.** The browser pads the report to a size bucket, salts it, and encrypts one envelope for the maintainer and an
   independent auditor using keys registered on QoreChain's PQC key registry.
2. **Anchor.** A relayer calls `submitAnonymousCase`. The registry snapshots the program and auditor ML-DSA-87 keys,
   stores the reporter's per-case key hash and the sealed payout commitment, and starts the acknowledge/triage clocks.
3. **Respond.** The program acknowledges, triages and funds the escrow in tUSDT.
4. **Ghosted?** Anyone can call `escalateMissedDeadline`. The program loses its vote for good, and the reporter's
   per-case PQ key replaces it.
5. **Pay.** `approveAnonymousSeverity` checks the payout opening against the commitment, checks the reporter key
   against its hash, verifies **both** ML-DSA-87 signatures via the precompile, then pays the sealed recipient.
6. **Disclose.** After the fix and the embargo, only the hash of a redacted report goes on-chain.

An ECDSA-only signature, a payout redirected to a different address, a relayer trying to release funds, and an early
escalation all revert. Each of these has a contract test, and each was replayed against Diana (see below).

## Live on Diana

Patch3Q is deployed on QoreChain Diana (`qorechain-diana`, EVM chain 9800). The full lifecycle ran end to end on
15 Nov 2026 between 00:32 and 00:50 WAT (23:32–23:50 UTC on 14 Nov). `pnpm verify:evidence` re-reads every receipt,
event, native transaction, case state, balance and bytecode from the chain, and **49/49 checks pass**
([`evidence/verification.json`](evidence/verification.json)).

| Contract | Address |
| --- | --- |
| `Patch3QRegistry` | [`0xb6b92510cd9ca5a1e7eac761243b51d73f619962`](https://dashboard.qorechain.io/explorer/address/0xb6b92510cd9ca5a1e7eac761243b51d73f619962). Runtime bytecode matches `artifacts/Patch3QRegistry.json` |
| `MockTUSDT` (bounty token) | [`0x2b0c104a434e034a14b95c6494f2d84cd9bdff54`](https://dashboard.qorechain.io/explorer/address/0x2b0c104a434e034a14b95c6494f2d84cd9bdff54) |

**Case A: normal lifecycle, anonymous reporter, 2,500 tUSDT**

| Step | Who sent it | Transaction |
| --- | --- | --- |
| Anchor the sealed case (`submitAnonymousCase`) | Relayer | [`0xe70e5dfb…`](https://dashboard.qorechain.io/explorer/tx/0xe70e5dfbe514b04841689e37039928f8a8677280c23910c0bb023e7693b5821c) |
| Acknowledge within the SLA | Program | [`0x23621e06…`](https://dashboard.qorechain.io/explorer/tx/0x23621e06e6359d027b5eda13aa3c279881cb07f14e29797f2e07724f674811af) |
| Triage within the SLA | Program | [`0xba5a1900…`](https://dashboard.qorechain.io/explorer/tx/0xba5a190041942432ef03d5f7c87c3d3791bd85662fff5c9a909ad4251977bcc3) |
| Fund the escrow | Program | [`0x3af1d051…`](https://dashboard.qorechain.io/explorer/tx/0x3af1d0513d263aeb2be08d41d2d5eda371c79d7f05c628febf686532422d9de3) |
| Resolve | Program | [`0xa65ead98…`](https://dashboard.qorechain.io/explorer/tx/0xa65ead980316f04819248eeb7bfe2f65ef8ce17b6394abd8638eb695a3d24dc7) |
| **Program + auditor ML-DSA-87 approvals verified by `0x…0A01`; payout to the sealed address** | Auditor | [`0x1feed506…`](https://dashboard.qorechain.io/explorer/tx/0x1feed50689a38db6df4244455a526685667f88a2868b3bb0b433023bbd76e755) |
| Redacted disclosure after the embargo | Program | [`0x8709019e…`](https://dashboard.qorechain.io/explorer/tx/0x8709019e0c9ae3fbd6e2f8a58aadb578573ced3e3f68d3b35ce0d5eb1985d085) |

**Case B: the program ghosts the researcher, 1,000 tUSDT**

| Step | Who sent it | Transaction |
| --- | --- | --- |
| Anchor the sealed case | Relayer | [`0xbe71ea75…`](https://dashboard.qorechain.io/explorer/tx/0xbe71ea756ca1d5ca6c3989bb6820de4a1d71d0587d021104a933f76d8e1d7f66) |
| Fund the escrow, then miss the acknowledgement deadline | Program | [`0xdc3d579f…`](https://dashboard.qorechain.io/explorer/tx/0xdc3d579fa74dac4d49c548f0145a29f3d8bb8ba36af02fa64e7d45b875bb6865) |
| **Permissionless escalation: the program loses its vote** | Relayer acting as keeper | [`0x48ebd14d…`](https://dashboard.qorechain.io/explorer/tx/0x48ebd14d1e8c6effe361692adc2a4b021243db32e1510062ae4372d7acba743e) |
| **Reporter's per-case ML-DSA-87 key + auditor release the bounty** | Auditor | [`0x02b5dde0…`](https://dashboard.qorechain.io/explorer/tx/0x02b5dde043293fdf3db6f3dcfc13c22020adb8cfc680d9faf435c415cf430c07) |

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

The 10 native transactions are listed under `native` in [`evidence/testnet.json`](evidence/testnet.json): key
registration with proof of possession, ML-KEM-1024 key publication, role funding and scoped EVM windows. Every
hybrid-signed one reports `pqc_hybrid_verify: verified`. The sealed bundles are published in
[`evidence/cases/`](evidence/cases), and each one hashes to its anchored `envelopeHash`. They are ciphertext only.

Reproduce it:

```sh
pnpm verify:evidence    # read-only: checks every claim above against Diana
pnpm verify:precompile  # live ML-DSA-87 precompile self-test

# or redeploy everything from scratch with your own accounts:
pnpm testnet:accounts   # writes .env.testnet (git-ignored)
pnpm testnet:status     # prints qor1 addresses; claim the faucet for the program address
pnpm testnet:e2e        # resumable: keys, windows, deployment, both cases, negative tests
```

## Run locally

Requirements: Node.js 20+ and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:5173, no wallet or network needed in demo mode
pnpm check        # typecheck, crypto tests, contract tests, Solidity compile, production build
```

Demo mode generates every key in the browser and downloads the decryption and approval vaults. Never publish a vault:
anyone who holds one can decrypt or approve its case. A static production host has to proxy `/lcd-testnet` to
`https://api-testnet.qore.host`, because the REST endpoint does not send CORS headers.

## Contract roles

- **Relayer** (anonymous mode): anchors the case. It has no authority after that and cannot be the program or the auditor.
- **Reporter**: a per-case ML-DSA-87 key in anonymous mode, or a wallet in account mode. Signs only after escalation.
- **Program**: acknowledges, triages, resolves, funds the escrow, and refunds any remainder after disclosure.
- **Auditor**: co-signs every payout and submits the release transaction.

The registry binds approvals to the chain ID, the registry address, the case, the ciphertext, the content commitment,
the severity, the amount, the rationale hash and, in anonymous mode, the payout recipient. Token handling follows
checks-effects-interactions, uses a reentrancy guard and exact balance accounting, and rejects fee-on-transfer tokens.

## Honest limits

- Deadlines are enforced permissionlessly but not autonomously. Someone has to send the escalation transaction.
- The relayer, the timing, the amounts and the program/auditor accounts are public. A relayer can refuse to relay,
  but it cannot read the report, redirect the payout or change the vote.
- The contract cannot decrypt the AAD. Recipients must check that the on-chain roles match the verified bundle.
- A compromised browser before sealing, stolen vaults, malicious recipients and unsafe redaction are out of scope.
- QoreSeal is pre-1.0. The cryptography and the contract are unaudited hackathon code.
- The QCAI precompiles returned empty data on the public Diana RPC, so no QCAI score is claimed
  ([`evidence/qcai-audit.json`](evidence/qcai-audit.json)).

More detail: [threat model](docs/threat-model.md), [architecture](docs/architecture.md),
[3-minute video script](docs/demo-runbook.md), [Q-Day Drill plan](docs/qday-drill.md),
[self-audit](docs/competition-audit.md).

## Built with (credits)

QoreChain kits and SDKs:

- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk): unified accounts, PQC key and KEM registration, EVM windows, hybrid signer
- [`@qorechain/qoreseal`](https://www.npmjs.com/package/@qorechain/qoreseal): ML-KEM-1024 multi-recipient envelopes
- [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign): ML-DSA-87 + secp256k1 hybrid message signatures
- [`@qorechain/evm`](https://www.npmjs.com/package/@qorechain/evm): EVM window cost and status helpers
- [`@qorechain/qorex-rainbowkit`](https://www.npmjs.com/package/@qorechain/qorex-rainbowkit): QoreX wallet connector
- QoreChain `IQorePQC` precompile at `0x0000000000000000000000000000000000000a01`

Open-source libraries: [viem](https://viem.sh), [wagmi](https://wagmi.sh), [RainbowKit](https://rainbowkit.com),
[TanStack Query](https://tanstack.com/query), [React](https://react.dev), [Vite](https://vitejs.dev),
[Vitest](https://vitest.dev), [Hardhat](https://hardhat.org), [solc-js](https://github.com/ethereum/solc-js),
[CosmJS](https://github.com/cosmos/cosmjs), [tsx](https://github.com/privatenumber/tsx) and
[TypeScript](https://www.typescriptlang.org). The Solidity contracts are original, with no third-party contract
imports.

## License

[MIT](LICENSE)
