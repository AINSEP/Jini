Spec ID: SPEC-JINI-DESKTOP-HOST-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:81a5b64b67d79c1ede5767201f92bc37073a66e65df80304a2c10b23f843a317
spec_mode: reverse_spec


# API Contract: desktop-host

## Purpose and entry-point registry

Shell-neutral desktop ports plus separately imported shell, lifecycle and capability adapters. Native SDKs are supplied by the consumer through object-argument bindings; raw Electron/Tauri SDK objects do not satisfy the current surfaces. Root utilities include Node dependencies, so shell-neutral does not mean browser-only.

| Import suffix after `@jini-ai/desktop-host` | Surface |
|---|---|
| root | Shared ports, bridge, paths, config, logging, Node sidecar and render helpers |
| `/bridge-testing` | Mock bridge construction and scoped installation |
| `/electron` | Electron port factories, assembly and fakes |
| `/tauri` | Tauri port factories, assembly, unsupported-capability error and fakes |
| `/shutdown` | Drain tracking, quit decisions and signal routing |
| `/electron/navigation-policy` | Window/guest URL and preference guards |
| `/electron/updates` | Update policy, presence and controller |
| `/node-toolchain` | Bundled-runtime launchers and environment composition |
| `/electron/usability` | Native menus, search IPC and window geometry |
| `/speech` | Transcription ports, WAV conversion and trusted IPC bridge |
| `/speech/macos` | Injected native recognizer/compiler adapter |
| `/speech/macos/speech-helper.swift` | Source asset; not a JS module |

All are declared ESM exports. Signatures below preserve source NOW. Two-object functions use `(required, optional = {})`; `optional?` indicates declaration optionality. Existing one-object/zero-argument signatures are exceptions, not implicit support for a second object. Names of exported structural types refer to their linked source definitions. No shared-type relocation is assumed.

## Root: shared port contract

`DesktopHost = {backend:'electron'|'tauri', ports:DesktopHostPorts}`. Ports are `singleInstance`, `windowLifecycle`, `protocolHandler`, `sidecarLauncher`, `renderService`, and `shell`:

```ts
interface SingleInstanceLockPort { claim(required: {onSecondInstance: () => void}): boolean; }
interface WindowLifecyclePort {
  createWindow(required: {url:string}, optional?: {width?:number, height?:number, show?:boolean}): Promise<WindowHandle>;
  getMainWindow(): WindowHandle|null;
  showMainWindow(): void;
}
interface WindowHandle {
  loadUrl(required: {url:string}): Promise<void>;
  show(): void; hide(): void; focus(): void; close(): void; isDestroyed(): boolean;
  onClosed(required: {listener: () => void}): void;
}
interface ProtocolHandlerPort {
  registerSchemeProxy(required: {scheme:string, targetBaseUrl:string}): {scheme:string, entryUrl:string};
}
interface SidecarLauncherPort {
  launch(required: {command:string}, optional?: Omit<SidecarLaunchOptions,'command'>): Promise<SidecarHandle>;
}
interface SidecarHandle {
  readonly process: SidecarProcessHandle;
  readonly logPath: string|null;
  waitUntilReady<T>(required: {probe: () => Promise<T>, isReady: (args: {status:T}) => boolean},
    optional?: {timeoutMs?:number, pollIntervalMs?:number}): Promise<T>;
  shutdown(required: Record<string,never>, optional?: SidecarShutdownOptions): Promise<void>;
}
interface RenderService {
  renderToPdf(required: {html:string}, optional?: RenderToPdfOptions): Promise<Uint8Array>;
  capture(required: {html:string}, optional?: CaptureOptions): Promise<Uint8Array>;
  exportArtifact(required: {html:string, format:string}, optional?: Omit<ExportArtifactOptions,'format'>): Promise<unknown>;
}
interface ShellPort {
  openExternal(required: {url:string}): Promise<void>;
  openPath(required: {path:string}): Promise<void>;
  dirExists(required: {path:string}): Promise<boolean>;
  recentDirs(): Promise<string[]>;
  openFolderDialog(required: Record<string,never>, optional?: {defaultPath?:string}): Promise<string|null>;
}
```

`SidecarLaunchOptions` includes `command`, optional `args:string[]`, `env:NodeJS.ProcessEnv`, `cwd`, `logPath`. `SidecarShutdownOptions` has `requestShutdown?: () => Promise<void>`, `gracefulTimeoutMs?:number`. Process handle: optional PID, `onExit({listener:({code:number|null,signal:NodeJS.Signals|null})=>void}):void`, `kill({}, optional?:{signal?:NodeJS.Signals}):boolean`.

Render options: optional `{viewport:{width,height,deviceScaleFactor?}, timeoutMs, signal:AbortSignal, resourcePolicy:{javascript?,allowNavigation?,allowedOrigins?:string[],allowUnrestrictedNetwork?:boolean}}`. PDF adds `{landscape?,printBackground?,pageWidth?,pageHeight?,margins?:{top?,bottom?,left?,right?}}`; capture adds `clip?:{x,y,width,height}`; artifact adds `format` and optional `extra:Record<string,unknown>`. All geometry/timing values are numbers. The Electron adapter ignores `deviceScaleFactor`.

## Root: functions, classes and constants

| Current signature | Return / supplied dependency |
|---|---|
| `claimSingleInstanceLock({app:SingleInstanceApp, onSecondInstance})` | `boolean`; app request-lock/quit/listener methods |
| `createSingleInstanceLockPort({app:SingleInstanceApp})` | `SingleInstanceLockPort` |
| `withMainWindowTracking({createWindowImpl})` | `WindowLifecyclePort`; required factory matches `createWindow` |
| `createNodeSidecarLauncher({})` | `SidecarLauncherPort`; native Node spawn/filesystem |
| `appendSidecarLifecycleLog({logPath, message})` | `Promise<void>` |
| `buildProtocolProxyTargetUrl({targetBaseUrl, requestUrl})` | `string` |
| `handleProtocolProxyRequest({request:Request, targetBaseUrl}, optional = {fetchImpl?:ProtocolFetch})` | `Promise<Response>` |
| `schemeEntryUrl({scheme})` | `string` |
| `resolveDesktopHostPathRoots({namespace, namespaceBaseRoot}, optional = {dataDirOverrideEnvVar?, env?})` | `DesktopHostPathRoots` |
| `loadHostConfigFile<T extends Record<string,unknown>>({candidatePaths:string[]}, optional = {explicitPathEnvVar?, env?})` | `Promise<T>` |
| `appendLogLine({logPath,line}, optional = {append?:LogAppend})` | `boolean` |
| `createFileLogger({logPath}, optional = {echoToConsole?:boolean, append?:LogAppend})` | `Logger` |
| `isHarmlessSocketOptionError({value:unknown})` | `boolean` |
| `installFatalExceptionHandlers({logger:Logger}, optional:InstallFatalExceptionHandlersOptions = {})` | `() => void` disposer; installs process listeners |
| `windowsUninstallRegistryQueryArgs({registryKey})` | `string[]` |
| `windowsUninstallDisplayVersionRegistryArgs({registryKey,version})` | `string[]` |
| `syncWindowsUninstallDisplayVersion({resolveUninstallRegistryKey,namespace,version:string|null}, optional = {exec?:WindowsRegistryExec, platform?:NodeJS.Platform})` | `Promise<boolean>` |
| `htmlToDataUrl({html})` | `string` |
| `isOriginAllowed({url}, optional = {allowedOrigins?:string[],allowUnrestrictedNetwork?:boolean})` | `boolean` |
| `withRenderTimeout<T>({promise:Promise<T>}, optional = {timeoutMs?, signal?:AbortSignal})` | `Promise<T>` |
| `new DesktopHostPathError({message})`, `new ShellError({message})` | Error instances |
| `new RenderServiceError({message, code:RenderServiceErrorCode})` | Error instance with `code` |

Unless annotated otherwise, path/URL/label/message fields are strings. `ProtocolFetch({request}):Promise<Response>`. `LogAppend({path,data,encoding:BufferEncoding}):void`. `Logger.info/warn/error({message}, optional?:{meta?:Record<string,unknown>,error?:unknown}):void`. Fatal-handler options supply `isHarmless?({value:unknown}):boolean`. Registry key resolver receives `{namespace}`; executor receives `{command,args:string[]}` plus optional `{windowsHide?:true}` and returns `Promise<unknown>`.

Path roots return `{namespaceRoot,dataRoot,cacheRoot,logsRoot,runtimeRoot,userDataRoot,sessionDataRoot}:string`. Public request types include `WindowCreateOptions`, `SidecarReadyOptions<T>`, `LoadHostConfigFileOptions`, `ResolvePathRootsOptions`, `SyncWindowsUninstallDisplayVersionInput`, `ProtocolSchemeRegistration`, `ProtocolProxyErrorBody`, and render option/geometry types.

DI constants are typed core tokens: `SingleInstanceLockToken`, `WindowLifecycleToken`, `ProtocolHandlerToken`, `SidecarLauncherToken`, `RenderServiceToken`, `ShellToken`. They do not install bindings or define a pack.

### Root renderer bridge

Constants: `JINI_HOST_GLOBAL = '__jini__'`, `JINI_HOST_VERSION = 1`, frozen `JINI_HOST_CLIENT_TYPES = {ELECTRON:'electron', TAURI:'tauri'}`.

`JiniHostBridge` requires version 1, `client:{type,platform?,osLocale?}`, and shell `openExternal({url})/openPath({path}):Promise<JiniHostActionResult>`. Optional updater supplies `checkAvailability():Promise<{available:boolean}>`. `JiniHostActionResult = {ok:true}|JiniHostFailure`; failure is `{ok:false,reason:string,details?:unknown}`. `JiniHostGlobalScope` is a string-keyed record with optional `window`.

| Current signature | Return |
|---|---|
| `isJiniHostBridge(required:{value:unknown})` | Type predicate narrowing the argument object to `{value:JiniHostBridge}` |
| `getJiniHost({}, optional = {scope?:JiniHostGlobalScope})` | `JiniHostBridge|null` |
| `isJiniHostAvailable({}, optional = {scope?})` | `boolean` |
| `detectJiniHostClientType({}, optional = {scope?})` | `JiniHostClientType|'web'` |
| `openHostExternalUrl({url}, optional = {scope?})` | `Promise<JiniHostActionResult>` |
| `openHostPath({path}, optional = {scope?})` | `Promise<JiniHostActionResult>` |
| `checkJiniHostUpdaterAvailability({}, optional = {scope?})` | `Promise<JiniHostUpdaterAvailability|JiniHostFailure>` |

```ts
import { createSingleInstanceLockPort, withMainWindowTracking } from '@jini-ai/desktop-host';
// app and createWindowImpl are consumer-owned implementations of the shared ports.
const windows = withMainWindowTracking({ createWindowImpl });
const lock = createSingleInstanceLockPort({ app });
if (lock.claim({ onSecondInstance: () => windows.showMainWindow() })) {
  await windows.createWindow({ url: 'http://127.0.0.1:4100' }, { width: 1024, height: 768 });
}
```

## `/bridge-testing`

`createMockJiniHost({}, optional:MockJiniHost = {}):JiniHostBridge`; `installMockJiniHost({}, optional:MockJiniHostOptions = {}):()=>void`. Mock overrides accept partial client/shell and optional version/updater; installation options are `{host?,scope?}`. Default host has Electron type, platform `test`, and successful shell actions.

```ts
import { installMockJiniHost } from '@jini-ai/desktop-host/bridge-testing';
const scope = {};
const restore = installMockJiniHost({}, { scope });
restore();
```

## `/electron` and `/tauri`

| Current signature | Return |
|---|---|
| `createElectronDesktopHost(required:ElectronDesktopHostSurfaces, optional:Partial<DesktopHostPorts> = {})` | `DesktopHost` |
| `createElectronSingleInstanceLockPort({app:ElectronAppLike})` | `SingleInstanceLockPort` |
| `createElectronWindowLifecyclePort({createBrowserWindow:ElectronBrowserWindowFactory})` | `WindowLifecyclePort` |
| `createElectronProtocolHandlerPort({electronProtocol:ElectronProtocolLike})` | `ProtocolHandlerPort` |
| `createElectronRenderService({createBrowserWindow:ElectronBrowserWindowFactory})` | `RenderService` |
| `createElectronShellPort(required:ElectronShellSurfaces)` | `ShellPort` |
| `createTauriDesktopHost(required:TauriDesktopHostSurfaces, optional:Partial<DesktopHostPorts> = {})` | `DesktopHost` |
| `createTauriSingleInstanceLockPort({api:TauriSingleInstanceApi})` | `SingleInstanceLockPort` |
| `createTauriWindowLifecyclePort({createTauriWindow:TauriWindowFactory})` | `WindowLifecyclePort` |
| `createTauriProtocolHandlerPort({})` | `ProtocolHandlerPort`; method throws |
| `createTauriRenderService({})` | `RenderService`; methods reject |
| `createTauriShellPort(required:TauriShellSurfaces)` | `ShellPort`; recent directories unsupported |
| `createTauriSidecarLauncher({api:TauriSidecarCommandApi})` | `SidecarLauncherPort` |
| `new NotImplementedError({message})` (Tauri only) | `Error` subclass |

Electron assembly requires `{app,createBrowserWindow,protocol,shell,dialog}`; shell factory requires `{shell,app,dialog}`. Tauri assembly requires `{singleInstance,createWindow,shell,sidecarCommands,fs,dialog}`; shell factory requires `{shell,fs,dialog}`. Overrides replace individual ports. Construction creates no native window/child. The consumer adapts positional SDK calls and native event callbacks into the object contracts in [Electron surfaces](../../src/electron/electron-surfaces.ts) and [Tauri surfaces](../../src/tauri/tauri-surfaces.ts).

Electron window factory is `({}, optional?:ElectronBrowserWindowOptions)=>ElectronBrowserWindowLike`; native surface must support URL load, lifecycle, load events, session request filtering, PDF and PNG capture. Tauri window factory is `({label,url}, optional?:{width?,height?,visible?})=>Promise<TauriWindowLike>`; its handle supplies navigation, async visibility/focus/close, closed check and close-request subscription, plus an optional `onClosed({listener})` subscription for confirmed native destruction. Tauri requires native single-instance enforcement before JS startup.

Public fakes, all constructed with required `{}`:

| Function / optional settings | Return |
|---|---|
| `createFakeElectronApp({}, optional = {lockGranted?,recentDocuments?:string[]})` | `ElectronAppLike & {quitCalled:boolean,emitSecondInstance():void}` |
| `createFakeElectronDialog({}, optional = {openDialogResult?:ElectronOpenDialogResult})` | `ElectronDialogLike & {lastShowOpenDialogOptions:unknown}` |
| `createFakeBrowserWindowFactory({}, optional:FakeWindowScript = {})` | `{factory:ElectronBrowserWindowFactory,windows:ElectronBrowserWindowLike[]}` |
| `createFakeElectronProtocol({})` | `ElectronProtocolLike & {handlers:Map<string,ProtocolFetch>}` |
| `createFakeElectronShell({}, optional = {openPathError?:string})` | `ElectronShellLike & {openedExternalUrls:string[],openedPaths:string[]}` |
| `createFakeTauriSingleInstanceApi({})` | `TauriSingleInstanceApi & {emitSecondInstance({args:string[],cwd:string}):void}` |
| `createFakeTauriWindowFactory({})` | `{factory:TauriWindowFactory,windows:TauriWindowLike[]}` |
| `createFakeTauriShellApi({})` | `TauriShellApi & {openedUrls:string[],openedPaths:string[]}` |
| `createFakeTauriFsApi({}, optional = {directories?:string[],files?:string[]})` | `TauriFsApi` |
| `createFakeTauriDialogApi({}, optional = {openResult?:string|string[]|null})` | `TauriDialogApi & {lastOpenOptions:unknown}` |
| `createFakeTauriSidecarCommandApi({}, optional:FakeTauriSidecarScript = {})` | `TauriSidecarCommandApi & {spawned:Array<{binaryName:string,args:string[]}>}` |

`FakeWindowScript` supplies optional fail-load `{errorCode,errorDescription}`, hang, PDF Buffer and PNG Buffer. `FakeTauriSidecarScript` supplies optional immediate exit code, ready-after-probes and ignores-graceful-shutdown. The ready-after-probes field is unused by the current fake. Fakes do not demonstrate native SDK compatibility.

```ts
import { createElectronDesktopHost, createFakeElectronApp, createFakeBrowserWindowFactory,
  createFakeElectronProtocol, createFakeElectronShell, createFakeElectronDialog } from '@jini-ai/desktop-host/electron';
const { factory } = createFakeBrowserWindowFactory({});
const host = createElectronDesktopHost({ app:createFakeElectronApp({}), createBrowserWindow:factory,
  protocol:createFakeElectronProtocol({}), shell:createFakeElectronShell({}), dialog:createFakeElectronDialog({}) });
await host.ports.windowLifecycle.createWindow({ url:'http://127.0.0.1:4100' });
```

```ts
import { createTauriDesktopHost } from '@jini-ai/desktop-host/tauri';
// All six surfaces are object-argument adapters supplied by the native consumer.
const host = createTauriDesktopHost({ singleInstance, createWindow, shell, sidecarCommands, fs, dialog });
await host.ports.windowLifecycle.createWindow({ url:'http://127.0.0.1:4100' });
```

## `/shutdown`

`createShutdownTracker({}):ShutdownTracker` returns `track({promise:PromiseLike<unknown>}):Promise<void>`, readonly `size:number`, `drain():Promise<void>`. `decideBeforeQuit(required:BeforeQuitInput):BeforeQuitAction`, where input is `{phase:QuitPhase,nothingToDrain:boolean}`, phases are `idle|draining|drained`, actions `proceed|drain|hold`.

`routeQuitSignals(required:QuitSignalInput, optional:QuitSignalOptions = {}):void` requires `{processLike,quit,forceExit,deadlineMs}`; `processLike.on({signal,listener})`; optional `setTimer:QuitTimer({fn,ms})=>{unref?():void}`. `QUIT_SIGNALS` contains SIGINT/SIGTERM/SIGHUP. Persistent handlers have no disposer.

```ts
import { createShutdownTracker, decideBeforeQuit } from '@jini-ai/desktop-host/shutdown';
const tracker = createShutdownTracker({});
tracker.track({ promise: closeHostResources() });
if (decideBeforeQuit({ phase:'idle', nothingToDrain:tracker.size === 0 }) === 'drain') await tracker.drain();
```

## `/electron/navigation-policy`

| Current signature | Return / dependency |
|---|---|
| `isSameOrigin({candidate,reference})`, `isExternalBrowserUrl({raw})` | `boolean` |
| `installAppWindowNavigationPolicy({contents:NavigableContents,appOrigin,openExternal})` | `void`; external callback receives `{url}` |
| `installRendererNavigationPolicy({contents,rendererFileUrl,openExternal})` | `void` |
| `installGuestWindowOpenPolicy({contents,isSupervisedGuestUrl,openExternal})` | `void`; supervised predicate receives `{url}` |
| `isShellPageUrl({raw,pages:ShellPages}, optional = {attachUrl?})` | `boolean`; pages `{isSupervisedSite,rendererFileUrl}` |
| `applyGuestWebPreferences({webPreferences:GuestWebPreferences,preloadPath})` | `void`; mutates preferences |
| `admitGuestSource({event,params:{src?:unknown},isAllowedSource})` | `boolean`; source predicate receives `{src}` |

`NavigableContents` accepts native popup/navigation/redirect registrations or the old object-bound registrations through a union. Source/refused-event supports `preventDefault()`. No navigation installer returns a disposer. Related exported option/response types describe these same predicates and `{action:'allow'|'deny'}`.

```ts
import { installAppWindowNavigationPolicy } from '@jini-ai/desktop-host/electron/navigation-policy';
installAppWindowNavigationPolicy({ contents, appOrigin:'http://127.0.0.1:4100', openExternal });
```

## `/electron/updates`

| Current signature | Return |
|---|---|
| `updaterSkipReason({environment:UpdaterEnvironment,supportedPlatforms,reasons})` | `string|null` |
| `electUpdaterOwner({instances:readonly InstanceRecord[],now:number,staleMs:number})` | `number|null` PID |
| `shouldCheckNow(required:CheckInput)` | `boolean` |
| `decideFinalQuit(required:FinalQuitInput)` | `FinalQuitAction` |
| `decideRestartClick({updateReady:boolean,otherInstances:number})` | `RestartClickAction` |
| `presenceDirPath({userDataDir,directoryName})` | `string` |
| `isPidAlive({pid:number,probe:({pid,signal:0})=>unknown})` | `boolean` |
| `createFileInstancePresence({ directory, filesystem, isAlive, writerPid }: FileInstancePresenceInput)` | `InstancePresencePort` |
| `createAutoUpdateController(required:AutoUpdateControllerDeps, optional:AutoUpdateControllerOptions = {})` | `AutoUpdateController` |

Eligibility input: `{isPackaged,windowsStore,platform,disabledByEnv,selftest}`; caller supplies supported platforms and all reason strings/unsupported-platform formatter. `InstanceRecord={pid,startedAt,heartbeatAt}:number`. Check input `{isOwner,lastCheckAt:number|null,now,busy,intervalMs}`. Final input `{platform,updateReady,otherInstances,restartRequested,installStarted}`; actions `proceed|install-on-quit|stage-then-quit|install-and-relaunch`. Restart actions `restart|others-open|not-ready`.

Presence requires `{directory,filesystem:PresenceFilesystemPort,isAlive:({pid})=>boolean,writerPid}` and returns `write({record}):void`, `readLive():InstanceRecord[]`, `remove({pid}):void`. Filesystem port supplies object-bound mkdir/write/rename/unlink/readdir/read methods.

Controller requires `{updater:UpdaterLike,platform,pid,presence,clock:Clock,promptUpdateReady,explainOthersOpen,quit,log}`; legacy `now` is accepted instead of `clock`. Parameter-two options supply timers, partial timing and messages. Defaults are Node timers, `defaultUpdateMessages` and `defaultUpdateTiming` (30s launch, 15m ticks, 4h checks, 45m stale presence, 2m staging timeout). Native updater event registration is `on(event, listener)` with event-specific payloads; installation is `quitAndInstall(isSilent?, isForceRunAfter?)`. Legacy object registrations and dependency-object overrides remain accepted. `createElectronUpdaterAdapter({ updater })` and `createNodeUpdateTimers()` are exported. Timer port supplies object-bound timeout/interval/clear. Prompt takes `{version}` and returns `Promise<boolean>`; sibling explanation takes `{count}`; log takes `{message}`.

Returned methods: `start()/tick()/requestRestart()/willQuit():void`; `beforeFinalQuit():boolean` (true means hold quit for installer handoff). Reference constants: `FIRST_CHECK_DELAY_MS=30000`, `UPDATER_TICK_MS=900000`, `UPDATE_CHECK_INTERVAL_MS=14400000`, `PRESENCE_STALE_MS=2700000`.

```ts
import { createAutoUpdateController } from '@jini-ai/desktop-host/electron/updates';
const updates = createAutoUpdateController({ updater, platform, pid, presence, clock,
  promptUpdateReady, explainOthersOpen, quit, log }, { timers, timing, messages });
updates.start(); // Host calls beforeFinalQuit() after draining and willQuit() at actual exit.
```

## `/node-toolchain`

`assertCmdQuotable({value:unknown,field:string}):string`; `buildNodeToolchainShims({ electronPath, npmRoot, platform, generatedComment, joinPath }: BuildNodeToolchainShimsInput):Record<string,string>`; `writeNodeToolchain(required:WriteNodeToolchainInput):NodeToolchainPaths|null`; `buildNodeToolchainEnv({ toolchainDir, npmRoot, toolchainEnvName, npmRootEnvName }: BuildNodeToolchainEnvInput):Record<string,string>`.

Shim input requires `{electronPath,npmRoot,platform,generatedComment,joinPath:({parts:string[]})=>string}`. Write adds `{paths:{toolchainDir,binDir,npmCacheDir,npmPrefixDir},filesystem:ToolchainFilesystemPort,writerPid,isTransientPath:({executablePath})=>boolean,launcherNamesDurableInstall:({launcherPath})=>boolean}`. Filesystem provides object-bound mkdir/chmod/write/rename/unlink. Env input requires `{toolchainDir,npmRoot,toolchainEnvName,npmRootEnvName}`. No filesystem, platform, message, executable or path defaults are injected.

```ts
import { buildNodeToolchainEnv } from '@jini-ai/desktop-host/node-toolchain';
const env = buildNodeToolchainEnv({ toolchainDir:'/opt/example/toolchain', npmRoot:'/opt/example/npm',
  toolchainEnvName:'APP_TOOLCHAIN', npmRootEnvName:'APP_NPM_ROOT' });
```

## `/electron/usability`

| Current signature | Return |
|---|---|
| `registerFindInPageIpc({ipcMain:FindIpcPort,browserWindow:FindWindowLookup,channels:{find,stop}})` | `() => void` |
| `relayFindResults({window,resultChannel})` | `() => void` |
| `sendFindToggle({window:FindCommandWindow|undefined,channel})` | `boolean` |
| `findMenu({channel,labels:{menu,item}}, optional = {accelerator?})` | `FindMenu` |
| `sendZoomCommand({window:ZoomCommandWindow|undefined,direction:ZoomCommandDirection,channel})` | `boolean` |
| `zoomMenuItems({channel,labels:{reset,in,out}})` | `ZoomMenuItem[]` |
| `buildSpellCheckMenuTemplate({params:SpellCheckContextMenuParams,handlers:SpellCheckMenuHandlers,labels:SpellCheckLabels}, optional = {maxSuggestions?})` | `MenuItemConstructorOptions[]` |
| `registerSpellCheckContextMenu({webContents:SpellCheckWebContents,menuBuilder:MenuBuilder,labels}, optional = {maxSuggestions?})` | `() => void` |
| `windowBoundsFilePath({userDataDir,fileName,joinPath:({directory,filename})=>string})` | `string` |
| `readWindowBounds({store:BoundsStorePort,key})` | `WindowBounds|null` |
| `writeWindowBounds({store,key,bounds:WindowBounds})` | `void` |
| `boundsOnScreen({bounds,displays:readonly DisplayLike[]}, optional = {minOnscreenPx?})` | `boolean` |
| `resolveWindowBounds(required:ResolveWindowBoundsInput, optional = {minOnscreenPx?})` | `Partial<WindowBounds>` |
| `restoreWindowBounds({store,display:DisplayPort,key,fallback:{width,height}}, optional = {minOnscreenPx?})` | `Partial<WindowBounds>` |

Find query is `{text:string,forward:boolean,findNext:boolean}`; result `{activeMatchOrdinal:number,matches:number}`. IPC resolves the calling window and delegates find/clear-selection; host owns channel authorization. Relay source supplies found-in-page subscription, send and optional removal. Menu click callbacks receive `{window}`; native menu adapters translate this shape.

Spelling params carry `isEditable,misspelledWord,dictionarySuggestions:string[]` and `editFlags:{canCut,canCopy,canPaste,canSelectAll}`. Labels supply no-suggestions/add-to-dictionary/cut/copy/paste/select-all copy; handlers receive `{word}` for replace/add, no arguments for edit operations. Menu builder receives `{template}` and returns `{popup():void}`.

Bounds are `{x,y,width,height}:number`; display is `{bounds}`. Store methods `read({key}):unknown`, `write({key,bounds}):void`; display port `getAllDisplays():readonly DisplayLike[]`. Resolve input has `{stored:WindowBounds|null,displays,fallback:{width,height}}`.

```ts
import { findMenu, zoomMenuItems } from '@jini-ai/desktop-host/electron/usability';
const find = findMenu({ channel:'app:find', labels:{menu:'Search',item:'Find in page'} });
const zoom = zoomMenuItems({ channel:'app:zoom', labels:{reset:'Actual size',in:'Zoom in',out:'Zoom out'} });
// Consumer mounts descriptors through its native Menu binding.
```

## `/speech`

| Current signature | Return |
|---|---|
| `unavailablePort({reason,message:({reason})=>string})` | `TranscriptionPort` |
| `resolveTranscriptionPort({ platform, createMacPort, messages }: ResolveTranscriptionPortDeps)` | `TranscriptionPort` |
| `float32ToInt16Pcm({samples:Float32Array})` | `Int16Array` |
| `buildWavHeader({sampleCount:number,sampleRate:number})` | `Buffer` |
| `encodeMonoWav({samples:Float32Array|number[],sampleRate:number})` | `Buffer` |
| `speechChannels({channelNamespace})` | `{isAvailable:string,transcribe:string}` |
| `registerSpeechIpc(required:RegisterSpeechIpcArgs, optional = {maxSamples?})` | `() => void` |
| `createSpeechBridge({ipcRenderer:SpeechRendererIpcPort,channelNamespace})` | `SpeechBridge` |
| `exposeSpeechBridge({contextBridge,ipcRenderer,channelNamespace,globalName})` | `void` |

Constants: `WAV_HEADER_BYTES=44`, `MAX_TRANSCRIBE_SAMPLES=14400000`. Port: `isAvailable():Promise<{available:boolean,reason?:string}>`; `transcribe({wavBuffer:Buffer}):Promise<{text:string,elapsedMs:number}>`. Selection requires `{platform,createMacPort:()=>TranscriptionPort,messages:TranscriptionMessages}`; unsupported platform/message formatters are supplied by the consumer.

Speech IPC requires `{ipcMain:SpeechIpcPort,port,channelNamespace,isTrustedSender:({senderUrl})=>boolean,messages:SpeechIpcMessages}`. Messages supply sender refusal/invalid rate/invalid samples/missing guard and `{maxSamples}` formatter. IPC port registers object-bound handlers with `{event,samples?,sampleRate?}` and optional handler removal. Trust event uses `senderFrame.url`.

Renderer IPC invokes `({channel}, optional?:{args?:unknown[]})=>Promise<unknown>`. Bridge methods `isAvailable()` and `transcribe({samples:Float32Array|readonly number[],sampleRate:number})` return the port result types. Context bridge exposes `{name,bridge}`. Payload `[samples,sampleRate]` retains positional native wire shape behind these object APIs. Bundle the bridge into a sandboxed preload; it is not a microphone-capture component.

```ts
import { createSpeechBridge } from '@jini-ai/desktop-host/speech';
const speech = createSpeechBridge({ ipcRenderer, channelNamespace:'app:speech' });
const availability = await speech.isAvailable();
```

## `/speech/macos` and native source asset

| Current signature | Return |
|---|---|
| `ensureHelperCompiled(required:CompileDeps)` | `CompileResult = {ok:true}|{ok:false,error:string}` |
| `parseHelperJson({stdout,invalidOutput:MacTranscriberMessages['invalidOutput']})` | `HelperPayload` |
| `checkAvailability(required:AvailabilityDeps)` | `Promise<TranscriptionAvailability>` |
| `transcribeWav(required:MacTranscriberDeps & {wavBuffer:Buffer})` | `Promise<TranscriptionResult>` |
| `createMacOnDeviceTranscriptionPort(required:MacTranscriberDeps)` | `TranscriptionPort` |

Compile dependencies: `{fs,spawnSync:({command,args:string[]})=>SpawnResult,sourcePath,binaryPath,compilerPath,messages:MacTranscriberMessages}`. FS needs object-bound exists/mkdir, plus write/remove for transcription. Availability adds `{locale,execFileAsync:({file,args:string[]})=>Promise<{stdout:string}>}`. Transcription adds `tempFilePath:()=>string`; caller must supply collision-free scratch names. Messages supply compiler-missing, compiler-failed `{stderr}`, invalid-output `{stdout}`, cannot-transcribe `{reason}`, recognition-failed `{reason}`. `SpawnResult` has `status:number|null`, optional `stderr:Buffer|string` and Node error.

`HelperPayload` is an object with optional availability/reason/ok/text/elapsed/error fields; parsing alone validates object shape, while availability/transcription validate relevant fields. The Swift asset has no exported TypeScript signature: consumers locate the source, compile it through their process adapter, then invoke `check <locale>` or `transcribe <audio-path> <locale>`. It emits JSON to stdout and exits 0 for successful commands/unavailable checks, 1 for transcription failures, 2 for usage failures.

```ts
import { createMacOnDeviceTranscriptionPort } from '@jini-ai/desktop-host/speech/macos';
const port = createMacOnDeviceTranscriptionPort({ fs, spawnSync, execFileAsync, sourcePath, binaryPath,
  compilerPath, locale:'en-US', messages, tempFilePath });
const available = await port.isAvailable();
```

```ts
import { fileURLToPath } from 'node:url';
const sourcePath = fileURLToPath(import.meta.resolve('@jini-ai/desktop-host/speech/macos/speech-helper.swift'));
// Supply sourcePath to the compiler adapter; the asset is not imported as JavaScript.
```

## Evidence and remaining boundary

Additional public type names for the shapes described above:

| Definition group | Exported names |
|---|---|
| [Bridge](../../src/bridge.ts) | `JiniHostClient`, `JiniHostUpdaterNamespace` |
| [Render options](../../src/render-service.ts) / [dialog](../../src/shell.ts) | `RenderViewport`, `RenderResourcePolicy`, `RenderOptions`, `PdfMargins`, `OpenFolderDialogOptions` |
| [Electron native bindings](../../src/electron/electron-surfaces.ts) | `ElectronNavigationEvent`, `ElectronBeforeRequestDetails`, `ElectronBeforeRequestCallback`, `ElectronWebRequestLike`, `ElectronSessionLike`, `ElectronWebContentsLike`, `ElectronProtocolPrivileges`, `ElectronOpenDialogOptions` |
| [Tauri native bindings](../../src/tauri/tauri-surfaces.ts) | `TauriWindowCreateOptions`, `TauriFileInfo`, `TauriOpenDialogOptions`, `TauriChildProcessLike` |
| [Navigation](../../src/electron/navigation-policy/window-navigation-policy.ts) / [guest admission](../../src/electron/navigation-policy/webview-guest-policy.ts) | `AppWindowPolicyOptions`, `GuestWindowOpenOptions`, `WindowOpenResponse`, `GuestPolicyOptions`, `GuestSourceOptions` |
| [Update timers](../../src/electron/updates/auto-update-controller.ts) | `UpdateTimer` |
| [Find IPC](../../src/electron/usability/find-in-page-ipc.ts) / [Find menu](../../src/electron/usability/find-menu.ts) | `FindInPageQuery`, `FindInPageResult`, `FindWebContentsPort`, `FindResultSource`, `FindMenuItem` |
| [Speech IPC](../../src/speech/speech-ipc.ts) / [native dependencies](../../src/speech/macos/mac-on-device-transcriber.ts) | `SpeechIpcEvent`, `TranscriberFs` |

Every declared export-map subpath has a source contract above, including deliberately unsupported Tauri capabilities and public fakes. Full exported structural declarations live in the linked source modules, [root barrel](../../src/index.ts), [Electron barrel](../../src/electron/index.ts), [Tauri barrel](../../src/tauri/index.ts), [usability barrel](../../src/electron/usability/index.ts), and [speech barrel](../../src/speech/index.ts). This documents source contracts, not built output or tarball availability.

Native navigation registrations use `ElectronNavigableContents`: `setWindowOpenHandler(handler)`, `on('will-navigate', (event, url) => void)` and `on('will-redirect', details => void)`. `NavigableContents` is the union with `LegacyNavigableContents`; the latter retains the old object-bound registration ABI. Both enforce the same origin and scheme decisions. Zero-input getters remain parameterless; scope-aware bridge functions still accept their real optional scope and retain their optional-object defaults.

AutoUpdateControllerEffects contains the required platform/presence/user-prompt/quit/log effects. LegacyUpdaterLike retains the old object event/install ABI; ElectronUpdater is the native event/payload/install ABI, and UpdaterLike is their union. UpdateTimersPort uses setTimeout/setInterval({callback,ms}) and clear({timer}). Both adapter forms remain callable; the preferred controller uses core Clock and options in argument two.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `UpdateMessages`, `UpdateTiming` | interface; [auto-update-controller.ts](../../src/electron/updates/auto-update-controller.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./bridge-testing`, `./electron`, `./tauri`, `./shutdown`, `./electron/navigation-policy`, `./electron/updates`, `./node-toolchain`, `./electron/usability`, `./speech`, `./speech/macos`, `./speech/macos/speech-helper.swift`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
