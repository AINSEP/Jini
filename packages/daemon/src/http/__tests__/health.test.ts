import { describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import {
  apiHealthRoute,
  apiReadyRoute,
  apiVersionInfoRoute,
  healthRoute,
  readyRoute,
  healthRoutes,
  versionInfoRoute,
  type HealthHttpDeps,
} from '../health.js';

function makeDeps(overrides: Partial<HealthHttpDeps> = {}): HealthHttpDeps {
  return {
    getVersion: () => '1.2.3',
    ...overrides,
  };
}

describe('healthRoute / apiHealthRoute', () => {
  it('always reports {ok: true, version} with no readiness check involved', async () => {
    const result = await healthRoute.handle({ input: undefined, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { ok: true, version: '1.2.3' } });
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const result = await apiHealthRoute.handle({ input: undefined, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { ok: true, version: '1.2.3' } });
  });

  it('parse ignores the request entirely (void input)', () => {
    expect(healthRoute.parse({ body: { anything: true }, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

describe('readyRoute / apiReadyRoute', () => {
  it('defaults to always-ready with empty checks when checkReadiness is not supplied', async () => {
    const result = await readyRoute.handle({ input: undefined, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { ok: true, ready: true, version: '1.2.3', checks: {} } });
  });

  it('reports ok:true with the real checks map when checkReadiness resolves ok', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: true, checks: { db: true, sqlite: true } });
    const result = await readyRoute.handle({ input: undefined, deps: makeDeps({ checkReadiness }) });
    expect(result).toEqual({ ok: true, value: { ok: true, ready: true, version: '1.2.3', checks: { db: true, sqlite: true } } });
    expect(checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failing readiness check as a SERVICE_UNAVAILABLE error result (mapped to 503 by the Adapter)', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: { db: false } });
    const result = await readyRoute.handle({ input: undefined, deps: makeDeps({ checkReadiness }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(result.error.details).toEqual({ checks: { db: false } });
    }
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: {} });
    const result = await apiReadyRoute.handle({ input: undefined, deps: makeDeps({ checkReadiness }) });
    expect(result.ok).toBe(false);
  });

  it('surfaces the not-ready response as a real 503 through the mounted route', async () => {
    const checkReadiness = vi.fn().mockResolvedValue({ ok: false, checks: { db: false } });
    const response = await serveRoutes({ routes: healthRoutes({ deps: makeDeps({ checkReadiness }), host: fakeDaemonRouteHost() }) })(jsonRequest({ path: '/ready' }));
    expect([response.status, await response.json()]).toEqual([503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'service not ready', details: { checks: { db: false } } } }]);
  });
});

describe('versionInfoRoute / apiVersionInfoRoute', () => {
  it('echoes a synchronous getVersion', async () => {
    const result = await versionInfoRoute.handle({ input: undefined, deps: makeDeps({ getVersion: () => '9.9.9' }) });
    expect(result).toEqual({ ok: true, value: { version: '9.9.9' } });
  });

  it('awaits an async getVersion', async () => {
    const result = await versionInfoRoute.handle({ input: undefined, deps: makeDeps({ getVersion: async () => 'async-9' }) });
    expect(result).toEqual({ ok: true, value: { version: 'async-9' } });
  });

  it('the /api-prefixed variant behaves identically', async () => {
    const result = await apiVersionInfoRoute.handle({ input: undefined, deps: makeDeps({ getVersion: () => '1.0.0' }) });
    expect(result).toEqual({ ok: true, value: { version: '1.0.0' } });
  });
});

describe('healthRoutes', () => {
  const PATHS = ['/health', '/api/health', '/ready', '/api/ready', '/version', '/api/version'];

  it('lists exactly the six liveness/readiness/version routes, none behind a gate', () => {
    expect(describeRoutes({ routes: healthRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual(PATHS.map((path) => ({ method: 'GET', path, gates: [] })));
  });

  it('every route responds 200 for a normal request with no same-origin gate applied (reachable even when the same-origin guard would say no)', async () => {
    const fetch = serveRoutes({ routes: healthRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost({}, { originPolicy: denyAllOrigins }) }) });
    const statuses = await Promise.all(PATHS.map(async (path) => (await fetch(jsonRequest({ path }))).status));
    expect(statuses).toEqual(PATHS.map(() => 200));
  });
});
