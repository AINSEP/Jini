import { describe, it, expect } from 'vitest';
import { createSearchModule, type AgentPluginSearchCandidate } from '../../search.js';
import { ports } from '../test-support.js';
const rank = createSearchModule(ports).rankInstalledAgentPlugins;
const candidate = (pluginId: string, keywords: string[], enabled = true): AgentPluginSearchCandidate => ({ pluginId, keywords, enabled, skills: [], mcpServerIds: [], description: 'Use this for creating a new site and helpful reports.' });
describe('automatic metadata ranking', () => {
  it('finds a new synthetic installed capability without application ID rules and excludes inactive plugins', () => {
    const candidates = [candidate('brand-new', ['holography']), candidate('disabled', ['holography'], false)];
    expect(rank('Please help me with holography', candidates, 12, true).map(match => match.pluginId)).toEqual(['brand-new']);
  });
  it('requires complete authored terms rather than incidental prose, stop words or substrings', () => {
    expect(rank('Create a new report for me', [candidate('portal', ['port'])], 12, true)).toEqual([]);
    expect(rank('help me use this', [candidate('helper', ['use'])], 12, true)).toEqual([]);
    expect(rank('use port', [candidate('portal', ['port'])], 12, true)).toHaveLength(1);
    // Explicit search retains its broader discovery contract, including inactive candidates.
    expect(rank('holography', [candidate('disabled', ['holography'], false)], 12)).toHaveLength(1);
  });
});

it('scores a plugin matching only its human display name', () => {
  const named = { ...candidate('opaque', []), displayName: 'Holography Studio' };
  expect(rank('holography', [named], 12, true).map(match => match.pluginId)).toEqual(['opaque']);
  expect(rank('holography', [named], 12).map(match => match.pluginId)).toEqual(['opaque']);
});
