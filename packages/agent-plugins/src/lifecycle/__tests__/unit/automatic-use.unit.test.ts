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
    rank: ({ candidates }) => candidates.map(candidate => ({ ...candidate, score: 4 })), resolve, ask, saveAuto, publish };
  return { controller: createAutomaticAgentPluginUse({ mode, state, ports }), publish, ask, resolve, saveAuto, ports, list };
}
describe('automatic installed plugin use', () => {
  it('Auto suggests metadata matches without resolving or showing them as loaded', async () => {
    const f = fixture();
    const note = await f.controller.prepare({ query: 'synthetic' });
    expect(note).toContain('Relevant agent plugins for this request:');
    expect(note).toContain('synthetic');
    expect(note).toContain('load_agent_plugin');
    expect(note).not.toContain('Guidance for synthetic');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
    expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
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
    if (action === 'skip') expect(guidance).toBe('');
    else expect(guidance).toContain('Relevant agent plugins for this request:');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.publish.mock.calls.at(-1)?.[0].plugins).toEqual([]);
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
    const [note, guidance] = await Promise.all([f.controller.prepare({ query: 'synthetic' }), f.controller.prepare({ capabilities: ['theme-authoring'] })]);
    expect(note).toContain('load_agent_plugin');
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
    expect(await onTopic.controller.prepare({ query: 'Use synthetic' })).toContain('Relevant agent plugins for this request:');
    expect(onTopic.resolve).not.toHaveBeenCalled();
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
  expect(await f.controller.prepare({ query: 'synthetic' })).toContain('Relevant agent plugins for this request:');
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('');
  expect(f.resolve).toHaveBeenCalledTimes(1);
});

it('Do not ask again uses only checked matches, excludes unchecked ones and immediately enables future Auto matches', async () => {
  const f = fixture('ask');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked')];
  f.ask.mockResolvedValue({ action: 'auto', selected: ['synthetic'] });
  expect(await f.controller.prepare({ query: 'synthetic' })).toContain('Relevant agent plugins for this request:');
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(f.publish.mock.calls.at(-1)?.[0].state.excluded).toContain('unchecked');
  f.ports.list = async () => [plugin('synthetic'), plugin('unchecked'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for later');
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('Use never implicitly approves later matching plugins in Ask mode', async () => {
  const f = fixture('ask');
  await f.controller.prepare({ query: 'synthetic' });
  f.ports.list = async () => [plugin('synthetic'), plugin('later')];
  expect(await f.controller.prepare({ capabilities: ['theme-authoring'] })).toBe('Guidance for synthetic');
  expect(f.resolve.mock.calls.map(([input]) => input.pluginId)).toEqual(['synthetic']);
  expect(await f.controller.load({ pluginId: 'later' })).toEqual({ status: 'excluded', guidance: '' });
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.ask).toHaveBeenCalledTimes(1);
});

it('5 genuinely relevant plugins all load: no per-chat plugin count', async () => {
  const f = fixture();
  f.ports.list = async () => Array.from({ length: 5 }, (_, index) => plugin(`match-${index}`));
  await f.controller.prepare({ query: 'synthetic' });
  expect(f.resolve).not.toHaveBeenCalled();
  for (let index = 0; index < 5; index++) await f.controller.load({ pluginId: `match-${index}` });
  expect(f.resolve.mock.calls.map(([input]) => input.pluginId)).toEqual(['match-0', 'match-1', 'match-2', 'match-3', 'match-4']);
});

it('lists every short relevant match with its metadata reason when the note fits', async () => {
  const f = fixture();
  f.ports.list = async () => ['first', 'second', 'third'].map(id => ({ ...plugin(id), displayName: id.toUpperCase(), summary: `Why ${id}` }));
  const note = await f.controller.prepare({ query: 'synthetic' });
  for (const id of ['first', 'second', 'third']) expect(note).toContain(`${id.toUpperCase()} (${id}) — Why ${id}`);
  expect(note).not.toContain('more relevant');
  expect(f.resolve).not.toHaveBeenCalled();
});

it('50 relevant plugins stay within the note budget, bulk-load nothing, and all remain usable', async () => {
  const f = fixture();
  const plugins = Array.from({ length: 50 }, (_, index) => ({ ...plugin(`match-${index}`), summary: `Guidance topic ${index}` }));
  f.ports.list = async () => plugins;
  f.ports.rank = input => rankInstalledAgentPlugins(input.query, input.candidates, input.limit, true);
  const note = await f.controller.prepare({ query: 'synthetic' });
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
  await f.controller.prepare({ query: 'synthetic' });
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
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'installed-but-inactive', guidance: '' });
  expect(await f.controller.load({ pluginId: 'unknown' })).toEqual({ status: 'missing', guidance: '' });
  expect(await f.controller.load({ pluginId: 'synthetic', signal: AbortSignal.abort() })).toEqual({ status: 'cancelled', guidance: '' });
  expect(f.resolve).not.toHaveBeenCalled();
  const off = fixture('off');
  expect(await off.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'off', guidance: '' });
  expect(off.list).not.toHaveBeenCalled();
});

it('Auto explicitly loads an active plugin that was never selected or relevant to preflight', async () => {
  const f = fixture('auto', { decision: { selected: ['earlier'], asked: true }, excluded: [] });
  f.ports.rank = () => [];
  expect(await f.controller.prepare({ query: 'unrelated' })).toBe('');
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'loaded', guidance: 'Guidance for synthetic' });
  expect(await f.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'already-loaded', guidance: '' });
  expect(f.resolve).toHaveBeenCalledTimes(1);
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

it('an inactive plugin is only loaded after its existing activation owner enables it', async () => {
  const f = fixture();
  expect(await f.controller.load({ pluginId: 'inactive' })).toEqual({ status: 'installed-but-inactive', guidance: '' });
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
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

it('simultaneous explicit loads share delivery and a pinned plugin is already loaded', async () => {
  const f = fixture();
  expect(await Promise.all([f.controller.load({ pluginId: 'synthetic' }), f.controller.load({ pluginId: 'synthetic' })])).toEqual([
    { status: 'loaded', guidance: 'Guidance for synthetic' }, { status: 'already-loaded', guidance: '' },
  ]);
  expect(f.resolve).toHaveBeenCalledTimes(1);
  expect(f.publish).toHaveBeenCalledTimes(1);
  const pinned = fixture();
  await pinned.controller.prepare({ loaded: ['synthetic'] });
  expect(await pinned.controller.load({ pluginId: 'synthetic' })).toEqual({ status: 'already-loaded', guidance: '' });
  expect(pinned.resolve).not.toHaveBeenCalled();
});

it('saved consent and exclusions have no 100-plugin limit', () => {
  const ids = Array.from({ length: 150 }, (_, index) => `plugin-${index}`);
  const state = { decision: { selected: ids, asked: true }, excluded: ids };
  expect(readChatAgentPluginState({ value: state })).toEqual(state);
});

it('an explicit load racing the write backstop resolves and publishes only once', async () => {
  const f = fixture();
  await f.controller.prepare({ query: 'synthetic' });
  expect(await Promise.all([
    f.controller.load({ pluginId: 'synthetic' }),
    f.controller.prepare({ capabilities: ['theme-authoring'] }),
  ])).toEqual([{ status: 'loaded', guidance: 'Guidance for synthetic' }, '']);
  expect(f.resolve).toHaveBeenCalledTimes(1);
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
  expect(await f.controller.prepare({ query: 'bare' })).toContain('bare (bare) — Provides alpha, beta');
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
  expect(f.publish.mock.calls.at(-1)?.[0].state.decision).toEqual({ selected: ['earlier', 'synthetic'], asked: true });
});
