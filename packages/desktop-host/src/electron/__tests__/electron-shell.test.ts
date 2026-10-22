import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ShellError } from '../../shell.js';
import { createElectronShellPort } from '../electron-shell.js';
import { createFakeElectronApp, createFakeElectronDialog, createFakeElectronShell } from '../testing.js';

function fakeSurfaces(overrides: {
  shell?: ReturnType<typeof createFakeElectronShell>;
  app?: ReturnType<typeof createFakeElectronApp>;
  dialog?: ReturnType<typeof createFakeElectronDialog>;
} = {}) {
  return {
    shell: overrides.shell ?? createFakeElectronShell({}),
    app: overrides.app ?? createFakeElectronApp({}),
    dialog: overrides.dialog ?? createFakeElectronDialog({}),
  };
}

describe('createElectronShellPort', () => {
  it('opens external urls and paths through the underlying Electron shell', async () => {
    const surfaces = fakeSurfaces();
    const port = createElectronShellPort(surfaces);
    await port.openExternal({ url: 'https://example.test' });
    await port.openPath({ path: '/tmp/x' });
    expect(surfaces.shell.openedExternalUrls).toEqual(['https://example.test']);
    expect(surfaces.shell.openedPaths).toEqual(['/tmp/x']);
  });

  it('throws a ShellError when Electron reports a non-empty openPath error string', async () => {
    const surfaces = fakeSurfaces({ shell: createFakeElectronShell({}, { openPathError: 'no such file' }) });
    const port = createElectronShellPort(surfaces);
    await expect(port.openPath({ path: '/missing' })).rejects.toThrow(ShellError);
  });

  describe('dirExists', () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    });

    it('resolves true for a real directory', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-'));
      const port = createElectronShellPort(fakeSurfaces());
      await expect(port.dirExists({ path: tempDir })).resolves.toBe(true);
    });

    it('resolves false for a path that does not exist', async () => {
      const port = createElectronShellPort(fakeSurfaces());
      await expect(port.dirExists({ path: '/definitely/does/not/exist/xyz' })).resolves.toBe(false);
    });

    it('resolves false for a path that exists but is a file, not a directory', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-'));
      const filePath = join(tempDir, 'a-file.txt');
      await writeFile(filePath, 'hello');
      const port = createElectronShellPort(fakeSurfaces());
      await expect(port.dirExists({ path: filePath })).resolves.toBe(false);
    });
  });

  describe('recentDirs', () => {
    it('delegates to app.getRecentDocuments()', async () => {
      const surfaces = fakeSurfaces({ app: createFakeElectronApp({}, { recentDocuments: ['/a', '/b'] }) });
      const port = createElectronShellPort(surfaces);
      await expect(port.recentDirs()).resolves.toEqual(['/a', '/b']);
    });

    it('resolves an empty array when nothing has been opened yet', async () => {
      const port = createElectronShellPort(fakeSurfaces());
      await expect(port.recentDirs()).resolves.toEqual([]);
    });
  });

  describe('openFolderDialog', () => {
    it('calls dialog.showOpenDialog with properties: [openDirectory] and returns the first chosen path', async () => {
      const surfaces = fakeSurfaces({
        dialog: createFakeElectronDialog({}, { openDialogResult: { canceled: false, filePaths: ['/chosen/dir'] } }),
      });
      const port = createElectronShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBe('/chosen/dir');
      expect(surfaces.dialog.lastShowOpenDialogOptions).toEqual({ properties: ['openDirectory'] });
    });

    it('forwards a supplied defaultPath', async () => {
      const surfaces = fakeSurfaces({
        dialog: createFakeElectronDialog({}, { openDialogResult: { canceled: false, filePaths: ['/chosen'] } }),
      });
      const port = createElectronShellPort(surfaces);
      await port.openFolderDialog({}, { defaultPath: '/start/here' });
      expect(surfaces.dialog.lastShowOpenDialogOptions).toEqual({ properties: ['openDirectory'], defaultPath: '/start/here' });
    });

    it('resolves null when the user cancels', async () => {
      const surfaces = fakeSurfaces({
        dialog: createFakeElectronDialog({}, { openDialogResult: { canceled: true, filePaths: [] } }),
      });
      const port = createElectronShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBeNull();
    });

    it('resolves null when not canceled but no paths were returned (belt-and-braces)', async () => {
      const surfaces = fakeSurfaces({
        dialog: createFakeElectronDialog({}, { openDialogResult: { canceled: false, filePaths: [] } }),
      });
      const port = createElectronShellPort(surfaces);
      await expect(port.openFolderDialog({})).resolves.toBeNull();
    });
  });
});
