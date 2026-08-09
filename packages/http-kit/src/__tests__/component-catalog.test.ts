import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerComponentCatalogRoutes,
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
    search: (_query, _limit) => HITS,
    describe: (id) => (id === ENTRY.id ? ENTRY : null),
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
    const result = await componentCatalogSearchRoute.handle({ query: 'table', limit: 10 }, deps);
    expect(result).toEqual({ ok: true, value: { hits: HITS } });
  });

  it('handle passes query and limit through to the injected search function', async () => {
    let seen: [string, number | undefined] | undefined;
    const deps = makeDeps({ search: (q, l) => { seen = [q, l]; return []; } });
    await componentCatalogSearchRoute.handle({ query: 'comparison of 5 items', limit: 3 }, deps);
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
    const result = await componentCatalogDescribeRoute.handle({ id: 'native.data-table' }, deps);
    expect(result).toEqual({ ok: true, value: ENTRY });
  });

  it('handle reports an unknown id as NOT_FOUND, not a validation failure', async () => {
    const deps = makeDeps();
    const result = await componentCatalogDescribeRoute.handle({ id: 'no.such.component' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'no catalog entry for component id "no.such.component"' },
    });
  });
});

describe('registerComponentCatalogRoutes — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapter = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: ComponentCatalogHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerComponentCatalogRoutes(app as never, deps, adapter as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapter.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapter.resolvedPortRef.current}`;
  }

  it('serves GET /api/components/search over the wire, ranked hits only', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/components/search?q=table`, { headers: { origin: base } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hits: HITS });
  });

  it('serves GET /api/components/:id over the wire, including propsSchema', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/components/native.data-table`, { headers: { origin: base } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ENTRY);
  });

  it('answers 404 over the wire for an unknown component id', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/components/no.such.component`, { headers: { origin: base } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'no catalog entry for component id "no.such.component"' },
    });
  });

  it('still answers 400 over the wire for a malformed search request', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/components/search?q=`, { headers: { origin: base } });
    expect(response.status).toBe(400);
  });

  it('rejects a cross-origin request with 403 before consulting the catalog', async () => {
    let consulted = false;
    const base = await listen(makeDeps({ describe: (id) => { consulted = true; return id === ENTRY.id ? ENTRY : null; } }));
    const response = await fetch(`${base}/api/components/native.data-table`, { headers: { origin: 'http://evil.example.com' } });
    expect(response.status).toBe(403);
    expect(consulted).toBe(false);
  });
});
