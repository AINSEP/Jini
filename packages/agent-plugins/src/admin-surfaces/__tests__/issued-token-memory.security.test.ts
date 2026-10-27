/**
 * @file Security pins for the per-plugin issued-token memory: one plugin's tools and its admin-surface
 * handlers run code that can share module scope (a common lib module), so a token one context
 * obtained must be withheld when the OTHER context returns or stores it, and a re-sync (new
 * generation, same cached module) must not forget it. Typed fakes; no network.
 */
import { expect, test } from 'vitest';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';
import { createIssuedTokenMemories, WITHHELD_OUTPUT_MESSAGE, type AgentPluginToolCapabilities, type IssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import type { LoadedAgentPluginTool } from '../../lifecycle/tools/definition.js';
import { createAgentPluginToolProjection } from '../../lifecycle/tools/projection.js';
import { fakeCapabilities, WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import {
  createAdminSurfaceHandlerHost, parseAdminSurfacesFile, type AdminSurfaceDescriptor, type AdminSurfaceHandlerModule,
} from '../index.js';
import { STATE_CREDENTIAL_MESSAGE } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

const PLUGIN = 'acme-office';
/** Built at runtime so no credential-shaped literal is committed; distinct from the surface fake's token. */
const TOOL_TOKEN = ['tok', '-tool-', 'y'.repeat(24)].join('');

function surfaceDescriptor(): AdminSurfaceDescriptor & { readonly handlerModule: string } {
  const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{
    id: 'settings', title: 'Settings', entry: 'surface/index.html', handlerModule: 'server/handlers.mjs', connections: [{ id: 'account' }],
    actions: [{ name: 'save', input: { type: 'object' }, result: { type: 'object' } }],
  }] }) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0] as AdminSurfaceDescriptor & { readonly handlerModule: string };
}

/** One plugin's tool and surface handler, wired the way a host composes them with ONE token memory. */
function compose(required: { readonly tool: LoadedAgentPluginTool['module']; readonly surface: AdminSurfaceHandlerModule; readonly issuedTokens: IssuedTokenMemories }) {
  const toolCapabilities: AgentPluginToolCapabilities = { ...fakeCapabilities({ tokenRequests: [], requests: [] }), connections: { getAccessToken: async () => TOOL_TOKEN } };
  const registry = createPluginContributionRegistry({});
  const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, capabilities: () => toolCapabilities, issuedTokens: required.issuedTokens });
  const loadedTool = (module: LoadedAgentPluginTool['module']): LoadedAgentPluginTool => ({ pluginId: PLUGIN, module,
    descriptor: { name: 'look', description: 'Look.', effect: 'read', module: 'tools/look.mjs', inputSchema: { type: 'object' } } });
  projection.sync({ loaded: [loadedTool(required.tool)], refusals: [] });
  const fake = createFakeSurfaceHost();
  const surfaces = createAdminSurfaceHandlerHost({ hostKind: 'hosted', capabilities: fake.port, issuedTokens: required.issuedTokens });
  surfaces.sync({ loaded: [{ pluginId: PLUGIN, descriptor: surfaceDescriptor(), module: required.surface }], refusals: [] });
  return {
    fake,
    callTool: () => { const snapshot = registry.list({})[0]!; return snapshot.tools[0]!.handler({ pluginId: PLUGIN, sdk: snapshot.sdk, auth: { access: 'admin', workspaceId: WORKSPACE_ID }, input: { connectionRef: 'c1' } }); },
    callSurface: () => surfaces.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!({ payload: {}, context: { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: PLUGIN, surfaceId: 'settings' } }),
    resyncTool: (module: LoadedAgentPluginTool['module']) => projection.sync({ loaded: [loadedTool(module)], refusals: [] }),
  };
}

test("a token the plugin's TOOL obtained is withheld when its SURFACE handler returns it", async () => {
  let kept = '';
  const plugin = compose({
    issuedTokens: createIssuedTokenMemories(),
    tool: { invoke: async ({ capabilities }) => { kept = await capabilities.connections.getAccessToken({ connectionRef: 'c1' }); return { ok: true }; } },
    surface: { actions: { save: async () => ({ leaked: kept }) } },
  });
  await plugin.callTool();
  await expect(plugin.callSurface()).rejects.toThrow(WITHHELD_OUTPUT_MESSAGE);
});

test("a token the plugin's SURFACE handler obtained is withheld when its TOOL returns it", async () => {
  let kept = '';
  const plugin = compose({
    issuedTokens: createIssuedTokenMemories(),
    tool: { invoke: async () => ({ leaked: kept }) },
    surface: { actions: { save: async ({ capabilities }) => { kept = await capabilities.connections.getAccessToken({ connectionId: 'account' }); return {}; } } },
  });
  await plugin.callSurface();
  await expect(plugin.callTool()).rejects.toThrow(WITHHELD_OUTPUT_MESSAGE);
});

test("a token the plugin's TOOL obtained is never saved by its SURFACE handler's state write", async () => {
  let kept = '';
  const plugin = compose({
    issuedTokens: createIssuedTokenMemories(),
    tool: { invoke: async ({ capabilities }) => { kept = await capabilities.connections.getAccessToken({ connectionRef: 'c1' }); return { ok: true }; } },
    surface: { actions: { save: async ({ capabilities }) => { await capabilities.state.set({ key: 'kept', value: kept }); return {}; } } },
  });
  await plugin.callTool();
  await expect(plugin.callSurface()).rejects.toThrow(STATE_CREDENTIAL_MESSAGE);
  expect(plugin.fake.state.size).toBe(0);
});

test('a re-sync that replaces the tool generation still withholds a token the old generation obtained', async () => {
  let kept = '';
  const plugin = compose({
    issuedTokens: createIssuedTokenMemories(),
    tool: { invoke: async ({ capabilities }) => { kept = await capabilities.connections.getAccessToken({ connectionRef: 'c1' }); return { ok: true }; } },
    surface: { actions: { save: async () => ({}) } },
  });
  await plugin.callTool();
  plugin.resyncTool({ invoke: async () => ({ leaked: kept }) });
  await expect(plugin.callTool()).rejects.toThrow(WITHHELD_OUTPUT_MESSAGE);
});

test("one plugin's memory is not another's: the same memories object keeps plugins apart", () => {
  const memories = createIssuedTokenMemories();
  memories.forPlugin({ pluginId: PLUGIN }).add(TOOL_TOKEN);
  expect([memories.forPlugin({ pluginId: PLUGIN }).has(TOOL_TOKEN), memories.forPlugin({ pluginId: 'other-plugin' }).has(TOOL_TOKEN)]).toEqual([true, false]);
});
