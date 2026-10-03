import { stat } from 'node:fs/promises';
import { ShellError, type OpenFolderDialogOptions, type ShellPort } from '../shell.js';
import type { ElectronAppLike, ElectronDialogLike, ElectronShellLike } from './electron-surfaces.js';

export interface ElectronShellSurfaces {
  shell: ElectronShellLike;
  app: ElectronAppLike;
  dialog: ElectronDialogLike;
}

export function createElectronShellPort(surfaces: ElectronShellSurfaces): ShellPort {
  return {
    async openExternal({ url }: { url: string }): Promise<void> {
      await surfaces.shell.openExternal({ url });
    },
    async openPath({ path }: { path: string }): Promise<void> {
      const errorMessage = await surfaces.shell.openPath({ path });
      if (errorMessage.length > 0) throw new ShellError({ message: errorMessage });
    },
    // Electron main has full `node:fs` access — this matches `sidecar.ts`'s own precedent of
    // calling `node:fs/promises` directly rather than adding a new structural Electron surface
    // for a capability Electron's own main process didn't need mediating in the first place.
    async dirExists({ path }: { path: string }): Promise<boolean> {
      try {
        const info = await stat(path);
        return info.isDirectory();
      } catch {
        return false;
      }
    },
    async recentDirs(): Promise<string[]> {
      return surfaces.app.getRecentDocuments();
    },
    async openFolderDialog(_requiredArgs: Record<string, never>, options?: OpenFolderDialogOptions): Promise<string | null> {
      const result = await surfaces.dialog.showOpenDialog({}, {
        properties: ['openDirectory'],
        ...(options?.defaultPath !== undefined ? { defaultPath: options.defaultPath } : {}),
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    },
  };
}
