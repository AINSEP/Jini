/**
 * @file Characterization pins for `tool-contributions.ts` before agent-plugin tools project into it.
 * Every branch the projection relies on is pinned here so the additive effect-class change cannot
 * silently alter descriptor shape, the confirmation default, the generation recheck or input refusal.
 */
import { expect, it } from 'vitest';
import { createToolRegistry, ToolInputError, type ToolExecutionContext } from '@jini-ai/core';
import { buildCapabilityScopedSdk } from '../../capability-sdk.js';
import { createPluginContributionCapture, createPluginContributionRegistry, type PluginInvocationContext } from '../../contributions.js';
import { buildPluginContributionToolRegistrations, type PluginToolContributionPorts } from '../../tool-contributions.js';
import type { PluginManifest } from '../../manifest.js';
import { pluginSdkBinding } from '../support/fixture-bindings.js';

const manifest: PluginManifest = { id: 'pin-sample', name: 'Pin', version: '0.1.0', sdkRange: '*', engine: 1, tier: 'tier-3',
  capabilities: ['tools.register'], hooks: [], fields: [], integrity: {}, contributes: { tools: ['echo'] } };
const core = { getCurrentEntry: () => ({ workspaceId: 'ws', ext: {} }), writeExtField: () => {}, attachFilter: () => {} };
const sdk = buildCapabilityScopedSdk({ pluginId: manifest.id, pluginSdkBinding, capabilities: [], coreDeps: core });

function setup(overrides: Partial<PluginToolContributionPorts> = {}) {
  const contributions = createPluginContributionRegistry({});
  const calls: PluginInvocationContext[] = [];
  const capture = createPluginContributionCapture({ manifest });
  capture.tools.add({ name: 'echo', description: 'echo', inputSchema: { type: 'object' }, handler: (ctx) => { calls.push(ctx); return { echoed: ctx.input }; } });
  contributions.replace({ contributions: capture.seal({ sdk }) });
  const ports: PluginToolContributionPorts = { contributions, isEnabled: async () => true,
    resolveAuth: async () => ({ access: 'member', workspaceId: 'ws', principalId: 'p1' }), metadata: {}, ...overrides };
  const [registration] = buildPluginContributionToolRegistrations(ports);
  return { contributions, calls, registration: registration!, ports };
}
function context(input: unknown): ToolExecutionContext {
  return { executionId: 'e1', principal: { id: 'p1' }, run: { id: 'r1' }, input, signal: new AbortController().signal };
}

it('descriptor carries the namespaced id, fixed bounds and never claims read-only', () => {
  const { registration } = setup();
  expect(registration.descriptor).toMatchObject({ id: 'p_pin_sample__echo', description: 'echo', inputSchema: { type: 'object' },
    readOnly: false, timeoutMs: 30000, maxOutputBytes: 65536, metadata: {} });
});

it('without host approval metadata every plugin tool requires confirmation', () => {
  expect(setup().registration.descriptor.requiresConfirmation).toBe(true);
});

it('handler passes plugin id, sealed sdk, resolved auth, record input and signal to the contribution', async () => {
  const { registration, calls } = setup();
  const ctx = context({ a: 1 });
  expect(await registration.handler(ctx)).toEqual({ echoed: { a: 1 } });
  expect(calls[0]).toMatchObject({ pluginId: 'pin-sample', sdk, auth: { access: 'member', workspaceId: 'ws', principalId: 'p1' }, input: { a: 1 }, signal: ctx.signal });
});

it('handler refuses non-record input with ToolInputError before the contribution runs', async () => {
  const { registration, calls } = setup();
  await expect(registration.handler(context('not-a-record'))).rejects.toBeInstanceOf(ToolInputError);
  expect(calls).toEqual([]);
});

it('handler refuses when host auth resolves to nothing', async () => {
  const { registration, calls } = setup({ resolveAuth: async () => null });
  await expect(registration.handler(context({}))).rejects.toThrow('Plugin tool is disabled or was reloaded.');
  expect(calls).toEqual([]);
});

it('a reloaded generation denies authorization and refuses the old handler', async () => {
  const { registration, contributions, calls } = setup();
  const reloaded = createPluginContributionCapture({ manifest });
  reloaded.tools.add({ name: 'echo', description: 'echo', inputSchema: { type: 'object' }, handler: () => 'new' });
  contributions.replace({ contributions: reloaded.seal({ sdk }) });
  const ctx = { principal: { id: 'p1' }, run: { id: 'r1' }, input: {}, tool: registration.descriptor };
  expect(await registration.policy.authorize(ctx)).toBe('deny');
  await expect(registration.handler(context({}))).rejects.toThrow('Plugin tool is disabled or was reloaded.');
  expect(calls).toEqual([]);
});

it('registrations attach to a real registry under the namespaced id', () => {
  const { ports } = setup();
  const registry = createToolRegistry({});
  for (const registration of buildPluginContributionToolRegistrations(ports)) registry.register(registration);
  expect(registry.has({ toolId: 'p_pin_sample__echo' })).toBe(true);
});
