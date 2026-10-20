/**
 * @file Security pins for executable Agent Plugin tools (phase A): admission refusals through the real
 * trust gate (inactive, tampered digest, path escape, duplicate id), projection refusals (ambiguous id,
 * undisclosed write, unusable schema), schema refusal of bad input, credential containment of results
 * and errors, destructive confirmation, and revocation on disable.
 */
import { expect, test } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';
import { REVOKED_MESSAGE, WITHHELD_ERROR_MESSAGE, WITHHELD_OUTPUT_MESSAGE, type AgentPluginToolCapabilities } from '../capabilities.js';
import type { LoadedAgentPluginTool } from '../definition.js';
import { createAgentPluginToolProjection } from '../projection.js';
import { setAgentPluginActivation } from '../../__tests__/test-support.js';
import { createHarness, FAKE_TOKEN, fakeCapabilities, installPlugin, toolsFile, TOOLS_FILENAME, withWorkspace } from './support.js';

const SCHEMA = { type: 'object', required: ['ref'], additionalProperties: false, properties: { ref: { type: 'string' } } };
const READ_MODULE = 'export default { invoke: ({ input }) => ({ read: input.ref }) };\n';
const declare = (overrides: Record<string, unknown> = {}) => ({ name: 'look', description: 'Look.', effect: 'read', module: 'tools/look.mjs', inputSchema: SCHEMA, ...overrides });

async function loadOne(files: Record<string, string>, optional: { enabled?: boolean; bundled?: boolean } = {}) {
  return withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'fixture-tools', files }, optional);
    const harness = createHarness();
    const refusals = await harness.refresh();
    return { refusals, registered: harness.tools.has({ toolId: 'p_fixture_tools__look' }) };
  });
}

test('an inactive plugin contributes no tool and is skipped silently', async () => {
  expect(await loadOne({ [TOOLS_FILENAME]: toolsFile([declare()]), 'tools/look.mjs': READ_MODULE }, { enabled: false }))
    .toEqual({ refusals: [], registered: false });
});

test('a package whose digest is not the bundled one is refused', async () => {
  const { refusals, registered } = await loadOne({ [TOOLS_FILENAME]: toolsFile([declare()]), 'tools/look.mjs': READ_MODULE }, { bundled: false });
  expect(registered).toBe(false);
  expect(refusals).toHaveLength(1);
  expect(refusals[0]).toMatch(/^agent tools from 'fixture-tools' were not loaded: only plugins shipped with the host may add agent tools \(installed digest [0-9a-f]{12} is not the one this build shipped\)$/);
});

test('a module path that escapes the plugin root is refused before import', async () => {
  expect(await loadOne({ [TOOLS_FILENAME]: toolsFile([declare({ module: '../outside.mjs' })]) })).toEqual({
    refusals: ["agent tool 'look' from 'fixture-tools' was not loaded: module path '../outside.mjs' escapes the plugin root"], registered: false });
});

test('a non-.mjs module path is refused by the parser', async () => {
  expect(await loadOne({ [TOOLS_FILENAME]: toolsFile([declare({ module: 'tools/look.js' })]) })).toEqual({
    refusals: [`agent tools from 'fixture-tools' were not loaded: ${TOOLS_FILENAME} is invalid: tool 'look' module must be a .mjs path inside the plugin`], registered: false });
});

test('a local name declared twice refuses the whole file (duplicate id)', async () => {
  expect(await loadOne({ [TOOLS_FILENAME]: toolsFile([declare(), declare()]), 'tools/look.mjs': READ_MODULE })).toEqual({
    refusals: [`agent tools from 'fixture-tools' were not loaded: ${TOOLS_FILENAME} is invalid: tool 'look' is declared more than once`], registered: false });
});

const loaded = (pluginId: string, overrides: Partial<LoadedAgentPluginTool['descriptor']> = {}, module: LoadedAgentPluginTool['module'] = { invoke: () => 'ok' }): LoadedAgentPluginTool => ({
  pluginId, module, descriptor: { name: 'look', description: 'Look.', effect: 'read', module: 'tools/look.mjs', inputSchema: SCHEMA, ...overrides },
});
function projectionFor(capabilities: AgentPluginToolCapabilities = fakeCapabilities({ tokenRequests: [], requests: [] })) {
  const registry = createPluginContributionRegistry({});
  return { registry, projection: createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, capabilities: () => capabilities }) };
}

test('two plugins whose namespaced ids collide are both refused (ambiguous)', () => {
  const { registry, projection } = projectionFor();
  expect(projection.sync({ loaded: [loaded('a-b'), loaded('a_b')], refusals: [] }).refusals)
    .toEqual(["agent tool 'p_a_b__look' was not loaded: more than one plugin declares it ('a-b', 'a_b')"]);
  expect(registry.list({})).toEqual([]);
});

test('a write or destructive tool without describeAffectedResources is refused', () => {
  const { projection } = projectionFor();
  expect(projection.sync({ loaded: [loaded('p', { effect: 'write' }), loaded('q', { effect: 'destructive' })], refusals: [] }).refusals).toEqual([
    "agent tool 'look' from 'p' was not loaded: a write tool must export describeAffectedResources()",
    "agent tool 'look' from 'q' was not loaded: a destructive tool must export describeAffectedResources()",
  ]);
});

test('an input schema the validator cannot compile is refused', () => {
  const { projection } = projectionFor();
  const [refusal] = projection.sync({ loaded: [loaded('p', { inputSchema: { type: 'object', $ref: '#/missing' } })], refusals: [] }).refusals;
  expect(refusal).toMatch(/^agent tool 'look' from 'p' was not loaded: its input schema is invalid \(/);
});

test('a schema fault reached only by some inputs fails closed as a plugin fault, not bad input', async () => {
  const { registry, projection } = projectionFor();
  projection.sync({ loaded: [loaded('p', { inputSchema: { type: 'object', properties: { ref: { type: 'string', pattern: '(' } } } })], refusals: [] });
  const snapshot = registry.list({})[0]!;
  const call = snapshot.tools[0]!.handler({ pluginId: 'p', sdk: snapshot.sdk, auth: { access: 'member', workspaceId: 'w' }, input: { ref: 'x' } });
  await expect(call).rejects.toThrow("Plugin tool 'p_p__look' has an unusable input schema; report it to the plugin author.");
  await expect(call).rejects.not.toBeInstanceOf(ToolInputError);
});

test('input that fails the schema is refused before the module runs, naming locations not values', async () => {
  const calls: unknown[] = [];
  const { registry, projection } = projectionFor();
  projection.sync({ loaded: [loaded('p', {}, { invoke: (input) => { calls.push(input); return 'ran'; } })], refusals: [] });
  const tool = registry.list({})[0]!.tools[0]!;
  const call = tool.handler({ pluginId: 'p', sdk: registry.list({})[0]!.sdk, auth: { access: 'member', workspaceId: 'w' }, input: { ref: 'secret-value', extra: 1 } });
  await expect(call).rejects.toBeInstanceOf(ToolInputError);
  await expect(call).rejects.toThrow("Input for 'p_p__look' does not match its schema at");
  await expect(call).rejects.not.toThrow('secret-value');
  expect(calls).toEqual([]);
  await expect(projection.describeAffectedResources({ toolId: 'p_p__look', input: { ref: 7 } })).rejects.toBeInstanceOf(ToolInputError);
});

async function runWith(module: LoadedAgentPluginTool['module']) {
  const { registry, projection } = projectionFor();
  projection.sync({ loaded: [loaded('p', {}, module)], refusals: [] });
  const snapshot = registry.list({})[0]!;
  return snapshot.tools[0]!.handler({ pluginId: 'p', sdk: snapshot.sdk, auth: { access: 'member', workspaceId: 'w' }, input: { ref: 'c1' } });
}

test('a result that contains an issued access token is withheld', async () => {
  await expect(runWith({ invoke: async ({ capabilities }) => ({ leaked: await capabilities.connections.getAccessToken({ connectionRef: 'c1' }) }) }))
    .rejects.toThrow(WITHHELD_OUTPUT_MESSAGE);
});

test('an error whose message or cause contains an issued token is replaced; a clean error passes through', async () => {
  await expect(runWith({ invoke: async ({ capabilities }) => { throw new Error(`bad ${await capabilities.connections.getAccessToken({ connectionRef: 'c1' })}`); } }))
    .rejects.toThrow(WITHHELD_ERROR_MESSAGE);
  await expect(runWith({ invoke: async ({ capabilities }) => { throw new Error('outer', { cause: new Error(await capabilities.connections.getAccessToken({ connectionRef: 'c1' })) }); } }))
    .rejects.toThrow(WITHHELD_ERROR_MESSAGE);
  const clean = Object.assign(new Error('Rate limited; retry later.'), { code: 'rate-limited', retryable: true });
  await expect(runWith({ invoke: async ({ capabilities }) => { await capabilities.connections.getAccessToken({ connectionRef: 'c1' }); throw clean; } })).rejects.toBe(clean);
  expect(FAKE_TOKEN.length).toBeGreaterThan(20);
});

test('a destructive tool always requires confirmation, even under direct host approval', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'fixture-tools', files: {
      [TOOLS_FILENAME]: toolsFile([declare({ name: 'wipe', effect: 'destructive', module: 'tools/wipe.mjs' })]),
      'tools/wipe.mjs': "export default { invoke: () => 'wiped', describeAffectedResources: ({ input }) => ['record ' + input.ref] };\n",
    } });
    const harness = createHarness();
    expect(await harness.refresh()).toEqual([]);
    expect(harness.tools.list({}).find(tool => tool.id === 'p_fixture_tools__wipe')?.requiresConfirmation).toBe(true);
    expect(await harness.projection.describeAffectedResources({ toolId: 'p_fixture_tools__wipe', input: { ref: 'r1' } })).toEqual({ effect: 'destructive', resources: ['record r1'] });
  });
});

test('an invalid affected-resources answer blocks confirmation', async () => {
  const { projection } = projectionFor();
  projection.sync({ loaded: [loaded('p', { effect: 'write' }, { invoke: () => 'ok', describeAffectedResources: () => [''] })], refusals: [] });
  await expect(projection.describeAffectedResources({ toolId: 'p_p__look', input: { ref: 'x' } }))
    .rejects.toThrow("Plugin tool 'p_p__look' returned an invalid affected-resources list; the call cannot be confirmed.");
});

test('disabling the plugin removes its tools, refuses authorized and direct calls and revokes retained capabilities', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'fixture-tools', files: {
      [TOOLS_FILENAME]: toolsFile([declare()]),
      'tools/look.mjs': 'export default { invoke: ({ input, capabilities }) => { globalThis.__keptCapabilities = capabilities; return { read: input.ref }; } };\n',
    } });
    const harness = createHarness();
    await harness.refresh();
    expect(await harness.invoke('p_fixture_tools__look', { ref: 'r1' })).toEqual({ read: 'r1' });
    const kept = (globalThis as { __keptCapabilities?: AgentPluginToolCapabilities }).__keptCapabilities!;
    delete (globalThis as { __keptCapabilities?: unknown }).__keptCapabilities;
    const pending = await harness.authorize('p_fixture_tools__look', { ref: 'r2' });
    const oldGeneration = harness.contributions.list({})[0]!;

    await setAgentPluginActivation({ workspaceRoot, pluginId: 'fixture-tools', enabled: false, actor: 'test' }, { origin: 'bundled' });
    expect(await harness.refresh()).toEqual([]);

    expect(harness.tools.has({ toolId: 'p_fixture_tools__look' })).toBe(false);
    await expect(pending()).rejects.toThrow('Plugin tool is disabled or was reloaded.');
    await expect(oldGeneration.tools[0]!.handler({ pluginId: 'fixture-tools', sdk: oldGeneration.sdk, auth: { access: 'member', workspaceId: 'w' }, input: { ref: 'r3' } }))
      .rejects.toThrow(REVOKED_MESSAGE);
    await expect(kept.connections.getAccessToken({ connectionRef: 'c1' })).rejects.toThrow(REVOKED_MESSAGE);
    await expect(kept.http.fetch({ url: 'https://api.example.test/' })).rejects.toThrow(REVOKED_MESSAGE);
    await expect(kept.limiter.check({ key: 'k' })).rejects.toThrow(REVOKED_MESSAGE);
    await expect(kept.artifacts.write({ name: 'a.csv', mediaType: 'text/csv', content: 'a' })).rejects.toThrow(REVOKED_MESSAGE);
    expect(harness.log.tokenRequests).toEqual([]);
  });
});
