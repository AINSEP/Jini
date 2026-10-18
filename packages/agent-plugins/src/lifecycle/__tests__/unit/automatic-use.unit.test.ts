import { describe, it, expect, vi } from 'vitest';
import { createAutomaticAgentPluginUse, type AutomaticAgentPluginPorts, type ChatAgentPluginState } from '../../automatic-use.js';
import type { AgentPluginSearchCandidate } from '../../search.js';

const plugin = (pluginId: string, enabled = true): AgentPluginSearchCandidate => ({ pluginId, enabled, keywords: ['synthetic'], provides: ['theme-authoring'], skills: [], mcpServerIds: [] });
function fixture(mode: 'auto' | 'ask' | 'off' = 'auto', state?: ChatAgentPluginState) {
  const publish = vi.fn();
  const ask = vi.fn().mockResolvedValue({ action: 'use', selected: ['synthetic'] });
  const resolve = vi.fn(async ({ pluginId }: { pluginId: string }) => `Guidance for ${pluginId}`);
  const saveAuto = vi.fn();
  const list = vi.fn(async () => [plugin('synthetic'), plugin('inactive', false)]);
  const ports: AutomaticAgentPluginPorts = { list,
    rank: ({ candidates }) => candidates.map(candidate => ({ ...candidate, score: 4 })), resolve, ask, saveAuto, publish };
  return { controller: createAutomaticAgentPluginUse({ mode, state, ports }), publish, ask, resolve, saveAuto, ports, list };
}
describe('automatic installed plugin use', () => {
  it('Auto resolves active metadata matches and publishes usage only after delivery', async () => {
    const f = fixture();
    expect(await f.controller.prepare({ query: 'synthetic' })).toContain('Guidance for synthetic');
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([{ id: 'synthetic', name: 'synthetic' }]);
  });
  it('exclusions win in both preflight and the first authoring tool backstop', async () => {
    const f = fixture('auto', { decision: null, excluded: ['synthetic'] });
    expect(await f.controller.prepare({ query: 'synthetic' })).toBe('');
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each(['use', 'skip', 'auto'] as const)('asks once and applies %s', async action => {
    const f = fixture('ask');
    f.ask.mockResolvedValue({ action, selected: ['synthetic'] });
    const guidance = await f.controller.prepare({ query: 'synthetic' });
    expect(guidance).toBe(action === 'skip' ? '' : 'Guidance for synthetic');
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.saveAuto).toHaveBeenCalledTimes(action === 'auto' ? 1 : 0);
    const again = fixture('ask', f.publish.mock.calls.at(-1)?.[0].state);
    await again.controller.prepare({ query: 'synthetic' });
    expect(again.ask).not.toHaveBeenCalled();
  });
  it('empty matches do not consume the question; unchecked plugins stay excluded', async () => {
    const f = fixture('ask');
    expect(await f.controller.prepare({ capabilities: ['unmatched'] })).toBe('');
    expect(f.ask).not.toHaveBeenCalled();
    f.ask.mockResolvedValue({ action: 'use', selected: [] });
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
    expect(f.publish.mock.calls.at(-1)?.[0].state.excluded).toContain('synthetic');
  });
  it('Off does no discovery, asking or resolving', async () => {
    const f = fixture('off');
    expect(await f.controller.prepare({ query: 'synthetic' })).toBe('');
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });
  it('the first theme write attaches guidance once without a preceding prompt match', async () => {
    const f = fixture();
    expect(await f.controller.prepare({ capabilities: ['theme-authoring', 'ui-design'] })).toContain('Guidance for synthetic');
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  });
  it('serializes simultaneous backstops and tolerates unavailable guidance', async () => {
    const f = fixture('ask');
    f.resolve.mockRejectedValue(new Error('unreadable'));
    expect(await Promise.all([f.controller.prepare({ query: 'synthetic' }), f.controller.prepare({ capabilities: ['theme-authoring'] })])).toEqual(['', '']);
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([]);
  });
});

it('Auto does not reload prior selections on an unrelated turn; the write backstop still loads them', async () => {
  const next = fixture('auto', { decision: { selected: ['synthetic'], asked: false }, excluded: [] });
  expect(await next.controller.prepare({ capabilities: ['unrelated'] })).toBe('');
  expect(next.resolve).not.toHaveBeenCalled();
  expect(await next.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for synthetic');
});

it('publication failure still returns resolved guidance and does not duplicate it at the backstop', async () => {
  const f = fixture();
  f.publish.mockRejectedValue(new Error('event store unavailable'));
  expect(await f.controller.prepare({ query: 'synthetic' })).toBe('Guidance for synthetic');
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  expect(f.resolve).toHaveBeenCalledTimes(1);
});

it('Do not ask again uses only checked matches, excludes unchecked ones and immediately enables future Auto matches', async () => {
  const f = fixture('ask');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked')];
  f.ask.mockResolvedValue({ action: 'auto', selected: ['synthetic'] });
  expect(await f.controller.prepare({ query: 'synthetic' })).toBe('Guidance for synthetic');
  expect(f.publish.mock.calls.at(-1)?.[0].state.excluded).toContain('unchecked');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for later');
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('Use never implicitly approves later matching plugins in Ask mode', async () => {
  const f = fixture('ask');
  await f.controller.prepare({ query: 'synthetic' });
  f.ports.list = async () => [plugin('synthetic'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.ask).toHaveBeenCalledTimes(1);
});
