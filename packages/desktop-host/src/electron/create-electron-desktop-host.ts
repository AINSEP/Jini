import { createNodeSidecarLauncher } from '../sidecar.js';
import type { DesktopHost, DesktopHostPorts } from '../ports.js';
import { createElectronSingleInstanceLockPort } from './electron-single-instance.js';
import { createElectronWindowLifecyclePort } from './electron-window-lifecycle.js';
import { createElectronProtocolHandlerPort } from './electron-protocol.js';
import { createElectronRenderService } from './electron-render-service.js';
import { createElectronShellPort } from './electron-shell.js';
import type { ElectronAppLike, ElectronBrowserWindowFactory, ElectronDialogLike, ElectronProtocolLike, ElectronShellLike } from './electron-surfaces.js';

export interface ElectronDesktopHostSurfaces {
  app: ElectronAppLike;
  createBrowserWindow: ElectronBrowserWindowFactory;
  protocol: ElectronProtocolLike;
  shell: ElectronShellLike;
  /** Backs `ShellPort.openFolderDialog` (2026-07-22 addition — see `shell.ts`'s module doc). */
  dialog: ElectronDialogLike;
}

export function createElectronDesktopHost(
  surfaces: ElectronDesktopHostSurfaces,
  overrides: Partial<DesktopHostPorts> = {},
): DesktopHost {
  const ports: DesktopHostPorts = {
    singleInstance: overrides.singleInstance ?? createElectronSingleInstanceLockPort({ app: surfaces.app }),
    windowLifecycle: overrides.windowLifecycle ?? createElectronWindowLifecyclePort({ createBrowserWindow: surfaces.createBrowserWindow }),
    protocolHandler: overrides.protocolHandler ?? createElectronProtocolHandlerPort({ electronProtocol: surfaces.protocol }),
    sidecarLauncher: overrides.sidecarLauncher ?? createNodeSidecarLauncher({}),
    renderService: overrides.renderService ?? createElectronRenderService({ createBrowserWindow: surfaces.createBrowserWindow }),
    shell: overrides.shell ?? createElectronShellPort({ shell: surfaces.shell, app: surfaces.app, dialog: surfaces.dialog }),
  };
  return { backend: 'electron', ports };
}
