/**
 * @file Neutral identities, provenance and the key fence for media blob garbage collection (p11 J1a
 * seam). Types only: CMS repos and media policy stay out of core.
 *
 * Enumeration rule (the J1 contract gap): every listing port a collector reads — owned blobs, the
 * purge journal — is scoped by `workspaceId`, and a collector never enumerates across workspaces. So
 * the WORKSPACE IS BOUND WHEN THE COLLECTOR IS BUILT (`BlobGcScope`), not supplied per pass: the pass
 * methods take only their run controls (`signal`, limits) and list `{ workspaceId: scope.workspaceId }`.
 * A host serving many workspaces builds one collector per workspace; there is no "all workspaces"
 * listing, because one tenant's pass must never be able to read or remove another tenant's keys.
 */

/** One stored object: the workspace that owns it, its storage key, and the digest of its bytes. */
export type BlobIdentity = {
  readonly workspaceId: string;
  readonly storageKey: string;
  readonly sha256: string;
};

/** Why a blob was journaled for removal. A legacy entry without a reason is never unlinked. */
export type BlobPurgeReason = "owner-purge" | "trash-ttl" | "upload-rollback";

/**
 * Cross-process exclusion over byte keys and media assets. Lock order is fixed: any process-local
 * single-flight lock → `withAsset` → `withKeys` (keys sorted, deduplicated) → storage transaction;
 * never call `withAsset` from inside `withKeys`.
 */
export interface BlobFence {
  withKeys<T>(
    required: { workspaceId: string; storageKeys: readonly string[]; work: () => Promise<T> },
    optional?: Record<string, never>,
  ): Promise<T>;
  withAsset<T>(
    required: { workspaceId: string; assetId: string; work: () => Promise<T> },
    optional?: Record<string, never>,
  ): Promise<T>;
}

/** The canonical storage key for a workspace's bytes of one digest. */
export type BlobStorageKeyFor = (
  required: { workspaceId: string; sha256: string },
  optional?: Record<string, never>,
) => string;

/** The one workspace a collector is bound to at construction; every listing it makes uses this id. */
export interface BlobGcScope {
  readonly workspaceId: string;
}

/** What a journaled key held for its owner: the asset's original bytes or one derived rendition. */
export type BlobJournalRole = "original" | "rendition";

/**
 * One key queued for a later unlink, with the provenance that alone can make it eligible. The
 * `sha256` is the digest of THESE bytes — a rendition's own output digest, never its source asset's.
 * `reason` is absent only on legacy entries, and an entry without it is keep/report, never unlinked.
 */
export type BlobJournalIdentity = BlobIdentity & {
  readonly role: BlobJournalRole;
  readonly reason?: BlobPurgeReason;
};

/**
 * Writer-side half of the journal (J1a): a writer that takes ownership of a key — a fresh write, a
 * dedup hit, a tombstone resurrection, a rendition save — clears any pending journal eligibility
 * for exactly that key, inside the same fence/transaction as the ownership change, so bytes that
 * regained an owner are never unlinked by an entry queued before they did.
 */
export interface BlobJournalEligibility {
  clearForKeys(
    required: { workspaceId: string; storageKeys: readonly string[] },
    optional?: Record<string, never>,
  ): Promise<void>;
}
