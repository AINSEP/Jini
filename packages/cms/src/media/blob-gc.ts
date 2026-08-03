/**
 * @file Blob-GC protocol (ADR-027 §5 "References, deletion, and GC
 * (never-brick)", INV-1) — the audited tombstone -> delete-pass -> unlink-pass
 * design, scoped to what an in-memory-repo build can actually run today.
 *
 * Built in this pass:
 *  - The real "unreferenced" predicate's sha256-uniqueness-across-non-purged-
 *    media-entries conjunct ({@link isBlobUnreferenced}), backed by the actual
 *    `mediaRepo` data `purgeMedia` already has.
 *  - Ordering (INV-1a): {@link runBlobGcDeletePass} deletes the `asset_blobs`
 *    row and writes the `blob_gc_journal` entry together, before any bytes are
 *    touched; {@link runBlobGcUnlinkPass} only ever unlinks bytes for a row
 *    whose deletion has already happened. `uploadMedia` (see
 *    `media-service.ts`) already writes bytes before the row.
 *  - Serialization: every transition below runs inside {@link withSha256Lock}
 *    (`blob-gc-lock.ts`) — this build's substitute for `BEGIN IMMEDIATE`
 *    against an in-memory table (see that file's header for why).
 *  - The two-phase, journaled shape: {@link tombstoneBlobIfUnreferenced} ->
 *    {@link runBlobGcDeletePass} (re-checks the predicate + `gc_grace`,
 *    journals, deletes the row) -> {@link runBlobGcUnlinkPass} (drains the
 *    journal, removes bytes). {@link runBlobGcCycle} is a convenience batch
 *    wrapper around the last two for tests/manual operation; nothing calls it
 *    on a schedule.
 *  - `gc_grace = max(30d default, retained-snapshot age)`, with the snapshot
 *    input wired as a stub (see below) so a real value slots in later without
 *    reworking callers.
 *
 * Deliberately NOT built (disclosed, matches this task's explicit scope):
 *  - **`entry_refs` where-used index** ({@link hasLiveEntryRefs}) — belongs to
 *    ADR-022's generic entries model, which is accepted design only, not
 *    running code yet (see `types.ts`'s file header on `MediaRecord` being a
 *    bespoke table for the same reason). Stubbed to always return `false`
 *    ("no live refs found").
 *  - **Retained-snapshot conjunct** ({@link getOldestRetainedSnapshotAgeMs}) —
 *    owned by a pending Storage/Backups snapshot primitive, which doesn't
 *    exist yet either (ADR-027 §5 says so explicitly). Stubbed to always
 *    return `undefined` ("no retained snapshot").
 *  - **Monthly orphan sweep** ({@link runMonthlyOrphanSweepStub}) — the fourth
 *    protocol phase, reconciling bytes on disk with no `asset_blobs` row at
 *    all (e.g. a crash before any GC protocol existed). Needs a scheduler
 *    this library doesn't provide. Named so the seam exists; performs no work
 *    and is never called.
 *  - **Cross-process safety** — `withSha256Lock` only serializes within one
 *    Node process. A real multi-instance deployment needs the real DB
 *    transaction ADR-027 specifies, which a host's own persistence adapter
 *    would supply; this build has no multi-writer story for media at all yet
 *    (in-memory repo), so that gap is inherited, not new.
 */
import type { ClockPort, IdGeneratorPort, UUID } from "../core/ports.js";
import type { AssetBlobRepoPort, BlobGcJournalRepoPort, BlobStorePort, MediaRepoPort } from "./ports.js";
import { withSha256Lock } from "./blob-gc-lock.js";

/** Default retention window before a tombstoned blob's delete-pass may run. */
export const DEFAULT_GC_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Disclosed stubs — ADR-027 §5 conjuncts this build cannot evaluate for real
// yet. Both are named, not silently folded into `true`/`false` inline, so a
// future implementation has an obvious seam to replace.
// ---------------------------------------------------------------------------

/**
 * STUB — ADR-022's derived `entry_refs` where-used index (TipTap image nodes
 * + registry `ref` fields) does not exist as running code yet (see this
 * file's header). Always reports no live references, which is what lets
 * {@link isBlobUnreferenced} degrade to the sha256-uniqueness check alone.
 *
 * @complexity O(1) (stub).
 * @overallScore 100
 */
function hasLiveEntryRefs(_input: { workspaceId: UUID; sha256: string }): boolean {
  return false;
}

/**
 * STUB — snapshot-retention is owned by a pending Storage/Backups snapshot
 * primitive (not built yet at all — see this file's header). Always reports
 * no retained snapshot.
 *
 * @complexity O(1) (stub).
 * @overallScore 100
 */
function hasRetainedSnapshot(_input: { workspaceId: UUID; sha256: string }): boolean {
  return false;
}

/**
 * STUB — age (ms) of the oldest snapshot that still retains this blob, at
 * delete-pass time. Always `undefined` in this build (no snapshot primitive
 * exists), which is what makes {@link resolveGcGraceMs} fall back to the
 * 30-day default alone. A real implementation would return a number here;
 * `resolveGcGraceMs`'s `Math.max` already accepts that without change.
 *
 * @complexity O(1) (stub).
 * @overallScore 100
 */
function getOldestRetainedSnapshotAgeMs(_input: { workspaceId: UUID; sha256: string }): number | undefined {
  return undefined;
}

/**
 * `gc_grace = max(configured default, age of the oldest retained snapshot at
 * delete-pass time)` (ADR-027 §5). The snapshot half is always `0` in this
 * build (see {@link getOldestRetainedSnapshotAgeMs}), so this currently
 * always resolves to {@link DEFAULT_GC_GRACE_MS} — structured so a real
 * snapshot-age input replaces that `?? 0` later without touching callers.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function resolveGcGraceMs(input: { workspaceId: UUID; sha256: string }): number {
  const snapshotAgeMs = getOldestRetainedSnapshotAgeMs(input) ?? 0;
  return Math.max(DEFAULT_GC_GRACE_MS, snapshotAgeMs);
}

// ---------------------------------------------------------------------------
// "Unreferenced" predicate (ADR-027 §5, normative)
// ---------------------------------------------------------------------------

export interface IsBlobUnreferencedRequired {
  deps: { mediaRepo: MediaRepoPort };
  input: { workspaceId: UUID; sha256: string };
}

/**
 * The real "unreferenced" check this file replaces `purgeMedia`'s old
 * sibling-scan-and-immediately-delete shortcut with. Normative definition
 * (ADR-027 §5): no media entry in the workspace in any non-purged state
 * (active or trashed — purged rows are physically removed by `purgeMedia`,
 * so `mediaRepo.list` already excludes them by construction) references this
 * sha256, AND no live `entry_refs` targets it, AND no retained snapshot
 * references it. The last two conjuncts are evaluated by the disclosed stubs
 * above.
 *
 * Callers MUST invoke this from inside {@link withSha256Lock} for the same
 * sha256 — this function only reads, it does not lock itself, so its result
 * is only trustworthy for as long as the caller's own lock is held.
 *
 * @complexity O(n) in the workspace's media row count (same disclosed
 * tradeoff `purgeMedia`'s prior sibling-scan already carried — see
 * `media-service.ts`'s findings note on that function).
 * @overallScore 90
 * @findings Medium: O(n) `mediaRepo.list` + `.some` scan per call, same
 * known tradeoff as the code this replaces. A real `asset_blobs` reference
 * count column would make this O(1); not worth adding for an in-memory
 * walking-skeleton repo.
 */
export async function isBlobUnreferenced(required: IsBlobUnreferencedRequired): Promise<boolean> {
  const { deps, input } = required;
  const rows = await deps.mediaRepo.list({ workspaceId: input.workspaceId });
  const hasMediaReference = rows.some((row) => row.source.sha256 === input.sha256);
  if (hasMediaReference) return false;
  if (hasLiveEntryRefs(input)) return false;
  if (hasRetainedSnapshot(input)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Phase 1: tombstone-pass
// ---------------------------------------------------------------------------

export interface TombstoneBlobDeps {
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  clock: ClockPort;
}

export interface TombstoneBlobRequired {
  deps: TombstoneBlobDeps;
  input: { workspaceId: UUID; sha256: string };
}

/**
 * Tombstone-pass. Marks an `active` blob row `tombstoned` (starting its
 * `gc_grace` clock) if-and-only-if {@link isBlobUnreferenced} holds, all
 * inside one {@link withSha256Lock} section so a concurrent dedup upload for
 * the same sha256 can't observe a half-updated row. Idempotent: re-tombstoning
 * an already-tombstoned row is a no-op success, not an error (mirrors
 * `trashMedia`'s idempotency).
 *
 * @complexity O(n) — dominated by {@link isBlobUnreferenced}'s scan.
 * @overallScore 100
 */
export async function tombstoneBlobIfUnreferenced(
  required: TombstoneBlobRequired
): Promise<{ tombstoned: boolean; reason: string }> {
  const { deps, input } = required;
  return withSha256Lock(input.sha256, async () => {
    const row = await deps.blobRepo.findByHash(input);
    if (!row) return { tombstoned: false, reason: "no-blob-row" };
    if (row.status === "tombstoned") return { tombstoned: true, reason: "already-tombstoned" };

    const unreferenced = await isBlobUnreferenced({ deps, input });
    if (!unreferenced) return { tombstoned: false, reason: "still-referenced" };

    await deps.blobRepo.save({ ...row, status: "tombstoned", tombstonedAt: deps.clock.nowIso() });
    return { tombstoned: true, reason: "tombstoned" };
  });
}

// ---------------------------------------------------------------------------
// Phase 2: delete-pass
// ---------------------------------------------------------------------------

export interface RunBlobGcDeletePassDeps {
  mediaRepo: MediaRepoPort;
  blobRepo: AssetBlobRepoPort;
  journalRepo: BlobGcJournalRepoPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

export interface RunBlobGcDeletePassRequired {
  deps: RunBlobGcDeletePassDeps;
  input: { workspaceId: UUID; sha256: string };
}

/**
 * Delete-pass. Gated on the row being `tombstoned` AND `gc_grace` having
 * elapsed since `tombstonedAt` ({@link resolveGcGraceMs}); re-checks the full
 * {@link isBlobUnreferenced} predicate one more time before acting (a
 * resurrect between tombstone-pass and delete-pass already flips status back
 * to `active`, which the tombstoned-status check below catches first, but the
 * re-check is what ADR-027 §5 calls for and is what future non-stub
 * entry_refs/snapshot conjuncts would need). On success: writes the
 * `blob_gc_journal` entry and removes the `asset_blobs` row, in that order,
 * inside the same locked section — INV-1a's "unlinked only after the row
 * deletion commits" half depends on nothing touching bytes here at all.
 *
 * @complexity O(n) — dominated by the re-check's `isBlobUnreferenced` scan.
 * @overallScore 100
 */
export async function runBlobGcDeletePass(
  required: RunBlobGcDeletePassRequired
): Promise<{ deleted: boolean; reason: string }> {
  const { deps, input } = required;
  return withSha256Lock(input.sha256, async () => {
    const row = await deps.blobRepo.findByHash(input);
    if (!row) return { deleted: false, reason: "no-blob-row" };
    if (row.status !== "tombstoned" || !row.tombstonedAt) {
      return { deleted: false, reason: "not-tombstoned" };
    }

    const graceMs = resolveGcGraceMs(input);
    const elapsedMs = new Date(deps.clock.nowIso()).getTime() - new Date(row.tombstonedAt).getTime();
    if (elapsedMs < graceMs) return { deleted: false, reason: "grace-period-not-elapsed" };

    const stillUnreferenced = await isBlobUnreferenced({ deps, input });
    if (!stillUnreferenced) return { deleted: false, reason: "resurrected" };

    await deps.journalRepo.save({
      id: deps.idGen.newId(),
      workspaceId: input.workspaceId,
      sha256: input.sha256,
      storageKey: row.storageKey,
      journaledAt: deps.clock.nowIso(),
    });
    await deps.blobRepo.remove(input);
    return { deleted: true, reason: "deleted" };
  });
}

// ---------------------------------------------------------------------------
// Phase 3: unlink-pass
// ---------------------------------------------------------------------------

export interface RunBlobGcUnlinkPassDeps {
  blobRepo: AssetBlobRepoPort;
  journalRepo: BlobGcJournalRepoPort;
  blobStore: BlobStorePort;
}

export interface RunBlobGcUnlinkPassRequired {
  deps: RunBlobGcUnlinkPassDeps;
  input: { workspaceId: UUID };
}

/**
 * Unlink-pass. Drains every journal entry for the workspace; for each, under
 * that entry's sha256 lock, re-checks whether a **live** `asset_blobs` row now
 * exists for the same sha256 (a dedup upload can legitimately recreate one
 * after the delete-pass ran but before this pass drained the entry). If one
 * exists, the entry is stale — its bytes are now owned by the live row, so
 * this pass must NOT unlink them; the journal entry is still removed (its
 * job — reconciling the row this ADR's crash-safety story cares about — is
 * done either way). If no row exists, the bytes are genuinely orphaned and
 * are removed.
 *
 * This re-check-under-lock is this build's substitute for ADR-027 §3's
 * per-generation storage-key epochs (deferred — see `blob-key.ts`'s file
 * header): instead of tagging storage keys with a generation suffix so a
 * stale unlink physically cannot address live bytes, the sha256 lock plus
 * this re-check gives the same guarantee for a single-process, in-memory
 * build (see `blob-gc-lock.ts`'s file header for the serialization story this
 * relies on).
 *
 * @complexity O(j) in the number of pending journal entries for the
 * workspace, each doing O(1) repo/store work.
 * @overallScore 100
 */
export async function runBlobGcUnlinkPass(
  required: RunBlobGcUnlinkPassRequired
): Promise<{ unlinked: string[]; skipped: string[] }> {
  const { deps, input } = required;
  const entries = await deps.journalRepo.list(input);
  const unlinked: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    await withSha256Lock(entry.sha256, async () => {
      const liveRow = await deps.blobRepo.findByHash({
        workspaceId: entry.workspaceId,
        sha256: entry.sha256,
      });
      if (liveRow) {
        skipped.push(entry.sha256);
      } else {
        await deps.blobStore.remove({ storageKey: entry.storageKey });
        unlinked.push(entry.sha256);
      }
      await deps.journalRepo.remove({ workspaceId: entry.workspaceId, id: entry.id });
    });
  }

  return { unlinked, skipped };
}

// ---------------------------------------------------------------------------
// Batch convenience (not a scheduler — see file header)
// ---------------------------------------------------------------------------

export interface RunBlobGcCycleDeps
  extends RunBlobGcDeletePassDeps,
    Pick<RunBlobGcUnlinkPassDeps, "blobStore"> {}

export interface RunBlobGcCycleRequired {
  deps: RunBlobGcCycleDeps;
  input: { workspaceId: UUID };
}

/**
 * Convenience wrapper: runs the delete-pass over every currently-tombstoned
 * blob in the workspace (each still individually grace-gated —
 * `runBlobGcDeletePass` may no-op per row), then drains the unlink-pass once.
 * This is NOT the ADR's periodic/monthly orphan sweep (a different,
 * out-of-scope reconciliation against bytes with no row at all — see
 * {@link runMonthlyOrphanSweepStub}); it is just a batch shape over the two
 * in-scope phases above, for tests and any future manual/operator trigger.
 * Nothing calls it on a schedule.
 *
 * @complexity O(t * n + j) — t tombstoned rows each doing an O(n)
 * `isBlobUnreferenced` re-check, plus O(j) journal drain.
 * @overallScore 100
 */
export async function runBlobGcCycle(
  required: RunBlobGcCycleRequired
): Promise<{ deletedShas: string[]; unlinked: string[]; skipped: string[] }> {
  const { deps, input } = required;
  const rows = await deps.blobRepo.list(input);
  const tombstonedRows = rows.filter((row) => row.status === "tombstoned");

  const deletedShas: string[] = [];
  for (const row of tombstonedRows) {
    const result = await runBlobGcDeletePass({ deps, input: { workspaceId: input.workspaceId, sha256: row.sha256 } });
    if (result.deleted) deletedShas.push(row.sha256);
  }

  const { unlinked, skipped } = await runBlobGcUnlinkPass({ deps, input });
  return { deletedShas, unlinked, skipped };
}

// ---------------------------------------------------------------------------
// Explicitly out of scope — named stub only (see file header)
// ---------------------------------------------------------------------------

/**
 * STUB — ADR-027 §5's fourth GC phase, a periodic/monthly orphan sweep that
 * reconciles bytes physically present in the blob store with no
 * corresponding `asset_blobs` row at all (e.g. bytes from a crash before any
 * GC protocol existed, or before this build's ordering guarantee was in
 * place). Out of scope for this task ("needs a scheduler this build doesn't
 * have yet" — see this file's header). Performs no work; exists only so the
 * seam a future scheduler would call has a name and signature. Never invoked
 * anywhere in this build.
 *
 * @complexity O(1) (stub — does nothing).
 * @overallScore 100
 */
export async function runMonthlyOrphanSweepStub(
  _deps: { blobStore: BlobStorePort; blobRepo: AssetBlobRepoPort },
  _input: { workspaceId: UUID }
): Promise<{ implemented: false }> {
  return { implemented: false };
}
