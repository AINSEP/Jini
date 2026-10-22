/** Fake Tauri surfaces for tests — never a real `@tauri-apps/*` import (see `tauri-surfaces.ts`). */
import type {
  TauriChildProcessLike,
  TauriDialogApi,
  TauriFileInfo,
  TauriFsApi,
  TauriShellApi,
  TauriSidecarCommandApi,
  TauriSingleInstanceApi,
  TauriWindowCreateOptions,
  TauriWindowFactory,
  TauriWindowLike,
} from './tauri-surfaces.js';

export function createFakeTauriSingleInstanceApi(_requiredArgs: Record<string, never>): TauriSingleInstanceApi & { emitSecondInstance({ args, cwd }: { args: string[]; cwd: string }): void } {
  const listeners: Array<(args: { args: string[]; cwd: string }) => void> = [];
  return {
    onSecondInstance({ listener }) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emitSecondInstance({ args, cwd }) {
      for (const listener of listeners) listener({ args, cwd });
    },
  };
}

export function createFakeTauriWindowFactory(_requiredArgs: Record<string, never>): { factory: TauriWindowFactory; windows: TauriWindowLike[] } {
  const windows: TauriWindowLike[] = [];
  const factory = async (_requiredArgs: Pick<TauriWindowCreateOptions, 'label' | 'url'>, _options: Omit<TauriWindowCreateOptions, 'label' | 'url'> = {}): Promise<TauriWindowLike> => {
    let closed = false;
    const closeListeners: Array<() => void> = [];
    const closedListeners = new Set<() => void>();
    const win: TauriWindowLike & { navigatedTo: string[] } = {
      navigatedTo: [],
      async show() {},
      async hide() {},
      async setFocus() {},
      async close() {
        for (const listener of closeListeners) listener();
        closed = true;
        for (const listener of closedListeners) listener();
      },
      async navigate({ url }: { url: string }) {
        win.navigatedTo.push(url);
      },
      isClosed() {
        return closed;
      },
      onCloseRequested({ listener }) {
        closeListeners.push(listener);
        return () => {
          const index = closeListeners.indexOf(listener);
          if (index >= 0) closeListeners.splice(index, 1);
        };
      },
      onClosed({ listener }) {
        closedListeners.add(listener);
        return () => { closedListeners.delete(listener); };
      },
    };
    windows.push(win);
    return win;
  };
  return { factory, windows };
}

export function createFakeTauriShellApi(_requiredArgs: Record<string, never>): TauriShellApi & { openedUrls: string[]; openedPaths: string[] } {
  const openedUrls: string[] = [];
  const openedPaths: string[] = [];
  return {
    openedUrls,
    openedPaths,
    async openUrl({ url }: { url: string }) {
      openedUrls.push(url);
    },
    async openPath({ path }: { path: string }) {
      openedPaths.push(path);
    },
  };
}

/** `directories`/`files` are absolute-path allow-lists the fake checks `exists`/`stat` against — no real filesystem I/O, matching this module's own "never a real @tauri-apps/* import" convention (and, transitively, no real `node:fs` either). */
export function createFakeTauriFsApi(_requiredArgs: Record<string, never>, seed: { directories?: string[]; files?: string[] } = {}): TauriFsApi {
  const directories = new Set(seed.directories ?? []);
  const files = new Set(seed.files ?? []);
  return {
    async exists({ path }: { path: string }) {
      return directories.has(path) || files.has(path);
    },
    async stat({ path }: { path: string }): Promise<TauriFileInfo> {
      return { isDirectory: directories.has(path) };
    },
  };
}

export function createFakeTauriDialogApi(_requiredArgs: Record<string, never>, script: { openResult?: string | string[] | null } = {}): TauriDialogApi & {
  lastOpenOptions: unknown;
} {
  const fake = {
    lastOpenOptions: undefined as unknown,
    async open(_requiredArgs: Record<string, never>, options: import('./tauri-surfaces.js').TauriOpenDialogOptions = {}) {
      fake.lastOpenOptions = options;
      return script.openResult ?? null;
    },
  };
  return fake;
}

export interface FakeTauriSidecarScript {
  exitImmediatelyWithCode?: number;
  readyAfterProbes?: number;
  ignoresGracefulShutdown?: boolean;
}

export function createFakeTauriSidecarCommandApi(_requiredArgs: Record<string, never>, script: FakeTauriSidecarScript = {}): TauriSidecarCommandApi & {
  spawned: Array<{ binaryName: string; args: string[] }>;
} {
  const spawned: Array<{ binaryName: string; args: string[] }> = [];
  return {
    spawned,
    async spawnSidecar({ binaryName, args }) {
      spawned.push({ binaryName, args });
      const exitListeners: Array<(args: { code: number | null; signal: NodeJS.Signals | null }) => void> = [];
      let killed = false;
      const child: TauriChildProcessLike = {
        pid: 4242,
        onExit({ listener }) {
          exitListeners.push(listener);
        },
        kill(_requiredArgs, { signal } = {}) {
          if (script.ignoresGracefulShutdown === true && signal !== 'SIGKILL') return true;
          killed = true;
          // A macrotask, not queueMicrotask: real process exit delivery
          // happens after the event loop's current microtask work drains
          // (the caller's own await chains included). queueMicrotask here
          // would race ahead of a listener a caller registers after one
          // more `await`, silently dropping the event — exactly the kind
          // of flake this fake exists to not have.
          setTimeout(() => {
            for (const listener of exitListeners) listener({ code: null, signal: signal ?? 'SIGTERM' });
          }, 0);
          return true;
        },
      };
      const exitImmediatelyWithCode = script.exitImmediatelyWithCode;
      if (exitImmediatelyWithCode != null) {
        // `exitImmediatelyWithCode` (a local, narrowed here) rather than
        // `script.exitImmediatelyWithCode` again inside the closure: TS
        // narrowing doesn't persist across a property access re-read in a
        // later closure, but re-reading the property here is genuinely
        // always defined given the guard above — a local avoids needing an
        // otherwise-dead `?? 0` fallback to satisfy the type checker.
        setTimeout(() => {
          for (const listener of exitListeners) listener({ code: exitImmediatelyWithCode, signal: null });
        }, 0);
      }
      void killed;
      return child;
    },
  };
}
