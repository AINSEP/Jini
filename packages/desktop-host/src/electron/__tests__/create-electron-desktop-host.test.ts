import { describe, expect, it } from 'vitest';
import { createElectronDesktopHost } from '../create-electron-desktop-host.js';
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
});
