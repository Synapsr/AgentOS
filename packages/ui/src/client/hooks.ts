import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FileRef } from "@agentos/protocol";
import { translator, type Translate } from "../i18n";
import type { State, Store } from "./store";

const StoreContext = createContext<Store | null>(null);

/** Gives the views below access to the connection. */
export const StoreProvider = StoreContext.Provider;

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("No store: this view needs a connection to a computer.");
  return store;
}

/** Subscribes to one part of the state. `select` must return what is in the state, not a new object. */
export function useAppState<T>(select: (state: State) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

const never = () => () => {};

/**
 * The translation function, in the language of the computer's agent, or
 * the browser's while there is no connection yet. `{agent}` is always filled.
 */
export function useT(): Translate {
  const store = useContext(StoreContext);
  const node = useSyncExternalStore(store?.subscribe ?? never, () => store?.getState().node ?? null);
  const language = node?.language ?? navigator.language;
  const agent = node?.agent.name ?? "";
  return useMemo(() => translator(language, { agent }), [language, agent]);
}

/** A URL for a stored file, once it has been fetched. */
export function useFileUrl(file: FileRef | null): string | null {
  const { client } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let current = true;
    client.fileUrl(file).then(
      (found) => current && setUrl(found),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [client, file?.id]);
  return file ? url : null;
}
