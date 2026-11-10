// First: it must run before anything creates a schema.
import "./no-eval";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHttpClient } from "./client/http";
import { createStore } from "./client/store";
import { findToken, forgetToken } from "./client/token";
import { apiBase } from "./route";
import { Pair } from "./views/Pair";
// As a file of its own, never a `data:` address: the page's Content-Security-Policy only allows images from the computer.
import favicon from "@agentos/design/brand/favicon.svg?no-inline";

// The mark, from the design system (it follows light and dark by itself).
document.head.append(Object.assign(document.createElement("link"), { rel: "icon", href: favicon }));

/** `?demo` runs against a scripted computer; otherwise a token decides between the app and pairing. */
async function boot(): Promise<ReactNode> {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo !== null) {
    const { demoScreen } = await import("./demo");
    return demoScreen(demo);
  }
  const token = await findToken(apiBase);
  if (!token) return <Pair />;
  // The computer may refuse this token later (the device was removed): only
  // it is forgotten, and the page starts again with whatever else it holds.
  const refused = () => {
    forgetToken(token);
    location.reload();
  };
  return <App store={createStore(createHttpClient(apiBase, token))} onRefused={refused} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode>{await boot()}</StrictMode>);
