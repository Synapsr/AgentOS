/**
 * The app is served under a Content-Security-Policy without `unsafe-eval`.
 * zod, which checks everything the computer answers against the protocol,
 * tries to compile its schemas as they are created; under that policy the
 * attempt fails harmlessly but is reported as a violation on every load.
 * This tells it not to try. It must run before the protocol's schemas
 * exist: `main.tsx` imports this file first, and `vite.config.ts` keeps it
 * in zod's own chunk so that the order survives the build.
 */
import { config } from "zod";

config({ jitless: true });
