import { expect, it } from 'vitest';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import { createInMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { constrainPrincipalToReadOnlyTools, filterReadOnlyToolCatalog } from '../../core/read-only-tools.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { toolCatalogDescribeRoute, toolCatalogRoutes, toolCatalogSearchRoute, type ToolCatalogHttpDeps, type ToolCatalogQuery, type ToolCatalogSearchHit } from '../tool-catalog.js';

const FULL: Principal = { id: 'principal-full', roles: ['operator'] };
const READ_ONLY = constrainPrincipalToReadOnlyTools({ principal: { id: 'principal-reader', roles: ['viewer'] } });
const HITS: readonly ToolCatalogSearchHit[] = ['pick', 'set'].map(id => ({ id, description: id, source: 'test', score: 1 }));

function setup() {
  const registry = createToolRegistry({});
  for (const [id, readOnly] of [['pick', true], ['set', false]] as const) {
    registry.register({ descriptor: { id, readOnly, inputSchema: { type: 'object' } }, policy: { authorize: () => 'allow' }, handler: async () => ({ ok: true }) });
  }
  const catalog: ToolCatalogQuery = {
    search: (_input, { limit = 10 } = {}) => HITS.slice(0, limit),
    describe: ({ id }) => HITS.find(hit => hit.id === id) ?? null,
  };
  const principals = new Map<string, Principal>([['full', FULL], ['reader', READ_ONLY]]);
  const deps: ToolCatalogHttpDeps = {
    catalogFor: ({ request }) => {
      const principal = principals.get(request.headers.get('x-principal') ?? '');
      if (!principal) throw new Error('unknown principal');
      return filterReadOnlyToolCatalog({ principal, registry, catalog });
    },
  };
  const { server, fetch } = createInMemoryServer();
  for (const route of toolCatalogRoutes({ deps, host: fakeDaemonRouteHost() })) server.route(route);
  const call = async (as: string, path: string) => {
    const response = await fetch(new Request(`http://local${path}`, { headers: { 'x-principal': as } }));
    return [response.status, await response.json()] as const;
  };
  return { call };
}

const ids = (body: unknown) => (body as { hits: { id: string }[] }).hits.map(hit => hit.id);

it('serves each principal its own tool list, whichever principal asked first', async () => {
  for (const order of [['full', 'reader', 'full', 'reader'], ['reader', 'full', 'reader', 'full']]) {
    const { call } = setup();
    for (const as of order) {
      const [status, body] = await call(as, '/api/tools/search?q=probe');
      expect([as, status, ids(body)]).toEqual([as, 200, as === 'full' ? ['pick', 'set'] : ['pick']]);
    }
  }
});

it('never describes a write tool to a read-only principal, even right after a full principal described it', async () => {
  const { call } = setup();
  expect((await call('full', '/api/tools/set'))[0]).toBe(200);
  expect((await call('reader', '/api/tools/set'))[0]).toBe(404);
  expect((await call('reader', '/api/tools/pick'))[0]).toBe(200);
  expect((await call('full', '/api/tools/set'))[0]).toBe(200);
});

it('fails closed when the principal cannot be resolved instead of serving the unfiltered catalog', async () => {
  const { call } = setup();
  const [status, body] = await call('stranger', '/api/tools/search?q=probe');
  expect(status).toBe(500);
  expect(JSON.stringify(body)).not.toContain('"set"');
});

it('fails closed when the host supplies no scoped view and did not declare itself unscoped', async () => {
  const catalog: ToolCatalogQuery = { search: () => HITS, describe: ({ id }) => HITS.find(hit => hit.id === id) ?? null };
  const { server, fetch } = createInMemoryServer();
  // A JS host (or a cast) that passes only the unscoped catalog: no `catalogFor`, no `unscoped: true`.
  for (const route of toolCatalogRoutes({ deps: { catalog } as never, host: fakeDaemonRouteHost() })) server.route(route);
  for (const path of ['/api/tools/search?q=probe', '/api/tools/set']) {
    const response = await fetch(new Request(`http://local${path}`));
    const body = JSON.stringify(await response.json());
    expect([path, response.status, body.includes('"set"')]).toEqual([path, 500, false]);
  }
});

it('serves the unscoped catalog only to a host that declared itself unscoped', async () => {
  const catalog: ToolCatalogQuery = { search: () => HITS, describe: ({ id }) => HITS.find(hit => hit.id === id) ?? null };
  const { server, fetch } = createInMemoryServer();
  for (const route of toolCatalogRoutes({ deps: { catalog, unscoped: true }, host: fakeDaemonRouteHost() })) server.route(route);
  const response = await fetch(new Request('http://local/api/tools/search?q=probe'));
  expect([response.status, ids(await response.json())]).toEqual([200, ['pick', 'set']]);
});

it('fails closed when a handler is reached without the scoped context, even if deps carry an unscoped catalog', async () => {
  const catalog: ToolCatalogQuery = { search: () => HITS, describe: ({ id }) => HITS.find(hit => hit.id === id) ?? null };
  const deps: ToolCatalogHttpDeps = { catalog, unscoped: true };
  const search = await toolCatalogSearchRoute.handle({ input: { query: 'probe', limit: 10 }, deps });
  const describe = await toolCatalogDescribeRoute.handle({ input: { id: 'set' }, deps });
  for (const result of [search, describe]) {
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('"set"');
  }
});
