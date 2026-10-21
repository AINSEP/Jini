/** Admin tools retain the screen's schema, capability, permission and revocation boundaries. */
import { describe, expect, test } from 'vitest';
import { buildAdminSurfaceActionTools } from '../action-tools.js';
import { createAdminSurfaceActionDispatcher } from '../action-dispatcher.js';
import { parseAdminSurfacesFile, type AdminSurfaceDescriptor } from '../descriptor.js';
import { createAdminSurfaceHandlerHost, type LoadedAdminSurfaceHandlers } from '../surface-handlers.js';
import { createAgentPluginToolProjection } from '../../lifecycle/tools/projection.js';
import { createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { fakeCapabilities } from '../../lifecycle/tools/__tests__/support.js';
import { createFakeSurfaceHost } from './surface-support.js';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';

const input = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } as const;
const context = { workspaceId: 'workspace', principalId: 'owner', pluginId: 'acme', surfaceId: 'account' };
function descriptor(effect?: unknown): AdminSurfaceDescriptor {
  const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{ id: 'account', title: 'Account', entry: 'index.html', handlerModule: 'handlers.mjs',
    actions: [{ name: 'save', input, result: { type: 'string' }, ...(effect === undefined ? {} : { effect }) }] }] }) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0]!;
}
function fixture() {
  const surface = descriptor();
  const fake = createFakeSurfaceHost();
  const issuedTokens = createIssuedTokenMemories();
  const host = createAdminSurfaceHandlerHost({ capabilities: fake.port, issuedTokens, hostKind: 'hosted' });
  const calls: unknown[] = [];
  const loaded: LoadedAdminSurfaceHandlers = { pluginId: 'acme', descriptor: { ...surface, handlerModule: 'handlers.mjs' }, module: { actions: {
    save: async ({ input: value, capabilities, context: scope }) => { calls.push({ value, scope }); await capabilities.state.set({ key: 'saved', value: 'yes' }); return 'saved'; },
  } } };
  host.sync({ loaded: [loaded], refusals: [] });
  let allowed = true;
  const tools = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: surface }], handlersFor: host.handlersFor,
    authorize: async ({ context: who }) => { expect(who).toEqual(context); if (!allowed) throw new Error('denied'); },
  });
  const call = (value: unknown) => tools[0]!.tool.handler({ pluginId: 'acme', auth: context, input: value });
  return { surface, host, tools, calls, call, deny: () => { allowed = false; }, fake, issuedTokens };
}

describe('admin action tools', () => {
  test('declares the effect with write as the default and rejects unknown/null effects', () => {
    expect(descriptor().actions[0]!.effect).toBe('write');
    expect(descriptor('read').actions[0]!.effect).toBe('read');
    expect(descriptor('destructive').actions[0]!.effect).toBe('destructive');
    expect(() => descriptor('execute')).toThrow(/effect/);
    expect(() => descriptor(null)).toThrow(/effect/);
  });
  test('namespaces surface/action and calls exactly the screen handler with its capability scope', async () => {
    const f = fixture();
    expect(f.tools[0]!.tool.name).toBe('account_save');
    expect(f.tools[0]!.tool.effect).toBe('write');
    const screen = createAdminSurfaceActionDispatcher({ descriptor: f.surface, handlers: f.host.handlersFor(context) });
    const payload = { value: 'hello' };
    expect(await f.call({ payload })).toEqual(await screen.dispatch({ action: 'save', payload, context }));
    expect(f.calls).toHaveLength(2);
    expect(f.fake.log.calls).toEqual(['acme:state.set:{"key":"saved"}', 'acme:state.set:{"key":"saved"}']);
    expect(f.fake.state.get('workspace\u0000acme\u0000saved')).toBe('yes');
  });
  test('enforces permission before any handler/capability call', async () => {
    const f = fixture(); f.deny();
    await expect(f.call({ payload: { value: 'hello' } })).rejects.toThrow('denied');
    expect(f.calls).toEqual([]); expect(f.fake.log.calls).toEqual([]);
  });
  test.each([{}, { payload: {} }, { payload: { value: 1 } }, { payload: { value: 'x', extra: true } }, { payload: { value: 'x' }, extra: true }])('refuses invalid input %j before execution and disclosure', async (bad) => {
    const f = fixture();
    await expect(f.call(bad)).rejects.toThrow(/payload/);
    expect(() => f.tools[0]!.describeAffectedResources({ input: bad })).toThrow(/payload/);
    expect(f.calls).toEqual([]);
  });
  test('uses dispatcher result validation and returns a browser URL without opening anything', async () => {
    const f = fixture();
    const tools = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: f.surface }], authorize: async () => {},
      handlersFor: () => ({ save: async () => ({ undeclared: true }) }),
    });
    expect(await tools[0]!.tool.handler({ pluginId: 'acme', auth: context, input: { payload: { value: 'hello' } } })).toMatchObject({ ok: false, error: { code: 'invalid-result' } });
    const links = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: f.surface }], authorize: async () => {}, handlersFor: () => ({ save: async () => 'https://auth.example.test/sign-in' }) });
    expect(await links[0]!.tool.handler({ pluginId: 'acme', auth: context, input: { payload: { value: 'hello' } } })).toEqual({ ok: true, result: 'https://auth.example.test/sign-in' });
  });
  test('shares projection withdrawal with executable tools; stale handlers cannot act', async () => {
    const f = fixture(); const registry = createPluginContributionRegistry({});
    const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, issuedTokens: f.issuedTokens,
      capabilities: () => fakeCapabilities({ tokenRequests: [], requests: [] }),
    });
    expect(projection.sync({ loaded: [], refusals: [], additionalTools: f.tools }).refusals).toEqual([]);
    const snapshot = registry.list({})[0]!;
    const held = snapshot.tools[0]!;
    expect(await projection.describeAffectedResources({ toolId: 'p_acme__account_save', input: { payload: { value: 'x' } } })).toEqual({ effect: 'write', resources: ['Account: save'] });
    projection.sync({ loaded: [], refusals: [] });
    expect(registry.list({})).toEqual([]);
    expect(await projection.describeAffectedResources({ toolId: 'p_acme__account_save', input: {} })).toBeNull();
    expect(() => held.handler({ pluginId: 'acme', sdk: snapshot.sdk, auth: { ...context, access: 'admin' }, input: { payload: { value: 'x' } } })).toThrow(/disabled/);
    expect(f.calls).toEqual([]);
  });
  test('refuses colliding ids across surface variants instead of selecting a handler', () => {
    const f = fixture(); const registry = createPluginContributionRegistry({});
    const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, issuedTokens: f.issuedTokens,
      capabilities: () => fakeCapabilities({ tokenRequests: [], requests: [] }),
    });
    const result = projection.sync({ loaded: [], refusals: [], additionalTools: [...f.tools, ...f.tools] });
    expect(result.refusals).toEqual(["agent tool 'p_acme__account_save' was not loaded: more than one contribution declares it"]);
    expect(registry.list({}).flatMap(row => row.tools)).toEqual([]);
  });
  test('a hand-built descriptor without an effect projects a write tool', () => {
    const { effect: _dropped, ...action } = descriptor().actions[0]!;
    const surface = { ...descriptor(), actions: [action] };
    const [tool] = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: surface }], handlersFor: () => ({}), authorize: async () => undefined });
    expect(tool!.tool.effect).toBe('write');
  });
  test('refuses an unauthenticated call before authorization or any handler runs', async () => {
    const f = fixture();
    const authorized: unknown[] = [];
    const tools = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: f.surface }], handlersFor: f.host.handlersFor,
      authorize: async input => { authorized.push(input); } });
    await expect(tools[0]!.tool.handler({ pluginId: 'acme', auth: { workspaceId: 'workspace' }, input: { payload: { value: 'x' } } }))
      .rejects.toThrow('Admin actions require an authenticated principal.');
    expect(authorized).toEqual([]);
    expect(f.calls).toEqual([]);
  });
  test('the optional run decorator wraps the same dispatch and can decorate its outcome', async () => {
    const f = fixture();
    const tools = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: f.surface }], handlersFor: f.host.handlersFor,
      authorize: async () => undefined }, { run: async ({ dispatch }) => ({ decorated: await dispatch() }) });
    const plain = await f.call({ payload: { value: 'hello' } });
    expect(await tools[0]!.tool.handler({ pluginId: 'acme', auth: context, input: { payload: { value: 'hello' } } })).toEqual({ decorated: plain });
    expect(f.calls).toHaveLength(2);
  });
  test('a live projected admin tool runs the same handler; an additional tool without an effect discloses as write', async () => {
    const f = fixture(); const registry = createPluginContributionRegistry({});
    const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, issuedTokens: f.issuedTokens,
      capabilities: () => fakeCapabilities({ tokenRequests: [], requests: [] }),
    });
    const tools = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: f.surface }], handlersFor: f.host.handlersFor, authorize: async () => undefined });
    const { effect: _dropped, ...withoutEffect } = tools[0]!.tool;
    const failing = { pluginId: 'acme', tool: { ...withoutEffect, name: 'account_probe' }, describeAffectedResources: () => { throw new Error('resource lookup failed'); } };
    const plain = { ...failing, tool: { ...withoutEffect, name: 'account_plain' }, describeAffectedResources: () => ['Account: plain'] };
    expect(projection.sync({ loaded: [], refusals: [], additionalTools: [...tools, failing, plain] }).refusals).toEqual([]);
    const snapshot = registry.list({})[0]!;
    const live = snapshot.tools.find(tool => tool.name === 'account_save')!;
    expect(await live.handler({ pluginId: 'acme', sdk: snapshot.sdk, auth: { ...context, access: 'admin' }, input: { payload: { value: 'live' } } })).toEqual(await f.call({ payload: { value: 'live' } }));
    expect(f.calls).toHaveLength(2);
    expect(await projection.describeAffectedResources({ toolId: 'p_acme__account_plain', input: {} })).toEqual({ effect: 'write', resources: ['Account: plain'] });
    await expect(projection.describeAffectedResources({ toolId: 'p_acme__account_probe', input: {} })).rejects.toThrow('resource lookup failed');
  });
});
