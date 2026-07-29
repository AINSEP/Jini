import { describe, expect, it } from 'vitest';
import {
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

  it('handle fails for an unknown id, without fabricating a not-found entry', async () => {
    const deps = makeDeps();
    const result = await toolCatalogDescribeRoute.handle({ id: 'no.such.tool' }, deps);
    expect(result.ok).toBe(false);
  });
});
