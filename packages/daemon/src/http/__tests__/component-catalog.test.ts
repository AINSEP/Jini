import { describe, expect, it } from 'vitest';
import { createInMemoryServer, denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { describeRoutes } from '../route-table.js';
import {
  componentCatalogRoutes,
  componentCatalogDescribeRoute,
  componentCatalogSearchRoute,
  type ComponentCatalogEntry,
  type ComponentCatalogHttpDeps,
  type ComponentCatalogQuery,
  type ComponentCatalogSearchHit,
} from '../component-catalog.js';

const HITS: readonly ComponentCatalogSearchHit[] = [
  { id: 'native.data-table', provider: 'native', capabilities: ['data-table', 'table'], score: 6 },
];

const ENTRY: ComponentCatalogEntry = {
  id: 'native.data-table',
  provider: 'native',
  capabilities: ['data-table', 'table'],
  propsSchema: { type: 'object', properties: { columns: { type: 'array' }, rows: { type: 'array' } } },
  description: 'Plain HTML table.',
};

function makeCatalog(overrides: Partial<ComponentCatalogQuery> = {}): ComponentCatalogQuery {
  return {
    search: ({ query: _query }, { limit: _limit } = {}) => HITS,
    describe: ({ id }) => (id === ENTRY.id ? ENTRY : null),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ComponentCatalogQuery> = {}): ComponentCatalogHttpDeps {
  return { catalog: makeCatalog(overrides) };
}

describe('componentCatalogSearchRoute', () => {
  it('parse rejects a missing q', () => {
    const result = componentCatalogSearchRoute.parse({ body: {}, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('parse rejects an empty/whitespace q', () => {
    expect(componentCatalogSearchRoute.parse({ body: {}, query: { q: '   ' }, params: {} }).ok).toBe(false);
  });

  it('parse defaults limit when omitted', () => {
    const result = componentCatalogSearchRoute.parse({ body: {}, query: { q: 'table' }, params: {} });
    expect(result).toEqual({ ok: true, value: { query: 'table', limit: 10 } });
  });

  it('parse rejects a non-numeric limit', () => {
    expect(componentCatalogSearchRoute.parse({ body: {}, query: { q: 'table', limit: 'abc' }, params: {} }).ok).toBe(false);
  });

  it('parse rejects a limit below 1', () => {
    expect(componentCatalogSearchRoute.parse({ body: {}, query: { q: 'table', limit: '0' }, params: {} }).ok).toBe(false);
  });

  it('parse clamps a limit above the max ceiling', () => {
    const result = componentCatalogSearchRoute.parse({ body: {}, query: { q: 'table', limit: '999' }, params: {} });
    expect(result).toEqual({ ok: true, value: { query: 'table', limit: 25 } });
  });

  it('handle returns the catalog search hits, unmodified', async () => {
    const deps = makeDeps();
    const result = await componentCatalogSearchRoute.handle({ input: { query: 'table', limit: 10 }, deps });
    expect(result).toEqual({ ok: true, value: { hits: HITS } });
  });

  it('handle passes query and limit through to the injected search function', async () => {
    let seen: [string, number | undefined] | undefined;
    const deps = makeDeps({ search: ({ query: q }, { limit: l } = {}) => { seen = [q, l]; return []; } });
    await componentCatalogSearchRoute.handle({ input: { query: 'comparison of 5 items', limit: 3 }, deps });
    expect(seen).toEqual(['comparison of 5 items', 3]);
  });
});

describe('componentCatalogDescribeRoute', () => {
  it('parse rejects a missing id', () => {
    expect(componentCatalogDescribeRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });

  it('parse extracts id from params', () => {
    const result = componentCatalogDescribeRoute.parse({ body: {}, query: {}, params: { id: 'native.data-table' } });
    expect(result).toEqual({ ok: true, value: { id: 'native.data-table' } });
  });

  it('handle returns the full entry, including propsSchema, for a known id', async () => {
    const deps = makeDeps();
    const result = await componentCatalogDescribeRoute.handle({ input: { id: 'native.data-table' }, deps });
    expect(result).toEqual({ ok: true, value: ENTRY });
  });

  it('handle reports an unknown id as NOT_FOUND, not a validation failure', async () => {
    const deps = makeDeps();
    const result = await componentCatalogDescribeRoute.handle({ input: { id: 'no.such.component' }, deps });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'no catalog entry for component id "no.such.component"' },
    });
  });
});

/** The two routes on an in-memory server (exact matching: the Express spellings are the host bridge's job). */
function serve(deps: ComponentCatalogHttpDeps, { denyOrigins = false }: { denyOrigins?: boolean } = {}) {
  const host = fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {});
  const { server, fetch } = createInMemoryServer();
  for (const route of componentCatalogRoutes({ deps, host })) server.route(route);
  return fetch;
}

it('lists the two component routes in order, each behind the same-origin gate', () => {
  expect(describeRoutes({ routes: componentCatalogRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
    { method: 'GET', path: '/api/components/search', gates: ['same-origin'] },
    { method: 'GET', path: '/api/components/:id', gates: ['same-origin'] },
  ]);
});

describe('componentCatalogRoutes — answers a client sees', () => {
  const get = async (deps: ComponentCatalogHttpDeps, path: string, options: { denyOrigins?: boolean } = {}) =>
    serve(deps, options)(new Request(`http://local${path}`));

  it('serves GET /api/components/search, ranked hits only', async () => {
    const response = await get(makeDeps(), '/api/components/search?q=table');
    expect([response.status, await response.json()]).toEqual([200, { hits: HITS }]);
  });

  it('serves GET /api/components/:id, including propsSchema', async () => {
    const response = await get(makeDeps(), '/api/components/native.data-table');
    expect([response.status, await response.json()]).toEqual([200, ENTRY]);
  });

  it('answers 404 for an unknown component id', async () => {
    const response = await get(makeDeps(), '/api/components/no.such.component');
    expect([response.status, await response.json()]).toEqual([404, { error: { code: 'NOT_FOUND', message: 'no catalog entry for component id "no.such.component"' } }]);
  });

  it('still answers 400 for a malformed search request', async () => {
    expect((await get(makeDeps(), '/api/components/search?q=')).status).toBe(400);
  });

  it('rejects a cross-origin request with 403 before consulting the catalog', async () => {
    let consulted = false;
    const response = await get(makeDeps({ describe: ({ id }) => { consulted = true; return id === ENTRY.id ? ENTRY : null; } }), '/api/components/native.data-table', { denyOrigins: true });
    expect([response.status, consulted]).toEqual([403, false]);
  });
});
