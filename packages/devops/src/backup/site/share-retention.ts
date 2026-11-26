interface RetentionMeasurement { readonly bytes: number | null; readonly items?: number }
interface RetentionSweepResult { readonly freedBytes: number | null; readonly removed: number }
interface RetentionPolicy {
  readonly id: string;
  readonly kind: "cache" | "derived" | "old-copy";
  measure(): Promise<RetentionMeasurement>;
  sweep(input: { readonly now: number }): Promise<RetentionSweepResult>;
}
import type { SiteShareRecord, SiteShareRegistry } from "./share-registry.js";

/** The two file operations the pass needs, injected so a host (or a test) owns the filesystem. */
export interface ShareRetentionFs {
  stat(file: string): Promise<{ size: number }>;
  unlink(file: string): Promise<void>;
}
/** Per-share in-process exclusion, keyed `shares:<shareId>`; held only around metadata checks and the unlink. */
export type ShareMutex = <T>(required: { key: string; criticalSection: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;
export interface ShareRetentionRequired {
  readonly registry: Pick<SiteShareRegistry, "list" | "get" | "markExpired" | "artifactPath">;
  readonly isOwnShareFolder: (required: { storage: NonNullable<SiteShareRecord["storage"]> }) => boolean;
  readonly shareMutex: ShareMutex;
  readonly fs: ShareRetentionFs;
  readonly clock: { now(): number };
  readonly reportError: (required: { error: Error; shareId: string }, optional: Record<string, never>) => void;
  readonly signal: AbortSignal;
}
type Action = "expire" | "unlink";
type Candidate = { readonly row: SiteShareRecord; readonly bytes: number };

/** A keyed promise-chain lock: callers on one key run one at a time; a rejection does not poison the key. */
export function createShareMutex(_required: Record<string, never>, _optional: Record<string, never> = {}): ShareMutex {
  const tails = new Map<string, Promise<void>>();
  return <T>({ key, criticalSection }: { key: string; criticalSection: () => Promise<T> }) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(criticalSection, criticalSection);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  };
}

/**
 * Only an explicit, valid, past `expiresAt` on a row this server hosts in its own share folder proves a
 * ZIP may go. Missing or unparseable metadata, peer-uploaded rows (no `storage`), remote copies and
 * `failed` rows (a remote copy may exist) are never evidence (owner rule (c): live links never break).
 */
function provesExpiry(required: { row: SiteShareRecord; now: number; isOwnShareFolder: ShareRetentionRequired["isOwnShareFolder"] }): required is { row: SiteShareRecord & { expiresAt: string }; now: number; isOwnShareFolder: ShareRetentionRequired["isOwnShareFolder"] } {
  const { row, now } = required;
  if (row.status !== "active" || typeof row.expiresAt !== "string" || !row.storage || !required.isOwnShareFolder({ storage: row.storage })) return false;
  const at = Date.parse(row.expiresAt);
  return !Number.isNaN(at) && now >= at;
}

function actionFor(required: { row: SiteShareRecord; now: number; isOwnShareFolder: ShareRetentionRequired["isOwnShareFolder"] }): Action | null {
  if (required.row.status === "revoked" || required.row.status === "expired") return "unlink";
  return provesExpiry(required) ? "expire" : null;
}

/** ZIP bytes, or null when no ZIP is left; any other stat error fails the policy (unknown keeps data). */
async function zipBytes(required: { fs: ShareRetentionFs; file: string }): Promise<number | null> {
  try { return (await required.fs.stat(required.file)).size; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Rows with work left: an action and a ZIP still on disk, so finished revoked rows never use up the limit. */
async function listCandidates(required: { registry: ShareRetentionRequired["registry"]; fs: ShareRetentionFs; now: number; isOwnShareFolder: ShareRetentionRequired["isOwnShareFolder"] }): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const row of await required.registry.list({})) {
    if (!actionFor({ row, now: required.now, isOwnShareFolder: required.isOwnShareFolder })) continue;
    const bytes = await zipBytes({ fs: required.fs, file: required.registry.artifactPath(row) });
    if (bytes !== null) candidates.push({ row, bytes });
  }
  return candidates;
}

/** Unlink a ZIP whose row already refuses every download; freed bytes, or 0 when it must wait for a later pass. */
async function removeZip(required: ShareRetentionRequired & { shareId: string }): Promise<number> {
  const file = required.registry.artifactPath(required);
  const bytes = await zipBytes({ fs: required.fs, file });
  if (bytes === null) return 0;
  try { await required.fs.unlink(file); return bytes; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows: an open download (EBUSY/EPERM) keeps the file until it finishes; the next pass retries.
    if (code !== "ENOENT" && code !== "EBUSY" && code !== "EPERM") required.reportError({ error: error as Error, shareId: required.shareId }, {});
    return 0;
  }
}

/**
 * One share under its lock: re-read the row (the listing may be stale), re-prove the action, then for an
 * expiry publish the tombstone BEFORE the unlink. Why expired is monotonic but a file-delete failure is
 * retryable: the tombstone is the access decision — once both download gates refuse a link it must never
 * serve again, whatever a later `put` writes — while the unlink is only reclaiming bytes, so a busy or
 * failed delete just leaves `expired` + ZIP for the next pass to finish. The lock never spans a stream.
 */
async function settleOne(required: ShareRetentionRequired & { shareId: string; now: number }): Promise<number> {
  const row = await required.registry.get({ shareId: required.shareId });
  if (!row) return 0;
  const action = actionFor({ row, now: required.now, isOwnShareFolder: required.isOwnShareFolder });
  if (action === null) return 0;
  if (action === "expire" && typeof row.expiresAt === "string" && provesExpiry({ row, now: required.now, isOwnShareFolder: required.isOwnShareFolder })) await required.registry.markExpired({ shareId: row.shareId, expiresAt: row.expiresAt });
  return removeZip(required);
}

/**
 * The `share-files` retention policy (kind `old-copy`): expires own-folder links past their stated date
 * and retries the local ZIP of revoked links. Metadata, token reservations, tombstones and remote copies
 * are never removed. `showExpired` is the owner's listing choice (expired rows stay visible by default).
 * @complexity O(rows) per measure/sweep, at most `limit` rows changed per sweep.
 */
export function createShareRetention(required: ShareRetentionRequired, { limit = 50, showExpired = true }: { limit?: number; showExpired?: boolean } = {}): RetentionPolicy & { readonly showExpired: boolean } {
  const { registry, fs, clock, signal, shareMutex, isOwnShareFolder } = required;
  return {
    id: "share-files",
    kind: "old-copy",
    showExpired,
    async measure(): Promise<RetentionMeasurement> {
      const candidates = await listCandidates({ registry, fs, now: clock.now(), isOwnShareFolder });
      return { bytes: candidates.reduce((sum, candidate) => sum + candidate.bytes, 0), items: candidates.length };
    },
    async sweep({ now }): Promise<RetentionSweepResult> {
      let removed = 0, freedBytes = 0;
      for (const { row } of (await listCandidates({ registry, fs, now, isOwnShareFolder })).slice(0, limit)) {
        if (signal.aborted) break;
        const freed = await shareMutex({ key: `shares:${row.shareId}`, criticalSection: () => settleOne({ ...required, shareId: row.shareId, now }) });
        if (freed > 0) { removed += 1; freedBytes += freed; }
      }
      return { removed, freedBytes };
    },
  };
}
