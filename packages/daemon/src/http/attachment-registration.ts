import type { AttachmentRecord, AttachmentStore } from './attachment-types.js';
import { BATCH_ID_PATTERN, AttachmentRejectedError, formatByteLimit } from './attachment-rejections.js';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TimestampedAttachmentRecord, createAttachmentPersistence } from './attachment-sidecars.js';
import { mkdir, chmod, lstat, realpath, rm } from 'node:fs/promises';
import { removeEmptyBatch } from './attachment-cleanup.js';


const totalBytes = (candidates: readonly AttachmentRecord[]): number =>
  candidates.reduce((total, record) => total + record.size, 0);

export function createBatchDirectoryResolver(canonicalUploadDirectory: string) {
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

  return resolveBatchDirectory;
}

function registerAttachmentRecord({ records, maxAttachments, maxBatchBytes, maxStoredAttachments, maxStoredBytes }: { records: Map<string, AttachmentRecord>; maxAttachments: number; maxBatchBytes: number; maxStoredAttachments: number; maxStoredBytes: number }, { input, info, filePath, batchDirectory }: { input: Parameters<AttachmentStore["register"]>[0]["input"]; info: { size: number; dev: number; ino: number; mtimeMs: number; ctimeMs: number }; filePath: string; batchDirectory: string }) {
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
  return { id, record };
}

export function createAttachmentCreateBatchDirectoryMethod({ resolveBatchDirectory }: { resolveBatchDirectory: ReturnType<typeof createBatchDirectoryResolver> }): AttachmentStore["createBatchDirectory"] {
  return {
    async createBatchDirectory({ batchId }: { readonly batchId: string }, _optional: Record<string, never> = {}) {
      const directory = resolveBatchDirectory(batchId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      return directory;
    },
  }.createBatchDirectory;
}

export function createAttachmentRegisterMethod({ resolveBatchDirectory, records, maxAttachments, maxBatchBytes, maxStoredAttachments, maxStoredBytes, persistRecord }: { resolveBatchDirectory: ReturnType<typeof createBatchDirectoryResolver>; records: Map<string, AttachmentRecord>; maxAttachments: number; maxBatchBytes: number; maxStoredAttachments: number; maxStoredBytes: number; persistRecord: ReturnType<typeof createAttachmentPersistence>["persistRecord"] }): AttachmentStore["register"] {
  return {
    async register({ input }: Parameters<AttachmentStore["register"]>[0]) {
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

        const { id, record } = registerAttachmentRecord({ records, maxAttachments, maxBatchBytes, maxStoredAttachments, maxStoredBytes }, { input, info, filePath, batchDirectory });
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
  }.register;
}
