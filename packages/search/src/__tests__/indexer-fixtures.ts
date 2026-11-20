import { createProviderRegistry, providerOk } from '@jini-ai/core/provider-registry';
import { SEARCH_CONTRACT, type SearchProvider, type SearchProviderContext, type SearchWriteResult } from '../contract.js';
import { createSearchIndexer, type SearchIndexerOptional } from '../indexer.js';
import type { SearchDocumentSource, SearchIndexStateRow, SearchSiteTargets, SearchSourceEvent, SearchTarget } from '../ports.js';
import { contextFor, key, makeProvider, makeSource, makeState, makeTargets, SITE, WS, type FakeProvider } from './fakes/index.js';

export const ACTIVE: SearchTarget = { siteId: SITE, providerId: 'vendor', generation: 1 };
export const BUILDING: SearchTarget = { siteId: SITE, providerId: 'builtin', generation: 2 };
export const OCCURRED = '2026-10-21T10:00:00.000Z';

export const event = (documentId: string, overrides: Partial<SearchSourceEvent> = {}): SearchSourceEvent => ({
  name: 'post.published', workspaceId: WS, occurredAt: OCCURRED, aggregateId: documentId, payload: { collection: 'post' }, ...overrides,
});

interface SetupOptions {
  providers?: FakeProvider[];
  targets?: Partial<SearchSiteTargets>;
  sources?: SearchDocumentSource[];
  noContextFor?: string[];
  optional?: SearchIndexerOptional;
}

export function setup(options: SetupOptions = {}) {
  const vendor = makeProvider({ id: 'vendor' });
  const providers = options.providers ?? [vendor];
  const registry = createProviderRegistry<SearchProvider>({ contract: SEARCH_CONTRACT });
  for (const fake of providers) registry.register({ definition: { id: fake.provider.id, provider: fake.provider } });
  const state = makeState();
  const targets = makeTargets(options.targets ?? { active: ACTIVE });
  const source = makeSource('post');
  const sources = options.sources ?? [source];
  const clock = { now: 5000 };
  const contextCalls: SearchTarget[] = [];
  const siteLookups: string[] = [];
  const fresh = () => createSearchIndexer({
    sources, registry, targets, state,
    resolveSiteId: async ({ workspaceId }) => { siteLookups.push(workspaceId); return workspaceId === WS ? SITE : null; },
    contextFor: async (r): Promise<SearchProviderContext | null> => {
      contextCalls.push(r.target);
      return options.noContextFor?.includes(r.target.providerId) ? null : contextFor(r);
    },
    now: () => clock.now,
  }, options.optional);
  const indexer = fresh();
  return { indexer, fresh, vendor, state, targets, source, registry, clock, contextCalls, siteLookups, providers };
}

export const row = (overrides: Partial<SearchIndexStateRow> & { documentId?: string } = {}): SearchIndexStateRow => {
  const { documentId = 'a', ...rest } = overrides;
  return { target: ACTIVE, key: key(documentId), revision: 3, deleted: false, status: 'indexed', attempts: 1, updatedAtMs: 1, ...rest };
};

export const writeOk = (value: SearchWriteResult) => async () => providerOk({ value });

