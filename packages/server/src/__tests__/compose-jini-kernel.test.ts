import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import { definePack, type ToolRegistration } from '@jini-ai/core';
import { getRouteRegistrationInventory, installRouteRegistrationGuard, type AdapterContext } from '@jini-ai/http-kit';

import { composeJiniKernel, type JiniKernel } from '../compose-jini-kernel.js';
import { createBuiltInFeatures } from '../builtin-features.js';
import { defineJiniFeature } from '../feature.js';

/**
 * Integration suite for the one composition path. Nothing is mocked: every test builds a real
 * Express app, a real kernel (sqlite or memory), and real feature packs — it simply never opens a
 * listener, which is exactly the property that distinguishes `composeJiniKernel` from
 * `createLocalNodeDaemon`.
 */

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jini-compose-test-'));
  tempDirs.push(dir);
  return dir;
}

const kernels: JiniKernel[] = [];
async function compose(config: Omit<Parameters<typeof composeJiniKernel>[0], 'app' | 'adapter'> & { app?: Express }) {
  const app = config.app ?? express();
  installRouteRegistrationGuard(app);
  const adapter: AdapterContext = { resolvedPortRef: { current: 4000 } };
  const kernel = await composeJiniKernel({ ...config, app, adapter });
  kernels.push(kernel);
  return { app, kernel };
}

afterEach(async () => {
  while (kernels.length > 0) await kernels.pop()!.close();
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
});

function makeTool(id: string): ToolRegistration {
  return { descriptor: { id }, handler: async () => 'ok', policy: { authorize: () => 'allow' } };
}

const paths = (app: Express) => getRouteRegistrationInventory(app).map((r) => `${r.method} ${r.path}`);

describe('the Route-vs-Tool Gap, closed structurally', () => {
  it("a disabled feature's TOOLS are absent from the registry, not merely its routes unmounted", async () => {
    const { app, kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      features: { terminal: false },
    });

    // The route is gone, as a route-level switch would also have achieved…
    expect(paths(app).some((p) => p.includes('/api/terminals'))).toBe(false);
    // …and so is the tool, which a route-level switch would NOT have achieved. Before `Pack.tools`,
    // `jini.terminal.create` was registered in a separate step and stayed reachable through the
    // always-mounted POST /api/delegated-tool-calls.
    expect(kernel.base.registry.has('terminal.create')).toBe(false);
    // The delegated-tool door is still open — that is the point. It just has nothing to open onto.
    expect(paths(app)).toContain('POST /api/delegated-tool-calls');
  });

  it('and with the same feature enabled, BOTH the tool and the routes appear', async () => {
    const { app, kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
    });

    expect(kernel.base.registry.has('terminal.create')).toBe(true);
    expect(paths(app)).toContain('POST /api/terminals');
  });

  it('the same holds for daemonDb: disabling it removes all three daemon.db.* tools', async () => {
    const { app, kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      features: { daemonDb: false },
    });

    for (const id of ['daemon.db.inspect', 'daemon.db.verify', 'daemon.db.vacuum']) {
      expect(kernel.base.registry.has(id)).toBe(false);
    }
    expect(paths(app).some((p) => p.includes('/api/daemon/db'))).toBe(false);
  });

  it('a tool removed by a capability denial is likewise absent — the coarse switch reaches tools too', async () => {
    const { kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      capabilities: { 'host:exec': false },
    });

    expect(kernel.base.registry.has('terminal.create')).toBe(false);
    expect(kernel.activation.active.map((r) => r.id)).not.toContain('terminal');
    expect(kernel.activation.active.map((r) => r.id)).not.toContain('hostTools');
  });
});

describe('shared kernel resources', () => {
  it("health's readiness probe still works with daemonDb disabled — the sqlite connection belongs to the kernel, not to either feature", async () => {
    const { kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      features: { daemonDb: false, toolCatalog: false },
    });

    // The regression this pins: if `daemonDb` had owned the connection, turning it off would leave
    // the readiness probe with nothing to check — and a readiness probe that stops probing still
    // answers 200, which is strictly worse than the coupling it was meant to remove.
    expect(kernel.base.sqlite).not.toBeNull();
    expect(kernel.base.sqlite!.connection.open).toBe(true);
    expect(kernel.activation.active.map((r) => r.id)).toContain('health');
  });

  it('closeBase() closes the shared connection exactly once, and is idempotent', async () => {
    const dataDir = makeTempDataDir();
    const app = express();
    installRouteRegistrationGuard(app);
    const kernel = await composeJiniKernel({
      app,
      adapter: { resolvedPortRef: { current: 4000 } },
      storage: { kind: 'sqlite', dataDir },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
    });

    const connection = kernel.base.sqlite!.connection;
    expect(connection.open).toBe(true);
    await kernel.closeBase();
    await kernel.closeBase();
    expect(connection.open).toBe(false);
  });

  it('memory storage opens no sqlite handle at all', async () => {
    const { kernel } = await compose({ storage: { kind: 'memory' }, profile: 'agent-core-v1' });
    expect(kernel.base.sqlite).toBeNull();
  });

  it('a feature needing a real database file fails loudly under memory storage rather than half-mounting', async () => {
    await expect(
      compose({
        storage: { kind: 'memory' },
        profile: 'agent-core-v1',
        capabilities: { 'db:admin': true },
        features: { daemonDb: true },
      }),
    ).rejects.toThrow(/feature "daemonDb" needs sqlite storage but this composition uses memory storage/);
  });
});

describe('profiles', () => {
  it('local-daemon-v1 composes exactly the historical daemon surface', async () => {
    const { kernel } = await compose({ storage: { kind: 'sqlite', dataDir: makeTempDataDir() }, profile: 'local-daemon-v1', featureOptions: { daemonStatus: { requestShutdown: () => undefined } } });

    expect(kernel.activation.active.map((r) => r.id)).toEqual([
      'health',
      'runs',
      'agents',
      'hostTools',
      'modelProxy',
      'activeContext',
      'terminal',
      'daemonDb',
      'toolCatalog',
      'delegatedToolCalls',
      'connectors',
      'research',
      'xai',
      'daemonStatus',
    ]);
  });

  it('local-daemon-v1 leaves the never-wired families and remote injection off', async () => {
    const { kernel } = await compose({ storage: { kind: 'sqlite', dataDir: makeTempDataDir() }, profile: 'local-daemon-v1', featureOptions: { daemonStatus: { requestShutdown: () => undefined } } });
    const inactive = kernel.activation.inactive.map((r) => r.id);
    expect(inactive).toEqual(expect.arrayContaining(['remoteRunEvents', 'memory', 'routines', 'media', 'frontendSessions']));
  });

  it('agent-core-v1 composes only the run-transport contract', async () => {
    const { app, kernel } = await compose({ storage: { kind: 'memory' }, profile: 'agent-core-v1' });

    expect(kernel.activation.active.map((r) => r.id)).toEqual(['health', 'runs', 'agents', 'delegatedToolCalls']);
    expect(paths(app)).toContain('POST /api/runs');
    expect(paths(app)).toContain('POST /api/delegated-tool-calls');
    expect(paths(app).some((p) => p.includes('/api/terminals'))).toBe(false);
    expect(paths(app).some((p) => p.includes('/api/proxy'))).toBe(false);
    expect(kernel.base.registry.list()).toEqual([]);
  });

  it('defaults to agent-core-v1 when no profile is named', async () => {
    const { kernel } = await compose({ storage: { kind: 'memory' } });
    expect(kernel.activation.active.map((r) => r.id)).toEqual(['health', 'runs', 'agents', 'delegatedToolCalls']);
  });
});

describe('mounting order', () => {
  it('mounts probe routes before the body parser and api routes, and status routes last', async () => {
    const { app } = await compose({ storage: { kind: 'sqlite', dataDir: makeTempDataDir() }, profile: 'local-daemon-v1', featureOptions: { daemonStatus: { requestShutdown: () => undefined } } });
    const mounted = paths(app);

    const health = mounted.indexOf('GET /api/health');
    const runs = mounted.indexOf('POST /api/runs');
    const status = mounted.indexOf('GET /api/daemon/status');

    expect(health).toBeGreaterThanOrEqual(0);
    expect(health).toBeLessThan(runs);
    expect(runs).toBeLessThan(status);
    // The status family mounts more than one route (status + shutdown), so the assertion is that
    // NOTHING outside that family registers after it — not that its first route is literally last.
    expect(mounted.slice(status).every((p) => p.includes('/api/daemon/'))).toBe(true);
  });

  it('runs onAfterApiRoutes between the api and status phases, with the kernel base already built', async () => {
    const order: string[] = [];
    const app = express();
    installRouteRegistrationGuard(app);
    await composeJiniKernel({
      app,
      adapter: { resolvedPortRef: { current: 4000 } },
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      onAfterApiRoutes: (mountedApp, _daemon, base) => {
        // `base` is passed explicitly precisely because the returned kernel does not exist yet.
        order.push(base.sqlite === null ? 'no-sqlite' : 'has-sqlite');
        order.push(paths(mountedApp).includes('POST /api/runs') ? 'after-api' : 'before-api');
        order.push(paths(mountedApp).includes('GET /api/daemon/status') ? 'after-status' : 'before-status');
      },
    }).then((k) => kernels.push(k));

    expect(order).toEqual(['has-sqlite', 'after-api', 'before-status']);
  });
});

describe('tools', () => {
  it('registers feature tools first, then host tools — so a collision names the host id', async () => {
    await expect(
      compose({
        storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
        profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
        toolRegistrations: [makeTool('terminal.create')],
      }),
    ).rejects.toThrow(/"terminal\.create" is already registered/);
  });

  it('seeds the tool catalog from the COMPLETE registry — feature tools and host tools alike', async () => {
    const { kernel } = await compose({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
      toolRegistrations: [makeTool('product.publish')],
    });

    // `afterTools` runs once every source has registered; a catalog seeded during the catalog
    // feature's own `tools` would have missed everything registered after it.
    const rows = kernel.base.sqlite!.connection.prepare('SELECT id FROM tool_catalog').all() as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('terminal.create');
    expect(ids).toContain('daemon.db.vacuum');
    expect(ids).toContain('product.publish');
  });

  it('a caller pack contributes its tools through the same registry (Pack.tools reaches third-party packs)', async () => {
    const productPack = definePack({
      name: 'product',
      deps: [],
      services: () => ({}),
      tools: () => [makeTool('product.fromPack')],
    });

    const { kernel } = await compose({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      packs: [productPack],
    });

    expect(kernel.base.registry.has('product.fromPack')).toBe(true);
  });
});

describe('product features use the same gate', () => {
  const productFeature = defineJiniFeature({
    id: 'product.reports',
    provides: ['net:egress'],
    compose: () => ({
      pack: definePack({
        name: 'product.reports',
        deps: [],
        services: () => ({}),
        tools: () => [makeTool('product.report')],
        http: (app) => (app as Express).get('/api/product/reports', (_req, res) => res.json({ ok: true })),
      }),
    }),
  });

  it('is inert until its capability is granted AND it is named', async () => {
    const { app, kernel } = await compose({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      extraFeatures: [productFeature],
    });

    expect(kernel.base.registry.has('product.report')).toBe(false);
    expect(paths(app)).not.toContain('GET /api/product/reports');
  });

  it('mounts atomically once both are satisfied', async () => {
    const { app, kernel } = await compose({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      extraFeatures: [productFeature],
      capabilities: { 'net:egress': true },
      features: { 'product.reports': true },
    });

    expect(kernel.base.registry.has('product.report')).toBe(true);
    expect(paths(app)).toContain('GET /api/product/reports');
  });

  it('is refused by the same capability rule as a built-in', async () => {
    await expect(
      compose({
        storage: { kind: 'memory' },
        profile: 'agent-core-v1',
        extraFeatures: [productFeature],
        features: { 'product.reports': true },
      }),
    ).rejects.toThrow(/feature "product\.reports" was explicitly enabled but requires denied capability \[net:egress\]/);
  });
});

/**
 * The one block in this file that opens a socket, and only because it has to: `sidecar-strict`'s
 * two gates are request-time middleware, so neither the 401/503 refusals nor the origin guard's
 * resolved-port lookup exists until a real request runs through the assembled app. This mode had no
 * end-to-end coverage at all before 2026-07-29 — the gap the package's own function-coverage gate
 * was already reporting on `main`.
 */
describe('security: sidecar-strict', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()!;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function bootStrict(env: NodeJS.ProcessEnv, exemptPaths?: readonly string[]) {
    const app = express();
    installRouteRegistrationGuard(app);
    const resolvedPortRef = { current: 0 };
    const kernel = await composeJiniKernel({
      app,
      adapter: { resolvedPortRef, env },
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      env,
      security: {
        mode: 'sidecar-strict',
        host: '127.0.0.1',
        tokenEnvVar: 'SIDECAR_TOKEN',
        ...(exemptPaths === undefined ? {} : { exemptPaths }),
      },
    });
    kernels.push(kernel);
    const server = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1');
      s.once('listening', () => resolve(s));
      s.once('error', reject);
    });
    servers.push(server);
    const address = server.address() as { port: number };
    resolvedPortRef.current = address.port;
    return `http://127.0.0.1:${address.port}`;
  }

  it('refuses a loopback caller that presents no token — a co-resident process is the threat model', async () => {
    const url = await bootStrict({ SIDECAR_TOKEN: 'sidecar-secret' });
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextRef: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('admits the same caller once it presents the token, and the origin guard then reads the resolved port', async () => {
    const url = await bootStrict({ SIDECAR_TOKEN: 'sidecar-secret' });
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sidecar-secret',
        origin: url,
      },
      body: JSON.stringify({ contextRef: 'x' }),
    });
    expect(res.status).toBe(201);
  });

  it('still rejects a cross-origin caller holding a valid token — the two gates are independent', async () => {
    const url = await bootStrict({ SIDECAR_TOKEN: 'sidecar-secret' });
    const res = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sidecar-secret',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ contextRef: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('fails closed with 503 when the token env var is unset, rather than serving unauthenticated callers', async () => {
    const url = await bootStrict({});
    const res = await fetch(`${url}/api/runs`, { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('leaves probe-phase routes reachable with no token at all — monitoring never needs a secret', async () => {
    const url = await bootStrict({ SIDECAR_TOKEN: 'sidecar-secret' });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  it('honors an explicit exemptPaths hole in the gate', async () => {
    const url = await bootStrict({ SIDECAR_TOKEN: 'sidecar-secret' }, ['/api/runs/exempt-probe']);
    // Past the bearer gate (not 401), into route dispatch, which has no such route.
    expect((await fetch(`${url}/api/runs/exempt-probe`, { method: 'POST' })).status).toBe(404);
  });
});

describe('teardown', () => {
  it('disposeFeatures runs each active pack\'s dispose, in reverse order, exactly once', async () => {
    const order: string[] = [];
    const makeDisposable = (id: string) =>
      defineJiniFeature({
        id,
        provides: [],
        compose: () => ({
          pack: definePack({
            name: `test.${id}`,
            deps: [],
            services: () => ({}),
            dispose: () => {
              order.push(id);
            },
          }),
        }),
      });

    const { kernel } = await compose({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      extraFeatures: [makeDisposable('first'), makeDisposable('second')],
    });

    await kernel.disposeFeatures();
    await kernel.disposeFeatures();
    expect(order).toEqual(['second', 'first']);
  });

  it("close() disposes the CALLER's packs too — the kernel built their services, so the kernel releases them", async () => {
    const disposedCaller = vi.fn();
    const callerPack = definePack({
      name: 'caller.holdsAHandle',
      deps: [],
      // Stands in for the socket/timer/db handle a real caller pack opens here.
      services: () => ({ handle: { open: true } }),
      dispose: disposedCaller,
    });

    const { kernel } = await compose({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      packs: [callerPack],
    });

    await kernel.close();
    await kernel.close();
    expect(disposedCaller).toHaveBeenCalledTimes(1);
  });

  it("a failed composition disposes the caller's packs, whose services were already built", async () => {
    const disposedCaller = vi.fn();
    const callerPack = definePack({
      name: 'caller.holdsAHandle',
      deps: [],
      services: () => ({ handle: { open: true } }),
      dispose: disposedCaller,
    });
    const exploding = defineJiniFeature({
      id: 'explodes',
      provides: [],
      compose: () => ({
        pack: definePack({
          name: 'test.explodes',
          deps: [],
          services: () => ({}),
          http: () => {
            throw new Error('route mounting blew up');
          },
        }),
      }),
    });

    const app = express();
    installRouteRegistrationGuard(app);
    await expect(
      composeJiniKernel({
        app,
        adapter: { resolvedPortRef: { current: 4000 } },
        storage: { kind: 'memory' },
        profile: 'agent-core-v1',
        packs: [callerPack],
        extraFeatures: [exploding],
      }),
    ).rejects.toThrow('route mounting blew up');

    // `createDaemon` builds every caller pack's services before a single feature composes, so a
    // failure anywhere after that leaves them open unless this path releases them too.
    expect(disposedCaller).toHaveBeenCalledTimes(1);
  });

  it('a failed composition disposes what it built and closes the kernel base — no leaked handle', async () => {
    const dataDir = makeTempDataDir();
    const disposed = vi.fn();
    const exploding = defineJiniFeature({
      id: 'explodes',
      provides: [],
      compose: () => ({
        pack: definePack({
          name: 'test.explodes',
          deps: [],
          services: () => ({}),
          http: () => {
            throw new Error('route mounting blew up');
          },
          dispose: disposed,
        }),
      }),
    });

    const app = express();
    installRouteRegistrationGuard(app);
    await expect(
      composeJiniKernel({
        app,
        adapter: { resolvedPortRef: { current: 4000 } },
        storage: { kind: 'sqlite', dataDir },
        profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
        extraFeatures: [exploding],
      }),
    ).rejects.toThrow('route mounting blew up');

    expect(disposed).toHaveBeenCalledTimes(1);
    // Proven by reopening: a leaked handle would keep the file locked in this process.
    const reopened = new (await import('better-sqlite3')).default(join(dataDir, 'events.db'));
    expect(reopened.open).toBe(true);
    reopened.close();
  });

  it('an invalid selection fails before ANY resource is opened', async () => {
    const openSpy = vi.spyOn(await import('@jini-ai/sqlite'), 'createSqliteEventLog');
    try {
      await expect(
        compose({
          storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
          profile: 'local-daemon-v1',
      featureOptions: { daemonStatus: { requestShutdown: () => undefined } },
          features: { nonexistent: true },
        }),
      ).rejects.toThrow(/unknown feature "nonexistent"/);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });
});

describe('the built-in catalog', () => {
  it('declares every family exactly once, with a capability each', () => {
    const features = createBuiltInFeatures();
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // `health` is the deliberate exception: a liveness probe grants no authority.
    for (const feature of features) {
      if (feature.id === 'health') expect(feature.provides).toEqual([]);
      else expect(feature.provides.length).toBeGreaterThan(0);
    }
  });

  it('pairs every tool-bearing family with the delegated-tool route it is reachable through', () => {
    const features = createBuiltInFeatures();
    expect(features.find((f) => f.id === 'terminal')!.requires).toBeUndefined();
    expect(features.find((f) => f.id === 'delegatedToolCalls')!.requires).toEqual(['runs']);
    expect(features.find((f) => f.id === 'remoteRunEvents')!.requires).toEqual(['runs']);
  });

  it('puts remote run-event injection behind its own capability, granted by no profile', () => {
    expect(createBuiltInFeatures().find((f) => f.id === 'remoteRunEvents')!.provides).toEqual(['run:inject']);
  });
});
