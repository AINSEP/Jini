import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerToolCatalogRoutes,
  toolCatalogDescribeRoute,
  toolCatalogSearchRoute,
  type ToolCatalogEntry,
  type ToolCatalogHttpDeps,
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
    search: (_query, _limit) => HITS,
    describe: (id) => (id === ENTRY.id ? ENTRY : null),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ToolCatalogQuery> = {}): ToolCatalogHttpDeps {
  return { catalog: makeCatalog(overrides) };
}

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
    const result = await toolCatalogSearchRoute.handle({ query: 'navigate', limit: 10 }, deps);
    expect(result).toEqual({ ok: true, value: { hits: HITS } });
  });

  it('handle passes query and limit through to the injected search function', async () => {
    let seen: [string, number | undefined] | undefined;
    const deps = makeDeps({ search: (q, l) => { seen = [q, l]; return []; } });
    await toolCatalogSearchRoute.handle({ query: 'fill form', limit: 3 }, deps);
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
    const result = await toolCatalogDescribeRoute.handle({ id: 'page.navigate' }, deps);
    expect(result).toEqual({ ok: true, value: ENTRY });
  });

  // Pins the 2026-07-29 behavior correction: an unknown tool id is NOT_FOUND (404), not the
  // VALIDATION_FAILED (400) this route answered when it reached for `validationError`. The three
  // sibling families with the same case (memory/routines/media) all answer 404, and a caller has to
  // be able to tell "your request was malformed" apart from "that tool does not exist".
  it('handle reports an unknown id as NOT_FOUND, not a validation failure', async () => {
    const deps = makeDeps();
    const result = await toolCatalogDescribeRoute.handle({ id: 'no.such.tool' }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'no catalog entry for tool id "no.such.tool"' },
    });
  });
});

describe('registerToolCatalogRoutes — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapter = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: ToolCatalogHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerToolCatalogRoutes(app as never, deps, adapter as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapter.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapter.resolvedPortRef.current}`;
  }

  it('serves GET /api/tools/search over the wire, ranked hits only', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/tools/search?q=navigate`, { headers: { origin: base } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hits: HITS });
  });

  it('serves GET /api/tools/:id over the wire, including inputSchema', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/tools/page.navigate`, { headers: { origin: base } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ENTRY);
  });

  // The wire-level half of the 400 -> 404 correction above: the status code an HTTP caller
  // (and `@jini-ai/mcp`'s `describe_tool`, which proxies this exact route) actually observes.
  it('answers 404 over the wire for an unknown tool id', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/tools/no.such.tool`, { headers: { origin: base } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'no catalog entry for tool id "no.such.tool"' },
    });
  });

  // A malformed request is still 400 — the correction narrowed the not-found case only.
  it('still answers 400 over the wire for a malformed search request', async () => {
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/tools/search?q=`, { headers: { origin: base } });
    expect(response.status).toBe(400);
  });

  it('rejects a cross-origin request with 403 before consulting the catalog', async () => {
    let consulted = false;
    const base = await listen(makeDeps({ describe: (id) => { consulted = true; return id === ENTRY.id ? ENTRY : null; } }));
    const response = await fetch(`${base}/api/tools/page.navigate`, { headers: { origin: 'http://evil.example.com' } });
    expect(response.status).toBe(403);
    expect(consulted).toBe(false);
  });
});
