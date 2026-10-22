import { describe, expect, it } from 'vitest';
import { NotImplementedError } from '../not-implemented.js';
import { createTauriShellPort } from '../tauri-shell.js';
import { createFakeTauriDialogApi, createFakeTauriFsApi, createFakeTauriShellApi } from '../testing.js';

function fakeSurfaces(overrides: {
  shell?: ReturnType<typeof createFakeTauriShellApi>;
  fs?: ReturnType<typeof createFakeTauriFsApi>;
  dialog?: ReturnType<typeof createFakeTauriDialogApi>;
} = {}) {
  return {
    shell: overrides.shell ?? createFakeTauriShellApi({}),
    fs: overrides.fs ?? createFakeTauriFsApi({}),
    dialog: overrides.dialog ?? createFakeTauriDialogApi({}),
  };
}

describe('createTauriShellPort', () => {
  it('delegates openExternal/openPath to the Tauri shell plugin', async () => {
    const surfaces = fakeSurfaces();
    const port = createTauriShellPort(surfaces);
    await port.openExternal({ url: 'https://example.test' });
    await port.openPath({ path: '/tmp/x' });
    expect(surfaces.shell.openedUrls).toEqual(['https://example.test']);
    expect(surfaces.shell.openedPaths).toEqual(['/tmp/x']);
  });

  describe('dirExists', () => {
    it('resolves true when fs.exists is true and fs.stat reports a directory', async () => {
      const surfaces = fakeSurfaces({ fs: createFakeTauriFsApi({}, { directories: ['/a/dir'] }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.dirExists({ path: '/a/dir' })).resolves.toBe(true);
    });

    it('resolves false when fs.exists is false (never calls stat)', async () => {
      const fs = createFakeTauriFsApi({});
      const port = createTauriShellPort(fakeSurfaces({ fs }));
      await expect(port.dirExists({ path: '/missing' })).resolves.toBe(false);
    });

    it('resolves false when the path exists but is a file, not a directory', async () => {
      const surfaces = fakeSurfaces({ fs: createFakeTauriFsApi({}, { files: ['/a/file.txt'] }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.dirExists({ path: '/a/file.txt' })).resolves.toBe(false);
    });
  });

  describe('recentDirs', () => {
    it('rejects with NotImplementedError — Tauri has no recent-documents equivalent', async () => {
      const port = createTauriShellPort(fakeSurfaces());
      await expect(port.recentDirs()).rejects.toBeInstanceOf(NotImplementedError);
    });
  });

  describe('openFolderDialog', () => {
    it('calls dialog.open with directory: true and returns the chosen path', async () => {
      const surfaces = fakeSurfaces({ dialog: createFakeTauriDialogApi({}, { openResult: '/chosen/dir' }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBe('/chosen/dir');
      expect(surfaces.dialog.lastOpenOptions).toEqual({ directory: true });
    });

    it('forwards a supplied defaultPath', async () => {
      const surfaces = fakeSurfaces({ dialog: createFakeTauriDialogApi({}, { openResult: '/chosen' }) });
      const port = createTauriShellPort(surfaces);
      await port.openFolderDialog({}, { defaultPath: '/start/here' });
      expect(surfaces.dialog.lastOpenOptions).toEqual({ directory: true, defaultPath: '/start/here' });
    });

    it('resolves null when the user cancels (plugin returns null)', async () => {
      const surfaces = fakeSurfaces({ dialog: createFakeTauriDialogApi({}, { openResult: null }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBeNull();
    });

    it('takes the first entry when the plugin resolves an array (defensive — this port never requests multiple)', async () => {
      const surfaces = fakeSurfaces({ dialog: createFakeTauriDialogApi({}, { openResult: ['/first', '/second'] }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBe('/first');
    });

    it('resolves null for an empty array result (belt-and-braces)', async () => {
      const surfaces = fakeSurfaces({ dialog: createFakeTauriDialogApi({}, { openResult: [] }) });
      const port = createTauriShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBeNull();
    });
  });
});
