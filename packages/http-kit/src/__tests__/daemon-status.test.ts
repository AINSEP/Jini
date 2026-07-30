import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  daemonShutdownRoute,
  daemonStatusRoute,
  registerDaemonStatusRoutes,
  type DaemonStatusDeps,
} from '../daemon-status.js';

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

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
  vi.useRealTimers();
});

describe('daemonStatusRoute', () => {
  it('reports version/host/port/dataDir/shuttingDown/pid on success', async () => {
    const deps = makeDeps();
    const result = await daemonStatusRoute.handle(undefined, deps);
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
    const result = await daemonStatusRoute.handle(undefined, deps);
    expect(result.ok).toBe(true);
    expect((result as any).value.version).toBe('async-version');
  });

  it('reflects isShuttingDown() live rather than caching a stale value across calls', async () => {
    let shuttingDown = false;
    const deps = makeDeps({ isShuttingDown: () => shuttingDown });
    const before = await daemonStatusRoute.handle(undefined, deps);
    expect((before as any).value.shuttingDown).toBe(false);
    shuttingDown = true;
    const after = await daemonStatusRoute.handle(undefined, deps);
    expect((after as any).value.shuttingDown).toBe(true);
  });

  it('calls getPort()/isShuttingDown() fresh on every invocation (not memoized)', async () => {
    const getPort = vi.fn(() => 7456);
    const isShuttingDown = vi.fn(() => false);
    const deps = makeDeps({ getPort, isShuttingDown });
    await daemonStatusRoute.handle(undefined, deps);
    await daemonStatusRoute.handle(undefined, deps);
    expect(getPort).toHaveBeenCalledTimes(2);
    expect(isShuttingDown).toHaveBeenCalledTimes(2);
  });

  it('propagates a synchronous throw from getVersion (surfaced by the Adapter as 500, not swallowed here)', async () => {
    const deps = makeDeps({
      getVersion: () => {
        throw new Error('version read failed');
      },
    });
    await expect(daemonStatusRoute.handle(undefined, deps)).rejects.toThrow('version read failed');
  });

  it('propagates a rejected getVersion promise', async () => {
    const deps = makeDeps({ getVersion: () => Promise.reject(new Error('async version failure')) });
    await expect(daemonStatusRoute.handle(undefined, deps)).rejects.toThrow('async version failure');
  });

  it('mounts on GET /api/daemon/status with no same-origin requirement', async () => {
    const app = makeApp();
    registerDaemonStatusRoutes(app as any, makeDeps(), adapter);
    expect(app.handlers['GET /api/daemon/status']).toBeDefined();
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const res = makeRes();
    await app.handlers['GET /api/daemon/status']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('surfaces an unexpected error through the mounted route as a 500 INTERNAL_ERROR (malformed-response category)', async () => {
    const app = makeApp();
    registerDaemonStatusRoutes(
      app as any,
      makeDeps({
        getVersion: () => {
          throw new Error('boom');
        },
      }),
      adapter,
    );
    const res = makeRes();
    await app.handlers['GET /api/daemon/status']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'boom' } });
  });
});

describe('daemonShutdownRoute', () => {
  it('responds immediately without waiting for requestShutdown to run', async () => {
    const requestShutdown = vi.fn();
    const deps = makeDeps({ requestShutdown });
    const result = await daemonShutdownRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { ok: true, scheduled: true } });
    // requestShutdown is deferred via setImmediate — must not have fired yet.
    expect(requestShutdown).not.toHaveBeenCalled();
  });

  it('invokes requestShutdown asynchronously after the handler returns', async () => {
    const requestShutdown = vi.fn();
    const deps = makeDeps({ requestShutdown });
    await daemonShutdownRoute.handle(undefined, deps);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it('swallows a throwing requestShutdown rather than producing an unhandled rejection (missing-error-handling category)', async () => {
    const requestShutdown = vi.fn(() => {
      throw new Error('listener already removed');
    });
    const deps = makeDeps({ requestShutdown });
    await daemonShutdownRoute.handle(undefined, deps);
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
    await Promise.all([daemonShutdownRoute.handle(undefined, deps), daemonShutdownRoute.handle(undefined, deps)]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).toHaveBeenCalledTimes(2);
  });

  it('requires same-origin when mounted: allows a same-origin request', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(true);
    const app = makeApp();
    const requestShutdown = vi.fn();
    registerDaemonStatusRoutes(app as any, makeDeps({ requestShutdown }), adapter);
    const res = makeRes();
    await app.handlers['POST /api/daemon/shutdown']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, scheduled: true });
  });

  it('requires same-origin when mounted: blocks a cross-origin request with 403 and never calls requestShutdown (stale-state-on-retry category: a rejected attempt must not silently schedule shutdown)', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const requestShutdown = vi.fn();
    registerDaemonStatusRoutes(app as any, makeDeps({ requestShutdown }), adapter);
    const res = makeRes();
    await app.handlers['POST /api/daemon/shutdown']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    await new Promise((resolve) => setImmediate(resolve));
    expect(requestShutdown).not.toHaveBeenCalled();
  });
});

describe('registerDaemonStatusRoutes', () => {
  it('mounts exactly the status and shutdown routes, nothing else', () => {
    const app = makeApp();
    registerDaemonStatusRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      ['GET /api/daemon/status', 'POST /api/daemon/shutdown'].sort(),
    );
  });
});
