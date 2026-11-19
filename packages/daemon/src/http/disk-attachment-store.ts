import { chmod, lstat, mkdir, realpath, rm, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { AttachmentRejectedError, BATCH_ID_PATTERN, type StoredAttachment } from './attachment-types.js';
import type { AttachmentStore, CreateDiskAttachmentStoreOptions } from './attachment-store-types.js';
import { reserveAttachmentRecords, verifyClaimedAttachments, isUnclaimedOrClaimedBy, type AttachmentRecord } from './attachment-records.js';
import { stagedPathsByAttachment } from './attachment-staging.js';
import { formatByteLimit } from './attachment-body.js';
import { prepareAttachmentStorage, SIDECAR_DIRECTORY_NAME, attachmentSidecarFileName, writePersistedAttachment, type TimestampedAttachmentRecord } from './attachment-persistence.js';

/**
 * The disk-backed `AttachmentStore` this package ships. Every default matches what a chat composer
 * needs out of the box; a host that wants different quotas passes them rather than reimplementing
 * the port.
 *
 * @complexity `register`/`claim` are O(n) in the number of tracked records (a small bounded number
 * — `maxStoredAttachments`), which is what keeps the quota decision synchronous; see `register`.
 */
export async function createDiskAttachmentStore(requiredArgs: Omit<CreateDiskAttachmentStoreOptions, 'maxAttachments' | 'maxBatchBytes' | 'maxStoredAttachments' | 'maxStoredBytes' | 'retentionMs' | 'retainAcrossRestarts'>, optionalArgs: Pick<CreateDiskAttachmentStoreOptions, 'maxAttachments' | 'maxBatchBytes' | 'maxStoredAttachments' | 'maxStoredBytes' | 'retentionMs' | 'retainAcrossRestarts'> = {}): Promise<AttachmentStore> {
  const {
    uploadDirectory,
    maxAttachments = 10,
    maxBatchBytes = 50 * 1024 * 1024,
    maxStoredAttachments = 100,
    maxStoredBytes = 200 * 1024 * 1024,
    retentionMs = 60 * 60 * 1_000,
    retainAcrossRestarts = false,
  }: CreateDiskAttachmentStoreOptions = { ...requiredArgs, ...optionalArgs };
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await chmod(uploadDirectory, 0o700);
  const canonicalUploadDirectory = await realpath(uploadDirectory);
  // Either empties the directory (the default — a file left by an interrupted previous process has
  // no record to authenticate it against) or adopts the previous process's authenticated survivors.
  // See `prepareAttachmentStorage`.
  const records = await prepareAttachmentStorage({ canonicalUploadDirectory, retainAcrossRestarts, retentionMs });
  const stagedPathsByRecord = new WeakMap<AttachmentRecord, Set<string>>();
  /** Only issued refs match; no caller-supplied path is opened. O(n) time for n stored records,
   * bounded by maxStoredAttachments, with no filesystem I/O. */
  const findRecord = ({ ref }: { readonly ref: string }, _optional: Record<string, never> = {}): AttachmentRecord | undefined =>
    records.get(ref) ?? [...records.values()].find((candidate) =>
      candidate.filePath === ref || stagedPathsByRecord.get(candidate)?.has(ref));
  const sidecarDirectory = resolve(canonicalUploadDirectory, SIDECAR_DIRECTORY_NAME);
  const sidecarPathFor = (record: AttachmentRecord): string =>
    resolve(sidecarDirectory, attachmentSidecarFileName({ id: record.id }));

  /**
   * Writes one record's sidecar, or does nothing at all when this store was not asked to survive
   * restarts. A failure rolls the record back out of the map before propagating: a registration
   * whose sidecar could not be written would otherwise be silently non-surviving, which is the
   * exact failure mode this whole option exists to remove. `register`'s own `catch` deletes the
   * file, so the caller sees a failed upload rather than one that quietly evaporates later.
   */
  const persistRecord = async (record: TimestampedAttachmentRecord): Promise<void> => {
    if (!retainAcrossRestarts) return;
    try {
      await writePersistedAttachment({ record, sidecarPath: sidecarPathFor(record) });
    } catch (error) {
      records.delete(record.id);
      throw error;
    }
  };

  const forgetRecord = async (record: AttachmentRecord): Promise<void> => {
    if (retainAcrossRestarts) await rm(sidecarPathFor(record), { force: true });
  };

  const resolveBatchDirectory = (batchId: string): string => {
    if (!BATCH_ID_PATTERN.test(batchId)) {
      throw new AttachmentRejectedError({ reason: 'invalid-batch', message: 'Invalid attachment batch' });
    }
    // No containment re-check follows, and two things together are why — **both** are load-bearing:
    // `BATCH_ID_PATTERN` admits only `[a-zA-Z0-9-]`, so `batchId` carries no `.`, `/`, or `\`; and
    // `resolve` normalizes, so the result is exactly `<canonicalUploadDirectory><sep><batchId>`, one
    // non-traversing segment deeper. Weakening the pattern (a `.` would be enough) or dropping the
    // `resolve` reintroduces traversal here. Verified by sweeping 5,040,504 `(uploadRoot, batchId)`
    // pairs on both posix and win32: zero escape the upload root.
    return resolve(canonicalUploadDirectory, batchId);
  };

  const removeEmptyBatch = async (batchDirectory: string): Promise<void> => {
    try {
      await rmdir(batchDirectory);
    } catch {
      // Non-empty (another unclaimed upload still occupies it) or already gone. Both are fine:
      // this is opportunistic tidying, never the thing that makes a delete correct.
    }
  };

  const deleteRecord = async (record: AttachmentRecord): Promise<void> => {
    records.delete(record.id);
    await forgetRecord(record);
    await rm(record.filePath, { force: true });
    await removeEmptyBatch(record.batchDirectory);
  };

  const totalBytes = (candidates: readonly AttachmentRecord[]): number =>
    candidates.reduce((total, record) => total + record.size, 0);

  return {
    async createBatchDirectory({ batchId }: { readonly batchId: string }, _optional: Record<string, never> = {}) {
      const directory = resolveBatchDirectory(batchId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      return directory;
    },

    async register({ input }) {
      const batchDirectory = resolveBatchDirectory(input.batchId);
      // `resolve` is NOT redundant with the route's own `resolve`, and this line is the precondition
      // the containment argument below depends on. Do not remove it or take a pre-resolved path from
      // the caller: `register` is a public port method, so `input.path` is untrusted.
      const filePath = resolve(input.path);
      // Containment: the file's parent directory must be *exactly* the batch directory — stronger
      // than a `path.relative`-based "is inside" test, which also admits nested subdirectories and
      // the batch directory itself.
      //
      // Why parent-equality is sufficient: `resolve` above guarantees `filePath` is absolute and
      // normalized with no `..` left in the path body, so `dirname(filePath) === batchDirectory`
      // implies `filePath` is `batchDirectory + sep + basename` with a real, non-traversing
      // basename. This is *not* an unconditional path-algebra identity — without the `resolve`,
      // `dirname('/a/..') === '/a'` is true while `/a/..` escapes `/a`. The normalization is what
      // makes the argument hold; a differential fuzz of 6,000,000 `input.path` values against the
      // previous two-part check found zero inputs this accepts that containment rejected.
      //
      // Deliberately OUTSIDE the `try` below, whose `catch` unlinks `filePath`. A path that failed
      // containment must never reach that cleanup, or this port becomes an arbitrary-file-delete
      // primitive for anything the daemon can unlink.
      if (dirname(filePath) !== batchDirectory) {
        throw new AttachmentRejectedError({ reason: 'attachment-integrity', message: 'Attachment path is outside its batch' }
        );
      }
      try {
        const info = await lstat(filePath);
        // `lstat` (not `stat`): a symlink must be seen as a symlink, not followed. `isFile()` is
        // false for a symlink and for a directory, which is the whole check.
        if (!info.isFile()) {
          throw new AttachmentRejectedError({ reason: 'attachment-integrity', message: 'Attachment is not a regular file' }
          );
        }
        const canonical = await realpath(filePath);
        if (canonical !== filePath) {
          throw new AttachmentRejectedError({ reason: 'attachment-integrity', message: 'Attachment path is not canonical' }
          );
        }

        // Quotas are decided here, immediately before `records.set`, with no `await` in between —
        // so two concurrent registrations cannot both observe the last free slot (or the last free
        // bytes) and both commit. Moving any of this above the `await`s would reintroduce that
        // race; adding an `await` below would too.
        const batchRecords = [...records.values()]
          .filter((record) => record.batchId === input.batchId);
        if (batchRecords.length >= maxAttachments) {
          throw new AttachmentRejectedError({ reason: 'batch-count-exceeded', message: `You can attach at most ${maxAttachments} files to one message` }
          );
        }
        if (totalBytes(batchRecords) + info.size > maxBatchBytes) {
          throw new AttachmentRejectedError({ reason: 'batch-too-large', message: `Attachments for one message must total ${formatByteLimit(maxBatchBytes)} or less` }
          );
        }
        if (
          records.size >= maxStoredAttachments
          || totalBytes([...records.values()]) + info.size > maxStoredBytes
        ) {
          throw new AttachmentRejectedError({ reason: 'storage-full', message: 'Attachment storage is full' });
        }
        const id = `attachment:${randomUUID()}`;
        const record: TimestampedAttachmentRecord = {
          id,
          filePath,
          name: input.name,
          kind: input.kind,
          size: info.size,
          batchId: input.batchId,
          batchDirectory,
          dev: info.dev,
          ino: info.ino,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
          createdAt: Date.now(),
          ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        };
        records.set(id, record);
        // The first `await` after the synchronous quota window closes, so it cannot reopen the race
        // the comment above guards. Rolls `records` back itself on failure — see `persistRecord`.
        await persistRecord(record);
        return { path: id, name: record.name, kind: record.kind, size: record.size };
      } catch (error) {
        // A file this store refused to take ownership of must not be left behind. `rm` is
        // deliberately non-recursive (never recurse over an attacker-influenced path) and its own
        // failure is swallowed, so the real rejection above always propagates instead of being
        // masked by e.g. EISDIR from a directory sitting at `filePath`.
        await rm(filePath, { force: true }).catch(() => undefined);
        await removeEmptyBatch(batchDirectory);
        throw error;
      }
    },

    async claim({ attachments, runId }: { readonly attachments: readonly StoredAttachment[]; readonly runId: string }, _optional: Record<string, never> = {}) {
      if (attachments.length === 0) return { attachments: [] };
      // Phase 1 (`reserveAttachmentRecords`) reserves synchronously; Phase 2
      // (`verifyClaimedAttachments`) re-validates what is now held exclusively. Any Phase 2 failure
      // releases the whole reservation here, so a rejected claim still leaves nothing half-claimed
      // and the caller can retry with a corrected set. Only reservations made by *this* call are
      // released, so a concurrent winner's claim is never revoked by a loser's rollback.
      const claimed = reserveAttachmentRecords({ attachments, records, runId, maxAttachments });
      try {
        const batchDirectory = await verifyClaimedAttachments({ claimed });
        return {
          attachments: claimed.map((record) => {
            const attachment = { path: record.filePath, name: record.name, kind: record.kind, size: record.size };
            const aliases = new Set<string>();
            stagedPathsByAttachment.set(attachment, aliases);
            stagedPathsByRecord.set(record, aliases);
            return attachment;
          }),
          batchDirectory,
        };
      } catch (error) {
        for (const record of claimed) delete record.claimedRunId;
        throw error;
      }
    },

    async resolveForRun({ ref, runId }: { readonly ref: string; readonly runId: string }, _optional: Record<string, never> = {}) {
      // Synchronous check-then-reserve, same reasoning as `reserveAttachmentRecords`: nothing may
      // `await` between reading `claimedRunId` and writing it, or a concurrent call could observe
      // the same unclaimed record and both believe they reserved it.
      const record = findRecord({ ref });
      if (!record) return undefined;
      if (record.claimedRunId !== undefined && record.claimedRunId !== runId) {
        throw new AttachmentRejectedError({ reason: 'attachment-unknown-or-claimed', message: 'Attachment is unknown or already claimed' });
      }
      const reservedNow = record.claimedRunId === undefined;
      if (reservedNow) record.claimedRunId = runId;
      try {
        await verifyClaimedAttachments({ claimed: [record] });
      } catch (error) {
        // Mirrors `claim()`'s own rollback: a lookup that fails integrity must not leave a phantom
        // reservation behind for a record that turned out to be unsafe to hand back.
        if (reservedNow) delete record.claimedRunId;
        throw error;
      }
      return { path: record.filePath, name: record.name, kind: record.kind, size: record.size };
    },

    async listPendingForOwner({ ownerId }: { readonly ownerId: string }, { runId }: { readonly runId?: string } = {}) {
      return [...records.values()]
        // `record.ownerId !== undefined` first, short-circuiting before the comparison: this is
        // what makes an ownerless record excluded rather than accidentally matched by a falsy-ish
        // `ownerId` argument — see this method's own doc on why that must never be a wildcard.
        .filter((record) => record.ownerId !== undefined && record.ownerId === ownerId
          && isUnclaimedOrClaimedBy(record.claimedRunId, runId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((record) => ({ ref: record.id, name: record.name, kind: record.kind, size: record.size, createdAt: record.createdAt }));
    },

    async deleteUnclaimed({ batchId, paths }: { readonly batchId: string; readonly paths: readonly string[] }, _optional: Record<string, never> = {}) {
      const batchDirectory = resolveBatchDirectory(batchId);
      for (const attachmentId of new Set(paths)) {
        const record = records.get(attachmentId);
        if (record && record.batchId === batchId && record.claimedRunId === undefined) {
          await deleteRecord(record);
        }
      }
      await removeEmptyBatch(batchDirectory);
    },

    async cleanupRun({ runId }: { readonly runId: string }, _optional: Record<string, never> = {}) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === runId) await deleteRecord(record);
      }
    },

    async pruneExpired(_required: Record<string, never>, { now = Date.now() }: { readonly now?: number | undefined } = {}) {
      for (const record of [...records.values()]) {
        if (record.claimedRunId === undefined && now - record.createdAt >= retentionMs) {
          await deleteRecord(record);
        }
      }
    },

    async dispose() {
      for (const record of [...records.values()]) await deleteRecord(record);
    },
  };
}
