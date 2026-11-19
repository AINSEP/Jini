import type { StoredAttachment, AttachmentRecord } from './attachment-types.js';
import { BATCH_ID_PATTERN } from './attachment-rejections.js';
import { resolve, dirname } from 'node:path';
import { writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { readFile, rm } from 'node:fs/promises';


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

export async function readPersistedAttachment(
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

export function createAttachmentPersistence(records: Map<string, AttachmentRecord>, canonicalUploadDirectory: string, retainAcrossRestarts: boolean) {
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

  return { persistRecord, forgetRecord };
}
