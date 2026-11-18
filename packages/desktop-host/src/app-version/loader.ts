/**
 * @file Version loading for a window's brand: one read of the host-supplied version per `start()`,
 * with no package metadata in the renderer. A bridge without the method (an older preload) keeps the
 * brand usable, and IPC failures keep their actual message as state instead of throwing.
 */
import { createStore } from "./store.js";

/** The renderer's view of the version bridge; the method is optional so a stale preload still loads. */
export interface AppVersionBridge {
  readonly getAppVersion?: () => Promise<string>;
}

/** No guessed version while pending or unavailable; an IPC failure keeps its message. */
export interface AppVersionState {
  readonly version: string | null;
  readonly error: string | null;
}

export interface AppVersionLoader {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AppVersionState;
  /** Clear the state and read once; the returned disposer drops a reply that arrives after it. */
  start(): () => void;
}

const EMPTY: AppVersionState = { version: null, error: null };

/**
 * @example const loader = createAppVersionLoader({ bridge }); const dispose = loader.start();
 * @complexity O(1) time and space, one bridge request per `start()`.
 */
export function createAppVersionLoader(
  { bridge }: { readonly bridge: AppVersionBridge | undefined },
  _optional = {},
): AppVersionLoader {
  const store = createStore<AppVersionState>({ initial: EMPTY });
  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    start() {
      store.set(EMPTY);
      const getVersion = bridge?.getAppVersion;
      if (!getVersion) return () => undefined;
      let live = true;
      void (async () => {
        try {
          const version = await getVersion();
          if (live) store.set({ version, error: null });
        } catch (error) {
          if (live) store.set({ version: null, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return () => { live = false; };
    },
  };
}
