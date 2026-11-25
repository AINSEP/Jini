import { describe, expect, it } from 'vitest';
import { isRouteReply } from '@jini-ai/core/contracts/server';
import type { SearchServiceResult } from '@jini-ai/core/contracts/site/search';
import { siteSearchRoute, type SiteSearchRouteDeps } from '../search.js';

const limits = { maxTextLength: 256, maxCollections: 10, maxLimit: 50, maxCursorLength: 1024 };
const okResult: SearchServiceResult = { status: 'ok', providerId: 'p', page: { hits: [
  { key: { collection: 'post', id: '1' }, url: '/a', title: 'A', snippet: 's', highlights: [] },
] } } as unknown as SearchServiceResult;

function harness(result: SearchServiceResult | Error, options: { runtime?: boolean; token?: string | undefined } = {}) {
  const { runtime = true } = options;
  const token = 'token' in options ? options.token : 'tok';
  const log: unknown[] = [];
  let now = 1000;
  const deps: SiteSearchRouteDeps = {
    limits,
    clock: { nowMs: () => (now += 150) },
    sessionToken: () => { log.push('token'); return token; },
    recordSearchPerformed: ({ properties }) => { log.push({ event: properties }); },
    ...(runtime ? { siteSearch: {
      siteId: 'site', workspaceId: 'ws', // A thenable, so 'ready' is logged when the route awaits it, not when the harness is built.
      ready: { then: (resolve: () => void) => { log.push('ready'); resolve(); } } as unknown as Promise<void>,
      audiencesForSession: async (args: { sessionToken?: string }) => { log.push({ audiences: args }); return ['members']; },
      service: { query: async (required: unknown, optional: unknown) => { log.push({ query: required, optional }); if (result instanceof Error) throw result; return result; } },
    } } : {}),
  };
  return { deps, log };
}

async function call(query: Record<string, unknown>, deps: SiteSearchRouteDeps) {
  const parsed = siteSearchRoute.parse({ body: undefined, query, params: {} });
  if (!parsed.ok) throw new Error('parse never refuses');
  const result = await siteSearchRoute.handle({ input: parsed.value, deps, context: undefined });
  if (!result.ok) throw new Error('handle never returns a failure');
  const value = result.value;
  return isRouteReply(value) ? { status: value.status, body: value.body } : { status: 200, body: value };
}

describe('siteSearchRoute', () => {
  it('declares GET /api/search, never cached', () => {
    expect([siteSearchRoute.method, siteSearchRoute.path, siteSearchRoute.responseHeaders]).toEqual(['get', '/api/search', { 'Cache-Control': 'private, no-store' }]);
  });

  it('refuses a bad query with 400 invalid_request before touching the runtime', async () => {
    const { deps, log } = harness(okResult);
    expect(await call({}, deps)).toEqual({ status: 400, body: { error: 'invalid_request', message: "'q' is required" } });
    expect((await call({ q: 'a'.repeat(257) }, deps)).body).toEqual({ error: 'invalid_request', message: "'q' must be at most 256 characters" });
    expect((await call({ q: 'a', limit: '51' }, deps)).body).toEqual({ error: 'invalid_request', message: "'limit' must be an integer from 1 to 50" });
    expect(log).toEqual([]);
  });

  it('answers 503 not_configured without a runtime', async () => {
    const { deps } = harness(okResult, { runtime: false });
    expect(await call({ q: 'a' }, deps)).toEqual({ status: 503, body: { error: 'search_unavailable', reason: 'not_configured' } });
  });

  it('queries with the session audiences after ready, records the bucketed event, and maps the hits', async () => {
    const { deps, log } = harness(okResult);
    expect(await call({ q: 'hello' }, deps)).toEqual({ status: 200, body: { hits: [{ url: '/a', title: 'A', snippet: 's', highlights: [], collection: 'post' }], nextCursor: null } });
    expect(log).toEqual([
      'ready', 'token', { audiences: { sessionToken: 'tok' } },
      { query: { siteId: 'site', workspaceId: 'ws', query: expect.objectContaining({ text: 'hello' }) }, optional: { audiences: ['members'] } },
      { event: { resultCountBucket: '1-10', durationBucket: '100ms-1s' } },
    ]);
  });

  it('asks without a token when the visitor has no session, and keeps the next cursor', async () => {
    const { deps, log } = harness({ ...okResult, page: { hits: [], nextCursor: 'c2' } } as SearchServiceResult, { token: undefined });
    expect((await call({ q: 'x' }, deps)).body).toEqual({ hits: [], nextCursor: 'c2' });
    expect(log).toContainEqual({ audiences: {} });
    expect(log).toContainEqual({ event: { resultCountBucket: '0', durationBucket: '100ms-1s' } });
  });

  it('maps invalid and unavailable service results without recording an event', async () => {
    const invalid = harness({ status: 'invalid', message: 'bad cursor' });
    expect(await call({ q: 'x' }, invalid.deps)).toEqual({ status: 400, body: { error: 'invalid_request', message: 'bad cursor' } });
    const down = harness({ status: 'unavailable', reason: 'timeout' } as SearchServiceResult);
    expect(await call({ q: 'x' }, down.deps)).toEqual({ status: 503, body: { error: 'search_unavailable', reason: 'timeout' } });
    expect([...invalid.log, ...down.log].filter((entry) => typeof entry === 'object' && entry !== null && 'event' in entry)).toEqual([]);
  });

  it('lets a runtime failure reach the host error port', async () => {
    const { deps } = harness(new Error('provider exploded'));
    await expect(call({ q: 'x' }, deps)).rejects.toThrow('provider exploded');
  });
});
