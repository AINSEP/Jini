/**
 * Structural (duck-typed) surfaces for exactly the `@tauri-apps/api`/
 * `@tauri-apps/plugin-*` shapes this package's Tauri adapter uses. Like
 * `../electron/electron-surfaces.ts`, no real `@tauri-apps/*` package is a
 * dependency here — a consumer running inside a real Tauri webview passes
 * object-argument bindings around the real plugin functions. Native plugin
 * functions no longer structurally satisfy these interfaces.
 *
 * Tauri's single-instance model is fundamentally different from
 * Electron's: the `tauri-plugin-single-instance` Rust plugin enforces the
 * lock BEFORE the JS runtime even starts, and notifies the *already
 * running* instance's JS side of a second launch attempt via an emitted
 * event — there is no JS-callable "try to acquire the lock" call the way
 * Electron's `app.requestSingleInstanceLock()` works. `TauriSingleInstanceApi`
 * reflects that: it only exposes a listener registration, because by the
 * time JS code in this instance runs, the lock question is already
 * settled.
 */

export interface TauriSingleInstanceApi {
  onSecondInstance({ listener }: { listener: (args: { args: string[]; cwd: string }) => void }): () => void;
}

export interface TauriWindowLike {
  show(): Promise<void>;
  hide(): Promise<void>;
  setFocus(): Promise<void>;
  close(): Promise<void>;
  navigate({ url }: { url: string }): Promise<void>;
  isClosed(): boolean;
  onCloseRequested({ listener }: { listener: () => void }): () => void;
  /** Bind the native destruction event; notify after closure, never for a cancelable request. */
  onClosed?({ listener }: { listener: () => void }): () => void;
}

export interface TauriWindowCreateOptions {
  label: string;
  url: string;
  width?: number;
  height?: number;
  visible?: boolean;
}

export type TauriWindowFactory = (requiredArgs: Pick<TauriWindowCreateOptions, 'label' | 'url'>, optionalArgs?: Omit<TauriWindowCreateOptions, 'label' | 'url'>) => Promise<TauriWindowLike>;

export interface TauriShellApi {
  openUrl({ url }: { url: string }): Promise<void>;
  openPath({ path }: { path: string }): Promise<void>;
}

/** A `@tauri-apps/plugin-fs` `FileInfo`'s relevant subset — `isDirectory` is a plain boolean property on the real plugin's returned struct (a JSON-esque value crossing the Rust/JS boundary), not a method the way Node's `fs.Stats.isDirectory()` is. */
export interface TauriFileInfo {
  readonly isDirectory: boolean;
}

/** Structural subset of `@tauri-apps/plugin-fs` this package's `ShellPort.dirExists` backs. No real `@tauri-apps/plugin-fs` import — see module doc. */
export interface TauriFsApi {
  /** Real plugin: `exists(path)`. */
  exists({ path }: { path: string }): Promise<boolean>;
  /** Real plugin: `stat(path)`. */
  stat({ path }: { path: string }): Promise<TauriFileInfo>;
}

export interface TauriOpenDialogOptions {
  readonly directory?: boolean;
  readonly defaultPath?: string;
}

/** Structural subset of `@tauri-apps/plugin-dialog` this package's `ShellPort.openFolderDialog` backs. Real plugin: `open(options)` resolves `null` on cancel, a single `string` for a single selection, or `string[]` when `multiple: true` is requested (this port never sets `multiple`, but the return type still reflects the plugin's real signature). */
export interface TauriDialogApi {
  open(requiredArgs: Record<string, never>, optionalArgs?: TauriOpenDialogOptions): Promise<string | string[] | null>;
}

export interface TauriChildProcessLike {
  pid: number | undefined;
  onExit({ listener }: { listener: (args: { code: number | null; signal: NodeJS.Signals | null }) => void }): void;
  kill(requiredArgs: Record<string, never>, optionalArgs?: { signal?: NodeJS.Signals | undefined }): boolean;
  write?({ data }: { data: string }): Promise<void>;
}

export interface TauriSidecarCommandApi {
  spawnSidecar({ binaryName, args }: { binaryName: string; args: string[] }, optionalArgs?: { env?: Record<string, string> | undefined }): Promise<TauriChildProcessLike>;
}
