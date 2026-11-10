import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_PORT } from "@agentos/protocol";

export default defineConfig({
  // Relative asset paths: the core serves the same build at `/`, `/os`,
  // `/panel`… and a relay may serve it under a prefix.
  base: "./",
  plugins: [react()],
  build: {
    // Never a `data:` address: the computer's Content-Security-Policy only allows images (and fonts) from itself.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // zod and `src/no-eval.ts` (which tells it never to use eval) share
        // one chunk, so that the setting is made before any other chunk —
        // the protocol's schemas among them — gets to run.
        manualChunks: (id) => (/\/node_modules\/zod\/|\/src\/no-eval\.ts$/.test(id) ? "zod" : undefined),
      },
    },
  },
  server: {
    // `pnpm dev` talks to a core running on this computer; `?demo` needs none.
    proxy: {
      "/v1": { target: `http://127.0.0.1:${DEFAULT_PORT}`, changeOrigin: true, ws: true },
    },
  },
});
