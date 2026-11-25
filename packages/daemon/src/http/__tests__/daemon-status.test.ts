import { describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { reportRouteInternalError } from '@jini-ai/http-kit';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import {
  daemonShutdownRoute,
  daemonStatusRoute,
  daemonStatusRoutes,
  type DaemonStatusDeps,
} from '../daemon-status.js';

function makeDeps(overrides: Partial<DaemonStatusDeps> = {}): DaemonStatusDeps {
  return {
    getVersion: () => '1.2.3',
    host: '127.0.0.1',
    getPort: () => 7456,
    dataDir: '/tmp/data',
    isShuttingDown: () => false,
    requestShutdown: vi.fn(),
    ...overrides,
  };
}

/** The daemon-status routes on an in-memory server; `denyOrigins` makes the host refuse every origin. */
function serve({ deps, denyOrigins = false }: { deps: DaemonStatusDeps; denyOrigins?: boolean }) {
  const host = fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {});
  return { fetch: serveRoutes({ routes: daemonStatusRoutes({ deps, host }) }), host };
}

describe('daemonStatusRoute', () => {
  it('reports version/host/port/dataDir/shuttingDown/pid on success', async () => {
    const deps = makeDeps();
    const result = await daemonStatusRoute.handle({ input: undefined, deps });
    expect(result).toEqual({
      ok: true,
      value: {
        ok: true,
        version: '1.2.3',
        host: '127.0.0.1',
        port: 7456,
        dataDir: '/tmp/data',
        shuttingDown: false,
        pid: process.pid,
      },
    });
  });

  it('awaits an async getVersion', async () => {
    const deps = makeDeps({ getVersion: async () => 'async-version' });
    const result = await daemonStatusRoute.handle({ input: undefined, deps });
    expect(result.ok).toBe(true);
    expect((result as any).value.version).toBe('async-version');
  });

  it('reflects isShuttingDown() live rather than caching a stale value across calls', async () => {
    let shuttingDown = false;
    const deps = makeDeps({ isShuttingDown: () => shuttingDown });
    const before = await daemonStatusRoute.handle({ input: undefined, deps });
    expect((before as any).value.shuttingDown).toBe(false);
    shuttingDown = true;
    const after = await daemonStatusRoute.handle({ input: undefined, deps });
    expect((after as any).value.shuttingDown).toBe(true);
  });

  it('calls getPort()/isShuttingDown() fresh on every invocation (not memoized)', async () => {
    const getPort = vi.fn(() => 7456);
    const isShuttingDown = vi.fn(() => false);
    const deps = makeDeps({ getPort, isShuttingDown });
    await daemonStatusRoute.handle({ input: undefined, deps });
    await daemonStatusRoute.handle({ input: undefined, deps });
    expect(getPort).toHaveBeenCalledTimes(2);
    expect(isShuttingDown).toHaveBeenCalledTimes(2);
  });

  it('propagates a synchronous throw from getVersion (surfaced by the Adapter as 500, not swallowed here)', async () => {
    const deps = makeDeps({
      getVersion: () => {
        throw new Error('version read failed');
      },
    });
    await expect(daemonStatusRoute.handle({ input: undefined, deps })).rejects.toThrow('version read failed');
  });

  it('propagates a rejected getVersion promise', async () => {
    const deps = makeDeps({ getVersion: () => Promise.reject(new Error('async version failure')) });
    await expect(daemonStatusRoute.handle({ input: undefined, deps })).rejects.toThrow('async version failure');
  });

  it('mounts on GET /api/daemon/status with no same-origin requirement', async () => {
    const response = await serve({ deps: makeDeps(), denyOrigins: true }).fetch(jsonRequest({ path: '/api/daemon/status' }));
    expect(response.status).toBe(200);
  });

  it('surfaces an unexpected error through the mounted route as a 500 INTERNAL_ERROR (malformed-response category)', async () => {
    const host = { ...fakeDaemonRouteHost(), reportInternalError: reportRouteInternalError };
    const fetch = serveRoutes({ routes: daemonStatusRoutes({ deps: makeDeps({ getVersion: () => { throw new Error('boom'); } }), host }) });
    const response = await fetch(jsonRequest({ path: '/api/daemon/status' }));
    expect(response.status).toBe(500);
    // Redacted, not echoed: the route's catch is a last-resort handler for unanticipated exceptions and must not forward their text to the caller.
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // A failed GET changed nothing, so the fallback copy says so instead of asking whether a change was saved.
    expect(body.error.message).toBe('The server could not finish this request. Nothing was changed. Try again; if it keeps failing, copy the request ID and report this problem.');
  });
});

describe('daemonShutdownRoute', () => {
  it('responds immediately without waiting for requestShutdown to run', async () => {
    const requestShutdown = vi.fn();
    const deps = makeDeps({ requestShutdown });
    const result = await daemonShutdownRoute.handle({ input: undefined, deps });
    expect(result).toEqual({ ok: true, value: { ok: true, scheduled: true } });
    // requestShutdown is deferred via setImmediate — must not have fired yet.
    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('invokes requestShutdown asynchronously after the handler returns', async () => {
    const requestShutdown = vi.fn();
    const deps = makeDeps({ requestShutdown });
    await daemonShutdownRoute.handle({ input: undefined, deps });
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('swallows a throwing requestShutdown rather than producing an unhandled rejection (missing-error-handling category)', async () => {
    const requestShutdown = vi.fn(() => {
      throw new Error('listener already removed');
    });
    const deps = makeDeps({ requestShutdown });
    await daemonShutdownRoute.handle({ input: undefined, deps });
    const unhandled = vi.fn();
    process.once('uncaughtException', unhandled);
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener('uncaughtException', unhandled);
    expect(requestShutdown).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('is idempotent under concurrent duplicate requests: two overlapping calls each schedule their own requestShutdown (race category)', async () => {
    const requestShutdown = vi.fn();
    const deps = makeDeps({ requestShutdown });
    await Promise.all([daemonShutdownRoute.handle({ input: undefined, deps }), daemonShutdownRoute.handle({ input: undefined, deps })]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).toHaveBeenCalledTimes(2);
  });

  it('requires same-origin when mounted: allows a same-origin request', async () => {
    const requestShutdown = vi.fn();
    const response = await serve({ deps: makeDeps({ requestShutdown }) }).fetch(jsonRequest({ path: '/api/daemon/shutdown', method: 'POST' }));
    expect([response.status, await response.json()]).toEqual([200, { ok: true, scheduled: true }]);
  });

  it('requires same-origin when mounted: blocks a cross-origin request with 403 and never calls requestShutdown (stale-state-on-retry category: a rejected attempt must not silently schedule shutdown)', async () => {
    const requestShutdown = vi.fn();
    const response = await serve({ deps: makeDeps({ requestShutdown }), denyOrigins: true }).fetch(jsonRequest({ path: '/api/daemon/shutdown', method: 'POST' }));
    expect(response.status).toBe(403);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).not.toHaveBeenCalled();
  });
});

describe('daemonStatusRoutes', () => {
  it('lists exactly the status and shutdown routes, only the shutdown behind the same-origin gate', () => {
    expect(describeRoutes({ routes: daemonStatusRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'GET', path: '/api/daemon/status', gates: [] },
      { method: 'POST', path: '/api/daemon/shutdown', gates: ['same-origin'] },
    ]);
  });
});
