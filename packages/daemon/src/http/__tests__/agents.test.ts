import { describe, expect, it, vi } from 'vitest';
import { createInMemoryServer, denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { describeRoutes } from '../route-table.js';
import {
  agentListRoute,
  agentRescanRoute,
  agentRoutes,
  type AgentsHttpDeps,
  type AgentSummary,
} from '../agents.js';

const AGENTS: readonly AgentSummary[] = [
  {
    id: 'claude',
    name: 'Claude',
    available: true,
    version: '2.1.201',
    authStatus: 'ok',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
    reasoningOptions: [{ id: 'default', label: 'Default' }],
    modelsSource: 'live',
  },
  { id: 'codex', name: 'Codex', available: false, models: [], modelsSource: 'fallback' },
];

function makeDeps(overrides: Partial<AgentsHttpDeps> = {}): AgentsHttpDeps {
  return { listAgents: () => AGENTS, ...overrides };
}

describe('agentListRoute.parse', () => {
  it('requires no input', () => {
    expect(agentListRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

describe('agentListRoute.handle', () => {
  it('wraps the injected listAgents() result as { agents }', async () => {
    const result = await agentListRoute.handle({ input: undefined, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { agents: AGENTS } });
  });

  it('reflects an empty registry as an empty array, not an error', async () => {
    const result = await agentListRoute.handle({ input: undefined, deps: makeDeps({ listAgents: () => [] }) });
    expect(result).toEqual({ ok: true, value: { agents: [] } });
  });

  it('calls listAgents fresh on every handle (not cached across calls)', async () => {
    const listAgents = vi.fn(() => AGENTS);
    const deps = makeDeps({ listAgents });
    await agentListRoute.handle({ input: undefined, deps });
    await agentListRoute.handle({ input: undefined, deps });
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it('awaits an asynchronous host-owned discovery result', async () => {
    const result = await agentListRoute.handle({
      input: undefined, deps: makeDeps({
        listAgents: async () => AGENTS,
      })
    });
    expect(result).toEqual({ ok: true, value: { agents: AGENTS } });
  });
});

describe('agentRescanRoute', () => {
  it('uses the explicit rescan dependency when supplied', async () => {
    const rescanAgents = vi.fn(async () => AGENTS);
    const listAgents = vi.fn(() => []);
    const result = await agentRescanRoute.handle({ input: undefined, deps: { listAgents, rescanAgents } });
    expect(result).toEqual({ ok: true, value: { agents: AGENTS } });
    expect(rescanAgents).toHaveBeenCalledOnce();
    expect(listAgents).not.toHaveBeenCalled();
  });

  it('falls back to listAgents for static hosts', async () => {
    const result = await agentRescanRoute.handle({ input: undefined, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { agents: AGENTS } });
  });
});

/** The two routes on an in-memory server (exact matching: the Express spellings are the host bridge's job). */
function serve(deps: AgentsHttpDeps, { denyOrigins = false }: { denyOrigins?: boolean } = {}) {
  const host = fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {});
  const { server, fetch } = createInMemoryServer();
  for (const route of agentRoutes({ deps, host })) server.route(route);
  return fetch;
}

describe('agentRoutes', () => {
  it('lists the inventory and rescan routes in order; only the rescan sits behind the same-origin gate', () => {
    expect(describeRoutes({ routes: agentRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'GET', path: '/api/agents', gates: [] },
      { method: 'POST', path: '/api/agents/rescan', gates: ['same-origin'] },
    ]);
  });

  it('serves the injected agent list end-to-end', async () => {
    const response = await serve(makeDeps())(new Request('http://local/api/agents'));
    expect([response.status, await response.json()]).toEqual([200, { agents: AGENTS }]);
  });

  it('does not require same-origin: allows a cross-origin read', async () => {
    const response = await serve(makeDeps(), { denyOrigins: true })(new Request('http://local/api/agents'));
    expect(response.status).toBe(200);
  });

  // The rescan route was previously only ever driven through its 403 path, so its own `parse` (and
  // therefore the mounted happy path a host actually calls) was never executed.
  it('triggers a real rescan and returns the refreshed inventory', async () => {
    const rescanAgents = vi.fn(async () => AGENTS);
    const response = await serve(makeDeps({ rescanAgents }))(new Request('http://local/api/agents/rescan', { method: 'POST' }));
    expect([rescanAgents.mock.calls.length, response.status, await response.json()]).toEqual([1, 200, { agents: AGENTS }]);
  });

  it('requires same-origin for a rescan', async () => {
    const response = await serve(makeDeps(), { denyOrigins: true })(new Request('http://local/api/agents/rescan', { method: 'POST' }));
    expect(response.status).toBe(403);
  });
});
