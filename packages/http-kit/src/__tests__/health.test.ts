import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  apiHealthRoute,
  apiReadyRoute,
  apiVersionInfoRoute,
  healthRoute,
  readyRoute,
  registerHealthRoutes,
  versionInfoRoute,
  type HealthHttpDeps,
} from '../health.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const adapter = { resolvedPortRef: { current: 7456 } };

function makeDeps(overrides: Partial<HealthHttpDeps> = {}): HealthHttpDeps {
  return {
    getVersion: () => '1.2.3',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('healthRoute / apiHealthRoute', () => {
  it('always reports {ok: true, version} with no readiness check involved', async () => {
    const result = await healthRoute.handle(undefined, makeDeps());
    expect(result).toEqual({ ok: true, value: { ok: true, version: '1.2.3' } });
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const result = await apiHealthRoute.handle(undefined, makeDeps());
    expect(result).toEqual({ ok: true, value: { ok: true, version: '1.2.3' } });
  });

  it('parse ignores the request entirely (void input)', () => {
    expect(healthRoute.parse({ body: { anything: true }, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

describe('readyRoute / apiReadyRoute', () => {
  it('defaults to always-ready with empty checks when checkReadiness is not supplied', async () => {
    const result = await readyRoute.handle(undefined, makeDeps());
    expect(result).toEqual({ ok: true, value: { ok: true, ready: true, version: '1.2.3', checks: {} } });
  });

  it('reports ok:true with the real checks map when checkReadiness resolves ok', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: true, checks: { db: true, sqlite: true } });
    const result = await readyRoute.handle(undefined, makeDeps({ checkReadiness }));
    expect(result).toEqual({ ok: true, value: { ok: true, ready: true, version: '1.2.3', checks: { db: true, sqlite: true } } });
    expect(checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failing readiness check as a SERVICE_UNAVAILABLE error result (mapped to 503 by the Adapter)', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: { db: false } });
    const result = await readyRoute.handle(undefined, makeDeps({ checkReadiness }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(result.error.details).toEqual({ checks: { db: false } });
    }
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: {} });
    const result = await apiReadyRoute.handle(undefined, makeDeps({ checkReadiness }));
    expect(result.ok).toBe(false);
  });

  it('surfaces the not-ready response as a real 503 through the mounted route', async () => {
    const app = makeApp();
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: { db: false } });
    registerHealthRoutes(app as any, makeDeps({ checkReadiness }), adapter);
    const res = makeRes();
    await app.handlers['GET /ready']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'SERVICE_UNAVAILABLE', message: 'service not ready', details: { checks: { db: false } } } });
  });
});

describe('versionInfoRoute / apiVersionInfoRoute', () => {
  it('echoes a synchronous getVersion', async () => {
    const result = await versionInfoRoute.handle(undefined, makeDeps({ getVersion: () => '9.9.9' }));
    expect(result).toEqual({ ok: true, value: { version: '9.9.9' } });
  });

  it('awaits an async getVersion', async () => {
    const result = await versionInfoRoute.handle(undefined, makeDeps({ getVersion: async () => 'async-9' }));
    expect(result).toEqual({ ok: true, value: { version: 'async-9' } });
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const result = await apiVersionInfoRoute.handle(undefined, makeDeps({ getVersion: () => '1.0.0' }));
    expect(result).toEqual({ ok: true, value: { version: '1.0.0' } });
  });
});

describe('registerHealthRoutes', () => {
  it('mounts exactly the six liveness/readiness/version routes, nothing else', () => {
    const app = makeApp();
    registerHealthRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      ['GET /health', 'GET /api/health', 'GET /ready', 'GET /api/ready', 'GET /version', 'GET /api/version'].sort(),
    );
  });

  it('every mounted route responds 200 for a normal request with no same-origin gate applied (reachable even when isLocalSameOrigin would say no)', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerHealthRoutes(app as any, makeDeps(), adapter);
    for (const key of Object.keys(app.handlers)) {
      const res = makeRes();
      // eslint-disable-next-line no-await-in-loop
      await app.handlers[key]!({ body: {}, query: {}, params: {} }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });
});
