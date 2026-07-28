import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedAgent } from '@injini/agent-runtime';
import { definePack } from '@injini/core';
import { AgentExecutorToken } from '@injini/daemon';
import type { DaemonStatusResponse, RunStartContext } from '@injini/http';
import { readLiveDaemonRegistryRecord, resolveDaemonRegistryPath } from '@injini/sidecar';
import * as SidecarModule from '@injini/sidecar';
import * as SqliteModule from '@injini/sqlite';
import Database from 'better-sqlite3';
import {
  buildDaemonDbOperations,
  classifyRunFailureForRetry,
  createLocalNodeDaemon,
  resolveBoundPort,
  resolveReportHost,
  type LocalNodeDaemon,
} from '../create-local-node-daemon.js';

/**
 * Real-socket integration suite for `createLocalNodeDaemon` — mirrors the established pattern in
 * `packages/platform/src/__tests__/index.test.ts` (`createServer(...).listen(0)` + `fetch()`, no
 * `supertest`). Every test here boots an actual daemon on an OS-assigned ephemeral port against a
 * real (tmp-dir) sqlite file; nothing about `@injini/core`/`@injini/daemon`/`@injini/sqlite`/`@injini/http`
 * is mocked. `createSqliteEventLog` is the one exception — spied on (not replaced) in a handful of
 * tests specifically to observe that `stop()` really calls the returned `EventLog`'s `close()`,
 * since reopening the same sqlite file afterward succeeds regardless of whether the original
 * handle was closed (verified empirically: `better-sqlite3` in WAL mode permits two concurrently
 * open handles on one file within a single process) and would not, on its own, prove anything.
 */

const ENV_KEYS = ['JINI_API_TOKEN', 'JINI_DISABLE_API_AUTH', 'JINI_ALLOWED_ORIGINS', 'JINI_WEB_PORT', 'JINI_BIND_HOST'] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) savedEnv[key] = value;
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jini-node-host-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const daemonsToStop: LocalNodeDaemon[] = [];
afterEach(async () => {
  while (daemonsToStop.length > 0) {
    const daemon = daemonsToStop.pop();
    if (daemon) await daemon.stop().catch(() => {});
  }
});

function makePingPack() {
  return definePack({
    name: 'ping',
    deps: [],
    services: () => ({}),
    http: (app: unknown) => {
      (app as { get: (path: string, handler: (req: unknown, res: { json: (b: unknown) => void }) => void) => void }).get(
        '/api/ping',
        (_req, res) => res.json({ ok: true }),
      );
    },
  });
}

function parseSseEvents(body: string): Array<{ id: string; event: string; data: Record<string, unknown> }> {
  return body
    .trim()
    .split('\n\n')
    .filter((frame) => frame.length > 0)
    .map((frame) => {
      const fields = Object.fromEntries(
        frame
          .split('\n')
          .map((line) => {
            const separator = line.indexOf(': ');
            return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 2)];
          }),
      );
      return { id: fields.id!, event: fields.event!, data: JSON.parse(fields.data!) as Record<string, unknown> };
    });
}

/** The first routable, non-loopback IPv4 address this machine has, or `null` if none — used only
 * by the bearer-auth 401 test below, whose loopback-exemption design makes it untestable via a
 * loopback-bound fetch (see that test's own comment). */
function findExternalIPv4Address(): string | null {
  const ifaces = networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    for (const iface of entries ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

describe('resolveBoundPort', () => {
  it('returns the port from a real AddressInfo-shaped address', () => {
    expect(resolveBoundPort({ port: 7456 })).toBe(7456);
  });

  it('returns null for a null address (not yet listening)', () => {
    expect(resolveBoundPort(null)).toBeNull();
  });

  it('returns null for a string address (a Unix domain socket path)', () => {
    expect(resolveBoundPort('/tmp/some.sock')).toBeNull();
  });

  it('returns null for a non-positive port', () => {
    expect(resolveBoundPort({ port: 0 })).toBeNull();
  });
});

describe('resolveReportHost', () => {
  it('substitutes 127.0.0.1 for an all-interfaces IPv4 bind host', () => {
    expect(resolveReportHost('0.0.0.0')).toBe('127.0.0.1');
  });

  it('substitutes 127.0.0.1 for an all-interfaces IPv6 bind host', () => {
    expect(resolveReportHost('::')).toBe('127.0.0.1');
  });

  it('echoes back any other host unchanged', () => {
    expect(resolveReportHost('192.168.1.10')).toBe('192.168.1.10');
    expect(resolveReportHost('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('buildDaemonDbOperations', () => {
  function makeDb(): { db: Database.Database; file: string } {
    const dir = makeTempDataDir();
    const file = join(dir, 'test.db');
    const db = new Database(file);
    db.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO widgets (name) VALUES (?)').run('a');
    db.prepare('INSERT INTO widgets (name) VALUES (?)').run('b');
    return { db, file };
  }

  it('inspect() reports the real schema/table/row-count inventory', async () => {
    const { db, file } = makeDb();
    try {
      const operations = buildDaemonDbOperations(db, file);
      const report = await operations.inspect();
      expect(report.kind).toBe('sqlite');
      expect(report.location).toBe(file);
      expect(report.tables).toContainEqual({ name: 'widgets', rowCount: 2 });
      expect(report.sizeBytes).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('verify() reports ok:true against a healthy database', async () => {
    const { db, file } = makeDb();
    try {
      const operations = buildDaemonDbOperations(db, file);
      const report = await operations.verify(false);
      expect(report.ok).toBe(true);
      expect(report.issues).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('vacuum() really shrinks/rewrites the file and reports real before/after sizes', async () => {
    const { db, file } = makeDb();
    try {
      const operations = buildDaemonDbOperations(db, file);
      const result = await operations.vacuum();
      expect(result.ok).toBe(true);
      expect(result.beforeBytes).toBeGreaterThan(0);
      expect(result.afterBytes).toBeGreaterThan(0);
      expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      // The table survives VACUUM — proves this really ran against the same live database, not a copy.
      expect(db.prepare('SELECT COUNT(*) as c FROM widgets').get()).toEqual({ c: 2 });
    } finally {
      db.close();
    }
  });
});

describe('classifyRunFailureForRetry', () => {
  // Extracted for direct unit testing (see this function's own doc): a real spawned-process
  // failure through createLocalNodeDaemon's full run flow would need a real, predictably-failing
  // agent CLI, which the wiring-site doc explicitly rejects as fragile/non-deterministic. Delegates
  // entirely to `@injini/daemon`'s `resumableFromProcessExit` — this proves the wiring itself, not a
  // reimplementation of that function's own policy (already covered by daemon's own test suite).
  it('delegates to resumableFromProcessExit — a signal-terminated run is presumptively retryable', () => {
    expect(classifyRunFailureForRetry({ code: null, signal: 'SIGKILL' })).toBe(true);
  });

  it('a plain nonzero exit is not retryable', () => {
    expect(classifyRunFailureForRetry({ code: 1, signal: null })).toBe(false);
  });
});

describe('createLocalNodeDaemon', () => {
  it('boots on an ephemeral port and reports a URL reflecting the real bound port', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    expect(daemon.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const port = Number(new URL(daemon.url).port);
    expect(port).toBeGreaterThan(0);
    const address = daemon.server.address();
    expect(address && typeof address === 'object' ? address.port : null).toBe(port);
  });

  describe('toolRegistrations', () => {
    const noopHandler = async (): Promise<string> => 'ok';
    const allowAll = { authorize: (): 'allow' => 'allow' };

    it('boots with host-contributed tool registrations', async () => {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({
        dataDir,
        packs: [makePingPack()],
        toolRegistrations: [
          { descriptor: { id: 'page.click' }, handler: noopHandler, policy: allowAll },
          { descriptor: { id: 'page.fill' }, handler: noopHandler, policy: allowAll },
        ],
      });
      daemonsToStop.push(daemon);

      const res = await fetch(`${daemon.url}/api/ping`);
      expect(res.status).toBe(200);
    });

    it('rejects when two host registrations share a descriptor id', async () => {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({
        dataDir,
        packs: [makePingPack()],
        toolRegistrations: [
          { descriptor: { id: 'page.click' }, handler: noopHandler, policy: allowAll },
          { descriptor: { id: 'page.click' }, handler: noopHandler, policy: allowAll },
        ],
      })).rejects.toThrow('tool "page.click" is already registered');
    });

    // The point of the shared registry: a host tool and the preset's own tools go through ONE
    // ToolExecutor, so they necessarily share an id space. A collision proves they landed in the
    // same registry rather than in a parallel one.
    it('rejects when a host registration collides with one of the preset\'s own tools', async () => {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({
        dataDir,
        packs: [makePingPack()],
        toolRegistrations: [
          { descriptor: { id: 'daemon.db.inspect' }, handler: noopHandler, policy: allowAll },
        ],
      })).rejects.toThrow('tool "daemon.db.inspect" is already registered');
    });

    it('releases the sqlite handles it had already opened when a registration collides', async () => {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({
        dataDir,
        packs: [makePingPack()],
        toolRegistrations: [
          { descriptor: { id: 'terminal.create' }, handler: noopHandler, policy: allowAll },
        ],
      })).rejects.toThrow(/already registered/);

      // A leaked handle would keep the file locked; a fresh daemon on the same dataDir proves it
      // was released.
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
      daemonsToStop.push(daemon);
      expect((await fetch(`${daemon.url}/api/ping`)).status).toBe(200);
    });
  });

  // The route that makes `toolRegistrations` reachable by an agent. Without it the registry is
  // complete and correct and nothing can call it, which is the state this preset shipped in.
  describe('delegated tool calls', () => {
    const allowAll = { authorize: (): 'allow' => 'allow' };

    /** Starts a run through the real route so the delegated call has an existing run to target. */
    async function startRun(url: string): Promise<string> {
      const response = await fetch(`${url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'delegated-context', agentId: 'complete' }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { run: { id: string } }).run.id;
    }

    async function callDelegatedTool(
      url: string,
      body: Record<string, unknown>,
    ): Promise<{ status: number; json: unknown }> {
      const response = await fetch(`${url}/api/delegated-tool-calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    }

    it('executes a host registration through the shared ToolExecutor', async () => {
      const seen: unknown[] = [];
      const daemon = await createLocalNodeDaemon({
        dataDir: makeTempDataDir(),
        packs: [makePingPack()],
        toolRegistrations: [{
          descriptor: { id: 'page.click' },
          handler: async (ctx) => {
            seen.push(ctx.input);
            return { clicked: true };
          },
          policy: allowAll,
        }],
      });
      daemonsToStop.push(daemon);
      const runId = await startRun(daemon.url);

      const { status, json } = await callDelegatedTool(daemon.url, {
        runId, toolUseId: 'use-1', toolId: 'page.click', input: { element: 'save' },
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({ result: { status: 'completed', output: { clicked: true } } });
      expect(seen).toEqual([{ element: 'save' }]);
    });

    // Inertness must come from the policy, not from the route being absent — an unreachable route
    // is indistinguishable from a broken build, which is why this preset mounts it regardless.
    it('is reachable but refused when the tool keeps a deny-by-default policy', async () => {
      const daemon = await createLocalNodeDaemon({
        dataDir: makeTempDataDir(),
        packs: [makePingPack()],
        toolRegistrations: [{
          descriptor: { id: 'page.click' },
          handler: async () => 'never runs',
          policy: { authorize: (): 'deny' => 'deny' },
        }],
      });
      daemonsToStop.push(daemon);
      const runId = await startRun(daemon.url);

      const { status, json } = await callDelegatedTool(daemon.url, {
        runId, toolUseId: 'use-1', toolId: 'page.click', input: {},
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({ result: { status: 'denied' } });
    });

    it('runs as the anonymous principal when the host supplies no resolver', async () => {
      const principals: string[] = [];
      const daemon = await createLocalNodeDaemon({
        dataDir: makeTempDataDir(),
        packs: [makePingPack()],
        toolRegistrations: [{
          descriptor: { id: 'page.click' },
          handler: async () => 'ok',
          policy: {
            authorize: (ctx): 'allow' => {
              principals.push(ctx.principal.id);
              return 'allow';
            },
          },
        }],
      });
      daemonsToStop.push(daemon);
      const runId = await startRun(daemon.url);

      await callDelegatedTool(daemon.url, { runId, toolUseId: 'u', toolId: 'page.click', input: {} });

      expect(principals).toEqual(['anonymous-delegated']);
    });

    it('runs as the host-resolved principal, and passes it the request', async () => {
      const principals: Array<{ id: string; roles?: readonly string[] }> = [];
      const requests: unknown[] = [];
      const daemon = await createLocalNodeDaemon({
        dataDir: makeTempDataDir(),
        packs: [makePingPack()],
        resolveDelegatedPrincipal: (request) => {
          requests.push({ toolId: request.toolId, toolUseId: request.toolUseId });
          return { id: 'editor-7', roles: ['editor'] };
        },
        toolRegistrations: [{
          descriptor: { id: 'page.click' },
          handler: async () => 'ok',
          policy: {
            authorize: (ctx): 'allow' => {
              principals.push(ctx.principal);
              return 'allow';
            },
          },
        }],
      });
      daemonsToStop.push(daemon);
      const runId = await startRun(daemon.url);

      await callDelegatedTool(daemon.url, { runId, toolUseId: 'u-9', toolId: 'page.click', input: {} });

      expect(principals).toEqual([{ id: 'editor-7', roles: ['editor'] }]);
      expect(requests).toEqual([{ toolId: 'page.click', toolUseId: 'u-9' }]);
    });

    it('reports an unknown run rather than executing anything', async () => {
      const daemon = await createLocalNodeDaemon({
        dataDir: makeTempDataDir(),
        packs: [makePingPack()],
      });
      daemonsToStop.push(daemon);

      const { status } = await callDelegatedTool(daemon.url, {
        runId: 'no-such-run', toolUseId: 'u', toolId: 'page.click', input: {},
      });

      expect(status).toBe(404);
    });
  });

  it('substitutes 127.0.0.1 into the reported URL when bound to 0.0.0.0', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], host: '0.0.0.0' });
    daemonsToStop.push(daemon);

    expect(daemon.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${daemon.url}/api/ping`);
    expect(res.status).toBe(200);
  });

  it('serves GET /api/daemon/status', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/daemon/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DaemonStatusResponse;
    expect(body).toMatchObject({ ok: true, host: '127.0.0.1', dataDir, shuttingDown: false });
    expect(typeof body.version).toBe('string');
    expect(body.port).toBe(Number(new URL(daemon.url).port));
    expect(typeof body.pid).toBe('number');
  });

  it('serves GET /api/agents, projecting the real @injini/agent-runtime registry with zero config', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{
        id: string;
        name: string;
        available: boolean;
        models: Array<{ id: string; label: string }>;
        reasoningOptions?: Array<{ id: string; label: string }>;
        modelsSource: 'live' | 'fallback';
      }>;
    };
    expect(body.agents.length).toBeGreaterThan(0);
    expect(body.agents.find((a) => a.id === 'claude')).toMatchObject({
      id: 'claude',
      name: expect.any(String),
      available: expect.any(Boolean),
      models: expect.any(Array),
      modelsSource: expect.stringMatching(/^(live|fallback)$/),
    });
    // Discovery data crosses HTTP; spawn-only RuntimeAgentDef details still do not.
    for (const agent of body.agents) {
      expect(agent).not.toHaveProperty('bin');
      expect(agent).not.toHaveProperty('path');
      expect(agent).not.toHaveProperty('buildArgs');
      expect(agent).not.toHaveProperty('env');
    }
  });

  it('caches daemon-owned agent detection and reruns it only through POST /api/agents/rescan', async () => {
    const dataDir = makeTempDataDir();
    const detected = {
      id: 'test-agent',
      name: 'Test Agent',
      available: true,
      models: [{ id: 'test-model', label: 'Test Model' }],
      reasoningOptions: [{ id: 'high', label: 'High' }],
      modelsSource: 'live',
      streamFormat: 'jsonl',
      bin: 'not-exposed',
      versionArgs: ['--version'],
    } as DetectedAgent;
    const agentDetector = vi.fn(async () => [detected]);
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      agentDetector,
    });
    daemonsToStop.push(daemon);

    const first = await fetch(`${daemon.url}/api/agents`);
    const second = await fetch(`${daemon.url}/api/agents`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(agentDetector).toHaveBeenCalledTimes(1);

    const rescanned = await fetch(`${daemon.url}/api/agents/rescan`, {
      method: 'POST',
      headers: { Origin: daemon.url, Host: new URL(daemon.url).host },
    });
    expect(rescanned.status).toBe(200);
    expect(agentDetector).toHaveBeenCalledTimes(2);
    await expect(rescanned.json()).resolves.toEqual({
      agents: [{
        id: 'test-agent',
        name: 'Test Agent',
        available: true,
        models: [{ id: 'test-model', label: 'Test Model' }],
        reasoningOptions: [{ id: 'high', label: 'High' }],
        modelsSource: 'live',
      }],
    });
  });

  it('serves POST /api/resources/:resourceRef/open-in, denying every call by default (denyAllWorkspaceRoots) with no resolveWorkspaceRoot configured', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/resources/some-resource/open-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorId: 'vscode' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('serves POST /api/resources/:resourceRef/open-in for real once resolveWorkspaceRoot is configured (still 409 CONFLICT when the editor is not installed, proving the resolver actually ran)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      resolveWorkspaceRoot: (req) => (req.resourceRef === 'known-resource' ? dataDir : null),
    });
    daemonsToStop.push(daemon);

    const denied = await fetch(`${daemon.url}/api/resources/unknown-resource/open-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorId: 'vscode' }),
    });
    expect(denied.status).toBe(404);

    const allowed = await fetch(`${daemon.url}/api/resources/known-resource/open-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorId: 'vscode' }),
    });
    // Not 404: the resolver ran and returned a real directory. Whether vscode is actually
    // installed on this test machine is unknowable and irrelevant to what this test proves — only
    // that the resolver wiring, not the launch outcome, is what's under test.
    expect(allowed.status).not.toBe(404);
    expect([200, 409, 400]).toContain(allowed.status);
  });

  it('mounts product-owned HTTP extensions without making the host depend on their packages', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      httpExtensions: [
        (app) => {
          app.get('/api/extension-probe', (_req, res) => {
            res.status(200).json({ ok: true });
          });
        },
      ],
    });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/extension-probe`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves POST /api/proxy/anthropic/stream zero-config (BYOK — no server-side credentials needed to reach the route)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    // No apiKey in the body: proves the route is mounted and reachable (a validation error, not a
    // 404) without asserting anything about a real upstream call, which needs a real credential.
    const res = await fetch(`${daemon.url}/api/proxy/anthropic/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(404);
  });

  it('serves GET and POST /api/active zero-config, always resolving an unknown resource (denyAllWorkspaceRoots-shaped honest default)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const setRes = await fetch(`${daemon.url}/api/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceRef: 'some-resource' }),
    });
    expect(setRes.status).toBe(200);

    const getRes = await fetch(`${daemon.url}/api/active`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { resourceRef: string | null; resourceName: string | null };
    expect(body.resourceRef).toBe('some-resource');
    expect(body.resourceName).toBeNull();
  });

  it('serves POST /api/terminals zero-config, denying every call by default (no resolveWorkspaceRoot configured — the same denyAllWorkspaceRoots default host-tools already uses)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceRef: 'some-resource' }),
    });
    expect(res.status).toBe(404);
  });

  it('serves POST /api/terminals with resolveWorkspaceRoot configured, but still denies terminal.create by policy (denyAllTerminalCreatePolicy — a real PTY spawn needs an explicit host opt-in)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      resolveWorkspaceRoot: (req) => (req.resourceRef === 'known-resource' ? dataDir : null),
    });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceRef: 'known-resource' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOOL_OPERATION_DENIED');
  });

  it('serves GET /api/daemon/db zero-config, denying every call by default (denyAllDaemonDbPolicy)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/daemon/db`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOOL_OPERATION_DENIED');
  });

  it('leaves incubating memory/media routes to the product composition root', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    expect((await fetch(`${daemon.url}/api/memory`)).status).toBe(404);
    expect((await fetch(`${daemon.url}/api/media/tasks/unknown`)).status).toBe(404);
  });

  it('serves the complete HTTP run vertical slice: create, SSE replay/reconnect, cancel, and durable replay after restart', async () => {
    const dataDir = makeTempDataDir();
    let completedRunId = '';
    const activeRunLifecycles = new Map<string, RunStartContext['lifecycle']>();
    const onRunStarted = async ({ request, run, lifecycle }: RunStartContext) => {
      if (request.agentId === 'complete') {
        await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'hello from driver' } });
        await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
        return;
      }
      activeRunLifecycles.set(run.id, lifecycle);
      lifecycle.onCancelRequested(run.id, () => {
        void lifecycle.finish({ runId: run.id, status: 'cancelled', code: null, signal: 'SIGTERM', resumable: false });
      });
    };

    const first = await createLocalNodeDaemon({ dataDir, packs: [], onRunStarted });
    try {
      const createdResponse = await fetch(`${first.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'http-restart-context', idempotencyKey: 'completed-request', agentId: 'complete' }),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as { run: { id: string; state: string }; started: boolean };
      expect(created).toMatchObject({ started: true, run: { state: 'succeeded' } });
      completedRunId = created.run.id;

      const eventResponse = await fetch(`${first.url}/api/runs/${created.run.id}/events`);
      expect(eventResponse.headers.get('content-type')).toContain('text/event-stream');
      const events = parseSseEvents(await eventResponse.text());
      expect(events.map((event) => event.event)).toEqual(['start', 'agent', 'end']);
      expect(events[1]?.data.payload).toMatchObject({ type: 'text_delta', delta: 'hello from driver' });

      const reconnect = await fetch(`${first.url}/api/runs/${created.run.id}/events`, {
        headers: { 'Last-Event-ID': events[events.length - 1]!.id },
      });
      const reconnectEvents = parseSseEvents(await reconnect.text());
      expect(reconnectEvents.map((event) => event.event)).toEqual(['end']);

      const duplicateResponse = await fetch(`${first.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'http-restart-context', idempotencyKey: 'completed-request', agentId: 'complete' }),
      });
      expect(await duplicateResponse.json()).toMatchObject({ started: false, run: { id: created.run.id } });

      const cancellableResponse = await fetch(`${first.url}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contextRef: 'http-cancel-context', agentId: 'wait' }),
      });
      const cancellable = (await cancellableResponse.json()) as { run: { id: string } };
      // This request stays open until the driver emits/finishes below. It
      // verifies that the HTTP route is not merely replaying terminal history:
      // a client which was already subscribed receives a live event.
      const liveEventResponse = await fetch(`${first.url}/api/runs/${cancellable.run.id}/events`);
      expect(liveEventResponse.headers.get('content-type')).toContain('text/event-stream');
      await activeRunLifecycles.get(cancellable.run.id)!.emit(cancellable.run.id, {
        event: 'agent',
        data: { type: 'status', label: 'waiting for cancellation' },
      });
      const cancelled = await fetch(`${first.url}/api/runs/${cancellable.run.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'test cancellation' }),
      });
      expect(cancelled.status).toBe(200);
      const liveEvents = parseSseEvents(await liveEventResponse.text());
      expect(liveEvents.map((event) => event.event)).toEqual(['start', 'agent', 'end']);
      expect(liveEvents[1]?.data.payload).toMatchObject({ type: 'status', label: 'waiting for cancellation' });
      expect(await (await fetch(`${first.url}/api/runs/${cancellable.run.id}`)).json()).toMatchObject({ run: { state: 'cancelled' } });
    } finally {
      await first.stop();
    }

    const restarted = await createLocalNodeDaemon({ dataDir, packs: [] });
    daemonsToStop.push(restarted);
    expect(await (await fetch(`${restarted.url}/api/runs/${completedRunId}`)).json()).toMatchObject({ run: { id: completedRunId, state: 'succeeded' } });
    const replayed = parseSseEvents(await (await fetch(`${restarted.url}/api/runs/${completedRunId}/events`)).text());
    expect(replayed.map((event) => event.event)).toEqual(['start', 'agent', 'end']);
  });

  it('resolveRunInput, when supplied with no onRunStarted, builds a default RunStartHandler that drives the real zero-config AgentExecutor', async () => {
    const dataDir = makeTempDataDir();
    const resolveRunInputCalls: unknown[] = [];
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [],
      resolveRunInput: (ctx) => {
        resolveRunInputCalls.push(ctx);
        // No agent named this is registered anywhere — proves the resolved input really reached
        // the real zero-config AgentExecutor (AGENT_NOT_FOUND is that executor's own rejection),
        // without needing to spawn a real subprocess for a happy-path assertion.
        return { agentId: 'no-such-agent', prompt: 'hi', cwd: dataDir };
      },
    });
    daemonsToStop.push(daemon);

    const response = await fetch(`${daemon.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextRef: 'resolve-run-input-context', agentId: 'whatever-the-request-says' }),
    });

    expect(resolveRunInputCalls).toEqual([{ runId: expect.any(String), contextRef: 'resolve-run-input-context', agentId: 'whatever-the-request-says' }]);
    // runStartRoute.handle() catches the rejecting onStarted, finishes the run failed, and
    // returns a generic internal-error response rather than the raw AgentExecutorError.
    expect(response.status).toBe(500);
    const runId = (resolveRunInputCalls[0] as { runId: string }).runId;
    expect(await (await fetch(`${daemon.url}/api/runs/${runId}`)).json()).toMatchObject({ run: { state: 'failed' } });
  });

  it('onRunStarted takes precedence over resolveRunInput when both are supplied', async () => {
    const dataDir = makeTempDataDir();
    const resolveRunInputCalls: unknown[] = [];
    const onRunStarted = async ({ run, lifecycle }: RunStartContext) => {
      await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });
    };
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [],
      onRunStarted,
      resolveRunInput: (ctx) => {
        resolveRunInputCalls.push(ctx);
        return { agentId: 'unused', prompt: 'unused', cwd: dataDir };
      },
    });
    daemonsToStop.push(daemon);

    const response = await fetch(`${daemon.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextRef: 'precedence-context' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ started: true, run: { state: 'succeeded' } });
    expect(resolveRunInputCalls).toEqual([]);
  });

  it("mounts a caller pack's own route (proves mountPackHttp ordering)", async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('composes a pack whose deps are satisfied via the bindings customizer', async () => {
    const dataDir = makeTempDataDir();
    interface Greeter {
      greeting: string;
    }
    const { token } = await import('@injini/core');
    const GreeterToken = token<Greeter>('test.greeter');
    const greetPack = definePack({
      name: 'greet',
      deps: [GreeterToken],
      services: (c) => ({ say: () => c.get(GreeterToken).greeting }),
      http: (app: unknown, services: unknown) => {
        (app as { get: (path: string, handler: (req: unknown, res: { json: (b: unknown) => void }) => void) => void }).get(
          '/api/greet',
          (_req, res) => res.json({ greeting: (services as { say: () => string }).say() }),
        );
      },
    });

    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [greetPack],
      bindings: (b) => b.bind(GreeterToken, { greeting: 'hi' }),
    });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/greet`);
    expect(await res.json()).toEqual({ greeting: 'hi' });
  });

  it('auto-binds AgentExecutorToken alongside EventLogToken/RunLifecycleToken with zero caller config', async () => {
    const dataDir = makeTempDataDir();
    const agentExecutorPack = definePack({
      name: 'agent-executor-probe',
      deps: [AgentExecutorToken],
      services: (c) => ({ hasRun: () => typeof c.get(AgentExecutorToken).run === 'function' }),
      http: (app: unknown, services: unknown) => {
        (app as { get: (path: string, handler: (req: unknown, res: { json: (b: unknown) => void }) => void) => void }).get(
          '/api/agent-executor-probe',
          (_req, res) => res.json({ hasRun: (services as { hasRun: () => boolean }).hasRun() }),
        );
      },
    });

    // No `bindings` customizer supplied — proves AgentExecutorToken resolves
    // from createLocalNodeDaemon's own automatic kernel bindings alone, the
    // same zero-config guarantee EventLogToken/RunLifecycleToken already
    // have (see this module's KernelBoundIds doc).
    //
    // Called through a narrowed function type rather than
    // `createLocalNodeDaemon`'s own overloaded signature: `MissingTokenIds`
    // (see @injini/core/internal) computes a pack's required token ids from
    // `token.id`'s inferred literal type, but every kernel token exported
    // from a *compiled* `@injini/daemon` — not just AgentExecutorToken added
    // by this task, EventLogToken/RunLifecycleToken have the identical
    // shape — round-trips through that package's emitted `.d.ts` as
    // `Token<T, string>` (widened, not the literal `'jini.agentExecutor'`).
    // A pack depending solely on such a dist-imported token has never been
    // exercised through this exact zero-bindings-customizer call shape
    // before (the existing typecheck.ts proof only uses a token declared
    // inline in the same compilation unit, which infers the literal
    // correctly) — a real, pre-existing `@injini/core`/`@injini/daemon`
    // type-emission gap, out of this task's scope to fix. This call
    // proves the *runtime* wiring (the actual thing this test is for)
    // without being blocked by that unrelated compile-time gap.
    const createLocalNodeDaemonUnsafe = createLocalNodeDaemon as unknown as (config: {
      dataDir: string;
      packs: readonly unknown[];
    }) => Promise<LocalNodeDaemon>;
    const daemon = await createLocalNodeDaemonUnsafe({ dataDir, packs: [agentExecutorPack] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/agent-executor-probe`);
    expect(await res.json()).toEqual({ hasRun: true });
  });

  it('reflects the resolved bind host onto env.JINI_BIND_HOST before serving any request', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], host: '127.0.0.1' });
    daemonsToStop.push(daemon);

    expect(process.env.JINI_BIND_HOST).toBe('127.0.0.1');
  });

  it('allows an unauthenticated request when no apiToken is configured (default)', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`);
    expect(res.status).toBe(200);
  });

  it('allows a loopback caller with a correct bearer token when apiToken is configured', async () => {
    process.env.JINI_API_TOKEN = 'integration-secret';
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`, { headers: { Authorization: 'Bearer integration-secret' } });
    expect(res.status).toBe(200);
  });

  it('honors a custom apiToken env var name', async () => {
    process.env['CUSTOM_TOKEN'] = 'custom-secret';
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      apiToken: { tokenEnvVar: 'CUSTOM_TOKEN' },
    });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`, { headers: { Authorization: 'Bearer custom-secret' } });
    expect(res.status).toBe(200);
    delete process.env['CUSTOM_TOKEN'];
  });

  const lanAddress = findExternalIPv4Address();
  // The bearer-auth middleware unconditionally exempts loopback peers (by design — see
  // packages/http/src/api-security-middleware.ts's own doc), so the 401 branch can only be
  // observed via a real, non-loopback TCP connection. Requires a routable non-loopback IPv4
  // interface on the machine running this suite; skips gracefully (rather than failing) in a
  // fully loopback-only sandbox. The loopback-vs-non-loopback branch itself already has 100%
  // coverage at the unit level in packages/http/src/__tests__/api-security-middleware.test.ts —
  // this test's job is only to prove the real, assembled pipeline rejects too, not to re-derive
  // that unit coverage.
  it.skipIf(lanAddress == null)(
    'rejects a non-loopback caller with 401 when apiToken is configured and no bearer token is sent',
    async () => {
      process.env.JINI_API_TOKEN = 'integration-secret';
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], host: '0.0.0.0' });
      daemonsToStop.push(daemon);

      const port = Number(new URL(daemon.url).port);
      const res = await fetch(`http://${lanAddress}:${port}/api/ping`);
      expect(res.status).toBe(401);
    },
  );

  it('allows a same-origin-shaped GET request through the origin guard', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`, {
      headers: { Origin: daemon.url, Host: new URL(daemon.url).host },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a disallowed cross-origin POST with 403', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    const res = await fetch(`${daemon.url}/api/ping`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('honors JINI_ALLOWED_ORIGINS as an extra allow-listed cross-origin source', async () => {
    process.env.JINI_ALLOWED_ORIGINS = 'https://trusted.example.com';
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
    daemonsToStop.push(daemon);

    // POST (not GET) so the portless-loopback GET fallback can't coincidentally let this through
    // for an unrelated reason — a 403 here would mean the origin guard rejected it; the ping pack
    // has no POST handler, so a 404 (route dispatch proceeding past the guard, finding no match)
    // is the correct signal that JINI_ALLOWED_ORIGINS actually admitted this origin.
    const res = await fetch(`${daemon.url}/api/ping`, {
      method: 'POST',
      headers: { Origin: 'https://trusted.example.com' },
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  it('stop() closes the listener: a post-stop fetch rejects', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });

    await daemon.stop();
    await expect(fetch(`${daemon.url}/api/ping`)).rejects.toThrow();
  });

  it('stop() releases the sqlite file handle: reopening the same path afterward does not throw', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });

    await daemon.stop();

    const reopened = SqliteModule.createSqliteEventLog(join(dataDir, 'events.db'));
    await expect(reopened.append({ runId: 'probe', event: 'probe', data: {} })).resolves.toBeDefined();
    await reopened.close();
  });

  it("stop() actually calls the durable EventLog's close(), and is idempotent under concurrent + repeated calls", async () => {
    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return { ...real, close: vi.fn(real.close) };
      });
    try {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      // Gap 1's byte-journal (`journal.db`) is the second `createSqliteEventLog` call this
      // function makes — `stop()` must close it too, not just the main `events.db` log (a
      // resource leak fixed 2026-07-22; see create-local-node-daemon.ts's `stop()` doc).
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;
      expect(created).toBeDefined();
      expect(createdJournal).toBeDefined();

      await Promise.all([daemon.stop(), daemon.stop()]);
      await daemon.stop();

      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('runs the onShutdown hook during stop()', async () => {
    const dataDir = makeTempDataDir();
    let called = false;
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      onShutdown: () => {
        called = true;
      },
    });
    await daemon.stop();
    expect(called).toBe(true);
  });

  it('awaits an async onShutdown hook before stop() resolves', async () => {
    const dataDir = makeTempDataDir();
    let resolved = false;
    const daemon = await createLocalNodeDaemon({
      dataDir,
      packs: [makePingPack()],
      onShutdown: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
      },
    });
    await daemon.stop();
    expect(resolved).toBe(true);
  });

  it('still closes the EventLog (and propagates the error) when onShutdown rejects', async () => {
    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return { ...real, close: vi.fn(real.close) };
      });
    try {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({
        dataDir,
        packs: [makePingPack()],
        onShutdown: () => {
          throw new Error('onShutdown failed');
        },
      });
      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;

      await expect(daemon.stop()).rejects.toThrow('onShutdown failed');
      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('the POST /api/daemon/shutdown route triggers the same graceful stop(), reflected in isShuttingDown', async () => {
    const dataDir = makeTempDataDir();
    const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });

    const statusBefore = (await (await fetch(`${daemon.url}/api/daemon/status`)).json()) as DaemonStatusResponse;
    expect(statusBefore.shuttingDown).toBe(false);

    const shutdownRes = await fetch(`${daemon.url}/api/daemon/shutdown`, { method: 'POST' });
    expect(shutdownRes.status).toBe(200);
    expect(await shutdownRes.json()).toEqual({ ok: true, scheduled: true });

    // requestShutdown is deferred via setImmediate (daemon-status.ts's own documented ordering,
    // preserved here) — poll until the listener has actually closed.
    await vi.waitFor(
      async () => {
        await expect(fetch(`${daemon.url}/api/ping`)).rejects.toThrow();
      },
      { timeout: 2000 },
    );
  });

  it('rejects rather than hanging when a second instance boots on a port already in use (EADDRINUSE)', async () => {
    const dataDirA = makeTempDataDir();
    const daemonA = await createLocalNodeDaemon({ dataDir: dataDirA, packs: [makePingPack()] });
    daemonsToStop.push(daemonA);
    const fixedPort = Number(new URL(daemonA.url).port);

    const dataDirB = makeTempDataDir();
    await expect(
      createLocalNodeDaemon({ dataDir: dataDirB, packs: [makePingPack()], port: fixedPort }),
    ).rejects.toThrow();
  });

  it('closes the durable EventLog and propagates the error when rehydrate() fails on a corrupt/unreadable durable history', async () => {
    // Rehydration happens before the HTTP server exists at all, so it has
    // its own dedicated cleanup path (create-local-node-daemon.ts's own
    // comment) distinct from the later bind-failure `failToBind` path
    // exercised by the tests below. `listRunIds()` is rehydrate()'s very
    // first call into the EventLog, so failing it deterministically forces
    // that path without needing an actually-corrupt sqlite file on disk.
    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return {
          ...real,
          listRunIds: vi.fn(async () => {
            throw new Error('corrupt durable history');
          }),
          close: vi.fn(real.close),
        };
      });
    try {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({ dataDir, packs: [makePingPack()] })).rejects.toThrow('corrupt durable history');

      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      // The journal is constructed before `rehydrate()` runs, so it's already open and must be
      // closed on this failure path too.
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;
      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates a synchronous throw from app.listen() (e.g. an out-of-range port) as a rejection', async () => {
    const dataDir = makeTempDataDir();
    // http.Server#listen validates the port range synchronously and throws before ever emitting
    // 'error' — a real, deterministic way to exercise the `try { app.listen(...) } catch` branch
    // (as opposed to EADDRINUSE, which this Node/OS combination reports via the async 'error'
    // event instead, per the other rejection test below).
    await expect(
      createLocalNodeDaemon({ dataDir, packs: [makePingPack()], port: 70_000 }),
    ).rejects.toThrow(/port/i);
  });

  it('closes the durable EventLog it already opened when app.listen() throws synchronously', async () => {
    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return { ...real, close: vi.fn(real.close) };
      });
    try {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({ dataDir, packs: [makePingPack()], port: 70_000 })).rejects.toThrow();

      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;
      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects when server.address() somehow resolves to null right as 'listening' fires", async () => {
    // Belt-and-braces branch ported verbatim from the origin daemon (see this module's own
    // comment) — genuinely unreachable via any real bind, since a listening TCP server always has
    // a resolvable AddressInfo. `resolveBoundPort` itself already has full branch coverage in
    // isolation above; this only proves the (trivial, two-line) call site actually routes through
    // it. Spying on the shared `net.Server.prototype.address` (which `http.Server` inherits) is
    // the only way to reach this without faking the entire Express surface.
    const addressSpy = vi.spyOn(net.Server.prototype, 'address').mockReturnValue(null);
    try {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({ dataDir, packs: [makePingPack()] })).rejects.toThrow(
        /failed to resolve listening port/,
      );
    } finally {
      addressSpy.mockRestore();
    }
  });

  it('closes the durable EventLog it already opened when the resolved address is unusable', async () => {
    const addressSpy = vi.spyOn(net.Server.prototype, 'address').mockReturnValue(null);
    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return { ...real, close: vi.fn(real.close) };
      });
    try {
      const dataDir = makeTempDataDir();
      await expect(createLocalNodeDaemon({ dataDir, packs: [makePingPack()] })).rejects.toThrow();

      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;
      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      addressSpy.mockRestore();
    }
  });

  it('closes the durable EventLog it already opened when the port bind itself fails', async () => {
    const dataDirA = makeTempDataDir();
    const daemonA = await createLocalNodeDaemon({ dataDir: dataDirA, packs: [makePingPack()] });
    daemonsToStop.push(daemonA);
    const fixedPort = Number(new URL(daemonA.url).port);

    const original = SqliteModule.createSqliteEventLog;
    const spy = vi
      .spyOn(SqliteModule, 'createSqliteEventLog')
      .mockImplementation((...args: Parameters<typeof original>) => {
        const real = original(...args);
        return { ...real, close: vi.fn(real.close) };
      });
    try {
      const dataDirB = makeTempDataDir();
      await expect(
        createLocalNodeDaemon({ dataDir: dataDirB, packs: [makePingPack()], port: fixedPort }),
      ).rejects.toThrow();

      const created = spy.mock.results[0]?.value as ReturnType<typeof original>;
      const createdJournal = spy.mock.results[1]?.value as ReturnType<typeof original>;
      expect(created.close).toHaveBeenCalledTimes(1);
      expect(createdJournal.close).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  describe('local daemon-registry discovery record', () => {
    it('writes <dataDir>/daemon.json by default once listening, matching the real bound url/host/port/pid', async () => {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
      daemonsToStop.push(daemon);

      const registryPath = resolveDaemonRegistryPath(dataDir);
      const record = await readLiveDaemonRegistryRecord(registryPath);
      expect(record).toEqual({
        url: daemon.url,
        host: '127.0.0.1',
        port: Number(new URL(daemon.url).port),
        pid: process.pid,
        startedAt: expect.any(String),
      });
    });

    it('the record is written (and readable) before createLocalNodeDaemon resolves — no race for an immediate CLI discovery read', async () => {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
      daemonsToStop.push(daemon);

      // No `await` / retry / `vi.waitFor` here on purpose: the whole point of writing the record
      // before resolving `createLocalNodeDaemon`'s own promise is that it's already there by now.
      const record = await readLiveDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir));
      expect(record?.url).toBe(daemon.url);
    });

    it("stop() removes the discovery record — a caller that finished shouldn't be discoverable anymore", async () => {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });
      const registryPath = resolveDaemonRegistryPath(dataDir);
      expect(existsSync(registryPath)).toBe(true);

      await daemon.stop();

      expect(existsSync(registryPath)).toBe(false);
    });

    it('honors a custom discoveryFile path instead of the dataDir-derived default', async () => {
      const dataDir = makeTempDataDir();
      const customDir = makeTempDataDir();
      const customPath = join(customDir, 'custom-daemon-record.json');
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], discoveryFile: customPath });
      daemonsToStop.push(daemon);

      expect(existsSync(resolveDaemonRegistryPath(dataDir))).toBe(false);
      const record = await readLiveDaemonRegistryRecord(customPath);
      expect(record?.url).toBe(daemon.url);
    });

    it('discoveryFile: false disables writing a discovery record entirely', async () => {
      const dataDir = makeTempDataDir();
      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], discoveryFile: false });
      daemonsToStop.push(daemon);

      expect(existsSync(resolveDaemonRegistryPath(dataDir))).toBe(false);
    });

    it('two daemons on one machine (two different dataDirs) each get their own, non-colliding discovery record — the multi-daemon-per-machine case', async () => {
      const dataDirA = makeTempDataDir();
      const dataDirB = makeTempDataDir();
      const daemonA = await createLocalNodeDaemon({ dataDir: dataDirA, packs: [makePingPack()] });
      daemonsToStop.push(daemonA);
      const daemonB = await createLocalNodeDaemon({ dataDir: dataDirB, packs: [makePingPack()] });
      daemonsToStop.push(daemonB);

      const recordA = await readLiveDaemonRegistryRecord(resolveDaemonRegistryPath(dataDirA));
      const recordB = await readLiveDaemonRegistryRecord(resolveDaemonRegistryPath(dataDirB));
      expect(recordA?.url).toBe(daemonA.url);
      expect(recordB?.url).toBe(daemonB.url);
      expect(recordA?.url).not.toBe(recordB?.url);
    });

    it('a discovery-record write failure (e.g. an unwritable dataDir) does not fail daemon boot — best-effort by design', async () => {
      const dataDir = makeTempDataDir();
      // `writeJsonFile`'s `mkdir(dirname(filePath), { recursive: true })` throws ENOTDIR when an
      // ancestor path segment is a regular file rather than a directory — a deterministic,
      // privilege-independent way to force the write to fail (unlike a chmod-based permission
      // test, which does not actually deny access when tests run as root).
      const blockerFile = join(dataDir, 'blocker');
      writeFileSync(blockerFile, 'not a directory');
      const discoveryFile = join(blockerFile, 'daemon.json');

      const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()], discoveryFile });
      daemonsToStop.push(daemon);

      expect(existsSync(discoveryFile)).toBe(false);
      const res = await fetch(`${daemon.url}/api/ping`);
      expect(res.status).toBe(200);
    });

    it('a discovery-record removal failure during stop() does not fail shutdown — best-effort by design', async () => {
      const removeSpy = vi.spyOn(SidecarModule, 'removeDaemonRegistryRecordIfCurrent').mockRejectedValue(new Error('boom'));
      try {
        const dataDir = makeTempDataDir();
        const daemon = await createLocalNodeDaemon({ dataDir, packs: [makePingPack()] });

        await expect(daemon.stop()).resolves.toBeUndefined();
        expect(removeSpy).toHaveBeenCalledWith(resolveDaemonRegistryPath(dataDir), process.pid);
      } finally {
        removeSpy.mockRestore();
      }
    });
  });
});
