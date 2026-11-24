/**
 * @file Unit tests for `handlers.ts`: the site's admin-surface handler host loads the active
 * plugins' handler modules (at refresh and before every bootstrap), logs (to the injected sink) and returns refusals,
 * exposes the sign-in collector only when given, and drops a plugin the next load no longer returns.
 * Typed fakes for the loader and the capability port; vendor-neutral ids.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { parseAdminSurfacesFile, type AdminSurfaceCapabilitiesPort, type AdminSurfaceHandlerModule, type LoadedAdminSurfaceHandlers } from '../../../admin-surfaces/index.js';
import { createIssuedSignInCollector } from '../../../admin-surfaces/node.js';
import { createIssuedTokenMemories } from '../../../lifecycle/tools/index.js';

import { createAgentPluginAdminSurfaceHandlers, type LoadAdminSurfaceHandlers } from '../handlers.js';

const ADMIN_SURFACES_FILENAME = 'host-admin-surfaces.json';

const CONTEXT = { workspaceId: 'ws-1', principalId: 'owner', pluginId: 'acme-office', surfaceId: 'connection-settings' } as const;

const unused = async (): Promise<never> => { throw new Error('these handlers never use a capability'); };
// Every call opens a capability session, so the port must answer; the fake modules never use one.
const capabilities: AdminSurfaceCapabilitiesPort = () => ({
  http: { fetch: unused }, limiter: { check: unused }, publicConfig: { get: unused },
  state: { get: unused, set: unused, delete: unused },
  connections: { getAccessToken: unused, status: unused, begin: unused, confirmSwitch: unused, cancelSwitch: unused, disconnect: unused, takeCallbackFields: unused },
});

function loadedHandlers(module: AdminSurfaceHandlerModule): LoadedAdminSurfaceHandlers {
  const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{
    id: CONTEXT.surfaceId, title: 'Manage connection', entry: 'surface/index.html', files: ['surface/app.mjs'], handlerModule: 'server/handlers.mjs',
    bootstrap: { type: 'object', properties: { greeting: { type: 'string', maxLength: 16 } }, required: ['greeting'] },
    actions: [{ name: 'ping', input: { type: 'object', properties: {} }, result: { type: 'object', properties: { pong: { type: 'boolean' } }, required: ['pong'] } }],
    csp: {},
  }] }) });
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  const descriptor = parsed.descriptors[0]!;
  assert.ok(descriptor.handlerModule !== undefined);
  return { pluginId: CONTEXT.pluginId, descriptor: { ...descriptor, handlerModule: descriptor.handlerModule }, module };
}

const module: AdminSurfaceHandlerModule = { actions: { ping: async () => ({ pong: true }) }, bootstrap: async () => ({ greeting: 'hello' }) };

function harness(loads: Array<{ items: readonly LoadedAdminSurfaceHandlers[]; refusals: readonly string[] }>, { log = () => {}, ...optional }: Parameters<typeof createAgentPluginAdminSurfaceHandlers>[1] & { log?: (line: string) => void } = {}) {
  const calls: Array<{ workspaceId: string; filename: string; orderByPluginId: boolean | undefined }> = [];
  const loadContributions: LoadAdminSurfaceHandlers = async ({ workspaceId, definition }, { orderByPluginId }) => {
    calls.push({ workspaceId, filename: definition.filename, orderByPluginId });
    return loads[Math.min(calls.length - 1, loads.length - 1)]!;
  };
  const host = createAgentPluginAdminSurfaceHandlers({ workspaceId: 'ws-1', filename: ADMIN_SURFACES_FILENAME, log, loadContributions, capabilities, issuedTokens: createIssuedTokenMemories(), hostKind: 'hosted' }, optional);
  return { host, calls };
}

test('refresh loads the handler contribution for the site workspace, ordered by plugin id', async () => {
  const { host, calls } = harness([{ items: [], refusals: [] }], { log: () => {} });
  await host.refresh();
  assert.deepEqual(calls, [{ workspaceId: 'ws-1', filename: ADMIN_SURFACES_FILENAME, orderByPluginId: true }]);
});

test('refresh returns the refusal lines and logs each one', async () => {
  const lines: string[] = [];
  const { host } = harness([{ items: [], refusals: ['handlers for x were not loaded: bad module'] }], { log: (line) => lines.push(line) });
  assert.deepEqual(await host.refresh(), ['handlers for x were not loaded: bad module']);
  assert.deepEqual(lines, ['handlers for x were not loaded: bad module']);
});

test('an admitted module answers through handlersFor after a refresh', async () => {
  const { host } = harness([{ items: [loadedHandlers(module)], refusals: [] }], { log: () => {} });
  assert.deepEqual(Object.keys(host.handlersFor({ pluginId: CONTEXT.pluginId, surfaceId: CONTEXT.surfaceId })), []);
  await host.refresh();
  const ping = host.handlersFor({ pluginId: CONTEXT.pluginId, surfaceId: CONTEXT.surfaceId }).ping;
  assert.equal(typeof ping, 'function');
  assert.deepEqual(await ping!({ payload: {}, context: CONTEXT }), { pong: true });
});

test('every bootstrap reloads first, so a plugin enabled since boot is served without a restart', async () => {
  const { host, calls } = harness([{ items: [], refusals: [] }, { items: [loadedHandlers(module)], refusals: [] }], { log: () => {} });
  await host.refresh();
  assert.deepEqual(await host.bootstrapData({ context: CONTEXT }), { greeting: 'hello' });
  assert.equal(calls.length, 2);
});

test('a plugin the next load no longer returns loses its handlers and its bootstrap data', async () => {
  const { host } = harness([{ items: [loadedHandlers(module)], refusals: [] }, { items: [], refusals: [] }], { log: () => {} });
  await host.refresh();
  assert.equal(await host.bootstrapData({ context: CONTEXT }), null);
  assert.deepEqual(host.handlersFor({ pluginId: CONTEXT.pluginId, surfaceId: CONTEXT.surfaceId }), {});
});

test('the sign-in collector is exposed only when one is given', () => {
  const signIns = createIssuedSignInCollector({ admitHttp: () => false });
  assert.equal(harness([{ items: [], refusals: [] }], { signIns }).host.signIns, signIns);
  assert.equal(Object.hasOwn(harness([{ items: [], refusals: [] }]).host, 'signIns'), false);
});
