/**
 * @file One "check for updates" action at a time. The host's main process runs the check and shows
 * every notice itself; the window only waits for it and then closes whatever opened the action.
 */
import { createStore } from "./store.js";

/** The renderer's view of the update bridge; the method is optional so a stale preload still loads. */
export interface UpdateCheckBridge {
  /** Resolves once the check's first notice is shown; never carries renderer input. */
  readonly checkForUpdates?: () => Promise<void>;
}

export interface UpdateCheckState {
  /** False with a stale preload: a menu leaves the row out rather than offer a dead one. */
  readonly available: boolean;
  /** True from the click until the host has answered. */
  readonly checking: boolean;
}

export interface UpdateCheck {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UpdateCheckState;
  /** No-op without the bridge method or while a check runs; otherwise `onDone` runs on success AND failure. */
  checkForUpdates(): Promise<void>;
}

/**
 * @param required.report Receives a broken-channel failure's message (the host reports check failures itself).
 * @example const check = createUpdateCheck({ bridge, onDone, report });
 * @complexity O(1) time and space, one bridge request per accepted call.
 */
export function createUpdateCheck(
  { bridge, onDone, report }: {
    readonly bridge: UpdateCheckBridge | undefined;
    readonly onDone: () => void;
    readonly report: (required: { readonly message: string }, optional?: Record<string, never>) => void;
  },
  _optional = {},
): UpdateCheck {
  const run = bridge?.checkForUpdates;
  const store = createStore<UpdateCheckState>({ initial: { available: run !== undefined, checking: false } });
  const setChecking = (checking: boolean): void => store.set({ available: run !== undefined, checking });
  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    async checkForUpdates() {
      if (!run || store.getSnapshot().checking) return;
      setChecking(true);
      try {
        await run();
      } catch (error) {
        report({ message: error instanceof Error ? error.message : String(error) });
      } finally {
        setChecking(false);
        onDone();
      }
    },
  };
}
