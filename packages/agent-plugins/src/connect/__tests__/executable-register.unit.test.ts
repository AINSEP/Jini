import { createToolRegistry, type ToolRegistration } from '@jini-ai/core';
import { buildPluginContributionToolRegistrations, createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';
import { expect, it, vi } from 'vitest';
import { createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { defineAgentPluginToolContribution, type LoadedAgentPluginTool } from '../../lifecycle/tools/definition.js';
import { registerAgentPluginExecutableTools } from '../executable/index.js';
import type { AgentPluginExecutableRuntimeHost, ApplyAgentPluginApproval, ApplyAgentPluginPolicy } from '../executable/ports.js';

const inputSchema = { type: 'object', properties: {}, additionalProperties: false };
const statusId = 'p_sync__status';
const purgeId = 'p_sync__purge';
function tool(name: string, effect: 'read' | 'destructive'): LoadedAgentPluginTool {
  return { pluginId: 'sync', descriptor: { name, effect, description: `Sync ${name}`, module: 'fixture.mjs', inputSchema },
    module: { invoke: () => ({ effect }), ...(effect === 'read' ? {} : { describeAffectedResources: () => ['Archive records'] }) },
  };
}

function fixture() {
  const definition = defineAgentPluginToolContribution({ filename: 'studio-tools.json' });
  const registry = createToolRegistry({});
  const loadContributions = vi.fn<AgentPluginExecutableRuntimeHost['loadContributions']>(async () => ({
    items: [tool('status', 'read'), tool('purge', 'destructive')], refusals: ['A third tool was refused.'],
  }));
  const host: AgentPluginExecutableRuntimeHost = {
    loadContributions, issuedTokens: createIssuedTokenMemories(),
    http: { send: async () => { throw new Error('unexpected network'); } }, apiOrigins: async () => [],
    limiter: { check: async () => ({ allowed: true }) }, state: () => ({ get: async () => null }),
    connections: { readAccount: async () => null, getAccessToken: async () => { throw new Error('unexpected token read'); } },
  };
  const withExtensionApprovalPolicy = vi.fn<ApplyAgentPluginPolicy>(({ registration }) => registration);
  const confirmationResults: unknown[] = [];
  const applyApproval = vi.fn<ApplyAgentPluginApproval>(({ registration }, { disclose }): ToolRegistration => ({
    ...registration,
    handler: async (ctx, options) => {
      confirmationResults.push(await disclose({ ctx }));
      return registration.handler(ctx, options);
    },
  }));
  const options = {
    registry, workspaceId: 'studio', host, isActive: async () => true, toolPermission: 'studio.invoke',
    authorize: async () => ({ allowed: true, reason: 'fixture grant' }),
    applyApproval, withExtensionApprovalPolicy,
    contributions: { definition, createRegistry: createPluginContributionRegistry, toolIdFor: pluginToolIdFor,
      buildRegistrations: buildPluginContributionToolRegistrations },
    connectionKey: ({ connectionId }: { connectionId: string }) => `studio:${connectionId}`,
    readApproval: { class: 'edit', confirmation: 'direct' } as const,
    disclosureMessages: { withdrawn: 'Withdrawn.', notConnected: 'Not connected.', affectsLabel: 'Affects', accountLabel: 'Account' },
  };
  return { options, registry, definition, loadContributions, withExtensionApprovalPolicy, applyApproval, confirmationResults };
}

it('projects real contributions, adds confirmation only to destructive tools and withdraws tools after refresh and disposal', async () => {
  const f = fixture();
  const runtime = await registerAgentPluginExecutableTools(f.options);
  try {
    expect(runtime.refusals).toEqual(['A third tool was refused.']);
    expect(f.loadContributions.mock.calls).toEqual([[{ workspaceId: 'studio', definition: f.definition }, { orderByPluginId: true }]]);
    expect(f.registry.list({}).map(tool => [tool.id, tool.readOnly, tool.sideEffects, tool.requiresConfirmation])).toEqual([
      [statusId, true, 'none', undefined], [purgeId, false, 'deletes-durable-state', undefined],
    ]);
    expect(f.withExtensionApprovalPolicy.mock.calls.map(([{ family, registration }]) => [registration.descriptor.id, family])).toEqual([
      [statusId, 'agent-plugin-read'], [purgeId, 'agent-plugin-destructive'],
    ]);
    expect(f.applyApproval.mock.calls.map(([{ registration }]) => registration.descriptor.id)).toEqual([purgeId]);
    const disclosure = f.applyApproval.mock.calls[0]![1].disclose;
    expect(await disclosure({ ctx: { executionId: 'call', input: {}, principal: { id: 'owner' }, run: { id: 'run' }, signal: new AbortController().signal } }))
      .toEqual([{ label: 'Affects', value: 'Archive records' }]);
    f.loadContributions.mockResolvedValueOnce({ items: [tool('status', 'read')], refusals: [] });
    expect(await runtime.refresh()).toEqual({ refusals: [] });
    expect(f.registry.has({ toolId: purgeId })).toBe(false);
    expect(f.registry.has({ toolId: statusId })).toBe(true);
  } finally { runtime.dispose(); }
  expect(f.registry.list({})).toEqual([]);
});

it('a failed reload does not poison the next refresh or allow a disposed scope to republish tools', async () => {
  const f = fixture();
  const runtime = await registerAgentPluginExecutableTools(f.options);
  try {
    const error = new Error('loader temporarily unavailable');
    f.loadContributions.mockRejectedValueOnce(error);
    await expect(runtime.refresh()).rejects.toBe(error);
    expect(f.registry.has({ toolId: purgeId })).toBe(true);
    f.loadContributions.mockResolvedValueOnce({ items: [], refusals: ['dropped all tools'] });
    expect(await runtime.refresh()).toEqual({ refusals: ['dropped all tools'] });
    expect(f.registry.list({})).toEqual([]);
  } finally { runtime.dispose(); }
  await expect(runtime.refresh()).rejects.toThrow('Plugin tool registration was disposed.');
  expect(f.registry.list({})).toEqual([]);
});
