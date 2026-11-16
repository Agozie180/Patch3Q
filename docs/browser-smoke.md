# Browser smoke evidence

On 2026-11-14, the production build was served with Vite preview and loaded in installed Google Chrome using its
background headless mode at a 1440×1400 viewport. With the preview running, reproduce the check with:

```sh
pnpm smoke:browser
```

Verified visually:

- the hero and Diana testnet status rendered;
- the four workspace tabs and reporter form rendered without layout collapse;
- the QoreChain synthetic customer-scenario control was visible;
- the script selected the approval workspace and found the two-party PQ approval heading;
- the generated production JavaScript initialized the React application rather than returning a blank page.

The captures are [`evidence/browser-home.png`](../evidence/browser-home.png) and
[`evidence/browser-approval.png`](../evidence/browser-approval.png). Machine-readable assertions and page errors are
recorded in [`evidence/browser-smoke.json`](../evidence/browser-smoke.json).

The Codex sandbox-browser host was also retried and returned `browser access host is unavailable`, so this run did
not claim interactive sandbox-browser coverage. The application and cryptographic behavior are covered separately by
the 35 Vitest crypto/proxy cases and 25 contract-invariant tests run through `pnpm check`.
