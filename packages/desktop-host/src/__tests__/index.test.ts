import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@injini/desktop-host root barrel', () => {
  it('re-exports the public surface from every scope-1/2/3/4 module', () => {
    // One representative named export per source module in the barrel
    // (src/index.ts), proving every `export *` line actually resolves and
    // is reachable through the package root rather than only through a
    // deep import path.
    const expectedNames = [
      'claimSingleInstanceLock', // single-instance.ts
      'withMainWindowTracking', // window-lifecycle.ts
      'handleProtocolProxyRequest', // protocol.ts
      'schemeEntryUrl', // protocol.ts
      'resolveDesktopHostPathRoots', // paths.ts
      'DesktopHostPathError', // paths.ts
      'loadHostConfigFile', // config.ts
      'syncWindowsUninstallDisplayVersion', // windows-registry.ts
      'RenderServiceError', // render-service.ts
      'htmlToDataUrl', // render-service.ts
      'isOriginAllowed', // render-service.ts
      'withRenderTimeout', // render-service.ts
      'ShellError', // shell.ts
      'SingleInstanceLockToken', // tokens.ts
      'WindowLifecycleToken', // tokens.ts
      'ProtocolHandlerToken', // tokens.ts
      'SidecarLauncherToken', // tokens.ts
      'RenderServiceToken', // tokens.ts
      'ShellToken', // tokens.ts
      'createElectronSingleInstanceLockPort', // electron/electron-single-instance.ts
      'createElectronWindowLifecyclePort', // electron/electron-window-lifecycle.ts
      'createElectronRenderService', // electron/electron-render-service.ts
      'createElectronShellPort', // electron/electron-shell.ts
      'createElectronDesktopHost', // electron/create-electron-desktop-host.ts
      'createTauriSingleInstanceLockPort', // tauri/tauri-single-instance.ts
      'createTauriWindowLifecyclePort', // tauri/tauri-window-lifecycle.ts
      'createTauriShellPort', // tauri/tauri-shell.ts
      'createTauriSidecarLauncher', // tauri/tauri-sidecar.ts
      'createTauriDesktopHost', // tauri/create-tauri-desktop-host.ts
      'NotImplementedError', // tauri/not-implemented.ts
    ] as const;

    for (const name of expectedNames) {
      expect(barrel, `expected the root barrel to export "${name}"`).toHaveProperty(name);
      expect((barrel as Record<string, unknown>)[name], `"${name}" should not be undefined`).toBeDefined();
    }
  });

  it('does not export anything unexpectedly named "default" (this package has no default export)', () => {
    expect((barrel as Record<string, unknown>).default).toBeUndefined();
  });
});
