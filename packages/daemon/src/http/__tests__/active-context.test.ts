import { describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import {
  ACTIVE_CONTEXT_TTL_MS,
  getActiveRoute,
  activeContextRoutes,
  setActiveRoute,
  type ActiveContextDeps,
} from '../active-context.js';

/** The active-context routes on an in-memory server; `denyOrigins` makes the host refuse every origin. */
function serve({ deps, denyOrigins = false }: { deps: ActiveContextDeps; denyOrigins?: boolean }) {
  const host = fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {});
  return serveRoutes({ routes: activeContextRoutes({ deps, host }) });
}

describe('setActiveRoute.parse', () => {
  it('parses {active: false} as a clear', () => {
    expect(setActiveRoute.parse({ body: { active: false }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { kind: 'clear' },
    });
  });

  it('parses a resourceRef with no detail as a set with detail: null', () => {
    expect(setActiveRoute.parse({ body: { resourceRef: 'proj-1' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { kind: 'set', resourceRef: 'proj-1', detail: null },
    });
  });

  it('parses a resourceRef with a non-empty string detail', () => {
    expect(
      setActiveRoute.parse({ body: { resourceRef: 'proj-1', detail: 'src/index.ts' }, query: {}, params: {} }),
    ).toEqual({ ok: true, value: { kind: 'set', resourceRef: 'proj-1', detail: 'src/index.ts' } });
  });

  it('treats an empty-string detail as null', () => {
    expect(
      setActiveRoute.parse({ body: { resourceRef: 'proj-1', detail: '' }, query: {}, params: {} }),
    ).toEqual({ ok: true, value: { kind: 'set', resourceRef: 'proj-1', detail: null } });
  });

  it('treats a non-string detail as null', () => {
    expect(
      setActiveRoute.parse({ body: { resourceRef: 'proj-1', detail: 42 }, query: {}, params: {} }),
    ).toEqual({ ok: true, value: { kind: 'set', resourceRef: 'proj-1', detail: null } });
  });

  it('rejects a missing resourceRef with BAD_REQUEST', () => {
    const result = setActiveRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'resourceRef is required' } });
  });

  it('rejects a non-string resourceRef with BAD_REQUEST', () => {
    const result = setActiveRoute.parse({ body: { resourceRef: 42 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty-string resourceRef with BAD_REQUEST', () => {
    const result = setActiveRoute.parse({ body: { resourceRef: '' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('treats a null body as an empty object rather than throwing', () => {
    const result = setActiveRoute.parse({ body: null, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });
});

describe('setActiveRoute.handle', () => {
  function makeDeps(overrides: Partial<{ store: { current: any }; now: () => number; resolveResource: any }> = {}) {
    return {
      store: { current: null },
      now: () => 1000,
      resolveResource: () => null,
      ...overrides,
    };
  }

  it('clears the store and reports inactive on a clear input', async () => {
    const deps = makeDeps({ store: { current: { resourceRef: 'x', detail: null, ts: 1 } } });
    const result = await setActiveRoute.handle({ input: { kind: 'clear' }, deps: deps as any });
    expect(result).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('records a new active resource with the injected now()', async () => {
    const deps = makeDeps({ now: () => 5000 });
    const result = await setActiveRoute.handle({ input: { kind: 'set', resourceRef: 'proj-1', detail: 'file.ts' }, deps: deps as any });
    expect(result).toEqual({
      ok: true,
      value: { active: true, resourceRef: 'proj-1', detail: 'file.ts', ts: 5000 },
    });
    expect(deps.store.current).toEqual({ resourceRef: 'proj-1', detail: 'file.ts', ts: 5000 });
  });
});

describe('getActiveRoute.parse', () => {
  it('requires no input', () => {
    expect(getActiveRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

describe('getActiveRoute.handle', () => {
  function makeDeps(overrides: Partial<{ store: { current: any }; now: () => number; resolveResource: any }> = {}) {
    return {
      store: { current: null },
      now: () => 1000,
      resolveResource: () => null,
      ...overrides,
    };
  }

  it('reports inactive when nothing has ever been set', async () => {
    const deps = makeDeps();
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect(result).toEqual({ ok: true, value: { active: false } });
  });

  it('reports inactive and clears the store once the TTL has strictly elapsed', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 0 } },
      now: () => ACTIVE_CONTEXT_TTL_MS + 1,
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect(result).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('is still active exactly at the TTL boundary (age === TTL is not > TTL)', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 0 } },
      now: () => ACTIVE_CONTEXT_TTL_MS,
      resolveResource: () => ({ name: 'Proj One' }),
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect(result.ok).toBe(true);
    expect((result as any).value.active).toBe(true);
  });

  it('resolves a display name via resolveResource when the resource is known', async () => {
    const resolveResource = vi.fn(() => ({ name: 'Proj One' }));
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: 'file.ts', ts: 100 } },
      now: () => 150,
      resolveResource,
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect(result).toEqual({
      ok: true,
      value: {
        active: true,
        resourceRef: 'proj-1',
        resourceName: 'Proj One',
        detail: 'file.ts',
        ts: 100,
        ageMs: 50,
      },
    });
    expect(resolveResource).toHaveBeenCalledWith({ resourceRef: 'proj-1' });
  });

  it('falls back to a null resourceName when resolveResource returns undefined', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => undefined,
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect((result as any).value.resourceName).toBeNull();
  });

  it('falls back to a null resourceName when resolveResource returns null', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => null,
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect((result as any).value.resourceName).toBeNull();
  });

  it('falls back to a null resourceName when the resolved resource has no name field', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => ({}),
    });
    const result = await getActiveRoute.handle({ input: undefined, deps: deps as any });
    expect((result as any).value.resourceName).toBeNull();
  });
});

describe('activeContextRoutes', () => {
  function makeDeps(overrides: Partial<ActiveContextDeps> = {}): ActiveContextDeps {
    return { resolveResource: () => ({ name: 'Resolved' }), ...overrides };
  }
  const post = (body: unknown) => jsonRequest({ path: '/api/active', method: 'POST' }, { body });
  const get = () => jsonRequest({ path: '/api/active' });

  it('lists exactly POST and GET /api/active, each behind the same-origin gate', () => {
    expect(describeRoutes({ routes: activeContextRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'POST', path: '/api/active', gates: ['same-origin'] },
      { method: 'GET', path: '/api/active', gates: ['same-origin'] },
    ]);
  });

  it('shares one in-memory store across both routes: a POST is visible to a later GET, through real body parsing and JSON serialization', async () => {
    const fetch = serve({ deps: makeDeps({ resolveResource: () => ({ name: 'Widget' }) }) });
    const posted = await fetch(post({ resourceRef: 'w-1', detail: 'notes.md' }));
    expect([posted.status, posted.headers.get('content-type')]).toEqual([200, expect.stringContaining('application/json')]);
    expect(await posted.json()).toMatchObject({ active: true, resourceRef: 'w-1', detail: 'notes.md' });
    const read = await fetch(get());
    expect([read.status, await read.json()]).toEqual([200, expect.objectContaining({ active: true, resourceRef: 'w-1', resourceName: 'Widget', detail: 'notes.md' })]);
  });

  it('a POST clear is visible to a later GET as inactive', async () => {
    const fetch = serve({ deps: makeDeps() });
    await fetch(post({ resourceRef: 'w-1' }));
    await fetch(post({ active: false }));
    expect(await (await fetch(get())).json()).toEqual({ active: false });
  });

  it('defaults now to Date.now when the caller does not supply one', async () => {
    const before = Date.now();
    const posted = await (await serve({ deps: makeDeps() })(post({ resourceRef: 'w-1' }))).json() as { ts: number };
    expect(posted.ts).toBeGreaterThanOrEqual(before);
    expect(posted.ts).toBeLessThanOrEqual(Date.now());
  });

  it('uses a caller-supplied now() instead of Date.now when provided', async () => {
    const posted = await serve({ deps: makeDeps({ now: () => 42 }) })(post({ resourceRef: 'w-1' }));
    expect(await posted.json()).toEqual(expect.objectContaining({ ts: 42 }));
  });

  it('requires same-origin: blocks a cross-origin GET with 403', async () => {
    expect((await serve({ deps: makeDeps(), denyOrigins: true })(get())).status).toBe(403);
  });

  it('requires same-origin: blocks a cross-origin POST with 403', async () => {
    expect((await serve({ deps: makeDeps(), denyOrigins: true })(post({ resourceRef: 'w-1' }))).status).toBe(403);
  });

  it('answers a BAD_REQUEST parse failure (missing resourceRef) on POST as 400', async () => {
    expect((await serve({ deps: makeDeps() })(post({}))).status).toBe(400);
  });
});
