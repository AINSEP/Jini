/**
 * @file Identifier grammars and shape guards of the admin-surface capability session, each as one
 * table pinned by its own refusal: scope-set ids, sign-in attempt ids, the safe codes a host's
 * last-sign-in attempt may surface (64/65 chars), start parameters that are not an object, and
 * callback fields filtered to the declared, string-valued ones. Closes Stryker run-2 survivors at
 * surface-capabilities.ts:135-176, 198, 231. The host is the shared typed fake.
 */
import { describe, expect, test } from 'vitest';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import type { AdminSurfaceCapabilityDeclarations } from '../capability-declarations.js';
import { openAdminSurfaceCapabilitySession, type AdminSurfaceConnectionStatus } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

const DECLARED: AdminSurfaceCapabilityDeclarations = {
  connections: [{ id: 'account', startParams: ['mode'], callbackFields: ['code', 'tenant'] }],
};

function open(optional: { readonly status?: Partial<AdminSurfaceConnectionStatus> } = {}) {
  const fake = createFakeSurfaceHost({ ...(optional.status && { status: optional.status }) });
  const session = openAdminSurfaceCapabilitySession(
    { capabilities: fake.port({ pluginId: 'acme-office', workspaceId: WORKSPACE_ID }), isLive: () => true, declared: DECLARED, issued: new Set() },
    { actorId: 'admin-1' },
  );
  return { connections: session.capabilities.connections, fake };
}

describe('scope-set ids', () => {
  test.each<[unknown, boolean]>([
    ['a', true], ['A9', true], ['set.files_rw-2', true], [`a${'b'.repeat(63)}`, true],
    [`a${'b'.repeat(64)}`, false], ['', false], ['.a', false], ['-a', false], ['_a', false], [' a', false], ['a\n', false], ['a!', false], ['a b', false], [7, false],
  ])('%j accepted: %s', async (id, accepted) => {
    const { connections, fake } = open();
    const begin = connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: ['first', id] as string[] });
    if (accepted) { await begin; expect(fake.log.calls).toHaveLength(1); }
    else { await expect(begin).rejects.toThrow('Scope sets must be at most 16 short ids.'); expect(fake.log.calls).toEqual([]); }
  });

  test('a non-array is refused', async () => {
    await expect(open().connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: 'files' as unknown as string[] }))
      .rejects.toThrow('Scope sets must be at most 16 short ids.');
  });
});

describe('sign-in attempt ids', () => {
  test.each<[unknown, boolean]>([
    ['a', true], ['A_b-9', true], ['x'.repeat(128), true],
    ['x'.repeat(129), false], ['', false], [' a', false], ['a\n', false], ['a.b', false], ['a!', false], [12, false],
  ])('%j accepted: %s', async (attemptId, accepted) => {
    const taken = open().connections.takeCallbackFields({ connectionId: 'account', attemptId: attemptId as string });
    if (accepted) await expect(taken).resolves.toBeNull();
    else await expect(taken).rejects.toThrow('The sign-in attempt id is not valid; start the sign-in again.');
  });
});

describe('callback fields', () => {
  test('only the declared, string-valued fields reach the handler', async () => {
    const { connections, fake } = open();
    fake.inbox.deposit({ workspaceId: WORKSPACE_ID, pluginId: 'acme-office', connectionId: 'account', attemptId: 'att-1', fields: { code: 'c1', state: 'secret-state', tenant: 7 as unknown as string } });
    await expect(connections.takeCallbackFields({ connectionId: 'account', attemptId: 'att-1' })).resolves.toEqual({ code: 'c1' });
  });
});

describe('last sign-in attempt codes', () => {
  test.each<[unknown, boolean]>([
    ['a', true], ['access-denied', true], ['a1-b2-c3', true], ['x'.repeat(64), true],
    ['x'.repeat(65), false], ['', false], ['-a', false], ['a-', false], ['a--b', false], ['Access', false], ['a_b', false], ['a\n', false], ['provider said: no', false], [3, false],
  ])('code %j surfaced: %s', async (code, surfaced) => {
    const status = await open({ status: { lastSignInAttempt: { code, nextAction: 'retry' } as never } }).connections.status({ connectionId: 'account' });
    expect(status.lastSignInAttempt).toEqual(surfaced ? { code, nextAction: 'retry' } : null);
  });

  test('a bad nextAction alone hides the attempt; a non-object attempt is null', async () => {
    expect((await open({ status: { lastSignInAttempt: { code: 'denied', nextAction: 'Retry!' } as never } }).connections.status({ connectionId: 'account' })).lastSignInAttempt).toBeNull();
    expect((await open({ status: { lastSignInAttempt: 'denied' as never } }).connections.status({ connectionId: 'account' })).lastSignInAttempt).toBeNull();
  });
});

describe('start parameters', () => {
  test.each([[['mode']], [null], ['mode=1']])('%j is not an object of strings', async (startParams) => {
    await expect(open().connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: startParams as never }))
      .rejects.toThrow('Start parameters must be an object of strings.');
  });
});
