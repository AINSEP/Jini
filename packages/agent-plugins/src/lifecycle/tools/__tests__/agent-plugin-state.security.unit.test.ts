/**
 * @file Security pins (phase A) for the read-only plugin state an executable tool receives: the tool
 * port carries `get` only (never `set` or `delete`, even when the host hands over its full store), keys
 * pass the same shape check as the admin-surface state, the plugin cannot choose another plugin's or
 * workspace's keys (the projection scopes the host port by the calling plugin and workspace, and the
 * host receives the key alone), and a reader the module kept is revoked once the plugin is disabled.
 */
import { expect, test } from 'vitest';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';
import { createFakeSurfaceHost } from '../../../admin-surfaces/__tests__/surface-support.js';
import { openCapabilitySession, REVOKED_MESSAGE, type AgentPluginToolCapabilities, type AgentPluginToolCapabilityScope } from '../capabilities.js';
import type { LoadedAgentPluginTool } from '../definition.js';
import { createAgentPluginToolProjection } from '../projection.js';
import { fakeCapabilities, WORKSPACE_ID } from './support.js';

const KEY_MESSAGE = 'A settings key must be a short name of at most 128 characters.';
const SCHEMA = { type: 'object', additionalProperties: false, properties: {} };

/** Tool capabilities over the shared fake host: its full state store (get, set, delete) is what the host passes. */
function toolPort(fake: ReturnType<typeof createFakeSurfaceHost>) {
  return (scope: AgentPluginToolCapabilityScope): AgentPluginToolCapabilities => ({ ...fakeCapabilities(fake.log), state: fake.port(scope).state });
}

function session(state: AgentPluginToolCapabilities['state'], live: () => boolean = () => true) {
  return openCapabilitySession({ capabilities: { ...fakeCapabilities({ tokenRequests: [], requests: [] }), state }, isLive: live });
}

test('a tool\'s state port has get only, frozen, even when the host passes its full store', () => {
  const fake = createFakeSurfaceHost();
  const { state } = openCapabilitySession({ capabilities: toolPort(fake)({ pluginId: 'acme-office', workspaceId: WORKSPACE_ID }), isLive: () => true }).capabilities;
  expect(Object.keys(state)).toEqual(['get']);
  expect(Object.isFrozen(state)).toBe(true);
  expect('set' in state || 'delete' in state).toBe(false);
});

test.each(['', '../x', 'a b', 'k'.repeat(129), 7])('a tool state key %j outside the short-name shape is refused before the host sees it', async (key) => {
  const seen: unknown[] = [];
  const { capabilities } = session({ get: async (input) => { seen.push(input); return null; } });
  await expect(capabilities.state.get({ key: key as string })).rejects.toThrow(KEY_MESSAGE);
  expect(seen).toEqual([]);
});

test('the host receives the key alone: a plugin cannot name another plugin or workspace', async () => {
  const seen: unknown[] = [];
  const { capabilities } = session({ get: async (input, optional) => { seen.push([input, optional]); return 'v'; } });
  // Malformed input on purpose: extra scope fields a plugin might try to smuggle in.
  expect(await capabilities.state.get({ key: 'products', pluginId: 'other', workspaceId: 'w2' } as never, { pluginId: 'other' } as never)).toBe('v');
  expect(seen).toStrictEqual([[{ key: 'products' }, undefined]]);
});

const reader = (pluginId: string): LoadedAgentPluginTool => ({
  pluginId, descriptor: { name: 'flags', description: 'Read flags.', effect: 'read', module: 'tools/flags.mjs', inputSchema: SCHEMA },
  module: { invoke: async ({ capabilities }) => ({ products: await capabilities.state.get({ key: 'products' }) }) },
});

function projected(fake: ReturnType<typeof createFakeSurfaceHost>, loaded: readonly LoadedAgentPluginTool[]) {
  const registry = createPluginContributionRegistry({});
  const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, capabilities: toolPort(fake) });
  projection.sync({ loaded, refusals: [] });
  const call = (pluginId: string, workspaceId: string) => {
    const snapshot = registry.list({}).find((candidate) => candidate.pluginId === pluginId)!;
    return snapshot.tools[0]!.handler({ pluginId, sdk: snapshot.sdk, auth: { access: 'member', workspaceId }, input: {} });
  };
  return { projection, call };
}

test('a tool reads only its own plugin\'s state in its own workspace', async () => {
  const fake = createFakeSurfaceHost();
  await fake.port({ pluginId: 'plugin-a', workspaceId: WORKSPACE_ID }).state.set({ key: 'products', value: { tables: true } });
  const { call } = projected(fake, [reader('plugin-a'), reader('plugin-b')]);
  expect(await call('plugin-a', WORKSPACE_ID)).toEqual({ products: { tables: true } });
  expect(await call('plugin-b', WORKSPACE_ID)).toEqual({ products: null });
  expect(await call('plugin-a', 'workspace-other')).toEqual({ products: null });
});

test('a state reader the module kept is revoked once the plugin is disabled', async () => {
  const fake = createFakeSurfaceHost();
  let kept: AgentPluginToolCapabilities['state'] | undefined;
  const keeper: LoadedAgentPluginTool = { ...reader('plugin-a'), module: { invoke: ({ capabilities }) => { kept = capabilities.state; return 'ok'; } } };
  const { projection, call } = projected(fake, [keeper]);
  expect(await call('plugin-a', WORKSPACE_ID)).toBe('ok');
  projection.sync({ loaded: [], refusals: [] });
  await expect(kept!.get({ key: 'products' })).rejects.toThrow(REVOKED_MESSAGE);
});
