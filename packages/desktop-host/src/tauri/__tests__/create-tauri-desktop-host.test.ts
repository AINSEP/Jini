import { describe, expect, it } from 'vitest';
import { createTauriDesktopHost } from '../create-tauri-desktop-host.js';
import { NotImplementedError } from '../not-implemented.js';
import {
  createFakeTauriDialogApi,
  createFakeTauriFsApi,
  createFakeTauriShellApi,
  createFakeTauriSidecarCommandApi,
  createFakeTauriSingleInstanceApi,
  createFakeTauriWindowFactory,
} from '../testing.js';

function fakeSurfaces() {
  const { factory } = createFakeTauriWindowFactory({});
  return {
    singleInstance: createFakeTauriSingleInstanceApi({}),
    createWindow: factory,
    shell: createFakeTauriShellApi({}),
    sidecarCommands: createFakeTauriSidecarCommandApi({}),
    fs: createFakeTauriFsApi({}),
    dialog: createFakeTauriDialogApi({}),
  };
}

describe('createTauriDesktopHost', () => {
  it('composes the same DesktopHostPorts shape the Electron host does, from fake Tauri surfaces', () => {
    const host = createTauriDesktopHost(fakeSurfaces());

    expect(host.backend).toBe('tauri');
    expect(host.ports.singleInstance.claim).toBeTypeOf('function');
    expect(host.ports.windowLifecycle.createWindow).toBeTypeOf('function');
    expect(host.ports.protocolHandler.registerSchemeProxy).toBeTypeOf('function');
    expect(host.ports.sidecarLauncher.launch).toBeTypeOf('function');
    expect(host.ports.renderService.renderToPdf).toBeTypeOf('function');
    expect(host.ports.shell.openExternal).toBeTypeOf('function');
    expect(host.ports.shell.dirExists).toBeTypeOf('function');
    expect(host.ports.shell.recentDirs).toBeTypeOf('function');
    expect(host.ports.shell.openFolderDialog).toBeTypeOf('function');
  });

  it('the narrow-slice ports actually work end to end', async () => {
    const host = createTauriDesktopHost(fakeSurfaces());
    expect(host.ports.singleInstance.claim({ onSecondInstance: () => {} })).toBe(true);
    const window = await host.ports.windowLifecycle.createWindow({ url: 'https://example.test/' });
    expect(window.isDestroyed()).toBe(false);
    await host.ports.shell.openExternal({ url: 'https://example.test' });
  });

  it('renderService, protocolHandler, and shell.recentDirs are honest NotImplementedError stubs, not fakes', async () => {
    const host = createTauriDesktopHost(fakeSurfaces());
    await expect(host.ports.renderService.renderToPdf({ html: '<html></html>' })).rejects.toBeInstanceOf(NotImplementedError);
    expect(() => host.ports.protocolHandler.registerSchemeProxy({ scheme: 'jini', targetBaseUrl: 'http://127.0.0.1:0' })).toThrow(NotImplementedError);
    await expect(host.ports.shell.recentDirs()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
