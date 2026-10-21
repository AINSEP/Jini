/**
 * @file The ONE reader of every search index (lot S4).
 *
 * Queries the site's ACTIVE target only, under a hard deadline, and then FAILS CLOSED: a hit is
 * returned only when it belongs to this site and workspace and the host's access port confirms it
 * is visible right now. A provider's index may lag a publish/unpublish; the access port never does.
 */
import type { ProviderRegistry, ProviderResult } from '@jini-ai/core/provider-registry';
import { encodeSearchKey, type SearchPage, type SearchProvider, type SearchProviderContext, type SearchQuery } from './contract.js';
import type { SearchService, SearchServiceResult, SearchTargetStatus } from './api.js';
import type { SearchAccessPort, SearchIndexStatePort, SearchTarget, SearchTargetPort } from './ports.js';

export interface SearchServiceRequired {
  readonly registry: ProviderRegistry<SearchProvider>;
  readonly targets: SearchTargetPort;
  readonly state: SearchIndexStatePort;
  readonly access: SearchAccessPort;
  contextFor(required: { readonly target: SearchTarget; readonly workspaceId: string }): Promise<SearchProviderContext | null>;
}

export interface SearchServiceOptional {
  /** Service deadline per query (default 3000 ms); an overrun answers `unavailable/timeout`. */
  readonly timeoutMs?: number;
  /** Resolves after `ms`; injected so tests control time. */
  readonly delay?: (ms: number) => Promise<void>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const TIMED_OUT: unique symbol = Symbol('timed-out');

const defaultDelay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** A provider that throws despite the contract is as good as unreachable. */
async function guardedQuery(call: () => Promise<ProviderResult<SearchPage>>): Promise<ProviderResult<SearchPage> | 'threw'> {
  try {
    return await call();
  } catch {
    return 'threw';
  }
}

/** The provider's answer as a service result, or the page to revalidate. */
function pageOrFailure(result: ProviderResult<SearchPage> | 'threw' | typeof TIMED_OUT): SearchPage | SearchServiceResult {
  if (result === TIMED_OUT) return { status: 'unavailable', reason: 'timeout' };
  if (result === 'threw' || result.status === 'unknown') return { status: 'unavailable', reason: 'provider_unavailable' };
  if (result.status === 'ok') return result.value;
  if (result.error.code === 'invalid_request') return { status: 'invalid', message: result.error.message };
  return { status: 'unavailable', reason: 'provider_error' };
}

/** The limit clamped to 1..100 (default 10), or the invalid result for a non-integer. */
function readLimit(limit: number | undefined): number | SearchServiceResult {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit)) return { status: 'invalid', message: 'limit must be an integer' };
  return Math.min(MAX_LIMIT, Math.max(1, limit));
}

/**
 * Build the query service.
 * @param required - Registry, target pointer, index state, access port and the context resolver.
 * @param optional.timeoutMs - Per-query deadline (default 3000).
 * @param optional.delay - Timer port (default `setTimeout`).
 * @returns The {@link SearchService} consumers receive.
 * @complexity query O(hits) plus one provider call and one access check; status O(1) port calls.
 */
export function createSearchService(required: SearchServiceRequired, optional: SearchServiceOptional = {}): SearchService {
  const { registry, targets, state, access } = required;
  const { timeoutMs = 3000, delay = defaultDelay } = optional;

  /** The active target's provider and context, or null when search is not configured. */
  const activeProvider = async (siteId: string, workspaceId: string) => {
    const { active } = await targets.get({ siteId });
    if (active === null) return null;
    const provider = registry.get({ id: active.providerId })?.provider;
    if (!provider) return null;
    const ctx = await required.contextFor({ target: active, workspaceId });
    return ctx ? { active, provider, ctx } : null;
  };

  /** Fail closed: only this site's and workspace's hits that the access port confirms right now. */
  const revalidate = async (input: { siteId: string; workspaceId: string; page: SearchPage; audiences: readonly string[] }): Promise<SearchPage | null> => {
    const { siteId, workspaceId, page } = input;
    // Index isolation defence: a shared vendor index or a provider bug must never leak another site.
    const own = page.hits.filter(hit => hit.key.siteId === siteId && hit.key.workspaceId === workspaceId);
    let visible: ReadonlySet<string> = new Set();
    if (own.length > 0) {
      try {
        visible = await access.visibleKeys({ siteId, keys: own.map(hit => hit.key), audiences: input.audiences });
      } catch {
        return null;
      }
    }
    const hits = own.filter(hit => visible.has(encodeSearchKey({ key: hit.key })));
    return page.nextCursor === undefined ? { hits } : { hits, nextCursor: page.nextCursor };
  };

  const targetStatus = async (target: SearchTarget | null): Promise<SearchTargetStatus | null> => {
    if (target === null) return null;
    return {
      providerId: target.providerId, generation: target.generation,
      registered: registry.has({ id: target.providerId }),
      counts: await state.counts({ target }),
    };
  };

  return {
    async query({ siteId, workspaceId, query }, { audiences } = {}): Promise<SearchServiceResult> {
      const text = query.text.trim();
      if (text.length === 0) return { status: 'invalid', message: 'text is required' };
      const limit = readLimit(query.limit);
      if (typeof limit !== 'number') return limit;
      const configured = await activeProvider(siteId, workspaceId);
      if (!configured) return { status: 'unavailable', reason: 'not_configured' };
      const { active, provider, ctx } = configured;
      // Vendors are public-only: a viewer's audiences reach only a provider that may hold restricted
      // content. The query object is rebuilt so a caller cannot smuggle audiences in through it.
      const { audiences: _smuggled, ...rest } = query as SearchQuery;
      const effective = provider.capabilities.acceptsRestricted ? (audiences ?? []) : [];
      const providerQuery: SearchQuery = { ...rest, text, limit, ...(provider.capabilities.acceptsRestricted ? { audiences: effective } : {}) };
      const raced = await Promise.race([
        guardedQuery(() => provider.query(ctx, { query: providerQuery })),
        delay(timeoutMs).then((): typeof TIMED_OUT => TIMED_OUT),
      ]);
      const answered = pageOrFailure(raced);
      if ('status' in answered) return answered;
      const page = await revalidate({ siteId, workspaceId, page: answered, audiences: effective });
      if (page === null) return { status: 'unavailable', reason: 'access_check_failed' };
      return { status: 'ok', providerId: active.providerId, page };
    },

    async status({ siteId }) {
      const { active, building } = await targets.get({ siteId });
      return { siteId, active: await targetStatus(active), building: await targetStatus(building) };
    },
  };
}
