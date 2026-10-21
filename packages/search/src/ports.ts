/**
 * @file Host ports of the search runtime (FROZEN for this build, 2026-10-21; change additively).
 *
 * The indexer and query service are generic; the host supplies: where documents come from
 * ({@link SearchDocumentSource}), where index bookkeeping lives ({@link SearchIndexStatePort}, a
 * table in the host DB), which provider/generation each site uses ({@link SearchTargetPort}) and
 * the final word on whether a hit may be shown ({@link SearchAccessPort}).
 */
import type { SearchDocument, SearchDocumentKey } from './contract.js';

/** The minimum of a host domain event the indexer reads (structurally a CMS `DomainEvent`). */
export interface SearchSourceEvent {
  readonly name: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly aggregateId?: string;
  readonly payload?: unknown;
}

/**
 * The current truth for one document. `document: null` means "must not be in any index now" (draft,
 * trashed, scheduled for later, deleted). `revision` is required either way: it becomes the
 * tombstone's revision, so it must be strictly greater than any revision this key was indexed with.
 */
export interface SearchSourceRecord {
  readonly key: SearchDocumentKey;
  readonly revision: number;
  readonly document: SearchDocument | null;
}

/**
 * One collection's documents (CMS posts, pages, a plugin's catalog …). Registered as a many-token.
 * The indexer never trusts an event payload: every event only names a document, which is then
 * re-`load`ed, so a delayed or duplicated event can never index stale or unpublished content.
 */
export interface SearchDocumentSource {
  /** `^[a-z][a-z0-9_]{0,63}$`, unique among sources. */
  readonly collection: string;
  /** Event names that may change a document of this collection. */
  readonly events: readonly string[];
  /** The document id an event refers to, or `null` when the event is not about this collection. */
  documentIdOf(required: { readonly event: SearchSourceEvent }): string | null;
  load(required: { readonly siteId: string; readonly workspaceId: string; readonly documentId: string; readonly occurredAtMs: number }): Promise<SearchSourceRecord>;
  /**
   * Stable-order scan for backfill. `cursor` is the opaque watermark from the previous page;
   * `nextCursor` absent means the scan is complete. Records with `document: null` may be omitted.
   */
  scan(required: { readonly siteId: string; readonly workspaceId: string; readonly limit: number }, optional?: { readonly cursor?: string }): Promise<{ readonly records: readonly SearchSourceRecord[]; readonly nextCursor?: string }>;
}

/** One index a site writes to. `building` exists only during a rebuild or provider switch. */
export interface SearchTarget {
  readonly siteId: string;
  readonly providerId: string;
  readonly generation: number;
}

export interface SearchSiteTargets {
  readonly active: SearchTarget | null;
  readonly building: SearchTarget | null;
}

/** Persisted pointer per site. `promote` is the atomic generation switch (compare-and-swap). */
export interface SearchTargetPort {
  get(required: { readonly siteId: string }): Promise<SearchSiteTargets>;
  /** Start a rebuild into `target`; replaces an unfinished earlier `building`. */
  setBuilding(required: { readonly target: SearchTarget }): Promise<void>;
  /**
   * Atomically make `building` active iff the stored building still equals `expected`; returns the
   * replaced active target (to drop) or `false` when someone else changed the pointer first.
   */
  promote(required: { readonly siteId: string; readonly expected: SearchTarget }): Promise<{ readonly replaced: SearchTarget | null } | false>;
  /** Abandon a rebuild (e.g. the new provider was removed). */
  clearBuilding(required: { readonly siteId: string }): Promise<void>;
}

export type SearchIndexStatus = 'pending' | 'indexed' | 'unknown' | 'failed';

/** One key's bookkeeping in one target. `deleted: true` rows are the indexer's own tombstones. */
export interface SearchIndexStateRow {
  readonly target: SearchTarget;
  readonly key: SearchDocumentKey;
  readonly revision: number;
  readonly deleted: boolean;
  readonly status: SearchIndexStatus;
  readonly attempts: number;
  readonly taskId?: string;
  readonly lastError?: string;
  readonly updatedAtMs: number;
}

/** The row identity a settle observed: its revision and the provider task it awaited (`null` = none). */
export interface SearchSettleExpectation {
  readonly revision: number;
  readonly taskId: string | null;
}

export type SearchStatusCounts = Readonly<Record<SearchIndexStatus, number>>;

/**
 * Index bookkeeping (host table `search_index_state` + watermarks). Only the indexer writes it.
 * `put` is an upsert by (target, key).
 */
export interface SearchIndexStatePort {
  get(required: { readonly target: SearchTarget; readonly key: SearchDocumentKey }): Promise<SearchIndexStateRow | null>;
  put(required: { readonly row: SearchIndexStateRow }): Promise<void>;
  /**
   * Compare-and-swap settle: write `row` iff the stored row for (row.target, row.key) still carries
   * `expected.revision` and `expected.taskId` (`null` = no task), atomically. Resolves whether it
   * was written; `false` means a newer write replaced the row meanwhile and owns its settlement, so
   * an older write's (or task's) completion can never overwrite the newer revision's bookkeeping.
   */
  settle(required: { readonly row: SearchIndexStateRow; readonly expected: SearchSettleExpectation }): Promise<boolean>;
  /**
   * Rows of a target in the given statuses, oldest first, at most `limit`. With
   * `optional.failedBelowAttempts`, `failed` rows whose `attempts` reached it are excluded BEFORE the
   * limit applies, so exhausted rows can never fill every page and starve actionable work.
   */
  listByStatus(required: { readonly target: SearchTarget; readonly statuses: readonly SearchIndexStatus[]; readonly limit: number }, optional?: { readonly failedBelowAttempts?: number }): Promise<readonly SearchIndexStateRow[]>;
  counts(required: { readonly target: SearchTarget }): Promise<SearchStatusCounts>;
  /** Backfill watermark per (target, collection): `null` = not started, `{ done: true }` = complete. */
  getWatermark(required: { readonly target: SearchTarget; readonly collection: string }): Promise<{ readonly cursor?: string; readonly done: boolean } | null>;
  putWatermark(required: { readonly target: SearchTarget; readonly collection: string; readonly cursor?: string; readonly done: boolean }): Promise<void>;
  /** Drop every row and watermark of a target (after it was replaced). */
  deleteTarget(required: { readonly target: SearchTarget }): Promise<void>;
}

/**
 * The fail-closed last check before a hit is shown: given the hits a provider returned, which keys
 * are visible to this viewer RIGHT NOW (published, not trashed, audience allowed). A provider's index
 * may lag; this never does. Throwing or rejecting makes the whole query `unavailable`.
 */
export interface SearchAccessPort {
  visibleKeys(required: { readonly siteId: string; readonly keys: readonly SearchDocumentKey[]; readonly audiences: readonly string[] }): Promise<ReadonlySet<string>>;
}
