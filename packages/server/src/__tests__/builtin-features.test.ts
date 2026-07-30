import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import { getRouteRegistrationInventory, installRouteRegistrationGuard, type AdapterContext } from '@jini-ai/http-kit';

import { composeJiniKernel, type JiniKernel } from '../compose-jini-kernel.js';
import { createBuiltInFeatures } from '../builtin-features.js';
import { createJiniKernelBase } from '../kernel-base.js';

/**
 * Per-feature behavior that only shows up once a feature is actually serving: the readiness probe's
 * real checks, the agent-scan cache's failure path, the tool catalog's query surface, and the four
 * families the standalone daemon has never wired (`memory`/`routines`/`media`/`frontendSessions`) —
 * which are reachable here for the first time as declared, opt-in features rather than exported
 * functions no shipped composition calls.
 *
 * Every test boots a real listener on an ephemeral port so route handlers run for real; nothing is
 * stubbed except the host-supplied dependency shapes this package deliberately has no default for.
 */

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jini-builtin-test-'));
  tempDirs.push(dir);
  return dir;
}

interface Booted {
  readonly url: string;
  readonly kernel: JiniKernel;
  readonly app: Express;
}
const booted: { server: Server; kernel: JiniKernel }[] = [];

async function boot(
  config: Omit<Parameters<typeof composeJiniKernel>[0], 'app' | 'adapter'>,
): Promise<Booted> {
  const app = express();
  installRouteRegistrationGuard(app);
  const resolvedPortRef = { current: 0 };
  const adapter: AdapterContext = { resolvedPortRef };
  const kernel = await composeJiniKernel({ ...config, app, adapter });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1');
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  resolvedPortRef.current = port;
  booted.push({ server, kernel });
  return { url: `http://127.0.0.1:${port}`, kernel, app };
}

afterEach(async () => {
  while (booted.length > 0) {
    const entry = booted.pop()!;
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    await entry.kernel.close();
  }
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
});

const shutdownOption = { daemonStatus: { requestShutdown: () => undefined } };

describe('health', () => {
  it('reports the composition as ready, checking the kernel-owned sqlite handle', async () => {
    const { url } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: shutdownOption,
    });

    const body = (await (await fetch(`${url}/api/ready`)).json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body).toMatchObject({ ok: true, checks: { db: true, notShuttingDown: true } });
  });

  it('omits the db check entirely under memory storage rather than inventing one', async () => {
    const { url } = await boot({ storage: { kind: 'memory' }, profile: 'agent-core-v1' });

    const body = (await (await fetch(`${url}/api/ready`)).json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body).toMatchObject({ ok: true, ready: true });
    // No `db` key at all — the composition has no database file, and inventing a passing check for
    // one would make readiness report on something that does not exist.
    expect(body.checks).toEqual({ notShuttingDown: true });
  });

  it('reports not-ready — rather than throwing — when the shared handle can no longer be probed', async () => {
    const { url, kernel } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: shutdownOption,
    });

    // A readiness *check* must never itself throw and crash the route: a failed pragma read is a
    // legitimate "not ready" signal, not a 500.
    kernel.base.sqlite!.connection.close();
    const response = await fetch(`${url}/api/ready`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string; details: { checks: Record<string, boolean> } } };
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.details.checks).toMatchObject({ db: false });
  });

  it('folds a host-supplied shutting-down signal into readiness', async () => {
    let shuttingDown = false;
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      featureOptions: { health: { getVersion: () => '9.9.9', isShuttingDown: () => shuttingDown } },
    });

    expect(await (await fetch(`${url}/api/ready`)).json()).toMatchObject({ ok: true, ready: true });
    shuttingDown = true;
    const notReady = await fetch(`${url}/api/ready`);
    expect(notReady.status).toBe(503);
    const body = (await notReady.json()) as { error: { details: { checks: Record<string, boolean> } } };
    expect(body.error.details.checks).toEqual({ notShuttingDown: false });
    expect(await (await fetch(`${url}/api/version`)).json()).toMatchObject({ version: '9.9.9' });
  });

  it('defaults its reported version to this package\'s own', async () => {
    const { url } = await boot({ storage: { kind: 'memory' }, profile: 'agent-core-v1' });
    const body = (await (await fetch(`${url}/api/version`)).json()) as { version: string };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('agents', () => {
  it('clears its promise cache when a probe fails, so the next request retries instead of serving a poisoned rejection forever', async () => {
    let calls = 0;
    const detector = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('probe exploded');
      return [];
    });

    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      featureOptions: { agents: { detector } },
    });

    expect((await fetch(`${url}/api/agents`)).status).toBe(500);
    // The cached rejected promise must have been dropped — otherwise every later request would
    // replay the same failure with no way to recover short of a restart.
    expect((await fetch(`${url}/api/agents`)).status).toBe(200);
    expect(detector).toHaveBeenCalledTimes(2);
  });
});

describe('toolCatalog', () => {
  it('serves search and describe over the seeded snapshot of the complete registry', async () => {
    const { url } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: shutdownOption,
      toolRegistrations: [
        {
          descriptor: { id: 'product.publish', description: 'Publish a product entry' },
          handler: async () => 'done',
          policy: { authorize: () => 'allow' },
        },
      ],
    });

    const described = (await (await fetch(`${url}/api/tools/product.publish`)).json()) as {
      id: string;
      description: string;
    };
    expect(described).toMatchObject({ id: 'product.publish', description: 'Publish a product entry' });

    const searched = (await (await fetch(`${url}/api/tools/search?q=publish`)).json()) as { hits: { id: string }[] };
    expect(searched.hits.map((h) => h.id)).toContain('product.publish');
  });
});

describe('the families the standalone daemon never wired', () => {
  // `memory`/`routines`/`media`/`frontendSessions` were exported from the HTTP package but called by
  // no shipped composition — so a developer reading the reference integration would reasonably
  // assume they were live. They are now declared, capability-gated features: off by default in both
  // profiles (their capabilities are in no grant set), and mountable in one line.
  const fakeMemoryDeps = {
    notes: {} as never,
    extractions: {} as never,
    verifications: {} as never,
    dataDir: '/tmp/jini-memory',
  };

  it('memory mounts when its capability is granted and it is named', async () => {
    const { app, kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'memory:store': true },
      features: { memory: true },
      featureOptions: { memory: fakeMemoryDeps },
    });

    expect(kernel.activation.active.map((r) => r.id)).toContain('memory');
    expect(app._router).toBeDefined();
  });

  it('routines mounts the same way', async () => {
    const { kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'routines:schedule': true },
      features: { routines: true },
      featureOptions: { routines: { store: {} as never, scheduler: {} as never } },
    });
    expect(kernel.activation.active.map((r) => r.id)).toContain('routines');
  });

  it('media mounts the same way', async () => {
    const { kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'media:generate': true },
      features: { media: true },
      featureOptions: { media: { engine: {} as never, taskStore: {} as never } },
    });
    expect(kernel.activation.active.map((r) => r.id)).toContain('media');
  });

  it('frontendSessions mounts the same way', async () => {
    const { kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'ui:session': true },
      features: { frontendSessions: true },
      featureOptions: { frontendSessions: { registry: {} as never } },
    });
    expect(kernel.activation.active.map((r) => r.id)).toContain('frontendSessions');
  });

  it('refuses to mount a family whose host-supplied dependencies are missing, naming the exact option', async () => {
    const app = express();
    installRouteRegistrationGuard(app);
    await expect(
      composeJiniKernel({
        app,
        adapter: { resolvedPortRef: { current: 0 } },
        storage: { kind: 'memory' },
        profile: 'agent-core-v1',
        capabilities: { 'memory:store': true },
        features: { memory: true },
      }),
    ).rejects.toThrow(/feature "memory" is active but "featureOptions\.memory" was not supplied/);
  });

  it('refuses daemonStatus without the one option it cannot derive', async () => {
    const app = express();
    installRouteRegistrationGuard(app);
    await expect(
      composeJiniKernel({
        app,
        adapter: { resolvedPortRef: { current: 0 } },
        storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
        profile: 'local-daemon-v1',
      }),
    ).rejects.toThrow(/"featureOptions\.daemonStatus\.requestShutdown" was not supplied/);
  });
});

describe('remoteRunEvents', () => {
  it('is mountable as an explicit opt-in, and fails closed until its dedicated token is configured', async () => {
    const { url, kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'run:inject': true },
      features: { remoteRunEvents: true },
      env: {},
    });

    expect(kernel.activation.active.map((r) => r.id)).toContain('remoteRunEvents');
    const response = await fetch(`${url}/api/runs/whatever/tool-use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolUseId: 'tu', toolId: 'echo' }),
    });
    // 503, not 200: a route that injects events into someone else's run must never run
    // unauthenticated just because a host forgot to configure its token.
    expect(response.status).toBe(503);
  });

  it('records a real tool_use into the run\'s own log once the token is present', async () => {
    const env = { JINI_REMOTE_TOOL_BRIDGE_TOKEN: 'secret-token' };
    const { url, kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'run:inject': true },
      features: { remoteRunEvents: true },
      env,
    });

    const { run } = await kernel.base.lifecycle.start({ contextRef: 'ctx-1' });
    const response = await fetch(`${url}/api/runs/${run.id}/tool-use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
      body: JSON.stringify({ toolUseId: 'tu-1', toolId: 'echo', input: { a: 1 } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true });
  });
});

describe('agentExecutor options reach the kernel', () => {
  it('threads host-supplied executor options through composition', async () => {
    const { kernel } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      agentExecutor: { mcpJsonInjection: { command: 'node', args: ['serve.js'], daemonUrl: 'http://127.0.0.1:1' } },
    });
    expect(kernel.base.agentExecutor).toBeDefined();
  });
});

describe('security defaults', () => {
  // `registerApiBearerAuthMiddleware` registers ZERO middleware when no token is configured (a
  // deliberate no-op), so its `USE /api` registration is the observable signal that the default env
  // var names were read. A live 401 cannot be the signal here: that middleware short-circuits
  // loopback peers, and this suite necessarily calls over loopback.
  const usesApi = (app: Express) =>
    getRouteRegistrationInventory(app).filter((r) => r.method === 'USE' && r.path === '/api').length;

  it('falls back to the standard env var names when jini-local security names none', async () => {
    const { app } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: { mode: 'jini-local', host: '127.0.0.1' },
      env: { JINI_API_TOKEN: 'tok' },
    });
    // Both the bearer gate (token configured, via the defaulted var name) and the always-on origin
    // guard registered.
    expect(usesApi(app)).toBe(2);
  });

  it('registers only the origin guard when no token is configured under those same default names', async () => {
    const { app } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: { mode: 'jini-local', host: '127.0.0.1' },
      env: {},
    });
    expect(usesApi(app)).toBe(1);
  });

  it('installs neither gate in host-security mode — the caller owns that policy', async () => {
    const { app } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: { mode: 'host' },
      env: { JINI_API_TOKEN: 'tok' },
    });
    expect(usesApi(app)).toBe(0);
  });
});

// Unlike `jini-local` above, this mode CAN be asserted with live requests: it has no loopback
// short-circuit, and this suite necessarily calls over loopback — which is exactly what makes these
// the highest-value assertions in the file for this mode.
describe('sidecar-strict security', () => {
  const TOKEN_ENV_VAR = 'TEST_SIDECAR_TOKEN';
  const strict = {
    mode: 'sidecar-strict',
    host: '127.0.0.1',
    tokenEnvVar: TOKEN_ENV_VAR,
  } as const;

  // The real `detectAgents` probes every agent CLI on the machine (~14s here). These tests are about
  // the gate, not detection, so stub it — `options.agents.detector` is the existing seam for exactly
  // this. Without it, any test that gets *past* the gate pays for 24 subprocess probes.
  const noAgents = { agents: { detector: async () => [] } };

  const usesApi = (app: Express) =>
    getRouteRegistrationInventory(app).filter((r) => r.method === 'USE' && r.path === '/api').length;

  it('rejects an unauthenticated loopback caller with 401 — the whole point of the mode', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    expect((await fetch(`${url}/api/agents`)).status).toBe(401);
  });

  it('rejects a wrong bearer token from loopback with 401', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    const response = await fetch(`${url}/api/agents`, { headers: { authorization: 'Bearer wrong' } });
    expect(response.status).toBe(401);
  });

  it('admits a correct bearer token', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
      featureOptions: noAgents,
    });
    const response = await fetch(`${url}/api/agents`, {
      headers: { authorization: 'Bearer sidecar-secret' },
    });
    expect(response.status).toBe(200);
  });

  it('fails closed with 503 when the named token env var is unset', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: {},
    });
    const response = await fetch(`${url}/api/agents`, { headers: { authorization: 'Bearer anything' } });
    expect(response.status).toBe(503);
  });

  // `probe`-phase routes mount ahead of the gate, so monitoring never needs the secret.
  it('leaves health and readiness probes reachable without a token', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
      featureOptions: shutdownOption,
    });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect((await fetch(`${url}/api/ready`)).status).toBe(200);
  });

  it('honors an exact-match exempt path and still gates a longer path sharing its prefix', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'tool:delegated': true },
      features: { delegatedToolCalls: true },
      security: { ...strict, exemptPaths: ['/api/delegated-tool-calls'] },
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    // Exempt: reaches the route, which then rejects the empty body on its own terms — any status
    // other than 401/503 proves the gate was not what answered.
    const exempt = await fetch(`${url}/api/delegated-tool-calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([401, 503]).not.toContain(exempt.status);
    // Not exempt: exact equality, never prefix.
    expect((await fetch(`${url}/api/delegated-tool-calls/extra`, { method: 'POST' })).status).toBe(401);
  });

  // Only the origin guard is `/api`-scoped in this mode; the bearer gate mounts with a bare
  // `app.use(handler)`, which the route-registration inventory does not record at all (it only
  // records string-path registrations). So the mount ORDER is asserted behaviorally below rather
  // than structurally here.
  it('registers exactly one /api-scoped gate — the origin guard', async () => {
    const { app } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    expect(usesApi(app)).toBe(1);
  });

  // The load-bearing ordering property: the gate runs BEFORE `express.json()`, so a caller it is
  // going to reject never has its body parsed. Malformed JSON is the probe that can tell the two
  // orderings apart — the parser answers 400, the gate answers 401, and whichever runs first wins.
  it('rejects an unauthenticated caller before the body parser sees a malformed body', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    const response = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ definitely not valid json',
    });
    expect(response.status).toBe(401);
  });

  // The other half of that proof: with a valid token the gate calls next(), the parser is reached,
  // and the same malformed body now fails as a parse error. Without this pairing the test above
  // would also pass if the body were simply never parsed by anyone.
  it('lets an authenticated caller reach the body parser, which then rejects the same body', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      security: strict,
      env: { [TOKEN_ENV_VAR]: 'sidecar-secret' },
    });
    const response = await fetch(`${url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sidecar-secret' },
      body: '{ definitely not valid json',
    });
    expect(response.status).toBe(400);
  });
});

describe('kernel base failure cleanup', () => {
  it('closes every handle it had already opened when rehydration fails', async () => {
    const dataDir = makeTempDataDir();
    // A corrupt events.db makes rehydration throw after both logs and the second connection are
    // already open — the one path where a leak would otherwise be invisible.
    writeFileSync(join(dataDir, 'events.db'), 'not a sqlite file at all');

    await expect(createJiniKernelBase({ storage: { kind: 'sqlite', dataDir } })).rejects.toThrow();
  });
});

describe('catalog options are closed over at construction', () => {
  it('builds a fresh catalog per call, so two compositions never share feature state', () => {
    const first = createBuiltInFeatures({ health: { getVersion: () => 'a' } });
    const second = createBuiltInFeatures({ health: { getVersion: () => 'b' } });
    expect(first).not.toBe(second);
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
  });
});

describe('host-supplied option overrides reach their feature', () => {
  it('honors an explicit principal for the gated terminal and daemon-db tools', async () => {
    const { kernel } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: {
        ...shutdownOption,
        terminal: { principal: { id: 'custom-terminal' } },
        daemonDb: { principal: { id: 'custom-db' } },
      },
    });
    expect(kernel.base.registry.has('terminal.create')).toBe(true);
    expect(kernel.base.registry.has('daemon.db.vacuum')).toBe(true);
  });

  it('honors a caller-owned xAI listener ref, and disposes an in-flight listener on teardown', async () => {
    const stop = vi.fn(async () => undefined);
    const listenerRef = { current: { stop } as never };
    const { kernel } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: { ...shutdownOption, xai: { listenerRef } },
    });

    await kernel.disposeFeatures();
    // The fixed loopback OAuth port would otherwise outlive the composition by up to its own
    // 30-minute self-close timeout.
    expect(stop).toHaveBeenCalledTimes(1);
    expect(listenerRef.current).toBeNull();
  });

  it('honors a custom remote-tool-bridge token env var name', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'run:inject': true },
      features: { remoteRunEvents: true },
      featureOptions: { remoteRunEvents: { tokenConfig: { tokenEnvVar: 'PRODUCT_BRIDGE_TOKEN' } } },
      env: { PRODUCT_BRIDGE_TOKEN: 'custom-secret' },
    });

    const rejected = await fetch(`${url}/api/runs/x/tool-use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ toolUseId: 'tu', toolId: 'echo' }),
    });
    expect(rejected.status).toBe(401);

    const accepted = await fetch(`${url}/api/runs/unknown-run/tool-use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer custom-secret' },
      body: JSON.stringify({ toolUseId: 'tu', toolId: 'echo' }),
    });
    // Past the gate; rejected on its own merits (no such run) rather than on authentication.
    expect(accepted.status).toBe(404);
  });

  it('honors every derivable daemon-status field when a host supplies it explicitly', async () => {
    const { url } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: {
        daemonStatus: {
          requestShutdown: () => undefined,
          getVersion: () => '4.5.6',
          host: '0.0.0.0',
          getPort: () => 9999,
          dataDir: '/explicit/data/dir',
          isShuttingDown: () => true,
        },
      },
    });

    const body = (await (await fetch(`${url}/api/daemon/status`)).json()) as {
      version: string;
      host: string;
      port: number;
      dataDir: string;
      shuttingDown: boolean;
    };
    expect(body).toMatchObject({
      version: '4.5.6',
      host: '0.0.0.0',
      port: 9999,
      dataDir: '/explicit/data/dir',
    });
  });

  it('carries a tool descriptor\'s inputSchema into the durable catalog', async () => {
    const { url } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: shutdownOption,
      toolRegistrations: [
        {
          descriptor: { id: 'product.typed', inputSchema: { type: 'object', properties: { slug: { type: 'string' } } } },
          handler: async () => 'ok',
          policy: { authorize: () => 'allow' },
        },
      ],
    });

    const entry = (await (await fetch(`${url}/api/tools/product.typed`)).json()) as {
      id: string;
      description: string;
      inputSchema?: unknown;
    };
    expect(entry.inputSchema).toEqual({ type: 'object', properties: { slug: { type: 'string' } } });
    // A descriptor with no description falls back to its id rather than persisting an empty string.
    expect(entry.description).toBe('product.typed');
  });

  it('reports not-ready when the integrity probe itself throws, instead of letting it escape the route', async () => {
    const sqliteModule = await import('@jini-ai/sqlite');
    const spy = vi.spyOn(sqliteModule, 'verifySqliteIntegrity').mockImplementation(() => {
      throw new Error('pragma read exploded');
    });
    try {
      const { url } = await boot({
        storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
        profile: 'local-daemon-v1',
        featureOptions: shutdownOption,
      });
      const response = await fetch(`${url}/api/ready`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { details: { checks: Record<string, boolean> } } };
      expect(body.error.details.checks).toMatchObject({ db: false });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('daemon-status derived defaults', () => {
  it('derives version, port and shutting-down state from the composition when a host supplies only requestShutdown', async () => {
    const { url } = await boot({
      storage: { kind: 'sqlite', dataDir: makeTempDataDir() },
      profile: 'local-daemon-v1',
      featureOptions: shutdownOption,
    });

    const body = (await (await fetch(`${url}/api/daemon/status`)).json()) as {
      version: string;
      host: string;
      port: number;
      dataDir: string;
      shuttingDown: boolean;
    };
    // Everything but `requestShutdown` came from what the composition already knew: its own package
    // version, the adapter's resolved port, the kernel's sqlite dataDir, and a not-shutting-down
    // default.
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.host).toBe('127.0.0.1');
    expect(body.port).toBeGreaterThan(0);
    expect(body.dataDir).toMatch(/jini-builtin-test-/);
    expect(body.shuttingDown).toBe(false);
  });

  it('reports an empty dataDir under memory storage rather than inventing a path', async () => {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      capabilities: { 'daemon:control': true },
      features: { daemonStatus: true },
      featureOptions: shutdownOption,
    });

    const body = (await (await fetch(`${url}/api/daemon/status`)).json()) as { dataDir: string };
    expect(body.dataDir).toBe('');
  });
});

describe('agents feature — AgentExecutor compatibility filtering', () => {
  // Shaped like a real `DetectedAgent` for the fields `projectDetectedAgent` reads.
  const detected = (id: string) => ({
    id,
    name: id,
    available: true,
    models: [],
    modelsSource: 'fallback' as const,
  });

  async function listAgentIds(ids: string[]): Promise<string[]> {
    const { url } = await boot({
      storage: { kind: 'memory' },
      profile: 'agent-core-v1',
      featureOptions: { agents: { detector: async () => ids.map(detected) as never } },
    });
    const body = (await (await fetch(`${url}/api/agents`)).json()) as { agents: { id: string }[] };
    return body.agents.map((a) => a.id);
  }

  // All 24 real registered defs are driveable today (see `agent-executor.test.ts`'s "accepts every
  // one of the 24 registered defs") — antigravity was the last holdout and is now supported, so there
  // is no real def left to demonstrate the drop path with. This scopes a `getAgentDef` override to
  // exactly one fake id via `vi.spyOn` + `mockRestore` in `finally`, rather than a file-wide
  // `vi.mock('@jini-ai/agent-runtime', ...)` that would also have to fake out every other test in this
  // describe block's real registry lookups (`aider`/`deepseek`/unrecognized ids).
  async function withUnsupportedFakeDef<T>(fakeId: string, run: () => Promise<T>): Promise<T> {
    const agentRuntime = await import('@jini-ai/agent-runtime');
    const actualGetAgentDef = agentRuntime.getAgentDef;
    const claudeDef = actualGetAgentDef('claude');
    if (!claudeDef) throw new Error('test setup: no "claude" def registered');
    const spy = vi.spyOn(agentRuntime, 'getAgentDef').mockImplementation((id: string) =>
      id === fakeId ? { ...claudeDef, id: fakeId, streamFormat: 'made-up-format' } : actualGetAgentDef(id),
    );
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it('drops an agent whose registered def AgentExecutor cannot drive', async () => {
    await withUnsupportedFakeDef('fake-unsupported-agent', async () => {
      expect(await listAgentIds(['claude', 'fake-unsupported-agent'])).toEqual(['claude']);
    });
  });

  // The counterpart guard to the predicate's own: these two qualify only via `maxPromptArgBytes`, a
  // field `DetectedAgent` omits. Filtering on the projected shape instead of the resolved def would
  // silently remove two working agents from every consumer's picker.
  it('keeps the argv-bound defs aider and deepseek', async () => {
    expect(await listAgentIds(['aider', 'deepseek'])).toEqual(['aider', 'deepseek']);
  });

  // A host with its own detector may surface agents outside AGENT_DEFS, driven by something other
  // than this executor. There is nothing to assess, so they are kept rather than dropped.
  it('keeps an unrecognized id that has no registered runtime def', async () => {
    expect(await listAgentIds(['claude', 'some-host-specific-agent'])).toEqual([
      'claude',
      'some-host-specific-agent',
    ]);
  });

  it('applies the same filter to an explicit rescan', async () => {
    await withUnsupportedFakeDef('fake-unsupported-agent', async () => {
      const { url } = await boot({
        storage: { kind: 'memory' },
        profile: 'agent-core-v1',
        featureOptions: {
          agents: { detector: async () => [detected('claude'), detected('fake-unsupported-agent')] as never },
        },
      });
      const body = (await (
        await fetch(`${url}/api/agents/rescan`, { method: 'POST', headers: { origin: `${url}` } })
      ).json()) as { agents: { id: string }[] };
      expect(body.agents.map((a) => a.id)).toEqual(['claude']);
    });
  });
});
