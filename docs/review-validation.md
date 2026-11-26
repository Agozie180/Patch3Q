# Historical local review — 25 November 2026

This page records the pre-deployment review. For the current deployment and five-case evidence, see [V5 on Diana](v5-review.md).

All changes remain local and uncommitted. No push, deployment or new chain transaction was performed.
The existing V3/V4 contracts, their addresses, compiled artifacts, evidence files and application dependencies remain unchanged.
Baseline commit: `cde086a915c2197d1027f82856942c1c8508b67a`.

## Completed checks

| Check | Result |
| --- | --- |
| Full `pnpm check` | Passed: typecheck, 51 client tests, 75 contract tests, contract compilation and production build |
| Preserved Diana evidence | 163/163: 64 preserved v1/v2, 50 v3, 49 v4 |
| PQ precompile | Passed: exact QoreSign domain verified on Diana |
| Production dependency audit | No known vulnerabilities |
| Patch whitespace / browser runner syntax | Passed |
| Browser matrix | Eight sequential runs, 46/46 each: 368 assertions total |

The machine had pnpm 9 globally. The full check used the project's exact pnpm version without replacing it globally:

```sh
npx --yes --package pnpm@10.33.4 pnpm check
```

Logs: [full suite](../.tmp/review/full-suite.log), [browser matrix](../.tmp/review/browser-matrix.log),
[Diana verification](../.tmp/review/chain-verification.log), [precompile](../.tmp/review/precompile-verification.log).
Fresh chain verification reports were saved under `.tmp/review/`; committed evidence files were restored byte for byte.

## Browser runs

The installed browser executables ran headlessly in fresh temporary profiles, one after another. Chrome, Edge and Brave
used CDP; installed Firefox used Selenium 4.54 and WebDriver BiDi with test-only dependencies in `.tmp/review/python-deps`.
User browser profiles were not used.

| Browser / layout | Viewport | Result | Evidence |
| --- | --- | --- | --- |
| Chrome Desktop | 1440 × 1000 | 46/46 | [report](../.tmp/review/chrome-desktop/browser-smoke.json) |
| Chrome Mobile | 390 × 844 | 46/46 | [report](../.tmp/review/chrome-mobile/browser-smoke.json) |
| Edge Desktop | 1440 × 1000 | 46/46 | [report](../.tmp/review/edge-desktop/browser-smoke.json) |
| Edge Mobile | 390 × 844 | 46/46 | [report](../.tmp/review/edge-mobile/browser-smoke.json) |
| Brave Desktop | 1440 × 1000 | 46/46 | [report](../.tmp/review/brave-desktop/browser-smoke.json) |
| Brave Mobile | 390 × 844 | 46/46 | [report](../.tmp/review/brave-mobile/browser-smoke.json) |
| Firefox Desktop | 1440 × 1000 | 46/46 | [report](../.tmp/review/firefox-desktop/browser-smoke.json) |
| Firefox Mobile | 390 × 844 | 46/46 | [report](../.tmp/review/firefox-mobile/browser-smoke.json) |

Each run covered all five workspaces, the existing synthetic seal → independent decrypt → dual-PQ approval journey,
both classical-only forgery rejections, wallet connection/disconnection through a deterministic EIP-1193 test provider,
normal program + two-auditor quorum, reporter + two-auditor quorum, duplicate and insufficient quorum rejection,
stale-success clearing, and disabled demo transactions even with a connected wallet. No page errors were recorded.

Each report links eight screenshots. The final home and quorum captures were visually compared across browsers.
A contact sheet is at [browser homes](../.tmp/review/browser-homes.png).

## Review boundary

The mobile runs test responsive layouts in installed desktop browsers; they are not physical Android/iOS tests.
The wallet provider is a deterministic test double, so these runs do not claim real-extension transaction signing.
The hosted site was not updated. New frontend behavior is available only in the local build until publication is approved.

V5 is a local candidate, not a Diana deployment. Its contract tests cover the new post-triage deadline, exact deadline
boundary, late-program races, invalid-report rejection, complete reserve return, capacity reuse, quorum and replay guards.
Client rejection tests use real PQ signatures; contract unit tests use the existing precompile-harness approach.
The live precompile check verifies the signing domain used by the protocol, but no live V5 lifecycle is claimed.

The auditor threshold can still reject a valid claim or become unavailable; external appeals and independent operators
remain necessary operating decisions. Recipient-wallet PQ security is separate from escrow authorization.

Review [V5 behavior and trust boundary](v5-review.md), [V5 versus V4 comparison](../.tmp/review/v5-change.patch),
and the uncommitted changes in the working tree. Local preview: http://127.0.0.1:4173/.
