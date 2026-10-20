/**
 * @file Unit tests for the tool projection against a typed fake contribution registry (the real one is
 * exercised by the security and vertical-slice suites): schema compile faults, generation reuse and
 * replacement, a registry that refuses a generation, the inert site-plugin SDK slot, root-level schema
 * errors, and the affected-resources disclosure for unknown, withdrawn and read tools.
 */
import { describe, expect, test } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { createIssuedTokenMemories, type AgentPluginToolCapabilities } from '../capabilities.js';
import type { AgentPluginToolModule, LoadedAgentPluginTool } from '../definition.js';
import type { AgentPluginToolDescriptor } from '../manifest.js';
import { createAgentPluginToolProjection, type AgentPluginToolProjectionPorts, type AgentPluginToolSnapshot } from '../projection.js';

type Registry = AgentPluginToolProjectionPorts['registry'];

/** Fake registry keyed by plugin id; `failReplace` makes `replace` throw the given value. */
function fakeRegistry(optional: { failReplace?: unknown } = {}) {
  const held = new Map<string, AgentPluginToolSnapshot>();
  const calls = { replace: 0, detach: [] as string[] };
  const registry: Registry = {
    replace: ({ contributions }) => {
      calls.replace += 1;
      if (optional.failReplace !== undefined) throw optional.failReplace;
      held.set(contributions.pluginId, contributions);
    },
    detach: ({ pluginId }) => { calls.detach.push(pluginId); held.delete(pluginId); },
    list: () => [...held.values()],
  };
  return { registry, held, calls };
}

const capabilities = (): AgentPluginToolCapabilities => ({
  connections: { getAccessToken: async () => 'unused' },
  http: { fetch: async () => new Response('') },
  limiter: { check: async () => ({ allowed: true }) },
  state: { get: async () => null },
});

function projectionWith(registry: Registry) {
  return createAgentPluginToolProjection({
    registry, capabilities, issuedTokens: createIssuedTokenMemories(), toolIdFor: ({ pluginId, name }) => `p_${pluginId}__${name}`,
  });
}

function loaded(
  optional: { pluginId?: string; descriptor?: Partial<AgentPluginToolDescriptor>; module?: AgentPluginToolModule } = {},
): LoadedAgentPluginTool {
  const descriptor: AgentPluginToolDescriptor = {
    name: 'list_rows', description: 'Lists rows.', effect: 'read', module: 'tools/list.mjs',
    inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false }, ...optional.descriptor,
  };
  return { pluginId: optional.pluginId ?? 'acme-office', descriptor, module: optional.module ?? { invoke: () => 'ok' } };
}

describe('schema compilation', () => {
  test('a schema that throws a non-Error while compiling is refused with its text', () => {
    const { registry } = fakeRegistry();
    // Malformed input on purpose: a public-API caller can pass any object; JSON data cannot do this.
    const inputSchema = { type: 'object', get properties(): never { throw 'not an error'; } };
    expect(projectionWith(registry).sync({ loaded: [loaded({ descriptor: { inputSchema } })], refusals: [] }).refusals)
      .toEqual(["agent tool 'list_rows' from 'acme-office' was not loaded: its input schema is invalid (not an error)"]);
  });
});

describe('generations', () => {
  test('an unchanged reload keeps the same generation and does not replace it', () => {
    const { registry, calls, held } = fakeRegistry();
    const projection = projectionWith(registry);
    const tool = loaded();
    projection.sync({ loaded: [tool], refusals: [] });
    const first = held.get('acme-office');
    projection.sync({ loaded: [{ ...tool, descriptor: { ...tool.descriptor } }], refusals: [] });
    expect(calls.replace).toBe(1);
    expect(held.get('acme-office')).toBe(first);
  });

  test('a new module object for the same declaration replaces the generation', () => {
    const { registry, calls } = fakeRegistry();
    const projection = projectionWith(registry);
    projection.sync({ loaded: [loaded()], refusals: [] });
    projection.sync({ loaded: [loaded({ module: { invoke: () => 'new' } })], refusals: [] });
    expect(calls.replace).toBe(2);
  });

  test('a changed declaration with the same module replaces the generation', () => {
    const { registry, calls } = fakeRegistry();
    const projection = projectionWith(registry);
    const module: AgentPluginToolModule = { invoke: () => 'ok' };
    projection.sync({ loaded: [loaded({ module })], refusals: [] });
    projection.sync({ loaded: [loaded({ module, descriptor: { description: 'Lists rows, changed.' } })], refusals: [] });
    expect(calls.replace).toBe(2);
  });

  test('a different tool count replaces the generation', () => {
    const { registry, calls } = fakeRegistry();
    const projection = projectionWith(registry);
    const module: AgentPluginToolModule = { invoke: () => 'ok' };
    projection.sync({ loaded: [loaded({ module })], refusals: [] });
    projection.sync({ loaded: [loaded({ module }), loaded({ module, descriptor: { name: 'other' } })], refusals: [] });
    expect(calls.replace).toBe(2);
  });

  test('a registry that refuses an Error detaches the plugin and reports its message', () => {
    const { registry, calls } = fakeRegistry({ failReplace: new Error('id already taken') });
    const projection = projectionWith(registry);
    expect(projection.sync({ loaded: [loaded()], refusals: ['loader said so'] }).refusals)
      .toEqual(['loader said so', "agent tools from 'acme-office' were not loaded: id already taken"]);
    expect(calls.detach).toEqual(['acme-office']);
  });

  test('a registry that refuses a non-Error reports its text, and the tool is not described', async () => {
    const { registry } = fakeRegistry({ failReplace: 'busy' });
    const projection = projectionWith(registry);
    expect(projection.sync({ loaded: [loaded()], refusals: [] }).refusals).toEqual(["agent tools from 'acme-office' were not loaded: busy"]);
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: {} })).resolves.toBeNull();
  });
});

describe('the contract snapshot', () => {
  test('fills the site-plugin SDK slot with functions that refuse', () => {
    const { registry, held } = fakeRegistry();
    projectionWith(registry).sync({ loaded: [loaded()], refusals: [] });
    const sdk = held.get('acme-office')!.sdk as Record<string, unknown> & { content: Record<string, () => never>; routes: { add: () => never } };
    const message = 'Agent Plugin tools have no site-plugin SDK.';
    expect(() => sdk.content.read()).toThrow(message);
    expect(() => sdk.routes.add()).toThrow(message);
    expect(() => (sdk.addFilter as () => never)()).toThrow(message);
    expect(Object.isFrozen(sdk)).toBe(true);
  });

  test('input failing at the schema root is located at #', async () => {
    const { registry, held } = fakeRegistry();
    projectionWith(registry).sync({ loaded: [loaded({ descriptor: { inputSchema: { type: 'object', required: ['n'] } } })], refusals: [] });
    const tool = held.get('acme-office')!.tools[0]!;
    const call = tool.handler({ pluginId: 'acme-office', auth: { workspaceId: 'w' }, input: {} });
    await expect(call).rejects.toBeInstanceOf(ToolInputError);
    await expect(call).rejects.toThrow("Input for 'p_acme-office__list_rows' does not match its schema at # (required). Fix the input and retry.");
  });
});

describe('a call', () => {
  test('names at most three distinct failing locations', async () => {
    const { registry, held } = fakeRegistry();
    const nested = (depth: number): Record<string, unknown> => (depth === 0 ? { type: 'integer' } : { type: 'object', properties: { [`k${depth}`]: nested(depth - 1) } });
    projectionWith(registry).sync({ loaded: [loaded({ descriptor: { inputSchema: nested(4) } })], refusals: [] });
    const input = { k4: { k3: { k2: { k1: 'not an integer' } } } };
    await expect(held.get('acme-office')!.tools[0]!.handler({ pluginId: 'acme-office', auth: { workspaceId: 'w' }, input }))
      .rejects.toThrow("Input for 'p_acme-office__list_rows' does not match its schema at # (properties), #/k4 (properties), #/k4/k3 (properties). Fix the input and retry.");
  });

  test('scopes host capabilities to the caller and passes the abort signal to the host and the module', async () => {
    const { registry, held } = fakeRegistry();
    const scopes: unknown[] = [];
    const seen: (AbortSignal | undefined)[] = [];
    const projection = createAgentPluginToolProjection({
      registry, issuedTokens: createIssuedTokenMemories(), toolIdFor: ({ pluginId, name }) => `p_${pluginId}__${name}`,
      capabilities: (scope) => { scopes.push(scope); return capabilities(); },
    });
    projection.sync({ loaded: [loaded({ module: { invoke: ({ signal }) => { seen.push(signal); return 'done'; } } })], refusals: [] });
    const { signal } = new AbortController();
    const tool = held.get('acme-office')!.tools[0]!;
    await expect(tool.handler({ pluginId: 'acme-office', auth: { workspaceId: 'w', principalId: 'member-1' }, input: {}, signal })).resolves.toBe('done');
    await expect(tool.handler({ pluginId: 'acme-office', auth: { workspaceId: 'w' }, input: {} })).resolves.toBe('done');
    expect(scopes).toEqual([{ pluginId: 'acme-office', workspaceId: 'w', principalId: 'member-1', signal }, { pluginId: 'acme-office', workspaceId: 'w' }]);
    expect(seen).toEqual([signal, undefined]);
  });

  test('every tool of one plugin is projected in one generation, in declaration order', () => {
    const { registry, held } = fakeRegistry();
    projectionWith(registry).sync({ loaded: [loaded(), loaded({ descriptor: { name: 'append_row' } })], refusals: [] });
    expect(held.get('acme-office')!.tools.map(tool => tool.name)).toEqual(['list_rows', 'append_row']);
  });
});

describe('describeAffectedResources', () => {
  test('is null for a tool id no plugin projected', async () => {
    const { registry } = fakeRegistry();
    const projection = projectionWith(registry);
    projection.sync({ loaded: [loaded()], refusals: [] });
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__missing', input: {} })).resolves.toBeNull();
  });

  test('is null once the registry no longer holds the generation', async () => {
    const { registry, held } = fakeRegistry();
    const projection = projectionWith(registry);
    projection.sync({ loaded: [loaded()], refusals: [] });
    held.clear();
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: {} })).resolves.toBeNull();
  });

  test('a read tool without a disclosure hook discloses no resources', async () => {
    const { registry } = fakeRegistry();
    const projection = projectionWith(registry);
    projection.sync({ loaded: [loaded()], refusals: [] });
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: { n: 1 } })).resolves.toEqual({ effect: 'read', resources: [] });
  });

  test('a write tool discloses a frozen copy of what its hook returns', async () => {
    const { registry } = fakeRegistry();
    const projection = projectionWith(registry);
    const answer = ['Row 1 of Sheet A'];
    projection.sync({ loaded: [loaded({ descriptor: { effect: 'write' }, module: { invoke: () => 'ok', describeAffectedResources: () => answer } })], refusals: [] });
    const disclosure = await projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: { n: 1 } });
    expect(disclosure).toEqual({ effect: 'write', resources: ['Row 1 of Sheet A'] });
    expect(disclosure?.resources).not.toBe(answer);
    expect(Object.isFrozen(disclosure?.resources)).toBe(true);
  });

  test.each([
    ['more than 50 entries', Array.from({ length: 51 }, (_, index) => `r${index}`)],
    ['an empty entry', ['']],
    ['an entry over 300 characters', ['r'.repeat(301)]],
    ['a non-string entry', [7]],
    ['a non-array answer', 'r1'],
  ])('a hook answer with %s blocks confirmation', async (_label, answer) => {
    const { registry } = fakeRegistry();
    const projection = projectionWith(registry);
    projection.sync({ loaded: [loaded({ descriptor: { effect: 'destructive' }, module: { invoke: () => 'ok', describeAffectedResources: () => answer } })], refusals: [] });
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: {} }))
      .rejects.toThrow("Plugin tool 'p_acme-office__list_rows' returned an invalid affected-resources list; the call cannot be confirmed. Report it to the plugin author.");
  });

  test('accepts exactly 50 entries of 300 characters', async () => {
    const { registry } = fakeRegistry();
    const projection = projectionWith(registry);
    const answer = Array.from({ length: 50 }, () => 'r'.repeat(300));
    projection.sync({ loaded: [loaded({ descriptor: { effect: 'write' }, module: { invoke: () => 'ok', describeAffectedResources: () => answer } })], refusals: [] });
    await expect(projection.describeAffectedResources({ toolId: 'p_acme-office__list_rows', input: {} })).resolves.toMatchObject({ resources: answer });
  });
});
