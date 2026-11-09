import { expect, test, vi } from 'vitest';
import type { ExternalMcpServerRecord } from '@jini-ai/core/contracts/hosted-mcp';
import type { OAuthTokenSet } from '@jini-ai/core/contracts/oauth';
import type { ApiConnectionRecord } from '../../types.js';
import { createDeviceAuthorizationStore } from '../sign-in.js';
import { createSharedExternalMcpOAuth, type SharedSignInIssuingContext } from '../shared-sign-in.js';

for (const grant of ['device_code', 'authorization_code']) {
  test(`a second owner workspace resumes shared ${grant} sign-in from losslessly persisted context`, async () => {
    const workspaceId = 'observatory-owner';
    const records = new Map<string, ApiConnectionRecord>();
    const contexts = new Map<string, string>();
    const tokens = new Map<string, OAuthTokenSet>();
    const bindings = new Map<string, string>();
    const provider = { providerId: 'observatory', tokenEndpoint: 'https://idp.example/token', authorizationEndpoint: 'https://idp.example/authorize' };
    const record = { serverId: 'telescope', authMode: 'oauth', transport: 'streamable_http', url: 'https://tools.example/mcp',
      oauthProviderId: null, oauthEndpointsJson: null, oauthScopesJson: '["observe"]', oauthGrant: grant } as ExternalMcpServerRecord;
    const client = { clientId: 'observatory-client', authMethod: 'none' as const };
    const clock = { nowMs: () => 0 };
    const devices = createDeviceAuthorizationStore();
    let attached = false;
    const readContext = async ({ credentialId }: { credentialId: string }) => {
      const saved = contexts.get(credentialId);
      return saved === undefined ? null : JSON.parse(saved) as SharedSignInIssuingContext;
    };
    const shared = {
      ownerWorkspaceId: workspaceId,
      siteId: 'observatory-site', siteName: 'Observatory', ownerPrincipalId: 'astronomer',
      owner: {
        records: {
          read: async ({ key }: { key: string }) => records.get(key) ?? null,
          compareAndSet: async ({ key, expectedRevision, record: next }: { key: string; expectedRevision: number; record: ApiConnectionRecord }) => {
            // A real second host validates its own owner workspace on every write.
            expect(next.workspaceId).toBe(workspaceId);
            expect(key).toMatch(/^api-connection:v1:observatory-owner:external-mcp:/);
            if ((records.get(key)?.revision ?? 0) !== expectedRevision) return false;
            records.set(key, structuredClone(next));
            return true;
          },
        },
        readContext,
        saveContext: async ({ credentialId, context }: { credentialId: string; context: SharedSignInIssuingContext }) => { contexts.set(credentialId, JSON.stringify(context)); },
        tokensFor: () => ({ install: async ({ key, tokens: next }: { key: string; tokens: OAuthTokenSet }) => { tokens.set(key, next); } }) as never,
        readConnection: async () => null,
      },
      bindings: {
        read: async ({ consumerId }: { consumerId: string }) => bindings.has(consumerId) ? { credentialId: bindings.get(consumerId)! } : null,
        set: async ({ consumerId, credentialId }: { consumerId: string; credentialId: string }) => { bindings.set(consumerId, credentialId); },
        remove: async () => undefined,
      },
      attachments: {
        attach: async () => { attached = true; }, detach: async () => { attached = false; }, isAttached: async () => attached,
      },
      transaction: async <T>({ run }: { run: () => Promise<T> }) => run(),
    };
    const complete = vi.fn(async (_input: unknown) => ({ accessToken: 'observatory-access', refreshToken: null, tokenType: 'Bearer', scopes: ['observe'], expiresAt: null }));
    const flow = {
      beginDeviceAuthorization: async () => ({ deviceCode: 'observatory-device', userCode: 'OBS', verificationUri: 'https://idp.example/verify', intervalSeconds: 5, expiresAt: '2030-01-01T00:00:00Z' }),
      pollDeviceAuthorizationOnce: complete, completeAuthorizationCode: complete,
      createSealedAuthorizationState: () => ({}),
      beginAuthorizationCode: async () => ({ authorizationUrl: 'https://idp.example/authorize', expiresAt: '2030-01-01T00:00:00Z' }),
    };
    const create = () => createSharedExternalMcpOAuth({
      deps: { workspaceId: 'observatory-site' as never, repo: { findByServerId: async () => record } as never, devices, clock, httpPorts: {} as never, keyring: {} as never, sealer: {} as never },
      shared, resolveProvider: () => provider as never,
      configure: async () => ({ record, provider: provider as never, client, scopes: ['observe'] }),
      ports: { flow, aad: { format: () => 'observatory-aad' }, registrationIdentity: { sharedClientName: 'Observatory', softwareId: 'observatory-agent' },
        copy: { sharedUnavailable: 'Observatory unavailable', sharedOwnerOnly: 'Observatory owner only' }, errors: { isOAuthError: () => false } } as never,
    });
    const first = create();
    await first.beginConnect({ serverId: record.serverId, destination: 'shared', redirectUri: 'https://observatory.example/callback', actorId: 'astronomer' });
    const credentialId = bindings.get('mcp:telescope')!;
    const persisted = JSON.parse(contexts.get(credentialId)!);
    expect(persisted.mcp).toEqual({ provider, scopes: ['observe'], url: record.url, grant });
    const resumed = create();
    if (grant === 'device_code') expect(await resumed.pollDeviceAuthorization({ serverId: record.serverId })).toEqual({ status: 'connected' });
    else await resumed.completeAuthorizationCallback({ serverId: record.serverId, redirectUri: 'https://observatory.example/callback', params: { state: 'observatory-state', code: 'observatory-code' } });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ client, provider });
    expect(records.get(credentialId)).toMatchObject({ workspaceId, status: 'connected', generation: 1 });
    expect(tokens.get(credentialId)?.accessToken).toBe('observatory-access');
  });
}
