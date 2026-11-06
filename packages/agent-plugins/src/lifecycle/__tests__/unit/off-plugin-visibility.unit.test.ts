import { expect, test } from 'vitest';
import { projectAgentPluginSearchPage } from '../../search-projection.js';
import { agentVisiblePluginCandidate } from '../../search-projection.js';
import type { AgentPluginSearchCandidate } from '../../search.js';

const plugin: AgentPluginSearchCandidate = {
  pluginId: 'media', displayName: 'Media', summary: 'Create images.\nMore prose.', enabled: false,
  description: 'SECRET_AUTH_INSTRUCTIONS', keywords: ['SECRET_KEYWORD'], provides: ['SECRET_CAPABILITY'],
  skills: [{ name: 'private', summary: 'SECRET_SKILL' }], mcpServerIds: ['SECRET_TOOL'],
};

test('off plugin discovery exposes only identity, state and one purpose line to agents', () => {
  const candidate = agentVisiblePluginCandidate({ candidate: plugin });
  expect(candidate.skills).toEqual(plugin.skills);
  expect(candidate.provides).toEqual(plugin.provides);
  expect(candidate.keywords).toEqual(plugin.keywords);
  expect(candidate.mcpServerIds).toEqual(plugin.mcpServerIds);
  const page = projectAgentPluginSearchPage({ candidates: [candidate], offset: 0, limit: 10, totalInstalled: 1 });
  const visible = page.matches[0]!;
  expect(visible.description).toBe('installed, off: Media: Create images. More prose. — read guidance; tools unavailable');
  expect(visible).not.toHaveProperty('skills');
  expect(visible).not.toHaveProperty('provides');
  expect(Object.keys(visible).sort()).toEqual(['description', 'enabled', 'id', 'pluginId']);
  expect(JSON.stringify(visible)).not.toMatch(/SECRET_/);
  expect(visible.description).toBe(candidate.description);
  expect(JSON.stringify(page)).not.toMatch(/SECRET_/);
  expect(plugin.skills).toHaveLength(1);
});

test('enabled plugins retain their existing metadata', () => {
  const enabled = { ...plugin, enabled: true };
  expect(agentVisiblePluginCandidate({ candidate: enabled })).toBe(enabled);
});
