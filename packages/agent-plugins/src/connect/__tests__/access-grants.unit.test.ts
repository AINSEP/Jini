import { expect, it, vi } from 'vitest';
import { createApplyConnectDefaults, recordAgentPluginAccessDeclined, type ApplyConnectDefaultsDeps } from '../apply-connect-defaults.js';
import { previewAgentPluginEnableAccess } from '../enable-access.js';
import { grantDeclaredToolsAtBoot, grantDeclaredToolsToSignedInRows } from '../grant-signed-in-defaults.js';
import { endpoint, memoryRepo, projections, row, sealed } from './mcp-fixture.js';

const declared = { type: 'streamable-http', url: endpoint, authMode: 'oauth', defaultTools: { allow: ['read', 'patch'], write: ['patch'] } } as const;
const messages = {
  sourceConfiguredSeparately: ({ connectionId }: { connectionId: string }) => `Source ${connectionId} is configured separately.`,
  sseTransportUnsupported: () => 'SSE is unsupported',
  headersUnsupported: () => 'Headers are unsupported',
  combinedGrantRejected: ({ detail }: { detail: string }) => `Grant refused: ${detail}`,
};
function fixture(initial = row()) {
  const { repo, rows } = memoryRepo(initial);
  const effects: string[] = [];
  const deps = {
    repo, projections, classifyError: () => 'other', workspaceId: 'studio', clock: { nowMs: () => 0 },
    resolveServers: vi.fn(async () => ({ main: declared })),
    enablePlugin: vi.fn<ApplyConnectDefaultsDeps['enablePlugin']>(async () => { effects.push('activation'); return true; }),
    applyAccess: vi.fn<ApplyConnectDefaultsDeps['applyAccess']>(async ({ serverId, workspaceId, expected, access, principalId }) => {
      expect(workspaceId).toBe('studio');
      const saved = rows.get(serverId);
      if (!saved) throw new Error('missing row');
      expect(expected).toEqual(projections.accessSnapshot({ record: saved }));
      effects.push('access');
      rows.set(serverId, { ...saved, enabled: access.enabled, allowedToolNames: JSON.stringify(access.allowedToolNames),
        writeAllowedToolNames: JSON.stringify(access.writeAllowedToolNames), writeGrantsUpdatedByPrincipalId: principalId });
    }),
    notifyRosterChanged: vi.fn(async () => { effects.push('reload'); }),
    isPluginOffByOperator: vi.fn(async () => false),
    actors: { connectDefaults: 'studio:sign-in', connectDeclined: 'studio:declined' },
    combinedGrantRejected: messages.combinedGrantRejected,
    warn: vi.fn(), approvedFailure: ({ connectionId, detail }: { connectionId: string; detail: string }) => `Could not grant ${connectionId}: ${detail}`,
  } satisfies ApplyConnectDefaultsDeps & { warn: (message: string) => void; approvedFailure(input: { connectionId: string; detail: string }): string };
  const preview = () => previewAgentPluginEnableAccess({ ...deps, pluginId: 'sync', servers: { main: declared }, classifyTrust: () => 'auto-admit', messages });
  return { deps, rows, effects, preview };
}

it('sign-in enables first, saves only the declared grants once, and reloads after the write', async () => {
  const { deps, effects } = fixture();
  const grant = createApplyConnectDefaults(deps);
  await grant('main');
  await grant('main');
  expect(effects).toEqual(['activation', 'access', 'reload']);
  expect(deps.enablePlugin.mock.calls).toEqual([[{ workspaceId: 'studio', pluginId: 'sync', actor: 'studio:sign-in' }]]);
  expect(await deps.repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toMatchObject({
    enabled: true, allowedToolNames: '["read","patch"]', writeAllowedToolNames: '["patch"]',
    writeGrantsUpdatedByPrincipalId: 'studio:sign-in', sealedOAuth: sealed,
  });
});

it('does not grant after the activation lock detects the operator turned the plugin off', async () => {
  const { deps, effects } = fixture();
  deps.enablePlugin.mockImplementationOnce(async () => { effects.push('operator off at lock'); return false; });
  await createApplyConnectDefaults(deps)('main');
  expect(effects).toEqual(['operator off at lock']);
  expect(await deps.repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toEqual(row());
});

it('a previewed grant survives only the expected adoption and is attributed to the approving actor', async () => {
  const { deps, rows, preview, effects } = fixture(row({ provisionedByPluginId: null, allowedToolNames: '["owned"]' }));
  const { key } = await preview();
  rows.set('main', row({ allowedToolNames: '["owned"]' }));
  await createApplyConnectDefaults(deps, { approvedEnable: { principalId: 'approver', accessKey: key } })('main');
  expect(effects).toEqual(['activation', 'access', 'reload']);
  const actual = await deps.repo.findByServerId({ workspaceId: 'studio', serverId: 'main' });
  expect(actual).toMatchObject({ allowedToolNames: '["owned","read","patch"]', writeAllowedToolNames: '["patch"]', writeGrantsUpdatedByPrincipalId: 'approver' });
});

it.each([
  { label: 'missing snapshot', accessKey: '', message: 'The approved access snapshot is missing.' },
  { label: 'unlisted source', accessKey: '[]', message: "The approved card did not grant access to 'main'." },
  { label: 'changed owner', patch: { pluginId: 'different' }, message: 'The connection owner changed after approval.' },
  { label: 'changed declaration', patch: { grant: { enabled: true, allow: ['read'], write: [] } }, message: 'The plugin declaration or access changed after approval.' },
  { label: 'changed endpoint', patch: { url: 'https://old.example.test/mcp' }, message: 'The plugin declaration or access changed after approval.' },
  { label: 'changed source revision', patch: { expected: { ...projections.accessSnapshot({ record: row() }), admissionRevision: 'old revision' } }, message: 'The plugin declaration or access changed after approval.' },
  { label: 'changed new-source lists', patch: { expected: null, current: { enabled: true, allow: [], write: [] } }, message: 'The plugin declaration or access changed after approval.' },
])('an approval with $label never enables or grants', async ({ accessKey, patch, message }) => {
  const { deps, preview, effects } = fixture();
  const { snapshots } = await preview();
  await expect(createApplyConnectDefaults(deps, { approvedEnable: {
    principalId: 'approver', accessKey: accessKey ?? JSON.stringify([{ ...snapshots[0], ...patch }]),
  } })('main')).rejects.toThrow(message);
  expect(effects).toEqual([]);
});

it('records only an eligible declined proposal without changing its tool lists or stored token', async () => {
  const initial = row({ allowedToolNames: '["kept"]', writeAllowedToolNames: '[]' });
  const { deps, preview } = fixture(initial);
  const { snapshots } = await preview();
  const entry = snapshots[0]!;
  const accessKey = JSON.stringify([
    { ...entry, connectionId: 'new', expected: null }, { ...entry, connectionId: 'nothing', grant: null },
    { ...entry, connectionId: 'edited', expected: { ...entry.expected, writeGrantsUpdatedByPrincipalId: 'owner' } }, entry,
  ]);
  await recordAgentPluginAccessDeclined({ applyAccess: deps.applyAccess, workspaceId: 'studio', accessKey, actorId: 'studio:declined' });
  expect(deps.applyAccess.mock.calls.map(([input]) => input)).toEqual([{
    workspaceId: 'studio', serverId: 'main', principalId: 'studio:declined',
    expected: entry.expected, access: { enabled: false, allowedToolNames: ['kept'], writeAllowedToolNames: [] },
  }]);
  expect(await deps.repo.findByServerId({ workspaceId: 'studio', serverId: 'main' })).toEqual({ ...initial, writeGrantsUpdatedByPrincipalId: 'studio:declined' });
});

it('enable preview refuses a repointed row and a declaration whose transport cannot be admitted', async () => {
  const { deps, preview } = fixture(row({ url: 'https://older.example.test/mcp' }));
  await expect(preview()).rejects.toThrow('Source main is configured separately.');
  await expect(previewAgentPluginEnableAccess({ ...deps, pluginId: 'sync', servers: { main: { type: 'sse', url: endpoint } },
    classifyTrust: () => 'auto-admit', messages })).rejects.toThrow('The plugin connection cannot be enabled here: main: SSE is unsupported');
});

it('boot replays only historically ungranted signed-in rows of active plugins and logs actual changes', async () => {
  const { deps, rows } = fixture();
  rows.set('edited', row({ serverId: 'edited', writeGrantsUpdatedByPrincipalId: 'operator' }));
  rows.set('pending', row({ serverId: 'pending', oauthStatus: 'pending', sealedOAuth: null }));
  rows.set('off', row({ serverId: 'off', provisionedByPluginId: 'off' }));
  const warn = vi.fn(), info = vi.fn();
  await grantDeclaredToolsAtBoot({ deps: { ...deps,
    listPlugins: async () => [{ pluginId: 'sync', servers: { main: declared, edited: declared, pending: declared } }, { pluginId: 'off', servers: { off: declared } }],
    readActivations: async () => ({ plugins: { off: { enabled: false } } }),
  }, log: { warn, info } });
  expect(info.mock.calls).toEqual([["[agent-plugins] 'sync': turned on its signed-in connection(s) main with the tools the plugin declares."]]);
  expect(warn.mock.calls).toEqual([]);
  expect([...rows].map(([id, saved]) => [id, saved.enabled])).toEqual([['main', true], ['edited', false], ['pending', false], ['off', false]]);
});

it('an explicit enable cannot hide a grant failure after approval', async () => {
  const { deps, preview } = fixture();
  const { key } = await preview();
  const onConnected = vi.fn(async () => { throw new Error('store read-only'); });
  await expect(grantDeclaredToolsToSignedInRows({ deps: { ...deps, onConnected }, pluginId: 'sync', servers: { main: declared } },
    { approvedEnable: { principalId: 'approver', accessKey: key } })).rejects.toThrow('Could not grant main: store read-only');
  expect(onConnected.mock.calls).toEqual([['main']]);
  expect(deps.warn.mock.calls).toEqual([]);
});
