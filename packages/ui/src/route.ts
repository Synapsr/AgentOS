import { useSyncExternalStore } from "react";

/** The views the app can show, each one segment below the root (`home` is the root itself). */
export type View = "home" | "os" | "panel" | "settings" | "onboarding" | "add-phone";

const VIEWS: readonly string[] = ["os", "panel", "settings", "onboarding", "add-phone"] satisfies View[];

/**
 * The folder the app is served from: `/` by the computer itself,
 * `/n/<id>/` through a relay. Everything else is found from here — the
 * views, the API, the address a phone is sent to.
 */
const root = new URL(".", location.href);

/** The address of the computer's API: where the app is served, without the last slash. */
export const apiBase = root.href.replace(/\/$/, "");

/** The path of the root: what tells two computers apart behind one relay. */
export const rootPath = root.pathname;

const listeners = new Set<() => void>();
let navigated = false;

function current(): View {
  const segment = location.pathname.slice(rootPath.length).replace(/\/$/, "");
  return VIEWS.includes(segment) ? (segment as View) : "home";
}

/** Shows another view, keeping the query (`?demo`). */
export function navigate(view: View): void {
  navigated = true;
  history.pushState(null, "", rootPath + (view === "home" ? "" : view) + location.search);
  for (const listener of listeners) listener();
}

/** Whether there is a view of ours to go back to (not when a window opened straight on this one). */
export function canGoBack(): boolean {
  return navigated;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** The view the address bar points at. */
export function useView(): View {
  return useSyncExternalStore(subscribe, current);
}
