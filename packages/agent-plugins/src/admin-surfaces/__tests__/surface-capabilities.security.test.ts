/**
 * @file Security pins (phase A) for the admin-surface capability ports: a handler reaches only the
 * connections, start parameters, callback fields and public config its surface declared; account
 * actions need a signed-in admin; host answers are cut back to the token-free port shape; callback
 * fields are taken once, by their owner, only after a deposit; plugin state is JSON-only, capped,
 * isolated per plugin and never stores an obtained token; disabling the plugin revokes every port.
 */
import { describe, expect, test } from 'vitest';
import { REVOKED_MESSAGE } from '../../lifecycle/tools/capabilities.js';
import { FAKE_TOKEN, WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import {
  ADMIN_SURFACE_STATE_LIMITS, createAdminSurfaceActionDispatcher, createAdminSurfaceCallbackInbox, createAdminSurfaceHandlerHost, openAdminSurfaceCapabilitySession,
  parseAdminSurfacesFile, STATE_CREDENTIAL_MESSAGE, type AdminSurfaceCapabilityDeclarations, type AdminSurfaceDescriptor, type AdminSurfaceHandlerModule,
} from '../index.js';
import { createFakeSurfaceHost } from './surface-support.js';

const PLUGIN = 'acme-office';
const DECLARED: AdminSurfaceCapabilityDeclarations = {
  connections: [{ id: 'account', startParams: ['selection-mode'], callbackFields: ['picked-id'] }],
  publicConfig: ['ACME_APP_ID'],
};
const UNDECLARED_CONNECTION = "This admin surface does not declare connection 'other', so its handlers cannot use it. Declare it in the surface's connections.";
const NO_ACTOR = 'Account actions need a signed-in admin. Open the surface from an authenticated admin page and retry.';

function open(optional: { readonly actorId?: string | null; readonly pluginId?: string; readonly live?: () => boolean } = {}) {
  const fake = createFakeSurfaceHost({ config: { ACME_APP_ID: 'app-123', ACME_OTHER: 'not-declared' }, status: { connectionRef: 'ref-must-not-leak' } });
  const actorId = optional.actorId === undefined ? 'admin-1' : optional.actorId;
  const session = openAdminSurfaceCapabilitySession(
    { capabilities: fake.port({ pluginId: optional.pluginId ?? PLUGIN, workspaceId: WORKSPACE_ID }), isLive: optional.live ?? (() => true), declared: DECLARED },
    actorId === null ? {} : { actorId },
  );
  return { ...fake, ...session };
}

const surfaceRaw = (extra: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, surfaces: [{
  id: 'settings', title: 'Settings', entry: 'surface/index.html', handlerModule: 'server/handlers.mjs',
  actions: [{ name: 'save', input: { type: 'object' }, result: { type: 'object', properties: { empty: { type: 'boolean' } } } }], ...extra,
}] });
const reasonFor = (extra: Record<string, unknown>) => {
  const parsed = parseAdminSurfacesFile({ raw: surfaceRaw(extra) });
  return parsed.ok ? 'accepted' : parsed.reason;
};

describe('the surfaces file is the allowlist', () => {
  test('connections or publicConfig without a handler module are refused', () => {
    expect(reasonFor({ handlerModule: undefined, connections: [{ id: 'account' }] })).toBe('surfaces[0].connections needs a handlerModule that uses it');
    expect(reasonFor({ handlerModule: undefined, publicConfig: ['ACME_APP_ID'] })).toBe('surfaces[0].publicConfig needs a handlerModule that uses it');
  });
  test.each(['ACME_CLIENT_SECRET', 'ACCESS_TOKEN', 'DB_PASSWORD', 'SIGNING_KEY', 'PRIVATE_KEY', 'SESSION_KEY', 'ACME_CREDENTIALS'])('a secret-named public config %s is refused', (name) => {
    expect(reasonFor({ publicConfig: ['ACME_APP_ID', name] })).toBe('surfaces[0].publicConfig[1] names a secret; public config may only hold values that are safe to show');
  });
  test('a public config name that is not an environment-style name is refused', () => {
    expect(reasonFor({ publicConfig: ['acme_app_id'] })).toBe('surfaces[0].publicConfig[0] must be a unique name matching ^[A-Z][A-Z0-9_]{0,63}$');
  });
  test('a connection id, a duplicate connection, or a start parameter name outside the allowed shape is refused', () => {
    expect(reasonFor({ connections: [{ id: '../account' }] })).toBe('surfaces[0].connections[0].id must be a short connection id');
    expect(reasonFor({ connections: [{ id: 'account' }, { id: 'account' }] })).toBe("surfaces[0].connections[1].id 'account' is declared twice");
    expect(reasonFor({ connections: [{ id: 'account', startParams: ['a b'] }] })).toBe('surfaces[0].connections[0].startParams[0] must be a unique name matching ^[A-Za-z0-9_.-]{1,64}$');
    expect(reasonFor({ connections: [{ id: 'account', callbackFields: ['x', 'x'] }] })).toBe('surfaces[0].connections[0].callbackFields[1] must be a unique name matching ^[A-Za-z0-9_.-]{1,64}$');
  });
  test('connections that are not an array of objects are refused', () => {
    expect(reasonFor({ connections: { id: 'account' } })).toBe('surfaces[0].connections must be an array of at most 4');
    expect(reasonFor({ connections: ['account'] })).toBe('surfaces[0].connections[0] must be an object');
  });
  test('declared lists are parsed onto the descriptor', () => {
    const parsed = parseAdminSurfacesFile({ raw: surfaceRaw({ connections: [{ id: 'account', startParams: ['selection-mode'] }], publicConfig: ['ACME_APP_ID'] }) });
    expect(parsed.ok && parsed.descriptors[0]).toMatchObject({ connections: [{ id: 'account', startParams: ['selection-mode'], callbackFields: [] }], publicConfig: ['ACME_APP_ID'] });
  });
});

describe('connections: only declared ones, account actions only for an admin', () => {
  test.each([
    ['getAccessToken', (s: ReturnType<typeof open>) => s.capabilities.connections.getAccessToken({ connectionId: 'other' })],
    ['status', (s: ReturnType<typeof open>) => s.capabilities.connections.status({ connectionId: 'other' })],
    ['begin', (s: ReturnType<typeof open>) => s.capabilities.connections.begin({ connectionId: 'other', action: 'connect' })],
    ['confirmSwitch', (s: ReturnType<typeof open>) => s.capabilities.connections.confirmSwitch({ connectionId: 'other' })],
    ['cancelSwitch', (s: ReturnType<typeof open>) => s.capabilities.connections.cancelSwitch({ connectionId: 'other' })],
    ['disconnect', (s: ReturnType<typeof open>) => s.capabilities.connections.disconnect({ connectionId: 'other' })],
    ['takeCallbackFields', (s: ReturnType<typeof open>) => s.capabilities.connections.takeCallbackFields({ connectionId: 'other', attemptId: 'attempt-1' })],
  ])('%s refuses an undeclared connection before the host sees it', async (_name, call) => {
    const session = open();
    await expect(call(session)).rejects.toThrow(UNDECLARED_CONNECTION);
    expect([...session.log.calls, ...session.log.tokenRequests]).toEqual([]);
  });
  test.each([
    ['begin', (s: ReturnType<typeof open>) => s.capabilities.connections.begin({ connectionId: 'account', action: 'connect' })],
    ['confirmSwitch', (s: ReturnType<typeof open>) => s.capabilities.connections.confirmSwitch({ connectionId: 'account' })],
    ['cancelSwitch', (s: ReturnType<typeof open>) => s.capabilities.connections.cancelSwitch({ connectionId: 'account' })],
    ['disconnect', (s: ReturnType<typeof open>) => s.capabilities.connections.disconnect({ connectionId: 'account' })],
  ])('%s refuses without a signed-in admin', async (_name, call) => {
    const session = open({ actorId: null });
    await expect(call(session)).rejects.toThrow(NO_ACTOR);
    expect(session.log.calls).toEqual([]);
  });
  test('an undeclared start parameter, a non-string value or an unknown action is refused before the host sees it', async () => {
    const session = open();
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: { prompt: 'none' } }))
      .rejects.toThrow("Start parameter 'prompt' is not declared for connection 'account' on this admin surface.");
    // Malformed input on purpose: plugin code is untyped JavaScript.
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: { 'selection-mode': 1 } as never }))
      .rejects.toThrow("Start parameter 'selection-mode' must be a string of at most 2048 characters.");
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'delete-everything' as never }))
      .rejects.toThrow("Account action 'delete-everything' is not one of connect, reconnect, switch, add-scopes.");
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: ['../all'] }))
      .rejects.toThrow('Scope sets must be at most 16 short ids.');
    expect(session.log.calls).toEqual([]);
  });
  test('a declared start parameter reaches the host, and the answer is cut back to the port shape (no connection ref)', async () => {
    const session = open();
    const started = await session.capabilities.connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: ['files'], startParams: { 'selection-mode': 'one' } });
    expect(started).toStrictEqual({ authorizationUrl: 'https://auth.example.test/authorize?state=s1', attemptId: 'attempt-1', expiresAt: '2026-10-20T00:10:00.000Z' });
    expect(session.log.calls).toEqual([`${PLUGIN}:begin:{"connectionId":"account","action":"add-scopes","scopeSetIds":["files"],"startParams":{"selection-mode":"one"}}`]);
  });
  test('confirmSwitch and cancelSwitch answers are cut back to the token-free status fields', async () => {
    const session = open();
    const status = { connectionId: 'account', state: 'connected', accountLabel: 'person@example.test', grantedScopeSetIds: ['files'], pendingSwitchAccountLabel: null };
    expect(await session.capabilities.connections.confirmSwitch({ connectionId: 'account' })).toStrictEqual(status);
    expect(await session.capabilities.connections.cancelSwitch({ connectionId: 'account' })).toStrictEqual(status);
    expect(session.log.calls).toEqual([`${PLUGIN}:confirmSwitch:{"connectionId":"account"}`, `${PLUGIN}:cancelSwitch:{"connectionId":"account"}`]);
  });
  test('start parameters that are not an object are refused', async () => {
    // Malformed input on purpose: plugin code is untyped JavaScript.
    await expect(open().capabilities.connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: ['selection-mode'] as never }))
      .rejects.toThrow('Start parameters must be an object of strings.');
  });
  test('status and disconnect answers carry only the token-free status fields and the honest revocation outcome', async () => {
    const session = open();
    const status = { connectionId: 'account', state: 'connected', accountLabel: 'person@example.test', grantedScopeSetIds: ['files'], pendingSwitchAccountLabel: null };
    expect(await session.capabilities.connections.status({ connectionId: 'account' })).toStrictEqual(status);
    expect(await session.capabilities.connections.disconnect({ connectionId: 'account' })).toStrictEqual({ ...status, state: 'revocation-pending', revocation: 'revocation-pending' });
  });
});

describe('callback fields: once, by their owner, after a completed sign-in, declared fields only', () => {
  const key = { workspaceId: WORKSPACE_ID, pluginId: PLUGIN, connectionId: 'account', attemptId: 'attempt-1' };
  test('nothing is returned before the host deposits a completed sign-in', async () => {
    expect(await open().capabilities.connections.takeCallbackFields({ connectionId: 'account', attemptId: 'attempt-1' })).toBeNull();
  });
  test('the owner takes only declared fields, exactly once', async () => {
    const session = open();
    session.inbox.deposit({ ...key, fields: { 'picked-id': 'res-1', 'undeclared-extra': 'x' } });
    expect(await session.capabilities.connections.takeCallbackFields({ connectionId: 'account', attemptId: 'attempt-1' })).toStrictEqual({ 'picked-id': 'res-1' });
    expect(await session.capabilities.connections.takeCallbackFields({ connectionId: 'account', attemptId: 'attempt-1' })).toBeNull();
  });
  test('another plugin with the same connection and attempt ids gets nothing and does not consume the owner\'s fields', () => {
    const inbox = createAdminSurfaceCallbackInbox({ now: () => 0 });
    inbox.deposit({ ...key, fields: { 'picked-id': 'res-1' } });
    expect(inbox.take({ ...key, pluginId: 'other-plugin' })).toBeNull();
    expect(inbox.take({ ...key, workspaceId: 'other-workspace' })).toBeNull();
    expect(inbox.take(key)).toStrictEqual({ 'picked-id': 'res-1' });
  });
  test('an expired deposit is gone, and a full inbox drops the oldest first', () => {
    let now = 0;
    const inbox = createAdminSurfaceCallbackInbox({ now: () => now }, { ttlMs: 100, maxEntries: 2 });
    inbox.deposit({ ...key, fields: { 'picked-id': 'old' } });
    now = 100;
    expect(inbox.take(key)).toBeNull();
    inbox.deposit({ ...key, attemptId: 'a1', fields: {} });
    inbox.deposit({ ...key, attemptId: 'a2', fields: {} });
    inbox.deposit({ ...key, attemptId: 'a3', fields: {} });
    expect([inbox.take({ ...key, attemptId: 'a1' }), inbox.take({ ...key, attemptId: 'a2' }), inbox.take({ ...key, attemptId: 'a3' })]).toEqual([null, {}, {}]);
  });
  test('an attempt id outside the opaque-id shape is refused', async () => {
    await expect(open().capabilities.connections.takeCallbackFields({ connectionId: 'account', attemptId: 'a/../b' })).rejects.toThrow('The sign-in attempt id is not valid; start the sign-in again.');
  });
});

describe('plugin state and public config', () => {
  test.each([
    ['undefined', undefined], ['NaN', Number.NaN], ['a Date', new Date(0)], ['a function', () => 1], ['a nested undefined', { a: [undefined] }],
  ])('a value holding %s is refused (JSON-only)', async (_name, value) => {
    // Malformed input on purpose: plugin code is untyped JavaScript.
    await expect(open().capabilities.state.set({ key: 'selection', value: value as never }))
      .rejects.toThrow('A settings value must be plain JSON data (no undefined, functions, NaN or class instances).');
  });
  test('a value nested deeper than the cap, or larger than the byte cap, is refused', async () => {
    let deep: unknown = 'leaf';
    for (let level = 0; level < ADMIN_SURFACE_STATE_LIMITS.maxDepth + 1; level += 1) deep = [deep];
    const session = open();
    await expect(session.capabilities.state.set({ key: 'selection', value: deep as never })).rejects.toThrow('A settings value must be plain JSON data');
    await expect(session.capabilities.state.set({ key: 'selection', value: 'é'.repeat(ADMIN_SURFACE_STATE_LIMITS.maxValueBytes / 2) }))
      .rejects.toThrow('A settings value may be at most 16384 bytes of JSON.');
  });
  test.each(['', '../x', 'a b', 'k'.repeat(129)])('a state key %j outside the short-name shape is refused', async (key) => {
    await expect(open().capabilities.state.get({ key })).rejects.toThrow('A settings key must be a short name of at most 128 characters.');
  });
  test.each(['', '../x', 'a b', 'k'.repeat(129), 7])('set and delete refuse the state key %j before the host sees it', async (key) => {
    const session = open();
    await expect(session.capabilities.state.set({ key: key as string, value: 1 })).rejects.toThrow('A settings key must be a short name of at most 128 characters.');
    await expect(session.capabilities.state.delete({ key: key as string })).rejects.toThrow('A settings key must be a short name of at most 128 characters.');
    expect(session.log.calls).toEqual([]);
  });
  test('a 128-character key with dots, colons, dashes and underscores is accepted', async () => {
    const session = open();
    const key = `a.b:c-d_${'k'.repeat(120)}`;
    await session.capabilities.state.set({ key, value: true });
    expect(await session.capabilities.state.get({ key })).toBe(true);
  });
  test('a value that mentions an access token the call obtained is never stored', async () => {
    const session = open();
    const token = await session.capabilities.connections.getAccessToken({ connectionId: 'account' });
    await expect(session.capabilities.state.set({ key: 'selection', value: { header: `Bearer ${token}` } })).rejects.toThrow(STATE_CREDENTIAL_MESSAGE);
    expect(session.state.size).toBe(0);
  });
  test('a token obtained in an EARLIER call is not caught by the per-call state scan (reported, not fixed)', async () => {
    const earlier = open();
    const token = await earlier.capabilities.connections.getAccessToken({ connectionId: 'account' });
    const later = openAdminSurfaceCapabilitySession({ capabilities: earlier.port({ pluginId: PLUGIN, workspaceId: WORKSPACE_ID }), isLive: () => true, declared: DECLARED });
    await later.capabilities.state.set({ key: 'kept', value: token });
    expect(await later.capabilities.state.get({ key: 'kept' })).toBe(FAKE_TOKEN);
  });
  test('what is stored is the checked copy: changing the object afterwards changes nothing', async () => {
    const session = open();
    const value = { resourceId: 'res-1' };
    await session.capabilities.state.set({ key: 'selection', value });
    value.resourceId = FAKE_TOKEN;
    expect(await session.capabilities.state.get({ key: 'selection' })).toStrictEqual({ resourceId: 'res-1' });
  });
  test('only declared public config is reachable', async () => {
    const session = open();
    expect(await session.capabilities.publicConfig.get({ name: 'ACME_APP_ID' })).toBe('app-123');
    await expect(session.capabilities.publicConfig.get({ name: 'ACME_OTHER' })).rejects.toThrow("This admin surface does not declare public config 'ACME_OTHER'. Declare it in the surface's publicConfig.");
    expect(session.log.calls).toEqual([`${PLUGIN}:publicConfig.get:{"name":"ACME_APP_ID"}`]);
  });
});

describe('plugin isolation and revocation through the handler host', () => {
  const descriptorFor = (): AdminSurfaceDescriptor & { readonly handlerModule: string } => {
    const parsed = parseAdminSurfacesFile({ raw: surfaceRaw({ connections: [{ id: 'account' }] }) });
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.descriptors[0] as AdminSurfaceDescriptor & { readonly handlerModule: string };
  };
  const context = (pluginId: string) => ({ workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId, surfaceId: 'settings' });

  test('two plugins writing the same state key never see each other\'s value', async () => {
    const fake = createFakeSurfaceHost();
    const writer: AdminSurfaceHandlerModule = { actions: { save: async ({ capabilities, context: { pluginId } }) => { await capabilities.state.set({ key: 'selection', value: pluginId }); return {}; } } };
    const reader: AdminSurfaceHandlerModule = { actions: { save: async ({ capabilities }) => ({ empty: (await capabilities.state.get({ key: 'selection' })) === null }) } };
    const host = createAdminSurfaceHandlerHost({ capabilities: fake.port });
    host.sync({ loaded: [{ pluginId: 'plugin-a', descriptor: descriptorFor(), module: writer }, { pluginId: 'plugin-b', descriptor: descriptorFor(), module: reader }], refusals: [] });
    const dispatch = (pluginId: string) => createAdminSurfaceActionDispatcher({ descriptor: descriptorFor(), handlers: host.handlersFor({ pluginId, surfaceId: 'settings' }) })
      .dispatch({ action: 'save', payload: {}, context: context(pluginId) });
    expect(await dispatch('plugin-a')).toEqual({ ok: true, result: {} });
    expect(await dispatch('plugin-b')).toEqual({ ok: true, result: { empty: true } });
  });

  test('every port a module kept is revoked once the plugin is disabled', async () => {
    let kept: Parameters<AdminSurfaceHandlerModule['actions'][string]>[0]['capabilities'] | undefined;
    const host = createAdminSurfaceHandlerHost({ capabilities: createFakeSurfaceHost().port });
    host.sync({ loaded: [{ pluginId: PLUGIN, descriptor: descriptorFor(), module: { actions: { save: async ({ capabilities }) => { kept = capabilities; return {}; } } } }], refusals: [] });
    await createAdminSurfaceActionDispatcher({ descriptor: descriptorFor(), handlers: host.handlersFor({ pluginId: PLUGIN, surfaceId: 'settings' }) }).dispatch({ action: 'save', payload: {}, context: context(PLUGIN) });
    host.sync({ loaded: [], refusals: [] });
    const calls = [
      kept!.connections.status({ connectionId: 'account' }), kept!.connections.begin({ connectionId: 'account', action: 'connect' }),
      kept!.connections.disconnect({ connectionId: 'account' }), kept!.connections.takeCallbackFields({ connectionId: 'account', attemptId: 'a1' }),
      kept!.state.set({ key: 'k', value: 1 }), kept!.state.get({ key: 'k' }), kept!.state.delete({ key: 'k' }), kept!.publicConfig.get({ name: 'X' }),
    ];
    for (const call of calls) await expect(call).rejects.toThrow(REVOKED_MESSAGE);
  });
});
