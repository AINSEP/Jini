/**
 * @file React bindings for a desktop app's version label and its "Check for updates…" row. The
 * framework-free loader and update-check controller live in the host's desktop toolkit; the host
 * injects their factories, so this browser package never depends on the desktop host package and
 * no package metadata enters the renderer bundle.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/** The framework-free version loader this hook drives (one IPC read per bridge). */
export interface AppVersionLoaderPort<S> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): S;
  /** Starts the one read; the returned cleanup makes later responses inert. */
  start(): () => void;
}

/** The framework-free update-check controller this hook drives (one check at a time). */
export interface UpdateCheckPort<S> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): S;
  checkForUpdates(): Promise<void>;
}

/**
 * No guessed version while pending/unavailable; IPC failures retain their actual message.
 * Reads the version once per bridge, ignoring responses after cleanup. An older preload without
 * the method keeps the label usable until the preload is rebuilt (the loader's own contract).
 * @param required.bridge the preload bridge port, or `undefined`; main is the source of truth.
 * @param required.createLoader the host's loader factory, called once per bridge.
 * @returns the loader's snapshot; failures are contained rather than thrown from React.
 * @complexity O(1) time and space, with one IPC request per bridge.
 */
export function useAppVersion<B, S>(
  { bridge, createLoader }: { bridge: B; createLoader: (required: { bridge: B }) => AppVersionLoaderPort<S> },
  _optional = {},
): S {
  const loader = useMemo(() => createLoader({ bridge }), [bridge, createLoader]);
  useEffect(() => loader.start(), [loader]);
  return useSyncExternalStore(loader.subscribe, loader.getSnapshot);
}

/**
 * Settings › Check for updates…: main runs the check and shows every notice; this only waits.
 * One check at a time from this window; `onDone` closes the menu once main has answered.
 * @param required.onDone called once main has answered; an inline function is fine.
 * @param required.report receives a broken-channel message (main reports check failures itself).
 * @param required.createCheck the host's update-check factory, called once per bridge.
 * @complexity O(1), with one IPC request per click.
 */
export function useUpdateCheck<B, S extends object>(
  { bridge, onDone, report, createCheck }: {
    bridge: B;
    onDone: () => void;
    report: (required: { readonly message: string }) => void;
    createCheck: (required: { bridge: B; onDone: () => void; report: (required: { readonly message: string }) => void }) => UpdateCheckPort<S>;
  },
  _optional = {},
): S & { checkForUpdates: () => Promise<void> } {
  // An inline `onDone` is a new function every render; the controller keeps calling the latest one.
  const latest = useRef({ onDone, report });
  latest.current = { onDone, report };
  const check = useMemo(() => createCheck({
    bridge,
    onDone: () => latest.current.onDone(),
    report: (failure) => latest.current.report(failure),
  }), [bridge, createCheck]);
  const state = useSyncExternalStore(check.subscribe, check.getSnapshot);
  return { ...state, checkForUpdates: check.checkForUpdates };
}
