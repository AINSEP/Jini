import { describe, expect, it, vi } from 'vitest';
import { createElectronDesktopHost } from '../create-electron-desktop-host.js';
import { createElectronUrlCapturePool } from '../electron-url-capture.js';
import type { createElectronRenderService } from '../electron-render-service.js';
import {
  createFakeBrowserWindowFactory,
  createFakeElectronApp,
  createFakeElectronDialog,
  createFakeElectronProtocol,
  createFakeElectronShell,
} from '../testing.js';

function fakeSurfaces() {
  const { factory } = createFakeBrowserWindowFactory({});
  return {
    capturePool: createElectronUrlCapturePool({}),
    app: createFakeElectronApp({}),
    createBrowserWindow: factory,
    protocol: createFakeElectronProtocol({}),
    shell: createFakeElectronShell({}),
    dialog: createFakeElectronDialog({}),
  };
}

describe('createElectronDesktopHost', () => {
  it('composes all DesktopHostPorts from fake Electron surfaces', () => {
    const host = createElectronDesktopHost(fakeSurfaces());

    expect(host.backend).toBe('electron');
    expect(host.ports.singleInstance.claim).toBeTypeOf('function');
    expect(host.ports.windowLifecycle.createWindow).toBeTypeOf('function');
    expect(host.ports.protocolHandler.registerSchemeProxy).toBeTypeOf('function');
    expect(host.ports.sidecarLauncher.launch).toBeTypeOf('function');
    expect(host.ports.renderService.renderToPdf).toBeTypeOf('function');
    expect(host.ports.renderService.capture).toBeTypeOf('function');
    expect(host.ports.renderService.exportArtifact).toBeTypeOf('function');
    expect(host.ports.shell.openExternal).toBeTypeOf('function');
    expect(host.ports.shell.openPath).toBeTypeOf('function');
    expect(host.ports.shell.dirExists).toBeTypeOf('function');
    expect(host.ports.shell.recentDirs).toBeTypeOf('function');
    expect(host.ports.shell.openFolderDialog).toBeTypeOf('function');
  });

  it('accepts port overrides', () => {
    const customSidecarLauncher = {
      launch: async () => {
        throw new Error('unused');
      },
    };
    const host = createElectronDesktopHost(fakeSurfaces(), { sidecarLauncher: customSidecarLauncher });
    expect(host.ports.sidecarLauncher).toBe(customSidecarLauncher);
  });

  it('shares the supplied FIFO across hosts before creating a capture window', async () => {
    const capturePool = createElectronUrlCapturePool({});
    const deadline = Date.now() + 60_000;
    const slots = [await capturePool.acquire({ deadline }), await capturePool.acquire({ deadline })];
    const createBrowserWindow = vi.fn(() => { throw new Error('native window unavailable'); });
    const createService = () => createElectronDesktopHost({ ...fakeSurfaces(), createBrowserWindow, capturePool })
      .ports.renderService as ReturnType<typeof createElectronRenderService>;
    const request = { url: 'https://site.example/', viewport: { width: 800, height: 600 }, fullPage: false, maxPageHeightPx: 2000, settleMs: 0 };
    const options = { allowedOrigins: ['https://site.example'] };
    const first = expect(createService().captureUrl(request, options)).rejects.toMatchObject({ code: 'load-failed' });
    const second = expect(createService().captureUrl(request, options)).rejects.toMatchObject({ code: 'load-failed' });
    try {
      // Both service calls have reached the pool, but both host leases are still held.
      await Promise.resolve();
      expect(createBrowserWindow).not.toHaveBeenCalled();
    } finally {
      for (const slot of slots) capturePool.release({ slot });
      await Promise.all([first, second]);
    }
    expect(createBrowserWindow).toHaveBeenCalledTimes(2);
  });
});
