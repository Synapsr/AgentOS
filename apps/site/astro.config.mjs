// The AgentOS website. A static site: `pnpm build` writes plain files to dist/.
import { defineConfig } from "astro/config";

/** Where the site is published (SITE_URL overrides it, e.g. for a preview). */
export const SITE = process.env.SITE_URL ?? "https://os.synapsr.io";

export default defineConfig({
  site: SITE,
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "always" },
  devToolbar: { enabled: false },
  vite: {
    // Read the screenshots straight from docs/screenshots (see src/screenshots.ts).
    server: { fs: { allow: ["../.."] } },
    // Icons stay files rather than inline data, so that link previews and crawlers can fetch them.
    build: { assetsInlineLimit: 0 },
  },
});
