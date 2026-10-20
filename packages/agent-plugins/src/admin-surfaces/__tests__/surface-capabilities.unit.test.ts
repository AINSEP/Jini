/**
 * @file Unit tests for admin-surface capability bounds the security suite leaves at their edges:
 * refusal text truncates plugin-supplied names to 64 characters, start parameter values are capped
 * at 2048 characters, at most 16 scope sets are accepted, and a staged account switch label is passed
 * through. The host is the shared typed fake; no network.
 */
import { describe, expect, test } from 'vitest';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import type { AdminSurfaceCapabilityDeclarations } from '../capability-declarations.js';
import { openAdminSurfaceCapabilitySession, type AdminSurfaceConnectionStatus } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

const DECLARED: AdminSurfaceCapabilityDeclarations = {
  connections: [{ id: 'account', startParams: ['selection-mode'], callbackFields: [] }],
  publicConfig: ['ACME_APP_ID'],
};

function open(optional: { readonly status?: Partial<AdminSurfaceConnectionStatus> } = {}) {
  const fake = createFakeSurfaceHost({ config: { ACME_APP_ID: 'app-123' }, ...(optional.status && { status: optional.status }) });
  const session = openAdminSurfaceCapabilitySession(
    { capabilities: fake.port({ pluginId: 'acme-office', workspaceId: WORKSPACE_ID }), isLive: () => true, declared: DECLARED, issued: new Set() },
    { actorId: 'admin-1' },
  );
  return { ...session, log: fake.log };
}

const LONG = `x${'y'.repeat(99)}`;

describe('refusal text names at most 64 characters of a plugin-supplied name', () => {
  test('an undeclared connection id', async () => {
    await expect(open().capabilities.connections.status({ connectionId: LONG }))
      .rejects.toThrow(`This admin surface does not declare connection '${LONG.slice(0, 64)}', so its handlers cannot use it.`);
  });

  test('an undeclared public config name', async () => {
    await expect(open().capabilities.publicConfig.get({ name: LONG }))
      .rejects.toThrow(`This admin surface does not declare public config '${LONG.slice(0, 64)}'. Declare it in the surface's publicConfig.`);
  });
});

describe('begin bounds', () => {
  test('a start parameter value of exactly 2048 characters reaches the host', async () => {
    const session = open();
    await session.capabilities.connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: { 'selection-mode': 'v'.repeat(2048) } });
    expect(session.log.calls).toHaveLength(1);
  });

  test('a start parameter value of 2049 characters is refused before the host sees it', async () => {
    const session = open();
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'connect' }, { startParams: { 'selection-mode': 'v'.repeat(2049) } }))
      .rejects.toThrow("Start parameter 'selection-mode' must be a string of at most 2048 characters.");
    expect(session.log.calls).toEqual([]);
  });

  test('16 scope sets are accepted and 17 are refused', async () => {
    const session = open();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `set-${index}`);
    await session.capabilities.connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: ids(16) });
    await expect(session.capabilities.connections.begin({ connectionId: 'account', action: 'add-scopes' }, { scopeSetIds: ids(17) }))
      .rejects.toThrow('Scope sets must be at most 16 short ids.');
    expect(session.log.calls).toHaveLength(1);
  });
});

test('a staged switch reports the account it would move to', async () => {
  const session = open({ status: { pendingSwitchAccountLabel: 'other@example.test' } });
  await expect(session.capabilities.connections.status({ connectionId: 'account' })).resolves.toMatchObject({ pendingSwitchAccountLabel: 'other@example.test' });
});
