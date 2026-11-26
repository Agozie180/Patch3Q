# Browser smoke evidence

The production build is exercised in isolated headless browser profiles. The 25 November local review covers
installed Chrome, Edge, Brave and Firefox, separately at 1440×1000 and 390×844 viewports. See
[`review-validation.md`](review-validation.md) for the completed runs. The command starts and stops Vite preview
itself when the default local URL is not already running:

```sh
pnpm smoke:browser
```

To run the same suite against the public deployment in PowerShell:

```powershell
$env:PATCH3Q_BROWSER_URL = 'https://patch3-q.vercel.app/'
$env:PATCH3Q_BROWSER_OUTPUT = '.tmp/hosted-v5-desktop'
pnpm smoke:browser
```

The missed-deadline walkthrough confirms four Diana transaction receipts. The suite also checks V5 and V4 bundle
recovery, the selected case, the recovery notice, and the funded-pool balance. These Diana calls are read-only.

Set `PATCH3Q_BROWSER_WIDTH=390`, `PATCH3Q_BROWSER_HEIGHT=844` and a temporary `PATCH3Q_BROWSER_OUTPUT` to repeat the
mobile assertion without overwriting the committed desktop captures.

Set `PATCH3Q_CHROME_PATH` to the installed Chrome, Edge or Brave executable. For Firefox, set it to Firefox's
executable, set `PATCH3Q_BROWSER_ENGINE=firefox`, and install Selenium with `python -m pip install selenium`.
`PATCH3Q_SELENIUM_PATH` can point to a separate test-only installation; `PATCH3Q_PYTHON_PATH` can select Python.
Firefox runs the same journey and assertions through Selenium/WebDriver BiDi, with no app dependency changes.

Verified through the real demo journey:

- the hero and current V5 Diana testnet status rendered;
- all five workspace tabs and reporter form rendered without layout collapse;
- the V5 policy, durable-delivery and quorum sections rendered without page errors;
- the QoreChain synthetic customer-scenario control was visible;
- a synthetic report was populated and sealed into an ML-KEM-1024 envelope;
- the auditor vault independently opened it and passed every integrity check;
- the sealed payout instruction was recovered and matched to its commitment;
- the program and auditor produced two ML-DSA-87 hybrid approvals;
- both ECDSA-only forgery demonstrations were rejected;
- a deterministic injected EIP-1193 provider connected and disconnected through the direct wallet adapter;
- the generated production JavaScript initialized the React application rather than returning a blank page.
- neither viewport had horizontal overflow or page errors.
- the one-click quorum demo verified program + two auditors and reporter + two auditors;
- duplicate and insufficient auditor sets were rejected and stale successful results were cleared;
- local payout/rejection submission and disconnected anchor writes were disabled;
- real V5 paid and rejected cases were recovered, with current pool, status and decision deadline;
- the preserved V4 paid case was recovered without resetting the registry selector.

The following captures preserve the earlier browser run. Current V5 captures and reports are linked in
[review validation](review-validation.md). The archived captures are [`evidence/browser-home.png`](../evidence/browser-home.png),
[`evidence/browser-approval.png`](../evidence/browser-approval.png),
[`evidence/browser-v4.png`](../evidence/browser-v4.png),
[`evidence/browser-sealed.png`](../evidence/browser-sealed.png) and
[`evidence/browser-journey.png`](../evidence/browser-journey.png). Machine-readable journey assertions and page errors
are recorded in [`evidence/browser-smoke.json`](../evidence/browser-smoke.json).

The Codex sandbox-browser host was also retried and returned `browser access host is unavailable`, so this run did
not claim interactive sandbox-browser coverage. The application and cryptographic behavior are covered separately by
the 54 Vitest client/crypto/proxy cases and 78 contract-invariant tests run through `pnpm check`.
