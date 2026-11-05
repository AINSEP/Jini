import { expect, test } from 'vitest';
import { projectAgentPluginSearchPage } from '../../search-projection.js';
import { agentVisiblePluginCandidate } from '../../search-projection.js';
import type { AgentPluginSearchCandidate } from '../../search.js';

const plugin: AgentPluginSearchCandidate = {
  pluginId: 'media', displayName: 'Media', summary: 'Create images.\nMore prose.', enabled: false,
  description: 'SECRET_AUTH_INSTRUCTIONS', keywords: ['SECRET_KEYWORD'], provides: ['SECRET_CAPABILITY'],
  skills: [{ name: 'private', summary: 'SECRET_SKILL' }], mcpServerIds: ['SECRET_TOOL'],
};

test('off plugins expose only identity, state and one purpose line to agents', () => {
  const visible = agentVisiblePluginCandidate({ candidate: plugin });
  expect(visible.description).toBe('installed, off: Media: Create images. More prose. — ask to turn on');
  expect(visible.skills).toEqual([]);
  expect(visible.provides).toEqual([]);
  expect(JSON.stringify(visible)).not.toMatch(/SECRET_/);
  const page = projectAgentPluginSearchPage({ candidates: [plugin], offset: 0, limit: 10, totalInstalled: 1 });
  expect(page.matches[0]?.description).toBe(visible.description);
  expect(JSON.stringify(page)).not.toMatch(/SECRET_/);
  expect(plugin.skills).toHaveLength(1);
});

test('enabled plugins retain their existing metadata', () => {
  const enabled = { ...plugin, enabled: true };
  expect(agentVisiblePluginCandidate({ candidate: enabled })).toBe(enabled);
});
