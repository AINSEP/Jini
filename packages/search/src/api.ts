/**
 * @file The two runtime objects a host consumes (FROZEN for this build, 2026-10-21; change additively).
 *
 * Consumers (a public `/api/search` route, a theme search block, agent tools) only ever receive a
 * {@link SearchService}. The composition root alone holds the {@link SearchIndexer} and wires it to
 * the host event bus and a background job.
 */
import type { SearchPage, SearchQuery } from './contract.js';
import type { SearchSiteTargets, SearchSourceEvent, SearchStatusCounts } from './ports.js';

export type SearchUnavailableReason =
  | 'not_configured'        // no active target, or the active provider is not registered
  | 'timeout'               // the provider exceeded the service deadline
  | 'provider_unavailable'  // the provider answered `unknown`
  | 'provider_error'        // the provider answered `rejected` for a reason other than invalid input
  | 'access_check_failed';  // the fail-closed revalidation step failed

export type SearchServiceResult =
  | { readonly status: 'ok'; readonly providerId: string; readonly page: SearchPage }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'unavailable'; readonly reason: SearchUnavailableReason };

export interface SearchTargetStatus {
  readonly providerId: string;
  readonly generation: number;
  readonly registered: boolean;
  readonly counts: SearchStatusCounts;
}

export interface SearchStatus {
  readonly siteId: string;
  readonly active: SearchTargetStatus | null;
  readonly building: SearchTargetStatus | null;
}

export interface SearchService {
  /**
   * Run a query against the site's ACTIVE target, then drop every hit the access port does not
   * confirm as visible right now. `audiences` comes only from the host's viewer resolution; it is
   * ignored (public only) when the active provider does not accept restricted content.
   */
  query(
    required: { readonly siteId: string; readonly workspaceId: string; readonly query: Omit<SearchQuery, 'audiences'> },
    optional?: { readonly audiences?: readonly string[] },
  ): Promise<SearchServiceResult>;
  status(required: { readonly siteId: string }): Promise<SearchStatus>;
}

export interface SearchBackfillResult {
  /** Every source scanned to completion for the building (or active) target. */
  readonly done: boolean;
  readonly written: number;
  /** The building target was promoted to active in this call. */
  readonly promoted: boolean;
}

export interface SearchIndexer {
  /** Event names to subscribe to (union of every source's `events`). */
  readonly eventNames: readonly string[];
  /** Bus handler: re-load the named document and write it (or its tombstone) to every target. */
  handleEvent(required: { readonly event: SearchSourceEvent }): Promise<void>;
  /** Retry `failed` rows and settle `pending`/`unknown` rows (awaitTask / revisionOf). Bounded. */
  reconcile(required: { readonly siteId: string; readonly workspaceId: string }, optional?: { readonly limit?: number }): Promise<{ readonly settled: number; readonly remaining: number }>;
  /**
   * Resumable backfill of the building target (else the active one) from each source's `scan`,
   * continuing from the stored watermark; promotes building→active atomically once every source is
   * done and nothing is pending/unknown. Bounded by `optional.pageBudget` pages.
   */
  backfill(required: { readonly siteId: string; readonly workspaceId: string }, optional?: { readonly pageBudget?: number }): Promise<SearchBackfillResult>;
  /** Start a rebuild into a new generation of `providerId` (a provider switch or a full reindex). */
  startRebuild(required: { readonly siteId: string; readonly workspaceId: string; readonly providerId: string }): Promise<SearchSiteTargets>;
}
