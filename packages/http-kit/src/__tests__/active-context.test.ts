import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  ACTIVE_CONTEXT_TTL_MS,
  getActiveRoute,
  registerActiveContextRoutes,
  setActiveRoute,
  type ActiveContextDeps,
} from '../active-context.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), handlers };
}

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

const adapter = { resolvedPortRef: { current: 7456 } };

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

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
    const result = await setActiveRoute.handle({ kind: 'clear' }, deps as any);
    expect(result).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('records a new active resource with the injected now()', async () => {
    const deps = makeDeps({ now: () => 5000 });
    const result = await setActiveRoute.handle({ kind: 'set', resourceRef: 'proj-1', detail: 'file.ts' }, deps as any);
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
    const result = await getActiveRoute.handle(undefined, deps as any);
    expect(result).toEqual({ ok: true, value: { active: false } });
  });

  it('reports inactive and clears the store once the TTL has strictly elapsed', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 0 } },
      now: () => ACTIVE_CONTEXT_TTL_MS + 1,
    });
    const result = await getActiveRoute.handle(undefined, deps as any);
    expect(result).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('is still active exactly at the TTL boundary (age === TTL is not > TTL)', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 0 } },
      now: () => ACTIVE_CONTEXT_TTL_MS,
      resolveResource: () => ({ name: 'Proj One' }),
    });
    const result = await getActiveRoute.handle(undefined, deps as any);
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
    const result = await getActiveRoute.handle(undefined, deps as any);
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
    expect(resolveResource).toHaveBeenCalledWith('proj-1');
  });

  it('falls back to a null resourceName when resolveResource returns undefined', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => undefined,
    });
    const result = await getActiveRoute.handle(undefined, deps as any);
    expect((result as any).value.resourceName).toBeNull();
  });

  it('falls back to a null resourceName when resolveResource returns null', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => null,
    });
    const result = await getActiveRoute.handle(undefined, deps as any);
    expect((result as any).value.resourceName).toBeNull();
  });

  it('falls back to a null resourceName when the resolved resource has no name field', async () => {
    const deps = makeDeps({
      store: { current: { resourceRef: 'proj-1', detail: null, ts: 100 } },
      now: () => 100,
      resolveResource: () => ({}),
    });
    const result = await getActiveRoute.handle(undefined, deps as any);
    expect((result as any).value.resourceName).toBeNull();
  });
});

describe('registerActiveContextRoutes', () => {
  function makeDeps(overrides: Partial<ActiveContextDeps> = {}): ActiveContextDeps {
    return { resolveResource: () => ({ name: 'Resolved' }), ...overrides };
  }

  it('mounts exactly POST and GET /api/active', () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(['GET /api/active', 'POST /api/active'].sort());
  });

  it('shares one in-memory store across both mounted routes: a POST is visible to a later GET', async () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps({ resolveResource: () => ({ name: 'Widget' }) }), adapter);

    const postRes = makeRes();
    await app.handlers['POST /api/active']!(
      { body: { resourceRef: 'w-1', detail: 'notes.md' }, query: {}, params: {} },
      postRes,
    );
    expect(postRes.status).toHaveBeenCalledWith(200);

    const getRes = makeRes();
    await app.handlers['GET /api/active']!({ body: {}, query: {}, params: {} }, getRes);
    expect(getRes.status).toHaveBeenCalledWith(200);
    expect(getRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, resourceRef: 'w-1', resourceName: 'Widget', detail: 'notes.md' }),
    );
  });

  it('a POST clear is visible to a later GET as inactive', async () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);

    await app.handlers['POST /api/active']!({ body: { resourceRef: 'w-1' }, query: {}, params: {} }, makeRes());
    await app.handlers['POST /api/active']!({ body: { active: false }, query: {}, params: {} }, makeRes());

    const getRes = makeRes();
    await app.handlers['GET /api/active']!({ body: {}, query: {}, params: {} }, getRes);
    expect(getRes.json).toHaveBeenCalledWith({ active: false });
  });

  it('defaults now to Date.now when the caller does not supply one', async () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);
    const before = Date.now();

    const postRes = makeRes();
    await app.handlers['POST /api/active']!({ body: { resourceRef: 'w-1' }, query: {}, params: {} }, postRes);
    const posted = postRes.json.mock.calls[0]![0];
    expect(posted.ts).toBeGreaterThanOrEqual(before);
    expect(posted.ts).toBeLessThanOrEqual(Date.now());
  });

  it('uses a caller-supplied now() instead of Date.now when provided', async () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps({ now: () => 42 }), adapter);

    const postRes = makeRes();
    await app.handlers['POST /api/active']!({ body: { resourceRef: 'w-1' }, query: {}, params: {} }, postRes);
    expect(postRes.json).toHaveBeenCalledWith(expect.objectContaining({ ts: 42 }));
  });

  it('requires same-origin: blocks a cross-origin GET with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['GET /api/active']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin: blocks a cross-origin POST with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/active']!({ body: { resourceRef: 'w-1' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('surfaces a BAD_REQUEST parse failure through the mounted POST route as 400', async () => {
    const app = makeApp();
    registerActiveContextRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/active']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
