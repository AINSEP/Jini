/**
 * Backs the bridge's `shell.openExternal`/`shell.openPath` (`bridge.ts`)
 * from the host side — this was missing from scope 1's file list even
 * though C7's narrow slice explicitly names "open-path/open-external" as
 * something both the Electron and Tauri adapters must provide. Filed here
 * rather than retroactively editing scope 1, since it only became
 * apparent as a gap while wiring the Tauri adapter (scope 4) against the
 * same `DesktopHostPorts` shape scope 3 established.
 *
 * **2026-07-22 addition — `dirExists`/`recentDirs`/`openFolderDialog`.**
 * OD route-parity gap-fill: OD's daemon exposes `/api/dir-exists`,
 * `/api/recent-dirs`, and `/api/dialog/open-folder` as HTTP routes, but
 * those are host-process bridge capabilities (a directory picker, a
 * recent-locations list, a filesystem existence check against the local
 * machine the desktop shell is running on) — `@injini/http` has no
 * desktop/Electron-bridge concept and never will, so this is where the
 * capability actually belongs: the same `ShellPort` a chat UI's
 * `window.__jini__` bridge already reaches for `openExternal`/`openPath`.
 * See `packages/desktop-host/source-map.md`'s dated entry for the full
 * per-adapter provenance, including the one deliberate gap:
 * `recentDirs` has no Tauri equivalent and throws `NotImplementedError`
 * there rather than being silently stubbed to an empty array.
 */

export class ShellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellError';
  }
}

export interface OpenFolderDialogOptions {
  readonly defaultPath?: string;
}

export interface ShellPort {
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  /** True if `path` exists on the local filesystem and is a directory; `false` for a missing path, a non-directory (a file), or any other stat failure. Never throws. */
  dirExists(path: string): Promise<boolean>;
  /** Host-tracked recently-opened locations, most-recent first. Electron backs this with `app.getRecentDocuments()`; Tauri has no equivalent (see module doc) and rejects with `NotImplementedError`. */
  recentDirs(): Promise<string[]>;
  /** Opens a native "choose a folder" dialog. Resolves to the chosen absolute path, or `null` if the user canceled. */
  openFolderDialog(options?: OpenFolderDialogOptions): Promise<string | null>;
}
