import type { DesktopHost, DesktopHostPorts } from '../ports.js';
import { createTauriSingleInstanceLockPort } from './tauri-single-instance.js';
import { createTauriWindowLifecyclePort } from './tauri-window-lifecycle.js';
import { createTauriProtocolHandlerPort } from './tauri-protocol.js';
import { createTauriSidecarLauncher } from './tauri-sidecar.js';
import { createTauriRenderService } from './tauri-render-service.js';
import { createTauriShellPort } from './tauri-shell.js';
import type { TauriDialogApi, TauriFsApi, TauriShellApi, TauriSidecarCommandApi, TauriSingleInstanceApi, TauriWindowFactory } from './tauri-surfaces.js';

export interface TauriDesktopHostSurfaces {
  singleInstance: TauriSingleInstanceApi;
  createWindow: TauriWindowFactory;
  shell: TauriShellApi;
  sidecarCommands: TauriSidecarCommandApi;
  /** Backs `ShellPort.dirExists` (2026-07-22 addition — see `shell.ts`'s module doc). */
  fs: TauriFsApi;
  /** Backs `ShellPort.openFolderDialog` (2026-07-22 addition — see `shell.ts`'s module doc). */
  dialog: TauriDialogApi;
}

/**
 * Narrow C7 spike: sidecar launch/discovery, URL load, shutdown, crash
 * recovery, single-instance, open-path/open-external. `protocolHandler`
 * and `renderService` are NotImplementedError-throwing stubs — see
 * `tauri-protocol.ts`/`tauri-render-service.ts` for why each is out of
 * scope for this pass.
 */
export function createTauriDesktopHost(
  surfaces: TauriDesktopHostSurfaces,
  overrides: Partial<DesktopHostPorts> = {},
): DesktopHost {
  const ports: DesktopHostPorts = {
    singleInstance: overrides.singleInstance ?? createTauriSingleInstanceLockPort({ api: surfaces.singleInstance }),
    windowLifecycle: overrides.windowLifecycle ?? createTauriWindowLifecyclePort({ createTauriWindow: surfaces.createWindow }),
    protocolHandler: overrides.protocolHandler ?? createTauriProtocolHandlerPort({}),
    sidecarLauncher: overrides.sidecarLauncher ?? createTauriSidecarLauncher({ api: surfaces.sidecarCommands }),
    renderService: overrides.renderService ?? createTauriRenderService({}),
    shell: overrides.shell ?? createTauriShellPort({ shell: surfaces.shell, fs: surfaces.fs, dialog: surfaces.dialog }),
  };
  return { backend: 'tauri', ports };
}
