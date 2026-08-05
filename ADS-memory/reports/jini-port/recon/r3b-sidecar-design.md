# R3b — Jini Sidecar + Desktop-Host Layer Design

Companion to `r3-sidecar.md`. Design for a fresh "Jini" repo extracting OD's
sidecar/desktop architecture into a product-agnostic engine + swappable adapter.
**[V] = verified against OD source, [I] = inferred/proposed design.**

Guiding principle from recon: *anything that takes a `contract` argument today is
engine; anything that IS a constant string is adapter.* OD already drew this line
right — Jini just renames the generic packages and formalizes the host seam.

---

## 1. `@jini/sidecar` and `@jini/platform` package specs

### 1a. `@jini/platform` — verbatim lift of `@open-design/platform`
Source of truth: `packages/platform/src/{index,process,command,fs,http,proxy-env,toolchain}.ts`.
**Lift 1:1. No OD strings exist in this tree [V — grep empty].** Public surface:

- Stamp codec (generic over `ProcessStampContract`): `createProcessStampArgs`,
  `readProcessStamp`, `readProcessStampFromCommand`, `readFlagValue`,
  `matchesProcessStamp`, `matchesStampedProcess`.
- Process lifecycle: `spawnBackgroundProcess`, `spawnLoggedProcess`,
  `isProcessAlive`, `waitForProcessExit`, `listProcessSnapshots`,
  `collectProcessTreePids`, `stopProcesses`.
- `createCommandInvocation`, `createPackageManagerInvocation`.
- fs: `atomicCopyFile`, `pathContains`, `readLogTail`, `removePathBestEffort`.
- `waitForHttpOk`; `wellKnownUserToolchainBins`; proxy-env helpers.

Parameterization needed: **none.** The `ProcessStampContract`
(`process.ts` l.22-30) is `{ normalizeStamp, normalizeStampCriteria, stampFields,
stampFlags }` — already product-supplied. Windows `Get-CimInstance` / POSIX `ps`
are OS-generic. **Rename package only.**

### 1b. `@jini/sidecar` — verbatim lift of `@open-design/sidecar`
Source: `packages/sidecar/src/{index,types,paths,bootstrap,json-ipc,ipc-path,port,json-file,net}.ts`.
**Lift 1:1. No OD strings [V].** Public surface (unchanged names):
`SidecarContractDescriptor`, `SidecarRuntimeContext`, all `resolve*` path helpers,
`bootstrapSidecarRuntime`, `createSidecarLaunchEnv`, `createJsonIpcServer`,
`requestJsonIpc`, `allocatePort`, json-file/pointer helpers, `normalizeIpcPath`,
`isWindowsNamedPipePath`.

Parameterization needed: **none in code** — every OD-ism enters via the descriptor
argument. The one thing to *document* for non-Node hosts: `json-ipc.ts` is Node
`net`; its wire format (not its impl) is the cross-language contract (see §2b).

### 1c. OD-identity strings that MUST live in the product descriptor (not engine)
All currently in `packages/sidecar-proto/src/index.ts` [V]. These are the entire
"adapter" — Jini's product supplies them:

| Category | OD value | Descriptor field |
|---|---|---|
| App keys | `{daemon, desktop, web}` | `normalizeApp` + app-key set |
| Modes | `{dev, runtime}` | `normalizeStamp` mode domain |
| Sources | `{packaged, tools-dev, tools-pack}` | `normalizeSource` |
| Env var names | `OD_PORT`, `OD_SIDECAR_*`, `OD_WEB_*` | `env.{base,ipcBase,ipcPath,namespace,source}` |
| Stamp flags | `--od-stamp-{app,mode,namespace,ipc,source}` | `stampFlags` |
| Defaults | `ipcBase=/tmp/open-design/ipc`, `windowsPipePrefix=open-design`, `projectTmpDirName=.tmp`, `host=127.0.0.1` | `defaults` |
| Message catalogue | `SIDECAR_MESSAGES` + all DTOs/validators | product IPC contract (NOT engine) |
| Product name | `"Open Design"` | product const |

### 1d. Exact `SidecarContractDescriptor` a product supplies
This is the seam. Engine functions are all generic over `<TStamp extends
SidecarStampShape>` and take one of these [V, `sidecar/src/types.ts` l.24-43]:

```ts
type SidecarStampShape = { app: string; ipc: string; mode: string; namespace: string; source: string };

interface SidecarContractDescriptor<TStamp extends SidecarStampShape = SidecarStampShape> {
  defaults: {
    host: string;              // "127.0.0.1"
    ipcBase: string;           // posix socket root, e.g. "/tmp/<product>/ipc"
    namespace: string;         // "default"
    projectTmpDirName: string; // ".tmp"
    windowsPipePrefix: string; // "<product>"
  };
  env: {                       // env var NAMES the runtime reads/writes
    base: string;              // "<PRODUCT>_SIDECAR_BASE"
    ipcBase: string;           // "<PRODUCT>_SIDECAR_IPC_BASE"
    ipcPath: string;           // "<PRODUCT>_SIDECAR_IPC_PATH"
    namespace: string;         // "<PRODUCT>_SIDECAR_NAMESPACE"
    source: string;            // "<PRODUCT>_SIDECAR_SOURCE"
  };
  normalizeApp(app: unknown): TStamp["app"];
  normalizeNamespace(namespace: unknown): string;
  normalizeSource(source: unknown): TStamp["source"];
  normalizeStamp(input: unknown): TStamp;
}
```
For the process layer the product also supplies the sibling `ProcessStampContract`
`{ normalizeStamp, normalizeStampCriteria, stampFields, stampFlags }`. In OD one
frozen object (`OPEN_DESIGN_SIDECAR_CONTRACT`) satisfies both — Jini keeps that
convention: **one product contract object, threaded everywhere.**

---

## 2. `@jini/desktop-host` — host-adapter interface (host-agnostic)

New small package. Formalizes what ANY shell (Electron, Tauri, headless, a test
double) must implement to be a `desktop`-app peer in a namespace. It is a
*contract + thin TS helpers built on `@jini/sidecar`*, plus a written wire spec so
a non-Node host can conform.

### 2a. The host-adapter interface

```ts
interface JiniDesktopHost<TStamp extends SidecarStampShape = SidecarStampShape> {
  /** The runtime context resolved from the argv stamp + env (via bootstrapSidecarRuntime). */
  readonly runtime: SidecarRuntimeContext<TStamp>;

  /** Discover a peer sidecar's advertised URL over IPC (poll STATUS on its socket).
   *  Used to find the WEB url to load into the shell's webview. Returns null if peer down. */
  discoverPeerUrl(app: string, opts?: { timeoutMs?: number }): Promise<string | null>;

  /** Send one typed message to a peer's IPC socket and await its result. Generic
   *  request path; discoverPeerUrl and registerWithBackend are built on it. */
  requestPeer<T>(app: string, message: unknown, opts?: { timeoutMs?: number }): Promise<T>;

  /** Stand up THIS host's own IPC server at resolveAppIpcPath(desktop, ns).
   *  Handlers is a message-type→handler map; the server MUST answer status+shutdown
   *  even if it answers nothing else. Returns a closable handle. */
  serveHostIpc(handlers: HostIpcHandlers): Promise<{ close(): Promise<void> }>;

  /** OPTIONAL security handshake: send a per-process secret to the BACKEND (daemon)
   *  app so privileged flows (folder import) can be token-gated. No-op hosts skip it. */
  registerWithBackend?(secret: Uint8Array | string): Promise<{ accepted: true }>;
}

type HostIpcHandlers = {
  status(): HostStatus | Promise<HostStatus>;   // REQUIRED
  shutdown(): void | Promise<void>;              // REQUIRED (ack, then tear down)
  [messageType: string]: (input: unknown) => unknown | Promise<unknown>; // optional caps
};

type HostStatus = {
  pid?: number | null;
  state: "idle" | "running" | "unknown";
  url?: string | null;      // the web URL the shell is showing (echoes discovery)
  updatedAt?: string;
  windowVisible?: boolean;  // shells with a window set this; headless omits
};
```

Provided helpers (thin, built on `@jini/sidecar`, so hosts don't re-derive):
`resolveHostRuntime(argv, env, contract)` → wraps `readProcessStamp` +
`bootstrapSidecarRuntime`; `createDesktopHost(runtime, contract)` returns a
`JiniDesktopHost` whose `discoverPeerUrl/requestPeer/serveHostIpc` are
`resolveAppIpcPath` + `requestJsonIpc` + `createJsonIpcServer`.

### 2b. IPC message envelope (the wire contract) [V — json-ipc.ts]
- Transport: **newline-delimited JSON, one request frame per connection**, over a
  unix domain socket (POSIX) or named pipe (Windows).
- Request frame: `<json>\n` where json is `{ "type": string, "input"?: object }`.
- Response frame (server writes then `end()`): `<json>\n`, exactly one of:
  - `{ "ok": true,  "result": <any> }`
  - `{ "ok": false, "error": { "message": string, "code"?: string } }`
- UTF-8 must be decoded across chunk boundaries (StringDecoder-equivalent) — a
  multibyte char can split across TCP reads. [V — json-ipc.ts l.163-168]
- Client default timeout 1500ms; long ops (render/export) use up to 600_000ms.
- Server MUST unlink a stale POSIX socket before bind; named pipes are re-bindable.

Two universal messages every host answers:
- `{"type":"status"}` → `{ok:true, result: HostStatus}`
- `{"type":"shutdown"}` → `{ok:true, result:{accepted:true}}` then exit.

### 2c. Stamp-argv contract [V — platform/process.ts + sidecar-proto]
- Every sidecar process is launched carrying its stamp as `--<prefix>-stamp-<field>=<value>`
  argv, one per field, fields = `["app","mode","namespace","ipc","source"]` (fixed
  set, exactly 5).
- On startup the process decodes via `readProcessStamp(process.argv.slice(2),
  contract)` and MUST reject if any field is missing/invalid (null → throw).
- `bootstrapSidecarRuntime` then asserts `stamp.app === expectedApp` and
  `stamp.ipc === resolveAppIpcPath(...)`, and writes canonical env back. A host
  that mis-derives its own ipc path fails fast here. [V — bootstrap.ts l.57-96]

### 2d. Socket-path formula [V — sidecar/paths.ts l.242-257]
Pure function of `(namespace, app, platform)`; no registry, no discovery service:
- **win32:** `\\.\pipe\<windowsPipePrefix>-<namespace>-<app>`
- **posix:** `<ipcBase>/<namespace>/<app>.sock`  (ipcBase from env
  `<PRODUCT>_SIDECAR_IPC_BASE` or the `defaults.ipcBase`)
- `namespace`/`app` are normalized (charset-validated) before interpolation.
Any process (Node, Rust, Go…) that knows the namespace + the product's prefix/base
can compute a peer address. **This is the whole "discovery" mechanism.**

---

## 3. Electron adapter — how apps/desktop maps today (reference impl)

`apps/desktop` IS the reference `JiniDesktopHost` implementation. Mapping:

| Interface member | OD implementation | Reuse vs Electron |
|---|---|---|
| `resolveHostRuntime` | `index.ts` l.943-950 `readProcessStamp` + `bootstrapSidecarRuntime` | **reused engine** |
| `discoverPeerUrl("web")` | `createWebDiscovery` l.200-210 (`resolveAppIpcPath`+`requestJsonIpc` STATUS) | **reused engine** |
| `requestPeer` | `requestJsonIpc` throughout | **reused engine** |
| `serveHostIpc(handlers)` | `createJsonIpcServer` l.782-838; handlers = status/shutdown + eval/screenshot/console/click/export-pdf/render-slides/export-artifact/update | engine server; **handlers are Electron-only** |
| `registerWithBackend` | `registerDesktopAuthWithDaemon` l.573-605 (sends base64 secret to daemon socket) | **reused engine** transport, OD-specific message |
| load web URL into shell | `runtime.ts` `BrowserWindow.loadURL(discoverUrl())` | **Electron-only** |
| `HostStatus.windowVisible` | `desktopStatusSnapshot` | Electron-only |

Electron-only surface (does NOT belong in `@jini/desktop-host`): `BrowserWindow`,
`app`, `dialog`, `ipcMain`, `nativeImage`, `screen`, `session`, `shell`, menus,
splash windows, window-chrome CSS, updater, deck/PDF/artifact capture via Chromium
(`runtime.ts` l.9; `pdf-export.ts`; `deck-capture.ts`; `artifact-export.ts`).
The render/export handlers are the Electron-locked *capability set* → model as a
port (§5).

`apps/packaged/src/headless.ts` is a **second, minimal reference impl** [V]:
a `desktop`-app peer that answers ONLY `status` (returning the web url) and
`shutdown` — no window, no Electron. Proof that the interface's required surface is
just those two messages.

---

## 4. TAURI experiment spec (low priority, concrete)

Goal: a Tauri (Rust) process acts as the `desktop` app in a Jini namespace,
loading the web URL into a native webview, without Electron.

### 4a. Contract surface the Tauri host MUST speak
1. **Stamp argv (read):** parse `--<prefix>-stamp-app=desktop`,
   `--<prefix>-stamp-mode`, `--<prefix>-stamp-namespace`, `--<prefix>-stamp-ipc`,
   `--<prefix>-stamp-source` from `std::env::args()`. (Or receive namespace via env
   `<PRODUCT>_SIDECAR_NAMESPACE` when the orchestrator sets it.)
2. **Socket path (derive):** compute peer + self paths with the §2d formula.
   POSIX `UnixStream`/`UnixListener`; Windows named pipe via `tokio::net::windows`.
3. **Discover web URL:** connect to `web.sock`, write `{"type":"status"}\n`, read
   one line, parse `{ok:true,result:{url}}`, `WebviewWindow::navigate(url)`.
4. **Serve host IPC:** listen on `desktop.sock`; answer:
   - `{"type":"status"}` → `{"ok":true,"result":{"pid":…,"state":"running","url":…}}`
   - `{"type":"shutdown"}` → `{"ok":true,"result":{"accepted":true}}` then exit.
   - unknown/optional types → `{"ok":false,"error":{"message":"unsupported","code":"UNKNOWN_MESSAGE"}}`.
5. **(Optional) registerWithBackend:** at startup connect to `daemon.sock`, send
   `{"type":"register-desktop-auth","input":{"secret":"<base64>"}}`. Skip → the
   backend's import-folder gate stays dorment (exactly what headless.ts does).

### 4b. What Tauri reimplements in Rust (engine has no Rust build)
- NDJSON IPC client + server (§2b envelope, UTF-8-safe line framing) — ~80 LOC.
- Stamp argv parse (§2c) + socket-path formula (§2d) — pure, ~40 LOC.
- Process self-stamp / stop is not needed on the shell side (the ORCHESTRATOR that
  spawns Tauri owns spawn/stop — reuse `@jini/platform` from the Node launcher).
- Status/shutdown handlers + `WebviewWindow` navigation — Tauri APIs.

### 4c. Render/export degradation strategy
Tauri's native webview cannot match Chromium's `printToPDF`/`nativeImage` deck
capture. Two supported modes:
- **Degrade (v0):** Tauri host does NOT register `export-pdf`/`render-slides`/
  `export-artifact` handlers → they return `UNKNOWN_MESSAGE`; the daemon's export
  paths surface "export unavailable in this shell." Web-side canvas export
  (already client-side for WebP/image) still works.
- **Delegate (v1):** route those messages to a **headless-Chromium `RenderService`
  sidecar** (Puppeteer/Playwright or `chrome --headless`), spawned like
  `apps/packaged` spawns other sidecars. The daemon calls the RenderService port
  (§5) instead of caring whether the pixels came from Electron or headless Chrome.
  Reuse OD's `deck-capture` HTML→section logic conceptually.

### 4d. Minimal milestones to a Tauri shell loading the web URL
1. **M0 — Node orchestrator spawns Tauri as the `desktop` peer.** Extend a Jini
   launcher (Node, reusing `@jini/platform`) to spawn the Tauri binary with the
   5-field stamp argv + `<PRODUCT>_SIDECAR_*` env, alongside daemon+web. (Prove
   daemon+web come up headless first via a headless.ts equivalent.)
2. **M1 — Rust: parse stamp + derive socket paths.** Unit-test against known
   `(namespace, app)` → path vectors from the TS formula.
3. **M2 — Rust: NDJSON IPC client.** Connect to `web.sock`, STATUS, print the url.
   (This alone validates cross-language wire compat.)
4. **M3 — Rust: load url in a `WebviewWindow`.** First pixels — the "hello Jini in
   Tauri" milestone.
5. **M4 — Rust: NDJSON IPC server on `desktop.sock`** answering status+shutdown;
   confirm the orchestrator can poll + cleanly stop it.
6. **M5 — (optional) registerWithBackend** handshake to unlock folder import.
7. **M6 — (optional) delegate render/export to a headless-Chromium RenderService.**
M0-M4 = "Tauri shell loads the web URL." M5-M6 = feature parity.

---

## 5. Modeling the bidirectional render/export coupling as a port

Today the daemon calls BACK into the desktop (Electron Chromium) for
PDF/deck/PPTX/image [V]. Crucially, **OD already has the seam** — the daemon does
not import Electron; it receives three async callbacks injected at startup:
`startDaemonRuntime({ desktopPdfExporter, desktopSlideRenderer,
desktopArtifactExporter, ... })` (`apps/daemon/src/sidecar/server.ts` l.122-159),
each of which is just `requestJsonIpc(desktopIpc, {type, input}, {timeoutMs:600_000})`.
So the daemon is already decoupled at the type level; it's only *convention* that
the endpoint answering is Electron.

### Recommended: a first-class `RenderService` port
Promote those three callbacks into one named engine port so no layer is
Electron-locked:

```ts
interface RenderService {
  exportPdf(input: ExportPdfInput): Promise<ExportPdfResult>;
  renderSlides(input: RenderSlidesInput): Promise<RenderSlidesResult>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  // capability probe so callers can degrade instead of timing out:
  capabilities(): { pdf: boolean; slides: boolean; artifact: boolean };
}
```
The daemon depends on `RenderService` only. Interchangeable impls:

- **`ipcRenderService(desktopIpc)`** — the current behavior: forwards each call
  over NDJSON to whatever `desktop` peer is up. Works for BOTH Electron and Tauri
  hosts that advertise the capability; unaware of which Chromium is behind it.
- **`electronChromiumRenderService`** — lives IN the Electron host as the handler
  set (today's `runtime.ts` capture code). Registered via `serveHostIpc`.
- **`headlessChromiumRenderService`** — a standalone sidecar (Puppeteer/Playwright/
  `chrome --headless`) for Tauri/Linux-server/CI where no Electron window exists.
  Same message types, different engine.
- **`noopRenderService`** — returns `{ok:false, code:"UNSUPPORTED"}`; the daemon's
  export routes surface a clean "unavailable in this shell" instead of hanging.

### Placement
- `RenderService` interface + `ipcRenderService` + `noopRenderService` → engine
  (`@jini/desktop-host` or a sibling `@jini/render`), since they're transport-only.
- `electronChromiumRenderService` → the Electron adapter package.
- `headlessChromiumRenderService` → its own optional sidecar package, shared by any
  host lacking Chromium.

This keeps the daemon (backend) render-agnostic, lets Electron stay the
high-fidelity default, and gives Tauri a concrete non-degraded path without ever
importing Electron. The `capabilities()` probe is the new bit vs today — it turns
the implicit "hope the desktop answers" into an explicit degrade decision.

---

## Key citations
- Engine (lift): `packages/sidecar/src/*`, `packages/platform/src/*` (no OD strings, verified).
- Adapter (all OD strings): `packages/sidecar-proto/src/index.ts`.
- Host reference impls: `apps/desktop/src/main/index.ts` (full), `apps/packaged/src/headless.ts` (minimal, status+shutdown only).
- Render port seam already present: `apps/daemon/src/sidecar/server.ts` l.122-159 (three injected exporter callbacks) + `apps/daemon/src/daemon-startup.ts` `startDaemonRuntime` options.
- Socket formula: `packages/sidecar/src/paths.ts` l.242-257. Wire format: `packages/sidecar/src/json-ipc.ts`. Stamp argv: `packages/platform/src/process.ts` l.75-134.
