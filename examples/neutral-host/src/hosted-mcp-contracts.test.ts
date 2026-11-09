/**
 * EXTRACT-S5 H1a second host: wires the public hosted-MCP contracts with its own identity, ids, paths,
 * token-hint and shared-owner shapes. Resolves only `@jini-ai/core` contract entries and the type-only
 * `@jini-ai/integrations/api-connections/hosted-mcp` entry; no product types.
 */
import { expect, it } from 'vitest';
import type { ExternalMcpServerRecord, ExternalMcpServerRepoPort, ExternalMcpServerView, ExternalMcpConnectStart, ExternalMcpAccessSnapshot } from '@jini-ai/core/contracts/hosted-mcp';
import type { DeviceAuthorizationStore, ExternalMcpOAuthDeps } from '@jini-ai/integrations/api-connections/hosted-mcp';
import type { DeviceAuthorization } from '@jini-ai/core/contracts/oauth';

interface AcmeHint { readonly fingerprint: string }
interface AcmeSharedOwner { readonly tenantId: string }

function row(serverId: string): ExternalMcpServerRecord {
  return { workspaceId: 'acme-workspace-7', serverId, label: 'Acme tools', provisionedByPluginId: 'acme.catalog.tools', transport: 'streamable_http', authMode: 'oauth',
    enabled: true, command: null, url: 'https://tools.acme.example/mcp', args: null, allowedToolNames: '["acme_lookup"]', writeAllowedToolNames: '[]',
    writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null, sealedEnv: null, oauthProviderId: 'acme-idp', oauthGrant: 'device_code',
    oauthClientId: 'acme-client', oauthEndpointsJson: null, oauthScopesJson: '["tools.read"]', oauthStatus: 'connected', oauthExpiresAt: null, oauthTokenEnvName: null,
    oauthRefreshLeaseUntil: null, sealedOAuth: null, aadVersion: 1, oauthAadVersion: 1, createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' };
}

/** A whole-row memory repository: the same instance would be handed to store and sign-in. */
function memoryRepo(): ExternalMcpServerRepoPort & { readonly rows: Map<string, ExternalMcpServerRecord> } {
  const rows = new Map<string, ExternalMcpServerRecord>();
  const key = (input: { workspaceId: string; serverId: string }) => `${input.workspaceId}/${input.serverId}`;
  return { rows,
    listByWorkspaceId: async workspaceId => [...rows.values()].filter(r => r.workspaceId === workspaceId),
    findByServerId: async input => rows.get(key(input)) ?? null,
    upsert: async record => { rows.set(key(record), record); },
    updateAccessIfCurrent: async ({ workspaceId, serverId, expected, access, principalId, nowIso }) => {
      const current = rows.get(key({ workspaceId, serverId }));
      if (!current || current.enabled !== expected.enabled || current.allowedToolNames !== expected.allowedToolNames) return false;
      rows.set(key(current), { ...current, ...access, writeGrantsUpdatedByPrincipalId: principalId, writeGrantsUpdatedAt: nowIso });
      return true;
    },
    deleteByServerId: async input => rows.delete(key(input)),
    tryClaimOAuthRefreshLease: async () => true,
    releaseOAuthRefreshLease: async () => undefined };
}

it('a second host fulfills the canonical repository and device store with its own vocabulary', async () => {
  const repo = memoryRepo();
  await repo.upsert(row('acme-tools'));
  const expected: ExternalMcpAccessSnapshot = { admissionRevision: 'r', enabled: true, allowedToolNames: '["acme_lookup"]', writeAllowedToolNames: '[]',
    writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, provisionedByPluginId: 'acme.catalog.tools' };
  const updated = await repo.updateAccessIfCurrent({ workspaceId: 'acme-workspace-7', serverId: 'acme-tools', expected,
    access: { enabled: false, allowedToolNames: '[]', writeAllowedToolNames: '[]' }, principalId: 'acme:admin', nowIso: '2026-05-02T00:00:00.000Z' });
  expect(updated).toBe(true);
  expect((await repo.findByServerId({ workspaceId: 'acme-workspace-7', serverId: 'acme-tools' }))?.writeGrantsUpdatedByPrincipalId).toBe('acme:admin');

  const pending = new Map<string, DeviceAuthorization>();
  const devices: DeviceAuthorizationStore = { put: async (id, a) => { pending.set(id, a); }, get: async id => pending.get(id), delete: async id => { pending.delete(id); } };
  await devices.put('acme-tools', { deviceCode: 'dc', userCode: 'ACME-1', verificationUri: 'https://idp.acme.example/device', verificationUriComplete: null, expiresAt: '2026-05-02T00:10:00.000Z', intervalSeconds: 5 });
  expect((await devices.get('acme-tools'))?.userCode).toBe('ACME-1');

  const deps: Pick<ExternalMcpOAuthDeps<AcmeSharedOwner>, 'shared' | 'workspaceId' | 'repo' | 'devices'> = { shared: { tenantId: 'acme' }, workspaceId: 'acme-workspace-7', repo, devices };
  expect(deps.repo).toBe(repo);
  const view: Pick<ExternalMcpServerView<AcmeHint>, 'accessTokenHint'> = { accessTokenHint: { fingerprint: 'f1' } };
  const start: ExternalMcpConnectStart = { kind: 'redirect_required', authorizationUrl: 'https://idp.acme.example/authorize', expiresAt: '2026-05-02T00:10:00.000Z' };
  expect([view.accessTokenHint?.fingerprint, start.kind]).toEqual(['f1', 'redirect_required']);
});
