import type { AdminSurfaceConnectionRecord, AdminSurfaceConnectionsHost, AdminSurfaceSignInStarted } from '@jini-ai/core/contracts/site/admin-surfaces-connections';
import { expect, it, vi } from 'vitest';
import { createAdminSurfaceConnections } from '../connections/index.js';
import { createAdminSurfaceCallbackInbox } from '../callback-field-inbox.js';

const connection = { pluginId: 'sheets', descriptor: { connectionId: 'drive' }, scopeSets: ['view', 'edit', 'export'] };
const key = { connectionId: 'drive' };
const ref = 'studio/sheets/drive';
const account = { accountId: 'owner-1', displayName: 'Original account' };
const switched = { accountId: 'owner-2', displayName: 'New account' };
const start = { authorizationUrl: 'https://accounts.example.test/start', attemptId: 'attempt-1', expiresAt: '2030-01-01T00:10:00Z' };
const disconnected = { status: 'disconnected', accountLabel: null, grantedScopeSetIds: [], pendingSwitchAccountLabel: null, lastSignInAttempt: null, ...key };

function fixture() {
  type Host = AdminSurfaceConnectionsHost<typeof connection>;
  const nowMs = () => Date.parse('2030-01-01T00:00:00Z');
  const callbackInbox = createAdminSurfaceCallbackInbox({ now: nowMs });
  const attempts = new Map<string, Parameters<Host['attempts']['set']>[1]>();
  const base = { status: 'connected', account, grantedScopes: ['read', 'download'] } as const;
  const readRecord = vi.fn<Host['readRecord']>(async ({ key }) => key === ref ? {
    ...base, staged: { expiresAt: '2030-01-01T00:00:01Z', account: switched },
  } : null);
  const service = {
    confirmSwitchAccount: vi.fn<ReturnType<Host['service']>['confirmSwitchAccount']>(async () => ({ ...base, account: switched, pendingSwitch: switched })),
    cancelSwitchAccount: vi.fn<ReturnType<Host['service']>['cancelSwitchAccount']>(async () => ({ ...base, pendingSwitch: switched })),
    disconnect: vi.fn<ReturnType<Host['service']>['disconnect']>(async () => ({
      status: 'revocation-pending', account: null, grantedScopes: [], pendingSwitch: null, remoteRevocation: 'pending',
    })),
  };
  const host = {
    workspaceId: 'studio', nowMs,
    connectionKey: ({ workspaceId, pluginId, connectionId }) => [workspaceId, pluginId, connectionId].join('/'),
    listConnections: vi.fn<Host['listConnections']>(async ({ pluginId }) => pluginId === 'sheets' ? [connection] : []),
    readRecord,
    requestedScopes: vi.fn<Host['requestedScopes']>(async ({ scopeSetIds }) => {
      switch (scopeSetIds.join(',')) {
        case 'view': return ['read'];
        case 'edit': return ['read', 'write'];
        case 'export': return ['read', 'download'];
        default: throw new Error('unexpected scope set');
      }
    }),
    getAccessToken: vi.fn<Host['getAccessToken']>(async () => 'fixture-token'),
    startSignIn: vi.fn<Host['startSignIn']>(async () => start),
    service: vi.fn<Host['service']>(() => service),
    attempts: { get: ref => attempts.get(ref), set: (ref, attempt) => { attempts.set(ref, attempt); }, delete: ref => { attempts.delete(ref); } },
    callbackInbox, notAvailable: () => new Error('Connection unavailable in this scope'),
  } satisfies Host;
  const binding = { host, workspaceId: 'studio', pluginId: 'sheets', principalId: 'operator' };
  return { host, service, binding, attempts, base };
}

it('projects a connected record with complete scope sets and drops a staged account exactly at expiry', async () => {
  const { host, binding, base } = fixture();
  const port = createAdminSurfaceConnections(binding);
  const connected = { ...disconnected, status: 'connected', accountLabel: 'Original account', grantedScopeSetIds: ['view', 'export'] };
  expect(await port.status(key)).toEqual({ ...connected, pendingSwitchAccountLabel: 'New account' });
  const record: AdminSurfaceConnectionRecord = { ...base, staged: { expiresAt: '2030-01-01T00:00:00Z', account: switched } };
  host.readRecord.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
  expect(await port.status(key)).toEqual(connected);
  expect(await port.status(key)).toEqual(disconnected);
  expect(host.readRecord.mock.calls).toEqual([[{ key: ref }], [{ key: ref }], [{ key: ref }]]);
});

it('uses shared account status and unbinds without attempting to revoke it', async () => {
  const { host, binding, base } = fixture();
  let bound = true;
  const sharedOAuth = {
    hasBinding: vi.fn(async () => bound),
    getStatus: vi.fn(async () => bound ? base : null),
    stopUsing: vi.fn(async () => { bound = false; }),
  };
  const port = createAdminSurfaceConnections({ ...binding, host: { ...host, sharedOAuth } });
  expect(await port.status(key)).toEqual({ ...disconnected, status: 'connected', accountLabel: 'Original account', grantedScopeSetIds: ['view', 'export'] });
  await expect(port.begin({ ...key, action: 'switch' })).rejects.toThrow('Connection unavailable in this scope');
  await expect(port.confirmSwitch(key)).rejects.toThrow('Connection unavailable in this scope');
  expect(host.startSignIn.mock.calls).toEqual([]);
  expect(await port.begin({ ...key, action: 'connect' })).toEqual(start);
  expect(host.startSignIn.mock.calls).toEqual([[{ connection, actorId: 'operator', intent: 'connect', scopeSetIds: [], destination: 'shared' }, {}]]);
  expect(await port.disconnect(key)).toEqual({ ...disconnected, revocation: 'not-needed' });
  expect(sharedOAuth.stopUsing.mock.calls).toEqual([[connection]]);
  expect(host.service.mock.calls).toEqual([]);
  expect(bound).toBe(false);
});

it('pins an account for the resolved credential and requires an actor before even listing credentials', async () => {
  const { host, binding } = fixture();
  const signal = new AbortController().signal;
  const pinnedTokenOptions = vi.fn(() => ({ expectedAccountId: 'owner-1' }));
  const port = createAdminSurfaceConnections({ ...binding, host: { ...host, pinnedTokenOptions }, signal });
  expect(await port.getAccessToken(key)).toBe('fixture-token');
  expect(pinnedTokenOptions.mock.calls).toEqual([[{ signal, connectionRef: ref }]]);
  expect(host.getAccessToken.mock.calls).toEqual([[{ workspaceId: 'studio', pluginId: 'sheets', connectionRef: ref }, { expectedAccountId: 'owner-1' }]]);
  host.listConnections.mockClear();
  const anonymous = createAdminSurfaceConnections({ host, pluginId: 'sheets', workspaceId: 'studio' });
  await expect(anonymous.getAccessToken(key)).rejects.toThrow('Connection unavailable in this scope');
  await expect(createAdminSurfaceConnections({ ...binding, workspaceId: 'other' }).status(key)).rejects.toThrow('Connection unavailable in this scope');
  expect(host.listConnections.mock.calls).toEqual([]);
});

it('returns the service result but rereads staging for both switch decisions and reports pending revocation', async () => {
  const { host, service, binding, base } = fixture();
  const port = createAdminSurfaceConnections(binding);
  host.readRecord.mockResolvedValue({ ...base, staged: null });
  expect(await port.confirmSwitch(key)).toEqual({ ...disconnected, status: 'connected', accountLabel: 'New account', grantedScopeSetIds: ['view', 'export'] });
  expect(service.confirmSwitchAccount.mock.calls).toEqual([[{ connectionRef: ref, workspaceId: 'studio', actorId: 'operator' }]]);
  expect(await port.cancelSwitch(key)).toEqual({ ...disconnected, status: 'connected', accountLabel: 'Original account', grantedScopeSetIds: ['view', 'export'] });
  expect(service.cancelSwitchAccount.mock.calls).toEqual([[{ connectionRef: ref, workspaceId: 'studio' }]]);
  expect(await port.disconnect(key)).toEqual({ ...disconnected, status: 'revocation-pending', revocation: 'pending' });
  expect(service.disconnect.mock.calls).toEqual([[{ connectionRef: ref, workspaceId: 'studio' }]]);
});

it('reports the issued start and makes successful desktop callback fields consumable once by attempt', async () => {
  const { host, binding, attempts } = fixture();
  attempts.set(ref, { code: 'previous-failure', nextAction: 'reconnect' });
  type Done = Awaited<NonNullable<AdminSurfaceSignInStarted['completion']>>;
  let finish!: (value: Done) => void;
  const completion = new Promise<Done>(resolve => { finish = resolve; });
  host.startSignIn.mockResolvedValueOnce({ ...start, completion });
  const onSignInIssued = vi.fn();
  const port = createAdminSurfaceConnections({ ...binding, onSignInIssued });
  expect(await port.begin({ ...key, action: 'connect' }, { scopeSetIds: ['view'], startParams: { prompt: 'select' } })).toEqual(start);
  expect(host.startSignIn.mock.calls).toEqual([[{ connection, actorId: 'operator', intent: 'connect', scopeSetIds: ['view'] }, { startParams: { prompt: 'select' } }]]);
  expect(onSignInIssued.mock.calls).toEqual([[{ ...start, pluginId: 'sheets', ...key }]]);
  const callback = { ...key, attemptId: 'attempt-1' };
  expect(await port.takeCallbackFields(callback)).toBeNull();
  finish({ callbackFields: { selected: 'file-7' } });
  await completion;
  expect(await port.takeCallbackFields({ ...key, attemptId: 'different-attempt' })).toBeNull();
  expect(await port.takeCallbackFields(callback)).toEqual({ selected: 'file-7' });
  expect(await port.takeCallbackFields(callback)).toBeNull();
  expect((await port.status(key)).lastSignInAttempt).toBeNull();
});

it('a bound shared connection with no credential reports disconnected without consulting the site record', async () => {
  const { host, binding } = fixture();
  const getStatus = vi.fn(async () => null);
  const port = createAdminSurfaceConnections({ ...binding, host: { ...host, sharedOAuth: {
    hasBinding: async () => true, getStatus, stopUsing: async () => { throw new Error('unexpected unbind'); },
  } } });
  expect(await port.status(key)).toEqual(disconnected);
  expect(getStatus.mock.calls).toEqual([[connection]]);
  expect(host.readRecord.mock.calls).toEqual([]);
});

it('skipping desktop sign-in retains the old attempt and leaves the callback inbox empty', async () => {
  const { host, binding, attempts } = fixture();
  const prior = { code: 'previous-failure', nextAction: 'reconnect' } as const;
  attempts.set(ref, prior);
  host.startSignIn.mockResolvedValueOnce({ ...start, completion: Promise.resolve(null) });
  const port = createAdminSurfaceConnections(binding);
  await port.begin({ ...key, action: 'connect' });
  expect((await port.status(key)).lastSignInAttempt).toEqual(prior);
  expect(await port.takeCallbackFields({ ...key, attemptId: start.attemptId })).toBeNull();
  expect(await port.getAccessToken(key)).toBe('fixture-token');
  expect(host.getAccessToken.mock.calls).toEqual([[{ workspaceId: 'studio', pluginId: 'sheets', connectionRef: ref }, {}]]);
});
