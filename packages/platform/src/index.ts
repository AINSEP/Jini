/**
 * @module @injini/platform
 *
 * Root barrel for generic OS/platform primitives. This file adds no behavior —
 * it only re-exports the public surface from the cohesive sibling modules:
 *
 * - `command`    — cross-platform command-invocation construction.
 * - `process`    — process lifecycle, stamps, snapshots, and stop escalation.
 * - `proxy-env`  — system proxy discovery and proxy-aware env merging.
 * - `fs`         — filesystem containment, atomic copy, removal, log tails.
 * - `http`       — HTTP readiness polling.
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
  isPrivateAddress,
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
