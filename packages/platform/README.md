# `@jini-ai/platform`

Generic OS/platform primitives: process exec and lifecycle, filesystem containment, HTTP
readiness polling, toolchain discovery, blob storage, AWS signing, and an SSRF-safe asset cache.
This is the Node-only substrate a daemon host needs to spawn and supervise child processes, wait
for a port to come up, resolve a user's installed toolchains, manage terminal (PTY) sessions, and
store blobs — all without depending on `@jini-ai/daemon` or any product code. Ported mostly
verbatim from Open Design's own `packages/platform` plus several generic daemon-support files
that were split out of OD's monolithic daemon (see `source-map.md` for the full per-file trail).

## Install

```sh
npm install @jini-ai/platform
```

No peer dependencies. `undici` is a regular dependency (used by the SSRF-safe asset cache's
connection-time DNS-rebinding guard). Interactive terminal sessions (`createTerminalService`)
need a `PtySpawn` implementation supplied by the caller — this package defines the `PtyProcess`/
`PtySpawn` port only, it does not depend on `node-pty` itself, so bring your own adapter (or use
`@jini-ai/daemon`'s, which wires a real `node-pty` behind the same port).

## What you get

- **Process lifecycle** — `spawnBackgroundProcess`, `spawnLoggedProcess`, `stopProcesses`,
  `waitForProcessExit`, `isProcessAlive`, `listProcessSnapshots`, process-stamp encode/match
  helpers (`createProcessStampArgs`, `readProcessStamp`, `matchesProcessStamp`).
- **Command construction** — `createCommandInvocation`, `createPackageManagerInvocation`
  (cross-platform `.bat`/`.cmd` shim quoting).
- **Shell execution** — `execFileBuffered`, `execCommandViaLoginShell` (re-enters the login shell
  so profile-only `PATH` entries are visible).
- **Filesystem** — `pathContains`, `atomicCopyFile`, `removePathBestEffort`, `readLogTail`.
- **HTTP readiness** — `waitForHttpOk`.
- **Toolchain discovery** — `wellKnownUserToolchainBins` (npm/pnpm/bun/cargo/deno/go/pyenv,
  asdf/volta/mise/nvm/fnm shims).
- **Proxy-aware env** — `resolveSystemProxyEnv`, `mergeProxyAwareEnv` (macOS `scutil` / Windows
  registry discovery).
- **Sandboxed execution env** — `resolveSandboxRuntimeConfig(FromEnv)`, `ensureSandboxRuntimeDirs`,
  `applySandboxRuntimeEnv`, `isSandboxModeEnabled`.
- **Resource paths** — `resolveDaemonCliPath`, `resolveDaemonResourceRoot`, `resolveDataDir`,
  `resolveProcessResourcesPath` — daemon CLI/resource-root/data-dir resolution for a packaged app.
- **Terminal sessions** — `createTerminalService` (in-memory PTY session manager: spawn, write,
  resize, kill, `attach`/`detach` transport-neutral streaming via `TerminalSseSink`).
- **Managed downloads** — `managedDownload`, `inspectManagedDownload`, `pruneManagedDownloads`,
  `downloadCopyAndClear` (atomic, resumable, checksum-verified, with cross-process locking and
  retention pruning).
- **AWS SigV4 signing** — `signSigV4`, `encodeS3PathSegment` (no `@aws-sdk/*` dependency).
- **Blob storage** — `LocalBlobStorage` and `S3BlobStorage`, both implementing the `BlobStorage`
  port, plus `StorageError`.
- **SSRF-safe asset cache** — `createAssetCache`, `isCacheableExternalUrl`, `isPrivateAddress`,
  `assertSafePublicUrl` — a same-origin disk cache/proxy for external media any sandboxed-content
  renderer (an iframe preview, an embedded document) needs.

## Usage

```ts
import { waitForHttpOk, pathContains, spawnBackgroundProcess, LocalBlobStorage } from '@jini-ai/platform';

await waitForHttpOk('http://127.0.0.1:4317/api/daemon/status', { timeoutMs: 15000 });

if (!pathContains('/workspace/project', requestedPath)) {
  throw new Error('path escapes project root');
}

const proc = spawnBackgroundProcess({ command: 'node', args: ['server.js'] });

const blobs = new LocalBlobStorage('/var/lib/app/blobs');
await blobs.writeFile('tenant-42', 'avatar.png', Buffer.from([]));
```

## What's swappable

`BlobStorage` is a port with two concrete implementations shipped (`LocalBlobStorage`,
`S3BlobStorage`) — swap in your own by implementing the same interface. `PtySpawn`/`PtyProcess`
are ports too: `createTerminalService` takes a `loadSpawnPty: () => Promise<PtySpawn>` factory
rather than importing `node-pty` directly, so a caller supplies a real adapter or a fake for
tests. `TerminalSseSink` (`{ send, end }`) decouples terminal streaming from any specific
transport (Express, SSE, WebSocket) — everything else (process spawning, command construction,
the asset cache's SSRF guard chain, download resume logic) is fixed, concrete implementation.

## Runtime

Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0.
