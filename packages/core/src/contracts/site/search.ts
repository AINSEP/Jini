/**
 * @file The site-search provider contract and the query service's result, as types only.
 *
 * An additive copy of the declarations in `@jini-ai/search` (`contract.ts` and `api.ts`); that
 * package keeps its identical declarations, values and exports until the paired cutover. The
 * provider-key helpers (`encodeSearchKey`, `searchIndexName`, …) stay runtime code in
 * `@jini-ai/search`.
 */
import type { HttpClientPort } from '../../primitives/http.js';
import type { ProviderContext, ProviderResult } from '../../provider-registry.js';

/** A document's identity. Every part is part of the key; none is optional. */
export interface SearchDocumentKey {
  readonly siteId: string;
  readonly workspaceId: string;
  /** e.g. `post`, `page`, `product`. Grammar `^[a-z][a-z0-9_]{0,63}$`. */
  readonly collection: string;
  readonly documentId: string;
}

/** Who may see a document. Restricted documents reach only providers with `acceptsRestricted`. */
export type SearchVisibility =
  | { readonly kind: 'public' }
  | { readonly kind: 'restricted'; readonly audiences: readonly string[] };

export type SearchFieldValue = string | number | boolean | readonly string[];

export interface SearchDocument {
  readonly key: SearchDocumentKey;
  /** Non-negative safe integer, strictly increasing per key across every change incl. removal. */
  readonly revision: number;
  readonly locale?: string;
  /** Site-relative public URL, e.g. `/blog/hello`. */
  readonly url: string;
  /** Plain text; a provider must never interpret it as markup. */
  readonly title: string;
  /** Plain text; a provider must never interpret it as markup. */
  readonly body: string;
  /** Filterable attributes (exact match only in v1). */
  readonly fields?: Readonly<Record<string, SearchFieldValue>>;
  readonly visibility: SearchVisibility;
}

/** A versioned removal. A later upsert must carry a strictly greater revision to revive the key. */
export interface SearchTombstone {
  readonly key: SearchDocumentKey;
  readonly revision: number;
}

export interface SearchQuery {
  /** Required, trimmed non-empty; an empty text is `rejected` with `invalid_request`. */
  readonly text: string;
  readonly collections?: readonly string[];
  readonly locale?: string;
  /** Exact-match filters on `SearchDocument.fields`. */
  readonly filters?: Readonly<Record<string, string | number | boolean>>;
  /** Set ONLY by the host from the viewer's principal, never from user input. Absent = public only. */
  readonly audiences?: readonly string[];
  /** 1..100; default 10. */
  readonly limit?: number;
  /** Opaque cursor from a previous page of the same query. */
  readonly cursor?: string;
}

/** UTF-16 code-unit offsets into `SearchHit.snippet`, `start < end <= snippet.length`. */
export interface SearchHighlight {
  readonly start: number;
  readonly end: number;
}

export interface SearchHit {
  readonly key: SearchDocumentKey;
  /** The revision the provider returned this hit from (the service revalidates it). */
  readonly revision: number;
  readonly url: string;
  readonly title: string;
  /** Plain text excerpt of the body (no HTML). May be empty only when the body is empty. */
  readonly snippet: string;
  readonly highlights: readonly SearchHighlight[];
  /** Provider-private relevance; only the ordering within one page is meaningful. */
  readonly score: number;
}

export interface SearchPage {
  readonly hits: readonly SearchHit[];
  readonly nextCursor?: string;
}

export interface SearchCapabilities {
  /** Only the in-process built-in provider may set this; vendors must declare `false`. */
  readonly acceptsRestricted: boolean;
  readonly typoTolerance: boolean;
  readonly locales: readonly string[] | 'any';
  /** Max documents/tombstones per write call. */
  readonly maxBatch: number;
  /** Writes may answer `pending` with a `taskId`; the provider then implements `awaitTask`. */
  readonly asyncIndexing: boolean;
}

/** Per-key outcome of one write call. A write call reports one outcome per input, in input order. */
export type SearchWriteStatus =
  /** Durable and visible to queries. */
  | 'applied'
  /** Ignored: the provider already holds an equal or greater revision (document or tombstone). */
  | 'stale'
  /** Accepted asynchronously; settle with `awaitTask(taskId)`. */
  | 'pending'
  /** Refused for this key only (e.g. too large); the message is caller-safe. */
  | 'rejected';

export interface SearchWriteOutcome {
  readonly key: SearchDocumentKey;
  readonly revision: number;
  readonly status: SearchWriteStatus;
  readonly message?: string;
}

export interface SearchWriteResult {
  readonly outcomes: readonly SearchWriteOutcome[];
  /** Set when any outcome is `pending`. */
  readonly taskId?: string;
}

export type SearchTaskState = 'pending' | 'succeeded' | 'failed';

/** What the provider holds for a key: absent (never written), a live document or a tombstone. */
export interface SearchRevisionState {
  readonly key: SearchDocumentKey;
  readonly revision: number | null;
  readonly deleted: boolean;
}

/**
 * Pre-resolved per call by the host. Credentials come from the host's vault, never from the plugin
 * manifest; the HTTP client is the host's guarded egress client (no raw fetch in a provider).
 */
export interface SearchProviderContext extends ProviderContext {
  readonly siteId: string;
  /** Unique per install + site + provider + generation (see `searchIndexName`). */
  readonly indexName: string;
  readonly credentials: Readonly<Record<string, string>>;
  readonly httpClient: HttpClientPort;
  /** Hard per-request budget; a provider maps an overrun to `unknown`/`timeout`. */
  readonly timeoutMs: number;
  readonly now: () => number;
  /** Opaque host storage handle for in-process providers (the built-in); vendors ignore it. */
  readonly storage?: unknown;
}

/**
 * A search backend. Stateless between calls (all state lives in the backend, keyed by
 * `ctx.indexName`), never throws, and never reads or writes host tables except through
 * `ctx.storage` on its own tables.
 */
export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: SearchCapabilities;
  /** Names of the credential values the host must supply in `ctx.credentials`. */
  readonly credentialKeys: readonly string[];
  /** Create the index if missing and apply settings. Idempotent. */
  ensureIndex(ctx: SearchProviderContext, required?: Record<string, never>): Promise<ProviderResult<void>>;
  /** Delete the whole index (an old generation after a switch). Absent index is `ok`. */
  dropIndex(ctx: SearchProviderContext, required?: Record<string, never>): Promise<ProviderResult<void>>;
  upsert(ctx: SearchProviderContext, required: { readonly documents: readonly SearchDocument[] }): Promise<ProviderResult<SearchWriteResult>>;
  remove(ctx: SearchProviderContext, required: { readonly tombstones: readonly SearchTombstone[] }): Promise<ProviderResult<SearchWriteResult>>;
  /** Only documents keyed to `ctx.siteId` and `ctx.workspaceId` match, even when other tenants share the index. */
  query(ctx: SearchProviderContext, required: { readonly query: SearchQuery }): Promise<ProviderResult<SearchPage>>;
  revisionOf(ctx: SearchProviderContext, required: { readonly keys: readonly SearchDocumentKey[] }): Promise<ProviderResult<readonly SearchRevisionState[]>>;
  /** Required when `capabilities.asyncIndexing`; reports the state of an earlier `pending` write. */
  awaitTask?(ctx: SearchProviderContext, required: { readonly taskId: string }): Promise<ProviderResult<SearchTaskState>>;
}

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
