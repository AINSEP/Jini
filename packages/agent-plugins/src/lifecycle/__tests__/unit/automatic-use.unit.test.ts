import { describe, it, expect, vi } from 'vitest';
import { createAutomaticAgentPluginUse, readChatAgentPluginState, type AutomaticAgentPluginPorts, type ChatAgentPluginState } from '../../automatic-use.js';
import type { AgentPluginSearchCandidate } from '../../search.js';
import { rankInstalledAgentPlugins } from '../test-support.js';

const plugin = (pluginId: string, enabled = true): AgentPluginSearchCandidate => ({ pluginId, enabled, keywords: ['synthetic'], provides: ['theme-authoring'], skills: [], mcpServerIds: [] });
function fixture(mode: 'auto' | 'ask' | 'off' = 'auto', state?: ChatAgentPluginState) {
  const publish = vi.fn();
  const ask = vi.fn().mockResolvedValue({ action: 'use', selected: ['synthetic'] });
  const resolve = vi.fn(async ({ pluginId }: { pluginId: string }): ReturnType<AutomaticAgentPluginPorts['resolve']> => ({ ok: true, promptPrefix: `Guidance for ${pluginId}` }));
  const saveAuto = vi.fn();
  const list = vi.fn(async () => [plugin('synthetic'), plugin('inactive', false)]);
  const ports: AutomaticAgentPluginPorts = { list,
    formatPluginToolPointer: input => `host_read_plugin(${JSON.stringify(input)})`,
    rank: ({ candidates, query }) => candidates.filter(candidate => candidate.enabled || query.includes(candidate.pluginId)).map(candidate => ({ ...candidate, score: 4 })), resolve, ask, saveAuto, publish };
  return { controller: createAutomaticAgentPluginUse({ mode, state, ports }), publish, ask, resolve, saveAuto, ports, list };
}
describe('automatic installed plugin use', () => {
  it('explicitly reads off plugin guidance without activating or publishing it as in use', async () => {
    const f = fixture();
    const result = await f.controller.load({ pluginId: 'inactive', file: 'SKILL.md' });
    expect(result.status).toBe('installed-but-inactive');
    expect(result.guidance).toContain('Guidance for inactive');
    expect(result.guidance).toContain('off');
    expect(result.guidance).toContain('tools are unavailable');
    expect(f.resolve).toHaveBeenCalledWith({ pluginId: 'inactive', file: 'SKILL.md' }, {});
    expect(f.ask).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).not.toContain('Guidance for inactive');
  });
  it('off-plugin guidance still respects Ask consent and never publishes the plugin as in use', async () => {
    const f = fixture('ask');
    f.ask.mockResolvedValueOnce({ action: 'use', selected: ['inactive'] });
    const result = await f.controller.load({ pluginId: 'inactive' });
    expect(result.status).toBe('installed-but-inactive');
    expect(result.guidance).toContain('Guidance for inactive');
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([]);
    const denied = fixture('ask');
    denied.ask.mockResolvedValueOnce({ action: 'skip', selected: [] });
    expect(await denied.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'excluded', guidance: '' });
    expect(denied.resolve).not.toHaveBeenCalled();
  });
  it('suggests an off plugin without implicitly resolving or asking to use its guidance', async () => {
    const f = fixture();
    f.list.mockResolvedValue([{ ...plugin('inactive', false), summary: 'Create images', description: 'PRIVATE_GUIDANCE' }]);
    const note = await f.controller.prepare({ query: 'inactive' });
    expect(note).toContain('installed, off: inactive: Create images — read guidance; tools unavailable');
    expect(note).not.toContain('PRIVATE_GUIDANCE');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(await f.controller.load({ pluginId: 'inactive', file: 'SKILL.md' })).toEqual({ status: 'installed-but-inactive', guidance: "Plugin 'inactive' is off; its tools are unavailable.\n\nGuidance for inactive" });
    expect(f.ask).not.toHaveBeenCalled();
  });
  it.each([{ skill: 'synthetic' }, { file: 'missing.md' }])('retains the reader reason for explicit content requests %j', async request => {
    const f = fixture();
    const reason = 'File request refused. Valid supporting files: references/permissions.md.';
    f.resolve.mockResolvedValueOnce({ ok: false, reason });
    expect(await f.controller.load({ pluginId: 'synthetic', ...request })).toEqual({ status: 'unavailable', guidance: reason });
    expect(f.publish).not.toHaveBeenCalled();
    f.resolve.mockRejectedValueOnce(new Error('/private/host/path: read failed'));
    expect(await f.controller.load({ pluginId: 'synthetic', ...request })).toEqual({ status: 'unavailable', guidance: '' });
  });

  it('uses the host pointer for relevance and oversized automatic guidance', async () => {
    const f = fixture();
    const pointer = 'custom_host_read({"id":"synthetic"})';
    f.ports.formatPluginToolPointer = () => pointer;
    expect(await f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] })).toContain(pointer);
    f.resolve.mockResolvedValueOnce({ ok: true, promptPrefix: 'x'.repeat(8193) });
    const deferred = await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(deferred).toContain(pointer);
    expect(deferred).not.toContain('load_agent_plugin');
    expect(f.publish).not.toHaveBeenCalled();
  });
  it('omits load pointers when the host supplies no pointer formatter', async () => {
    const f = fixture();
    delete f.ports.formatPluginToolPointer;
    const note = await f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] });
    expect(note).toContain('synthetic');
    expect(note).not.toContain('Load one with');
    f.resolve.mockResolvedValueOnce({ ok: true, promptPrefix: 'x'.repeat(8193) });
    expect(await f.controller.prepare({ capabilities: ['theme-authoring'] }))
      .toBe("Agent Plugin 'synthetic' guidance is deferred because it exceeds the automatic byte limit.");
  });
  it('Auto delivers the primary once and publishes its use', async () => {
    const f = fixture();
    expect(await f.controller.prepare({ query: 'synthetic' })).toBe('Guidance for synthetic');
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([{ id: 'synthetic', name: 'synthetic' }]);
    expect(await f.controller.prepare({ query: 'synthetic' })).toBe('');
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
    if (action === 'skip') expect(guidance).toBe('');
    else expect(guidance).toBe('Guidance for synthetic');
    expect(f.resolve).toHaveBeenCalledTimes(action === 'skip' ? 0 : 1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual(action === 'skip' ? [] : [{ id: 'synthetic', name: 'synthetic' }]);
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.saveAuto).toHaveBeenCalledTimes(action === 'auto' ? 1 : 0);
    const again = fixture('ask', f.publish.mock.calls.at(-1)?.[0].state);
    await again.controller.prepare({ query: 'synthetic' });
    expect(again.ask).not.toHaveBeenCalled();
  });
  it.each(['prepare', 'load'] as const)('failed Auto persistence does not retain consent after %s', async entry => {
    const f = fixture('ask');
    f.ask.mockResolvedValueOnce({ action: 'auto', selected: ['synthetic'] });
    f.saveAuto.mockRejectedValueOnce(new Error('Personal mode changed'));
    const attempt = entry === 'prepare'
      ? f.controller.prepare({ capabilities: ['theme-authoring'] })
      : f.controller.load({ pluginId: 'synthetic' });
    await expect(attempt).rejects.toThrow('Personal mode changed');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
    f.ask.mockResolvedValueOnce({ action: 'skip', selected: [] });
    expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'excluded', guidance: '' });
    expect(f.ask).toHaveBeenCalledTimes(2);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.publish.mock.calls.at(-1)?.[0].state).toEqual({ decision: { selected: [], asked: true }, excluded: ['synthetic'] });
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([]);
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
    const [note, guidance] = await Promise.all([f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] }), f.controller.prepare({ capabilities: ['theme-authoring'] })]);
    expect(note).toContain('host_read_plugin');
    expect(guidance).toBe('');
    expect(f.ask).toHaveBeenCalledTimes(1);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([]);
  });
  it.each(['ask', 'auto'] as const)('%s remembers consent but loads only current prompt or capability matches', async mode => {
    const state: ChatAgentPluginState = { decision: { selected: ['synthetic'], asked: true }, excluded: [] };
    const next = fixture(mode, state);
    next.ports.rank = input => rankInstalledAgentPlugins(input.query, input.candidates, input.limit, true);
    expect(await next.controller.prepare({ query: 'What is the weather?' })).toBe('');
    expect(next.resolve).not.toHaveBeenCalled();
    expect(next.ask).not.toHaveBeenCalled();
    const onTopic = fixture(mode, state);
    onTopic.ports.rank = next.ports.rank;
    expect(await onTopic.controller.prepare({ query: 'Use synthetic' })).toContain('Guidance for synthetic');
    expect(onTopic.resolve).toHaveBeenCalledTimes(1);
    expect(await onTopic.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
    expect(onTopic.ask).not.toHaveBeenCalled();

    const backstop = fixture(mode, state);
    backstop.ports.rank = next.ports.rank;
    expect(await backstop.controller.prepare({ query: 'What is the weather?' })).toBe('');
    expect(await backstop.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for synthetic');
    expect(backstop.ask).not.toHaveBeenCalled();

    const excluded = fixture(mode, { ...state, excluded: ['synthetic'] });
    expect(await excluded.controller.prepare({ query: 'Use synthetic' })).toBe('');
    expect(await excluded.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
    expect(excluded.resolve).not.toHaveBeenCalled();
  });
  it('publishes once per loaded set, including across simultaneous guarded writes', async () => {
    const f = fixture();
    await f.controller.prepare({ query: 'synthetic' });
    await Promise.all([
      f.controller.prepare({ capabilities: ['theme-authoring'] }),
      f.controller.prepare({ capabilities: ['theme-authoring'] }),
    ]);
    expect(f.publish).toHaveBeenCalledTimes(1);
    f.ports.list = async () => [plugin('synthetic'), plugin('later')];
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(f.publish).toHaveBeenCalledTimes(2);
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([
      { id: 'synthetic', name: 'synthetic' }, { id: 'later', name: 'later' },
    ]);
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it('persists a late Skip once even when earlier discovery and later writes load nothing', async () => {
    const f = fixture('ask');
    await f.controller.prepare({ capabilities: ['unmatched'] });
    f.ask.mockResolvedValue({ action: 'skip', selected: [] });
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    await f.controller.prepare({ capabilities: ['theme-authoring'] });
    expect(f.publish).toHaveBeenCalledTimes(1);
    const state = f.publish.mock.calls[0]?.[0].state;
    expect(state.decision).toEqual({ selected: [], asked: true });
    const next = fixture('ask', state);
    await next.controller.prepare({ query: 'synthetic' });
    expect(next.ask).not.toHaveBeenCalled();
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
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  expect(f.resolve).toHaveBeenCalledTimes(2);
});

it('Do not ask again uses only checked matches, excludes unchecked ones and immediately enables future Auto matches', async () => {
  const f = fixture('ask');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked')];
  f.ask.mockResolvedValue({ action: 'auto', selected: ['synthetic'] });
  expect(await f.controller.prepare({ query: 'synthetic' })).toBe('Guidance for synthetic');
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(f.publish.mock.calls.at(-1)?.[0].state.excluded).toContain('unchecked');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for later');
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('Use never implicitly approves later matching plugins in Ask mode', async () => {
  const f = fixture('ask');
  expect(await f.controller.prepare({ query: 'synthetic' })).toBe('Guidance for synthetic');
  f.ports.list = async () => [plugin('synthetic'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  expect(f.resolve.mock.calls.map(([input]) => input.pluginId)).toEqual(['synthetic']);
  expect(await f.controller.load({ pluginId: 'later' })).toEqual({ status: 'excluded', guidance: '' });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('5 genuinely relevant plugins all load: no per-chat plugin count', async () => {
  const f = fixture();
  f.ports.list = async () => Array.from({ length: 5 }, (_, index) => plugin(`match-${index}`));
  await f.controller.prepare({ query: 'synthetic' });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 5; index++) await f.controller.load({ pluginId: `match-${index}` });
  expect(f.resolve.mock.calls.map(([input]) => input.pluginId)).toEqual(['match-0', 'match-0', 'match-1', 'match-2', 'match-3', 'match-4']);
});

it('lists every short relevant match with its metadata reason when the note fits', async () => {
  const f = fixture();
  f.ports.list = async () => ['first', 'second', 'third'].map(id => ({ ...plugin(id), displayName: id.toUpperCase(), summary: `Why ${id}` }));
  const note = await f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] });
  for (const id of ['first', 'second', 'third']) expect(note).toContain(`${id.toUpperCase()} (${id}) — Why ${id}`);
  expect(note).not.toContain('more relevant');
  expect(f.resolve).not.toHaveBeenCalled();
});

it('50 relevant plugins stay within the note budget, bulk-load nothing, and all remain usable', async () => {
  const f = fixture();
  const plugins = Array.from({ length: 50 }, (_, index) => ({ ...plugin(`match-${index}`), summary: `Guidance topic ${index}` }));
  f.ports.list = async () => plugins;
  f.ports.rank = input => rankInstalledAgentPlugins(input.query, input.candidates, input.limit, true);
  const note = await f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] });
  expect(new TextEncoder().encode(note).length).toBeLessThanOrEqual(600);
  expect(note).toContain('match-0');
  const shown = plugins.filter(p => note.includes(`(${p.pluginId})`)).length;
  expect(shown).toBeGreaterThan(0);
  expect(note).toContain(`+${50 - shown} more relevant: search_agent_plugin_local({ query: <same request>, offset: 0 }); page with nextOffset`);
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
  // The presentation budget must not become an admission limit, even for an omitted plugin.
  for (const p of plugins.toReversed()) expect(await f.controller.load({ pluginId: p.pluginId })).toEqual({ status: 'loaded', guidance: `Guidance for ${p.pluginId}` });
  expect(f.resolve).toHaveBeenCalledTimes(50);
  expect(f.publish.mock.calls.at(-1)?.[0].plugins).toHaveLength(50);
});

it('a guarded capability loads only its providers after a note, never other relevant plugins', async () => {
  const f = fixture();
  f.ports.list = async () => [plugin('tovu-theme'), { ...plugin('other-topic'), provides: ['other'] }];
  await f.controller.prepare({ query: 'synthetic', loaded: ['pinned'] });
  expect(f.resolve).not.toHaveBeenCalled();
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for tovu-theme');
  expect(f.resolve.mock.calls.map(([input]) => input.pluginId)).toEqual(['tovu-theme']);
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
});

it('explicit loads respect exclusions, inactive plugins, unknown ids, Off and cancellation', async () => {
  const excluded = fixture('auto', { decision: null, excluded: ['synthetic'] });
  expect(await excluded.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'excluded', guidance: '' });
  expect(excluded.resolve).not.toHaveBeenCalled();
  const f = fixture();
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'installed-but-inactive', guidance: "Plugin 'inactive' is off; its tools are unavailable.\n\nGuidance for inactive" });
  expect(await f.controller.load({ pluginId: 'unknown' })).toEqual({ status: 'missing', guidance: '' });
  expect(await f.controller.load({ pluginId: 'synthetic', signal: AbortSignal.abort() })).toEqual({ status: 'cancelled', guidance: '' });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.resolve.mock.calls[0]?.[0].pluginId).toBe('inactive');
  const off = fixture('off');
  expect(await off.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'off', guidance: '' });
  expect(off.list).not.toHaveBeenCalled();
});

it('Auto explicitly loads an active plugin that was never selected or relevant to preflight', async () => {
  const f = fixture('auto', { decision: { selected: ['earlier'], asked: true }, excluded: [] });
  f.ports.rank = () => [];
  expect(await f.controller.prepare({ query: 'unrelated' })).toBe('');
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(f.resolve).toHaveBeenCalledTimes(2);
  expect(f.ask).not.toHaveBeenCalled();
});

it('untrusted and unreadable guidance remain distinct and can be retried without recording delivery', async () => {
  const f = fixture();
  f.resolve.mockResolvedValueOnce({ ok: false, code: 'untrusted', reason: 'digest not shipped' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'untrusted', guidance: '' });
  f.resolve.mockResolvedValueOnce({ ok: false, reason: 'skill unreadable' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'unavailable', guidance: '' });
  f.resolve.mockRejectedValueOnce(new Error('disk unavailable'));
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'unavailable', guidance: '' });
  expect(f.publish).not.toHaveBeenCalled();
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
});

it('an inactive plugin is only marked in use after its existing activation owner enables it', async () => {
  const f = fixture();
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'installed-but-inactive', guidance: "Plugin 'inactive' is off; its tools are unavailable.\n\nGuidance for inactive" });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.publish).not.toHaveBeenCalled();
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'installed-but-inactive', guidance: "Plugin 'inactive' is off; its tools are unavailable.\n\nGuidance for inactive" });
  expect(f.resolve).toHaveBeenCalledTimes(2);
  f.ports.list = async () => [plugin('inactive')];
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'loaded', guidance: 'Guidance for inactive' });
});

it('explicit Ask loads still require consent and publish a skipped decision', async () => {
  const f = fixture('ask');
  f.ask.mockResolvedValue({ action: 'skip', selected: [] });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'excluded', guidance: '' });
  expect(f.ask).toHaveBeenCalledTimes(1);
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.publish.mock.calls.at(-1)?.[0].state.excluded).toEqual(['synthetic']);
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'excluded', guidance: '' });
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('simultaneous explicit loads and a pinned plugin each return complete guidance', async () => {
  const f = fixture();
  expect(await Promise.all([f.controller.load({ pluginId: 'synthetic' }), f.controller.load({ pluginId: 'synthetic' })])).toEqual([
    { status: 'loaded', guidance: 'Guidance for synthetic' }, { status: 'loaded', guidance: 'Guidance for synthetic' },
  ]);
  expect(f.resolve).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledTimes(1);
  const pinned = fixture();
  await pinned.controller.prepare({ loaded: ['synthetic'] });
  expect(await pinned.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(pinned.resolve).toHaveBeenCalledTimes(1);
});

it('saved consent and exclusions have no 100-plugin limit', () => {
  const ids = Array.from({ length: 150 }, (_, index) => `plugin-${index}`);
  const state = { decision: { selected: ids, asked: true }, excluded: ids };
  expect(readChatAgentPluginState({ value: state })).toEqual(state);
});

it('an explicit load racing the write backstop resolves again without publishing twice', async () => {
  const f = fixture();
  await f.controller.prepare({ query: 'synthetic' });
  expect(await Promise.all([
    f.controller.load({ pluginId: 'synthetic' }),
    f.controller.prepare({ capabilities: ['theme-authoring'] }),
  ])).toEqual([{ status: 'loaded', guidance: 'Guidance for synthetic' }, '']);
  expect(f.resolve).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledTimes(1);
});

// Equal relevance must not inherit filesystem/catalog enumeration order.
it('shuffled equal-score catalogs produce the same ranked ids and relevance note', async () => {
  const candidates = ['gamma', 'alpha', 'beta'].map(id => plugin(id));
  const notes: string[] = [];
  for (const catalog of [candidates, candidates.toReversed(), [candidates[1]!, candidates[0]!, candidates[2]!]]) {
    const ranked = rankInstalledAgentPlugins('synthetic', catalog, 50, true);
    expect(ranked.map(p => p.pluginId)).toEqual(['alpha', 'beta', 'gamma']);
    const f = fixture();
    f.ports.list = async () => catalog;
    f.ports.rank = input => rankInstalledAgentPlugins(input.query, input.candidates, input.limit, true);
    notes.push(await f.controller.prepare({ query: 'synthetic' }));
  }
  expect(new Set(notes).size).toBe(1);
});

it('describes a plugin without provides or summary by its keywords', async () => {
  const f = fixture();
  f.ports.list = async () => [{ pluginId: 'bare', enabled: true, keywords: ['alpha', 'beta'], skills: [], mcpServerIds: [] }];
  expect(await f.controller.prepare({ query: 'bare', loaded: ['pinned'] })).toContain('bare (bare) — Provides alpha, beta');
});

it('readChatAgentPluginState treats non-object input as no previous decision', () => {
  expect(readChatAgentPluginState({ value: 'nope' })).toEqual({ decision: null, excluded: [] });
});

it('readChatAgentPluginState rejects a malformed exclusion list', () => {
  expect(readChatAgentPluginState({ value: { decision: null, excluded: [''] } })).toEqual({ decision: null, excluded: [] });
});

it('readChatAgentPluginState rejects a decision without a valid selection', () => {
  expect(readChatAgentPluginState({ value: { decision: { selected: [1] }, excluded: ['a'] } })).toEqual({ decision: null, excluded: [] });
});

it('readChatAgentPluginState rejects an undefined decision', () => {
  expect(readChatAgentPluginState({ value: { excluded: ['a'] } })).toEqual({ decision: null, excluded: [] });
});

it('readChatAgentPluginState drops a non-boolean asked flag and de-duplicates ids', () => {
  expect(readChatAgentPluginState({ value: { decision: { selected: ['a', 'a'], asked: 'yes' }, excluded: ['b', 'b'] } }))
    .toEqual({ decision: { selected: ['a'] }, excluded: ['b'] });
});

it('plugins the caller reports as already loaded are not resolved again', async () => {
  const f = fixture();
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'], loaded: ['synthetic'] })).toBe('');
  expect(f.resolve).not.toHaveBeenCalled();
});

it('a preflight without a query ranks against the empty query', async () => {
  const f = fixture();
  const rank = vi.fn(f.ports.rank);
  f.ports.rank = rank;
  await f.controller.prepare({});
  expect(rank.mock.calls[0]?.[0].query).toBe('');
});

it('Ask forwards the caller signal to the consent question', async () => {
  const f = fixture('ask');
  const signal = new AbortController().signal;
  await f.controller.prepare({ query: 'synthetic', signal });
  expect(f.ask.mock.calls[0]?.[0].signal).toBe(signal);
});

it('an abort during resolution stops before the next provider', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.ports.list = async () => [plugin('first'), plugin('second')];
  f.resolve.mockImplementation(async ({ pluginId }) => { controller.abort(); return { ok: true, promptPrefix: `Guidance for ${pluginId}` }; });
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'], signal: controller.signal })).toBe('Guidance for first');
  expect(f.resolve).toHaveBeenCalledTimes(1);
});

it('blank guidance is not delivered, so a later load retries it', async () => {
  const f = fixture();
  f.resolve.mockResolvedValueOnce({ ok: true, promptPrefix: '   ' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'unavailable', guidance: '' });
  expect(f.publish).not.toHaveBeenCalled();
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
});

it('Auto records delivered plugins as selected in the published state, keeping earlier selections', async () => {
  const f = fixture('auto', { decision: { selected: ['earlier'], asked: true }, excluded: [] });
  await f.controller.load({ pluginId: 'synthetic' });
  expect(f.publish.mock.calls.at(-1)?.[0].state.decision).toEqual({ selected: ['earlier', 'synthetic'], asked: true, delivered: ['synthetic'] });
});


it('large automatic guidance stays retryable, while explicit SKILL.md delivers all UTF-8 text once', async () => {
  const f = fixture();
  const guidance = '😀'.repeat(16_000); // 64 KB in UTF-8, matching the captured automatic attachment.
  f.resolve.mockResolvedValue({ ok: true, promptPrefix: guidance });
  const input = { capabilities: ['theme-authoring'] };
  const pointer = await f.controller.prepare(input);
  expect(Buffer.byteLength(pointer)).toBeLessThan(1024);
  expect(pointer).toContain('host_read_plugin({"pluginId":"synthetic","skill":"synthetic","file":"SKILL.md"})');
  expect(pointer).not.toContain('😀');
  expect(f.publish).not.toHaveBeenCalled();
  expect(await f.controller.prepare(input)).toBe(pointer);
  expect(await f.controller.load({ pluginId: 'synthetic', skill: 'synthetic', file: 'SKILL.md' })).toEqual({ status: 'loaded', guidance });
  expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([{ id: 'synthetic', name: 'synthetic' }]);
  expect(await f.controller.prepare(input)).toBe('');
});

it('the automatic byte boundary delivers a small peer and defers only oversized guidance', async () => {
  const f = fixture();
  f.list.mockResolvedValue([plugin('synthetic'), plugin('large')]);
  f.resolve.mockImplementation(async ({ pluginId }) => ({ ok: true, promptPrefix: pluginId === 'synthetic' ? 'é'.repeat(4096) : 'é'.repeat(4097) }));
  const note = await f.controller.prepare({ capabilities: ['theme-authoring'] });
  expect(note).toContain('é'.repeat(4096));
  expect(note).toContain('"pluginId":"large"');
  expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([{ id: 'synthetic', name: 'synthetic' }]);
  const retry = await f.controller.prepare({ capabilities: ['theme-authoring'] });
  expect(retry).not.toContain('é');
  expect(retry).toContain('host_read_plugin');
});


it.each(['pinned', 'explicit'] as const)('a fresh explicit reader gets complete bytes after %s delivery and rechecks trust', async delivery => {
  const f = fixture();
  const guidance = 'BEGIN_SENTINEL\n' + 'é'.repeat(5000) + '\nEND_SENTINEL';
  f.resolve.mockResolvedValue({ ok: true, promptPrefix: guidance });
  if (delivery === 'pinned') await f.controller.prepare({ loaded: ['synthetic'] });
  else expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance });
  f.resolve.mockResolvedValueOnce({ ok: false, code: 'untrusted', reason: 'changed trust' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'untrusted', guidance: '' });
});


it.each(['auto', 'ask'] as const)('%s preflight delivers a complete oversized primary and leaves the next candidate as a pointer', async mode => {
  const f = fixture(mode);
  const guidance = 'BEGIN_PRIMARY\n' + 'é'.repeat(5000) + '\nEND_PRIMARY';
  f.list.mockResolvedValue([plugin('synthetic'), plugin('second')]);
  f.ask.mockResolvedValue({ action: 'use', selected: ['synthetic', 'second'] });
  f.resolve.mockResolvedValue({ ok: true, promptPrefix: guidance });
  const note = await f.controller.prepare({ query: 'synthetic' });
  expect(note).toBe(guidance + '\n\nRelevant agent plugins for this request:\nsecond (second) — Provides theme-authoring\nLoad one with host_read_plugin({"pluginId":"<pluginId>","file":"SKILL.md"}) before acting on that part.');
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([{ id: 'synthetic', name: 'synthetic' }]);
  const pinned = fixture(mode);
  pinned.list.mockResolvedValue([plugin('synthetic'), plugin('second')]);
  pinned.ask.mockResolvedValue({ action: 'use', selected: ['second'] });
  expect(await pinned.controller.prepare({ query: 'synthetic', loaded: ['synthetic'] })).toContain('second (second)');
  expect(pinned.resolve).not.toHaveBeenCalled();
});


it.each([15709, 16384, 16385, 61309])('automatic primary respects the 16 KiB boundary at %i bytes', async bytes => {
  const f = fixture();
  const guidance = 'é'.repeat(Math.floor(bytes / 2)) + (bytes % 2 ? 'x' : '');
  f.resolve.mockResolvedValue({ ok: true, promptPrefix: guidance });
  const note = await f.controller.prepare({ query: 'synthetic' });
  if (bytes <= 16384) expect(note).toBe(guidance);
  else { expect(note).toContain('host_read_plugin'); expect(note).not.toContain(guidance); }
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance });
});


it('only full deliveries reach children; later matching turns use the existing pointer', async () => {
  const first = fixture();
  first.list.mockResolvedValue([plugin('synthetic'), plugin('secondary')]);
  expect(await first.controller.prepare({ query: 'synthetic' })).toContain('Guidance for synthetic');
  expect(first.controller.guidanceIds({})).toEqual(['synthetic']);
  expect(first.publish.mock.calls.at(-1)?.[0].state.decision.selected).toEqual(['synthetic']);
  const saved = JSON.parse(JSON.stringify(first.publish.mock.calls.at(-1)?.[0].state));
  const next = fixture('auto', saved);
  next.list.mockResolvedValue([plugin('synthetic'), plugin('secondary')]);
  const note = await next.controller.prepare({ query: 'synthetic' });
  expect(note).toContain('host_read_plugin');
  expect(note).not.toContain('Guidance for synthetic');
  expect(next.resolve).not.toHaveBeenCalled();
  expect(next.controller.guidanceIds({})).toEqual(['synthetic']);
  expect(await next.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
});

it('consent selections and deferred guidance never count as delivered', async () => {
  const f = fixture('ask');
  f.list.mockResolvedValue([plugin('synthetic'), plugin('secondary')]);
  f.ask.mockResolvedValue({ action: 'use', selected: ['synthetic', 'secondary'] });
  await f.controller.prepare({ query: 'synthetic' });
  expect(f.controller.guidanceIds({})).toEqual(['synthetic']);
  const next = fixture('ask', f.publish.mock.calls.at(-1)?.[0].state);
  next.list.mockResolvedValue([plugin('synthetic'), plugin('secondary')]);
  expect(await next.controller.prepare({ query: 'synthetic' })).not.toContain('Guidance for synthetic');
  expect(next.controller.guidanceIds({})).toEqual(['synthetic']);
  const excluded = fixture('ask', { ...f.publish.mock.calls.at(-1)?.[0].state, excluded: ['synthetic'] });
  await excluded.controller.prepare({ query: 'synthetic' });
  expect(excluded.controller.guidanceIds({})).toEqual([]);
  const large = fixture();
  large.resolve.mockResolvedValue({ ok: true, promptPrefix: 'x'.repeat(61309) });
  await large.controller.prepare({ query: 'synthetic' });
  expect(large.controller.guidanceIds({})).toEqual([]);
  const selectedOnly = fixture('auto', { decision: { selected: ['synthetic'], asked: false }, excluded: [] });
  selectedOnly.ports.rank = () => [];
  await selectedOnly.controller.prepare({ query: 'unrelated' });
  expect(selectedOnly.controller.guidanceIds({})).toEqual([]);
});

it('pinned guidance reaches child IDs even with automatic plugins Off', async () => {
  const f = fixture('off');
  expect(await f.controller.prepare({ query: 'synthetic', loaded: ['synthetic'] })).toBe('');
  expect(f.controller.guidanceIds({})).toEqual(['synthetic']);
});


it('an argv-budgeted adapter retains metadata-only automatic preparation', async () => {
  const f = fixture();
  const guidance = 'SITE_IMPORT_BEGIN\n' + 'x'.repeat(16250) + '\nSITE_IMPORT_END';
  f.resolve.mockResolvedValue({ ok: true, promptPrefix: guidance });
  const note = await f.controller.prepare({ query: 'import my site', maxPromptArgBytes: 30000 });
  expect(note).toContain('host_read_plugin');
  expect(note).not.toContain('SITE_IMPORT_BEGIN');
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.controller.guidanceIds({})).toEqual([]);
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance });
});

it('Off children receive only current pins, not earlier full deliveries', async () => {
  const f = fixture('off', { decision: { selected: ['prior'], delivered: ['prior'], asked: false }, excluded: [] });
  await f.controller.prepare({ loaded: ['synthetic'] });
  expect(f.controller.guidanceIds({})).toEqual(['synthetic']);
});

it('Off admits full pinned loads while retaining all other admission checks and prior delivery history', async () => {
  const f = fixture('off', { decision: { selected: ['prior'], delivered: ['prior'], asked: false }, excluded: [] });
  await f.controller.prepare({ loaded: ['synthetic'] });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(await f.controller.load({ pluginId: 'prior' })).toEqual({ status: 'off', guidance: '' });
  expect(f.publish.mock.calls.at(-1)?.[0].state.decision.delivered).toEqual(['prior', 'synthetic']);
  expect(f.controller.guidanceIds({})).toEqual(['synthetic']);
  f.resolve.mockResolvedValueOnce({ ok: false, code: 'untrusted', reason: 'changed trust' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'untrusted', guidance: '' });
  expect(await f.controller.load({ pluginId: 'synthetic', signal: AbortSignal.abort() })).toEqual({ status: 'cancelled', guidance: '' });
  const excluded = fixture('off', { decision: null, excluded: ['synthetic'] });
  await excluded.controller.prepare({ loaded: ['synthetic'] });
  expect(await excluded.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'excluded', guidance: '' });
});
