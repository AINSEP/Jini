/**
 * @file Security pins (phase A) for plugin-supplied admin-surface handlers: the handler module is
 * contained and never served, it loads only through the executable trust gate (active, shipped
 * digest, on-disk containment), it may answer only declared actions, its answers are schema-checked
 * and token-scanned before reaching the frame, and disabling the plugin revokes everything it holds.
 */
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createPluginContributionLoader } from '../../lifecycle/contribution-loader.js';
import { findTrustedPluginPackages, importContainedModule, readTrustedPluginFile, setAgentPluginActivation } from '../../lifecycle/__tests__/test-support.js';
import type { AgentPluginToolCapabilities } from '../../lifecycle/tools/capabilities.js';
import { fakeCapabilities, FAKE_TOKEN, installPlugin, WORKSPACE_ID, withWorkspace } from '../../lifecycle/tools/__tests__/support.js';
import {
  ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE, createAdminSurfaceActionDispatcher, createAdminSurfaceHandlerHost, defineAdminSurfaceHandlerContribution, parseAdminSurfacesFile, readAdminSurfaceFile,
  type AdminSurfaceDescriptor, type AdminSurfaceHandlerModule, type LoadedAdminSurfaceHandlers,
} from '../index.js';

const FILENAME = 'host-admin-surfaces.json';
const PLUGIN = 'fixture-surface';
const CONTEXT = { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: PLUGIN, surfaceId: 'settings' };
const input = { type: 'object', properties: { name: { type: 'string', maxLength: 20 } }, required: ['name'] } as const;
const result = { type: 'object', properties: { saved: { type: 'boolean' } }, required: ['saved'] } as const;
const bootstrap = { type: 'object', properties: { accessToken: { type: 'string' } }, required: ['accessToken'] } as const;
const surface = (overrides: Record<string, unknown> = {}) => ({
  id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'],
  actions: [{ name: 'save', input, result }], handlerModule: 'server/handlers.mjs', ...overrides,
});
const surfacesFile = (overrides: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, surfaces: [surface(overrides)] });
const reasonFor = (overrides: Record<string, unknown>) => {
  const parsed = parseAdminSurfacesFile({ raw: surfacesFile(overrides) });
  return parsed.ok ? 'accepted' : parsed.reason;
};
function descriptorOf(overrides: Record<string, unknown> = {}): AdminSurfaceDescriptor & { readonly handlerModule: string } {
  const parsed = parseAdminSurfacesFile({ raw: surfacesFile(overrides) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0] as AdminSurfaceDescriptor & { readonly handlerModule: string };
}
const loaded = (module: AdminSurfaceHandlerModule, overrides: Record<string, unknown> = {}, pluginId = PLUGIN): LoadedAdminSurfaceHandlers => ({ descriptor: descriptorOf(overrides), pluginId, module });
const saveModule = (save: AdminSurfaceHandlerModule['actions'][string]): AdminSurfaceHandlerModule => ({ actions: { save } });

/** A host over typed fake capabilities; records which plugin each capability set was scoped to. */
function hostFor(entries: readonly LoadedAdminSurfaceHandlers[]) {
  const scopes: string[] = [];
  const log = { tokenRequests: [] as string[], requests: [] };
  const host = createAdminSurfaceHandlerHost({ capabilities: (scope) => { scopes.push(scope.pluginId); return fakeCapabilities(log); } });
  const { refusals } = host.sync({ loaded: entries, refusals: [] });
  return { host, refusals, scopes, log };
}
const dispatcherFor = (host: ReturnType<typeof hostFor>['host'], descriptor = descriptorOf()) => createAdminSurfaceActionDispatcher({ descriptor, handlers: host.handlersFor({ pluginId: PLUGIN, surfaceId: descriptor.id }) });

describe('the handler module is contained server code', () => {
  test.each(['../handlers.mjs', '/abs/handlers.mjs', 'server/../../handlers.mjs', '%2e%2e/handlers.mjs', 'server\\handlers.mjs', 'server/handlers.js'])('handlerModule %j is refused', (handlerModule) => {
    expect(reasonFor({ handlerModule })).toBe('surfaces[0].handlerModule must be a plain relative path ending in .mjs');
  });
  test('a handler module that is also a served file is refused', () => {
    expect(reasonFor({ files: ['surface/app.mjs', 'server/handlers.mjs'] })).toBe('surfaces[0].handlerModule is server code and may not also be served to the frame');
  });
  test('every action of a surface with a handler module must declare a result schema', () => {
    expect(reasonFor({ actions: [{ name: 'save', input, result }, { name: 'peek', input }] })).toBe('surfaces[0].actions[1] must declare a result schema when the surface has a handlerModule');
  });
  test('a bootstrap schema without a handler module, or outside the schema subset, is refused', () => {
    expect(reasonFor({ handlerModule: undefined, bootstrap })).toBe('surfaces[0].bootstrap needs a handlerModule that provides it');
    expect(reasonFor({ bootstrap: { type: 'string', pattern: '.*' } })).toBe("surfaces[0].bootstrap uses unsupported keyword 'pattern'");
  });
  test('the handler module is never served to the frame', async () => {
    let reads = 0;
    const served = await readAdminSurfaceFile({ surface: { plugin: { pluginId: PLUGIN, packageRoot: '/nowhere' }, descriptor: descriptorOf() }, path: 'server/handlers.mjs', readFile: async () => { reads += 1; return 'x'; } });
    expect(served).toEqual({ ok: false, reason: 'not-declared' });
    expect(reads).toBe(0);
  });
});

describe('the handler module loads only through the executable trust gate', () => {
  const HANDLERS = 'export default { actions: { async save() { return { saved: true }; } } };\n';
  const loader = createPluginContributionLoader({
    findPackages: (query) => findTrustedPluginPackages(query),
    readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename),
    importModule: ({ plugin, modulePath }) => importContainedModule(plugin, modulePath),
  });
  const definition = defineAdminSurfaceHandlerContribution({ filename: FILENAME });
  const files = { [FILENAME]: surfacesFile(), 'surface/index.html': '<!doctype html>', 'surface/app.mjs': 'export {};', 'server/handlers.mjs': HANDLERS };

  test('an active, bundled plugin loads its handler module', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await installPlugin({ workspaceRoot, pluginId: PLUGIN, files });
      const load = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition });
      expect(load.refusals).toEqual([]);
      expect(load.items.map((item) => [item.pluginId, item.descriptor.id])).toEqual([[PLUGIN, 'settings']]);
    });
  });
  test('an inactive plugin loads nothing, even when the host asks not to require activation', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await installPlugin({ workspaceRoot, pluginId: PLUGIN, files }, { enabled: false });
      expect(await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition }, { requireActive: false })).toEqual({ items: [], refusals: [] });
    });
  });
  test('a package whose digest is not the shipped one is refused', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await installPlugin({ workspaceRoot, pluginId: PLUGIN, files }, { bundled: false });
      const load = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition });
      expect(load.items).toEqual([]);
      expect(load.refusals).toEqual([expect.stringMatching(/^admin surface handlers from 'fixture-surface' were not loaded: only plugins shipped with .+ may add admin surface handlers/)]);
    });
  });
  test('a handler module that is a symlink out of the plugin root is refused before import', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'surface-outside-'));
    try {
      await writeFile(path.join(outside, 'handlers.mjs'), HANDLERS);
      await withWorkspace(async (workspaceRoot) => {
        const { 'server/handlers.mjs': _omitted, ...rest } = files;
        await installPlugin({ workspaceRoot, pluginId: PLUGIN, files: { ...rest, 'server/keep.json': '{}' } });
        const [verdict] = await findTrustedPluginPackages({ workspaceId: WORKSPACE_ID, filename: FILENAME, contribution: 'x', requireActive: true });
        if (!verdict || !('trusted' in verdict)) throw new Error('fixture package was not trusted');
        await symlink(path.join(outside, 'handlers.mjs'), path.join(verdict.trusted.packageRoot, 'server/handlers.mjs'));
        expect(await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition })).toEqual({ items: [],
          refusals: ["admin surface handlers for 'settings' from 'fixture-surface' were not loaded: module path 'server/handlers.mjs' escapes the plugin root"] });
      });
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

describe('the handler module export is checked before admission', () => {
  const definition = defineAdminSurfaceHandlerContribution({ filename: FILENAME });
  const plugin = { pluginId: PLUGIN, packageRoot: '/nowhere' };
  test.each([
    [null, "its module's default export is not an object"],
    [{ bootstrap: async () => ({}) }, "its module's default export needs an actions object of functions"],
    [{ actions: { save: 'not code' } }, "its module's default export needs an actions object of functions"],
    [{ actions: {}, bootstrap: { data: 1 } }, 'bootstrap must be a function'],
  ])('export %j is refused', async (exported, reason) => {
    expect(await definition.load({ plugin, descriptor: descriptorOf(), importModule: async () => ({ exported }) }))
      .toBe(`admin surface handlers for 'settings' from 'fixture-surface' were not loaded: ${reason}`);
  });
  test('an invalid surfaces file refuses every handler, and surfaces without a handler module import nothing', () => {
    expect(definition.parse({ raw: '{' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(definition.parse({ raw: surfacesFile({ handlerModule: undefined }) })).toEqual({ ok: true, descriptors: [] });
  });
});

describe('admission at sync', () => {
  test('a module that exports a handler for an undeclared action is refused whole', () => {
    const { host, refusals } = hostFor([loaded({ actions: { save: async () => ({ saved: true }), purge: async () => ({}) } })]);
    expect(refusals).toEqual(["admin surface handlers for 'settings' from 'fixture-surface' were not loaded: it exports a handler for undeclared action 'purge'"]);
    expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' })).toEqual({});
  });
  test('a module that provides bootstrap data the surface declares no schema for is refused', () => {
    const { refusals } = hostFor([loaded({ actions: {}, bootstrap: async () => ({}) })]);
    expect(refusals).toEqual(["admin surface handlers for 'settings' from 'fixture-surface' were not loaded: it exports bootstrap() but the surface declares no bootstrap schema"]);
  });
  test('two loaded handler sets for the same plugin and surface are both refused (ambiguous)', () => {
    const module = saveModule(async () => ({ saved: true }));
    const { host, refusals } = hostFor([loaded(module), loaded(module)]);
    expect(refusals).toEqual(["admin surface handlers for 'settings' from 'fixture-surface' were not loaded: more than one handler module claims this surface"]);
    expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' })).toEqual({});
  });
});

describe('dispatch through plugin handlers', () => {
  test('an undeclared action is refused and no plugin code runs', async () => {
    let ran = 0;
    const { host } = hostFor([loaded(saveModule(async () => { ran += 1; return { saved: true }; }))]);
    expect(await dispatcherFor(host).dispatch({ action: 'purge', payload: { name: 'x' }, context: CONTEXT }))
      .toEqual({ ok: false, error: { code: 'action-undeclared', message: 'This surface did not declare that action.', retryable: false } });
    expect(ran).toBe(0);
  });
  test('a result outside the declared result schema never reaches the frame', async () => {
    const { host } = hostFor([loaded(saveModule(async () => ({ saved: 'yes', extra: 'leak' })))]);
    expect(await dispatcherFor(host).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT }))
      .toEqual({ ok: false, error: { code: 'invalid-result', message: 'The host returned a result this surface did not declare.', retryable: false } });
  });
  test('a result that carries an access token the call obtained is withheld', async () => {
    // The result schema admits a `token` string, so only the token scan can stop this answer.
    const overrides = { actions: [{ name: 'save', input, result: { type: 'object', properties: { token: { type: 'string' } } } }] };
    const leaky = saveModule(async ({ capabilities }) => ({ token: await capabilities.connections.getAccessToken({ connectionRef: 'c1' }) }));
    const errors: unknown[] = [];
    const { host } = hostFor([loaded(leaky, overrides)]);
    const descriptor = descriptorOf(overrides);
    const dispatcher = createAdminSurfaceActionDispatcher({ descriptor, handlers: host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }) }, { onHandlerError: ({ error }) => errors.push(error) });
    const outcome = await dispatcher.dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT });
    expect(outcome).toEqual({ ok: false, error: { code: 'action-failed', message: 'The action failed. Try again; if it keeps failing, check the server log.', retryable: true } });
    expect(JSON.stringify(outcome)).not.toContain(FAKE_TOKEN);
    expect((errors[0] as Error).message).toBe('The plugin tool result was withheld because it contained a connection credential.');
  });
  test('a plugin failure keeps its surface-safe code, but one that mentions an obtained token is replaced', async () => {
    const failing = (withToken: boolean) => saveModule(async ({ capabilities, fail }) => {
      const token = await capabilities.connections.getAccessToken({ connectionRef: 'c1' });
      throw fail({ code: 'reconnect-required', message: withToken ? `token ${token} expired` : 'Reconnect the account and retry.' }, { retryable: false });
    });
    const clean = await dispatcherFor(hostFor([loaded(failing(false))]).host).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT });
    expect(clean).toEqual({ ok: false, error: { code: 'reconnect-required', message: 'Reconnect the account and retry.', retryable: false } });
    const leaky = await dispatcherFor(hostFor([loaded(failing(true))]).host).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT });
    expect(leaky).toEqual({ ok: false, error: { code: 'action-failed', message: 'The action failed. Try again; if it keeps failing, check the server log.', retryable: true } });
  });
  test('a failure code outside the id format is not passed through', async () => {
    const { host } = hostFor([loaded(saveModule(async ({ fail }) => { throw fail({ code: 'Action Undeclared!', message: 'spoof' }); }))]);
    expect(await dispatcherFor(host).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT }))
      .toEqual({ ok: false, error: { code: 'action-failed', message: 'The action failed. Try again; if it keeps failing, check the server log.', retryable: true } });
  });
  test('capabilities and context are scoped to the plugin that was loaded, not the ids the caller passes', async () => {
    const seen: unknown[] = [];
    const { host, scopes } = hostFor([loaded(saveModule(async ({ context, capabilities }) => { seen.push(context); await capabilities.limiter.check({ key: 'k' }); return { saved: true }; }))]);
    await dispatcherFor(host).dispatch({ action: 'save', payload: { name: 'x' }, context: { ...CONTEXT, pluginId: 'other-plugin', surfaceId: 'other' } });
    expect(scopes).toEqual([PLUGIN]);
    expect(seen).toEqual([{ workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: PLUGIN, surfaceId: 'settings' }]);
  });
});

describe('bootstrap data', () => {
  const withBootstrap = (provide: AdminSurfaceHandlerModule['bootstrap']) => hostFor([loaded({ actions: {}, ...(provide ? { bootstrap: provide } : {}) }, { actions: [], bootstrap })]).host;
  test('bootstrap data is the one channel that may carry a short-lived access token, and only inside its schema', async () => {
    const host = withBootstrap(async ({ capabilities }) => ({ accessToken: await capabilities.connections.getAccessToken({ connectionRef: 'c1' }) }));
    expect(await host.bootstrapData({ context: CONTEXT })).toEqual({ accessToken: FAKE_TOKEN });
  });
  test('bootstrap data outside its schema is refused without echoing the value', async () => {
    const host = withBootstrap(async () => ({ accessToken: 'abc', refreshToken: 'secret-value' }));
    const error = await host.bootstrapData({ context: CONTEXT }).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Admin surface \'settings\' from \'fixture-surface\' returned bootstrap data outside its declared schema ($ has an undeclared property "refreshToken"); report it to the plugin author.');
    expect((error as Error).message).not.toContain('secret-value');
  });
  test('a bootstrap failure that mentions an obtained token is replaced', async () => {
    const host = withBootstrap(async ({ capabilities }) => { throw new Error(`denied ${await capabilities.connections.getAccessToken({ connectionRef: 'c1' })}`); });
    await expect(host.bootstrapData({ context: CONTEXT })).rejects.toThrow(/^The plugin tool failed and its error was withheld because it contained a connection credential\.$/);
  });
  test('a surface without a bootstrap provider starts with null', async () => {
    expect(await withBootstrap(undefined).bootstrapData({ context: CONTEXT })).toBeNull();
  });
});

describe('disabling the plugin revokes its handlers', () => {
  test('a retained handler is refused, a retained capability is revoked and bootstrap data stops', async () => {
    let retained: AgentPluginToolCapabilities | undefined;
    const module: AdminSurfaceHandlerModule = {
      actions: { save: async ({ capabilities }) => { retained = capabilities; return { saved: true }; } },
      bootstrap: async () => ({ accessToken: 'a' }),
    };
    const { host } = hostFor([loaded(module, { bootstrap })]);
    const descriptor = descriptorOf({ bootstrap });
    const handlers = host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' });
    expect(await createAdminSurfaceActionDispatcher({ descriptor, handlers }).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT })).toEqual({ ok: true, result: { saved: true } });

    expect(host.sync({ loaded: [], refusals: [] })).toEqual({ refusals: [] });
    expect(await createAdminSurfaceActionDispatcher({ descriptor, handlers }).dispatch({ action: 'save', payload: { name: 'x' }, context: CONTEXT }))
      .toEqual({ ok: false, error: { code: 'plugin-disabled', message: 'This plugin was disabled, so its admin surface cannot act. Re-enable the plugin and reopen the surface.', retryable: false } });
    await expect(retained!.connections.getAccessToken({ connectionRef: 'c1' })).rejects.toThrow('This plugin tool was disabled; its capabilities are revoked. Re-enable the plugin and retry.');
    expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' })).toEqual({});
    expect(await host.bootstrapData({ context: CONTEXT })).toBeNull();
  });
  test('re-syncing an unchanged module keeps its handlers live; a changed module revokes the old ones', async () => {
    const module = saveModule(async () => ({ saved: true }));
    const { host } = hostFor([loaded(module)]);
    const first = host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' });
    host.sync({ loaded: [loaded(module)], refusals: [] });
    expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' })).toBe(first);
    host.sync({ loaded: [loaded(saveModule(async () => ({ saved: false })))], refusals: [] });
    await expect(first.save!({ payload: { name: 'x' }, context: CONTEXT })).rejects.toThrow(ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE);
    expect(await host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!({ payload: { name: 'x' }, context: CONTEXT })).toEqual({ saved: false });
  });
  test('a real deactivation removes the handlers on the next load and sync', async () => {
    const loader = createPluginContributionLoader({
      findPackages: (query) => findTrustedPluginPackages(query),
      readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename),
      importModule: ({ plugin, modulePath }) => importContainedModule(plugin, modulePath),
    });
    const definition = defineAdminSurfaceHandlerContribution({ filename: FILENAME });
    await withWorkspace(async (workspaceRoot) => {
      await installPlugin({ workspaceRoot, pluginId: PLUGIN, files: { [FILENAME]: surfacesFile(), 'surface/index.html': '<!doctype html>', 'surface/app.mjs': 'export {};',
        'server/handlers.mjs': 'export default { actions: { async save() { return { saved: true }; } } };\n' } });
      const host = createAdminSurfaceHandlerHost({ capabilities: () => fakeCapabilities({ tokenRequests: [], requests: [] }) });
      host.sync(await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition }).then(({ items, refusals }) => ({ loaded: items, refusals })));
      expect(Object.keys(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }))).toEqual(['save']);
      await setAgentPluginActivation({ workspaceRoot, pluginId: PLUGIN, enabled: false, actor: 'test' }, { origin: 'bundled' });
      host.sync(await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition }).then(({ items, refusals }) => ({ loaded: items, refusals })));
      expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' })).toEqual({});
    });
  });
});
