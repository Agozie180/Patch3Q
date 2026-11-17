# Browser smoke evidence

On 2026-11-17, the production build was served with Vite preview and loaded in installed Google Chrome using its
background headless mode at 1440×1400 and 390×844 viewports. With the preview running, reproduce the desktop check with:

```sh
pnpm smoke:browser
```

Set `PATCH3Q_BROWSER_WIDTH=390`, `PATCH3Q_BROWSER_HEIGHT=844` and a temporary `PATCH3Q_BROWSER_OUTPUT` to repeat the
mobile assertion without overwriting the committed desktop captures.

Verified visually:

- the hero and current v2 Diana testnet status rendered;
- the four workspace tabs and reporter form rendered without layout collapse;
- the QoreChain synthetic customer-scenario control was visible;
- the script selected the approval workspace and found the two-party PQ approval heading;
- a deterministic injected EIP-1193 provider connected and disconnected through the direct wallet adapter;
- the generated production JavaScript initialized the React application rather than returning a blank page.
- neither viewport had horizontal overflow or page errors.

The captures are [`evidence/browser-home.png`](../evidence/browser-home.png) and
[`evidence/browser-approval.png`](../evidence/browser-approval.png). Machine-readable assertions and page errors are
recorded in [`evidence/browser-smoke.json`](../evidence/browser-smoke.json).

The Codex sandbox-browser host was also retried and returned `browser access host is unavailable`, so this run did
not claim interactive sandbox-browser coverage. The application and cryptographic behavior are covered separately by
the 35 Vitest crypto/proxy cases and 28 contract-invariant tests run through `pnpm check`.
