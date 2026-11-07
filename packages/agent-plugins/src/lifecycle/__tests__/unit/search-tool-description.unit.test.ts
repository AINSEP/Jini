import { expect, test } from 'vitest';
import { agentPluginSearchToolCatalog } from '../../host-tools/index.js';

/** Tool names a host might give: none of them belongs in Jini's own default text. */
const HOST_NAMES = /content_read|plugins_set_enabled|load_agent_plugin/;

function description(optional: Parameters<typeof agentPluginSearchToolCatalog>[1] = {}): string {
  const [tool] = agentPluginSearchToolCatalog({ permission: 'use' }, optional);
  return tool?.description ?? '';
}

test('the default search description names no host tool', () => {
  const text = description();
  expect(text).not.toMatch(HOST_NAMES);
  expect(text).toContain('Find an Agent Plugin by the task');
  expect(text).toContain('Once you have the right id, load that plugin\'s full guidance.');
  expect(text.endsWith('Page with the returned nextOffset as offset, keeping query and limit unchanged.')).toBe(true);
});

test('host tool names in the search description come from the host messages', () => {
  const text = description({ messages: { searchHostTools: {
    inventory: 'inventory_read.plugin', setEnabled: 'toggle_plugin', loadGuidance: 'read_guidance({ pluginId })',
  } } });
  expect(text).toContain('including inactive packages. For the full plugin inventory, use inventory_read.plugin. Empty, omitted');
  expect(text).toContain('a short description. toggle_plugin changes enabled status. An installed, off result');
  expect(text).toContain('Once you have the right id, call read_guidance({ pluginId }) for that plugin\'s full guidance. Page with');
});

test('each host tool name is optional; an absent one drops only its own sentence', () => {
  const text = description({ messages: { searchHostTools: { setEnabled: 'toggle_plugin' } } });
  expect(text).not.toContain('full plugin inventory');
  expect(text).toContain('toggle_plugin changes enabled status.');
  expect(text).toContain('Once you have the right id, load that plugin\'s full guidance.');
});
