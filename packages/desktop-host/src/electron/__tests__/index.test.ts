import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/desktop-host/electron barrel', () => {
  it('re-exports the public surface from every electron module', () => {
    const expectedNames = [
      'createElectronSingleInstanceLockPort', // electron-single-instance.ts
      'createElectronWindowLifecyclePort', // electron-window-lifecycle.ts
      'createElectronProtocolHandlerPort', // electron-protocol.ts
      'createElectronRenderService', // electron-render-service.ts
      'createElectronShellPort', // electron-shell.ts
      'createElectronDesktopHost', // create-electron-desktop-host.ts
      'createFakeElectronApp', // testing.ts
      'createFakeBrowserWindowFactory', // testing.ts
      'createFakeElectronDialog', // testing.ts
      'createFakeElectronProtocol', // testing.ts
      'createFakeElectronShell', // testing.ts
    ] as const;

    for (const name of expectedNames) {
      expect(barrel, `expected the electron barrel to export "${name}"`).toHaveProperty(name);
      expect((barrel as Record<string, unknown>)[name], `"${name}" should not be undefined`).toBeDefined();
    }
  });

  it('does NOT export any Tauri name — those live at ./tauri', () => {
    const tauriOnlyNames = [
      'createTauriSingleInstanceLockPort',
      'createTauriWindowLifecyclePort',
      'createTauriShellPort',
      'createTauriSidecarLauncher',
      'createTauriDesktopHost',
      'NotImplementedError',
    ] as const;
    for (const name of tauriOnlyNames) {
      expect((barrel as Record<string, unknown>)[name], `"${name}" should not be on the electron barrel`).toBeUndefined();
    }
  });
});
