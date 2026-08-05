# R3 — Sidecar + Desktop-Shell Architecture Recon (for "Jini" engine extraction)

Repo: `/Users/la/Desktop/Programming/OSS-Repos/open-design` (read-only).
Method: read the three packages' source + the desktop/packaged/daemon sidecar
entries. **[V] = verified in source, [I] = inferred.**

---

## 0. TL;DR of the shape

OD runs N cooperating processes ("sidecars") in one namespace: **daemon** (the
real backend / HTTP API), **web** (Next.js server that proxies `/api/*` to the
daemon), and **desktop** (the Electron shell + a headless automation/export
service). They find each other over **newline-delimited JSON over a unix
socket / Windows named pipe**, keyed by a filesystem path derived purely from
`(namespace, app)`. Every process is launched carrying a 5-field **stamp** on
its argv so orchestrators can find/stop it. The desktop shell is a *thin
consumer* of this bus — it discovers the web URL over IPC and loads it into a
`BrowserWindow`. The bus itself (`@open-design/sidecar` + `@open-design/platform`)
has **zero Electron dependency** [V — grep of both `src/` trees returns nothing].

---

## 1. The three-way package split

### `@open-design/sidecar-proto` — the OD-SPECIFIC business contract
File: `packages/sidecar-proto/src/index.ts` (933 lines, single file). Depends on
`@open-design/release` only. **This is the OD tilt.** It hardcodes:

- **App identity** [V]: `APP_KEYS = {daemon, desktop, web}` (l.3). The whole
  three-process topology is nailed here.
- **Env var names** [V]: `SIDECAR_ENV` — `OD_PORT`, `OD_SIDECAR_NAMESPACE`,
  `OD_SIDECAR_IPC_PATH`, `OD_WEB_PORT`, `OD_WEB_DIST_DIR`, `OD_DAEMON_CLI_PATH`…
  (l.26-38). All `OD_`-prefixed.
- **Stamp flag names** [V]: `--od-stamp-app/mode/namespace/ipc/source` (l.48-54).
- **Defaults** [V]: `ipcBase = "/tmp/open-design/ipc"`, `windowsPipePrefix =
  "open-design"`, `projectTmpDirName = ".tmp"`, `host = 127.0.0.1` (l.64-70).
- **The message protocol** [V]: `SIDECAR_MESSAGES` (l.83-97) — `status`,
  `shutdown`, `eval`, `screenshot`, `console`, `click`, `export-pdf`,
  `render-slides`, `export-artifact`, `update`, `register-desktop-auth`,
  `mint-import-token`. Plus every request/result DTO (`DesktopRenderSlidesInput`,
  `DesktopExportPdfResult`, the entire updater snapshot tree, etc.) and the
  per-app message unions `DaemonSidecarMessage` / `WebSidecarMessage` /
  `DesktopSidecarMessage` (l.531-548) with runtime validators
  `normalize*SidecarMessage` (l.850-912).
- **The concrete contract object** [V]: `OPEN_DESIGN_SIDECAR_CONTRACT` (l.914-933),
  a frozen struct bundling defaults+env+messages+modes+sources+normalizers. This
  is the single value threaded into every generic function below.
- Windows product-name / uninstall-registry helpers (`Open Design`) (l.72-81).

Verdict: **sidecar-proto is the OD adapter.** ~60% of it (all the Desktop*
export/render/updater DTOs) is not even generic "shell" concern — it's OD's
deck/artifact/auto-update feature protocol.

### `@open-design/sidecar` — the GENERIC runtime
Files: `packages/sidecar/src/{types,paths,bootstrap,json-ipc,ipc-path,port,json-file,net}.ts`.
**No OD strings anywhere** — everything OD-specific arrives as a
`SidecarContractDescriptor<TStamp>` argument [V, `types.ts` l.24-43]. Provides:

- **`SidecarContractDescriptor`** [V]: the host-supplied interface — `defaults`,
  `env` var names, and `normalizeApp/Namespace/Source/Stamp`. This is the seam.
- **Path resolution** (`paths.ts`) [V]: namespace/base/runtime-root/pointer/
  manifest/log/app-dir resolvers, all parameterized on the contract. IPC path =
  `resolveAppIpcPath`: `\\.\pipe\<prefix>-<ns>-<app>` on win32, else
  `<ipcBase>/<ns>/<app>.sock` (l.242-257). Note it branches on
  `process.platform` — a Node assumption, not Electron.
- **`bootstrapSidecarRuntime`** (`bootstrap.ts`) [V]: takes an incoming stamp +
  `process.env`, validates app match + ipc-path match, writes canonical env back,
  returns a live `SidecarRuntimeContext`. `createSidecarLaunchEnv` composes the
  child env. Pure Node.
- **`createJsonIpcServer` / `requestJsonIpc`** (`json-ipc.ts`) [V]: the actual
  transport. NDJSON, one frame per connection, `{ok,result}` / `{ok:false,error}`
  envelope, UTF-8 `StringDecoder` across chunk boundaries, stale-socket unlink,
  1500ms default client timeout. Depends only on `node:net/fs/path/string_decoder`.
- `allocatePort`, `readJsonFile`/`writeJsonFile`/pointer helpers.

Verdict: **generic. Reusable as-is for any host shell that speaks Node.** The
only host-portability caveat is that the *transport is Node's `net` module*.

### `@open-design/platform` — GENERIC OS primitives
Files: `packages/platform/src/{process,command,fs,http,proxy-env,toolchain}.ts`.
No OD strings; process-stamp functions are generic over a `ProcessStampContract`
[V, `process.ts` l.22-30]. Provides:

- **Stamp codec** [V]: `createProcessStampArgs` (encode stamp → `--flag=value`
  argv), `readProcessStamp` (decode argv → stamp), `matchesStampedProcess`
  (l.75-189). Generic over the contract's `stampFields`/`stampFlags`.
- **Process lifecycle** [V]: `spawnBackgroundProcess`/`spawnLoggedProcess`
  (node `child_process`), `isProcessAlive`, `listProcessSnapshots` (POSIX `ps` /
  Windows `Get-CimInstance`), `collectProcessTreePids`, `stopProcesses`
  (SIGTERM→SIGKILL escalation).
- `createCommandInvocation`, `waitForHttpOk`, filesystem containment/atomic-copy,
  system-proxy discovery, toolchain-bin discovery.

Verdict: **fully generic OS layer.** Uses `process.platform` + node built-ins,
never Electron.

**So the split is clean: proto = OD business contract (the adapter); sidecar +
platform = generic engine.** The generic layer already proves it — the daemon
sidecar entry (`apps/daemon/src/sidecar/index.ts`) is only 24 lines and just
wires `OPEN_DESIGN_SIDECAR_CONTRACT` into the generic `readProcessStamp` +
`bootstrapSidecarRuntime` + `createJsonIpcServer` [V].

---

## 2. Desktop discovery of web URL / daemon, and Electron assumptions

### The three sidecar entrypoints (all identical shape) [V]
- **daemon**: `apps/daemon/src/sidecar/index.ts` → `server.ts`. Runs the real
  HTTP backend (`startDaemonRuntime` from `../daemon-startup.js`) and an IPC
  server on `runtime.ipc`. Its STATUS reply = `DaemonStatusSnapshot` incl. the
  live `url`.
- **desktop**: `apps/desktop/src/main/index.ts` bottom (`isDirectEntry()` guard,
  l.943-956). Decodes stamp → bootstraps runtime → `runDesktopMain(runtime)`.
- **web** [I]: same pattern; its STATUS reply is `WebStatusSnapshot` with `url`.

### Discovery flow (desktop → web → daemon) [V]
`createWebDiscovery(runtime)` (`index.ts` l.200-210):
```
webIpc = resolveAppIpcPath({app: WEB, contract, namespace: runtime.namespace})
web    = await requestJsonIpc<WebStatusSnapshot>(webIpc, {type: STATUS}, {timeoutMs:600})
return web?.url ?? null
```
The desktop main **never guesses ports**. It derives the *web* socket path from
its own namespace, asks the web sidecar its `url` over IPC, and loads that into
the `BrowserWindow` [V, `runtime.ts` l.9 imports `BrowserWindow`; `discoverUrl`
passed to `createDesktopRuntime` at `index.ts` l.844]. `resolveDaemonBaseUrl`
(l.217-231) prefers an explicit daemon URL, else the web URL (web proxies
`/api/*` to daemon), else web-discovery — used for diagnostics/app-config/updater.

This matches AGENTS.md "Desktop queries runtime status through sidecar IPC. The
web URL comes from tools-dev launch status, not from desktop guessing ports."

### The desktop process is BOTH shell AND a sidecar service [V]
`runDesktopMain` also *starts its own IPC server* (`index.ts` l.782-838) handling
`eval/screenshot/console/click/export-pdf/render-slides/export-artifact/update`.
So the daemon calls **back into desktop** over IPC to use Electron's Chromium as a
render/PDF/PPTX engine (`apps/daemon/src/sidecar/server.ts` l.122-159:
`desktopPdfExporter`/`desktopSlideRenderer`/`desktopArtifactExporter` →
`requestJsonIpc(desktopIpc, …)`). This is a real bidirectional coupling, not just
shell→backend.

### Where the Electron assumptions live [V]
- `apps/desktop/src/main/runtime.ts` (2829 lines) — the Electron-bound core:
  `import { BrowserWindow, app, dialog, ipcMain, nativeImage, screen, session,
  shell } from "electron"` (l.9). `BrowserWindow.loadURL`, splash windows,
  window chrome CSS, deck screenshot capture via Chromium, `nativeImage` PNG/JPEG
  encode, download save-as dialogs, pet-dock window.
- `apps/desktop/src/main/index.ts` — orchestration; imports `app`,
  `MenuItemConstructorOptions`, uses `app.getVersion()`, `app.on('before-quit')`,
  menus.
- Other Electron-bound files: `pdf-export.ts`, `deck-capture.ts`,
  `artifact-export.ts`, `updater.ts`, `splash-video.ts`, `preload.cts`,
  `open-path.ts`, `session-lifecycle.ts`.
- **The IPC/stamp/discovery glue itself is NOT Electron-bound** — it's the
  `@open-design/sidecar` + `@open-design/platform` calls at the top and bottom of
  `index.ts` (l.30-39, 200-231, 943-956). Clean seam.

### apps/packaged — the packaged Electron runtime [V]
`apps/packaged/src/sidecars.ts` (656 lines) is the packaged orchestrator that
*spawns* the daemon+web sidecars. `spawnSidecarChild` (l.444-506):
- builds a `SidecarStamp` (`mode: runtime`) [V l.458-464],
- `resolveAppIpcPath` for the child,
- `createSidecarLaunchEnv({base: runtimeRoot, contract, …})`,
- `spawn(command, [entryPath, ...createProcessStampArgs(stamp, CONTRACT)], …)`.
- Command resolution [V l.468-471]: prefers a real `node`, else
  `electronNodeCommand`, else the bundled Electron binary run with
  `ELECTRON_RUN_AS_NODE=1` (l.485). i.e. **packaged uses the Electron binary as a
  Node runtime for the daemon/web sidecars** to avoid shipping a second Node.
  That's a packaging convenience, not a protocol dependency.
- `apps/packaged/src/headless.ts` exists — packaged can run daemon+web with **no
  desktop shell at all** (`requireDesktopAuth:false`), proving the shell is
  detachable [V, l.539-548 docblock].

---

## 3. The stamp model + IPC socket paths — coupling to Electron?

### Stamp = 5 fields on argv [V]
`SIDECAR_STAMP_FIELDS = ["app","mode","namespace","ipc","source"]`
(`sidecar-proto` l.62). Serialized as `--od-stamp-app=… --od-stamp-mode=… …`
(`createProcessStampArgs`, `platform/process.ts` l.75-87). Read back on startup by
each entry via `readProcessStamp(process.argv.slice(2), CONTRACT)`.
- `app` ∈ {daemon,desktop,web}; `mode` ∈ {dev,runtime}; `source` ∈
  {packaged,tools-dev,tools-pack}; `namespace` = isolation key; `ipc` = the socket
  path (validated to equal the derived path in `bootstrapSidecarRuntime`).
Purpose: an orchestrator (`tools-dev`/`tools-pack`/`packaged`) can enumerate OS
processes (`listProcessSnapshots`) and match/stop exactly the ones belonging to a
namespace via `matchesStampedProcess` [V]. **Zero Electron content** — it's argv
+ `ps`/`Get-CimInstance`.

### IPC path derivation [V]
`resolveAppIpcPath` (`sidecar/paths.ts` l.242-257): pure function of
`(namespace, app, platform)`:
- win32: `\\.\pipe\open-design-<namespace>-<app>`
- posix: `<ipcBase>/<namespace>/<app>.sock`, `ipcBase` default
  `/tmp/open-design/ipc` (AGENTS.md: "POSIX IPC sockets are fixed at
  `/tmp/open-design/ipc/<namespace>/<app>.sock`").
Any process that knows the namespace can compute a peer's address with no
registry/discovery service. **Not coupled to Electron at all.** The coupling is
to *Node's `net` transport* (unix socket / named pipe), and to `process.platform`.

### Verdict
The stamp + IPC model is **host-shell-agnostic**. It's a generic
"spawn N labelled Node processes that talk NDJSON over local sockets" pattern.
Electron only appears as (a) *one of the apps* (`desktop`) that happens to be an
Electron program, and (b) the packaged trick of running the Electron binary as
Node for the non-UI sidecars.

---

## 4. TAURI question — reuse vs reimplement

Tauri's host is a **Rust** process; it does not run Node in-process and its
webview is OS-native (WKWebView/WebView2/WebKitGTK), not Chromium-in-Node.
Map against the current design:

### Reuse unchanged (Rust just has to *reach* it)
- **daemon + web sidecars**: still spawned as Node processes exactly as today.
  A Tauri shell spawns them the same way `apps/packaged` does (`std::process::
  Command` instead of node `spawn`), passing the same `--od-stamp-*` argv and the
  same `OD_*` env. [I, but the contract is fully data-defined so this is low-risk.]
- **The daemon HTTP API + the web URL**: unchanged. Tauri loads the discovered
  web URL into its webview — same as `BrowserWindow.loadURL`.
- **The NDJSON-over-socket protocol + stamp semantics**: unchanged as a *wire
  format*. A Rust process can trivially connect to
  `/tmp/open-design/ipc/<ns>/<app>.sock` (UnixStream) or `\\.\pipe\…`
  (named pipe) and write one JSON line to ask STATUS.

### Must reimplement in Rust (currently Node/Electron-bound)
1. **The IPC client/server** (`@open-design/sidecar`'s `requestJsonIpc` /
   `createJsonIpcServer`): these are Node `net` code. Tauri needs a tiny Rust
   equivalent — connect socket, write `{"type":"status"}\n`, read one line,
   parse envelope. ~50 lines. The *format* is reused; the *implementation* is not.
2. **Stamp encode + process spawn/stop** (`@open-design/platform`): Rust must
   build the `--od-stamp-*` argv and do SIGTERM→SIGKILL. Reimplement, but the
   flag names + field set are pure data from the contract.
3. **Path derivation** (`resolveAppIpcPath`, namespace roots): reimplement the
   `<ipcBase>/<ns>/<app>.sock` / named-pipe formula in Rust. Trivial, pure.
4. **The `desktop` render-back service** (eval/screenshot/export-pdf/
   render-slides/export-artifact): this is the hard part. Today the daemon calls
   *back into Electron's Chromium* for pixel-perfect deck→PNG/PDF/PPTX. Tauri's
   native webview **cannot** offer the same Chromium capture semantics, and Tauri
   has no `nativeImage`/`webContents.printToPDF` equivalent with the same output.
   A Tauri shell would either (a) not implement these messages (degraded — no
   deck/PDF/PPTX export), or (b) route them to a headless-Chromium/Playwright
   process instead. **This is the biggest OD-tilt in the "shell" — it assumes the
   shell is Chromium.** [V — see `apps/daemon/src/sidecar/server.ts` l.122-159 and
   `desktop/src/main/deck-capture.ts`.]
5. **Updater, menus, dialogs, splash, window chrome, pet dock**: all Electron API
   → Tauri Rust/JS APIs. Straight reimplementation, expected for any shell swap.

### Minimal contract a Tauri shell MUST implement
To be a drop-in `desktop` peer in a namespace, the Rust host must:
1. **Accept the stamp**: parse `--od-stamp-{app=desktop,mode,namespace,ipc,source}`
   from its own argv (or be handed the namespace another way).
2. **Discover the web URL**: connect to the *web* sidecar socket
   (`resolveAppIpcPath(web, ns)`), send `{"type":"status"}\n`, read
   `{"ok":true,"result":{"url":…}}`, load `url` into its webview.
3. **Serve a desktop IPC endpoint** at `resolveAppIpcPath(desktop, ns)` answering
   at least `status` and `shutdown` (envelope `{ok,result}`). This is what the
   daemon/orchestrator poll.
4. **(Optional, for full parity)** answer the render/export message set — or
   explicitly return an error so the daemon degrades gracefully. Needs a
   Chromium-capable capture backend since the native webview can't match it.
5. **(If it wants the folder-import security path)** implement
   `register-desktop-auth` (send a base64 secret to the *daemon* socket at
   startup) + honor `mint-import-token`. Otherwise skip — the daemon's gate stays
   dormant (headless mode already does this).

Everything above is spawn-config + a socket-JSON protocol; **none of it requires
Electron on the Tauri side.** The one genuine capability gap is Chromium-grade
rendering/export.

---

## 5. What belongs in `@jini/sidecar` / `@jini/desktop-host` vs an OD adapter

### `@jini/sidecar` (generic engine) — lift ~verbatim from `@open-design/sidecar`
- `SidecarContractDescriptor` seam, path resolvers, `bootstrapSidecarRuntime`,
  `createSidecarLaunchEnv`, `createJsonIpcServer`/`requestJsonIpc`, `allocatePort`,
  json-file/pointer helpers. **Already generic — zero edits needed beyond
  renaming.** [V]

### `@jini/platform` (generic OS) — lift ~verbatim from `@open-design/platform`
- Stamp codec, process spawn/stop/enumerate, command invocation, http-ready,
  fs-containment, proxy-env, toolchain. **Already generic.** [V]
  (Consider a thin `@jini/ipc-wire` doc so a *non-Node* host — Rust/Tauri — can
  reimplement `requestJsonIpc` against a written spec, since the Node impl won't
  port.)

### `@jini/desktop-host` (generic shell contract) — NEW, small
The *reusable shell-facing surface*, host-implementation-agnostic:
- The generic status/shutdown message shapes + envelope.
- A "host adapter" interface: `discoverPeerUrl(app)`, `serveHostIpc(handlers)`,
  `registerWithBackend(secret)`. Electron and Tauri each provide an impl.
- Keep the *render/export* messages OUT of the generic core (they assume
  Chromium) — model them as an **optional capability** a host may advertise.

### `@jini/<product>-sidecar-proto` (the ADAPTER) — everything OD-specific
- App keys, env var names (`OD_*` → `<PRODUCT>_*`), stamp flag names, defaults
  (`ipcBase`, pipe prefix, product name), the concrete message catalogue +
  DTOs + validators, and the frozen `CONTRACT` object.
- **All of today's `packages/sidecar-proto/src/index.ts` is this adapter.** The
  Desktop* export/render/updater DTOs are product-feature protocol, not engine.

### Rule of thumb
Anything that takes a `contract`/`SidecarContractDescriptor` argument today is
**engine** (`@jini/*`). Anything that *is* a constant string
(`"open-design"`, `OD_PORT`, `{daemon,desktop,web}`, the `SIDECAR_MESSAGES`
catalogue) is **adapter**. OD already drew this line correctly; Jini's job is to
(a) rename the generic packages, (b) split the product contract into a swappable
adapter, and (c) formalize the "host adapter" interface so Electron today and
Tauri later are two implementations of the same 3-5-point contract in §4.

---

## Key file citations
- Generic engine: `packages/sidecar/src/{index,types,paths,bootstrap,json-ipc,ipc-path}.ts`
- Generic OS: `packages/platform/src/{index,process,command}.ts`
- OD adapter/contract: `packages/sidecar-proto/src/index.ts`
- Daemon sidecar entry: `apps/daemon/src/sidecar/{index,server}.ts`
- Desktop shell entry + discovery: `apps/desktop/src/main/index.ts`
  (l.200-231 discovery, l.782-838 desktop IPC server, l.943-956 entry)
- Electron-bound core: `apps/desktop/src/main/runtime.ts` (l.9 electron import),
  `pdf-export.ts`, `deck-capture.ts`, `artifact-export.ts`, `updater.ts`
- Packaged spawner: `apps/packaged/src/sidecars.ts` (l.444-506 spawn,
  l.468-485 electron-as-node), `apps/packaged/src/headless.ts` (shell-less proof)
- Verified: no Electron dependency in `packages/sidecar` or `packages/platform`
  (grep returns nothing); desktop `package.json` is the only one depending on
  `electron@41.3.0`.
