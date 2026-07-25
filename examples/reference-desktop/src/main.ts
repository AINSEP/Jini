import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createElectronDesktopHost,
  type ElectronDesktopHostSurfaces,
} from '@jini/desktop-host';
import {
  grantNativeWorkingDirectory,
  isTrustedRendererFrame,
  normalizeSampleWorkingDirectory,
  resolveDesktopWorkingDirectory,
  resolveTrustedRendererUrl,
} from './security.js';

const rendererUrl = resolveTrustedRendererUrl(
  process.env.JINI_PLAYGROUND_URL ?? 'http://127.0.0.1:4173/?shell=desktop',
).toString();
const rendererOrigin = new URL(rendererUrl).origin;
const daemonUrl = process.env.JINI_PLAYGROUND_DAEMON_URL ?? 'http://127.0.0.1:4317';
const grantSecret = process.env.JINI_PLAYGROUND_GRANT_SECRET;
const preloadPath = resolve(dirname(fileURLToPath(import.meta.url)), 'preload.cjs');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const approvedDirectories = new Set<string>();
const sampleDirectories = new Set([
  resolve(repoRoot, 'examples/sample-projects/starter-site'),
  resolve(repoRoot, 'examples/sample-projects/bug-hunt'),
]);

const surfaces = {
  app,
  protocol,
  shell,
  dialog,
  createBrowserWindow: (options: ElectronDesktopHostSurfaces['createBrowserWindow'] extends (
    value: infer Options,
  ) => unknown
    ? Options
    : never) =>
    (() => {
      const window = new BrowserWindow({
      ...options,
      title: 'Jini Playground',
      minWidth: 840,
      minHeight: 620,
      backgroundColor: '#f4f2ed',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        ...options.webPreferences,
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        try {
          if (new URL(url).origin === rendererOrigin) return;
        } catch {
          // Invalid navigation URLs are denied.
        }
        event.preventDefault();
      });
      return window;
    })(),
} as unknown as ElectronDesktopHostSurfaces;

const host = createElectronDesktopHost(surfaces);
const ownsLock = host.ports.singleInstance.claim(() => host.ports.windowLifecycle.showMainWindow());

function registerRendererBridge(): void {
  const requireTrustedRenderer = (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedRendererFrame(event.senderFrame, rendererOrigin)) {
      throw new Error('Untrusted renderer IPC request');
    }
  };
  ipcMain.handle('jini:pick-working-directory', async (event, defaultPath?: unknown) => {
    requireTrustedRenderer(event);
    const selected = await host.ports.shell.openFolderDialog(
      typeof defaultPath === 'string' && defaultPath.length > 0
        ? { defaultPath: resolveDesktopWorkingDirectory(repoRoot, defaultPath) }
        : undefined,
    );
    if (!selected) return null;
    const granted = await grantNativeWorkingDirectory({
      daemonUrl,
      secret: grantSecret,
      directory: selected,
    });
    approvedDirectories.add(granted);
    app.addRecentDocument(granted);
    return granted;
  });
  ipcMain.handle('jini:normalize-working-directory', (event, path: unknown) => {
    requireTrustedRenderer(event);
    return normalizeSampleWorkingDirectory(repoRoot, path);
  });
  ipcMain.handle('jini:recent-directories', async (event) => {
    requireTrustedRenderer(event);
    return (await host.ports.shell.recentDirs())
      .filter((directory) => approvedDirectories.has(resolve(directory)));
  });
  ipcMain.handle('jini:directory-exists', (event, path: unknown) => {
    requireTrustedRenderer(event);
    if (typeof path !== 'string') return Promise.resolve(false);
    const normalizedSample = normalizeSampleWorkingDirectory(repoRoot, path);
    const candidate = normalizedSample ?? resolveDesktopWorkingDirectory(repoRoot, path);
    if (!sampleDirectories.has(candidate) && !approvedDirectories.has(candidate)) {
      return Promise.resolve(false);
    }
    return host.ports.shell.dirExists(candidate);
  });
}

async function openMainWindow(): Promise<void> {
  if (host.ports.windowLifecycle.getMainWindow()) {
    host.ports.windowLifecycle.showMainWindow();
    return;
  }
  await host.ports.windowLifecycle.createWindow({
    url: rendererUrl,
    width: 1320,
    height: 820,
    show: true,
  });
}

if (ownsLock) {
  app.whenReady().then(() => {
    registerRendererBridge();
    return openMainWindow();
  });

  app.on('activate', () => {
    void openMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
