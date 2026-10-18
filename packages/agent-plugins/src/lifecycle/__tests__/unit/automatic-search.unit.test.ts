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

it('keeps authoritative topical matches above verbose incidental prose and caps automatic results', () => {
  const candidates = [candidate('theme-owner', ['theme']), candidate('design-owner', ['design']),
    { ...candidate('incidental', ['website']), description: 'theme design '.repeat(100) },
    ...Array.from({ length: 5 }, (_, index) => candidate(`theme-extra-${index}`, ['theme']))];
  const matches = rank('Design a theme for this site', candidates, 12, true);
  expect(matches.map(match => match.pluginId)).toContain('theme-owner');
  expect(matches.map(match => match.pluginId)).toContain('design-owner');
  expect(matches.map(match => match.pluginId)).not.toContain('incidental');
  expect(matches).toHaveLength(3);
});

it('drops weak keyword overlap when a stronger owner matches the task', () => {
  const candidates = [candidate('site-import', ['import', 'wordpress']), candidate('theme-owner', ['import'])];
  expect(rank('Import my WordPress site', candidates, 12, true).map(match => match.pluginId)).toEqual(['site-import']);
});

it('uses declared deployment capabilities and vendor identity rather than plugin ID rules', () => {
  const deployment = { ...candidate('aurora-host', ['deploy', 'hosting', 'theme']), provides: ['deploy-target:aurora'] };
  const alternative = { ...candidate('nebula-host', ['deploy', 'hosting']), provides: ['deploy-target:nebula'] };
  expect(rank('Design an aurora theme', [deployment, alternative], 12, true)).toEqual([]);
  expect(rank('Deploy to Aurora', [deployment, alternative], 12, true).map(match => match.pluginId)).toEqual(['aurora-host']);
  expect(rank('Deploy my site', [deployment, alternative], 12, true)).toEqual([]);
});
