import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { removePathBestEffort } from "./fs.js";
import { type RemoveManagedDownloadOptions, type ManagedDownloadInspection, type RemoveManagedDownloadResult, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES, type PruneManagedDownloadsOptions, type PruneManagedDownloadsResult, STATE_DIR, PARTIAL_DIR, LOCK_DIR } from './download-types.js';
import { targetWithoutPayload, activeTargets, targetActiveKey, normalizeBasePath } from './download-target.js';
import { ensureManagedBase, readManifest, pathExists } from './download-store.js';
const DEFAULT_PRUNE_OLDER_THAN_MS = 24 * 60 * 60 * 1000;

export async function inspectManagedDownload(options: RemoveManagedDownloadOptions): Promise<ManagedDownloadInspection> {
  const target = targetWithoutPayload(options);
  await ensureManagedBase(target.basePath);
  const rawManifest = await readManifest(target.manifestPath);
  const manifest = rawManifest === "invalid" ? "unreadable" : rawManifest?.state ?? "missing";
  return {
    bucket: target.bucket,
    complete: await pathExists(target.finalPath),
    fileName: target.fileName,
    manifest,
    path: target.finalPath,
  };
}

export async function removeManagedDownload(options: RemoveManagedDownloadOptions): Promise<RemoveManagedDownloadResult> {
  const target = targetWithoutPayload(options);
  if (activeTargets.has(targetActiveKey(target))) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.TARGET_LOCKED, `download target is active: ${target.bucket}/${target.fileName}`);
  }
  await ensureManagedBase(target.basePath);
  await Promise.all([
    removePathBestEffort({ path: target.finalPath }),
    removePathBestEffort({ path: target.partialPath }, { recursive: false }),
    removePathBestEffort({ path: target.manifestPath }, { recursive: false }),
    removePathBestEffort({ path: target.lockPath }, { recursive: false }),
  ]);
  const bucketPath = join(target.basePath, target.bucket);
  const entries = await readdir(bucketPath).catch(() => null);
  if (entries != null && entries.length === 0) await rm(bucketPath, { force: true, recursive: true }).catch(() => undefined);
  return { removed: true };
}

async function removeEntriesOlderThan(root: string, olderThan: number): Promise<{ removed: number; warnings: string[] }> {
  const warnings: string[] = [];
  let removed = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    const info = await stat(path).catch(() => null);
    if (info == null || info.mtimeMs > olderThan) continue;
    const result = await removePathBestEffort({ path });
    // A successful removal never carries an error, so the two checks are exclusive.
    if (result.removed) removed += 1;
    if (result.error != null) warnings.push(result.error);
  }
  return { removed, warnings };
}

export async function pruneManagedDownloads(options: PruneManagedDownloadsOptions): Promise<PruneManagedDownloadsResult> {
  const basePath = normalizeBasePath(options.basePath);
  await ensureManagedBase(basePath);
  const olderThan = (options.now?.getTime() ?? Date.now()) - (options.olderThanMs ?? DEFAULT_PRUNE_OLDER_THAN_MS);
  const roots = [join(basePath, STATE_DIR), join(basePath, PARTIAL_DIR), join(basePath, LOCK_DIR)];
  let removed = 0;
  const warnings: string[] = [];
  for (const root of roots) {
    const result = await removeEntriesOlderThan(root, olderThan);
    removed += result.removed;
    warnings.push(...result.warnings);
  }
  const bucketEntries = await readdir(basePath, { withFileTypes: true }).catch(() => []);
  for (const entry of bucketEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const result = await removeEntriesOlderThan(join(basePath, entry.name), olderThan);
    removed += result.removed;
    warnings.push(...result.warnings);
    const remaining = await readdir(join(basePath, entry.name)).catch(() => null);
    if (remaining != null && remaining.length === 0) await rm(join(basePath, entry.name), { force: true, recursive: true }).catch(() => undefined);
  }
  return { removed, warnings };
}
