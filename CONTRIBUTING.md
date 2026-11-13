# Contributing

Use Node.js 20 or newer and pnpm. Install dependencies with `pnpm install`, then run `pnpm check` before opening a pull request.

Keep changes focused and never commit `.env` files, recipient vaults, approval keys, decrypted reports, proof-of-concept exploits, or real vulnerability data. Tests must use synthetic reports.

Contract changes should preserve the rule that plaintext, salts, recipient keys, and exploit material never reach the chain. Cryptographic changes should include tamper and wrong-key tests.
