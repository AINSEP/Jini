import { defineJsonRoute, ok, routeReply, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import type { SearchServiceResult } from '@jini-ai/core/contracts/site/search';
import { parseSearchRequest, type SearchQueryIssue } from '../../../http-query.js';

/**
 * @file `GET /api/search?q=&collection=&limit=&cursor=` — the public site-search endpoint (lot S4).
 * Public and unauthenticated, like the other site routes; every hit has already been re-checked by
 * the search service's fail-closed access port before it reaches this file.
 *
 * Viewer audiences come ONLY from the visitor's own member session cookie (the same cookie and
 * resolver the member-gated page routes use), never from the query string: a member sees their
 * members-only matches, everyone else public ones. Because the answer can differ per visitor, it is
 * sent `private, no-store`, the convention every member-gated route here follows.
 *
 * Responses: `200 { hits: [{ url, title, snippet, highlights, collection }], nextCursor }` (plain-text
 * snippets; `nextCursor` is `null` on the last page), `400 { error: 'invalid_request', message }`,
 * `503 { error: 'search_unavailable', reason }` (no runtime in this composition, no configured
 * provider, timeout, provider down, access check failed) and `500` for anything unexpected.
 *
 * The session token is read from that cookie by the host, bound to the request (`sessionToken`); the
 * `500` is the host's error port, since a rejection is thrown, not caught here.
 */

/** The query shape `parseSearchRequest` accepts (what the service is asked for, minus audiences). */
type ParsedSearchQuery = Extract<ReturnType<typeof parseSearchRequest>, { query: unknown }>['query'];

/** The site-search runtime the route reads: the service, the site it serves and the session audiences. */
export interface SiteSearchRouteRuntime {
  readonly siteId: string;
  readonly workspaceId: string;
  /** Settles once plugin providers were offered to the registry. */
  readonly ready: Promise<unknown>;
  readonly service: { query(required: { siteId: string; workspaceId: string; query: ParsedSearchQuery }, optional: { audiences: readonly string[] }): Promise<SearchServiceResult> };
  audiencesForSession(required: { readonly sessionToken?: string }): Promise<readonly string[]>;
}

/** The narrow deps this route needs. Absent `siteSearch` = this composition has no search. */
export interface SiteSearchRouteDeps {
  readonly siteSearch?: SiteSearchRouteRuntime | undefined;
  readonly clock?: { nowMs(): number } | undefined;
  /** The host's query limits: longest `q` (UTF-16 code units), collections, page size and cursor length. */
  readonly limits: Parameters<typeof parseSearchRequest>[0]['limits'];
  /** Bound to the request by the host: the visitor's own member session token, if any. */
  readonly sessionToken: () => string | undefined;
  /** Bound to the request by the host: records the successful search as a visitor event (consent is the host's). */
  readonly recordSearchPerformed: (required: { readonly properties: Readonly<Record<string, string>> }) => void;
}

function searchQueryErrorMessage({ issue, limits }: { issue: SearchQueryIssue; limits: SiteSearchRouteDeps['limits'] }, _optional: Record<string, never> = {}): string {
  switch (issue.code) {
    case 'not-single': return `'${issue.field}' must be given once`;
    case 'text-required': return "'q' is required";
    case 'text-too-long': return `'q' must be at most ${limits.maxTextLength} characters`;
    case 'invalid-collections': return `'collection' must be up to ${limits.maxCollections} comma-separated names like 'post'`;
    case 'invalid-limit': return `'limit' must be an integer from 1 to ${limits.maxLimit}`;
    case 'invalid-cursor': return "'cursor' must be the nextCursor of a previous page";
  }
}

/** The service result as the public JSON contract. */
function searchReply({ result }: { result: SearchServiceResult }, _optional: Record<string, never> = {}): unknown {
  if (result.status === 'invalid') return routeReply({ status: 400, body: { error: 'invalid_request', message: result.message } });
  if (result.status === 'unavailable') return routeReply({ status: 503, body: { error: 'search_unavailable', reason: result.reason } });
  return {
    hits: result.page.hits.map(hit => ({ url: hit.url, title: hit.title, snippet: hit.snippet, highlights: hit.highlights, collection: hit.key.collection })),
    nextCursor: result.page.nextCursor ?? null,
  };
}

/**
 * One search: session audiences after the runtime is ready, the provider query, the bucketed event.
 * A rejection is not caught here; the mount's error port answers it.
 * @complexity Per request: one member-session read, one provider query and one access check.
 */
async function runSearch({ runtime, deps, query }: { runtime: SiteSearchRouteRuntime; deps: SiteSearchRouteDeps; query: ParsedSearchQuery }, _optional: Record<string, never> = {}): Promise<unknown> {
  await runtime.ready;
  const sessionToken = deps.sessionToken();
  const audiences = await runtime.audiencesForSession(sessionToken === undefined ? {} : { sessionToken });
  const { siteId, workspaceId } = runtime;
  const clock = deps.clock;
  const startedAt = clock?.nowMs();
  const result = await runtime.service.query({ siteId, workspaceId, query }, { audiences });
  if (result.status === 'ok') deps.recordSearchPerformed({ properties: {
    resultCountBucket: searchResultCountBucket({ count: result.page.hits.length }),
    ...(startedAt === undefined || !clock ? {} : { durationBucket: searchDurationBucket({ elapsedMs: clock.nowMs() - startedAt }) }),
  } });
  return searchReply({ result });
}

/** `GET /api/search`; mount it with request-bound `sessionToken` / `recordSearchPerformed` deps. */
export const siteSearchRoute: JsonRouteSpec<Readonly<Record<string, unknown>>, unknown, SiteSearchRouteDeps> & { readonly responseHeaders: Readonly<Record<string, string>> } = {
  ...defineJsonRoute<Readonly<Record<string, unknown>>, unknown, SiteSearchRouteDeps>({
    method: 'get',
    path: '/api/search',
    parse: ({ query }) => ok({ value: query }),
    handle: async ({ input, deps }) => {
      const parsed = parseSearchRequest({ query: input, limits: deps.limits });
      if ('error' in parsed) return ok({ value: routeReply({ status: 400, body: { error: 'invalid_request', message: searchQueryErrorMessage({ issue: parsed.error, limits: deps.limits }) } }) });
      const runtime = deps.siteSearch;
      if (!runtime) return ok({ value: routeReply({ status: 503, body: { error: 'search_unavailable', reason: 'not_configured' } }) });
      return ok({ value: await runSearch({ runtime, deps, query: parsed.query }) });
    },
  }),
  responseHeaders: { 'Cache-Control': 'private, no-store' },
};

function searchResultCountBucket({ count }: { count: number }, _optional: Record<string, never> = {}): string {
  if (count === 0) return '0';
  return count <= 10 ? '1-10' : '11-50';
}

/** Coarse latency only; query terms and exact timing never enter the event. @complexity O(1). */
function searchDurationBucket({ elapsedMs }: { elapsedMs: number }, _optional: Record<string, never> = {}): string {
  if (elapsedMs < 100) return '<100ms';
  if (elapsedMs < 1000) return '100ms-1s';
  return '>=1s';
}
