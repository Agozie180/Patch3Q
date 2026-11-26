# AI usage

Patch3Q is entered for **Best AI-Native Build**. Three AI assistants worked on it: **Cursor**, **OpenAI Codex** and
**Claude Code**. One rule governed all three: *an AI statement counts only when a test, a script or a chain receipt
reproduces it.* This file covers the workflow, the generated work and the human contribution, and every number in it
can be re-checked with the commands at the bottom.

## At a glance

| Assistant | Where it worked | Trail you can verify |
| --- | --- | --- |
| Cursor | Feature and documentation work, 14–16 Nov 2026 | 21 commits authored as `Cursor Agent` (`git log --author="Cursor Agent"`): the anonymous-reporter contract and UI, the resumable Diana end-to-end script, the on-chain evidence verifier, CI, gas measurements, the README restructure |
| OpenAI Codex | Adversarial protocol audit, then fixes | The five outcomes under [Codex audit outcomes](#codex-audit-outcomes), including findings 16–19 in [`docs/competition-audit.md`](docs/competition-audit.md) |
| Claude Code | One session only, on 26 Nov 2026: an independent judge-style audit and polish of the finished entry. It did not build the original product | The three changes and two refusals under [Claude Code audit pass](#claude-code-audit-pass) |

Git can attribute only Cursor's work. Everything else, including Codex's changes and the edits from the single
Claude Code session, carries the maintainer's git identity. No per-line AI percentage is claimed.

## What AI produced

| Output | Size | Proof |
| --- | --- | --- |
| Solidity registries (V1, V4, V5) | 3 contracts | `pnpm test:contract`: 78 passing |
| Client, crypto and proxy code | React + TypeScript app and libraries | `pnpm test`: 54 passing |
| Adversarial findings with a fix | 24 | The table in [`docs/competition-audit.md`](docs/competition-audit.md) |
| Live Diana cases | 5 completed V5 cases, plus earlier V3 and V4 cases | [`evidence/v5-lifecycle.json`](evidence/v5-lifecycle.json) |
| Independent on-chain checks | 359 (64 + 50 + 49 + 196) | `pnpm verify:evidence` |
| Documentation | 20 documents under `docs/` | Linked from the README |

All AI-drafted code was reviewed, run and merged by the maintainer.

## Workflow

| Stage | AI role | Human control | Verifiable output |
| --- | --- | --- | --- |
| Product framing | Challenge the original “encrypted disclosure” pitch against a crowded hackathon field | Chose the ghosted-researcher problem and accepted the narrower product scope | README thesis and comparison table |
| Threat modelling | Act as an attacker holding every classical ECDSA key and look for privacy, escrow and deadline failures | Decided which threats were in scope and rejected claims that could not be demonstrated | [`docs/threat-model.md`](docs/threat-model.md), [`docs/competition-audit.md`](docs/competition-audit.md) |
| Protocol design | Propose invariants and failure cases before implementation | Approved the dual-party authority model and lifecycle semantics | The V5 contract and its 23 dedicated tests in `contract-tests/registry-v5.test.ts` |
| Pair programming | Draft TypeScript, Solidity, tests, scripts and documentation under review | Reviewed diffs, ran the code and retained responsibility for every merge | `pnpm check`, browser evidence and Diana evidence |
| Adversarial QA | Judge the finished entry end to end, compare it with the live event field and find claims unsupported by evidence | Chose and implemented the fixes; kept unresolved items explicit | Findings 1–24 in the competition audit |
| Evidence verification | Build independent scripts that re-read receipts, bytecode, balances and event logs instead of trusting prose | Supplied the testnet accounts and approved broadcasts | `pnpm verify:evidence`: 359 checks, re-run against Diana by CI on every push |

## Codex audit outcomes

The latest Codex audit led directly to:

- normal dual-PQ payout becoming an atomic resolution, preventing post-payment disclosure deadlock;
- a browser journey that actually seals, decrypts and verifies a report, opens the payout commitment, produces two
  ML-DSA-87 approvals and proves both ECDSA-only forgeries fail;
- approval-vault form values being cleared immediately after signing;
- preservation of v2 bytecode hashes when the v3 candidate artifact changed;
- production bundle splitting and live Vercel verification.

## Claude Code audit pass

Claude Code was used in a single session on 26 Nov 2026, after the product, contracts and live evidence were built. It
reviewed the finished entry the way a judge would. It read the event rules and rubric,
sampled about 20 competing Encrypted Apps entries and their repositories, and re-ran this project's own claims
before reporting on them: 196 of 196 live V5 checks, 54 client tests and 78 contract tests, all passing.

Changes that came out of the pass:

1. **Trust assumption stated.** The contract lets the program appoint its own auditors, so escalation removes the
   program's vote but not that assumption. The README now says so near the top and under Limitations.
2. **Setup friction removed.** `package.json` pins pnpm 10.33.4 and an older pnpm stops with `ERR_PNPM_BAD_PM_VERSION`.
   The README now says to run `corepack enable`.
3. **History moved out of the README.** The V3 lifecycle walkthrough now lives in [`docs/v3-lifecycle.md`](docs/v3-lifecycle.md),
   so the README leads with the current V5 deployment. This file's own stale counts were corrected in the same pass.

Suggestions the maintainer declined, with the reason:

- **A second-auditor case on the live V5 registry.** Not run. `scripts/verify-v5-evidence.ts` pins the registry to the
  program's 19,000 tUSDT pool with zero open cases, and CI re-checks that on every push. A key the maintainer controls
  would also prove nothing about independence, so the README keeps the single-operator disclosure instead.
- **A second key derived from the deployer seed phrase.** Not done. That phrase is the verified deployer identity.

## Important adversarial findings produced with AI

The review did not merely generate code. It found and pinned protocol failures:

1. One signer could originally approve a payout alone.
2. A late program could race permissionless deadline escalation.
3. Two legitimate signers could redirect an anonymous payout.
4. Key rotation could invalidate the authority assumed at submission.
5. Report length and short rationale hashes leaked avoidable information.
6. A fee-on-transfer token could create unbacked accounting.
7. A normal payout could leave the case stuck in `Triaged` until the program sent another transaction.

Each accepted finding has a code change and a named regression test or recorded evidence in
[`docs/competition-audit.md`](docs/competition-audit.md).

## Validation discipline

AI output is not treated as evidence. Changes must pass:

```sh
pnpm check              # typecheck, 54 client/crypto/proxy tests, 78 contract tests, production build
pnpm smoke:browser      # complete local browser cryptographic journey
pnpm verify:evidence    # 359 checks across V1–V5; includes recorded recipient guard evidence
pnpm verify:precompile  # exact QoreSign domain accepted by Diana
pnpm audit --prod       # dependency advisory check
```

The same browser journey is also run against [`https://patch3-q.vercel.app`](https://patch3-q.vercel.app). Needs Node.js
20+ and pnpm 10.33.4 (`corepack enable`).

## Data boundary

Real vulnerability reports must never be provided to an assistant. The maintainer authorized local testnet key use for
V5 deployment; scripts read ignored environment and recovery files in memory without printing them. The Claude Code
pass listed environment variable names only, never their values. Private vaults, recipient keys and recovery material
remain ignored and are excluded from hosted uploads. Agent instruction files (`CLAUDE.md`, `AGENTS.md`, `.claude/`) are
git-ignored. Reports are encrypted locally in the browser. All repository examples and live cases use synthetic content.

## QCAI disclosure

`pnpm audit:qcai` probes QoreChain's on-chain AI precompiles against representative registry bytecode and calldata.
The public Diana RPC returned empty data, so Patch3Q records the unavailable result in
[`evidence/qcai-audit.json`](evidence/qcai-audit.json) and does not invent or claim an AI risk score.
