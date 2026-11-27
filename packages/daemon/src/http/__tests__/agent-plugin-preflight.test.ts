import { describe, expect, it, vi } from 'vitest';
import { mountJsonRoute } from '@jini-ai/http-kit';
import { ok } from '@jini-ai/core/contracts/server';
import { createTestRouteHost } from '@jini-ai/core/contracts/server/testing';
import type { AgentPluginGuidanceOffer } from '@jini-ai/core/contracts/site/daemon';
import { agentPluginPreflightRoute, type AgentPluginPreflightRouteDeps } from '../agent-plugin-preflight.js';
import * as httpEntry from '../index.js';

const OFFER: AgentPluginGuidanceOffer = { offerId: 'offer-1', fullSections: [{ pluginId: 'p-a', text: 'A' }], fullPrefix: 'FULL', catalogPrefix: 'CAT' };

function makeDeps() {
  const prepare = vi.fn<AgentPluginPreflightRouteDeps['prepare']>(async ({ mode }) => ok({ value: mode === 'offer'
    ? { prefix: 'PINNED', refusalPrefix: 'REFUSE', pluginIds: ['p-pin'], offer: OFFER }
    : { prefix: 'LEGACY', refusalPrefix: 'REFUSE', pluginIds: ['p-pin', 'p-a'], offer: OFFER } }));
  const commit = vi.fn<AgentPluginPreflightRouteDeps['commit']>(async () => ok({ value: { pluginIds: ['p-a'] } }));
  return { prepare, commit, deps: { prepare, commit } satisfies AgentPluginPreflightRouteDeps };
}

/** Mounts the spec on a recording app double and posts one body through the real http-kit adapter. */
async function post(deps: AgentPluginPreflightRouteDeps, body: unknown) {
  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const app = { post: vi.fn((_path: string, h: typeof handler) => { handler = h; }) };
  mountJsonRoute({ app: app as never, spec: agentPluginPreflightRoute, deps, adapter: createTestRouteHost() });
  expect(app.post).toHaveBeenCalledWith('/internal/agent-plugin-preflight', expect.any(Function));
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), headersSent: false, once: vi.fn(), off: vi.fn(), on: vi.fn() };
  await handler?.({ body, params: {}, query: {}, headers: {}, get: () => undefined }, res);
  return { status: res.status.mock.calls[0]?.[0] as number | undefined, json: res.json.mock.calls[0]?.[0] as unknown };
}

describe('agent plugin preflight route', () => {
  it('plugin preflight preserves the legacy wire shape and dispatches offer and commit separately', async () => {
    expect(httpEntry.agentPluginPreflightRoute).toBe(agentPluginPreflightRoute);
    const { prepare, commit, deps } = makeDeps();

    const legacy = await post(deps, { runId: 'run-1' });
    expect(legacy).toEqual({ status: 200, json: { prefix: 'LEGACY', refusalPrefix: 'REFUSE', pluginIds: ['p-pin', 'p-a'] } });
    expect(prepare).toHaveBeenLastCalledWith({ runId: 'run-1', mode: 'legacy' }, { signal: expect.any(AbortSignal) });

    const offered = await post(deps, { op: 'offer', runId: 'run-1' });
    expect(offered).toEqual({ status: 200, json: { prefix: 'PINNED', refusalPrefix: 'REFUSE', pluginIds: ['p-pin'], offer: OFFER } });
    expect(prepare).toHaveBeenLastCalledWith({ runId: 'run-1', mode: 'offer' }, { signal: expect.any(AbortSignal) });
    expect(commit).not.toHaveBeenCalled();

    const committed = await post(deps, { op: 'commit', runId: 'run-1', offerId: 'offer-1', deliveredIds: ['p-a'] });
    expect(committed).toEqual({ status: 200, json: { pluginIds: ['p-a'] } });
    expect(commit).toHaveBeenCalledWith({ runId: 'run-1', offerId: 'offer-1', deliveredIds: ['p-a'] }, { signal: expect.any(AbortSignal) });
    expect(prepare).toHaveBeenCalledTimes(2);

    prepare.mockResolvedValueOnce(ok({ value: { prefix: 'P', refusalPrefix: 'R', pluginIds: [] } }));
    expect((await post(deps, { op: 'offer', runId: 'run-1' })).json).toEqual({ prefix: 'P', refusalPrefix: 'R', pluginIds: [], offer: null });
  });

  it('plugin preflight rejects callers trying to supply identity or duplicate ids', async () => {
    const { prepare, commit, deps } = makeDeps();
    const rejected = [
      { runId: 'run-1', principalId: 'someone-else' },
      { op: 'offer', runId: 'run-1', attempt: 3 },
      { op: 'commit', runId: 'run-1', offerId: 'offer-1', deliveredIds: ['p-a'], workspaceId: 'ws-2' },
      { op: 'commit', runId: 'run-1', offerId: 'offer-1', deliveredIds: ['p-a', 'p-a'] },
      { op: 'commit', runId: 'run-1', offerId: 'offer-1', deliveredIds: ['bad id!'] },
      { op: 'commit', runId: 'run-1', deliveredIds: [] },
      { op: 'offer', runId: '../escape' },
      { op: 'unknown', runId: 'run-1' },
      { runId: 42 },
      'run-1',
      null,
    ];
    for (const body of rejected) {
      const res = await post(deps, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json, JSON.stringify(body)).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

it('forwards host refusals without inventing an offer or acknowledging a declined commit', async () => {
  const { prepare, commit, deps } = makeDeps();
  prepare.mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: 'No live run for this principal.' } });
  commit.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'The offer was replaced.' } });
  expect(await post(deps, { op: 'offer', runId: 'run-1' })).toEqual({
    status: 403, json: { error: { code: 'FORBIDDEN', message: 'No live run for this principal.' } },
  });
  expect(await post(deps, { op: 'commit', runId: 'run-1', offerId: 'offer-old', deliveredIds: [] })).toEqual({
    status: 409, json: { error: { code: 'CONFLICT', message: 'The offer was replaced.' } },
  });
  expect(prepare.mock.calls).toEqual([[{ runId: 'run-1', mode: 'offer' }, { signal: expect.any(AbortSignal) }]]);
  expect(commit.mock.calls).toEqual([[{ runId: 'run-1', offerId: 'offer-old', deliveredIds: [] }, { signal: expect.any(AbortSignal) }]]);
});
