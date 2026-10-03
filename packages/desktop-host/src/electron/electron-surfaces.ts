/** Host-supplied Electron ports. Bind native SDK operations to the object-argument
 * contracts below; native modules no longer structurally satisfy these interfaces.
 * This package imports no Electron runtime and tests the bindings using its fakes.
 */

export interface ElectronAppLike {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on({ event, listener }: { event: 'second-instance'; listener: () => void }): void;
  /** Real Electron: `app.getRecentDocuments()` — the OS-tracked recently-opened list (macOS Dock menu / Windows Jump List). Backs `ShellPort.recentDirs`. */
  getRecentDocuments(): string[];
  /** Real Electron: `app.addRecentDocument(path)`. Not called by anything in this package yet — declared alongside `getRecentDocuments` for interface symmetry with Electron's real API (a host wiring its own "open recent" UI can call it directly against the real `app` module without needing a port method here). */
  addRecentDocument({ path }: { path: string }): void;
}

export interface ElectronNavigationEvent {
  preventDefault(): void;
}

export interface ElectronBeforeRequestDetails {
  url: string;
}

export type ElectronBeforeRequestCallback = (response: { cancel: boolean }) => void;

export interface ElectronWebRequestLike {
  onBeforeRequest({ listener }: { listener: ((args: { details: ElectronBeforeRequestDetails; callback: ElectronBeforeRequestCallback }) => void) | null }): void;
}

export interface ElectronSessionLike {
  webRequest: ElectronWebRequestLike;
}

export interface ElectronWebContentsLike {
  session: ElectronSessionLike;
  loadURL({ url }: { url: string }): Promise<void>;
  once({ event, listener }: { event: 'did-finish-load'; listener: () => void }): void;
  once({ event, listener }: { event: 'did-fail-load'; listener: (args: { event: unknown; errorCode: number; errorDescription: string }) => void }): void;
  on({ event, listener }: { event: 'will-navigate'; listener: (args: { event: ElectronNavigationEvent; url: string }) => void }): void;
  printToPDF(options: Record<string, unknown>): Promise<Buffer>;
  capturePage(requiredArgs: Record<string, never>, optionalArgs?: { rect?: { x: number; y: number; width: number; height: number } | undefined }): Promise<{ toPNG(): Buffer }>;
}

export interface ElectronBrowserWindowLike {
  readonly webContents: ElectronWebContentsLike;
  loadURL({ url }: { url: string }): Promise<void>;
  show(): void;
  hide(): void;
  focus(): void;
  close(): void;
  destroy(): void;
  isDestroyed(): boolean;
  on({ event, listener }: { event: 'closed'; listener: () => void }): void;
}

export interface ElectronBrowserWindowOptions {
  show?: boolean;
  width?: number;
  height?: number;
  webPreferences?: { javascript?: boolean; offscreen?: boolean; [key: string]: unknown };
}

export type ElectronBrowserWindowFactory = (requiredArgs: Record<string, never>, optionalArgs?: ElectronBrowserWindowOptions) => ElectronBrowserWindowLike;

export interface ElectronProtocolPrivileges {
  standard?: boolean;
  secure?: boolean;
  corsEnabled?: boolean;
  supportFetchAPI?: boolean;
  stream?: boolean;
}

export interface ElectronProtocolLike {
  registerSchemesAsPrivileged({ schemes }: { schemes: Array<{ scheme: string; privileges: ElectronProtocolPrivileges }> }): void;
  handle({ scheme, handler }: { scheme: string; handler: (args: { request: Request }) => Promise<Response> }): void;
}

export interface ElectronShellLike {
  /** Resolves to the empty string on success, an error message otherwise — matches Electron's real `shell.openPath` contract. */
  openPath({ path }: { path: string }): Promise<string>;
  openExternal({ url }: { url: string }): Promise<void>;
}

export interface ElectronOpenDialogOptions {
  readonly properties?: readonly string[];
  readonly defaultPath?: string;
}

export interface ElectronOpenDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

/** Structural subset of Electron's real `dialog` module this package's Tauri-sibling `ShellPort.openFolderDialog` backs. Matches `dialog.showOpenDialog`'s real documented contract (`canceled`/`filePaths`). */
export interface ElectronDialogLike {
  showOpenDialog(requiredArgs: Record<string, never>, optionalArgs?: ElectronOpenDialogOptions): Promise<ElectronOpenDialogResult>;
}
