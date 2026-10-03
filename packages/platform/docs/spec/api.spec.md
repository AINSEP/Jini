Spec ID: SPEC-JINI-PLATFORM-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:201dc4b195ac10d1b2cd134c8c7ddb769c3869adf2392d1e6e97befb991deab4
spec_mode: reverse_spec

# API Contract: @jini-ai/platform

## Entry points and conventions

Node ESM public entries: `.`, `./fetch-with-timeout`, `./secrets`, `./secrets/credential-sets`, `./secrets/testing`, `./http/guarded`, `./mail`, `./mail/smtp`, `./fs/guarded-reader`, `./fs/durable-json`, `./fs`, `./net`, and `./fs/file-lock`.

This is the current source contract. Object APIs use `(required, optional = {})` where implemented; single-object APIs currently declare no optional argument. Many root APIs retain positional arguments or one options object. The signatures below preserve those exceptions rather than inventing future wrappers. Named source types describe the full option/result shape where listed; shared HTTP/time/ID/JSON types come from `@jini-ai/core/primitives`.

Root namespace exports `filesystem`, `guardedHttp`, `mail`, `smtp`, `secrets`, `credentialSets` mirror the respective subpaths. The other root runtime exports are enumerated below. Exported error constructors are detailed in `errors.spec.md`.

## Root: command, process, proxy, filesystem, HTTP

| Export | Current signature / return | Consumer dependencies or defaults |
|---|---|---|
| `createCommandInvocation` | `({ command: string, args?: string[], env?: NodeJS.ProcessEnv }): CommandInvocation` | OS and env; args `[]`, env process.env |
| `createPackageManagerInvocation` | `(args: string[], env = process.env): CommandInvocation` | Optional npm_execpath; fallback corepack pnpm |
| `mergeProxyAwareEnv` | `(platform: NodeJS.Platform, ...sources: ProcessEnv[]): ProcessEnv` | Explicit platform and env sources |
| `parseMacosScutilProxyOutput` | `(stdout: string, platform = 'darwin'): ProcessEnv` | Pure parser |
| `parseWindowsInternetSettingsProxyOutput` | `({ proxyEnable, proxyOverride?, proxyServer? }, platform = 'win32'): ProcessEnv` | Strings of registry-command output |
| `resolveSystemProxyEnv` | `(options: ResolveSystemProxyEnvOptions = {}): ProcessEnv` | Optional platform/runCommand; native commands default to 2000 ms |
| `createProcessStampArgs` | `(stamp: T, contract: ProcessStampContract<T>): string[]` | Host normalizers, fields and flags |
| `readFlagValue` | `(args: readonly string[], flagName: string): string | null` | Pure flag decoder |
| `readProcessStamp`, `readProcessStampFromCommand` | `(args: readonly string[] / command: string, contract): T | null` | Host stamp normalizer |
| `matchesProcessStamp` | `(stamp: T, criteria: Partial<T> | undefined, contract): boolean` | Host normalizers |
| `matchesStampedProcess` | `(processInfo: Pick<ProcessSnapshot, 'command'>, criteria, contract): boolean` | Same stamp contract |
| `spawnBackgroundProcess` | `(request: SpawnProcessRequest): Promise<{ pid: number }>` | Executable; optional cwd/env/logFd/detached, detached default true |
| `spawnLoggedProcess` | `(request: SpawnProcessRequest): Promise<ChildProcess>` | Same; detached default false |
| `isProcessAlive` | `(pid: number | null | undefined): boolean` | OS liveness probe |
| `waitForProcessExit` | `(pid, timeoutMs = 5000): Promise<boolean>` | Poll interval 100 ms |
| `listProcessSnapshots` | `(): Promise<ProcessSnapshot[]>` | Native ps or PowerShell |
| `collectProcessTreePids` | `(processes: ProcessSnapshot[], rootPids: (number | null | undefined)[]): number[]` | Supplied process snapshot |
| `stopProcesses` | `(pids: (number | null | undefined)[]): Promise<StopProcessesResult>` | Native signal escalation |
| `pathContains` | `(root: string, target: string): boolean` | Lexical resolved paths |
| `atomicCopyFile` | `(sourcePath: string, destinationPath: string, options: AtomicCopyFileOptions = {}): Promise<AtomicCopyFileResult>` | Optional overwrite, default false |
| `removePathBestEffort` | `(path: string, options: RemovePathBestEffortOptions = {}): Promise<RemovePathBestEffortResult>` | Recursive default true |
| `readLogTail` | `(filePath: string, maxLines = 80): Promise<string[]>` | Native filesystem |
| `waitForHttpOk` | `(url: string, { timeoutMs = 20000 } = {}): Promise<true>` | Global fetch; retry interval 150 ms |
| `execFileBuffered`, `execCommandViaLoginShell` | `(command: string, args: readonly string[], opts: ExecFileOptions = {}): Promise<BufferedCommandResult>` | Native child execution; timeout 120000 ms, buffer 1 MiB |

Types: `CommandInvocation` is `{ command, args, windowsVerbatimArguments? }`; `CommandInvocationRequest` is its input shape. `SystemProxyCommandRunner(command, args): string` and `ResolveSystemProxyEnvOptions` allow proxy command injection. `ProcessStampShape`, `ProcessStampField`, `ProcessStampContract`, and `StampedProcessMatchCriteria` carry generic stamp contracts. A stamp contract supplies `normalizeStamp(input)`, `normalizeStampCriteria(input?)`, `stampFields`, and `stampFlags`.

`SpawnProcessRequest` adds `cwd?`, `detached?`, `logFd?: number | null` to command inputs. `ProcessSnapshot` is `{ pid, ppid, command }`. `StopProcessesResult` has `alreadyStopped` and arrays `matchedPids`, `stoppedPids`, `forcedPids`, `remainingPids`. `AtomicCopyFileResult` is `{ bytesCopied, replaced }`; removal returns `{ removed, error? }`. `HttpWaitOptions` has optional timeoutMs. `BufferedCommandResult` is `{ code: string | number | null | undefined, error: Error | null, ok, stderr, stdout }`. All named types in these paragraphs are root exports.

```ts
import { createCommandInvocation, atomicCopyFile, removePathBestEffort } from '@jini-ai/platform';
const invocation = createCommandInvocation({ command: 'worker', args: ['--mode=batch'] });
await atomicCopyFile('/var/lib/app/source.bin', '/var/lib/app/output.bin', { overwrite: false });
await removePathBestEffort('/var/lib/app/temporary');
```

## ./fetch-with-timeout (also root)

`fetchWithTimeout(url: string | URL, init: RequestInit = {}, options: FetchWithTimeoutOptions): Promise<Response>` uses a required third object `{ timeoutMs: number }`. `FetchTimeoutError` and `FETCH_TIMEOUT_MS` are also exported. Constants: QUICK 15000, DEPLOY 30000, UPLOAD 120000, GENERATE 600000 ms. This helper has no injectable fetch parameter; use the guarded client for policy-aware egress.

```ts
import { fetchWithTimeout, FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
const response = await fetchWithTimeout('https://example.test/status', {}, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
```

## Root: paths, toolchains, sandbox environment

| Export | Current signature / return |
|---|---|
| `expandHomePrefix` | `(raw: string): string` |
| `resolveProjectRelativePath` | `(raw: string, projectRoot: string): string` |
| `wellKnownUserToolchainBins` | `(options: WellKnownUserToolchainOptions = {}): string[]` |
| `resolveDaemonCliPath` | `(config: ResourcePathsConfig, env = process.env): string` |
| `resolveProcessResourcesPath` | `(config, processInfo: { resourcesPath?: string; execPath: string } = process): string | null` |
| `resolveDaemonResourceRoot` | `(config, options: ResolveDaemonResourceRootOptions = {}): string | null` |
| `resolveDaemonResourceDir` | `(resourceRoot: string | null, segment: string, fallback: string): string` |
| `resolveDaemonPluginPreviewsDir` | `(config, options: ResolveDaemonPluginPreviewsDirOptions): string` |
| `resolveDataDir` | `(config, raw: string | undefined, projectRoot: string, options: ResolveDataDirOptions = {}): string` |
| `isSandboxModeEnabled` | `(config: SandboxEnvConfig, env = process.env): boolean` |
| `sandboxImportAllowedRoots` | `(config, env = process.env): string[]` |
| `isSandboxImportedProjectRootAllowed` | `(config, projectRoot: string, env = process.env): boolean` |
| `sandboxImportedProjectRootUnavailableReason` | `(config, projectRoot, env = process.env): string | null` |
| `resolveSandboxRuntimeConfig` | `(enabled: boolean, dataDir: string): SandboxRuntimeConfig` |
| `resolveSandboxRuntimeConfigFromEnv` | `(config, env, projectRoot): SandboxRuntimeConfig | null` |
| `sandboxAgentProfilesConfigPath` | `(config, runtime: SandboxRuntimeConfig): string` |
| `ensureSandboxRuntimeDirs` | `(runtime): void` |
| `applySandboxRuntimeEnv` | `(config, baseEnv: ProcessEnv, runtime): ProcessEnv` |

`WellKnownUserToolchainOptions` contains `home?`, `includeSystemBins?`, and `env?`. It supplies candidate directories, not a PATH mutation or installation. Resource configuration requires caller-chosen strings `cliPathEnvVar`, `cliPathFallbackEnvVar`, `cliPackageName`, `resourceRootEnvVar`, `pluginPreviewsDirEnvVar`, `dataDirEnvVar`, `defaultDataDirName`, `windowsResourceBinSegment`.

Resource-root options contain `configured?` and `safeBases?`; plugin-preview options require `resourceRoot` and `projectRoot`, optional `env`; data-dir options contain `requireExplicit?`. Sandbox configuration requires `modeEnvVar`, `importAllowedRootsEnvVar`, `dataDirEnvVar`, `agentHomeEnvVar`, `agentProfilesConfigEnvVar`, `agentProfilesDirName`. Runtime returns `{ enabled, dataDir, roots: SandboxRuntimeRoots }`; roots name agent-home/cache/config/generated-files/logs/MCP/plugin/preview/skills/temp/tool directories. All these named configuration/result types are exported.

## Root: terminal service

`createTerminalService(options: CreateTerminalServiceOptions): TerminalService` requires `loadSpawnPty(): Promise<PtySpawn>` and optionally `maxEvents`, `maxBufferBytes`, `exitTailBytes`, `flushIntervalMs`, `flushThresholdBytes`, `ttlMs`, `shutdownGraceMs`. The consumer supplies the PTY backend, chooses/authorizes cwd, adapts sinks, and calls shutdown. Native PTY is not imported.

```ts
interface TerminalService {
  create(options: CreateTerminalOptions): Promise<TerminalSession>;
  get(id: string): TerminalSession | null;
  list(filter?: { projectId?: string | null }): TerminalSession[];
  write(id: string, input: string): boolean;
  resize(id: string, cols: number, rows: number): boolean;
  kill(id: string, signal?: string): boolean;
  attach(id: string, lastEventId: number, sink: TerminalSseSink): 'attached' | 'ended' | 'not-found';
  detach(id: string, sink: TerminalSseSink): void;
  shutdownActive(options?: { graceMs?: number }): Promise<void>;
  isTerminal(status: string): boolean;
}
```

`CreateTerminalOptions` requires `cwd`, with optional projectId/cols/rows/shell. A `TerminalSession` is a metadata snapshot with ID, nullable projectId, cwd/shell, dimensions, running/exited status, createdAt/updatedAt, nullable exitCode/signal. `TerminalSseSink.send(event, data, id): void` and `end(): void` receive data/exit records. `TerminalEventRecord` has ID/event/data/timestamp/byteLength; `TerminalEventData` is `{ data: string } | { code: number | null, signal: string | null }`.

`PtySpawn(shell, args, options: PtySpawnOptions): PtyProcess` receives name/dimensions/cwd/env. The process provides onData/onExit/write/resize/kill. All named terminal types are root exports.

Helpers: `spawnHelperCandidatePaths({ platform?, resolve? } = {}): string[]`, `ensureSpawnHelperExecutable(candidatePaths = spawnHelperCandidatePaths()): void`, and `resolveShell(requested?: string | null, { platform?, env? } = {}): string`.

```ts
import { createTerminalService } from '@jini-ai/platform';
const terminals = createTerminalService({ loadSpawnPty: async () => hostPtySpawn });
const session = await terminals.create({ cwd: '/var/lib/app/workspace' });
await terminals.shutdownActive();
```

## Root: downloads, cache, signing, blob stores

| Export | Current signature / return | Required inputs and ports |
|---|---|---|
| `managedDownload` | `(options: ManagedDownloadOptions): Promise<ManagedDownloadResult>` | basePath/bucket/fileName/payload; optional fetch/maxAttempts/onProgress/signal |
| `downloadCopyAndClear` | `(options: DownloadCopyAndClearOptions): Promise<DownloadCopyAndClearResult>` | Download options plus outputPath |
| `inspectManagedDownload` | `(options: RemoveManagedDownloadOptions): Promise<ManagedDownloadInspection>` | basePath/bucket/fileName |
| `removeManagedDownload` | `(options: RemoveManagedDownloadOptions): Promise<RemoveManagedDownloadResult>` | Same |
| `pruneManagedDownloads` | `(options: PruneManagedDownloadsOptions): Promise<PruneManagedDownloadsResult>` | basePath; optional now/olderThanMs |
| `createAssetCache` | `(options: AssetCacheOptions): AssetCache` | cacheDir; optional maxBytes/fetchTimeoutMs/fetchImpl/lookupImpl |
| `AssetCache.get` | `(rawUrl: string): Promise<AssetCacheResult>` | URL |
| `isCacheableExternalUrl` | `(raw: unknown): raw is string` | Media HTTP(S) URL predicate |
| `assetCacheRewriteUrl` | `(raw: string, routePath = '/api/asset-cache'): string` | Consumer route mounting |
| `assertSafePublicUrl` | `(raw: string): URL` | Literal URL guard |
| `isPrivateAddress` | `(address: string): boolean` | IP classifier |
| `createValidatingLookup` | `(lookupImpl = nativeDnsLookup): DnsLookupCallback` | Optional DNS callback adapter |
| `assetCacheKey` | `(rawUrl: string): string` | SHA-256 URL digest |
| `signSigV4` | `(input: SignSigV4Input): SignSigV4Result` | Request and host-resolved credentials; mutable headers |
| `encodeS3PathSegment` | `(segment: string): string` | Pure URI encoding |
| `new LocalBlobStorage` | `(root: string)` | Filesystem root |
| `new S3BlobStorage` | `(options: S3BlobStorageOptions)` | bucket/region/credentials; optional prefix/endpoint/fetchFn/now |

`ManagedDownloadPayload` is `{ url, checksum: ManagedDownloadChecksum, headers? }`; checksum is `{ algorithm: 'sha256' | 'sha512', value: string }`. `ManagedDownloadProgress` reports receivedBytes/sessionReceivedBytes/optional totalBytes. Download result has bucket/fileName/path/bytes/checksum/reusedComplete/resumed/urlDigest. Copy result has bytes/outputPath/reusedComplete/resumed and cleanup removed/deferred with optional warning. Inspection has bucket/fileName/path/complete and manifest complete/missing/partial/unreadable; removal returns `{ removed }`; prune returns `{ removed, warnings }`. Error codes and class are `MANAGED_DOWNLOAD_ERROR_CODES`, `ManagedDownloadErrorCode`, `ManagedDownloadError`; all named download types above are exported.

`AssetCacheOptions` defaults to 64 MiB per asset and 15000 ms per fetch. `AssetCacheResult` is `{ buf: Buffer, contentType: string }`. `AssetCacheError` is exported. No cache route is mounted automatically.

`SigV4Credentials` is `{ accessKeyId, secretAccessKey, sessionToken? }`. `SignSigV4Input` requires method/path/query/headers/body/region/service/credentials, optional now: Date. Return is `{ authorization, amzDate, contentSha256 }`, also written into supplied headers.

`BlobStorage` methods retain positional arguments: `readFile(namespace, relpath): Promise<Buffer>`, `writeFile(namespace, relpath, body: Buffer): Promise<BlobFileMeta>`, `listFiles(namespace): Promise<BlobFileMeta[]>`, `deleteFile(namespace, relpath): Promise<void>`, `statFile(namespace, relpath): Promise<BlobFileMeta | null>`. Metadata is `{ path, size, mtimeMs }`. S3 additionally exposes `keyFor(namespace, relpath): string` and readonly options. `StorageError` is exported. These APIs supply no cross-store transaction or consumer authorization.

```ts
import { LocalBlobStorage, createAssetCache } from '@jini-ai/platform';
const blobs = new LocalBlobStorage('/var/lib/app/blobs');
await blobs.writeFile('documents', 'hello.txt', Buffer.from('hello'));
const cache = createAssetCache({ cacheDir: '/var/cache/app/media' });
```

## ./fs and ./fs/guarded-reader

`./fs` re-exports root file helpers plus atomic writers, env transforms, strict containment, guarded reading, and durable JSON. Root exposes them through `filesystem`. All functions below have one required object unless an optional object is shown.

| Export | Current signature / return |
|---|---|
| `createNodeAtomicFilesystem` | `({}, { filesystem? } = {}): AtomicFilesystemPort` |
| `writeFileAtomic` | `(required: AtomicWriteRequired, options: AtomicWriteOptions = {}): void` |
| `writeJsonFileAtomic` | `({ filePath, fs, data: unknown }, options: AtomicWriteOptions = {}): void` |
| `upsertEnvLine` | `({ source: string, key: string, value: string }): string` |
| `readEnvLine` | `({ source, key }): string | null` |
| `resolvePathWithin` | `({ root: string, segment: string }): string | null` |
| `createNodeGuardedReaderFilesystem` | `({}): GuardedReaderFilesystem` |
| `createGuardedFileReader` | `({ rootPath, denyRules, limits, filesystem }, { excludedListingDirs? } = {}): GuardedFileReader` |

`AtomicWriteRequired` supplies filePath/content/fs. `AtomicFilesystemPort` provides stat/lstat/open/write/sync/close/chmod/rename/remove with object arguments; write/sync/close use owned descriptors. Optional `tempName({ filePath })` belongs in argument two and defaults to pid.UUID; mode/defaultMode, refuseSymlink, verifyOwnerOnly, platform, tempPath and messages are also writer options. `DenyRules` supplies a segments set and filename regexes. `GuardedReaderLimits` requires positive safe integers `maxFileBytes`, `binarySniffBytes`, `maxListedFiles`, `maxWalkDepth`, `maxWalkEntries`. `GuardedReaderFilesystem` is the structural synchronous/streaming Node-fs subset used by the reader.

`GuardedFileReader` provides `resolve({ relativePath }): string`, `read({ relativePath }): { content, bytes }`, `readBytes({ relativePath, maxBytes }): Promise<Uint8Array>`, `list({}, { relativePath? }?): { files: string[], truncated: boolean }`, `isDeniedFileName({ fileName }): boolean`, and `isDeniedPathSegment({ segmentName }): boolean`. The dedicated `./fs/guarded-reader` entry exports that factory, native filesystem factory, `FsFilePathError`, and the named reader types above.

```ts
import { writeFileAtomic, createNodeAtomicFilesystem } from '@jini-ai/platform/fs';
import { createGuardedFileReader, createNodeGuardedReaderFilesystem } from '@jini-ai/platform/fs/guarded-reader';
writeFileAtomic({ filePath: '/var/lib/app/settings.txt', content: 'enabled',
  fs: createNodeAtomicFilesystem({}) }, { tempName: () => crypto.randomUUID() });
const reader = createGuardedFileReader({ rootPath: '/var/lib/app/workspace',
  denyRules: { segments: new Set(['.git']), filenamePatterns: [/^\.env/] },
  limits: { maxFileBytes: 65536, binarySniffBytes: 1024, maxListedFiles: 100, maxWalkDepth: 5, maxWalkEntries: 1000 },
  filesystem: createNodeGuardedReaderFilesystem({}) }, {});
reader.list({}, {});
```

## ./fs/durable-json (also ./fs)

`createNodeDurableJsonPorts({}): DurableJsonPorts` supplies native synchronous adapters. `createDurableJsonFile(required: DurableJsonPorts & { filePath: string, notices: DurableJsonNotices }, { pollMs = 10, staleMs = 30000 } = {}): DurableJsonFile` requires filesystem/clock/sleep/process/random/report ports. Notices supply `prefix` and `lockTimeout({ lockPath, waitMs }): string`.

`DurableJsonFile.read({}): JsonFileRead`, `tempPath({}, { pid? }?): string`, `write({ value: unknown }): void`, `quarantine({ notice: QuarantineNotice }): boolean`, and `withLock<T>({ critical: () => T }, optional: FileLockOptions = {}): T`. FileLockOptions has waitMs, default 5000. `JsonFileRead` discriminates ok/value, missing, unreadable/optional text. Quarantine notice supplies label/consequence. All named types and helpers are exported.

`salvageJsonPrefix({ text: string }, { maxAttempts = 1000 } = {}): unknown` returns a parsed recoverable prefix or undefined.

```ts
import { createNodeDurableJsonPorts, createDurableJsonFile } from '@jini-ai/platform/fs/durable-json';
const file = createDurableJsonFile({ ...createNodeDurableJsonPorts({}), filePath: '/var/lib/app/state.json',
  notices: { prefix: 'app', lockTimeout: ({ waitMs }) => `State lock timed out after ${waitMs}ms` } }, {});
file.withLock({ critical: () => file.write({ value: { enabled: true } }) });
```

## ./http/guarded

`createHttpClient(required: GuardedHttpRequired): HttpClientPort` requires `{ transport, policy, dns, clock, userAgent }`. `DnsResolver.resolve({ hostname }): Promise<readonly string[]>`; `Clock.nowMs({}): number`, `timeoutSignal({ timeoutMs }): AbortSignal`; `PinnedHttpTransport.requestPinned({ request, peer }): Promise<HttpResponse>`. `HttpTransportAdapter` aliases that transport. `HttpClientPort.send({ request }, { redirect?: RequestRedirect } = {}): Promise<HttpResponse>` defaults redirect to follow. Injected transport must dial the vetted peer rather than resolve the hostname again.

`EgressPolicy` requires allowedSchemes/denyPrivateAddresses/devHostAllowlist/maxRedirects/connectTimeoutMs/maxResponseBytes/maxDecompressedBytes. Optional `rateLimit: { maxConcurrent, maxPerMinute }` is declared but not enforced by the current client. `HttpRequest` requires method/url/headers and either idleTimeoutMs or legacy timeoutMs; optional body string/totalDeadlineMs/signal/maxResponseBytes. Methods: GET/HEAD/POST/PUT/PATCH/DELETE. `HttpResponse` carries status/headers/bodyText and optional setCookies/bodyBytes/bodyTruncated/bodyBytesTruncated/finalUrl. `PinnedPeer` has ip/port/authority/tlsServerName; RequestRedirect is follow/error/manual.

Additional exports: `classifyAddress({ ip }): AddressClass` (public/private/loopback/link-local/reserved); `new FetchHttpTransportAdapter({})`; `createNodeGuardedHttpPorts({}): { dns, clock, transport }`; `guardedFetch({ client, url, timeoutMs }, optional: GuardedFetchOptions = {}): Promise<Response>`; `EgressRefusedError`. GuardedFetchOptions allows method/headers/string-or-URLSearchParams body/signal/redirect (default error). All named types above are exported.

```ts
import { createHttpClient, createNodeGuardedHttpPorts, guardedFetch } from '@jini-ai/platform/http/guarded';
const client = createHttpClient({ ...createNodeGuardedHttpPorts({}), userAgent: 'consumer/1.0',
  policy: { allowedSchemes: ['https'], denyPrivateAddresses: true, devHostAllowlist: [],
    maxRedirects: 3, connectTimeoutMs: 5000, maxResponseBytes: 1048576, maxDecompressedBytes: 1048576 } });
const response = await guardedFetch({ client, url: 'https://example.test/data', timeoutMs: 5000 }, {});
```

## ./secrets

| Export | Current signature / return |
|---|---|
| `new EnvOrFileKeyring` | `({ hkdfSalt: string | Uint8Array, envVarName: string, keyFilePath: string, env: RootKeyEnvironmentPort, allowFileFallback: boolean, allowFileAutoGenerate: boolean }, optional: EnvOrFileKeyringOptions = {})` |
| `new FixedRootKeyKeyring` | `({ hex: string, hkdfSalt }, { keyId? } = {})` |
| `new AesGcmSecretSealer` | `({ keyring: KeyringPort })` |
| `formatAad` | `({ kind: string, version: string, parts: readonly string[] }): string` |
| `parseRootKeyHex` | `({ raw: string }): ParsedRootKeyHex` |
| `fingerprintRootKeyHex` | `({ hex: string }): string` |
| `inspectRootKeyMaterial` | `(options: InspectRootKeyMaterialOptions): RootKeyStatus` |
| `revealRootKeyMaterial` | `(options: InspectRootKeyMaterialOptions): RootKeyReveal` |
| `generateFileRootKey` | `({ keyFilePath: string }): GeneratedFileRootKey` |
| `deriveFromRootKey` | `({ rootKey: Uint8Array, input: { workspaceId, purpose, info }, hkdfSalt }): Uint8Array` |
| `deriveSigningSecretFromRootKey` | `({ rootKey, input: { workspaceId, subscriptionId, version: number }, hkdfSalt }): Uint8Array` |

`KeyringPort.activeKey({}): Promise<RootKeyHandle>`, `derive({ workspaceId, purpose, info }): Promise<Uint8Array>`, and `deriveSigningSecret({ workspaceId, subscriptionId, version }): Promise<Uint8Array>`. RootKeyHandle contains readonly keyId. Keyring options: keyId default v1, allowFileFallback default true, allowFileAutoGenerate defaults to allowFileFallback. Environment and filesystem are native effects, not injected through this keyring.

`SecretSealerPort.seal({ plaintext: string, key: RootKeyHandle, aad: string }): Promise<SealedSecret>` and `open({ sealed }, { aad?: string } = {}): Promise<string>`. SealedSecret has keyId/ciphertext/nonce/alg string fields. The AES adapter requires only a keyring. AAD is required for seal; consumers pass identical AAD to open.

Exported types include EnvOrFileKeyringRequired/Options, RootKeyRejection, ParsedRootKeyHex, RootKeyStatus, RootKeyReveal, InspectRootKeyMaterialOptions, GeneratedFileRootKey. Inspect options supply envVarName/keyFilePath and the required `env.read({ name })` port. Keyring permissions are required explicit booleans; missing or non-boolean flags throw before file access. The optional keyring object carries only keyId. Status gives active/source/keyFilePath and optional fingerprint/invalid/reason; reveal adds hex; generation returns hex/fingerprint/keyFilePath. `UnusableRootKeyError` and `RootKeyFileAlreadyExistsError` are exported.

```ts
import { EnvOrFileKeyring, AesGcmSecretSealer } from '@jini-ai/platform/secrets';
const keyring = new EnvOrFileKeyring({ hkdfSalt: 'consumer-secret-context-v1',
  envVarName: 'APP_ROOT_KEY', keyFilePath: '/var/lib/app/root-key',
  env: { read: ({ name }) => process.env[name] }, allowFileFallback: true, allowFileAutoGenerate: false });
const sealer = new AesGcmSecretSealer({ keyring });
const sealed = await sealer.seal({ plaintext: credentials.token, key: await keyring.activeKey({}), aad: 'scope:v1:tenant-a' });
const plaintext = await sealer.open({ sealed }, { aad: 'scope:v1:tenant-a' });
```

## ./secrets/credential-sets and ./secrets/testing

`buildVendorCredentialAad({ workspaceId, vendorId, id }): string` and `new InMemoryVendorCredentialSetRepo({})` are credential-set runtime exports. Its `VendorCredentialSetRepoPort` methods are `insert(record): Promise<void>`, `update(record): Promise<void>`, `findById({ workspaceId, id }): Promise<VendorCredentialSetRecord | null>`, `findDefaultByVendor({ workspaceId, vendorId }): Promise<Record | null>`, `listByVendor({ workspaceId, vendorId }): Promise<Record[]>`, `listByWorkspace({ workspaceId }): Promise<Record[]>`, `delete({ workspaceId, id }): Promise<void>`, `updateAccountLabel({ workspaceId, id, accountLabel }): Promise<void>`.

`VendorCredentialSetRecord` supplies workspaceId/id/vendorId/label/sealed/tokenTail/isDefault/accountLabel/createdAt/updatedAt. `VendorCredentialSetSummary` omits workspaceId/sealed and adds configured: true. All three named credential types are exported.

Testing exports: `new InMemoryKeyring({ hkdfSalt }, { keyId? } = {})`, `FixedRootKeyKeyring`, and `InMemoryVendorCredentialSetRepo`. InMemoryKeyring extends FixedRootKeyKeyring with a new random root for each instance.

```ts
import { buildVendorCredentialAad } from '@jini-ai/platform/secrets/credential-sets';
import { InMemoryKeyring, InMemoryVendorCredentialSetRepo } from '@jini-ai/platform/secrets/testing';
const aad = buildVendorCredentialAad({ workspaceId: 'tenant-a', vendorId: 'vendor-a', id: 'key-a' });
const testKeys = new InMemoryKeyring({ hkdfSalt: 'test-context' }, {});
const repo = new InMemoryVendorCredentialSetRepo({});
```

## ./mail and ./mail/smtp

`wrapMailerWithPurposeGate(options: WrapMailerWithPurposeGateOptions): MailerPort` requires `{ inner, mode: 'production' | 'local', readiness: DeliveryReadinessPolicy }`. Readiness exposes `isReady({ capabilityName }): boolean`. `isMailDeliveryAvailable({ mailer }): boolean` checks the capabilities driver's name.

```ts
interface MailerPort {
  capabilities({}): MailerCapabilities;
  send(required: MailerSendRequired, optional?: MailerOptional): Promise<MailerSendResult>;
  sendBatch(required: MailerBatchRequired, optional?: MailerOptional): Promise<readonly MailerSendResult[]>;
}
```

Required send fields: message, idempotencyKey, workspaceId, sourceContext `{ module, ref? }`; batch uses messages instead of message. Optional fields: timeoutMs, purpose transactional/bulk/feature string, lane interactive/notification. OutboundEmail requires workspaceId/to/from/subject, optional replyTo/html/text/headers/attachments. EmailAddress is email/name; EmailAttachment is filename/contentType/contentBase64. Success result contains ok true/providerMessageId/acceptedAt; failure contains ok false/retryable/errorCode/message. Capabilities declare driver/supportsIdempotencyKey/supportsWebhookFeedback/maxBatchSize/supportsAttachments; feedback describes delivered/bounced/complained events.

Mail type exports: OutboundEmail, EmailAddress, EmailAttachment, MailerSendOptions/Result, MailerCapabilities, MailerFeedbackEvent, MailerDelivery, MailerOptional, MailerSendRequired, MailerBatchRequired; MailerPort, ConsoleMailerAdapter and InMemoryMailerAdapter (type aliases only), core Clock with nowMs() (not re-exported), DeliveryReadinessPolicy. `MailSuppressionRepoPort` provides isSuppressed/suppress with workspace/address/scope and reason; `MailSendDedupRepoPort` provides wasSent/markSent with workspace/key. The gate does not invoke those ports.

Adapter type exports: MailAdapterCredential (token, optional baseUrl/username), MailAdapterKit (httpClient), MailAdapterCreateContext (credential/kit), MailAdapterModule with `create(context): MailerPort`. There is no concrete provider adapter on `./mail`.

SMTP exports `new SmtpMailerAdapter({ transport: SmtpTransport, clock })` and `createNodemailerSmtpTransport(config: CreateNodemailerSmtpTransportConfig, { timeoutMs? } = {}): SmtpTransport`. Config requires host/port/secure/auth user-pass/nodemailer: NodemailerPort. Transport provides `sendMail({ mail: SmtpMailPayload }): Promise<{ messageId }>`; payload maps email names to address fields and attachment data to base64 encoding. `NodemailerPort.createTransport(config): NativeSmtpTransport`; native sendMail takes the payload directly. All SMTP interfaces above are exported. No nodemailer package is imported.

```ts
import { wrapMailerWithPurposeGate } from '@jini-ai/platform/mail';
import { SmtpMailerAdapter, createNodemailerSmtpTransport } from '@jini-ai/platform/mail/smtp';
const smtp = createNodemailerSmtpTransport({ host: 'smtp.example.test', port: 465, secure: true,
  auth: credentials.smtp, nodemailer: hostNodemailer }, { timeoutMs: 5000 });
const mailer = wrapMailerWithPurposeGate({ inner: new SmtpMailerAdapter({ transport: smtp,
  clock: { nowMs: () => Date.now() } }), mode: 'production', readiness: hostDeliveryReadiness });
```


## Network policy and locks

`./net` exports `expandIpv6({ address }): number[] | null`, `isPrivateAddress({ address }): boolean`, `isLoopbackApiHost({ hostname }): boolean`, `isBlockedExternalApiHostname({ hostname }): boolean`, and `isLoopbackHostname({ hostname: unknown }, {} = {}): boolean`. Strict resolved-address refusal is separate from provider-host policy, which intentionally allows loopback. Root `isPrivateAddress` uses the same canonical implementation.

`./fs/file-lock` exports `withFileLock({ lockPath, run }, options = {}): Promise<T>` and synchronous `withFileLockSync({ lockPath, run }, options = {}): T`. Callbacks receive the held lock; `assertHeld({})` verifies authority. Options include clock (core Clock), timeoutMs (15000), staleMs (10000), pollMs (10), filesystem, process liveness, sleep, token/hostname, parent creation, holder format, messages, timeout copy and release-error policy. `isLockStale` compares time/owner liveness and observed/current inode/device; `isContendedLockError` classifies native contention. Holder/handle/native filesystem types and timeout/lost error classes are exported from this subpath. `./fs` re-exports the two lock runners and stale predicate.

`writeFileAtomicAsync({ filePath, content }, { fs?, createParent?, ...AtomicWriteOptions } = {}): Promise<void>` and `writeJsonFileAtomicAsync({ filePath, data }, { fs?, createParent?, trailingNewline?, ...AtomicWriteOptions } = {}): Promise<void>` are exported by `./fs`. Async fs follows native fs/promises shapes. HTTP DTOs and HttpClientPort are imported from core/primitives, not declared/exported by the guarded entry; it exports `GuardedClock = Clock & { timeoutSignal({ timeoutMs }): AbortSignal }`.

`defaultPlatformMessages` and `PlatformMessages` provide replaceable neutral diagnostics. Analytics now imports from `@jini-ai/analytics`; trash from `@jini-ai/cms/trash`. Platform ships neither old subpath nor forwarding alias.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `AtomicAsyncFilesystem`, `AtomicNativeFilesystem` | type; [atomic-write.ts](../../src/fs/atomic-write.ts) |
| `DEFAULT_LOCK_STALE_AFTER_MS`, `DEFAULT_LOCK_TIMEOUT_MS` | const; [file-lock.ts](../../src/fs/file-lock.ts) |
| `FileLockAsyncFilesystem`, `FileLockSyncFilesystem` | type; [file-lock.ts](../../src/fs/file-lock.ts) |
| `FileLockHolder`, `HeldFileLock`, `HeldFileLockSync` | interface; [file-lock.ts](../../src/fs/file-lock.ts) |
| `FileLockLostError`, `FileLockTimeoutError` | class; [file-lock.ts](../../src/fs/file-lock.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./fetch-with-timeout`, `./secrets`, `./secrets/credential-sets`, `./secrets/testing`, `./http/guarded`, `./mail`, `./mail/smtp`, `./fs/guarded-reader`, `./fs/durable-json`, `./fs`, `./net`, `./fs/file-lock`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
