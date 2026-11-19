import { expect, it, vi } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
import type { ExternalMcpServerRecord } from '@jini-ai/core/contracts/hosted-mcp';
import { setToken, getToken } from '../core/tokens.js';
import { InMemoryExternalMcpServerRepo } from '../federation/hosted/store.memory.js';
import { createFederationReloadCoordinator } from '../federation/reload.js';
import { defaultFederationMessages } from '../federation/messages.js';

it('returns a token write failure and runs the queued token write once', async () => {
  const failure = new Error('token write refused');
  let reject!: (error: unknown) => void;
  let contents = '{"servers":{}}';
  const writeSecretText = vi.fn().mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }))
    .mockImplementation(async (input: { contents: string }) => { contents = input.contents; });
  const filesystem = { readText: async () => contents, writeSecretText };
  const args = { dataDir: '/mcp-settlement', serverId: 'server', clock: { nowMs: () => 0 },
    token: { accessToken: 'fixture', tokenType: 'Bearer', savedAt: 0 } };
  const first = setToken(args, { filesystem });
  const rejected = expect(first).rejects.toBe(failure);
  const second = setToken(args, { filesystem });
  await vi.waitFor(() => expect(writeSecretText).toHaveBeenCalledTimes(1));
  reject(failure);
  await rejected;
  await expect(second).resolves.toBeUndefined();
  expect(writeSecretText).toHaveBeenCalledTimes(2);
  expect(await getToken(args, { filesystem })).toEqual(args.token);
});

it('returns a hosted store failure and commits the queued insert once', async () => {
  const failure = new Error('vault unavailable');
  const vault: VaultRepoPort = { find: async () => null, list: async () => [],
    put: async ({ record }) => ({ ...record, isDefault: record.isDefault ?? false }),
    patchMeta: async () => { throw new Error('unused patch'); }, delete: async () => false };
  const createMemoryRepo = vi.fn().mockImplementationOnce(() => { throw failure; }).mockReturnValue(vault);
  const repo = new InMemoryExternalMcpServerRepo({ vault: { createMemoryRepo,
    createService: () => { throw new Error('unused service'); } }, vaultErrors: { create: ({ code }) => new Error(code) } });
  const record: ExternalMcpServerRecord = {
    workspaceId: 'ws', serverId: 'server', label: 'Fixture', provisionedByPluginId: null, transport: 'http', authMode: 'oauth', enabled: true,
    command: null, url: 'https://mcp.test', args: '[]', allowedToolNames: '[]', writeAllowedToolNames: '[]',
    writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: '[]', sealedEnv: null,
    oauthProviderId: null, oauthGrant: 'authorization_code', oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: 'connected', oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null,
    sealedOAuth: null, aadVersion: 1, oauthAadVersion: 1, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', version: 1,
  };
  const first = repo.insert({ record });
  const rejected = expect(first).rejects.toBe(failure);
  const second = repo.insert({ record });
  await rejected;
  await expect(second).resolves.toBe(true);
  expect(createMemoryRepo).toHaveBeenCalledTimes(2);
  expect(await repo.findByServerId(record)).toEqual(record);
});

it('returns the reload failure and runs the queued successor pass once', async () => {
  const failure = new Error('roster unavailable');
  let reject!: (error: unknown) => void;
  const resolveConnections = vi.fn().mockReturnValueOnce(new Promise<never>((_resolve, fail) => { reject = fail; })).mockResolvedValue([]);
  const coordinator = createFederationReloadCoordinator({ initiallyAdmitted: [], coordDeps: {
    registry: createToolRegistry(), resolveConnections,
    deps: { errorCode: 'EXTERNAL_MCP', messages: defaultFederationMessages, scope: 'ws', permissionGate: async () => {} },
    connect: async () => { throw new Error('unused connection'); },
  } });
  const first = coordinator.reload({});
  const rejected = expect(first).rejects.toBe(failure);
  const second = coordinator.reload({});
  expect(coordinator.reload({})).toBe(second);
  expect(resolveConnections).toHaveBeenCalledTimes(1);
  reject(failure);
  await rejected;
  await expect(second).resolves.toEqual({ newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] });
  expect(resolveConnections).toHaveBeenCalledTimes(2);
});
