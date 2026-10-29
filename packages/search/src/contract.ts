/**
 * @file The site-search provider contract (FROZEN for this build, 2026-10-21; change additively).
 *
 * One interface every search backend implements: the owner's built-in provider, vendor plugins
 * (Meilisearch first) and the in-memory reference provider the conformance kit runs against. The
 * host never talks to a backend except through {@link SearchProvider}; the indexer
 * (`indexer.ts`) is the ONE writer and the query service (`service.ts`) the ONE reader.
 *
 * Decisions folded in from the 2026-10-21 provider gap check (they override the first design):
 * - Keys are namespaced site/workspace/collection/document, so two sites can never collide even when
 *   they share a vendor index or a document id.
 * - `revision` is a NUMBER (a string version sorts "10" before "9"). A write whose revision is not
 *   strictly greater than what the provider holds for that key — including a tombstone — is `stale`
 *   and changes nothing, so a delayed write can never resurrect a removed document.
 * - Removal writes a versioned tombstone, also for a key that was never indexed.
 * - Vendors are PUBLIC-ONLY: only a provider declaring `acceptsRestricted` may receive a document
 *   with restricted visibility (the indexer turns such a write into a removal for every other
 *   provider). Snippets are plain text plus highlight ranges, never HTML.
 * - Facets are not in v1 (declared-but-never-returned was a contract bug).
 * - Methods never throw: definite refusals are `rejected`, indeterminate outcomes (timeout, network,
 *   provider down) are `unknown` and are reconciled, never blindly retried.
 */
import { trimChars, type HttpClientPort } from '@jini-ai/core/primitives';
import type { ProviderContext, ProviderResult } from '@jini-ai/core/provider-registry';
import { sha256Hex } from './digest.js';

/** The contract name used by the provider registry and plugin contributions. */
export const SEARCH_CONTRACT = 'search';

/** The id the owner's in-process provider registers under; also the per-site default. */
export const BUILTIN_SEARCH_PROVIDER_ID = 'builtin';

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

/** What a plugin module's default export must be (validated by `contribution.ts`). */
export type SearchProviderModule = SearchProvider;

const SEP = '/';

/**
 * The single string form of a key, for maps, state rows and vendor document ids. Each part is
 * `encodeURIComponent`-ed so a `/` inside a part can never forge another key.
 * @complexity O(total key length).
 */
export function encodeSearchKey(required: { readonly key: SearchDocumentKey }): string {
  const { siteId, workspaceId, collection, documentId } = required.key;
  return [siteId, workspaceId, collection, documentId].map(part => encodeURIComponent(part)).join(SEP);
}

/** Inverse of {@link encodeSearchKey}; `undefined` for anything that is not exactly four parts. */
export function decodeSearchKey(required: { readonly encoded: string }): SearchDocumentKey | undefined {
  const parts = required.encoded.split(SEP);
  if (parts.length !== 4) return undefined;
  try {
    const [siteId, workspaceId, collection, documentId] = parts.map(part => decodeURIComponent(part)) as [string, string, string, string];
    return { siteId, workspaceId, collection, documentId };
  } catch {
    return undefined;
  }
}

/**
 * The backend index name for one install, site, provider and generation. Derived from the install
 * id (never the site slug) so two installs sharing a vendor account cannot collide, and the
 * generation suffix is what makes a provider switch or full rebuild an atomic pointer flip.
 * The identity is a SHA-256 digest (160 bits kept) of the COMPLETE, unambiguously encoded
 * (installId, siteId, providerId) tuple: a lossy slug (`site-a` vs `site_a`, two long ids sharing a
 * prefix) would give two sites one index, and dropping one site's generation would delete the
 * other's. The generation stays a distinct, readable suffix, never truncated; the provider prefix is
 * only a readable label.
 * Output grammar `[a-z0-9_]`, at most 120 chars (fits Meilisearch and Algolia index-name rules).
 * @complexity O(input length).
 */
export function searchIndexName(required: { readonly installId: string; readonly siteId: string; readonly providerId: string; readonly generation: number }): string {
  const label = trimChars({ text: required.providerId.toLowerCase().replace(/[^a-z0-9]+/g, '_'), chars: '_' }).slice(0, 24) || 'x';
  const identity = sha256Hex({ text: JSON.stringify([required.installId, required.siteId, required.providerId]) }).slice(0, 40);
  return `js_${label}_${identity}_g${required.generation}`;
}
