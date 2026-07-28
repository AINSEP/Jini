/**
 * `@injini/core` DI tokens for this package's ports, so a future pack (or a
 * consumer wiring desktop-host services into a `createDaemon` composition)
 * can bind/resolve them the same way `packages/daemon/src/tokens.ts` does
 * for `RunLifecycle`/`EventLog`. `@injini/desktop-host` does not itself
 * define a pack — these tokens exist for that future composition, not
 * because this package resolves them internally today.
 */
import { token } from '@injini/core';
import type { SingleInstanceLockPort } from './single-instance.js';
import type { WindowLifecyclePort } from './window-lifecycle.js';
import type { ProtocolHandlerPort } from './protocol.js';
import type { SidecarLauncherPort } from './sidecar.js';
import type { RenderService } from './render-service.js';
import type { ShellPort } from './shell.js';

export const SingleInstanceLockToken = token<SingleInstanceLockPort>('jini.desktopHost.singleInstanceLock');
export const WindowLifecycleToken = token<WindowLifecyclePort>('jini.desktopHost.windowLifecycle');
export const ProtocolHandlerToken = token<ProtocolHandlerPort>('jini.desktopHost.protocolHandler');
export const SidecarLauncherToken = token<SidecarLauncherPort>('jini.desktopHost.sidecarLauncher');
export const RenderServiceToken = token<RenderService>('jini.desktopHost.renderService');
export const ShellToken = token<ShellPort>('jini.desktopHost.shell');
