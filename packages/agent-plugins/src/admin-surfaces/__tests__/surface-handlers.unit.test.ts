/**
 * @file Unit tests for the plugin handler host paths the security suite leaves at their edges: the
 * `fail` helper's retryable flag and 300-character message cap, a declared action the module does
 * not answer staying unavailable, and a changed declaration (same module object) starting a new
 * generation that revokes the old handlers. The host runs over the shared typed fake capabilities.
 */
import { describe, expect, test } from 'vitest';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import { createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { createAdminSurfaceActionDispatcher } from '../action-dispatcher.js';
import { parseAdminSurfacesFile, type AdminSurfaceDescriptor } from '../descriptor.js';
import { ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE, createAdminSurfaceHandlerHost, type AdminSurfaceHandlerModule, type LoadedAdminSurfaceHandlers } from '../surface-handlers.js';
import { createFakeSurfaceHost } from './surface-support.js';

const PLUGIN = 'acme-office';
const CONTEXT = { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: PLUGIN, surfaceId: 'settings' };
const INPUT = { type: 'object' } as const;
const RESULT = { type: 'boolean' } as const;

function descriptorOf(overrides: Record<string, unknown> = {}): AdminSurfaceDescriptor & { readonly handlerModule: string } {
  const raw = JSON.stringify({ schemaVersion: 1, surfaces: [{
    id: 'settings', title: 'Settings', entry: 'surface/index.html', handlerModule: 'server/handlers.mjs',
    actions: [{ name: 'save', input: INPUT, result: RESULT }, { name: 'reset', input: INPUT, result: RESULT }], ...overrides,
  }] });
  const parsed = parseAdminSurfacesFile({ raw });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0] as AdminSurfaceDescriptor & { readonly handlerModule: string };
}

function hostWith(entries: readonly LoadedAdminSurfaceHandlers[]) {
  const { port } = createFakeSurfaceHost();
  const host = createAdminSurfaceHandlerHost({ hostKind: 'desktop', issuedTokens: createIssuedTokenMemories(), capabilities: port });
  expect(host.sync({ loaded: entries, refusals: [] }).refusals).toEqual([]);
  return host;
}

describe('the fail helper', () => {
  test('keeps an explicit retryable flag', async () => {
    const module: AdminSurfaceHandlerModule = { actions: { save: ({ fail }) => { throw fail({ code: 'rate-limited', message: 'Try again in a minute.' }, { retryable: true }); } } };
    const handler = hostWith([{ descriptor: descriptorOf(), pluginId: PLUGIN, module }]).handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!;
    await expect(handler({ payload: {}, context: CONTEXT })).rejects.toMatchObject({ code: 'rate-limited', retryable: true });
  });

  test('cuts a plugin failure message to 300 characters', async () => {
    const module: AdminSurfaceHandlerModule = { actions: { save: ({ fail }) => { throw fail({ code: 'sheet-missing', message: 'm'.repeat(400) }); } } };
    const handler = hostWith([{ descriptor: descriptorOf(), pluginId: PLUGIN, module }]).handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!;
    await expect(handler({ payload: {}, context: CONTEXT })).rejects.toMatchObject({ code: 'sheet-missing', message: 'm'.repeat(300), retryable: false });
  });
});

test('a declared action the module does not answer stays unavailable', async () => {
  const descriptor = descriptorOf();
  const host = hostWith([{ descriptor, pluginId: PLUGIN, module: { actions: { save: () => true } } }]);
  const handlers = host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' });
  expect(Object.keys(handlers)).toEqual(['save']);
  const dispatcher = createAdminSurfaceActionDispatcher({ descriptor, handlers });
  await expect(dispatcher.dispatch({ action: 'reset', payload: {}, context: CONTEXT }))
    .resolves.toEqual({ ok: false, error: { code: 'action-unavailable', message: 'This action is not available on this host.', retryable: false } });
});

test('a changed declaration with the same module object starts a new generation and revokes the old handlers', async () => {
  const module: AdminSurfaceHandlerModule = { actions: { save: () => true } };
  const { port } = createFakeSurfaceHost();
  const host = createAdminSurfaceHandlerHost({ hostKind: 'hosted', issuedTokens: createIssuedTokenMemories(), capabilities: port });
  host.sync({ loaded: [{ descriptor: descriptorOf(), pluginId: PLUGIN, module }], refusals: [] });
  const old = host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!;
  host.sync({ loaded: [{ descriptor: descriptorOf({ title: 'Settings (renamed)' }), pluginId: PLUGIN, module }], refusals: [] });
  await expect(old({ payload: {}, context: CONTEXT })).rejects.toMatchObject({ code: 'plugin-disabled', message: ADMIN_SURFACE_PLUGIN_DISABLED_MESSAGE });
  await expect(host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!({ payload: {}, context: CONTEXT })).resolves.toBe(true);
});

test("an assistant call's signal reaches the host capabilities port, so the host can pin the accounts its card froze", async () => {
  const { port } = createFakeSurfaceHost();
  const scopes: unknown[] = [];
  const host = createAdminSurfaceHandlerHost({ hostKind: 'hosted', issuedTokens: createIssuedTokenMemories(), capabilities: (scope) => { scopes.push(scope); return port(scope); } });
  host.sync({ loaded: [{ descriptor: descriptorOf(), pluginId: PLUGIN, module: { actions: { save: () => true } } }], refusals: [] });
  const save = host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }).save!;
  const { signal } = new AbortController();
  await save({ payload: {}, context: { ...CONTEXT, signal } });
  await save({ payload: {}, context: CONTEXT });
  expect(scopes).toEqual([{ pluginId: PLUGIN, workspaceId: WORKSPACE_ID, principalId: 'admin-1', signal }, { pluginId: PLUGIN, workspaceId: WORKSPACE_ID, principalId: 'admin-1' }]);
  expect((scopes[0] as { signal?: AbortSignal }).signal).toBe(signal);
});
