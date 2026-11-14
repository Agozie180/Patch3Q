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
escalation all revert. Each of these has a contract test, and `pnpm testnet:e2e` replays each one against Diana.

## Live on Diana

`evidence/testnet.json` is the source of truth. When it reports `"status": "verified"`, the app header shows a
**Live on Diana** badge, and every transaction links to `https://dashboard.qorechain.io/explorer/tx/<hash>`.

To produce the full evidence set yourself:

```sh
pnpm install
pnpm testnet:accounts   # creates program, auditor and relayer accounts in .env.testnet (git-ignored)
pnpm testnet:status     # prints qor1 addresses, balances, PQ key and EVM window status
# Claim the faucet for the program qor1 address at https://dashboard.qorechain.io/faucet
pnpm testnet:e2e        # resumable: funds roles, registers keys, deploys, runs two anonymous cases
```

The run registers ML-DSA-87 keys with proof of possession and publishes ML-KEM-1024 keys with hybrid native
transactions. It opens scoped EVM authorization windows and deploys `MockTUSDT` and `Patch3QRegistry`. It then runs one normal case through acknowledgement, triage,
funding, dual-PQ release and disclosure, and one ghosted case through permissionless escalation and a reporter plus
auditor release. It records every hash and each negative test in `evidence/testnet.json`. The run saves a checkpoint
after each step, so you can rerun it after any failure.

The live precompile self-test runs on its own:

```sh
pnpm verify:precompile
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
