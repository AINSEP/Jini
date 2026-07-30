# `@jini-ai/sidecar`

Process-runtime plumbing for an application that runs a long-lived helper process ("sidecar") next
to a shell or CLI. It answers the boring-but-load-bearing questions such a setup keeps asking: where
does this app's runtime directory live, what IPC socket path is safe on this platform, which TCP
port can I bind, how does the child validate the stamp its parent launched it with, and how does an
unrelated process later find the daemon that is already running. Nothing here starts an HTTP server
or knows what your sidecar actually does — it is the filesystem/IPC/port layer underneath that.

## Install

```sh
npm install @jini-ai/sidecar
```

No peer dependencies. Its one dependency is `@jini-ai/core` (installed automatically); everything
else it uses is a Node built-in.

## What you get

**Path resolution** — a namespace/project-scoped layout resolved from a caller-supplied
`SidecarContractDescriptor` (its env-var names, defaults, and normalizers) rather than from
hardcoded product constants: `resolveNamespace`, `resolveNamespaceRoot`, `resolveRuntimeRoot`,
`resolveRuntimeNamespaceRoot`, `resolveSourceRuntimeRoot`, `resolveProjectRoot`,
`resolveProjectTmpRoot`, `resolveSidecarBase`, `resolveAppRuntimeDir`, `resolveAppRuntimePath`,
`resolveLogsDir`, `resolveLogFilePath`, `resolveManifestPath`, `resolvePointerPath`.

**IPC paths** — `normalizeIpcPath` and `isWindowsNamedPipePath` (Windows named pipes vs. Unix
domain sockets), plus `resolveAppIpcPath` for the app-scoped socket path.

**JSON IPC** — `createJsonIpcServer({ socketPath, handler, maxFrameBytes, idleTimeoutMs })` and
`requestJsonIpc(socketPath, payload, { timeoutMs })`: a newline-delimited JSON request/response
channel over a local socket, with a per-frame byte cap and an idle-connection timeout.

**Port allocation** — `allocatePort({ host, label, port, reserved })`, which either honors a forced
port or finds a free dynamic one, returning `{ port, source: 'dynamic' | 'forced' }`.

**Launch and bootstrap** — `createSidecarLaunchEnv` (parent side: build the child's environment) and
`bootstrapSidecarRuntime(stamp, env, options)` (child side: validate the stamp against the expected
app via the injected contract and return a `SidecarRuntimeContext`). A stamp mismatch throws rather
than starting a sidecar that belongs to a different app.

**Local daemon registry** — a `dataDir`-scoped pointer file recording a running daemon's
URL/host/port/pid/start time, plus liveness checking: `resolveDaemonRegistryPath(dataDir)`,
`writeDaemonRegistryRecord`, `readLiveDaemonRegistryRecord` (returns `null` when the recorded pid is
gone), `removeDaemonRegistryRecordIfCurrent`, `isProcessAlive`.

**JSON file helpers** — `readJsonFile`, `writeJsonFile`, `removeFile`, `removePointerIfCurrent`.

## Usage

```ts
import {
  allocatePort,
  createJsonIpcServer,
  requestJsonIpc,
  resolveDaemonRegistryPath,
  readLiveDaemonRegistryRecord,
  writeDaemonRegistryRecord,
  type LocalDaemonRegistryRecord,
} from '@jini-ai/sidecar';

const { port } = await allocatePort({ host: '127.0.0.1', label: 'daemon' });

const registryPath = resolveDaemonRegistryPath('/var/lib/example');
const record: LocalDaemonRegistryRecord = {
  url: `http://127.0.0.1:${port}`,
  host: '127.0.0.1',
  port,
  pid: process.pid,
  startedAt: new Date().toISOString(),
};
await writeDaemonRegistryRecord(registryPath, record);

// Any other process, later — `null` when nothing is actually running.
const live = await readLiveDaemonRegistryRecord(registryPath);

const ipc = await createJsonIpcServer({
  socketPath: '/tmp/example/daemon.sock',
  handler: async (message) => ({ echo: message }),
});
const reply = await requestJsonIpc<{ echo: unknown }>('/tmp/example/daemon.sock', { ping: true });
await ipc.close();
```

The path resolvers each additionally take a `contract: SidecarContractDescriptor` describing your
app's env-var names and defaults — see `src/types.ts` for its shape before wiring those up.

## What's swappable

`SidecarContractDescriptor` is the seam, and it is why this package carries no product strings: your
app supplies its own env-var names, path defaults, and `normalizeStamp`/`normalizeApp`/
`normalizeNamespace` functions, and every path resolver plus `bootstrapSidecarRuntime` reads them
from there. `createJsonIpcServer` takes the message handler and its two safety bounds. Everything
else (socket framing, port probing, the registry record's field set and its pid-guarded removal) is
fixed concrete behavior with no injection point.

## Runtime

`jini.runtime: "node"` — uses `node:net`, `node:fs`, `node:os`, and `process`.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0,
inherited from Open Design — see the repo `NOTICE`.
