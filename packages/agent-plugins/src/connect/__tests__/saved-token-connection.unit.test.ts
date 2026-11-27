import { expect, test, vi } from 'vitest';
import type { AgentPluginMcpRecord, AgentPluginMcpRepo } from '../ports.js';
import { updateAgentPluginMcpRow } from '../row-update.js';
import { switchOnSavedTokenConnection } from '../switch-on-saved-token.js';

const key = { workspaceId: 'site-b', serverId: 'send-api' };
const row: AgentPluginMcpRecord = {
  ...key, label: 'Send API', enabled: false, provisionedByPluginId: 'send-mail',
  transport: 'streamable_http', authMode: 'static_env', command: null, url: 'https://vendor.example/mcp',
  args: null, allowedToolNames: null, writeAllowedToolNames: null, writeGrantsUpdatedAt: null,
  writeGrantsUpdatedByPrincipalId: null, envNames: null, sealedEnv: null, oauthProviderId: null,
  oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null, oauthStatus: null,
  oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
  aadVersion: 1, oauthAadVersion: 1, version: 7, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};

function repoWith(initial: AgentPluginMcpRecord | null) {
  let stored = initial;
  const findByServerId = vi.fn<AgentPluginMcpRepo['findByServerId']>(async input => {
    if (input.workspaceId !== key.workspaceId || input.serverId !== key.serverId) throw new Error('wrong row key');
    return stored;
  });
  const updateIfVersion = vi.fn<AgentPluginMcpRepo['updateIfVersion']>(async ({ record, expectedVersion, replaces }) => {
    if (record.workspaceId !== key.workspaceId || record.serverId !== key.serverId) throw new Error('wrong row key');
    if (stored?.version !== expectedVersion || replaces.sealedEnv !== stored.sealedEnv || replaces.sealedOAuth !== stored.sealedOAuth) return false;
    stored = { ...record, version: expectedVersion + 1 };
    return true;
  });
  return {
    findByServerId, updateIfVersion,
    deleteByServerId: async () => { throw new Error('unexpected deletion'); },
    updateAccessIfCurrent: async () => { throw new Error('unexpected access rewrite'); },
  };
}

test('rebuilds from a concurrent row edit instead of writing back stale fields', async () => {
  const repo = repoWith(row);
  const edited = { ...row, label: 'Edited by operator' };
  const commit = repo.updateIfVersion.getMockImplementation()!;
  repo.updateIfVersion.mockImplementationOnce(async () => {
    await commit({ record: edited, expectedVersion: 7, replaces: { sealedEnv: null, sealedOAuth: null } });
    return false;
  });
  const build = (current: AgentPluginMcpRecord) => ({ ...current, enabled: true });
  await updateAgentPluginMcpRow({ key, repo, build });
  expect(repo.updateIfVersion.mock.calls).toEqual([
    [{ record: { ...row, enabled: true }, expectedVersion: 7, replaces: { sealedEnv: null, sealedOAuth: null } }],
    [{ record: { ...edited, version: 8, enabled: true }, expectedVersion: 8, replaces: { sealedEnv: null, sealedOAuth: null } }],
  ]);
  await expect(repo.findByServerId(key)).resolves.toEqual({ ...edited, enabled: true, version: 9 });
});

test.each([
  ['already off', true, false, false, 'plugin-off-by-operator'],
  ['row left off', false, false, false, 'connection-off-by-operator'],
  ['turned off during connect', false, true, false, 'plugin-off-by-operator'],
  ['connected', false, true, true, 'on'],
] as const)('honors the activation owner when the plugin is %s', async (_case, off, applyDefaults, turnOn, state) => {
  const repo = repoWith(row);
  const isPluginOffByOperator = vi.fn(async (_pluginId: string) => off);
  const onConnected = vi.fn(async (serverId: string) => {
    if (applyDefaults) await updateAgentPluginMcpRow({ repo, key: { ...key, serverId }, build: current => ({ ...current, enabled: true }) });
  });
  const switchPluginOn = vi.fn(async (_pluginId: string) => turnOn);
  await expect(switchOnSavedTokenConnection({
    pluginId: 'send-mail', connectionId: key.serverId,
    deps: { workspaceId: key.workspaceId, mcp: { repo }, onConnected, isPluginOffByOperator, switchPluginOn },
  })).resolves.toEqual({ state });
  expect(isPluginOffByOperator.mock.calls).toEqual([['send-mail']]);
  expect(onConnected.mock.calls).toEqual(off ? [] : [[key.serverId]]);
  expect(switchPluginOn.mock.calls).toEqual(applyDefaults ? [['send-mail']] : []);
  await expect(repo.findByServerId(key)).resolves.toEqual(applyDefaults ? { ...row, version: 8, enabled: true } : row);
});

test('missing and unchanged rows return null without a conditional write', async () => {
  const missing = repoWith(null);
  const build = vi.fn((_current: AgentPluginMcpRecord) => null);
  await expect(updateAgentPluginMcpRow({ key, repo: missing, build })).resolves.toBeNull();
  expect(build.mock.calls).toEqual([]);
  expect(missing.updateIfVersion.mock.calls).toEqual([]);
  const existing = repoWith(row);
  await expect(updateAgentPluginMcpRow({ key, repo: existing, build })).resolves.toBeNull();
  expect(build.mock.calls).toEqual([[row]]);
  expect(existing.updateIfVersion.mock.calls).toEqual([]);
  await expect(existing.findByServerId(key)).resolves.toEqual(row);
});
