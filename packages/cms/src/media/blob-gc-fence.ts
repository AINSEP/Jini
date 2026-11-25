/**
 * @file Fenced blob GC: one cross-process fence per exact storage key, shared by every byte writer
 * and by every unlink, plus the tombstone -> delete -> unlink phases that use it.
 *
 * The in-process `withSha256Lock` (`blob-gc-lock.ts`) cannot stop a second process (CLI import,
 * desktop sidecar, another Postgres instance) from writing the same content-addressed bytes between
 * an unlinker's "no owner" read and its `remove`. Here every transition runs inside
 * `kernel.transaction` after `kernel.lockKey("blob:<workspaceId>:<storageKey>")`, so the database
 * (SQLite `BEGIN IMMEDIATE`, Postgres advisory transaction lock) serializes writers and unlinkers
 * across processes.
 *
 * Lock order: the database transaction is outermost. Nothing here awaits the JS hash lock inside a
 * transaction; callers may hold `withSha256Lock` *around* `claimWrite`, never the reverse.
 *
 * Fail closed throughout: a missing or throwing ownership probe means "unknown", and unknown keeps
 * the bytes. Trash-TTL purges are not eligible for unlink unless a host opts in.
 * See docs/decisions/DR-004-journaled-blob-gc.md.
 */
import type {
  BlobClaimTarget,
  BlobFenceKernelPort,
  BlobOwnershipProbes,
  BlobOwnershipQuery,
  BlobPurgeReason,
  BlobUnlinkJournalRow,
  BlobUnlinkOutcome,
} from "@jini-ai/core/contracts/blob-gc";
import { createHash } from "node:crypto";
import type { Clock } from "@jini-ai/core/primitives";
import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from "./ports.js";
import type { AssetBlobRecord } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default grace between a tombstone and its delete phase. */
export const DEFAULT_BLOB_GC_GRACE_MS = 30 * DAY_MS;
const RETRY_BACKOFF_MS = [60 * 60 * 1000, 4 * 60 * 60 * 1000, DAY_MS, 7 * DAY_MS] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Durable pending-unlink journal, one row per exact storage key. */
export interface BlobUnlinkJournalPort {
  upsert(row: BlobUnlinkJournalRow): Promise<void>;
  get(required: { workspaceId: string; storageKey: string }): Promise<BlobUnlinkJournalRow | null>;
  /** Rows due at `dueAt` (no `nextAttemptAt`, or one at/before it), at most `limit`. */
  list(required: Record<string, never>, optional?: { limit?: number; dueAt?: string }): Promise<BlobUnlinkJournalRow[]>;
  remove(required: { workspaceId: string; storageKey: string }): Promise<void>;
}

/** Rendition rows that name an exact storage key. */
export interface RenditionKeyOwnersPort {
  countByStorageKey(required: { workspaceId: string; storageKey: string }): Promise<number>;
}

export interface CreateBlobGcRequired {
  kernel: BlobFenceKernelPort;
  blobRepo: AssetBlobRepoPort;
  mediaRepo: Pick<MediaRepoPort, "list">;
  renditionRepo: RenditionKeyOwnersPort;
  journal: BlobUnlinkJournalPort;
  blobStore: Pick<BlobStorePort, "remove">;
  probes: BlobOwnershipProbes;
  clock: Clock;
}

export interface CreateBlobGcOptional {
  graceMs?: number;
  /** Only a host may opt in to unlinking Trash-TTL purges (OWNER-Q-11a); this release never does. */
  allowTrashTtl?: boolean;
  /** Remote stores unlink one item per pass so the fence is never held across a slow batch. */
  storeLocality?: "local" | "remote";
}

/** The `work` callback receives the (resurrected, if it was tombstoned) row, or null. */
export interface BlobClaimWriteRequired<T> extends BlobClaimTarget {
  work: (claim: { existing: AssetBlobRecord | null }) => Promise<T>;
}

export interface BlobGc {
  claimWrite<T>(required: BlobClaimWriteRequired<T>, optional?: Record<string, never>): Promise<T>;
  tombstone(required: { workspaceId: string; storageKey: string; sha256: string; reason: BlobPurgeReason }, optional?: Record<string, never>): Promise<{ tombstoned: boolean; reason: string }>;
  deletePass(required: { signal: AbortSignal; workspaceId: string }, optional?: { limit?: number }): Promise<Array<{ sha256: string; reason: string }>>;
  unlinkPass(required: { signal: AbortSignal }, optional?: { localLimit?: number; remoteLimit?: number }): Promise<BlobUnlinkOutcome[]>;
  unlinkIfUnowned(required: BlobOwnershipQuery | Omit<BlobOwnershipQuery, "sha256">, optional?: Record<string, never>): Promise<BlobUnlinkOutcome>;
}

type Ownership = { verdict: "owned" | "unknown"; reason: string } | { verdict: "unowned" };

/**
 * The fence key. Why bytes and not row id: content-addressed storage means two different rows
 * (a re-upload, an import, a rendition sharing an output hash) can own the same bytes, and a row
 * id does not exist yet when a writer starts. The only identity every writer and every unlinker
 * agree on before any row exists is the exact storage key the bytes occupy.
 */
export function blobFenceKey(required: { workspaceId: string; storageKey: string }, _optional: Record<string, never> = {}): string {
  return `blob:${required.workspaceId}:${required.storageKey}`;
}

/**
 * Builds the fenced GC over host ports.
 * @complexity Each operation is O(n) in the workspace's media rows (the sha256 reference scan).
 */
export function createBlobGc(required: CreateBlobGcRequired, optional: CreateBlobGcOptional = {}): BlobGc {
  const policy = { graceMs: optional.graceMs ?? DEFAULT_BLOB_GC_GRACE_MS, allowTrashTtl: optional.allowTrashTtl ?? false };
  const deps = { ...required, policy, storeLocality: optional.storeLocality ?? "remote" } as const;
  const gc: BlobGc = {
    claimWrite: (input) => fenced(deps, input, () => claimUnderFence(deps, input)),
    tombstone: (input) => fenced(deps, input, () => tombstoneUnderFence(deps, input)),
    deletePass: (input, opts = {}) => runDeletePass(deps, input, opts.limit ?? 100),
    unlinkPass: (input, opts = {}) => runUnlinkPass(deps, gc, input, deps.storeLocality === "local" ? opts.localLimit ?? 50 : opts.remoteLimit ?? 1),
    unlinkIfUnowned: (input) => fenced(deps, input, () => unlinkUnderFence(deps, input)),
  };
  return gc;
}

type Deps = CreateBlobGcRequired & { policy: { graceMs: number; allowTrashTtl: boolean }; storeLocality: "local" | "remote" };

function fenced<T>(deps: Deps, key: { workspaceId: string; storageKey: string }, run: () => Promise<T>): Promise<T> {
  return deps.kernel.transaction(async () => {
    await deps.kernel.lockKey(blobFenceKey(key));
    return run();
  });
}

/** A byte write that the store did not keep intact (short write, corruption, wrong key). */
export class BlobWriteMismatchError extends Error {
  constructor(required: { storageKey: string }, _optional: Record<string, never> = {}) {
    super(`The saved file did not match what was sent (its size or checksum differs), so nothing was published. Try again. (${required.storageKey})`);
    this.name = "BlobWriteMismatchError";
  }
}

/**
 * Reads a just-written blob back and checks its size and sha256 before any row may name it. Why
 * read back: the fence only proves no unlinker interleaved; it cannot prove the store kept the
 * bytes intact, and a row published over a truncated file would serve it as good.
 */
export async function verifyWrittenBlob(
  required: { blobStore: Pick<BlobStorePort, "get">; storageKey: string; sha256: string; byteLength: number },
  _optional: Record<string, never> = {},
): Promise<void> {
  const stored = await required.blobStore.get({ storageKey: required.storageKey });
  const matches = stored.byteLength === required.byteLength && createHash("sha256").update(stored).digest("hex") === required.sha256;
  if (!matches) throw new BlobWriteMismatchError({ storageKey: required.storageKey });
}

const nowIso = (deps: Deps): string => new Date(deps.clock.nowMs()).toISOString();

async function claimUnderFence<T>(deps: Deps, input: BlobClaimWriteRequired<T>): Promise<T> {
  const found = await deps.blobRepo.findByHash({ workspaceId: input.workspaceId, sha256: input.sha256 });
  // A tombstone counts as a live owner only after it is resurrected here, under the fence.
  const existing = found?.status === "tombstoned" ? { ...found, status: "active" as const, tombstonedAt: undefined, purgeReason: undefined } : found;
  if (existing && existing !== found) await deps.blobRepo.save(existing);
  await deps.journal.remove({ workspaceId: input.workspaceId, storageKey: input.storageKey });
  return input.work({ existing });
}

async function tombstoneUnderFence(deps: Deps, input: { workspaceId: string; sha256: string; reason: BlobPurgeReason }): Promise<{ tombstoned: boolean; reason: string }> {
  const row = await deps.blobRepo.findByHash(input);
  if (!row) return { tombstoned: false, reason: "no-blob-row" };
  if (row.status === "tombstoned") return { tombstoned: true, reason: "already-tombstoned" };
  if (await hasMediaReference(deps, input)) return { tombstoned: false, reason: "still-referenced" };
  await deps.blobRepo.save({ ...row, status: "tombstoned", tombstonedAt: nowIso(deps), purgeReason: input.reason });
  return { tombstoned: true, reason: "tombstoned" };
}

async function hasMediaReference(deps: Deps, input: { workspaceId: string; sha256: string }): Promise<boolean> {
  const rows = await deps.mediaRepo.list({ workspaceId: input.workspaceId });
  return rows.some((row) => row.source.sha256 === input.sha256);
}

async function runDeletePass(deps: Deps, input: { signal: AbortSignal; workspaceId: string }, limit: number): Promise<Array<{ sha256: string; reason: string }>> {
  const rows = (await deps.blobRepo.list({ workspaceId: input.workspaceId })).filter((row) => row.status === "tombstoned").slice(0, limit);
  const results: Array<{ sha256: string; reason: string }> = [];
  for (const row of rows) {
    if (input.signal.aborted) break;
    const reason = await fenced(deps, row, () => deleteUnderFence(deps, row));
    results.push({ sha256: row.sha256, reason });
  }
  return results;
}

/** Re-reads the row under the fence; journals the exact key before dropping row ownership. */
async function deleteUnderFence(deps: Deps, candidate: AssetBlobRecord): Promise<string> {
  const row = await deps.blobRepo.findByHash(candidate);
  if (row?.status !== "tombstoned" || !row.tombstonedAt) return "not-tombstoned";
  if (!row.purgeReason) return "legacy-tombstone";
  if (row.purgeReason === "trash-ttl" && !deps.policy.allowTrashTtl) return "trash-ttl-not-authorized";
  const query = { workspaceId: row.workspaceId, storageKey: row.storageKey, sha256: row.sha256 };
  const retained = await graceElapsed(deps, query, row.tombstonedAt);
  if (retained !== "elapsed") return retained;
  if (await hasMediaReference(deps, row)) return "still-referenced";
  const refs = await askProbe(() => deps.probes.hasLiveEntryRefs(query));
  if (refs !== false) return refs === true ? "still-referenced" : "probe-unknown";
  const now = nowIso(deps);
  await deps.journal.upsert({ ...query, kind: "original", reason: row.purgeReason, tombstonedAt: row.tombstonedAt, journaledAt: now, attempts: 0 });
  await deps.blobRepo.remove(row);
  return "journaled";
}

/** grace = max(policy grace, age of the oldest retained recovery copy); unknown retention never elapses. */
async function graceElapsed(deps: Deps, query: BlobOwnershipQuery, tombstonedAt: string): Promise<"elapsed" | "grace-period-not-elapsed" | "probe-unknown"> {
  const retainedAgeMs = await askProbe(() => deps.probes.oldestRetainedRecoveryAgeMs(query));
  if (retainedAgeMs === undefined) return "probe-unknown";
  const graceMs = Math.max(deps.policy.graceMs, retainedAgeMs ?? 0);
  return deps.clock.nowMs() - Date.parse(tombstonedAt) >= graceMs ? "elapsed" : "grace-period-not-elapsed";
}

/** Runs one probe; an absent probe or a throw is `undefined` ("unknown"). */
async function askProbe<T>(probe: () => Promise<T>): Promise<T | undefined> {
  try {
    return await probe();
  } catch {
    return undefined;
  }
}

async function runUnlinkPass(deps: Deps, gc: BlobGc, input: { signal: AbortSignal }, limit: number): Promise<BlobUnlinkOutcome[]> {
  const rows = await deps.journal.list({}, { limit, dueAt: nowIso(deps) });
  const outcomes: BlobUnlinkOutcome[] = [];
  for (const row of rows) {
    if (input.signal.aborted) break;
    outcomes.push(await gc.unlinkIfUnowned({ workspaceId: row.workspaceId, storageKey: row.storageKey, sha256: row.sha256 }));
  }
  return outcomes;
}

/** Fresh ownership + retention recheck, then remove, all before the fence is released. */
async function unlinkUnderFence(deps: Deps, input: BlobOwnershipQuery | Omit<BlobOwnershipQuery, "sha256">): Promise<BlobUnlinkOutcome> {
  const pending = await deps.journal.get(input);
  const sha256 = pending?.sha256 ?? ("sha256" in input ? input.sha256 : shaFromKey(input.storageKey));
  if (!sha256) return { storageKey: input.storageKey, status: "deferred", reason: "unknown-sha256" };
  const query = { ...input, sha256 };
  const ownership = await findOwner(deps, query, pending);
  if (ownership.verdict === "owned") {
    await deps.journal.remove(input);
    return { storageKey: input.storageKey, status: "kept", reason: ownership.reason };
  }
  if (ownership.verdict === "unknown") return deferWithError(deps, pending, ownership.reason);
  return removeBytes(deps, query, pending);
}

function shaFromKey(storageKey: string): string | undefined {
  const last = storageKey.slice(storageKey.lastIndexOf("/") + 1);
  return SHA256_HEX.test(last) ? last : undefined;
}

async function findOwner(deps: Deps, query: BlobOwnershipQuery, pending: BlobUnlinkJournalRow | null): Promise<Ownership> {
  if (await deps.blobRepo.findByHash(query)) return { verdict: "owned", reason: "blob-row" };
  if ((await deps.renditionRepo.countByStorageKey(query)) > 0) return { verdict: "owned", reason: "rendition" };
  if (await hasMediaReference(deps, query)) return { verdict: "owned", reason: "media-row" };
  const refs = await askProbe(() => deps.probes.hasLiveEntryRefs(query));
  if (refs === undefined) return { verdict: "unknown", reason: "entry-refs probe unavailable" };
  if (refs) return { verdict: "owned", reason: "entry-ref" };
  const jobs = await askProbe(() => deps.probes.pendingJobOwners(query));
  if (jobs === undefined) return { verdict: "unknown", reason: "pending-jobs probe unavailable" };
  if (jobs.some((jobId) => jobId !== query.consumingJobId)) return { verdict: "owned", reason: "pending-job" };
  return retentionOwner(deps, query, pending);
}

async function retentionOwner(deps: Deps, query: BlobOwnershipQuery, pending: BlobUnlinkJournalRow | null): Promise<Ownership> {
  const retainedAgeMs = await askProbe(() => deps.probes.oldestRetainedRecoveryAgeMs(query));
  if (retainedAgeMs === undefined) return { verdict: "unknown", reason: "snapshot probe unavailable" };
  if (retainedAgeMs === null) return { verdict: "unowned" };
  // Without a journal row there is no tombstone time to measure the copy against: keep.
  if (!pending) return { verdict: "owned", reason: "retained-copy" };
  const ageMs = deps.clock.nowMs() - Date.parse(pending.tombstonedAt);
  return ageMs >= Math.max(deps.policy.graceMs, retainedAgeMs) ? { verdict: "unowned" } : { verdict: "owned", reason: "retained-copy" };
}

async function removeBytes(deps: Deps, query: BlobOwnershipQuery, pending: BlobUnlinkJournalRow | null): Promise<BlobUnlinkOutcome> {
  try {
    await deps.blobStore.remove({ storageKey: query.storageKey });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") return deferWithError(deps, pending, "storage removal failed");
    await deps.journal.remove(query);
    return { storageKey: query.storageKey, status: "absent", reason: "already-absent" };
  }
  await deps.journal.remove(query);
  return { storageKey: query.storageKey, status: "unlinked", reason: "unowned" };
}

async function deferWithError(deps: Deps, pending: BlobUnlinkJournalRow | null, lastError: string): Promise<BlobUnlinkOutcome> {
  const storageKey = pending?.storageKey ?? "";
  if (pending) {
    const attempts = pending.attempts + 1;
    const backoffMs = RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length) - 1] ?? DAY_MS;
    await deps.journal.upsert({ ...pending, attempts, lastError, nextAttemptAt: new Date(deps.clock.nowMs() + backoffMs).toISOString() });
  }
  return { storageKey, status: "deferred", reason: lastError };
}
