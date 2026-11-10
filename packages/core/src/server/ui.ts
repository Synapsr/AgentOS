/** Serves the web app built by `packages/ui`, or a small page saying AgentOS is running. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Translate } from "../i18n.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

/**
 * What the app's page may load and do. Everything it needs is a file of its
 * own: no inline script or style, nothing from elsewhere, and nobody may put
 * it in a frame. Pictures from the API are fetched with the token and shown
 * as `blob:`.
 */
function appPolicy(host: string | undefined): string {
  // The event stream is same-origin, which older WebKit does not take `'self'` to cover for WebSockets.
  const sockets = host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? ` ws://${host} wss://${host}` : "";
  return `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'${sockets}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

/** The placeholder page styles itself inline, loads nothing and runs nothing. */
const PLACEHOLDER_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Where the built app is: `AGENTOS_UI_DIR`, else `packages/ui/dist` next to this package. */
export function uiDirectory(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.AGENTOS_UI_DIR || fileURLToPath(new URL("../../../ui/dist", import.meta.url)));
}

/**
 * The response for a path of the app. A path that is not a file gets
 * `index.html`, so /os, /panel, /settings… open the app, which reads the
 * path itself. Null when the app has not been built. `host` is the name the
 * request was addressed to.
 */
export function serveUi(directory: string, path: string, host?: string): Response | null {
  const index = join(directory, "index.html");
  if (!existsSync(index)) return null;
  const inApp = (relative: string): string | null => {
    const file = resolve(directory, `.${sep}${relative}`);
    // `resolve` has already folded any "..": what is left must still be inside the app.
    return file.startsWith(directory + sep) && isFile(file) ? file : null;
  };
  // The app links its assets relatively (`./assets/…`): from /a/b the browser asks for /a/assets/….
  const asset = /\/(assets\/[^/]+)$/.exec(path)?.[1];
  const file = inApp(path) ?? (asset ? inApp(asset) : null) ?? (extname(path) ? null : index);
  // A missing file is missing: answering it with the app's page would only hide the mistake.
  if (!file) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const hashed = file.startsWith(join(directory, "assets") + sep);
  return new Response(new Uint8Array(readFileSync(file)), {
    headers: {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      // Vite names assets after their content, so they never change. The page itself is never kept: a
      // browser files a page under its full address, `#token=…` included, where other programs can read it.
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : extname(file) === ".html" ? "no-store" : "no-cache",
      ...(extname(file) === ".html" ? { "Content-Security-Policy": appPolicy(host) } : {}),
    },
  });
}

/** The page shown instead of the app when it has not been built. */
export function placeholderPage(agentName: string, t: Translate): Response {
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS</title>
<body style="margin:0;height:100vh;display:grid;place-content:center;justify-items:center;gap:20px;background:#000;color:#F5F5F7;font:300 20px system-ui,sans-serif;text-align:center">
<div style="width:72px;height:72px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#E8E8ED 55%,#8e8e93);box-shadow:0 0 60px rgba(232,232,237,.35)"></div>
<div>${escapeHtml(t("page.running", { agent: agentName }))}</div>
<div style="font-size:15px;font-weight:400;color:rgba(245,245,247,.56)">${escapeHtml(t("page.noApp"))}</div>
</body>
`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": PLACEHOLDER_POLICY },
  });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
