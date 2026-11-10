import type { ReactNode } from "react";
import { App } from "../App";
import { createStore } from "../client/store";
import { forceAppearance } from "../ui/surface";
import { createDemoClient, type Scenario } from "./demo";
import { PresenceGallery } from "./PresenceGallery";

const SCENARIOS: Scenario[] = ["idle", "working", "waiting", "question", "approval", "job", "offline", "onboarding"];

/** What `?demo=<value>` shows (see `demo.ts` for the values). */
export function demoScreen(value: string): ReactNode {
  const query = new URLSearchParams(location.search);
  const appearance = query.get("appearance");
  if (appearance === "light" || appearance === "dark") forceAppearance(appearance);
  if (value === "presence") return <PresenceGallery />;
  const scenario = SCENARIOS.find((name) => name === value) ?? "idle";
  const language = query.get("lang") ?? navigator.language;
  document.documentElement.lang = language.slice(0, 2);
  const options = { remote: query.has("remote"), account: query.has("account"), language };
  return <App store={createStore(createDemoClient(scenario, options))} />;
}
