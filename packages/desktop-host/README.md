# `@jini-ai/desktop-host`

The shell-agnostic half of a desktop app: six ports covering the things every Electron or Tauri
wrapper has to do — hold a single-instance lock, track the main window's lifecycle, handle a custom
URL scheme, launch and supervise a sidecar process, run a headless render service, and open external
URLs/paths/folder pickers. The root entry point is the port set plus shared utilities (paths, config
loading, logging, the `window.__jini__` host bridge). The concrete assemblies live behind `./electron`
and `./tauri`, so an Electron app never statically imports the Tauri implementation it will never
call. Note that the Tauri side is genuinely partial — its render service throws
`NotImplementedError`.

## Install

```sh
npm install @jini-ai/desktop-host
```

No peer dependencies, and — importantly — **no dependency on `electron` or `@tauri-apps/api`**. Both
assemblies take their native surfaces as injected objects (`ElectronAppLike`,
`ElectronBrowserWindowFactory`, `TauriWindowFactory`, …), so this package installs and typechecks with
neither framework present, and the whole shell is testable without launching one. `@jini-ai/core` is a
regular dependency, for the DI tokens.

## What you get

**The port set** — `DesktopHostPorts` (`singleInstance`, `windowLifecycle`, `protocolHandler`,
`sidecarLauncher`, `renderService`, `shell`) and `DesktopHost` (`{ backend, ports }`), with the
individual port types `SingleInstanceLockPort`, `WindowLifecyclePort`, `ProtocolHandlerPort`,
`SidecarLauncherPort`, `RenderService`, `ShellPort`, plus their DI tokens
(`SingleInstanceLockToken`, `WindowLifecycleToken`, `ProtocolHandlerToken`, `SidecarLauncherToken`,
`RenderServiceToken`, `ShellToken`).

**Shell-agnostic implementations you can use directly** — `createNodeSidecarLauncher()` and
`appendSidecarLifecycleLog` (a sidecar launcher needs no Electron at all),
`claimSingleInstanceLock` / `createSingleInstanceLockPort`, and `withMainWindowTracking`.

**Protocol handling** — `buildProtocolProxyTargetUrl`, `handleProtocolProxyRequest`,
`schemeEntryUrl` — the custom-scheme-to-local-daemon proxy every packaged app needs.

**Paths and config** — `resolveDesktopHostPathRoots(options)` → `DesktopHostPathRoots`,
`DesktopHostPathError`, and `loadHostConfigFile<T>(...)`.

**Logging** — `createFileLogger`, `appendLogLine`, `installFatalExceptionHandlers`, and
`isHarmlessSocketOptionError` (the socket-teardown noise you do not want paging anyone).

**The host bridge** — the `window.__jini__` contract a renderer uses to detect and call its host:
`JINI_HOST_GLOBAL`, `JINI_HOST_VERSION`, `JINI_HOST_CLIENT_TYPES`, `JiniHostBridge`,
`isJiniHostBridge`, `getJiniHost`, `isJiniHostAvailable`, `detectJiniHostClientType` (returns
`'web'` when there is no host), `openHostExternalUrl`, `openHostPath`, and
`checkJiniHostUpdaterAvailability`. A separate `./bridge-testing` entry point provides
`createMockJiniHost` / `installMockJiniHost` for renderer tests.

**Windows integration** — `syncWindowsUninstallDisplayVersion`,
`windowsUninstallRegistryQueryArgs`, `windowsUninstallDisplayVersionRegistryArgs`.

**`./electron`** — `createElectronDesktopHost(surfaces, overrides?)` plus each port factory
individually (`createElectronSingleInstanceLockPort`, `createElectronWindowLifecyclePort`,
`createElectronProtocolHandlerPort`, `createElectronRenderService`, `createElectronShellPort`), the
`ElectronAppLike` / `ElectronBrowserWindowFactory` / `ElectronProtocolLike` / `ElectronShellLike` /
`ElectronDialogLike` surface interfaces, and fakes for all of them (`createFakeElectronApp`,
`createFakeBrowserWindowFactory`, `createFakeElectronProtocol`, `createFakeElectronShell`,
`createFakeElectronDialog`).

**`./tauri`** — `createTauriDesktopHost` and the matching per-port factories and fakes.
`createTauriRenderService` throws `NotImplementedError` — the Tauri backend is a real but incomplete
sibling, not a drop-in equal of the Electron one.

## Usage

```ts
import { app, BrowserWindow, protocol, shell, dialog } from 'electron';
import { createElectronDesktopHost } from '@jini-ai/desktop-host/electron';
import { createFileLogger, installFatalExceptionHandlers } from '@jini-ai/desktop-host';

const logger = createFileLogger('/Users/me/Library/Logs/example/main.log', { echoToConsole: true });
installFatalExceptionHandlers(logger);

// The surface interfaces (ElectronAppLike, ElectronBrowserWindowFactory, …) are structural
// subsets of Electron's real API, so the real modules satisfy them directly.
const host = createElectronDesktopHost({
  app,
  createBrowserWindow: (options) => new BrowserWindow(options),
  protocol,
  shell,
  dialog,
});

if (!host.ports.singleInstance.claim(() => host.ports.windowLifecycle.showMainWindow())) {
  app.quit();
}

const window = await host.ports.windowLifecycle.createWindow({ /* see WindowCreateOptions */ });
const sidecar = await host.ports.sidecarLauncher.launch({ /* see SidecarLaunchOptions */ });
```

In the renderer, detect and call the host without importing any Electron code:

```ts
import { detectJiniHostClientType, openHostExternalUrl } from '@jini-ai/desktop-host';

if (detectJiniHostClientType() !== 'web') {
  await openHostExternalUrl('https://example.com');
}
```

Read `DesktopHostPorts` and each port interface in `src/` for the full method sets and option shapes
before calling through. The ports are small: `SingleInstanceLockPort` is just `claim`,
`WindowLifecyclePort` is `createWindow` / `getMainWindow` / `showMainWindow`, and
`SidecarLauncherPort` is `launch`.

## Entry points

| subpath | what's behind it | extra dep it pulls in |
|---|---|---|
| `.` | The six port interfaces + DI tokens, the shell-agnostic implementations (sidecar launcher, single-instance, protocol proxy), paths, config, logging, Windows registry helpers, and the `window.__jini__` bridge. | none |
| `./bridge-testing` | `createMockJiniHost` / `installMockJiniHost` for testing renderer code against the host bridge. | none |
| `./electron` | The full Electron assembly + per-port factories + fakes. | none — `electron` is injected, not imported |
| `./tauri` | The full Tauri assembly + per-port factories + fakes. `createTauriRenderService` throws `NotImplementedError`. | none — the Tauri API is injected, not imported |

## What's swappable

Nearly all of it. Every one of the six ports is an interface with a DI token, and
`createElectronDesktopHost(surfaces, overrides)` takes a `Partial<DesktopHostPorts>` second argument
so any single port can be replaced without abandoning the assembly. One level down, the *native
surfaces* are injected too — `ElectronAppLike`, `ElectronBrowserWindowFactory`, `TauriWindowFactory`
and friends are structural interfaces, which is why the shipped fakes can drive a complete host in a
plain unit test. `createFileLogger` returns a `HostLogger` that `installFatalExceptionHandlers`
accepts, so logging is replaceable too. Fixed: the `window.__jini__` bridge contract itself (that is a
wire contract between host and renderer), the protocol-proxy URL construction, and the path-root
resolution rules.

## Runtime

`jini.runtime: "desktop"` — Node built-ins (`node:fs`, `node:child_process`, `node:path`) in the host
half; the bridge helpers are the exception and read only `globalThis`, so they run in a renderer.
ESM only — ships `"type": "module"` with no CommonJS `require` build. Electron's main process must be
configured for ESM to import it.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
