# Browser smoke evidence

The production build is loaded in installed Google Chrome using background headless mode at 1440×1400 and 390×844
viewports. The command starts and stops Vite preview itself when the default local URL is not already running:

```sh
pnpm smoke:browser
```

Set `PATCH3Q_BROWSER_WIDTH=390`, `PATCH3Q_BROWSER_HEIGHT=844` and a temporary `PATCH3Q_BROWSER_OUTPUT` to repeat the
mobile assertion without overwriting the committed desktop captures.

Verified through the real demo journey:

- the hero and current v3 Diana testnet status rendered;
- all five workspace tabs and reporter form rendered without layout collapse;
- the V4 policy, durable-delivery and quorum sections rendered without page errors;
- the QoreChain synthetic customer-scenario control was visible;
- a synthetic report was populated and sealed into an ML-KEM-1024 envelope;
- the auditor vault independently opened it and passed every integrity check;
- the sealed payout instruction was recovered and matched to its commitment;
- the program and auditor produced two ML-DSA-87 hybrid approvals;
- both ECDSA-only forgery demonstrations were rejected;
- a deterministic injected EIP-1193 provider connected and disconnected through the direct wallet adapter;
- the generated production JavaScript initialized the React application rather than returning a blank page.
- neither viewport had horizontal overflow or page errors.

The captures are [`evidence/browser-home.png`](../evidence/browser-home.png),
[`evidence/browser-approval.png`](../evidence/browser-approval.png),
[`evidence/browser-v4.png`](../evidence/browser-v4.png),
[`evidence/browser-sealed.png`](../evidence/browser-sealed.png) and
[`evidence/browser-journey.png`](../evidence/browser-journey.png). Machine-readable journey assertions and page errors
are recorded in [`evidence/browser-smoke.json`](../evidence/browser-smoke.json).

The Codex sandbox-browser host was also retried and returned `browser access host is unavailable`, so this run did
not claim interactive sandbox-browser coverage. The application and cryptographic behavior are covered separately by
the 41 Vitest client/crypto/proxy cases and 42 contract-invariant tests run through `pnpm check`.
