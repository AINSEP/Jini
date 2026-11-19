import { mkdir, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { BATCH_ID_PATTERN, type StoredAttachment } from './attachment-types.js';
import { verifyClaimedAttachments, type AttachmentRecord } from './attachment-records.js';

// ---------------------------------------------------------------------------
// Restart survival (`retainAcrossRestarts`)
// ---------------------------------------------------------------------------

/**
 * Directory, directly under the upload root, holding one small JSON sidecar per registered
 * attachment. This is what makes a restart-surviving store possible at all: the upload path encodes
 * the batch id and nothing else, so a directory scan alone can never recover an attachment's
 * display `name`, its sniffed `kind`, its capability `id`, or — the one that decides whether
 * `listPendingForOwner` can see it again — its `ownerId`. A scan-only "reconstruct from the paths"
 * design therefore brings the *bytes* back and still shows the user an empty list, which is half a
 * fix.
 *
 * The leading `.` is load-bearing: `BATCH_ID_PATTERN` admits no `.`, so `resolveBatchDirectory` can
 * never produce this path and a batch can never collide with (or be made to write into) the sidecar
 * directory. It also sits OUTSIDE every batch directory on purpose — a batch directory is the one
 * directory a host grants the agent read access to (`AttachmentClaim.batchDirectory`), so sidecars
 * kept next to their files would hand a run the `ownerId` and capability ids of every other
 * attachment in the same batch.
 */
export const SIDECAR_DIRECTORY_NAME = '.records';

/**
 * One attachment as it is written to its sidecar — `AttachmentRecord` minus two fields, both
 * omitted deliberately:
 *
 * - **`batchDirectory`**, because it is re-derived from the upload root on read rather than trusted.
 *   A sidecar is a file on disk; if it could name the directory a claim later hands to an agent, a
 *   forged one would turn this store into an arbitrary-file-read primitive. Re-deriving it through
 *   the same `BATCH_ID_PATTERN` + `resolve` containment argument `resolveBatchDirectory` uses means
 *   a forged sidecar can only ever point inside the upload root.
 * - **`claimedRunId`**, because no run survives the process that owned it. Everything adopted comes
 *   back unclaimed; a file whose run died is re-listable to its own uploader (never to anyone else
 *   — `claim`/`resolveForRun` still demand the unguessable id or path) and expires on the normal
 *   TTL. See {@link loadPersistedAttachments} for the retention consequence that carries.
 */
export interface PersistedAttachmentRecord {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: StoredAttachment['kind'];
  readonly size: number;
  readonly batchId: string;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  readonly createdAt: number;
  readonly ownerId?: string;
}

/** Field types a sidecar must carry, checked as data so the validator stays one flat loop. */
const PERSISTED_FIELD_TYPES: Readonly<Record<string, string>> = {
  id: 'string',
  filePath: 'string',
  name: 'string',
  kind: 'string',
  size: 'number',
  batchId: 'string',
  dev: 'number',
  ino: 'number',
  createdAt: 'number',
};

function hasPersistedFieldTypes(candidate: Record<string, unknown>): boolean {
  return Object.entries(PERSISTED_FIELD_TYPES)
    .every(([field, type]) => typeof candidate[field] === type)
    && ['mtimeMs', 'ctimeMs'].every((field) => candidate[field] === undefined || typeof candidate[field] === 'number');
}

function isPersistedAttachmentShape(raw: unknown): raw is PersistedAttachmentRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  if (!hasPersistedFieldTypes(candidate)) return false;
  if (candidate.ownerId !== undefined && typeof candidate.ownerId !== 'string') return false;
  return candidate.kind === 'image' || candidate.kind === 'file';
}

/**
 * Turns one sidecar's parsed JSON back into an `AttachmentRecord`, or `undefined` for anything that
 * is not a well-formed record naming a file inside its own batch directory.
 * Legacy sidecars may lack timestamps; adoption verifies their recorded identity before backfill.
 *
 * `batchDirectory` is re-derived here and `filePath`'s containment is re-checked against it with
 * the same parent-equality test `register` uses — the two checks that make an adopted record no
 * more trusted than one this process registered itself. Pure and exported so both can be exercised
 * against hostile input directly, without staging files on disk.
 */
export function parsePersistedAttachment({ raw, canonicalUploadDirectory }: { readonly raw: unknown; readonly canonicalUploadDirectory: string }, _optional: Record<string, never> = {}
): AttachmentRecord | undefined {
  if (!isPersistedAttachmentShape(raw)) return undefined;
  if (!BATCH_ID_PATTERN.test(raw.batchId)) return undefined;
  const batchDirectory = resolve(canonicalUploadDirectory, raw.batchId);
  const filePath = resolve(raw.filePath);
  if (dirname(filePath) !== batchDirectory) return undefined;
  return {
    id: raw.id,
    filePath,
    name: raw.name,
    kind: raw.kind,
    size: raw.size,
    batchId: raw.batchId,
    batchDirectory,
    dev: raw.dev,
    ino: raw.ino,
    ...(raw.mtimeMs === undefined ? {} : { mtimeMs: raw.mtimeMs }),
    ...(raw.ctimeMs === undefined ? {} : { ctimeMs: raw.ctimeMs }),
    createdAt: raw.createdAt,
    ...(raw.ownerId === undefined ? {} : { ownerId: raw.ownerId }),
  };
}

/**
 * Sidecar filename for a record id. Reduces the id to the same `[a-zA-Z0-9-]` allowlist
 * `BATCH_ID_PATTERN` uses before appending the extension, so no id — however this store's own id
 * format later changes — can put a `/`, a `..`, or a second extension into the path. Ids are
 * `attachment:<uuid>`, so the reduction stays injective in practice: the UUID is what makes it
 * unique and the UUID survives unchanged.
 */
export function attachmentSidecarFileName({ id }: { readonly id: string }, _optional: Record<string, never> = {}): string {
  return `${id.replaceAll(/[^a-zA-Z0-9-]/gu, '_')}.json`;
}

/** Writes only persisted fields, atomically, so an interrupted backfill preserves the old sidecar.
 * Propagates write failures; callers must not treat a failed migration as an invalid attachment. */
/** A record whose integrity timestamps are known: every record registered by this process, and every
 * legacy record once {@link verifyClaimedAttachments} has backfilled them. Only these are written. */
export type TimestampedAttachmentRecord = AttachmentRecord & { readonly mtimeMs: number; readonly ctimeMs: number };

export async function writePersistedAttachment({ record, sidecarPath }: { readonly record: TimestampedAttachmentRecord; readonly sidecarPath: string }, _optional: Record<string, never> = {}): Promise<void> {
  const persisted: PersistedAttachmentRecord = {
    id: record.id,
    filePath: record.filePath,
    name: record.name,
    kind: record.kind,
    size: record.size,
    batchId: record.batchId,
    dev: record.dev,
    ino: record.ino,
    mtimeMs: record.mtimeMs,
    ctimeMs: record.ctimeMs,
    createdAt: record.createdAt,
    ...(record.ownerId === undefined ? {} : { ownerId: record.ownerId }),
  };
  await writeJsonFileAtomicAsync({ filePath: sidecarPath, data: persisted }, { mode: 0o600 });
}

async function readPersistedAttachment(
  sidecarPath: string,
  canonicalUploadDirectory: string,
): Promise<AttachmentRecord | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(sidecarPath, 'utf8'));
    return parsePersistedAttachment({ raw, canonicalUploadDirectory });
  } catch {
    // Unreadable, truncated by a kill mid-write, or not JSON at all. Indistinguishable from a
    // sidecar that never described a real attachment, and handled identically: not adopted.
    return undefined;
  }
}

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
