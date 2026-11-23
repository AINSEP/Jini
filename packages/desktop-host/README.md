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
assemblies take object-argument bindings for their native surfaces as injected objects (`ElectronAppLike`,
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

**Shell-agnostic implementations you can use directly** — `createNodeSidecarLauncher({})` and
`appendSidecarLifecycleLog` (a sidecar launcher needs no Electron at all),
`claimSingleInstanceLock` / `createSingleInstanceLockPort`, and `withMainWindowTracking`.

**Protocol handling** — `buildProtocolProxyTargetUrl`, `handleProtocolProxyRequest`,
`schemeEntryUrl` — the custom-scheme-to-local-daemon proxy every packaged app needs.

**Paths and config** — `resolveDesktopHostPathRoots(requiredArgs, optionalArgs?)` → `DesktopHostPathRoots`,
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

## Argument convention

Public functions and constructors take a required-arguments object, followed by an optional-arguments object when needed. Functions with only optional values receive `{}` first. Port methods use the same convention. Existing export names stay the same; there are no compatibility overloads. Native Electron/Tauri modules must be bound to the exported object-argument interfaces before injection. Event callbacks deliver payloads in the object shapes documented by those interfaces.

See [API-CONVENTION.md](./API-CONVENTION.md) for the full before/after inventory and consumer ledger.

## Usage

```ts
import { createElectronDesktopHost } from '@jini-ai/desktop-host/electron';
import { createFileLogger, installFatalExceptionHandlers } from '@jini-ai/desktop-host';

const logger = createFileLogger({ logPath: '/Users/me/Library/Logs/example/main.log' }, { echoToConsole: true });
installFatalExceptionHandlers({ logger });

// Supply object-argument bindings around native Electron operations. See the
// exported Electron* interfaces for each binding's full contract.
const host = createElectronDesktopHost(electronPorts);

if (!host.ports.singleInstance.claim({ onSecondInstance: () => host.ports.windowLifecycle.showMainWindow() })) {
  electronPorts.app.quit();
}

const window = await host.ports.windowLifecycle.createWindow({ url: 'https://example.test/' }, { width: 1024 });
const sidecar = await host.ports.sidecarLauncher.launch({ command: '/absolute/sidecar' }, { args: ['--port', '0'] });
```

In the renderer, detect and call the host without importing any Electron code:

```ts
import { detectJiniHostClientType, openHostExternalUrl } from '@jini-ai/desktop-host';

if (detectJiniHostClientType({}) !== 'web') {
  await openHostExternalUrl({ url: 'https://example.com' });
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
| `./bridge` | The renderer-safe `window.__jini__` bridge alone (`getJiniHost`, `openHostExternalUrl`, ...): no `node:` built-in and no relative import, so a renderer bundle does not pull the sidecar or registry modules the root entry re-exports. | none |
| `./bridge-testing` | `createMockJiniHost` / `installMockJiniHost` for testing renderer code against the host bridge. | none |
| `./app-version` | Framework-free `useSyncExternalStore`-shaped controllers for a window's version brand (`createAppVersionLoader`) and its "check for updates" action (`createUpdateCheck`). The main-process half is `registerAppVersionBridge` under `./electron`. | none |
| `./electron` | The full Electron assembly + per-port factories + fakes. | none — `electron` is injected, not imported |
| `./tauri` | The full Tauri assembly + per-port factories + fakes. `createTauriRenderService` throws `NotImplementedError`. | none — the Tauri API is injected, not imported |
| `./shutdown` | Pending teardown tracking, quit/drain decisions and signal routing. | none |
| `./electron/navigation-policy` | Window/renderer origin boundaries and guest admission. | none |
| `./electron/updates` | Updater policy/controller, the manual "Check for updates" (`createUpdateCheckNow`) and file-backed multi-instance presence. | none |
| `./electron/preferences` | JSON preference reads/writes through an injected durable-file port, bounded/choice values, save-before-apply native checkbox and radio items with in-place refresh, and a trusted preference IPC pair. | none |
| `./node-toolchain` | Node/npm/npx shims and caller-named environment variables. | none |
| `./electron/usability` | Find, zoom, spelling menus and remembered bounds through host ports. | none |
| `./speech` | Transcription contracts, mono PCM/WAV encoding, validated IPC and preload bridge. | none |
| `./speech/macos` | On-device helper compilation and transcription through filesystem/process ports. | none; host supplies Swift compiler |
| `./speech/macos/speech-helper.swift` | Native Swift source asset copied into the published dist tree. | none |


## What's swappable

Nearly all of it. Every one of the six ports is an interface with a DI token, and
`createElectronDesktopHost(surfaces, overrides)` takes a `Partial<DesktopHostPorts>` second argument
so any single port can be replaced without abandoning the assembly. One level down, the *native
surfaces* are injected too — `ElectronAppLike`, `ElectronBrowserWindowFactory`, `TauriWindowFactory`
and friends are structural interfaces, which is why the shipped fakes can drive a complete host in a
plain unit test. `createFileLogger` returns core `Logger` that `installFatalExceptionHandlers`
accepts, so logging is replaceable too. Fixed: the `window.__jini__` bridge contract itself (that is a
wire contract between host and renderer), the protocol-proxy URL construction, and the path-root
resolution rules.

## Runtime

`jini.runtime: "desktop"` — Node built-ins (`node:fs`, `node:child_process`, `node:path`) in the host
half; the bridge helpers are the exception and read only `globalThis`, so they run in a renderer.
ESM only — ships `"type": "module"` with no CommonJS `require` build. Electron's main process must be
configured for ESM to import it.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.

## Desktop policies and speech

All additional entries keep application channels, labels, paths, locale, messages
and persistence keys in required objects supplied by the host. No dependency was
added. [API-USABILITY-SPEECH.md](./API-USABILITY-SPEECH.md) documents each usability
and speech function, injected port, native binding and asset location. The four
policy/toolchain subpaths are documented in [API.md](./API.md).

The root and native shell entry points retain their existing export names. The
object-argument conversion is a breaking caller change: bind native methods to the
exported port interfaces, including usability and speech callbacks, before injecting
SDK objects. Find/zoom renderer hooks remain application-owned pending a separate
React entry; the current additions cover main-process behavior and the speech bridge.

Verification for this integration is not run by owner directive. The exact per-file
commands and later consumer rewiring requests are in
[INTEGRATION-desktop-host.md](./INTEGRATION-desktop-host.md).

## Native updater and navigation callbacks

`./electron/updates` accepts the structural native electron-updater surface directly: `on(event, listener)` and `quitAndInstall(isSilent?, isForceRunAfter?)`. `createElectronUpdaterAdapter({ updater })` forwards mutable flags and retains the native receiver without importing Electron. Controllers take a core `Clock` in `clock`; effects remain required. Timer, timing and message overrides go in the second options object:

```ts
import { createSystemClock } from '@jini-ai/platform/system';
import { createAutoUpdateController } from '@jini-ai/desktop-host/electron/updates';

const controller = createAutoUpdateController({
  updater, platform, pid, presence, clock: createSystemClock(),
  promptUpdateReady, explainOthersOpen, quit, log,
}, { timing: { firstCheckDelayMs: 30_000 } });
```

The default Node timer adapter is also exported as `createNodeUpdateTimers()`. Default timing is 30 seconds before the first check, 15-minute ticks, four-hour checks, 45-minute stale presence and a two-minute install fallback. Partial timing overrides inherit the other values. `defaultUpdateMessages` is the single exported controller copy object; a host can replace it as a whole through `options.messages`. Options override legacy settings in the dependency object.

`./electron/navigation-policy` accepts raw `webContents`, including `setWindowOpenHandler(handler)` and native navigation/redirect listeners. Origin and scheme checks stay the same.

`UpdaterLike` and `NavigableContents` are unions with the existing object registration types, exported as `LegacyUpdaterLike` and `LegacyNavigableContents`. The legacy controller `now` callback and dependency-object timers/timing/messages also remain accepted during migration. Native `on` implementations have two parameters (or a rest tuple); the old object registration has one. Custom one-parameter native updater facades should use `createElectronUpdaterAdapter`. Popup-only contents receive a callable handler that also supports the old `{ handler }` destructuring ABI. Hosts can remove their registration wrappers when ready.

## Wiring

Window navigation, guest admission and remembered bounds have one implementation each, under
`./electron/navigation-policy` and `./electron/usability`; there are no `./shell/*` wrappers for them.
`./shell/guest-navigation` builds on the same navigation-policy API.

- **Needs injected:** `openExternal`, the app origin or renderer file URL, an `isSupervisedGuestUrl` /
  `isAllowedSource` predicate, the guest `preloadPath`, and for bounds a `BoundsStorePort`
  (`read`/`write` keyed by path), the bounds file name and a `joinPath`.
- **Provides:** popup/navigation/redirect boundaries, the sender check `isShellPageUrl`
  (attach-mode origin as the second argument), guest preference hardening that throws the
  missing-preload diagnostic, and bounds read/validate/write with the on-screen check.
- **Never imports:** `electron`, `node:fs` or host paths; the host owns storage and file location.

```ts
import { installAppWindowNavigationPolicy, applyGuestWebPreferences } from '@jini-ai/desktop-host/electron/navigation-policy';
import { readWindowBounds, resolveWindowBounds, windowBoundsFilePath } from '@jini-ai/desktop-host/electron/usability';

installAppWindowNavigationPolicy({ contents: win.webContents, appOrigin, openExternal: ({ url }) => shell.openExternal(url) });
contents.on('will-attach-webview', (_e, webPreferences) => applyGuestWebPreferences({ webPreferences, preloadPath }));
const key = windowBoundsFilePath({ userDataDir, fileName: 'window-bounds.json', joinPath: ({ directory, filename }) => path.join(directory, filename) });
const bounds = resolveWindowBounds({ stored: readWindowBounds({ store: jsonStore, key }), displays: screen.getAllDisplays(), fallback });
```

### Wiring: manual update check and desktop preferences

- **Needs injected:** for `createUpdateCheckNow` (`./electron/updates`), the host's eligibility
  (`isPackaged`, `skipReason`), the automatic-updates read, the controller's `readyVersion` and
  `showReadyPrompt`, a lazy `loadUpdater`, `notify`/`log`, an `UpdateCheckCopy` (every notice's
  words) and a redacting `describeErrorForLog`; `registerUpdateCheckIpc` takes the host's channel.
  For `./electron/preferences`, a `PreferenceFilePort` (`read`/`withLock`/`writeAtomic`), the file
  path, keys, bounds, choices, channels, error codes, menu labels and an `onProblem` warning hook.
- **Provides:** one in-flight manual check (repeat clicks join it; look-only when automatic updates
  are off), `isNetworkUpdateError`; key-level preference read/write that never overwrites unreadable
  bytes, `persistedCheckbox`/`persistedRadioGroup` that restore the last saved state on a failed save,
  `refreshRadioGroup`/`refreshCheckboxesByLabel`, and `registerPreferenceIpc` (sender check first).
- **Never imports:** `electron`, `node:fs`, host copy, host paths or channel names; menu composition
  (which items sit in which menu) stays with the host.

```ts
import { createUpdateCheckNow, registerUpdateCheckIpc } from '@jini-ai/desktop-host/electron/updates';
import { persistedCheckbox, readPreferenceValue, writePreferenceValue } from '@jini-ai/desktop-host/electron/preferences';

const file = { read: readJsonFile, withLock: withFileLock, writeAtomic: writeJsonFileAtomic };
const auto = () => readPreferenceValue({ file, filePath, key: 'automaticUpdates', parse: ({ value }) => value !== false, fallback: true });
const item = persistedCheckbox({ label: copy.automaticUpdates, checked: auto(), onError,
  save: ({ checked }) => writePreferenceValue({ file, filePath, key: 'automaticUpdates', value: checked }) });
const check = createUpdateCheckNow({ ...eligibility, automaticUpdates: auto, copy: hostUpdateCopy, describeErrorForLog, notify, log });
registerUpdateCheckIpc({ ipcMain, channel: HOST_CHECK_FOR_UPDATES_CHANNEL, checkNow: check.checkNow });
```

### Wiring: preload channel subscriber and `<webview>` types

- **Needs injected:** for `createPreloadSubscriber` (`./electron/preload`), a `PreloadIpcListenerPort`
  (`on`/`removeListener`, args-object shaped) that passes `handler` through to Electron unchanged.
- **Provides:** a `PreloadSubscribe` that forwards only the payload (never the raw IPC event and its
  `sender`) and returns a cleanup removing exactly that listener. `./electron/webview` provides
  DOM-free structural types (`WebviewDidFailLoadDetail`, `WebviewFoundInPageDetail`, `WebviewTagMethods`, ...).
- **Stays with the host:** the channel allowlist (only fixed contract channels are ever subscribed),
  `contextBridge` globals, and the `declare global` / JSX `webview` registration that combines these
  types with `Event`/`HTMLElement`.
- **Never imports:** `electron`, React, or DOM lib types.

```ts
import { createPreloadSubscriber } from '@jini-ai/desktop-host/electron/preload';

const subscribe = createPreloadSubscriber({ ipcRenderer: {
  on: ({ channel, handler }) => ipcRenderer.on(channel, handler),
  removeListener: ({ channel, handler }) => ipcRenderer.removeListener(channel, handler),
} });
contextBridge.exposeInMainWorld('hostBridge', { onZoomCommand: ({ listener }) => subscribe({ channel: ZOOM_COMMAND_CHANNEL, listener }) });
```

Architecture: [extraction-plan.md](../../ADS-memory/reports/jini-port/extraction-plan.md).

File logging uses core `Logger`; `error` in the optional bag is normalized into the JSON metadata alongside `meta`, consistently across all three levels.

## Native speech runtime asset

`@jini-ai/desktop-host/speech/macos/speech-helper.swift` exports the Swift source used by the macOS speech adapter. The build copies it into `dist/speech/macos`; desktop hosts bundle or compile that source on macOS alongside the adapter. It is a required runtime asset, not a TypeScript entry.
