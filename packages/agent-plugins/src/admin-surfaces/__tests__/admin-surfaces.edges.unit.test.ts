/**
 * @file Unit tests for the remaining edge paths across the admin-surface modules: action error
 * construction, the callback inbox's expiry sweep under a clock that steps backwards, a non-string
 * declared name, a non-object message, the init envelope with bootstrap, the safe default content
 * type, and a host status that omits its account label.
 */
import { describe, expect, test } from 'vitest';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import { AdminSurfaceActionError } from '../action-dispatcher.js';
import { createAdminSurfaceCallbackInbox } from '../callback-field-inbox.js';
import { parseAdminSurfaceCapabilityDeclarations } from '../capability-declarations.js';
import { defineAdminSurfaceContribution } from '../contribution.js';
import { parseAdminSurfacesFile, type AdminSurfaceDescriptor } from '../descriptor.js';
import { validateAdminSurfaceMessage } from '../host-validator.js';
import { adminSurfaceInitMessage } from '../protocol.js';
import { adminSurfaceFileHeaders, createAdminSurfaceBootstrap } from '../sandbox.js';
import { openAdminSurfaceCapabilitySession, type AdminSurfaceConnectionStatus } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

describe('AdminSurfaceActionError', () => {
  test('defaults to not retryable and carries no cause', () => {
    const error = new AdminSurfaceActionError({ code: 'sheet-missing', message: 'Pick the sheet again.' });
    expect(error).toMatchObject({ name: 'AdminSurfaceActionError', code: 'sheet-missing', message: 'Pick the sheet again.', retryable: false });
    expect('cause' in error).toBe(false);
  });

  test('keeps an explicit retryable flag and cause', () => {
    const cause = new Error('upstream 503');
    const error = new AdminSurfaceActionError({ code: 'retry-later', message: 'Try again shortly.' }, { retryable: true, cause });
    expect([error.retryable, error.cause]).toEqual([true, cause]);
  });
});

describe('callback inbox', () => {
  const key = (attemptId: string) => ({ workspaceId: 'w', pluginId: 'acme-office', connectionId: 'account', attemptId });
  const TTL = 10 * 60 * 1000;

  test('expired entries are swept before the cap, so a live entry is not evicted while expired ones remain', () => {
    // A wall clock can step backwards: entries deposited after the step expire before an older one.
    let now = 10_000;
    const inbox = createAdminSurfaceCallbackInbox({ now: () => now });
    inbox.deposit({ ...key('live'), fields: { 'picked-id': 'kept' } });
    now = 0;
    for (let index = 0; index < 255; index += 1) inbox.deposit({ ...key(`stale-${index}`), fields: {} });
    now = TTL;
    inbox.deposit({ ...key('new'), fields: {} });
    expect(inbox.take(key('live'))).toEqual({ 'picked-id': 'kept' });
  });

  test('when full of live entries, the oldest is dropped for a new one', () => {
    const inbox = createAdminSurfaceCallbackInbox({ now: () => 0 });
    for (let index = 0; index < 256; index += 1) inbox.deposit({ ...key(`a-${index}`), fields: { n: String(index) } });
    inbox.deposit({ ...key('newest'), fields: {} });
    expect([inbox.take(key('a-0')), inbox.take(key('a-1')), inbox.take(key('newest'))]).toEqual([null, { n: '1' }, {}]);
  });
});

describe('capability declarations', () => {
  test('start parameters that are not a list are refused', () => {
    expect(parseAdminSurfaceCapabilityDeclarations({ entry: { connections: [{ id: 'account', startParams: 'mode' }] }, at: 'surfaces[0]' }))
      .toBe('surfaces[0].connections[0].startParams must be an array of at most 8');
  });

  test('more than 8 callback fields are refused', () => {
    const callbackFields = Array.from({ length: 9 }, (_, index) => `field-${index}`);
    expect(parseAdminSurfaceCapabilityDeclarations({ entry: { connections: [{ id: 'account', callbackFields }] }, at: 'surfaces[0]' }))
      .toBe('surfaces[0].connections[0].callbackFields must be an array of at most 8');
  });

  test('a non-string start parameter name is refused, naming its index', () => {
    expect(parseAdminSurfaceCapabilityDeclarations({ entry: { connections: [{ id: 'account', startParams: ['mode', 7] }] }, at: 'surfaces[0]' }))
      .toMatch(/^surfaces\[0\]\.connections\[0\]\.startParams\[1\] must be a unique name matching /);
  });
});

const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{ id: 'settings', title: 'Settings', entry: 'index.html' }] }) });
const descriptor = (parsed.ok ? parsed.descriptors[0] : undefined) as AdminSurfaceDescriptor;

describe('host message gate', () => {
  const frame = {};

  test('a request envelope without a payload key is not a request', () => {
    const data = { protocol: 'jini.admin-surface', version: 1, kind: 'action-request', mountId: 'm-1', requestId: 'r1', action: 'save' };
    expect(validateAdminSurfaceMessage({ event: { origin: 'null', source: frame, data }, mount: { mountId: 'm-1', frame, descriptor } }))
      .toEqual({ ok: false, ignored: 'not-an-action-request' });
  });

  test.each([[null], ['action-request'], [7]])('non-object data %j from the frame is ignored as not a request', (data) => {
    expect(validateAdminSurfaceMessage({ event: { origin: 'null', source: frame, data }, mount: { mountId: 'm-1', frame, descriptor } }))
      .toEqual({ ok: false, ignored: 'not-an-action-request' });
  });
});

describe('contribution definition', () => {
  test('is a data contribution (no plugin code runs) on the host-chosen filename', async () => {
    const definition = defineAdminSurfaceContribution({ filename: 'host-admin-surfaces.json' });
    expect(definition).toMatchObject({ filename: 'host-admin-surfaces.json', contribution: 'admin surfaces', kind: 'data' });
    expect(definition.parse({ raw: '[]' })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
    const plugin = { pluginId: 'acme-office', packageRoot: '/plugins/acme-office' };
    const importModule = async () => 'never called';
    await expect(Promise.resolve(definition.load({ plugin, descriptor, importModule }))).resolves.toEqual({ plugin, descriptor });
  });
});

describe('protocol and sandbox', () => {
  test('the init envelope has no bootstrap key when none is given', () => {
    expect(adminSurfaceInitMessage({ mountId: 'm-1' })).toStrictEqual({ protocol: 'jini.admin-surface', version: 1, kind: 'init', mountId: 'm-1' });
  });

  test('the init envelope carries the bootstrap when one is given', () => {
    const bootstrap = createAdminSurfaceBootstrap({ surfaceId: 'settings', data: { sheet: 'A' }, nowMs: 0 });
    expect(adminSurfaceInitMessage({ mountId: 'm-1' }, { bootstrap })).toEqual({ protocol: 'jini.admin-surface', version: 1, kind: 'init', mountId: 'm-1', bootstrap });
  });

  test('the init envelope carries the theme when one is given, alongside or without a bootstrap', () => {
    const theme = { scheme: 'dark', tokens: {} } as const;
    expect(adminSurfaceInitMessage({ mountId: 'm-1' }, { theme })).toStrictEqual({ protocol: 'jini.admin-surface', version: 1, kind: 'init', mountId: 'm-1', theme });
  });

  test('a file type outside the served set is labelled as opaque bytes, still nosniff, with no CORS grant', () => {
    const headers = adminSurfaceFileHeaders({ descriptor: { csp: {} }, path: 'notes.txt' });
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });
});

describe('connection status', () => {
  test('a host status without an account label reports null', async () => {
    // Malformed input on purpose: the host port is untyped at run time and may omit the field.
    const fake = createFakeSurfaceHost({ status: { accountLabel: undefined as unknown as AdminSurfaceConnectionStatus['accountLabel'] } });
    const session = openAdminSurfaceCapabilitySession(
      { capabilities: fake.port({ pluginId: 'acme-office', workspaceId: WORKSPACE_ID }), isLive: () => true, declared: { connections: [{ id: 'account', startParams: [], callbackFields: [] }] }, issued: new Set() },
      { actorId: 'admin-1' },
    );
    await expect(session.capabilities.connections.status({ connectionId: 'account' })).resolves.toMatchObject({ accountLabel: null });
  });
});
