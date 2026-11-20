import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { type NormalizedTarget, type ReusableState, type DownloadManifest, type ManagedDownloadProgress, type ManagedDownloadResult, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES } from './download-types.js';
import { resetOwnedTarget, readManifest, pathExists, manifestMatchesTarget, hashFile, statFileSize, ensureManagedBase, writeJson, createManifest, errorMessage } from './download-store.js';
import { pruneManagedDownloads } from './download-maintenance.js';
import { acquireLock, releaseLock } from './download-lock.js';
import { downloadWithRetries } from './download-transfer.js';
async function suspiciousReset({ target }: { target: NormalizedTarget }, _options = {}): Promise<ReusableState> {
  await resetOwnedTarget({ target });
  return { manifest: null, reset: true };
}

async function loadReusableState(target: NormalizedTarget): Promise<ReusableState> {
  const manifest = await readManifest(target.manifestPath);
  const finalExists = await pathExists(target.finalPath);
  const partialExists = await pathExists(target.partialPath);
  if (manifest === "invalid") {
    return await suspiciousReset({ target });
  }
  if (manifest == null) {
    return finalExists || partialExists ? await suspiciousReset({ target }) : { manifest: null };
  }
  if (!manifestMatchesTarget(manifest, target)) {
    return await suspiciousReset({ target });
  }
  if (manifest.state === "complete") return await reusableCompleteState({ manifest, target });
  if (!partialExists) return await suspiciousReset({ target });
  return { manifest };
}

/** Reuse a complete download only when its final file exists and still hashes to the requested checksum. */
async function reusableCompleteState(input: { manifest: DownloadManifest; target: NormalizedTarget }): Promise<ReusableState> {
  const { manifest, target } = input;
  // A missing final file needs no separate check: hashing it rejects, which
  // maps to `null` and fails the checksum comparison into the same reset.
  const actual = await hashFile(target.finalPath, target.checksum.algorithm).catch(() => null);
  if (actual !== target.checksum.value) return await suspiciousReset({ target });
  const bytes = await statFileSize(target.finalPath);
  if (bytes == null) return await suspiciousReset({ target });
  return {
    manifest,
    result: {
      bucket: target.bucket,
      bytes,
      checksum: target.checksum,
      fileName: target.fileName,
      path: target.finalPath,
      reusedComplete: true,
      resumed: false,
      urlDigest: target.urlDigest,
    },
  };
}

export async function runManagedDownload(
  target: NormalizedTarget,
  options: {
    emit: (progress: ManagedDownloadProgress) => void;
    fetchImpl: typeof globalThis.fetch;
    maxAttempts: number;
    requestHeaders?: Record<string, string> | undefined;
  },
): Promise<ManagedDownloadResult> {
  await ensureManagedBase(target.basePath);
  await pruneManagedDownloads({ basePath: target.basePath }).catch(() => undefined);
  const lock = await acquireLock(target);
  try {
    const state = await loadStateAllowingOneReset({ target });
    if (state.result != null) return state.result;
    const download = await downloadWithRetries(target, state.manifest, options);
    const bytes = await promoteVerifiedPartial({ target });
    await writeJson(target.manifestPath, createManifest(target, "complete", { totalBytes: download.totalBytes }));
    return {
      bucket: target.bucket,
      bytes,
      checksum: target.checksum,
      fileName: target.fileName,
      path: target.finalPath,
      reusedComplete: false,
      resumed: download.resumed,
      urlDigest: target.urlDigest,
    };
  } finally {
    await releaseLock(lock);
  }
}

/** Reload once after target cleanup, retaining the lock until the run finishes. */
async function loadStateAllowingOneReset({ target }: { target: NormalizedTarget }, _options = {}): Promise<ReusableState> {
  const state = await loadReusableState(target);
  if (state.reset !== true) return state;
  // Whole-base cleanup used to remove the lock and require re-acquisition.
  // Keep it throughout target cleanup so another process cannot take it
  // before we write fresh state, or have its own lock deleted by our finally.
  await ensureManagedBase(target.basePath);
  const reloaded = await loadReusableState(target);
  if (reloaded.reset === true) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT, "download state kept resetting after target cleanup");
  }
  return reloaded;
}

/** Verify the downloaded partial's checksum, promote it to the final path, and return the final size. */
async function promoteVerifiedPartial({ target }: { target: NormalizedTarget }, _options = {}): Promise<number> {
  const actual = await hashFile(target.partialPath, target.checksum.algorithm).catch((error: unknown) => {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT, `downloaded partial could not be hashed: ${errorMessage(error)}`);
  });
  if (actual !== target.checksum.value) {
    await resetOwnedTarget({ target }).catch(() => undefined);
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.CHECKSUM_MISMATCH, "downloaded file checksum did not match requested payload", {
      actual,
      expected: target.checksum.value,
    });
  }

  await mkdir(dirname(target.finalPath), { recursive: true });
  if (await pathExists(target.finalPath)) {
    const existing = await hashFile(target.finalPath, target.checksum.algorithm).catch(() => null);
    if (existing !== target.checksum.value) {
      await resetOwnedTarget({ target }).catch(() => undefined);
      throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT, "existing complete file did not match requested payload");
    }
    await rm(target.partialPath, { force: true }).catch(() => undefined);
  } else {
    await rename(target.partialPath, target.finalPath);
  }
  const bytes = await statFileSize(target.finalPath);
  if (bytes == null) throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_CORRUPT, "complete file is missing after promotion");
  return bytes;
}
