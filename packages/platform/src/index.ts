/**
 * @module @jini-ai/platform
 *
 * Root barrel for generic OS/platform primitives. This file adds no behavior —
 * it only re-exports the public surface from the cohesive sibling modules:
 *
 * - `command`    — cross-platform command-invocation construction.
 * - `process`    — process lifecycle, stamps, snapshots, and stop escalation.
 * - `proxy-env`  — system proxy discovery and proxy-aware env merging.
 * - `fs`         — filesystem containment, atomic copy, removal, log tails.
 * - `http`       — HTTP readiness polling.
 * - `fetch-with-timeout` — the shared `AbortSignal`-timeout wrapper every outbound `fetch()` call
 *   in this monorepo is meant to go through (2026-08-16 failure-mode audit, Finding 2).
 * - `toolchain`  — user-level toolchain bin discovery.
 * - `asset-cache` — SSRF-safe same-origin cache/proxy for sandboxed content's
 *   external media references.
 * - `home-expansion` — `~`/`$HOME` shorthand expansion for env-supplied paths.
 * - `sandbox-env` — sandboxed agent-execution directory tree + env overlay.
 * - `resource-paths` — daemon CLI/resource-root/data-dir path resolution.
 * - `terminal` — in-memory interactive terminal (PTY) session manager.
 * - `download`    — managed-download engine (atomic resume, checksum, lock,
 *   manifest, retention pruning).
 * - `shell`       — buffered command execution that re-enters the login
 *   shell so profile-only `PATH` entries are visible.
 * - `aws-sigv4`   — AWS Signature V4 request signing (no `@aws-sdk/*` dependency).
 * - `blob-storage` — a backend-agnostic blob storage port + local-disk and
 *   S3-compatible implementations.
 *
 * The set of names exported here is intentionally identical to the pre-split
 * public surface; importers see no change.

 * Archived provenance rationale:
 * ## Design decision: `project-storage.ts` was split, not ported wholesale or dropped
 *
 * The task brief asked to verify the recon's "leans OD" flag on
 * `project-storage.ts` firsthand and either drop it or extract a generic core
 * with OD's project-specific parts as an adapter, "depending on what you
 * actually find." Read in full: the `ProjectStorage` interface,
 * `LocalProjectStorage`, and `S3ProjectStorage` classes carry no OD nouns in
 * their own logic — they're a backend-agnostic blob CRUD port (read/write/
 * list/delete/stat under a scoping key) plus a local-disk and an
 * S3-compatible implementation, both traversal-guarded. The **only** OD
 * coupling in the file is the bottom `resolveProjectStorage()` factory
 * function, which reads `OD_PROJECT_STORAGE`/`OD_S3_BUCKET`/`OD_S3_REGION`/
 * `OD_S3_PREFIX`/`OD_S3_ENDPOINT`/`OD_S3_ACCESS_KEY_ID`/
 * `OD_S3_SECRET_ACCESS_KEY`/`OD_S3_SESSION_TOKEN` directly from `process.env`.
 *
 * **Extracted, not dropped:** the interface + both implementations, ported to
 * `src/blob-storage.ts` as `BlobStorage`/`BlobFileMeta`/`LocalBlobStorage`/
 * `S3BlobStorage`/`S3BlobStorageOptions`/`StorageError`, with every
 * `projectId: string` parameter renamed to `namespace: string` — per
 * extraction-plan.md's Task-4 Port-2 finding ("OD's 'project' is a product
 * model; engine needs a generic workspace/session store interface") and §2.1's
 * "Runs key on an opaque `contextRef`, never `projectId`" convention, "project"
 * specifically is flagged elsewhere in this porting effort as OD's noun, not
 * the engine's — `namespace` carries no domain meaning here beyond "a
 * top-level grouping/scoping key," which is what the parameter actually is
 * structurally (nothing in `LocalBlobStorage`/`S3BlobStorage`'s logic assumes
 * it means a design project).
 *
 * **Dropped, not ported:** `resolveProjectStorage()`. This is OD adapter
 * wiring — a specific env-var-naming convention and the choice to read
 * `process.env` directly inside the engine layer — not generic engine
 * behavior. It has no equivalent anywhere else in this porting session's
 * established pattern (`createSqliteEventLog`, `LocalBlobStorage`,
 * `S3BlobStorage` are all called with explicit constructor arguments; none of
 * `@jini/*`'s existing adapters read `process.env` inside their own
 * constructors). A Jini host application composes its own equivalent
 * (`new LocalBlobStorage(root)` or `new S3BlobStorage({ bucket, region,
 * credentials, ... })` called directly, with whatever env-var convention that
 * host prefers) rather than inheriting OD's `OD_S3_*` names or its
 * env-selection shape.
 *
 * Landed in `@jini/platform`, not `@jini/sqlite`: this is a filesystem/network
 * blob-storage primitive with no SQL involvement, parallel to this package's
 * existing `fs.ts` (path containment / atomic copy) and `http.ts` (readiness
 * polling) roles — `@jini/sqlite` is reserved for the `EventLog` port adapter
 * and `better-sqlite3`-specific helpers (`db-inspect.ts`,
 * `backend-config.ts`), none of which this needs. `aws-sigv4.ts` lives
 * alongside it in the same package since it's `S3BlobStorage`'s only
 * dependency and has no other consumer yet.
 */

export type { CommandInvocation, CommandInvocationRequest } from "./command.js";
export { createCommandInvocation, createPackageManagerInvocation } from "./command.js";

export type { ResolveSystemProxyEnvOptions, SystemProxyCommandRunner } from "./proxy-env.js";
export {
  mergeProxyAwareEnv,
  parseMacosScutilProxyOutput,
  parseWindowsInternetSettingsProxyOutput,
  resolveSystemProxyEnv,
} from "./proxy-env.js";

export type {
  ProcessSnapshot,
  ProcessStampContract,
  ProcessStampField,
  ProcessStampShape,
  SpawnProcessRequest,
  StampedProcessMatchCriteria,
  StopProcessesResult,
} from "./process.js";
export {
  collectProcessTreePids,
  createProcessStampArgs,
  isProcessAlive,
  listProcessSnapshots,
  matchesProcessStamp,
  matchesStampedProcess,
  readFlagValue,
  readProcessStamp,
  readProcessStampFromCommand,
  spawnBackgroundProcess,
  spawnLoggedProcess,
  stopProcesses,
  waitForProcessExit,
} from "./process.js";

export type {
  AtomicCopyFileOptions,
  AtomicCopyFileResult,
  RemovePathBestEffortOptions,
  RemovePathBestEffortResult,
} from "./fs.js";
export { atomicCopyFile, pathContains, readLogTail, removePathBestEffort } from "./fs.js";

export type { HttpWaitOptions } from "./http.js";
export { waitForHttpOk } from "./http.js";

export type { FetchWithTimeoutOptions } from "./fetch-with-timeout.js";
export { FETCH_TIMEOUT_MS, FetchTimeoutError, fetchWithTimeout } from "./fetch-with-timeout.js";

export type { WellKnownUserToolchainOptions } from "./toolchain.js";
export { wellKnownUserToolchainBins } from "./toolchain.js";

export type { BufferedCommandResult } from "./shell.js";
export { execCommandViaLoginShell, execFileBuffered } from "./shell.js";

export type { AssetCache, AssetCacheOptions, AssetCacheResult } from "./asset-cache.js";
export {
  AssetCacheError,
  assertSafePublicUrl,
  assetCacheKey,
  assetCacheRewriteUrl,
  createAssetCache,
  createValidatingLookup,
  isCacheableExternalUrl,
} from "./asset-cache.js";

export { expandHomePrefix, resolveProjectRelativePath } from "./home-expansion.js";

export type { SandboxEnvConfig, SandboxRuntimeConfig, SandboxRuntimeRoots } from "./sandbox-env.js";
export {
  applySandboxRuntimeEnv,
  ensureSandboxRuntimeDirs,
  isSandboxImportedProjectRootAllowed,
  isSandboxModeEnabled,
  resolveSandboxRuntimeConfig,
  resolveSandboxRuntimeConfigFromEnv,
  sandboxAgentProfilesConfigPath,
  sandboxImportAllowedRoots,
  sandboxImportedProjectRootUnavailableReason,
} from "./sandbox-env.js";

export type {
  ResolveDaemonPluginPreviewsDirOptions,
  ResolveDaemonResourceRootOptions,
  ResolveDataDirOptions,
  ResourcePathsConfig,
} from "./resource-paths.js";
export {
  resolveDaemonCliPath,
  resolveDaemonPluginPreviewsDir,
  resolveDaemonResourceDir,
  resolveDaemonResourceRoot,
  resolveDataDir,
  resolveProcessResourcesPath,
} from "./resource-paths.js";

export type {
  CreateTerminalOptions,
  CreateTerminalServiceOptions,
  PtyProcess,
  PtySpawn,
  PtySpawnOptions,
  TerminalEventData,
  TerminalEventRecord,
  TerminalService,
  TerminalSession,
  TerminalSseSink,
} from "./terminal.js";
export { createTerminalService, ensureSpawnHelperExecutable, resolveShell, spawnHelperCandidatePaths } from "./terminal.js";

export type {
  DownloadCopyAndClearOptions,
  DownloadCopyAndClearResult,
  ManagedDownloadChecksum,
  ManagedDownloadErrorCode,
  ManagedDownloadInspection,
  ManagedDownloadOptions,
  ManagedDownloadPayload,
  ManagedDownloadProgress,
  ManagedDownloadResult,
  PruneManagedDownloadsOptions,
  PruneManagedDownloadsResult,
  RemoveManagedDownloadOptions,
  RemoveManagedDownloadResult,
} from "./download.js";
export {
  MANAGED_DOWNLOAD_ERROR_CODES,
  ManagedDownloadError,
  downloadCopyAndClear,
  inspectManagedDownload,
  managedDownload,
  pruneManagedDownloads,
  removeManagedDownload,
} from "./download.js";

export type { SigV4Credentials, SignSigV4Input, SignSigV4Result } from "./aws-sigv4.js";
export { encodeS3PathSegment, signSigV4 } from "./aws-sigv4.js";

export type { BlobFileMeta, BlobStorage, S3BlobStorageOptions } from "./blob-storage.js";
export { LocalBlobStorage, S3BlobStorage, StorageError } from "./blob-storage.js";

// Cohesive subpaths remain available as namespaced APIs without colliding with legacy names.
export * as filesystem from "./fs/index.js";
export * as guardedHttp from "./http/guarded/index.js";
export * as mail from "./mail/index.js";
export * as smtp from "./mail/smtp.js";
export * as secrets from "./secrets/index.js";
export * as credentialSets from "./secrets/credential-sets/index.js";

export { isPrivateAddress } from "./net/address.js";

export { defaultPlatformMessages } from "./messages.js";
export type { PlatformMessages } from "./messages.js";
