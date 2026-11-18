import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The public REST APIs send no CORS headers, so the browser reaches them
// through the dev (and preview) server: /lcd-testnet and /lcd-mainnet are
// forwarded to each network's REST endpoint (see PATCH3Q_REST_PROXY in src/lib/protocol.ts).
// In production, serve the app behind a proxy that does the same.
const rest = (target: string) => ({
  target,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/lcd-(testnet|mainnet)/, ""),
});
const proxy = {
  "/lcd-testnet": rest("https://api-testnet.qore.host"),
  "/lcd-mainnet": rest("https://api.qore.host"),
};

export default defineConfig({
  plugins: [react()],
  test: { exclude: ["contract-tests/**", "node_modules/**"] },
  server: { port: 5173, proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("scheduler")) return "react";
          if (id.includes("viem") || id.includes("abitype") || id.includes("ox")) return "evm";
          if (id.includes("@qorechain")) return "qorechain";
          if (id.includes("@noble") || id.includes("@scure")) return "crypto";
          return undefined;
        },
      },
    },
  },
});
