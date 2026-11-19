import type { AttachmentRecord } from './attachment-types.js';
import { type TimestampedAttachmentRecord, SIDECAR_DIRECTORY_NAME, readPersistedAttachment, writePersistedAttachment } from './attachment-sidecars.js';
import { verifyClaimedAttachments } from './attachment-integrity.js';
import { resolve } from 'node:path';
import { mkdir, readdir, rm, rmdir } from 'node:fs/promises';


/**
 * `true` when the file this record describes is still byte-for-byte the file registration accepted.
 *
 * Deliberately `verifyClaimedAttachments` rather than a looser existence check: adoption must apply
 * the SAME `dev`/`ino`/`size`/`realpath` gate `claim()` applies, or a restart would become the one
 * moment at which a file swapped underneath the store gets handed to an agent anyway.
 */
/** The record, now timestamped, when its file is still the one registration accepted; else `undefined`. */
async function adoptableAttachment(record: AttachmentRecord): Promise<TimestampedAttachmentRecord | undefined> {
  try {
    await verifyClaimedAttachments({ claimed: [record] });
  } catch {
    return undefined;
  }
  // A successful verification backfills both timestamps in place (`record.mtimeMs ??= ...`).
  return record as TimestampedAttachmentRecord;
}

function needsAttachmentTimestampBackfill(
  { record }: { readonly record: AttachmentRecord | undefined },
  _options = {},
): boolean {
  return record?.mtimeMs === undefined || record?.ctimeMs === undefined;
}

/**
 * Rebuilds the record map from the sidecar directory, adopting only records that are (a) well
 * formed and contained, (b) still within the retention window, and (c) still backed by the exact
 * file registration accepted. Anything failing any of those is deleted — sidecar first, then the
 * file it named, and the file ONLY when containment passed, so an unparseable sidecar can never
 * make this an arbitrary-file-delete primitive for whatever the daemon can unlink.
 * Legacy records use their original identity checks before timestamps are backfilled atomically.
 * A backfill write failure propagates before cleanup, preserving the attachment for a later retry.
 *
 * **The retention consequence, stated rather than assumed harmless.** Because `claimedRunId` is not
 * persisted (see {@link PersistedAttachmentRecord}), a file claimed by a run that died with the
 * process is adopted as unclaimed instead of being wiped, so it now occupies disk and quota for up
 * to `retentionMs` rather than until the next start. Bounded by the same `maxStoredAttachments` /
 * `maxStoredBytes` quotas as any live upload, and cleared by the `pruneExpired` every upload
 * already runs — but it is a real change in when that disk comes back.
 *
 * @complexity O(n) in sidecars present, each costing one read and one `lstat`/`realpath` pair.
 */
export async function loadPersistedAttachments(requiredArgs: Omit<{ readonly canonicalUploadDirectory: string; readonly retentionMs: number; readonly now?: number }, 'now'>, optionalArgs: Pick<{ readonly canonicalUploadDirectory: string; readonly retentionMs: number; readonly now?: number }, 'now'> = {}): Promise<Map<string, AttachmentRecord>> {
  const {
    canonicalUploadDirectory,
    retentionMs,
    now = Date.now(),
  }: { readonly canonicalUploadDirectory: string; readonly retentionMs: number; readonly now?: number } = { ...requiredArgs, ...optionalArgs };
  const sidecarDirectory = resolve(canonicalUploadDirectory, SIDECAR_DIRECTORY_NAME);
  await mkdir(sidecarDirectory, { recursive: true, mode: 0o700 });
  const adopted = new Map<string, AttachmentRecord>();
  for (const entry of await readdir(sidecarDirectory)) {
    const record = await adoptOrDiscardSidecar({ sidecarPath: resolve(sidecarDirectory, entry), canonicalUploadDirectory, retentionMs, now });
    if (record) adopted.set(record.id, record);
  }
  return adopted;
}

/**
 * One sidecar of {@link loadPersistedAttachments}: the adopted (timestamp-backfilled) record, or
 * `undefined` after deleting the sidecar and — only when its record parsed, i.e. passed
 * containment — the file it named. @complexity O(1) file operations.
 */
async function adoptOrDiscardSidecar({ sidecarPath, canonicalUploadDirectory, retentionMs, now }: {
  readonly sidecarPath: string; readonly canonicalUploadDirectory: string; readonly retentionMs: number; readonly now: number;
}): Promise<TimestampedAttachmentRecord | undefined> {
  const record = await readPersistedAttachment(sidecarPath, canonicalUploadDirectory);
  const needsBackfill = needsAttachmentTimestampBackfill({ record });
  const adoptable = record && now - record.createdAt < retentionMs ? await adoptableAttachment(record) : undefined;
  if (adoptable) {
    if (needsBackfill) await writePersistedAttachment({ record: adoptable, sidecarPath });
    return adoptable;
  }
  await rm(sidecarPath, { force: true });
  if (record) await rm(record.filePath, { force: true });
  return undefined;
}

/** Deletes everything in one batch directory that no adopted record names, then tidies the
 *  directory away if that emptied it. A root entry that is not a directory at all is removed
 *  outright — the store never creates one, so it can only be debris. */
async function removeUnadoptedBatch(batchDirectory: string, keep: ReadonlySet<string>): Promise<void> {
  const entries = await readdir(batchDirectory).catch(() => undefined);
  if (entries === undefined) {
    await rm(batchDirectory, { force: true });
    return;
  }
  for (const entry of entries) {
    const filePath = resolve(batchDirectory, entry);
    if (!keep.has(filePath)) await rm(filePath, { recursive: true, force: true });
  }
  await rmdir(batchDirectory).catch(() => undefined);
}

/**
 * Removes every upload the sidecar pass did not adopt. Without this, a file whose sidecar was lost
 * (or was never written, because it predates this option) would survive forever with nothing
 * tracking it — trading the wipe's data loss for unbounded disk growth, which is not a trade worth
 * making. This is what keeps "never wipe on construction" bounded.
 */
export async function removeUnadoptedUploads({ canonicalUploadDirectory, adopted }: { readonly canonicalUploadDirectory: string; readonly adopted: ReadonlyMap<string, AttachmentRecord> }, _optional: Record<string, never> = {}
): Promise<void> {
  const keep = new Set([...adopted.values()].map((record) => record.filePath));
  for (const entry of await readdir(canonicalUploadDirectory)) {
    if (entry === SIDECAR_DIRECTORY_NAME) continue;
    await removeUnadoptedBatch(resolve(canonicalUploadDirectory, entry), keep);
  }
}

/**
 * Decides what a newly-constructed store starts holding: nothing (the default — empty the directory
 * outright, this pack's behavior before `retainAcrossRestarts` existed), or the authenticated
 * survivors of the previous process.
 *
 * Exported so the whole restart decision can be exercised without standing a store up around it.
 */
export async function prepareAttachmentStorage(requiredArgs: Omit<{ readonly canonicalUploadDirectory: string; readonly retainAcrossRestarts: boolean; readonly retentionMs: number; readonly now?: number }, 'now'>, optionalArgs: Pick<{ readonly canonicalUploadDirectory: string; readonly retainAcrossRestarts: boolean; readonly retentionMs: number; readonly now?: number }, 'now'> = {}): Promise<Map<string, AttachmentRecord>> {
  const {
    canonicalUploadDirectory,
    retainAcrossRestarts,
    retentionMs,
    now,
  }: { readonly canonicalUploadDirectory: string; readonly retainAcrossRestarts: boolean; readonly retentionMs: number; readonly now?: number } = { ...requiredArgs, ...optionalArgs };
  if (!retainAcrossRestarts) {
    for (const entry of await readdir(canonicalUploadDirectory)) {
      await rm(resolve(canonicalUploadDirectory, entry), { recursive: true, force: true });
    }
    return new Map();
  }
  const adopted = await loadPersistedAttachments({ canonicalUploadDirectory, retentionMs, ...(now === undefined ? {} : { now }) });
  await removeUnadoptedUploads({ canonicalUploadDirectory, adopted });
  return adopted;
}
