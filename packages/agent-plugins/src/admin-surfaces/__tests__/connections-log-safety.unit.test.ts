import { afterEach, expect, test, vi } from 'vitest';
import { createAdminSurfaceConnections } from '../connections/connections.js';

afterEach(() => { vi.restoreAllMocks(); });

test('a failed desktop sign-in warns with the error class only and keeps the generic stored attempt', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const secret = Object.assign(new Error('boom api_key=SECRETSECRETSECRETSECRET'), { code: 'SECRETSECRETSECRETSECRET' });
  const attempts = new Map<string, unknown>();
  const connection = { pluginId: 'p', descriptor: { connectionId: 'c' }, scopeSets: [] };
  const host = {
    workspaceId: 'ws', nowMs: () => 0, connectionKey: ({ connectionId }: { connectionId: string }) => `ref:${connectionId}`,
    listConnections: async () => [connection],
    startSignIn: async () => ({ authorizationUrl: 'https://auth.example/start', attemptId: 'a1', expiresAt: '2030-01-01T00:00:00.000Z', completion: Promise.reject(secret) }),
    attempts: { get: (ref: string) => attempts.get(ref), set: (ref: string, attempt: unknown) => { attempts.set(ref, attempt); }, delete: (ref: string) => { attempts.delete(ref); } },
    callbackInbox: { deposit: () => {}, take: () => null },
    notAvailable: () => new Error('not available'),
  };
  const port = createAdminSurfaceConnections({ host: host as never, pluginId: 'p', workspaceId: 'ws', principalId: 'admin' });
  await port.begin({ connectionId: 'c', action: 'connect' });
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  const printed = warn.mock.calls.flat().map(String).join('\n');
  expect(printed).toBe("[admin-surfaces] desktop sign-in for 'p' did not complete: Error");
  for (const banned of ['boom', 'SECRETSECRET', 'connections-log-safety']) expect(printed).not.toContain(banned);
  expect(attempts.get('ref:c')).toEqual({ code: 'sign-in-failed', nextAction: 'reconnect' });
});
