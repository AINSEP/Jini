import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/desktop-host/tauri barrel', () => {
  it('re-exports the public surface from every tauri module', () => {
    const expectedNames = [
      'createTauriSingleInstanceLockPort', // tauri-single-instance.ts
      'createTauriWindowLifecyclePort', // tauri-window-lifecycle.ts
      'createTauriProtocolHandlerPort', // tauri-protocol.ts
      'createTauriRenderService', // tauri-render-service.ts
      'createTauriShellPort', // tauri-shell.ts
      'createTauriSidecarLauncher', // tauri-sidecar.ts
      'createTauriDesktopHost', // create-tauri-desktop-host.ts
      'NotImplementedError', // not-implemented.ts
      'createFakeTauriSingleInstanceApi', // testing.ts
      'createFakeTauriWindowFactory', // testing.ts
      'createFakeTauriShellApi', // testing.ts
      'createFakeTauriFsApi', // testing.ts
      'createFakeTauriDialogApi', // testing.ts
      'createFakeTauriSidecarCommandApi', // testing.ts
    ] as const;

    for (const name of expectedNames) {
      expect(barrel, `expected the tauri barrel to export "${name}"`).toHaveProperty(name);
      expect((barrel as Record<string, unknown>)[name], `"${name}" should not be undefined`).toBeDefined();
    }
  });

  it('does NOT export any Electron name — those live at ./electron', () => {
    const electronOnlyNames = [
      'createElectronSingleInstanceLockPort',
      'createElectronWindowLifecyclePort',
      'createElectronProtocolHandlerPort',
      'createElectronRenderService',
      'createElectronShellPort',
      'createElectronDesktopHost',
    ] as const;
    for (const name of electronOnlyNames) {
      expect((barrel as Record<string, unknown>)[name], `"${name}" should not be on the tauri barrel`).toBeUndefined();
    }
  });
});
