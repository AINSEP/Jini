import { expect, it, vi } from 'vitest';
import {
  resolveTargetWorkspaceId, resolveUserLayerReadTarget, settingsWritePermission,
  type Authorize, type SettingsPermissions,
} from '../route-policy.js';

it('pins writes to the authorized workspace and rejects contradictory targets even on global writes', () => {
  for (const bodyWorkspaceId of [undefined, null, '', 'workspace-2']) {
    expect(resolveTargetWorkspaceId({ workspaceId: 'workspace-2', input: { bodyWorkspaceId, scope: 'workspace' } }))
      .toEqual({ ok: true, workspaceId: 'workspace-2' });
  }
  expect(resolveTargetWorkspaceId({ workspaceId: 'workspace-2', input: { bodyWorkspaceId: 'workspace-2', scope: 'global' } }))
    .toEqual({ ok: true, workspaceId: undefined });

  expect(resolveTargetWorkspaceId({ workspaceId: 'workspace-2', input: { bodyWorkspaceId: 'workspace-3', scope: 'global' } }))
    .toEqual({ ok: false, error: "workspaceId 'workspace-3' does not match this route's workspace; a settings write cannot target another workspace" });
});

it('reads own settings without a cross-user grant and checks the caller’s grant before reading another user', async () => {
  const authorize = vi.fn<Authorize>()
    .mockResolvedValueOnce({ allowed: false, reason: 'Grant required to read Bea’s settings' })
    .mockResolvedValueOnce({ allowed: true, reason: 'Owner grant' });
  const deps = { workspaceId: 'workspace-2', authorize, permission: 'settings.read.other' };
  const read = (requestedPrincipalId: string | undefined) => resolveUserLayerReadTarget({
    deps, input: { requestedPrincipalId, callerPrincipalId: 'ana' },
  });
  expect(await read(undefined)).toEqual({ allowed: true, principalId: undefined });
  expect(await read('ana')).toEqual({ allowed: true, principalId: 'ana' });
  expect(authorize).not.toHaveBeenCalled();
  expect(await read('bea')).toEqual({ allowed: false, reason: 'Grant required to read Bea’s settings' });
  expect(await read('bea')).toEqual({ allowed: true, principalId: 'bea' });
  const request = { principalId: 'ana', workspaceId: 'workspace-2', permission: 'settings.read.other', entityType: 'setting-value' };
  expect(authorize.mock.calls).toEqual([[request], [request]]);
});

it('uses distinct grants for global, workspace, self and other-user writes', () => {
  const permissions: SettingsPermissions = {
    read: 'read', readRaw: 'raw', readDefinitions: 'definitions', readOtherUser: 'read-other',
    manageDefinitions: 'manage', writeGlobal: 'global-edit', writeWorkspace: 'workspace-edit',
    writeUserSelf: 'self-edit', writeUserOther: 'other-edit',
    reset: { global: 'global-reset', workspace: 'workspace-reset', user: 'user-reset' },
  };
  const grant = (scope: 'global' | 'workspace' | 'user', targetPrincipalId: string | undefined) =>
    settingsWritePermission({ permissions, scope, callerPrincipalId: 'ana', targetPrincipalId });
  expect(grant('global', undefined)).toBe('global-edit');
  expect(grant('workspace', undefined)).toBe('workspace-edit');
  expect(grant('user', undefined)).toBe('self-edit');
  expect(grant('user', 'ana')).toBe('self-edit');
  expect(grant('user', 'bea')).toBe('other-edit');
});
