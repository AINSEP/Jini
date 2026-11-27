import { expect, vi } from 'vitest';
import type { AgentPluginMcpAccessSnapshot, AgentPluginMcpProjectionPorts, AgentPluginMcpRecord, AgentPluginMcpRepo } from '../ports.js';

export const endpoint = 'https://api.example.test/mcp';
export const sealed = { keyId: 'fixture-key', ciphertext: 'opaque', nonce: 'fixture-nonce', alg: 'fixture' };
const savedAt = '2026-01-01T00:00:00.000Z';
export function row(overrides: Partial<AgentPluginMcpRecord> = {}): AgentPluginMcpRecord {
  return {
    workspaceId: 'studio', serverId: 'main', provisionedByPluginId: 'sync', transport: 'streamable_http', authMode: 'oauth',
    enabled: false, command: null, label: 'Studio connection', url: endpoint, args: null, allowedToolNames: null, writeAllowedToolNames: null,
    writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null, sealedEnv: null, oauthProviderId: null,
    oauthGrant: 'authorization_code', oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null, oauthStatus: 'connected',
    oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: sealed,
    aadVersion: 1, oauthAadVersion: 1, createdAt: savedAt, updatedAt: savedAt, version: 3, ...overrides,
  };
}

export const projections: AgentPluginMcpProjectionPorts['projections'] = {
  oauthStatus: ({ oauthStatus }) => oauthStatus === 'connected' || oauthStatus === 'pending' || oauthStatus === 'needs_reauth' ? oauthStatus : 'disconnected',
  hasStaticAccessToken: ({ authMode, sealedOAuth }) => authMode === 'static_env' && sealedOAuth !== null,
  admissionRevision: record => `source:${record.url}:${record.authMode}`,
  accessSnapshot: ({ record }): AgentPluginMcpAccessSnapshot => ({
    admissionRevision: `source:${record.url}:${record.authMode}`, enabled: record.enabled, allowedToolNames: record.allowedToolNames,
    writeAllowedToolNames: record.writeAllowedToolNames, writeGrantsUpdatedByPrincipalId: record.writeGrantsUpdatedByPrincipalId,
    writeGrantsUpdatedAt: record.writeGrantsUpdatedAt, provisionedByPluginId: record.provisionedByPluginId,
  }),
  readToolGrants: record => ({ allowedToolNames: JSON.parse(record.allowedToolNames ?? '[]'), writeAllowedToolNames: JSON.parse(record.writeAllowedToolNames ?? '[]') }),
  validateToolNames: ({ names }) => [...names],
};

export function memoryRepo(...initial: AgentPluginMcpRecord[]) {
  const rows = new Map(initial.map(record => [record.serverId, record]));
  const repo = {
    findByServerId: vi.fn<AgentPluginMcpRepo['findByServerId']>(async ({ workspaceId, serverId }) => {
      expect(workspaceId).toBe('studio');
      const record = rows.get(serverId);
      return record ? { ...record } : null;
    }),
    updateIfVersion: vi.fn<AgentPluginMcpRepo['updateIfVersion']>(async ({ record, expectedVersion, replaces }) => {
      const current = rows.get(record.serverId);
      if (current?.version !== expectedVersion || current.sealedEnv !== replaces.sealedEnv || current.sealedOAuth !== replaces.sealedOAuth) return false;
      rows.set(record.serverId, { ...record, version: expectedVersion + 1 });
      return true;
    }),
    deleteByServerId: vi.fn<AgentPluginMcpRepo['deleteByServerId']>(async ({ workspaceId, serverId }) => {
      expect(workspaceId).toBe('studio');
      return rows.delete(serverId);
    }),
    updateAccessIfCurrent: vi.fn<AgentPluginMcpRepo['updateAccessIfCurrent']>(async () => { throw new Error('unexpected access write'); }),
  } satisfies AgentPluginMcpRepo;
  return { rows, repo };
}

export function memoryMcp(...initial: AgentPluginMcpRecord[]) {
  const { rows, repo } = memoryRepo(...initial);
  const saveServer = vi.fn<import('../ports.js').AgentPluginMcpPort['saveServer']>(async input => {
    expect(input.workspaceId).toBe('studio');
    const prior = rows.get(input.serverId);
    const authMode = input.authMode ?? 'none';
    const sealedOAuth = input.accessToken ? sealed : prior?.sealedOAuth ?? null;
    const updated = row({ ...prior, serverId: input.serverId, label: input.label ?? prior?.label ?? null, authMode,
      provisionedByPluginId: input.provisionedByPluginId ?? prior?.provisionedByPluginId ?? null,
      url: input.url ?? null, enabled: input.enabled, transport: input.transport,
      allowedToolNames: JSON.stringify(input.allowedToolNames ? input.allowedToolNames.split(',') : []),
      writeAllowedToolNames: JSON.stringify(input.writeAllowedToolNames ? input.writeAllowedToolNames.split(',') : []),
      oauthStatus: authMode === 'oauth' ? prior?.oauthStatus ?? 'disconnected' : null,
      oauthGrant: input.oauth?.grant ?? prior?.oauthGrant ?? null,
      version: (prior?.version ?? 0) + 1, sealedOAuth,
    });
    rows.set(input.serverId, updated);
    return {
      serverId: updated.serverId, label: updated.label ?? '', provisionedByPluginId: updated.provisionedByPluginId, transport: updated.transport,
      authMode, enabled: updated.enabled, command: input.command, url: updated.url, args: [], ...projections.readToolGrants(updated),
      writeGrantsUpdatedByPrincipalId: updated.writeGrantsUpdatedByPrincipalId, writeGrantsUpdatedAt: updated.writeGrantsUpdatedAt,
      envNames: [], hasAccessToken: projections.hasStaticAccessToken(updated), accessTokenEnvName: null, version: updated.version,
      oauth: { providerId: null, grant: updated.oauthGrant, clientId: null, scopes: [], status: projections.oauthStatus(updated),
        expiresAt: null, tokenEnvName: null, hasStoredToken: sealedOAuth !== null },
    };
  });
  const notifyRosterChanged = vi.fn<import('../ports.js').AgentPluginMcpPort['notifyRosterChanged']>(async () => {});
  const applyAccess = vi.fn<import('../ports.js').AgentPluginMcpPort['applyAccess']>(async ({ workspaceId, serverId, expected, access, principalId }) => {
    const saved = await repo.findByServerId({ workspaceId, serverId });
    if (!saved) throw new Error('fixture row missing');
    expect(expected).toEqual(projections.accessSnapshot({ record: saved }));
    rows.set(serverId, { ...saved, enabled: access.enabled, allowedToolNames: JSON.stringify(access.allowedToolNames),
      writeAllowedToolNames: JSON.stringify(access.writeAllowedToolNames), writeGrantsUpdatedByPrincipalId: principalId, version: saved.version + 1 });
  });
  return { rows, mcp: { repo, projections, classifyError: () => 'other' as const, saveServer, notifyRosterChanged, applyAccess } };
}
