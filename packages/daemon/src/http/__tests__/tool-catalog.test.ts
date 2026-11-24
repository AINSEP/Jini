import { describe, expect, it, vi } from 'vitest';
import { createInMemoryServer, denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { describeRoutes } from '../route-table.js';
import {
  toolCatalogRoutes,
  toolCatalogDescribeRoute,
  toolCatalogSearchRoute,
  type ToolCatalogEntry,
  type ToolCatalogHttpDeps,
  type UnscopedToolCatalogHttpDeps,
  type ToolCatalogQuery,
  type ToolCatalogSearchHit,
} from '../tool-catalog.js';

const HITS: readonly ToolCatalogSearchHit[] = [
  { id: 'page.navigate', description: 'Navigate to a page.', source: 'first-party', score: 6 },
];

const ENTRY: ToolCatalogEntry = {
  id: 'page.navigate',
  description: 'Navigate to a page.',
  inputSchema: { type: 'object', properties: { pageId: { type: 'string' } } },
  source: 'first-party',
};

function makeCatalog(overrides: Partial<ToolCatalogQuery> = {}): ToolCatalogQuery {
  return {
    search: ({ query: _query }, { limit: _limit } = {}) => HITS,
    describe: ({ id }) => (id === ENTRY.id ? ENTRY : null),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ToolCatalogQuery> = {}): UnscopedToolCatalogHttpDeps {
  return { catalog: makeCatalog(overrides), unscoped: true };
}

/** The two routes on an in-memory server (exact matching: the Express spellings are the host bridge's job). */
function serve(deps: ToolCatalogHttpDeps, { denyOrigins = false }: { denyOrigins?: boolean } = {}) {
  const host = fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {});
  const { server, fetch } = createInMemoryServer();
  for (const route of toolCatalogRoutes({ deps, host })) server.route(route);
  return { fetch, host };
}

it('lists the two catalog routes in order, each behind the same-origin gate, and forwards search options to the port', async () => {
  const search = vi.fn(() => HITS);
  expect(describeRoutes({ routes: toolCatalogRoutes({ deps: makeDeps({ search }), host: fakeDaemonRouteHost() }) })).toEqual([
    { method: 'GET', path: '/api/tools/search', gates: ['same-origin'] },
    { method: 'GET', path: '/api/tools/:id', gates: ['same-origin'] },
  ]);
  const response = await serve(makeDeps({ search })).fetch(new Request('http://local/api/tools/search?q=navigate&limit=3'));
  expect(search).toHaveBeenCalledWith({ query: 'navigate' }, { limit: 3 });
  expect([response.status, await response.json()]).toEqual([200, { hits: HITS }]);
});

describe('toolCatalogSearchRoute', () => {
  it('parse rejects a missing q', () => {
    const result = toolCatalogSearchRoute.parse({ body: {}, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('parse rejects an empty/whitespace q', () => {
    expect(toolCatalogSearchRoute.parse({ body: {}, query: { q: '   ' }, params: {} }).ok).toBe(false);
  });

  it('parse defaults limit when omitted', () => {
    const result = toolCatalogSearchRoute.parse({ body: {}, query: { q: 'navigate' }, params: {} });
    expect(result).toEqual({ ok: true, value: { query: 'navigate', limit: 10 } });
  });

  it('parse rejects a non-numeric limit', () => {
    expect(toolCatalogSearchRoute.parse({ body: {}, query: { q: 'navigate', limit: 'abc' }, params: {} }).ok).toBe(false);
  });

  it('parse rejects a limit below 1', () => {
    expect(toolCatalogSearchRoute.parse({ body: {}, query: { q: 'navigate', limit: '0' }, params: {} }).ok).toBe(false);
  });

  it('parse clamps a limit above the max ceiling', () => {
    const result = toolCatalogSearchRoute.parse({ body: {}, query: { q: 'navigate', limit: '999' }, params: {} });
    expect(result).toEqual({ ok: true, value: { query: 'navigate', limit: 25 } });
  });

  it('handle returns the catalog search hits, unmodified', async () => {
    const deps = makeDeps();
    const result = await toolCatalogSearchRoute.handle({ input: { query: 'navigate', limit: 10 }, deps, context: deps.catalog });
    expect(result).toEqual({ ok: true, value: { hits: HITS } });
  });

  it('handle passes query and limit through to the injected search function', async () => {
    let seen: [string, number | undefined] | undefined;
    const deps = makeDeps({ search: ({ query: q }, { limit: l } = {}) => { seen = [q, l]; return []; } });
    await toolCatalogSearchRoute.handle({ input: { query: 'fill form', limit: 3 }, deps, context: deps.catalog });
    expect(seen).toEqual(['fill form', 3]);
  });
});

describe('toolCatalogDescribeRoute', () => {
  it('parse rejects a missing id', () => {
    expect(toolCatalogDescribeRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });

  it('parse extracts id from params', () => {
    const result = toolCatalogDescribeRoute.parse({ body: {}, query: {}, params: { id: 'page.navigate' } });
    expect(result).toEqual({ ok: true, value: { id: 'page.navigate' } });
  });

  it('handle returns the full entry, including inputSchema, for a known id', async () => {
    const deps = makeDeps();
    const result = await toolCatalogDescribeRoute.handle({ input: { id: 'page.navigate' }, deps, context: deps.catalog });
    expect(result).toEqual({ ok: true, value: ENTRY });
  });

  // Pins the 2026-07-29 behavior correction: an unknown tool id is NOT_FOUND (404), not the
  // VALIDATION_FAILED (400) this route answered when it reached for `validationError`. The three
  // sibling families with the same case (memory/routines/media) all answer 404, and a caller has to
  // be able to tell "your request was malformed" apart from "that tool does not exist".
  it('handle reports an unknown id as NOT_FOUND, not a validation failure', async () => {
    const deps = makeDeps();
    const result = await toolCatalogDescribeRoute.handle({ input: { id: 'no.such.tool' }, deps, context: deps.catalog });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'no catalog entry for tool id "no.such.tool"' },
    });
  });
});

describe('toolCatalogRoutes — answers a client sees', () => {
  const get = async (deps: ToolCatalogHttpDeps, path: string, options: { denyOrigins?: boolean } = {}) =>
    serve(deps, options).fetch(new Request(`http://local${path}`));

  it('serves GET /api/tools/search, ranked hits only', async () => {
    const response = await get(makeDeps(), '/api/tools/search?q=navigate');
    expect([response.status, await response.json()]).toEqual([200, { hits: HITS }]);
  });

  it('serves GET /api/tools/:id, including inputSchema', async () => {
    const response = await get(makeDeps(), '/api/tools/page.navigate');
    expect([response.status, await response.json()]).toEqual([200, ENTRY]);
  });

  // The status code an HTTP caller (and `@jini-ai/mcp`'s `describe_tool`, which proxies this exact route) observes.
  it('answers 404 for an unknown tool id', async () => {
    const response = await get(makeDeps(), '/api/tools/no.such.tool');
    expect([response.status, await response.json()]).toEqual([404, { error: { code: 'NOT_FOUND', message: 'no catalog entry for tool id "no.such.tool"' } }]);
  });

  // A malformed request is still 400 — the correction narrowed the not-found case only.
  it('still answers 400 for a malformed search request', async () => {
    expect((await get(makeDeps(), '/api/tools/search?q=')).status).toBe(400);
  });

  it('rejects a cross-origin request with 403 before consulting the catalog', async () => {
    let consulted = false;
    const response = await get(makeDeps({ describe: ({ id }) => { consulted = true; return id === ENTRY.id ? ENTRY : null; } }), '/api/tools/page.navigate', { denyOrigins: true });
    expect([response.status, consulted]).toEqual([403, false]);
  });
});
