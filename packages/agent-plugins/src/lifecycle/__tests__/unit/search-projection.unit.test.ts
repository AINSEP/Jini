import { expect, test } from 'vitest';
import { projectAgentPluginSearchPage } from '../../index.js';
import type { AgentPluginSearchCandidate } from '../../search.js';

const candidates = Array.from({ length: 44 }, (_, i) => ({
  pluginId: `plugin-${i}`, id: `example/plugin-${i}`, enabled: i % 2 === 0, maturity: 'untested',
  description: '\"\\\n😀é'.repeat(1000), keywords: ['metadata stays off the discovery surface'],
  skills: [{ name: 'guidance', summary: 'FULL_METADATA_CANARY' }], mcpServerIds: ['private-config'],
} satisfies AgentPluginSearchCandidate & { maturity: string }));

test('byte-bounded pages preserve ordering and full enumeration, including overlapping windows', () => {
  const before = structuredClone(candidates);
  const ids: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = projectAgentPluginSearchPage({ candidates, offset, limit: 50, totalInstalled: 50 }, { maxBytes: 1024 });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024);
    expect(page.totalInstalled).toBe(50);
    expect(page.totalMatches).toBe(44);
    expect(page.matches.length).toBeGreaterThan(0);
    for (const match of page.matches) {
      expect(Object.keys(match).sort()).toEqual(['description', 'enabled', 'id', 'maturity', 'pluginId']);
      expect(match.description).not.toContain('�');
      expect(Buffer.byteLength(match.description)).toBeLessThanOrEqual(240);
      expect(match.enabled).toBe(candidates[ids.length]!.enabled);
      expect(match.maturity).toBe('untested');
      ids.push(match.pluginId);
    }
    expect(JSON.stringify(page)).not.toMatch(/FULL_METADATA_CANARY|private-config/);
    offset = page.nextOffset;
  }
  expect(ids).toEqual(candidates.map(candidate => candidate.pluginId));
  const first = projectAgentPluginSearchPage({ candidates, offset: 0, limit: 10, totalInstalled: 44 });
  const overlap = projectAgentPluginSearchPage({ candidates, offset: 1, limit: 10, totalInstalled: 44 });
  expect(first.matches.slice(1)).toEqual(overlap.matches.slice(0, first.matches.length - 1));
  expect(candidates).toEqual(before);
});

test('empty/end pages and metadata fallbacks remain compact and invalid budgets cannot stall paging', () => {
  const minimal = [{ pluginId: 'minimal', enabled: false, keywords: [], skills: [], mcpServerIds: [] }];
  expect(projectAgentPluginSearchPage({ candidates: minimal, offset: 0, limit: 10, totalInstalled: 1 })).toEqual({
    matches: [{ id: 'minimal', pluginId: 'minimal', enabled: false, description: '' }], totalInstalled: 1, totalMatches: 1, nextOffset: null,
  });
  expect(projectAgentPluginSearchPage({ candidates: [], offset: 0, limit: 10, totalInstalled: 3 })).toEqual({ matches: [], totalInstalled: 3, totalMatches: 0, nextOffset: null });
  expect(projectAgentPluginSearchPage({ candidates: minimal, offset: 5, limit: 10, totalInstalled: 1 }).matches).toEqual([]);
  expect(() => projectAgentPluginSearchPage({ candidates, offset: 0, limit: 10, totalInstalled: 44 }, { maxBytes: 0 })).toThrow(RangeError);
  expect(() => projectAgentPluginSearchPage({ candidates, offset: -1, limit: 10, totalInstalled: 44 })).toThrow(RangeError);
  expect(() => projectAgentPluginSearchPage({ candidates, offset: 0, limit: 0, totalInstalled: 44 })).toThrow(RangeError);
  expect(() => projectAgentPluginSearchPage({ candidates: [{ ...minimal[0]!, id: 'x'.repeat(9000) }], offset: 0, limit: 1, totalInstalled: 1 })).toThrow(/identity/);
});
