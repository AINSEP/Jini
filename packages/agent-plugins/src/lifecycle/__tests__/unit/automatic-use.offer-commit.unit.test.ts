import { describe, it, expect, vi } from 'vitest';
import type { AgentPluginGuidanceAttempt } from '@jini-ai/core/contracts/site/daemon';
import { createAutomaticAgentPluginUse, type AutomaticAgentPluginPorts } from '../../automatic-use.js';
import type { AgentPluginSearchCandidate } from '../../search.js';

const plugin = (pluginId: string, enabled = true): AgentPluginSearchCandidate => ({ pluginId, enabled, keywords: ['synthetic'], provides: ['theme-authoring'], skills: [], mcpServerIds: [] });
const scope: AgentPluginGuidanceAttempt = { runId: 'run-1', attempt: 1, principalId: 'principal-1' };
const REPLAY_REFUSAL = 'This guidance choice was already recorded for this turn.';

function fixture(ids: readonly string[] = ['alpha', 'beta']) {
  const publish = vi.fn<AutomaticAgentPluginPorts['publish']>(async () => undefined);
  const resolve = vi.fn<AutomaticAgentPluginPorts['resolve']>(async ({ pluginId }) => ({ ok: true, promptPrefix: `Guidance for ${pluginId}` }));
  const list = vi.fn(async () => [...ids.map(id => plugin(id)), plugin('inactive', false)]);
  const ports: AutomaticAgentPluginPorts = { list, resolve, publish,
    formatPluginToolPointer: input => `host_read_plugin(${JSON.stringify(input)})`,
    rank: ({ candidates, query }) => candidates.filter(candidate => candidate.enabled || query.includes(candidate.pluginId)).map(candidate => ({ ...candidate, score: 4 })),
    ask: vi.fn().mockResolvedValue({ action: 'use', selected: [] }), saveAuto: vi.fn() };
  const isAttemptLive = vi.fn(async (_required: AgentPluginGuidanceAttempt, _optional?: { signal?: AbortSignal }) => true);
  const controller = createAutomaticAgentPluginUse({ mode: 'auto', ports });
  const offer = (required: { scope?: AgentPluginGuidanceAttempt; offerId?: string } = {}) =>
    controller.offer({ scope: required.scope ?? scope, offerId: required.offerId ?? 'offer-1', input: { query: 'synthetic request' }, isAttemptLive });
  return { controller, offer, publish, resolve, list, ports, isAttemptLive };
}

describe('automatic guidance offer and commit', () => {
  it('offer records nothing', async () => {
    const f = fixture();
    const offered = await f.offer();
    expect(offered.offerId).toBe('offer-1');
    expect(offered.fullSections).toEqual([{ pluginId: 'alpha', text: 'Guidance for alpha' }, { pluginId: 'beta', text: 'Guidance for beta' }]);
    const legacy = fixture();
    expect(offered.fullPrefix, 'the full variant is byte-compatible with one-shot preparation').toBe(await legacy.controller.prepare({ query: 'synthetic request' }));
    expect(offered.catalogPrefix).not.toContain('Guidance for');
    expect(offered.catalogPrefix).toContain('- alpha (alpha): Provides theme-authoring\n  Use for: synthetic\n  Load: host_read_plugin({"pluginId":"alpha","file":"SKILL.md"})');
    expect(offered.catalogPrefix).toContain('- beta (beta)');
    expect(f.controller.guidanceIds({})).toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
    const resolves = f.resolve.mock.calls.length;
    expect(await f.offer(), 'a repeated offer for the same live attempt reuses its draft').toEqual(offered);
    expect(f.resolve).toHaveBeenCalledTimes(resolves);
    expect(f.controller.guidanceIds({})).toEqual([]);
  });

  it('commit records only the ids passed', async () => {
    const f = fixture();
    await f.offer();
    expect(await f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] })).toEqual({ guidanceIds: ['alpha'] });
    expect(f.controller.guidanceIds({})).toEqual(['alpha']);
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls[0]?.[0].plugins).toEqual([{ id: 'alpha', name: 'alpha' }]);
    expect(f.publish.mock.calls[0]?.[0].state.decision?.delivered).toEqual(['alpha']);
  });

  it('a deferred id never appears in guidanceIds until committed', async () => {
    const f = fixture();
    const offered = await f.offer();
    expect(offered.fullSections.map(section => section.pluginId)).toContain('beta');
    expect(f.controller.guidanceIds({})).not.toContain('beta');
    const empty = fixture();
    await empty.offer();
    expect(await empty.controller.commit({ scope, offerId: 'offer-1', deliveredIds: [] }), 'an empty commit is valid').toEqual({ guidanceIds: [] });
    await f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] });
    expect(f.controller.guidanceIds({})).not.toContain('beta');
    expect(f.publish.mock.calls.flatMap(call => call[0].plugins.map(entry => entry.id))).not.toContain('beta');
  });

  it('legacy prepare behaviour is unchanged', async () => {
    const sized = fixture();
    expect(await sized.controller.prepare({ query: 'synthetic request', maxPromptArgBytes: 100_000 }), 'a sized launch keeps only the catalog').not.toContain('Guidance for');
    expect(sized.resolve).not.toHaveBeenCalled();
    expect(sized.controller.guidanceIds({})).toEqual([]);
    const f = fixture();
    expect(await f.controller.prepare({ query: 'synthetic request' })).toBe('Guidance for alpha\n\nGuidance for beta');
    expect(f.controller.guidanceIds({}), 'one-shot preparation records every resolved section immediately').toEqual(['alpha', 'beta']);
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls[0]?.[0].plugins).toEqual([{ id: 'alpha', name: 'alpha' }, { id: 'beta', name: 'beta' }]);
    expect(f.isAttemptLive).not.toHaveBeenCalled();
  });

  it('an unoffered id refuses without recording delivery', async () => {
    const f = fixture(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
    const offered = await f.offer();
    expect(offered.fullSections.map(section => section.pluginId)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['epsilon'] })).rejects.toThrow();
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha', 'alpha'] })).rejects.toThrow();
    expect(f.controller.guidanceIds({})).toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('stale or foreign attempts refuse without recording delivery', async () => {
    const f = fixture();
    await f.offer();
    for (const foreign of [{ ...scope, attempt: 2 }, { ...scope, principalId: 'principal-2' }, { ...scope, runId: 'run-2' }]) {
      await expect(f.controller.commit({ scope: foreign, offerId: 'offer-1', deliveredIds: ['alpha'] })).rejects.toThrow();
    }
    await expect(f.controller.commit({ scope, offerId: 'offer-2', deliveredIds: ['alpha'] })).rejects.toThrow();
    const aborted = new AbortController();
    aborted.abort();
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] }, { signal: aborted.signal })).rejects.toThrow();
    f.isAttemptLive.mockResolvedValue(false);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] })).rejects.toThrow();
    expect(f.isAttemptLive).toHaveBeenLastCalledWith(scope, {});
    expect(f.controller.guidanceIds({})).toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('the same commit publishes once and a changed replay is refused', async () => {
    const f = fixture();
    await f.offer();
    const first = await f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] });
    const fenceChecks = f.isAttemptLive.mock.calls.length;
    expect(await f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] })).toEqual(first);
    expect(f.isAttemptLive, 'a replay still passes the live-attempt fence').toHaveBeenCalledTimes(fenceChecks + 1);
    expect(f.publish).toHaveBeenCalledTimes(1);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha', 'beta'] })).rejects.toThrow(REPLAY_REFUSAL);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: [] })).rejects.toThrow(REPLAY_REFUSAL);
    f.isAttemptLive.mockResolvedValue(false);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] })).rejects.toThrow();
    expect(f.controller.guidanceIds({})).toEqual(['alpha']);
    expect(f.publish).toHaveBeenCalledTimes(1);
  });

  it('a plugin switched off after offer is not committed', async () => {
    const f = fixture();
    await f.offer();
    f.list.mockResolvedValue([plugin('alpha', false), plugin('beta')]);
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['beta', 'alpha'] })).rejects.toThrow();
    expect(f.controller.guidanceIds({}), 'a refusal records no part of the choice').toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('a replaced attempt cannot revive its offer', async () => {
    const f = fixture();
    const newer = { ...scope, attempt: 2 };
    await f.offer();
    await f.offer({ scope: newer, offerId: 'offer-2' });
    await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] })).rejects.toThrow();
    await expect(f.offer()).rejects.toThrow();
    expect(f.controller.guidanceIds({})).toEqual([]);
    expect(await f.controller.commit({ scope: newer, offerId: 'offer-2', deliveredIds: ['alpha'] })).toEqual({ guidanceIds: ['alpha'] });
  });
});

it('aborting during the authoritative liveness check never records delivery', async () => {
  const f = fixture();
  const controller = new AbortController();
  await f.offer();
  f.isAttemptLive.mockClear();
  f.isAttemptLive.mockImplementationOnce(async () => {
    controller.abort();
    return true;
  });
  await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha'] }, { signal: controller.signal }))
    .rejects.toThrow('Recording this guidance choice was cancelled.');
  expect(f.isAttemptLive.mock.calls).toEqual([[scope, { signal: controller.signal }]]);
  expect(f.controller.guidanceIds({})).toEqual([]);
  expect(f.publish.mock.calls).toEqual([]);
});

it('a committed offer ID cannot be replaced even for the same live attempt', async () => {
  const f = fixture();
  await f.offer();
  await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['beta', 'alpha'] }))
    .resolves.toEqual({ guidanceIds: ['beta', 'alpha'] });
  await expect(f.offer({ offerId: 'replacement' })).rejects.toThrow('This guidance offer is no longer current for this turn.');
  await expect(f.controller.commit({ scope, offerId: 'offer-1', deliveredIds: ['alpha', 'beta'] }))
    .resolves.toEqual({ guidanceIds: ['beta', 'alpha'] });
  expect(f.publish).toHaveBeenCalledTimes(1);
});
