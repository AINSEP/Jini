import type { ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardSecretRun, SurfaceCardSecretForm, SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import { expect, it, vi } from 'vitest';
import { probeToken, requireTargetRow, resolveTarget, saveAgentPluginToken, saveStaticAccessToken, type AgentPluginAccessTokenToolDeps, type AgentPluginTokenTargetDeps, type TokenAuthTarget } from '../access-token-tool.js';
import { importAgentPluginAccessToken, importAgentPluginAccessTokensFromEnv, type ImportAgentPluginAccessTokensFromEnvDeps } from '../import-access-token.js';
import { endpoint, memoryMcp, row, sealed } from './mcp-fixture.js';

const tokenAuth = { helpUrl: 'https://api.example.test/settings', probeUrl: 'https://api.example.test/whoami', importFromEnv: 'SYNC_TOKEN', retiredEnv: ['SYNC_OLD', 'SYNC_LEGACY'] };
const config = { type: 'streamable-http', url: endpoint, authMode: 'oauth', tokenAuth } as const;
const target: TokenAuthTarget = { pluginId: 'sync', displayName: 'Sync', connectionId: 'main', config };
const unsigned = () => row({ oauthStatus: 'disconnected', sealedOAuth: null });
function fixture(initial = unsigned()) {
  const { mcp, rows } = memoryMcp(initial);
  const resolveInstalledPlugin = vi.fn<AgentPluginTokenTargetDeps['resolveInstalledPlugin']>(async pluginId => pluginId === 'sync' ? { servers: { main: config } } : null);
  const switchOnSavedToken = vi.fn<ImportAgentPluginAccessTokensFromEnvDeps['switchOnSavedToken']>(async () => ({ state: 'on' }));
  const deps = {
    workspaceId: 'studio', mcp, resolveInstalledPlugin, switchOnSavedToken, importActor: 'studio:import',
    federation: { classifyTrust: () => 'auto-admit', messages: { sseTransportUnsupported: () => 'No SSE.', headersUnsupported: () => 'No custom headers.' } },
    messages: {
      connectionNotSetUp: ({ pluginId }) => `No provisioned row for ${pluginId}.`,
      connectionRepointed: ({ connectionId, displayName }) => `${displayName} row ${connectionId} has another host.`,
      notInstalled: ({ pluginId }) => `${pluginId} is not installed.`,
      noTokenSignIn: ({ pluginId }) => `${pluginId} does not take tokens.`,
      multipleTokenSignIns: ({ pluginId }) => `${pluginId} has multiple token servers.`,
      serverNotSetUp: ({ serverKey }) => `Invalid token server id for ${serverKey}.`,
    },
    listPlugins: vi.fn<ImportAgentPluginAccessTokensFromEnvDeps['listPlugins']>(async () => [{ pluginId: 'sync', bundled: true, servers: { main: config } }]),
    importMessages: { pluginsScreen: 'Connections', failed: ({ envName, pluginId }) => `Could not import ${envName} for ${pluginId}.` },
  } satisfies ImportAgentPluginAccessTokensFromEnvDeps;
  return { deps, rows };
}

it('target resolution refuses absent and ambiguous declarations before provisioning', async () => {
  const { deps } = fixture();
  const resolve = (pluginId: string) => resolveTarget({ routeDeps: deps, pluginId, principalId: 'owner' });
  await expect(resolve('unknown')).rejects.toThrow('unknown is not installed.');
  deps.resolveInstalledPlugin.mockResolvedValueOnce({ servers: { local: { type: 'stdio', command: 'fixture' } } })
    .mockResolvedValueOnce({ servers: { main: config, spare: config } }).mockResolvedValueOnce({ servers: { '???': config } });
  await expect(resolve('sync')).rejects.toThrow('sync does not take tokens.');
  await expect(resolve('sync')).rejects.toThrow('sync has multiple token servers.');
  await expect(resolve('sync')).rejects.toThrow('Invalid token server id for ???.');
  expect(deps.mcp.repo.findByServerId.mock.calls).toEqual([]);
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
});

it.each([null, 'not a valid URL', 'https://api.example.test.other.test/mcp'])('refuses credential writes to a row with endpoint %s', async url => {
  const { deps } = fixture(row({ url }));
  await expect(saveStaticAccessToken({ routeDeps: deps, target, principalId: 'owner', token: 'fixture-token' })).rejects.toThrow('Sync row main has another host.');
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
});

it('reports missing provisioning and honours abort after a fresh row read', async () => {
  const { deps, rows } = fixture();
  rows.delete('main');
  await expect(requireTargetRow({ routeDeps: deps, target })).rejects.toThrow('No provisioned row for sync.');
  const controller = new AbortController();
  const abort = new Error('call stopped');
  deps.mcp.repo.findByServerId.mockImplementationOnce(async () => { controller.abort(abort); return unsigned(); });
  await expect(saveStaticAccessToken({ routeDeps: deps, target, principalId: 'owner', token: 'fixture-token' }, { signal: controller.signal })).rejects.toBe(abort);
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
});

it('writes a token against the current row while keeping its URL, label and existing tool decisions', async () => {
  const current = row({ ...unsigned(), url: 'https://api.example.test/chosen', enabled: true,
    allowedToolNames: '["read",3,"patch"]', writeAllowedToolNames: '["patch"]' });
  const { deps, rows } = fixture(current);
  await saveStaticAccessToken({ routeDeps: deps, target, principalId: 'owner', token: 'fixture-token' });
  expect(deps.mcp.saveServer.mock.calls).toEqual([[{
    workspaceId: 'studio', serverId: 'main', principalId: 'owner', label: 'Studio connection', url: 'https://api.example.test/chosen',
    enabled: true, transport: 'streamable_http', authMode: 'static_env', command: '', args: '',
    accessToken: 'fixture-token', allowedToolNames: 'read,patch', writeAllowedToolNames: 'patch',
  }]]);
  expect(rows.get('main')).toMatchObject({ version: 4, authMode: 'static_env', enabled: true, sealedOAuth: sealed });
});

it('validates malformed tokens locally and preserves a definitive probe refusal', async () => {
  const probe = vi.fn(async () => 'refused' as const);
  const tokenValidator = { assertToken: ({ value }: { value: unknown }) => { if (value !== 'fixture-token') throw new Error('invalid token'); } };
  const invoke = (token: string) => probeToken({ probeUrl: tokenAuth.probeUrl, token, credentials: { probe }, tokenValidator });
  expect(await invoke('')).toBe('invalid');
  expect(probe.mock.calls).toEqual([]);
  expect(await invoke('fixture-token')).toBe('refused');
  expect(probe.mock.calls).toEqual([[{ probeUrl: 'https://api.example.test/whoami', token: 'fixture-token' }]]);
});

it('an explicit import keeps an existing credential but retries switching it on', async () => {
  const original = row();
  const { deps, rows } = fixture(original);
  expect(await importAgentPluginAccessToken({ deps, input: { pluginId: 'sync', token: 'replacement' } })).toBe('already-connected');
  expect(rows.get('main')).toBe(original);
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
  expect(deps.switchOnSavedToken.mock.calls).toEqual([[{ target }]]);
});

it('an import pinned to the declaration refuses a same-host URL edit', async () => {
  const { deps } = fixture(row({ ...unsigned(), url: 'https://api.example.test/different' }));
  // Enabled means provisioning may not discard this operator edit to "fix" the endpoint.
  deps.mcp.repo.findByServerId.mockImplementation(async () => row({ ...unsigned(), enabled: true, url: 'https://api.example.test/different' }));
  await expect(importAgentPluginAccessToken({ deps, input: { pluginId: 'sync', token: 'fixture', onlyAtUrl: endpoint } }))
    .rejects.toThrow("its 'main' connection points at a different URL than the 'sync' plugin declares, so the token is not copied there");
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
  expect(deps.switchOnSavedToken.mock.calls).toEqual([]);
});

it('boot never imports an unbundled or superseded token, but logs retired names and trims a bundled token', async () => {
  const { deps } = fixture();
  const log = { info: vi.fn(), warn: vi.fn() };
  const env = { SYNC_TOKEN: '  fixture  ', SYNC_OLD: 'legacy-value', SYNC_LEGACY: ' ' };
  deps.listPlugins.mockResolvedValueOnce([{ pluginId: 'sync', bundled: false, servers: { main: config } }]);
  await importAgentPluginAccessTokensFromEnv({ deps, env, log });
  expect(log.info.mock.calls).toEqual([]);
  expect(deps.resolveInstalledPlugin.mock.calls).toEqual([]);
  await importAgentPluginAccessTokensFromEnv({ deps, env, log }, { skipPluginIds: new Set(['sync']) });
  expect(log.info.mock.calls).toEqual([["[agent-plugins] SYNC_OLD is no longer used; the 'sync' plugin's connection replaces them. You can remove them."]]);
  expect(deps.mcp.saveServer.mock.calls).toEqual([]);
  await importAgentPluginAccessTokensFromEnv({ deps, env, log });
  expect(deps.mcp.saveServer.mock.calls.map(([input]) => [input.serverId, input.principalId, input.accessToken])).toEqual([['main', 'studio:import', 'fixture']]);
  expect(log.info.mock.calls.at(-1)).toEqual(["[agent-plugins] copied SYNC_TOKEN onto the 'sync' plugin's connection and switched it on. The env var is no longer needed."]);
  expect(log.warn.mock.calls).toEqual([]);
});

it('boot says when a saved token stays off, while save errors never publish their details', async () => {
  const { deps } = fixture();
  const log = { info: vi.fn(), warn: vi.fn() };
  const env = { SYNC_TOKEN: 'fixture-token' };
  deps.mcp.saveServer.mockRejectedValueOnce(new Error('store refused fixture-token'));
  await importAgentPluginAccessTokensFromEnv({ deps, env, log });
  expect(log.warn.mock.calls).toEqual([['Could not import SYNC_TOKEN for sync.']]);
  expect(log.info.mock.calls).toEqual([]);
  expect(deps.switchOnSavedToken.mock.calls).toEqual([]);
  deps.switchOnSavedToken.mockResolvedValueOnce({ state: 'plugin-off-by-operator' });
  await importAgentPluginAccessTokensFromEnv({ deps, env, log });
  expect(log.info.mock.calls).toEqual([["[agent-plugins] copied SYNC_TOKEN onto the 'sync' plugin's connection; it stays off because an operator turned it off (Connections). The env var is no longer needed."]]);
});

function cardFlow({ values = { token: '  issued-fixture  ' } as Record<string, unknown>, runStatus }: {
  values?: Record<string, unknown>; runStatus?: 'blank' | 'cancelled' | 'expired' | 'abandoned' | 'failed';
} = {}) {
  const { deps, rows } = fixture();
  const outputs: unknown[] = [];
  const forms: SurfaceCardSecretForm[] = [];
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = (required, cardOptions) => ({
    toolId: required.toolId,
    secretFieldNames: prep => required.form({ prep }).fields.filter(field => 'secret' in field && field.secret).map(field => field.name),
    handler: () => async (ctx, options = {}) => {
      if (!options.emitSurface) throw new Error('expected human transport');
      const prep = await required.prepare({ ctx });
      forms.push(required.form({ prep }));
      let run: SurfaceCardSecretRun<Awaited<ReturnType<typeof required.save>>>;
      if (runStatus === 'failed') run = { status: 'failed', safeMessage: cardOptions?.safeError?.(new Error('upstream details')) ?? 'Save failed.' };
      else if (runStatus !== undefined) run = { status: runStatus };
      else run = { status: 'saved', saved: await required.save({ values, prep, signal: ctx.signal }) };
      outputs.push(required.outcome({ prep, run }));
      return required.result({ prep, run });
    },
  });
  const probe = vi.fn<AgentPluginAccessTokenToolDeps['credentials']['probe']>(async () => 'ok');
  const find = vi.fn<AgentPluginAccessTokenToolDeps['credentials']['find']>(async () => ({
    providerId: 'sync', title: 'Sync token', baseUrl: endpoint, label: 'Sync', category: 'general', keyHint: 'Read access',
  }));
  const authorize = vi.fn<AgentPluginAccessTokenToolDeps['authorize']>(async () => ({ allowed: true, reason: 'fixture grant' }));
  const apply = vi.fn<AgentPluginAccessTokenToolDeps['credentials']['apply']>(({ form }) => form);
  const malformed = new Error('malformed');
  const routeDeps = {
    ...deps, authorize, credentials: { apply, find, probe }, preferences: { locale: async () => 'fr' },
    messages: {
      ...deps.messages, onlyPluginId: () => 'Only pluginId belongs in tool input.',
      pluginIdRequired: () => 'Choose a plugin id.', credentialText: ({ id, locale }) => `${locale}:${id}`,
      translateCredentialMessage: ({ message }) => message,
      savedTokenSwitch: ({ target, outcome }) => `${target.displayName} saved: ${outcome.state}.`,
    },
    tokenValidator: {
      assertToken: ({ value }) => { if (typeof value !== 'string' || value.trim() === '') throw malformed; },
      inputErrorRule: ({ error }) => error === malformed ? 'wrong-token' : null,
    },
    host: { toolId: 'studio_secret', permission: 'studio.credentials', entityType: 'plugin', cards: { defineSecretCardTool },
      cardIdentity: { uriNamespace: 'studio', appNames: { connect: 'connect', tokenForm: 'token', tokenOutcome: 'outcome' } },
      askThenReport: async () => { throw new Error('test drives the secret card’s human answer'); },
      formMessages: { description: ({ helpUrl }) => `Get a token at ${helpUrl}.` },
    },
  } satisfies AgentPluginAccessTokenToolDeps;
  const run = (input: unknown = { pluginId: 'sync' }) => {
    const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' }, input, signal: new AbortController().signal };
    return saveAgentPluginToken({ routeDeps, ctx, surfaces: { surfaceExchanges: { open: () => { throw new Error('unexpected extra card'); } } } }, { emitSurface: async () => {} });
  };
  return { deps, rows, authorize, forms, outputs, probe, find, apply, run };
}

it('rejects modeled token bytes and a missing plugin id before auth or any credential work', async () => {
  const f = cardFlow();
  await expect(f.run({ pluginId: 'sync', token: 'do not accept' })).rejects.toThrow('Only pluginId belongs in tool input.');
  await expect(f.run({ pluginId: '   ' })).rejects.toThrow('Choose a plugin id.');
  expect(f.authorize.mock.calls).toEqual([]);
  expect(f.deps.resolveInstalledPlugin.mock.calls).toEqual([]);
  expect(f.probe.mock.calls).toEqual([]);
});

it('a human-entered token is trimmed, probed and stored while the form and result keep it private', async () => {
  const f = cardFlow();
  expect(await f.run()).toEqual({ saved: true, next: 'Sync saved: on.' });
  expect(f.authorize.mock.calls).toEqual([[{ workspaceId: 'studio', principalId: 'owner', permission: 'studio.credentials', entityType: 'plugin', entityId: 'sync' }]]);
  expect(f.probe.mock.calls).toEqual([[{ token: 'issued-fixture', probeUrl: 'https://api.example.test/whoami' }]]);
  expect(f.find.mock.calls).toEqual([[{ workspaceId: 'studio', saveKind: 'agent-plugin-token', target: 'sync' }]]);
  expect(f.deps.mcp.saveServer.mock.calls.map(([input]) => [input.serverId, input.accessToken])).toEqual([['main', 'issued-fixture']]);
  expect(f.rows.get('main')).toMatchObject({ authMode: 'static_env', sealedOAuth: sealed });
  expect(f.forms[0]?.fields).toEqual([{ kind: 'string', name: 'token', label: 'Sync access token', hint: 'Pasted here only. Never shown to the assistant.', required: true, secret: true }]);
  expect(f.outputs).toEqual([{ title: 'Token saved', details: [{ label: 'Connection', value: 'Sync' }], state: 'success', message: 'Sync saved: on.', app: { appName: 'outcome', appVersion: '1' } }]);
});

it.each([
  ['refused', 'This token was refused for this purpose. This card needs: Read access'],
  ['unavailable', 'Sync is unavailable right now. Try again shortly.'],
] as const)('a %s probe never persists credentials and tells the user what happened', async (outcome, message) => {
  const f = cardFlow();
  f.probe.mockResolvedValue(outcome);
  expect(await f.run()).toEqual({ saved: false, reason: outcome, message });
  expect(f.deps.mcp.saveServer.mock.calls).toEqual([]);
  expect(f.deps.switchOnSavedToken.mock.calls).toEqual([]);
});

it('a validator refusal uses localized copy and never sends the invalid value', async () => {
  const f = cardFlow({ values: { token: 55 } });
  expect(await f.run()).toEqual({ saved: false, reason: 'invalid', message: 'fr:wrong-token' });
  expect(f.probe.mock.calls).toEqual([]);
});

it.each([
  ['blank', { reason: 'invalid', message: 'fr:blank' }],
  ['cancelled', { reason: 'cancelled' }],
  ['expired', { reason: 'expired' }],
  ['abandoned', { reason: 'abandoned' }],
  ['failed', { reason: 'error', message: 'The access token could not be saved. Nothing was changed.' }],
] as const)('maps the card’s %s outcome without probing or persisting', async (runStatus, expected) => {
  const f = cardFlow({ runStatus });
  expect(await f.run()).toEqual({ saved: false, ...expected });
  expect(f.probe.mock.calls).toEqual([]);
  expect(f.deps.mcp.saveServer.mock.calls).toEqual([]);
});
