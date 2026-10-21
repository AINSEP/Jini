import { describe, expect, it } from 'vitest';
import { createProviderRegistry, providerOk, providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import { SEARCH_CONTRACT, type SearchHit, type SearchPage, type SearchProvider, type SearchQuery } from '../contract.js';
import { createSearchService, type SearchServiceOptional } from '../service.js';
import type { SearchSiteTargets, SearchTarget } from '../ports.js';
import { contextFor, key, makeAccess, makeProvider, makeState, makeTargets, SITE, WS } from './fakes/index.js';

const VENDOR: SearchTarget = { siteId: SITE, providerId: 'vendor', generation: 1 };
const BUILTIN: SearchTarget = { siteId: SITE, providerId: 'builtin', generation: 2 };

const hit = (documentId: string, overrides: { siteId?: string; workspaceId?: string } = {}): SearchHit => ({
  key: key(documentId, 'post', overrides.siteId ?? SITE, overrides.workspaceId ?? WS),
  revision: 1, url: `/${documentId}`, title: documentId, snippet: '', highlights: [], score: 1,
});

function setup(options: { targets?: Partial<SearchSiteTargets>; noContext?: boolean; optional?: SearchServiceOptional; access?: ReturnType<typeof makeAccess> } = {}) {
  const vendor = makeProvider({ id: 'vendor' });
  const builtin = makeProvider({ id: 'builtin', acceptsRestricted: true });
  const registry = createProviderRegistry<SearchProvider>({ contract: SEARCH_CONTRACT });
  registry.register({ definition: { id: 'vendor', provider: vendor.provider } });
  registry.register({ definition: { id: 'builtin', provider: builtin.provider } });
  const state = makeState();
  const targets = makeTargets(options.targets ?? { active: VENDOR });
  const access = options.access ?? makeAccess();
  const service = createSearchService({
    registry, targets, state, access,
    contextFor: async r => (options.noContext ? null : contextFor(r)),
  }, options.optional ?? { delay: () => new Promise(() => undefined) });
  const sentQuery = (fake = vendor) => (fake.calls.find(c => c.method === 'query')?.args as { query: SearchQuery } | undefined)?.query;
  return { service, vendor, builtin, state, targets, access, sentQuery };
}

const ask = (text: string, extra: Partial<SearchQuery> = {}) => ({ siteId: SITE, workspaceId: WS, query: { text, ...extra } });

describe('createSearchService — query validation', () => {
  it('refuses empty text and a non-integer limit without calling the provider', async () => {
    const { service, vendor } = setup();
    expect(await service.query(ask('   '))).toEqual({ status: 'invalid', message: 'text is required' });
    expect(await service.query(ask('hello', { limit: 2.5 }))).toEqual({ status: 'invalid', message: 'limit must be an integer' });
    expect(vendor.calls).toEqual([]);
  });

  it('trims the text and clamps the limit to 1..100 (default 10)', async () => {
    const limits: (number | undefined)[] = [];
    for (const limit of [undefined, 0, 500, 7]) {
      const { service, sentQuery } = setup();
      await service.query(ask('  hello  ', limit === undefined ? {} : { limit }));
      expect(sentQuery()?.text).toBe('hello');
      limits.push(sentQuery()?.limit);
    }
    expect(limits).toEqual([10, 1, 100, 7]);
  });
});

describe('createSearchService — configuration', () => {
  it('is unavailable/not_configured without an active target, a registered provider or a context', async () => {
    const unavailable = { status: 'unavailable', reason: 'not_configured' };
    expect(await setup({ targets: { building: VENDOR } }).service.query(ask('x'))).toEqual(unavailable);
    expect(await setup({ targets: { active: { ...VENDOR, providerId: 'gone' } } }).service.query(ask('x'))).toEqual(unavailable);
    expect(await setup({ noContext: true }).service.query(ask('x'))).toEqual(unavailable);
  });
});

describe('createSearchService — audiences', () => {
  it('never sends audiences to a public-only provider, even when smuggled in the query object', async () => {
    const { service, vendor, access, sentQuery } = setup();
    vendor.page = { hits: [hit('a')] };
    const smuggled = { ...ask('x'), query: { text: 'x', audiences: ['members'] } as unknown as Omit<SearchQuery, 'audiences'> };
    await service.query(smuggled, { audiences: ['members'] });
    expect(sentQuery()).not.toHaveProperty('audiences');
    expect(access.calls[0]!.audiences).toEqual([]);
  });

  it('passes the viewer audiences to a provider that accepts restricted content (empty when none)', async () => {
    const withAudiences = setup({ targets: { active: BUILTIN } });
    withAudiences.builtin.page = { hits: [hit('a')] };
    await withAudiences.service.query(ask('x'), { audiences: ['members'] });
    expect(withAudiences.sentQuery(withAudiences.builtin)?.audiences).toEqual(['members']);
    expect(withAudiences.access.calls[0]!.audiences).toEqual(['members']);

    const anonymous = setup({ targets: { active: BUILTIN } });
    await anonymous.service.query(ask('x'));
    expect(anonymous.sentQuery(anonymous.builtin)?.audiences).toEqual([]);
  });
});

describe('createSearchService — provider outcomes', () => {
  it('answers timeout when the deadline fires first (controllable delay)', async () => {
    let fire!: () => void;
    const delays: number[] = [];
    const { service, vendor } = setup({ optional: { timeoutMs: 250, delay: ms => { delays.push(ms); return new Promise(resolve => { fire = resolve; }); } } });
    vendor.next('query', () => new Promise(() => undefined));
    const pending = service.query(ask('x'));
    await new Promise(resolve => setTimeout(resolve, 0));
    fire();
    expect(await pending).toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(delays).toEqual([250]);
  });

  it('returns the provider answer when it beats the deadline', async () => {
    const { service, vendor } = setup({ optional: { delay: () => new Promise(() => undefined) } });
    vendor.page = { hits: [hit('a')] };
    expect(await service.query(ask('x'))).toEqual({ status: 'ok', providerId: 'vendor', page: { hits: [hit('a')] } });
  });

  it('uses a real setTimeout deadline by default (3000 ms unless configured)', async () => {
    const { service, vendor } = setup({ optional: { timeoutMs: 5 } });
    vendor.next('query', () => new Promise(() => undefined));
    expect(await service.query(ask('x'))).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('maps unknown, throw, invalid_request and other rejections', async () => {
    const { service, vendor } = setup();
    vendor.next('query', async () => providerUnknown({ code: 'network', message: 'down' }));
    vendor.next('query', async () => { throw new Error('boom'); });
    vendor.next('query', async () => providerRejected({ code: 'invalid_request', message: 'bad filter' }));
    vendor.next('query', async () => providerRejected({ code: 'rate_limited', message: 'slow down' }));
    expect(await service.query(ask('x'))).toEqual({ status: 'unavailable', reason: 'provider_unavailable' });
    expect(await service.query(ask('x'))).toEqual({ status: 'unavailable', reason: 'provider_unavailable' });
    expect(await service.query(ask('x'))).toEqual({ status: 'invalid', message: 'bad filter' });
    expect(await service.query(ask('x'))).toEqual({ status: 'unavailable', reason: 'provider_error' });
  });
});

describe('createSearchService — fail-closed revalidation', () => {
  it('drops hits of another site or workspace before the access check', async () => {
    const { service, vendor, access } = setup();
    vendor.page = { hits: [hit('mine'), hit('theirs', { siteId: 'site2' }), hit('ws', { workspaceId: 'ws2' })] };
    const result = await service.query(ask('x'));
    expect(result).toEqual({ status: 'ok', providerId: 'vendor', page: { hits: [hit('mine')] } });
    expect(access.calls[0]!.keys).toEqual([key('mine')]);
  });

  it('keeps only keys the access port confirms, and the next cursor', async () => {
    const access = makeAccess(keys => keys.filter(k => k.documentId !== 'hidden'));
    const { service, vendor } = setup({ access });
    vendor.page = { hits: [hit('shown'), hit('hidden')], nextCursor: 'c2' } satisfies SearchPage;
    expect(await service.query(ask('x'))).toEqual({ status: 'ok', providerId: 'vendor', page: { hits: [hit('shown')], nextCursor: 'c2' } });
  });

  it('fails closed when the access port throws', async () => {
    const access = { calls: [], visibleKeys: async () => { throw new Error('db down'); } };
    const { service, vendor } = setup({ access });
    vendor.page = { hits: [hit('a')] };
    expect(await service.query(ask('x'))).toEqual({ status: 'unavailable', reason: 'access_check_failed' });
  });

  it('skips the access check when no hit is left', async () => {
    const { service, vendor, access } = setup();
    vendor.next('query', async () => providerOk({ value: { hits: [] } }));
    expect(await service.query(ask('x'))).toEqual({ status: 'ok', providerId: 'vendor', page: { hits: [] } });
    expect(access.calls).toEqual([]);
  });
});

describe('createSearchService — status', () => {
  it('reports active and building targets with registration and counts', async () => {
    const { service, state } = setup({ targets: { active: { ...VENDOR, providerId: 'gone' }, building: BUILTIN } });
    await state.put({ row: { target: BUILTIN, key: key('a'), revision: 1, deleted: false, status: 'failed', attempts: 1, updatedAtMs: 0 } });
    expect(await service.status({ siteId: SITE })).toEqual({
      siteId: SITE,
      active: { providerId: 'gone', generation: 1, registered: false, counts: { pending: 0, indexed: 0, unknown: 0, failed: 0 } },
      building: { providerId: 'builtin', generation: 2, registered: true, counts: { pending: 0, indexed: 0, unknown: 0, failed: 1 } },
    });
  });

  it('reports nulls when search was never configured', async () => {
    expect(await setup({ targets: {} }).service.status({ siteId: SITE })).toEqual({ siteId: SITE, active: null, building: null });
  });
});
