/**
 * @module download
 *
 * A managed-download engine: content-addressable atomic downloads with resume, checksum
 * verification, cross-process locking, a durable manifest, retention pruning, and a
 * copy-and-clear helper for one-shot consumers. Builds on this package's own `fs`/`process`
 * primitives (`atomicCopyFile`, `pathContains`, `removePathBestEffort`, `isProcessAlive`) — no
 * other cross-module dependency.
 */
import { resolve } from "node:path";
import { atomicCopyFile } from "./fs.js";
import { type ActiveTask, type CopyLeaseState, type ManagedDownloadOptions, type ManagedDownloadResult, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES, type ManagedDownloadProgress, type NormalizedTarget, type CopyLease, type DownloadCopyAndClearOptions, type DownloadCopyAndClearResult } from './download-types.js';
import { targetFromOptions, activeKey, targetActiveKey, activeTargets } from './download-target.js';
import { runManagedDownload } from './download-state.js';
import { removeManagedDownload } from './download-maintenance.js';
import { statFileSize, hashFile, errorMessage } from './download-store.js';
const DEFAULT_MAX_ATTEMPTS = 3;

const activeTasks = new Map<string, ActiveTask>();
const copyLeases = new Map<string, CopyLeaseState>();

function waitForTask(
  task: ActiveTask,
  options: Pick<ManagedDownloadOptions, "onProgress" | "signal">,
): Promise<ManagedDownloadResult> {
  return new Promise<ManagedDownloadResult>((resolveWait, rejectWait) => {
    if (options.signal?.aborted) {
      rejectWait(new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.ABORTED, "download wait was aborted"));
      return;
    }
    const listener = options.onProgress;
    if (listener != null) task.listeners.add(listener);
    const cleanup = () => {
      if (listener != null) task.listeners.delete(listener);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      rejectWait(new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.ABORTED, "download wait was aborted"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    task.promise.then(
      (result) => {
        cleanup();
        resolveWait(result);
      },
      (error: unknown) => {
        cleanup();
        rejectWait(error);
      },
    );
  });
}

export async function managedDownload(options: ManagedDownloadOptions): Promise<ManagedDownloadResult> {
  const target = targetFromOptions(options);
  const key = activeKey(target);
  const targetKey = targetActiveKey(target);
  const existingForTarget = activeTargets.get(targetKey);
  if (existingForTarget != null && existingForTarget !== key) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.TARGET_CONFLICT, `download target is already active with a different identity: ${target.bucket}/${target.fileName}`);
  }
  const existing = activeTasks.get(key);
  if (existing != null) return await waitForTask(existing, options);

  const listeners = new Set<(progress: ManagedDownloadProgress) => void>();
  const emit = (progress: ManagedDownloadProgress) => {
    for (const listener of listeners) listener(progress);
  };
  const task: ActiveTask = {
    listeners,
    targetKey,
    promise: runManagedDownload(target, {
      emit,
      fetchImpl: options.fetch ?? globalThis.fetch,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      requestHeaders: options.payload.headers,
    }),
  };
  activeTasks.set(key, task);
  activeTargets.set(targetKey, key);
  task.promise.finally(() => {
    activeTasks.delete(key);
    if (activeTargets.get(targetKey) === key) activeTargets.delete(targetKey);
  }).catch(() => undefined);
  return await waitForTask(task, options);
}

function acquireCopyLease(target: NormalizedTarget): CopyLease {
  const key = targetActiveKey(target);
  const state = copyLeases.get(key) ?? { clearRequested: false, count: 0, removeOptions: null };
  state.count += 1;
  copyLeases.set(key, state);
  return { key };
}

async function requestClearAfterCopy(target: NormalizedTarget): Promise<"deferred" | "removed"> {
  const key = targetActiveKey(target);
  const state = copyLeases.get(key);
  if (state != null && state.count > 1) {
    state.clearRequested = true;
    state.removeOptions = { basePath: target.basePath, bucket: target.bucket, fileName: target.fileName };
    return "deferred";
  }
  await removeManagedDownload({ basePath: target.basePath, bucket: target.bucket, fileName: target.fileName });
  return "removed";
}

async function releaseCopyLease(lease: CopyLease): Promise<void> {
  // `acquireCopyLease` always populates `copyLeases.get(key)` synchronously
  // before returning a lease, and this module's only caller
  // (`downloadCopyAndClear`) releases each lease exactly once, in its own
  // `finally` block — both functions are fully synchronous (no `await`
  // inside either), so there is no interleaving window in which another
  // caller could delete the entry first. The map entry is therefore always
  // present here.
  const state = copyLeases.get(lease.key)!;
  state.count -= 1;
  if (state.count > 0) return;
  copyLeases.delete(lease.key);
  if (state.clearRequested && state.removeOptions != null) {
    await removeManagedDownload(state.removeOptions).catch(() => undefined);
  }
}

export async function downloadCopyAndClear(options: DownloadCopyAndClearOptions): Promise<DownloadCopyAndClearResult> {
  const target = targetFromOptions(options);
  if (typeof options.outputPath !== "string" || options.outputPath.length === 0 || options.outputPath.includes("\0")) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, "outputPath must be a non-empty path");
  }
  // `path.resolve()` always returns an absolute path by contract (same
  // guarantee `normalizeBasePath` above already relies on), so a follow-up
  // `isAbsolute` check here could never be false for any string input.
  const outputPath = resolve(options.outputPath);
  const lease = acquireCopyLease(target);
  try {
    const downloaded = await managedDownload(options);
    const existingOutput = await statFileSize(outputPath);
    if (existingOutput != null) {
      const existingDigest = await hashFile(outputPath, target.checksum.algorithm).catch(() => null);
      if (existingDigest !== target.checksum.value) {
        throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.OUTPUT_CONFLICT, `output already exists with different bytes: ${outputPath}`);
      }
    } else {
      await atomicCopyFile({ sourcePath: downloaded.path, destinationPath: outputPath });
      const copiedDigest = await hashFile(outputPath, target.checksum.algorithm);
      if (copiedDigest !== target.checksum.value) {
        throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.CHECKSUM_MISMATCH, "copied output checksum did not match requested payload");
      }
    }
    let cleanup: "deferred" | "removed" = "removed";
    let cleanupWarning: string | undefined;
    try {
      cleanup = await requestClearAfterCopy(target);
    } catch (error) {
      cleanupWarning = errorMessage(error);
    }
    return {
      bytes: downloaded.bytes,
      cleanup,
      ...(cleanupWarning == null ? {} : { cleanupWarning }),
      outputPath,
      reusedComplete: downloaded.reusedComplete,
      resumed: downloaded.resumed,
    };
  } finally {
    await releaseCopyLease(lease);
  }
}
