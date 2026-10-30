# `@jini-ai/platform`

Generic OS/platform primitives: process exec and lifecycle, filesystem containment, HTTP
readiness polling, toolchain discovery, blob storage, AWS signing, and an SSRF-safe asset cache.
This is the Node-only substrate a daemon host needs to spawn and supervise child processes, wait
for a port to come up, resolve a user's installed toolchains, manage terminal (PTY) sessions, and
store blobs — all without depending on `@jini-ai/daemon` or any product code. Ported mostly
verbatim from Open Design's own `packages/platform` plus several generic daemon-support files
that were split out of OD's monolithic daemon (see the archived provenance ledger for the full per-file trail).

## Install

```sh
npm install @jini-ai/platform
```

`undici@^7.25.0` is an optional peer for the SSRF-safe asset cache's default dispatcher.
Install it when calling `createAssetCacheDispatcher` or creating a cache without a host-supplied
guarded dispatcher. Root imports and `@jini-ai/platform/asset-cache` imports do not load undici;
the synchronous factory loads it on demand and reports a missing-peer error if it is absent.
The root declarations retain undici types, so TypeScript consumers of those declarations also
need the peer available. The dispatcher validates DNS at connection time, and cache `close()`
closes only its default dispatcher; a host-supplied dispatcher remains owned by the host.
Interactive terminal sessions (`createTerminalService`)
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
- **Response byte limits** — `ResponseLimitExceededError` from `@jini-ai/platform/fetch-with-timeout` carries `limitBytes` and extends `RangeError` for guarded response-text overflow.
- **Deadline signals** — `createDeadlineSignal({ waitMs }, { signal, startedAt, now, wait })` from `@jini-ai/platform/fetch-with-timeout` (also root) returns `{ signal, dispose }`. It subtracts elapsed milliseconds using the optional `now: () => number` clock (default `Date.now`) and combines the remaining budget with caller cancellation. The optional `wait({ ms, signal }): Promise<void>` timer port resolves after the delay and must release its timer and settle when its signal aborts; real timers are the default. Call idempotent `dispose()` in `finally` to cancel the pending wait and detach parent listeners without aborting the returned signal. Deadline expiry uses a `DOMException` named `TimeoutError`; parent abort preserves its reason.
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

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0.
# Additional subpaths

The package also exposes `./http/guarded`, `./mail`, `./mail/smtp`,
`./fs/guarded-reader`, `./fs/durable-json`, and `./secrets`. New APIs take a required
object followed by an optional object. Application identity and policy values belong to the caller.

Email event senders use the universal `@jini-ai/platform/mail/senders` entry (also exported by `/mail`).
`EmailSender` exposes `listSources`, `describeSource`, `resolveEvent`, and `configureEmail`.
Each operation authorizes its workspace and principal; the sender owns values, recipients and binding.
Delivery providers are separate; `createEmailSenderRegistry` reuses core's keyed registry.
`listEmailSources` lists events across senders; `validateEmailSourceTemplate` checks compatibility.
`prepareSenderEmail` refuses disabled bindings and events before the latest activation.
Preparation renders through the injected version-checked template port and sends nothing.
Its result can be frozen in the feature's existing job; missing optional values produce token warnings.

`@jini-ai/platform/web` loads these optional peers at import time: `parse5@7.3.0`,
`hast-util-from-parse5@8.0.3`, `hast-util-to-mdast@10.1.2`,
`mdast-util-to-markdown@2.1.2`, and `mdast-util-gfm-table@2.0.0`. Install all five
when using that subpath; the other entries do not load them. Existing web consumers that
relied on transitive installation must add them before upgrading.

```sh
npm install parse5@7.3.0 hast-util-from-parse5@8.0.3 hast-util-to-mdast@10.1.2 mdast-util-to-markdown@2.1.2 mdast-util-gfm-table@2.0.0
```

The isolation metadata shares only the address classifiers (including their literal
endpoint policy), timeout wrapper and egress refusal class across domains. These
leaves retain one owner so HTTP and web adapters use the same security decisions.

```ts
import { createHttpClient, createNodeGuardedHttpPorts, guardedFetch } from "@jini-ai/platform/http/guarded";

const client = createHttpClient({
  ...createNodeGuardedHttpPorts({}),
  userAgent: "MyApplication/1.0",
  policy: {
    allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [],
    maxRedirects: 3, connectTimeoutMs: 5000,
    maxResponseBytes: 1_000_000, maxDecompressedBytes: 1_000_000,
  },
});
const response = await guardedFetch(
  { client, url: "https://provider.example/metadata", timeoutMs: 5000 },
  { redirect: "error" },
);
```

`guardedFetch` returns a native Response, refuses truncated bodies, and defaults to redirect
refusal. SDKs with positional fetch callbacks can adapt them at the host boundary. The HTTP
transport pins the vetted IP while preserving authority and TLS SNI; every followed GET redirect
is checked again. The `rateLimit` policy field is reserved metadata and does not implement pacing.

Mail sends put message, idempotency key, workspace, and source context in argument one, with
lane/purpose/timeout in argument two. `wrapMailerWithPurposeGate` requires an inner mailer,
runtime mode, and a readiness port. Unknown or absent lanes require a durable path in production.
The SMTP subpath accepts a transport and clock; its nodemailer factory accepts the host's module
as a structural port. Core loads no mail vendor and adds no mail dependency.

The guarded reader requires root, deny rules, all read/traversal limits, and a filesystem port.
Its existing options object also accepts `descriptorRead: { exactMode?: number, rejectGrowth?: boolean }`.
When present (including `{}`), reads open with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, verify
regular-file status and size with `fstatSync`, and read that same descriptor. `exactMode` compares
exact permission bits including setuid/setgid/sticky (`mode & 0o7777`); `rejectGrowth: true` rejects bytes beyond its initial size.
The filesystem's optional `fstatSync` and `constants` capabilities become required for this policy;
unsupported flags fail closed. No-follow protects the final path component; ancestor-directory
replacement races remain outside this guarantee. Omitting the policy retains existing reads.

`@jini-ai/platform/fetch-with-timeout` also exports `TextReadOptions`,
`readFetchResponseText({ response }, { maxResponseBytes?, strictUtf8? })`, and
`fetchTextWithTimeout({ url, timeoutMs, init? }, { fetch?, maxResponseBytes?, strictUtf8? })`.
Text defaults to unlimited bytes and replacement UTF-8 decoding. Caps must be nonnegative safe
integers; exactly the cap is accepted, overflow throws `ResponseLimitExceededError` (a `RangeError`
with `limitBytes`), invalid caps throw plain `RangeError`, and strict UTF-8 throws on
malformed/truncated input. Streamed bytes are counted before decoding, independent of Content-Length;
failed guarded consumption cancels and releases the reader without masking the original error.
Incoming chunk allocation is controlled by the upstream stream. The text-fetch helper maps timeout
errors during both headers and body consumption to `FetchTimeoutError`, returns `{ response, text }`,
and leaves the response metadata available with its body consumed. The existing positional
`fetchWithTimeout(url, init, { timeoutMs, fetch? })` now accepts transport injection and still returns
the original unconsumed response. Neither function retries.

For retained-byte metadata and optional truncation, use the single-object overload:

```ts
const { text, byteLength, truncated } = await readFetchResponseText({
  response,
  maxResponseBytes: 1024,
  result: "details",
  onLimit: "truncate",
  signal,
});
```

This overload requires a nonnegative safe-integer cap. `onLimit` defaults to `"reject"`;
`strictUtf8` defaults to `false`. `byteLength` counts retained source bytes before decoding,
and `truncated` becomes true only after observing bytes beyond the cap. An exact-sized body
(including an empty body at a zero cap) requires EOF to establish completeness. Truncation
cancels consumption and flushes the decoder; cutting a UTF-8 character produces replacement
text by default or throws with `strictUtf8: true`. A signal interrupts pending reads and
preserves its abort reason. Details-mode cancellation failures are observed without waiting
for cancellation to settle, and every acquired reader's lock is released. Existing string
overloads, defaults, and text-fetch behavior remain unchanged.

The durable JSON factory requires file path, filesystem/time/sleep/liveness/random/reporting ports,
and host notices. It preserves atomic replacement and corrupt-file states; parent-directory
persistence and the inherited simultaneous stale-lock-break race remain filesystem/locking limits.

See [API.md](./API.md) for the source/export mapping and host wiring,
and [the secrets guide](./src/secrets/README.md) for ciphertext-compatible object signatures.

## Integrated extraction APIs

All exports declare a Node runtime. The root exposes `filesystem`, `guardedHttp`, `mail`,
`smtp`, `secrets`, and `credentialSets` namespaces; the dedicated subpaths
remain available. `./fs` now also exports guarded readers and durable JSON helpers. Legacy root
functions keep their existing signatures for consumers already using them.

New factories/functions/methods accept a required object and, where needed, a second optional
object. No-input operations take `{}`: `createNodeGuardedHttpPorts({})`,
`createNodeGuardedReaderFilesystem({})`, `createNodeDurableJsonPorts({})`,
`new FetchHttpTransportAdapter({})`, `new InMemoryTrashRepo({})`,
`keyring.activeKey({})`,
`mailer.capabilities({})`, `clock.nowMs({})`, `clock.nowIso({})`, `random.token({})`,
and `file.read({})`. SMTP ports receive `sendMail({ mail })`; `NodemailerPort` exposes the
vendor-shaped `NativeSmtpTransport` so the factory adapts the payload once. Policy errors use
`new AnalyticsPiiRejectedError({ message }, { cause })` and
`new TrashAdapterMissingError({ message }, { cause })`.

| Subpath | API and required host ports/policy |
| --- | --- |
| `./mail` | `createMailAdapterContext({ credential, kit }, { now, settings })` supplies a live clock and fresh empty settings by default; modules validate opaque per-install settings. |
| `@jini-ai/analytics` (separate package) | `ingestHit({ input, deps }, { hooks, hash })`, `normalizeIngestContext({ input, dailySalt }, { hash })`, `deriveDailySalt({ rootKeySeed, workspaceId, utcDate, saltContext })`. The host supplies sink/config, host resolution, HKDF context, and privacy bounds. `LocalBufferSink({}, { initialHits })` is process-local. |
| `@jini-ai/cms/trash` (separate package) | `createTrashService({ repo, adapters, transaction, idGen, entityPolicy }, { retentionDays, ...optional })`, `createTrashSweep({ repo, adapters, transaction, entityPolicy })`, and `startTrashSweeper({ sweep, clock, scheduler, leaseOwner }, optional)`. The host owns authorization, transactions, retention, scheduling, and adapters; follow-up hooks are in argument two. |
| `./fs` | `writeFileAtomic({ filePath, content, fs, tempName })`, `writeJsonFileAtomic({ filePath, data, fs, tempName })`, `upsertEnvLine({ source, key, value })`, `readEnvLine({ source, key })`, `resolvePathWithin({ root, segment })`. Atomic writes preserve existing modes and require filesystem/temp-name ports. |

The extraction mappings, caller counts, remaining ownership needs, and serial verification
commands are recorded in [the integration handoff](./integration-platform-report.md).

## Design decisions

- [Unknown mail purposes take the restrictive delivery lane](docs/decisions/DR-001-purpose-scoped-mail.md).
- [Outbound HTTP inherits guards from one injected client](docs/decisions/DR-002-guarded-egress.md).

## Shared kernel and filesystem/network primitives

HTTP request/response/redirect/client contracts and `Clock`, `UUID`, `ISODateTime`, and JSON
contracts come from `@jini-ai/core/primitives`. Guarded construction uses `GuardedClock`, which
adds `timeoutSignal({ timeoutMs })` to `nowMs()`. SMTP acceptance time uses `nowIso({ clock })`.
Mail adapter kits use that same core `HttpClientPort`; guarded requests omit `signal` when
neither caller cancellation nor a total deadline supplies one.
Socket idle budgets and optional total deadlines retain their existing behavior.

`@jini-ai/platform/net` publishes `isPrivateAddress({ address })`, `expandIpv6({ address })`,
`isLoopbackApiHost({ hostname })`, `isBlockedExternalApiHostname({ hostname })`, and
`isLoopbackHostname({ hostname })`. Resolved-peer SSRF classification fails closed and blocks
loopback, including compatible/mapped IPv6. Provider hostname policy deliberately allows loopback
and requires DNS/connection-time checks separately. The daemon hostname predicate retains its
narrower policy. The IP classifier no longer lives in asset-cache.ts.

`@jini-ai/platform/fs` publishes `writeFileAtomic` / `writeJsonFileAtomic` and their `Async`
counterparts. Synchronous calls take `{ filePath, content, fs }` (JSON uses `data`),
where `fs` comes from `createNodeAtomicFilesystem({})`. Async calls take `{ filePath, content }` and accept a native `fs/promises` seam in the optional object. Both preserve existing
permissions, default new files to 0600, create a sibling exclusively, flush file bytes before rename,
flush the directory after rename, and clean owned temps on failure. The optional object
accepts `tempName`; omitting it uses
`${process.pid}.${randomUUID()}`. Options include `mode`, `defaultMode`, `refuseSymlink`,
`verifyOwnerOnly`, and `platform`; async calls also support `createParent`, and async JSON supports
`trailingNewline` for runtime-state files. Secret stores pass `{ mode: 0o600, verifyOwnerOnly: true }`;
POSIX permission verification fails closed. Directory fsync failures surface after replacement.

`@jini-ai/platform/fs/file-lock` publishes `withFileLock({ lockPath, run }, options)` and
`withFileLockSync(...)`. Defaults are 15 seconds to wait, 10 seconds stale, and 10ms polling;
options accept `timeoutMs`, `staleMs`, `pollMs`, and the kernel `clock`, plus filesystem/liveness/
sleep seams. Run receives an ownership handle with `assertHeld({})`. Age or dead local-owner
liveness permits stealing only after inode/device, contents and mtime remain unchanged. Unknown or
foreign-owner pids do not authorize death-based stealing. `staleMs: Infinity` disables age stealing.
The documented final check-to-unlink race remains; use a stale budget longer than the operation.
Durable JSON passes its existing 5s/30s/10ms values, legacy token/temp format, and timeout copy.

`defaultPlatformMessages` is exported from the root, guarded HTTP, and secrets entries. Hosts can
supply a replacement `PlatformMessages` object to `EgressRefusedError`, `EnvOrFileKeyring`, or the
lock/atomic-writer options. Explicit `callerSafeMessage` still takes precedence for an egress refusal.
Credential records retain the required `workspaceId` field: it binds existing repository rows and
AES-GCM AAD. Renaming that persisted field requires a host adapter migration as well as a type edit.
Analytics is available from the standalone `@jini-ai/analytics` package; soft-delete and purge
services are available from `@jini-ai/cms/trash`. Their platform subpaths and root namespaces
have been removed.
