import type { OpenFolderDialogOptions, ShellPort } from '../shell.js';
import { NotImplementedError } from './not-implemented.js';
import type { TauriDialogApi, TauriFsApi, TauriShellApi } from './tauri-surfaces.js';

export interface TauriShellSurfaces {
  shell: TauriShellApi;
  fs: TauriFsApi;
  dialog: TauriDialogApi;
}

function notImplemented(method: string): never {
  throw new NotImplementedError({ message: `ShellPort.${method} is not implemented by the Tauri adapter — Tauri has no recent-documents API equivalent to Electron's app.getRecentDocuments() (see shell.ts's module doc)` });
}

export function createTauriShellPort(surfaces: TauriShellSurfaces): ShellPort {
  return {
    openExternal: ({ url }) => surfaces.shell.openUrl({ url }),
    openPath: ({ path }) => surfaces.shell.openPath({ path }),
    async dirExists({ path }: { path: string }): Promise<boolean> {
      // ShellPort.dirExists documents "never throws" — a permission error, or the path vanishing
      // between exists() and stat(), must resolve false, matching the Electron adapter.
      try {
        const exists = await surfaces.fs.exists({ path });
        if (!exists) return false;
        const info = await surfaces.fs.stat({ path });
        return info.isDirectory;
      } catch {
        return false;
      }
    },
    // Tauri's single-instance-style "there is no JS-callable equivalent" pattern already
    // documented in `tauri-surfaces.ts` applies here too, for a different reason: the
    // `tauri-plugin-fs`/`tauri-plugin-dialog` surfaces this adapter is built against have no
    // recent-documents concept at all (unlike Electron's `app.getRecentDocuments()`) — this is a
    // genuine platform gap, not a missing wiring. Explicit `NotImplementedError`, matching
    // `tauri-render-service.ts`/`tauri-protocol.ts`'s established precedent for exactly this
    // shape (a real port method the Tauri adapter cannot honestly satisfy).
    async recentDirs(): Promise<string[]> {
      return notImplemented('recentDirs');
    },
    async openFolderDialog(_requiredArgs: Record<string, never>, options?: OpenFolderDialogOptions): Promise<string | null> {
      const result = await surfaces.dialog.open({}, {
        directory: true,
        ...(options?.defaultPath !== undefined ? { defaultPath: options.defaultPath } : {}),
      });
      if (result === null) return null;
      return Array.isArray(result) ? (result[0] ?? null) : result;
    },
  };
}
