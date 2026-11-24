/**
 * @file The renderer-side half of a desktop folder-drop bridge. The host's Electron preload injects the
 * bridge onto `window` under a host-chosen global name via `contextBridge` — it exists ONLY when the admin
 * app is running inside the host's desktop shell (a standalone window or a `<webview>` guest the assistant
 * dock actually renders in), never in a plain browser tab. Same shape as the host's other preload-port
 * readers: presence of the global IS the capability gate.
 *
 * A `null` port means "recover no folder path" — the host's folder-drop hook then leaves a folder drop
 * alone entirely, so it falls through to `ChatPane`'s own attachment-upload handling, exactly as any
 * other drop already does in a plain browser (this feature does not, and cannot, fix browser-only admin).
 */

/**
 * The bridge the host's preload exposes via `contextBridge.exposeInMainWorld(<bridgeKey>, ...)`:
 * Electron's synchronous `webUtils.getPathForFile`, passed straight through. It returns `''` for a
 * `File` it cannot resolve an OS path for (e.g. one synthesized from a `FileSystemEntry` rather than
 * handed directly off `dataTransfer.files` — see `@jini-ai/ui`'s `features/folder-path-drop/rules.ts`
 * header). Declared structurally here (not imported) because admin may depend only on core and protocol;
 * it is the same shape as that package's `FolderPathDropPort`, so one bridge value satisfies both, and
 * only the global's name (`bridgeKey`) is the host's.
 */
export interface FolderDropPort {
  getPathForFile(file: File): string;
}

/** A window read by bridge name: the global is the host's, so it is not declared on `Window` here. */
type BridgeWindow = Readonly<Record<string, FolderDropPort | undefined>>;

/**
 * Resolves the folder-drop port for the current runtime.
 *
 * @param required.targetWindow - Injected so a test can simulate either runtime without touching the real
 *   `window` global. A real caller passes `undefined` — same convention as the host's other preload-port readers.
 * @param required.bridgeKey - The `window` global name the host's preload exposes the bridge under.
 * @returns The real port when running inside the desktop shell, `null` in a plain browser tab.
 * @complexity Time/space: O(1).
 */
export function getFolderDropPort(
  { targetWindow, bridgeKey }: { targetWindow: Window | undefined; bridgeKey: string },
  _options = {},
): FolderDropPort | null {
  if (targetWindow !== undefined) return (targetWindow as unknown as BridgeWindow)[bridgeKey] ?? null;
  return typeof window === "undefined" ? null : ((window as unknown as BridgeWindow)[bridgeKey] ?? null);
}
