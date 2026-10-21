import { expect, it } from 'vitest';
import { createMemoryAgentPluginsApi } from '../adapters/memory.js';
import { runAgentPluginsApiConformance } from '../conformance/agent-plugins-api.conformance.js';
import * as barrel from '../index.js';
import type { AgentPluginFiles, AgentPluginSummary } from '../models.js';
import type { AgentPluginsApiPort } from '../ports.js';

const alpha: AgentPluginSummary = { pluginId: 'ui-ux-design', version: '1', description: 'Design interfaces', keywords: ['UI'], enabled: false, skills: [{ name: 'design', summary: 'A design skill' }], mcpServerIds: ['design-api'] };
const beta: AgentPluginSummary = { ...alpha, pluginId: 'second', enabled: true };
const files: AgentPluginFiles = { pluginId: alpha.pluginId, files: [{ relativePath: 'plugin.json', sizeBytes: 2, content: '{}', omitted: null }], truncated: false, limits: { maxFiles: 200, maxEntries: 1000, maxFileBytes: 65536, maxTotalBytes: 1048576 } };

const memory = () => createMemoryAgentPluginsApi({ plugins: [alpha, beta], files: { [alpha.pluginId]: files } });

it('memory adapter answers an installed package without a stored listing with an empty, bounded, frozen listing', async () => {
  const api = createMemoryAgentPluginsApi({ plugins: [alpha, beta] });
  const listing = await api.files({ pluginId: beta.pluginId });
  expect(listing).toEqual({ pluginId: beta.pluginId, files: [], truncated: false, limits: { maxFiles: 200, maxEntries: 2000, maxFileBytes: 524288, maxTotalBytes: 4194304 } });
  expect(Object.isFrozen(listing)).toBe(true);
});

it('memory adapter starts empty when constructed with no plugins', async () => {
  const api = createMemoryAgentPluginsApi({});
  expect(await api.list({})).toEqual([]);
  await expect(api.files({ pluginId: alpha.pluginId })).rejects.toMatchObject({ code: 'AGENT_PLUGIN_NOT_FOUND' });
});

it('conformance refuses a fixture without two distinct installed ids', async () => {
  await expect(runAgentPluginsApiConformance({ create: memory, pluginId: alpha.pluginId, otherPluginId: alpha.pluginId })).rejects.toThrow('Conformance needs two distinct installed plugin ids');
  await expect(runAgentPluginsApiConformance({ create: memory, pluginId: alpha.pluginId, otherPluginId: 'not-installed' })).rejects.toThrow('Conformance needs two distinct installed plugin ids');
  await expect(runAgentPluginsApiConformance({ create: memory, pluginId: 'not-installed', otherPluginId: beta.pluginId })).rejects.toThrow('Conformance needs two distinct installed plugin ids');
});

it('conformance reports each broken contract as a failed check instead of aborting the run', async () => {
  // A lax adapter: accepts writes for unknown ids, ignores abort signals and hands back mutable snapshots.
  const inner = memory();
  const lax: AgentPluginsApiPort = {
    list: async () => [...await inner.list({})],
    setEnabled: async (input) => (input.pluginId === '__missing__' ? { ...alpha, pluginId: '__missing__' } : inner.setEnabled(input)),
    files: async ({ pluginId }) => ({ ...await inner.files({ pluginId }) }),
  };
  const results = await runAgentPluginsApiConformance({ create: () => lax, pluginId: alpha.pluginId, otherPluginId: beta.pluginId });
  const failed = results.filter(r => !r.passed).map(r => r.name);
  expect(failed).toEqual(['list snapshots are immutable', 'file snapshots are immutable', 'missing activation rejects', 'aborted list rejects', 'aborted files reject', 'aborted write leaves activation intact']);
  expect(results.find(r => r.name === 'activation replies with the single updated row')?.passed).toBe(true);
  expect(Object.isFrozen(results)).toBe(true);
  // The run restores the original activation even after failures.
  expect((await inner.list({})).find(p => p.pluginId === alpha.pluginId)?.enabled).toBe(alpha.enabled);
});

it('universal barrel exposes the working rules, adapters-facing models and controllers', async () => {
  expect(barrel.humanizeAgentPluginId({ pluginId: 'ui-ux-design' })).toBe('UI UX Design');
  const controller = barrel.createAgentPluginsController({ api: memory(), permissions: ['admin.plugins.read'] });
  await controller.load({});
  expect(controller.getSnapshot().plugins?.map(p => p.pluginId)).toEqual([alpha.pluginId, beta.pluginId]);
});
