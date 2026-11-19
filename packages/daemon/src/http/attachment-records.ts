import { lstat, realpath } from 'node:fs/promises';
import { AttachmentRejectedError, type StoredAttachment } from './attachment-types.js';

export interface AttachmentRecord {
  id: string;
  filePath: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  batchId: string;
  batchDirectory: string;
  dev: number;
  ino: number;
  /** Absent only for legacy sidecars; filled after their first successful integrity check. */
  mtimeMs?: number;
  ctimeMs?: number;
  createdAt: number;
  claimedRunId?: string;
  /**
   * The principal a host's `AttachmentsHttpDeps.resolveOwnerId` reported for the request that
   * registered this attachment. Absent when the host supplies no `resolveOwnerId` (this pack's
   * behavior before ownership existed), which is why `listPendingForOwner` treats an absent
   * `ownerId` as "cannot be scoped" rather than as a wildcard match — see that method's own doc.
   */
  ownerId?: string;
}

/**
 * What `listPendingForOwner` hands back for an unclaimed or same-run claimed attachment: enough for a caller to
 * show a person what is waiting, and to name it again (`ref`) to `claim()`/`resolveForRun`.
 */
export interface PendingAttachmentSummary {
  /** The same opaque `attachment:<uuid>` id `register()` returned over the wire. */
  ref: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  /** `Date.now()` at registration — when the file arrived, not when it was looked up. */
  createdAt: number;
}

/** What registration recorded about a file, as `isUnchangedAttachment` needs it. */
export interface RecordedAttachmentIdentity {
  readonly filePath: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
}

/**
 * What the filesystem reports about a file right now — the subset of `fs.Stats` (plus `realpath`)
 * an integrity check needs.
 *
 * `isRegularFile` comes from `lstat().isFile()`, which is false for a symlink *and* for a
 * directory. There is deliberately no separate `isSymbolicLink` field: `lstat` reports exactly one
 * file type, so `isFile()` and `isSymbolicLink()` are mutually exclusive and a symlink check after
 * an `isFile()` check could never be the deciding one.
 */
export interface ObservedAttachmentIdentity {
  readonly isRegularFile: boolean;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  /** `realpath` of the file — differs from its own path when any path component became a symlink. */
  readonly canonicalPath: string;
}

/**
 * `true` when the file on disk is still the same file registration accepted.
 *
 * Every condition is a distinct real attack: a regular file swapped for a symlink or directory, a
 * parent directory swapped for a symlink pointing elsewhere, the file replaced by a different file
 * at the same path (new inode), the same inode truncated or appended to (new size), or the path
 * now resolving onto a different device. Modification/change timestamps also detect same-size
 * rewrites and replacement files whose inode was recycled. Legacy records lack timestamps and
 * use their original identity checks until the first verified read establishes that baseline.
 *
 * Pure and exported on purpose. Staging a *device* change for a file that keeps its path is not
 * something a test can do on a real filesystem, and a check that can only be exercised in
 * production is a check nobody knows works — a fake identity states each case directly.
 */
export function isUnchangedAttachment({ recorded, observed }: { readonly recorded: RecordedAttachmentIdentity; readonly observed: ObservedAttachmentIdentity }, _optional: Record<string, never> = {}
): boolean {
  const sameFile = observed.isRegularFile && observed.canonicalPath === recorded.filePath
    && observed.dev === recorded.dev && observed.ino === recorded.ino;
  // A recorded timestamp must still hold; one never recorded cannot disagree.
  const sameTimes = (recorded.mtimeMs === undefined || observed.mtimeMs === recorded.mtimeMs)
    && (recorded.ctimeMs === undefined || observed.ctimeMs === recorded.ctimeMs);
  return sameFile && observed.size === recorded.size && sameTimes;
}

/**
 * Phase 1 of `claim()`: synchronously reserves `attachments` for `runId`, or throws (releasing
 * whatever it already reserved this call) the first time a requested attachment turns out to be
 * unknown or already claimed.
 *
 * The reservation loop deliberately has no `await`: this store's exactly-once guarantee is what
 * stops two runs being handed the same real path on disk, and `claim` is reachable concurrently
 * (two run starts, one shared attachment). Nothing between `records.get` and the assignment of
 * `record.claimedRunId` may ever become asynchronous — that window is exactly where a concurrent
 * call would get its turn and could observe the same record as still unclaimed.
 *
 * Exported so this invariant can be exercised directly against a plain `Map` of fabricated
 * records, without going through a disk-backed store.
 */
export function reserveAttachmentRecords({ attachments, records, runId, maxAttachments }: { readonly attachments: readonly StoredAttachment[]; readonly records: ReadonlyMap<string, AttachmentRecord>; readonly runId: string; readonly maxAttachments: number }, _optional: Record<string, never> = {}
): AttachmentRecord[] {
  if (attachments.length > maxAttachments) {
    throw new AttachmentRejectedError({ reason: 'too-many-attachments', message: 'Too many attachments' });
  }
  const requestedPaths = new Set(attachments.map((attachment) => attachment.path));
  if (requestedPaths.size !== attachments.length) {
    throw new AttachmentRejectedError({ reason: 'duplicate-attachment', message: 'Duplicate attachment' });
  }
  const claimed: AttachmentRecord[] = [];
  for (const requested of attachments) {
    const record = records.get(requested.path);
    if (!record || record.claimedRunId !== undefined) {
      for (const reserved of claimed) delete reserved.claimedRunId;
      throw new AttachmentRejectedError({ reason: 'attachment-unknown-or-claimed', message: 'Attachment is unknown or already claimed' }
      );
    }
    record.claimedRunId = runId;
    claimed.push(record);
  }
  return claimed;
}

/**
 * Phase 2 of `claim()`: re-verifies every already-reserved record against the filesystem — not
 * merely re-read, but re-checked against what registration recorded, so someone able to write into
 * the batch directory between upload and run start cannot get the agent to read a file of their
 * choosing — and checks every claimed attachment shares one batch. Returns the shared batch
 * directory on success (or `''` for an empty `claimed`, which `claim()` never passes in — it
 * returns before calling this — but which a direct caller can still treat as "no batch").
 *
 * Throws without releasing `claimed`'s reservations; releasing is the caller's job (`claim`'s own
 * `catch`), so a rejected claim still leaves nothing half-claimed and the caller can retry with a
 * corrected set.
 * Missing legacy timestamps are filled from the verified stat; adoption persists that baseline.
 *
 * Exported so the integrity and mixed-batch checks can be exercised directly against fabricated
 * records over real files on disk, without a full `createDiskAttachmentStore` around them.
 */
export async function verifyClaimedAttachments({ claimed }: { readonly claimed: readonly AttachmentRecord[] }, _optional: Record<string, never> = {}
): Promise<string> {
  let batchDirectory = '';
  for (const [index, record] of claimed.entries()) {
    const info = await lstat(record.filePath);
    const canonicalPath = await realpath(record.filePath);
    if (!isUnchangedAttachment({
      recorded: record, observed: {
        isRegularFile: info.isFile(),
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
        canonicalPath,
      }
    })) {
      throw new AttachmentRejectedError({ reason: 'attachment-integrity', message: 'Attachment changed after upload' });
    }
    if (index > 0 && record.batchDirectory !== batchDirectory) {
      throw new AttachmentRejectedError({ reason: 'mixed-batch', message: 'Attachments must belong to one batch' });
    }
    record.mtimeMs ??= info.mtimeMs;
    record.ctimeMs ??= info.ctimeMs;
    batchDirectory = record.batchDirectory;
  }
  return batchDirectory;
}

/** An attachment no run has claimed, or one claimed by `runId` (never by an absent run id). */
export function isUnclaimedOrClaimedBy(claimedRunId: string | undefined, runId: string | undefined): boolean {
  return claimedRunId === undefined || (runId !== undefined && claimedRunId === runId);
}
