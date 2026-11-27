import * as hostedMcp from "../../federation/hosted/index.js";
import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import type { SaveExternalMcpServerInput } from '@jini-ai/core/contracts/hosted-mcp';
import type { ExternalMcpServerRecord } from '@jini-ai/core/contracts/hosted-mcp';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { SurfaceCardsPort, SurfaceCardOutcome, SurfaceCardSecretForm, SurfaceCardSecretRun } from '@jini-ai/core/contracts/cards';
import { createExternalMcpAgentToolCatalog } from '../agent-tools.js';
import { buildExternalMcpRegistrations, type ExternalMcpToolDeps } from '../tool-registrations.js';
import { externalMcpAccessHandler, isExternalMcpAccessInput, requireKnownMcpSave, requireMcpSaveApprover } from '../access-review.js';

test('a changed connection after the card requires a new approval and performs no write', async () => {
  let record: ExternalMcpServerRecord = { workspaceId: 'ws', serverId: 'server', label: null, provisionedByPluginId: null,
    transport: 'streamable_http', authMode: 'none', enabled: true, command: null, url: 'https://example.com/mcp', args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
    aadVersion: 1, oauthAadVersion: 1, createdAt: 'stamp', updatedAt: 'stamp', version: 1 };
  let writes = 0;
  let reads = 0;
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = spec => ({ toolId: spec.toolId, secretFieldNames: () => [],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      record = { ...record, url: 'https://changed.example/mcp', version: 2 };
      await spec.save({ prep, values: { label: 'Reviewed' }, signal: ctx.signal });
      throw new Error('old approval reached the writer');
    },
  });
  const deps = { ...hostedMcp, workspaceId: 'ws', authorize: async () => ({ allowed: true }), clock: { nowMs: () => 0 },
    externalMcpServerRepo: { findByServerId: async () => { reads++; return record; } },
    catalog: createExternalMcpAgentToolCatalog({ copy: { settingsLocation: 'Settings', listToolName: 'external_mcp_list' } }),
    requireToolPermission: async () => {}, assertCredentialFreeField: () => {}, defineSecretCardTool,
    resolveOperatorLocale: async () => 'en', listExternalMcpServerViews: async () => [],
    secretCardOptions: {}, credentialText: ({ id }: { id: string }) => id,
    approvalToolHandler: () => async () => { throw new Error('unexpected access-only review'); },
    saveExternalMcpServer: async () => { writes++; throw new Error('unexpected save'); },
  } as unknown as ExternalMcpToolDeps;
  const surfaces = { assertAccessApprover: async () => {}, surfaceExchanges: {} };
  const tool = buildExternalMcpRegistrations(deps, surfaces as never).find(item => item.descriptor.id === 'external_mcp_save')!;
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' },
    input: { id: 'server', transport: 'streamable_http', url: 'https://example.com/mcp', authMode: 'none' }, signal: new AbortController().signal };
  await assert.rejects(tool.handler(ctx), /reviewed External MCP connection changed/);
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});

test('access review never falls back to a raw remote endpoint', async () => {
  const record = accessRecord();
  let captured: unknown;
  const approvalToolHandler: ExternalMcpToolDeps['approvalToolHandler'] = steps => async ctx => {
    const prepared = await steps.prepare({ ctx }, {});
    const description = await steps.describe({ ctx, prepared });
    captured = description.details.find(detail => detail.label === 'Source target')?.value;
    return {};
  };
  const routeDeps = { ...hostedMcp, accessErrorCode: 'EXTERNAL_MCP', workspaceId: 'ws', authorize: async () => ({ allowed: true }),
    externalMcpServerRepo: { findByServerId: async () => record }, requireToolPermission: async () => {}, approvalToolHandler,
  } as unknown as ExternalMcpToolDeps;
  const handler = externalMcpAccessHandler({ routeDeps, surfaces: { surfaceExchanges: {} as never } });
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' },
    input: { id: 'server', enabled: false }, signal: new AbortController().signal };
  await handler(ctx);
  assert.equal(captured, 'Remote endpoint unavailable.');
  record.url = 'https://remote.example:8443/tools?fixture=private';
  await handler(ctx);
  assert.equal(captured, 'https://remote.example:8443');
  record.transport = 'stdio';
  record.url = null;
  record.command = 'node';
  record.args = '["server.js","sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"]';
  await handler(ctx);
  assert.equal(captured, 'node ["server.js","[REDACTED:sk_key]"]');
});

function accessRecord(): ExternalMcpServerRecord {
  return { workspaceId: 'ws', serverId: 'server', label: 'Server', provisionedByPluginId: null,
    transport: 'streamable_http', authMode: 'none', enabled: true, command: null, url: 'malformed-private-endpoint', args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
    aadVersion: 1, oauthAadVersion: 1, createdAt: 'stamp', updatedAt: 'stamp', version: 1 };
}

const context = (input: unknown): ToolExecutionContext => ({
  executionId: 'exec', principal: { id: 'person' }, run: { id: 'run' }, input,
  signal: new AbortController().signal,
});
const makeSurfaces = (): Parameters<typeof buildExternalMcpRegistrations>[1] => ({ surfaceExchanges: {
  open: () => { throw new Error('unexpected card exchange'); },
  deliver: () => { throw new Error('unexpected card answer'); },
  findTypedAnswerTarget: () => undefined,
  size: () => 0,
} });

function registrationsFixture(record: ExternalMcpServerRecord | null, overrides: Partial<ExternalMcpToolDeps> = {}) {
  const findByServerId = vi.fn<ExternalMcpToolDeps['externalMcpServerRepo']['findByServerId']>().mockResolvedValue(record);
  const requireToolPermission = vi.fn<ExternalMcpToolDeps['requireToolPermission']>().mockResolvedValue(undefined);
  const routeDeps = {
    ...hostedMcp, workspaceId: 'ws', clock: { nowMs: () => 0 }, authorize: async () => ({ allowed: true }),
    externalMcpServerRepo: { findByServerId }, requireToolPermission,
    catalog: createExternalMcpAgentToolCatalog({ copy: { settingsLocation: 'Settings', listToolName: 'external_mcp_list' } }),
    approvalToolHandler: () => async () => { throw new Error('unexpected approval call'); },
    unverifiedAccessMessage: ({ serverId }: { serverId: string }) => `Discover tools for ${serverId} first.`,
    unverifiedConnectionMessage: 'Save the connection then discover its tools.',
    ...overrides,
  } as unknown as ExternalMcpToolDeps;
  const invoke = (id: string, input: unknown, surfaces = makeSurfaces(), ctx = context(input)) => buildExternalMcpRegistrations(routeDeps, surfaces)
    .find(item => item.descriptor.id === id)!.handler(ctx);
  return { findByServerId, requireToolPermission, routeDeps, invoke };
}

test.each([
  ['an enable decision', { id: 'server', enabled: false }, true],
  ['an explicit clear', { id: 'server', writeAllowedToolNames: '' }, true],
  ['identity only', { id: 'server', transport: 'stdio' }, false],
  ['an address edit with grants', { id: 'server', url: 'https://docs.example/mcp', allowedToolNames: 'read' }, false],
] as const)('routes %s to the appropriate review flow', (_name, input, accessOnly) => {
  expect(isExternalMcpAccessInput(input)).toBe(accessOnly);
});

test('a configuration card without a human identity check cannot proceed even after management authorization', async () => {
  const { routeDeps, requireToolPermission } = registrationsFixture(null);
  const input = { routeDeps, surfaces: makeSurfaces(), principalId: 'person', id: 'server' };
  await expect(requireMcpSaveApprover(input)).rejects.toThrow(new ToolInputError({
    message: 'This chat cannot verify the person approving the connection. Reopen the chat in your signed-in admin session. Nothing was saved.',
  }));
  const assertAccessApprover = vi.fn().mockResolvedValue(undefined);
  await requireMcpSaveApprover({ ...input, surfaces: { ...input.surfaces, assertAccessApprover } });
  expect(assertAccessApprover.mock.calls).toStrictEqual([[{ toolId: 'external_mcp_save', principalId: 'person' }]]);
  expect(requireToolPermission.mock.calls.map(([identity, entity]) => [
    identity.workspaceId, identity.principalId, identity.permission, entity,
  ])).toStrictEqual([
    ['ws', 'person', 'admin.integrations.manage', { entityType: 'external-mcp-server', entityId: 'server' }],
    ['ws', 'person', 'admin.integrations.manage', { entityType: 'external-mcp-server', entityId: 'server' }],
  ]);
});

const httpSave: SaveExternalMcpServerInput = { workspaceId: 'ws', serverId: 'server', principalId: 'person', enabled: true,
  transport: 'streamable_http', url: 'https://docs.example/mcp', command: '', args: '', allowedToolNames: 'read', writeAllowedToolNames: '' };

test('a new connection may be saved without grants, but cannot carry unverified grants', () => {
  const { routeDeps } = registrationsFixture(null);
  expect(() => requireKnownMcpSave({ routeDeps, record: null, input: httpSave })).toThrow(
    new hostedMcp.ExternalMcpValidationError('Save the connection then discover its tools.', 'allowedToolNames'));
  expect(requireKnownMcpSave({ routeDeps, record: null, input: { ...httpSave, allowedToolNames: '' } })).toBeUndefined();
});

test.each([
  { kind: 'address', row: { url: 'https://docs.example/mcp' }, edit: { url: 'https://new-docs.example/mcp' },
    message: 'The connection address in this form differs from the saved one' },
  { kind: 'arguments', row: { transport: 'stdio', url: null, command: 'node', args: '["docs.mjs"]' },
    edit: { transport: 'stdio', command: 'node', args: 'different.mjs' }, message: 'The command or arguments in this form differ from the saved ones' },
])('changing the $kind cannot carry grants verified against the old source', ({ row, edit, message }) => {
  const record = { ...accessRecord(), allowedToolNames: '["read"]', ...row };
  const oldRevision = hostedMcp.externalMcpAccessSnapshot({ record }).admissionRevision;
  const knownTools = vi.fn<NonNullable<ExternalMcpToolDeps['externalMcpKnownToolNames']>>()
    .mockImplementation(({ admissionRevision }) => admissionRevision === oldRevision ? ['read'] : null);
  const { routeDeps } = registrationsFixture(record, { externalMcpKnownToolNames: knownTools });
  const unchanged = record.transport === 'stdio'
    ? { ...httpSave, transport: 'stdio', command: 'node', args: 'docs.mjs' }
    : { ...httpSave, url: '  https://docs.example/mcp  ' };
  requireKnownMcpSave({ routeDeps, record, input: unchanged });
  expect(knownTools.mock.calls).toEqual([]);
  expect(() => requireKnownMcpSave({ routeDeps, record, input: { ...unchanged, ...edit } })).toThrow(message);
  expect(knownTools.mock.calls).toEqual([[{ serverId: 'server', admissionRevision: expect.not.stringMatching(oldRevision) }]]);
});

test.each([
  { input: { id: ' Server ', transport: 'stdio', enabled: false }, message: "The 'server' connection uses a different transport. Request its current configuration before changing access. Nothing was changed." },
  { input: { id: ' Server ', enabled: 'false' }, message: "'enabled' must be true or false. Nothing was changed." },
  { input: { id: ' Server ', allowedToolNames: 'read', writeAllowedToolNames: 'edit' }, message: 'Every tool allowed to write must also appear in allowedToolNames. Nothing was changed.' },
  { input: { id: ' Server ', enabled: true }, message: 'Discover tools for server first.' },
])('refuses invalid access before creating a card: $message', async ({ input, message }) => {
  const record = { ...accessRecord(), enabled: false, allowedToolNames: '["read"]' };
  const approvalToolHandler: ExternalMcpToolDeps['approvalToolHandler'] = steps => async ctx => {
    await steps.prepare({ ctx }, {});
    throw new Error('invalid access made it past preparation');
  };
  const f = registrationsFixture(record, { approvalToolHandler });
  await expect(f.invoke('external_mcp_save', input)).rejects.toThrow(new ToolInputError({ message }));
  expect(f.findByServerId.mock.calls).toEqual([[{ workspaceId: 'ws', serverId: 'server' }]]);
});

test.each([
  { row: null, expected: { ok: false, reason: "no external MCP server is configured as 'server'" } },
  { row: { ...accessRecord(), enabled: false }, expected: { ok: false, reason: 'this server is disabled' } },
])('a missing or disabled connection never reaches the configuration resolver: $expected.reason', async ({ row, expected }) => {
  const readEnabledExternalMcpConfigs = vi.fn<ExternalMcpToolDeps['readEnabledExternalMcpConfigs']>();
  const f = registrationsFixture(row, { readEnabledExternalMcpConfigs });
  expect(await f.invoke('external_mcp_test_connection', { id: 'server' })).toStrictEqual(expected);
  expect(readEnabledExternalMcpConfigs.mock.calls).toEqual([]);
});

test('configuration check reports only the requested server readiness', async () => {
  const readEnabledExternalMcpConfigs = vi.fn<ExternalMcpToolDeps['readEnabledExternalMcpConfigs']>()
    .mockResolvedValueOnce({ configs: [{ serverId: 'other' }], failures: [{ serverId: 'server', reason: 'Reconnect OAuth' }] })
    .mockResolvedValueOnce({ configs: [], failures: [{ serverId: 'other', reason: 'Wrong server' }] })
    .mockResolvedValueOnce({ configs: [{ serverId: 'server' }], failures: [] });
  const f = registrationsFixture(accessRecord(), { readEnabledExternalMcpConfigs });
  const check = () => f.invoke('external_mcp_test_connection', { id: 'server' });
  expect(await check()).toStrictEqual({ ok: false, reason: 'Reconnect OAuth' });
  expect(await check()).toStrictEqual({ ok: false, reason: "this server's connection could not be resolved" });
  expect(await check()).toStrictEqual({ ok: true });
});

test('OAuth start uses the route-provided callback and invalid configuration is actionable', async () => {
  type OAuth = NonNullable<ExternalMcpToolDeps['externalMcpOAuth']>;
  const beginConnect = vi.fn<OAuth['beginConnect']>()
    .mockRejectedValueOnce(new hostedMcp.ExternalMcpValidationError('Set a public callback origin', 'id'));
  const providerError = new Error('provider unavailable');
  beginConnect.mockRejectedValueOnce(providerError);
  const resolveExternalMcpOAuthRedirectUri = vi.fn<ExternalMcpToolDeps['resolveExternalMcpOAuthRedirectUri']>()
    .mockReturnValueOnce('https://console.example/callback').mockReturnValueOnce(undefined);
  const externalMcpOAuth: OAuth = { beginConnect, pollDeviceAuthorization: vi.fn(),
    completeAuthorizationCallback: vi.fn(), disconnect: vi.fn(), reportAuthFailure: vi.fn(),
    tokenResolver: { resolveAccessToken: vi.fn() } };
  const f = registrationsFixture(accessRecord(), { externalMcpOAuth, resolveExternalMcpOAuthRedirectUri,
    derivedPublicOrigin: 'https://console.example' });
  const connect = () => f.invoke('external_mcp_oauth_connect', { id: 'server' });
  await expect(connect()).rejects.toThrow(new ToolInputError({ message: 'Set a public callback origin' }));
  await expect(connect()).rejects.toBe(providerError);
  expect(resolveExternalMcpOAuthRedirectUri.mock.calls).toStrictEqual(Array.from({ length: 2 }, () =>
    [{ serverId: 'server', derivedPublicOrigin: 'https://console.example' }]));
  expect(beginConnect.mock.calls).toStrictEqual([
    [{ serverId: 'server', actorId: 'person', redirectUri: 'https://console.example/callback', delivery: 'hosted' }],
    [{ serverId: 'server', actorId: 'person', delivery: 'hosted' }],
  ]);
});

test('only successful device authorization notifies the roster', async () => {
  type OAuth = NonNullable<ExternalMcpToolDeps['externalMcpOAuth']>;
  const pollDeviceAuthorization = vi.fn<OAuth['pollDeviceAuthorization']>()
    .mockResolvedValueOnce({ status: 'pending', retryAfterSeconds: 9 }).mockResolvedValueOnce({ status: 'connected' });
  const notifyExternalMcpRosterChanged = vi.fn<ExternalMcpToolDeps['notifyExternalMcpRosterChanged']>().mockResolvedValue(undefined);
  const externalMcpOAuth: OAuth = { beginConnect: vi.fn(), pollDeviceAuthorization, completeAuthorizationCallback: vi.fn(),
    disconnect: vi.fn(), reportAuthFailure: vi.fn(), tokenResolver: { resolveAccessToken: vi.fn() } };
  const f = registrationsFixture(accessRecord(), { externalMcpOAuth, notifyExternalMcpRosterChanged });
  const poll = () => f.invoke('external_mcp_oauth_poll_device', { id: 'server' });
  expect(await poll()).toStrictEqual({ status: 'pending', retryAfterSeconds: 9 });
  expect(notifyExternalMcpRosterChanged.mock.calls).toEqual([]);
  expect(await poll()).toStrictEqual({ status: 'connected' });
  expect(notifyExternalMcpRosterChanged.mock.calls).toEqual([[]]);
  expect(pollDeviceAuthorization.mock.calls).toStrictEqual([[{ serverId: 'server' }], [{ serverId: 'server' }]]);
});

test.each([
  { decision: 'add a write grant', input: { writeAllowedToolNames: 'edit' },
    allowed: ['read', 'edit'], write: ['edit'], enabled: true, lower: false },
  { decision: 'disable', input: { enabled: false },
    allowed: ['read', 'edit'], write: [], enabled: false, lower: true },
  { decision: 'remove an allowed tool', input: { allowedToolNames: 'read' },
    allowed: ['read'], write: [], enabled: true, lower: true },
])('approved access changes can $decision without rewriting the connection', async ({ input, allowed, write, enabled, lower }) => {
  const record = { ...accessRecord(), label: null, url: 'https://docs.example/private?key=hidden', allowedToolNames: '["read","edit"]' };
  const snapshot = hostedMcp.externalMcpAccessSnapshot({ record });
  const applyExternalMcpAccess = vi.fn<ExternalMcpToolDeps['applyExternalMcpAccess']>().mockResolvedValue(undefined);
  const notifyExternalMcpRosterChanged = vi.fn<ExternalMcpToolDeps['notifyExternalMcpRosterChanged']>().mockResolvedValue(undefined);
  const knownNames = vi.fn<NonNullable<ExternalMcpToolDeps['externalMcpKnownToolNames']>>().mockReturnValue(['read', 'edit']);
  const proposed = { enabled, allowedToolNames: allowed, writeAllowedToolNames: write };
  const approvalToolHandler: ExternalMcpToolDeps['approvalToolHandler'] = (steps, options) => async ctx => {
    expect(options).toEqual({ flag: 'saved' });
    const prepared = await steps.prepare({ ctx }, {});
    const preview = await steps.describe({ ctx, prepared });
    expect(preview.details).toStrictEqual([{ label: 'Source target', value: 'https://docs.example' }]);
    expect(preview.access).toStrictEqual({ resources: [{ id: 'server', label: 'server', scope: { personId: 'person', siteId: 'ws' },
      revision: snapshot.admissionRevision, previous: { enabled: true, allowedToolNames: ['read', 'edit'], writeAllowedToolNames: [] }, proposed }] });
    expect(applyExternalMcpAccess).not.toHaveBeenCalled();
    return steps.run({ ctx, prepared, confirmer: { id: 'person', kind: 'user' } }, {});
  };
  const f = registrationsFixture(record, { approvalToolHandler, applyExternalMcpAccess, notifyExternalMcpRosterChanged,
    externalMcpKnownToolNames: knownNames });
  expect(await f.invoke('external_mcp_save', { id: ' SERVER ', ...input })).toStrictEqual({ saved: true, server: { serverId: 'server', ...proposed } });
  expect(applyExternalMcpAccess).toHaveBeenCalledExactlyOnceWith({ repo: f.routeDeps.externalMcpServerRepo, clock: f.routeDeps.clock,
    workspaceId: 'ws', serverId: 'server', expected: snapshot, access: proposed, principalId: 'person' });
  expect(notifyExternalMcpRosterChanged.mock.calls).toEqual(lower ? [[{ lowered: { serverIds: ['server'] } }]] : [[]]);
  expect(f.requireToolPermission.mock.calls.map(([auth, entity]) => [auth.principalId, auth.permission, entity]))
    .toEqual(Array.from({ length: 2 }, () => ['person', 'admin.integrations.manage', { entityType: 'external-mcp-server', entityId: 'server' }]));
  expect(knownNames.mock.calls).toEqual(lower ? [] : [[{ serverId: 'server', admissionRevision: snapshot.admissionRevision }]]);
});

test('access review refuses a missing row before preparing or applying a card', async () => {
  const approvalToolHandler: ExternalMcpToolDeps['approvalToolHandler'] = steps => async ctx => {
    const prepared = await steps.prepare({ ctx }, {});
    throw new Error(`missing row reached card preparation: ${JSON.stringify(prepared)}`);
  };
  const f = registrationsFixture(null, { approvalToolHandler });
  await expect(f.invoke('external_mcp_save', { id: ' Removed ', enabled: false })).rejects.toThrow(new ToolInputError({
    message: "The 'removed' connection no longer exists. Request its connection setup before changing access. Nothing was changed.",
  }));
  expect(f.findByServerId).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', serverId: 'removed' });
});

function submittedConfiguration(choice: { status: 'submitted'; values: Readonly<Record<string, unknown>> } |
  { status: 'blank' | 'cancelled' | 'expired' | 'abandoned' }) {
  const rendered = vi.fn<(form: SurfaceCardSecretForm) => void>();
  const outcome = vi.fn<(card: SurfaceCardOutcome | undefined) => void>();
  const defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'] = (spec, options) => ({
    toolId: spec.toolId, secretFieldNames: () => [],
    handler: () => async ctx => {
      const prep = await spec.prepare({ ctx });
      rendered(spec.form({ prep }));
      const run = choice.status === 'submitted'
        ? await spec.save({ prep, values: choice.values, signal: ctx.signal }).then(
          saved => ({ status: 'saved' as const, saved }),
          error => ({ status: 'failed' as const, safeMessage: options?.safeError?.(error) ?? 'Unexpected save error' }),
        )
        : { status: choice.status } satisfies SurfaceCardSecretRun<never>;
      outcome(spec.outcome({ prep, run }));
      return spec.result({ prep, run });
    },
  });
  return { defineSecretCardTool, rendered, outcome };
}

function configurationFixture(choice: Parameters<typeof submittedConfiguration>[0], overrides: Partial<ExternalMcpToolDeps> = {}) {
  const card = submittedConfiguration(choice);
  const assertAccessApprover = vi.fn<NonNullable<Parameters<typeof buildExternalMcpRegistrations>[1]['assertAccessApprover']>>()
    .mockResolvedValue(undefined);
  const surfaces = { ...makeSurfaces(), assertAccessApprover };
  const f = registrationsFixture(null, { ...card, appName: 'Acme', assertCredentialFreeField: () => {},
    secretCardOptions: {}, resolveOperatorLocale: async () => 'fr', listExternalMcpServerViews: async () => [],
    credentialText: ({ id, locale }) => `${locale}:${id}`,
    formatCredentialHint: () => '', formatCredentialHints: () => '',
    translateCredentialMessage: ({ message, locale }) => `${locale}:${message}`,
    ForbiddenError: class Denied extends Error {},
    ...overrides });
  const save = (patch: Record<string, unknown> = {}) =>
    f.invoke('external_mcp_save', { id: 'server', transport: 'streamable_http', authMode: 'none', ...patch }, surfaces);
  return { ...f, ...card, assertAccessApprover, save };
}

test.each([
  { mode: 'connected', report: { ok: true, body: { tools: [] } } as const, connection: 'connected', copy: 'connected', title: 'connected' },
  { mode: 'auth', report: { ok: false, body: { code: 'MCP_AUTH_REJECTED' } } as const, connection: 'MCP_AUTH_REJECTED', copy: 'auth', title: 'savedTitle' },
  { mode: 'timeout', report: { ok: false, body: { code: 'MCP_TIMEOUT' } } as const, connection: 'MCP_TIMEOUT', copy: 'timeout', title: 'savedTitle' },
  { mode: 'unreachable', report: { ok: false, body: {} } as const, connection: 'MCP_SERVER_UNREACHABLE', copy: 'unreachable', title: 'savedTitle' },
  { mode: 'throw', report: null, connection: 'MCP_SERVER_UNREACHABLE', copy: 'unreachable', title: 'savedTitle' },
])('a durable configuration save preserves its success when the post-save probe is $mode', async ({ report, connection, copy, title }) => {
  const saveExternalMcpServer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>();
  const server: Awaited<ReturnType<typeof saveExternalMcpServer>> = { serverId: 'server', label: 'Server', provisionedByPluginId: null,
    transport: 'streamable_http', authMode: 'none', enabled: true, command: '', url: 'https://docs.example/mcp', args: [],
    allowedToolNames: [], writeAllowedToolNames: [], writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: ['EXAMPLE'],
    hasAccessToken: false, envTokenHints: { EXAMPLE: { last4: '5432', length: 16 } }, accessTokenEnvName: null,
    oauth: { providerId: null, grant: null, clientId: null, scopes: [], status: 'disconnected', expiresAt: null, tokenEnvName: null, hasStoredToken: false },
    version: 1 };
  saveExternalMcpServer.mockResolvedValue(server);
  const externalMcpProbe = vi.fn<NonNullable<ExternalMcpToolDeps['externalMcpProbe']>>()
    .mockImplementation(async () => {
      if (!report) throw new Error('private provider detail');
      return report;
    });
  const notifyExternalMcpRosterChanged = vi.fn<ExternalMcpToolDeps['notifyExternalMcpRosterChanged']>().mockResolvedValue(undefined);
  const f = configurationFixture({ status: 'submitted', values: {
    label: 'Reviewed', url: 'https://docs.example/mcp', enabled: false, transport: 'stdio', allowedToolNames: 'not-reviewed',
  } }, { saveExternalMcpServer, externalMcpProbe, notifyExternalMcpRosterChanged, formatCredentialHints: ({ locale }) => `${locale}:one stored credential` });
  expect(await f.save()).toStrictEqual({ saved: true, server, connection, message: `fr:one stored credential. fr:${copy}` });
  expect(f.rendered.mock.calls[0]?.[0].fields.map(field => field.name)).toEqual(expect.arrayContaining(['label', 'url']));
  expect(f.assertAccessApprover.mock.calls).toStrictEqual(Array.from({ length: 2 }, () => [{ toolId: 'external_mcp_save', principalId: 'person' }]));
  expect(saveExternalMcpServer).toHaveBeenCalledExactlyOnceWith({
    repo: f.routeDeps.externalMcpServerRepo, sealer: f.routeDeps.siteAssistantSecretSealer, keyring: f.routeDeps.siteAssistantSecretKeyring, clock: f.routeDeps.clock,
  }, { serverId: 'server', workspaceId: 'ws', principalId: 'person', transport: 'streamable_http', authMode: 'none',
    label: 'Reviewed', url: 'https://docs.example/mcp', enabled: true, command: '', args: '', allowedToolNames: '', writeAllowedToolNames: '' });
  expect(externalMcpProbe).toHaveBeenCalledExactlyOnceWith({ serverId: 'server' });
  expect(notifyExternalMcpRosterChanged).toHaveBeenCalledExactlyOnceWith();
  expect(f.outcome).toHaveBeenCalledExactlyOnceWith({ state: 'success', title: `fr:${title}`, message: `fr:one stored credential. fr:${copy}` });
});

test('the submitted configuration cannot change its bound ID and the outcome identifies the invalid field', async () => {
  const writer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>();
  const f = configurationFixture({ status: 'submitted', values: { id: 'other', url: 'https://docs.example/mcp' } },
    { saveExternalMcpServer: writer });
  const message = 'fr:The server ID must match the connection form. Nothing was saved.';
  expect(await f.save()).toStrictEqual({ saved: false, cancelled: false, reason: 'invalid', field: 'id', message });
  expect(f.outcome).toHaveBeenCalledExactlyOnceWith({ state: 'failure', title: 'fr:unreachable', message });
  expect(writer).not.toHaveBeenCalled();
});

test.each([
  { status: 'blank', result: { saved: false, cancelled: false, reason: 'invalid', message: 'fr:blank' },
    outcome: { state: 'failure', title: 'fr:unreachable', message: 'fr:blank' } },
  { status: 'cancelled', result: { saved: false, cancelled: true }, outcome: undefined },
  { status: 'expired', result: { saved: false, cancelled: false, reason: 'expired',
    note: 'The user did not respond to the connection form before it expired. Nothing was saved.' }, outcome: undefined },
  { status: 'abandoned', result: { saved: false, cancelled: false, reason: 'abandoned',
    note: 'The connection form was closed because the run ended. Nothing was saved.' }, outcome: undefined },
] as const)('a $status configuration card never persists or reports success', async ({ status, result, outcome }) => {
  const writer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>();
  const f = configurationFixture({ status }, { saveExternalMcpServer: writer });
  expect(await f.save()).toStrictEqual(result);
  expect(f.outcome).toHaveBeenCalledExactlyOnceWith(outcome);
  expect(writer).not.toHaveBeenCalled();
});

test('a configuration writer failure exposes fixed storage copy, not the underlying error', async () => {
  const writer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>().mockRejectedValue(new Error('private keystore detail'));
  const f = configurationFixture({ status: 'submitted', values: { url: 'https://docs.example/mcp' } }, { saveExternalMcpServer: writer });
  expect(await f.save()).toStrictEqual({ saved: false, cancelled: false, reason: 'error', message: 'fr:storage' });
  expect(f.outcome).toHaveBeenCalledExactlyOnceWith({ state: 'failure', title: 'fr:unreachable', message: 'fr:storage' });
  expect(writer).toHaveBeenCalledTimes(1);
});

test('listing external MCP connections requires management of the workspace before returning the views', async () => {
  const saved = { serverId: 'server', label: 'Saved display name' } as Awaited<ReturnType<ExternalMcpToolDeps['listExternalMcpServerViews']>>[number];
  const listExternalMcpServerViews = vi.fn<ExternalMcpToolDeps['listExternalMcpServerViews']>().mockResolvedValue([saved]);
  const f = registrationsFixture(null, { listExternalMcpServerViews });
  expect(await f.invoke('external_mcp_list', {})).toStrictEqual({ servers: [saved] });
  expect(listExternalMcpServerViews).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws',
    deps: { repo: f.routeDeps.externalMcpServerRepo, sealer: f.routeDeps.siteAssistantSecretSealer } });
  expect(f.requireToolPermission.mock.calls.map(([auth, target]) => [auth.workspaceId, auth.principalId, auth.permission, target]))
    .toStrictEqual([['ws', 'person', 'admin.integrations.manage', { entityType: 'external-mcp-server' }]]);
});

test('OAuth operations report which service is unavailable rather than starting an authorization', async () => {
  const f = registrationsFixture(null, { oauthUnavailableMessage: ({ serverId }) => `OAuth unavailable for ${serverId}` });
  await expect(f.invoke('external_mcp_oauth_connect', { id: 'server' })).rejects.toThrow(new Error('OAuth unavailable for server'));
  await expect(f.invoke('external_mcp_oauth_poll_device', { id: 'server' })).rejects.toThrow(new Error(
    'external_mcp_oauth_poll_device: this execution context has no OAuth service wired, so this device authorization cannot be polled here.',
  ));
});

test('an aborted approved access change does not reach the writer or roster', async () => {
  const controller = new AbortController();
  const stop = new Error('operator closed the chat');
  const applyExternalMcpAccess = vi.fn<ExternalMcpToolDeps['applyExternalMcpAccess']>();
  const notifyExternalMcpRosterChanged = vi.fn<ExternalMcpToolDeps['notifyExternalMcpRosterChanged']>();
  const approvalToolHandler: ExternalMcpToolDeps['approvalToolHandler'] = steps => async ctx => {
    const prepared = await steps.prepare({ ctx }, {});
    controller.abort(stop);
    return steps.run({ ctx, prepared, confirmer: { id: 'person', kind: 'user' } }, {});
  };
  const f = registrationsFixture(accessRecord(), { approvalToolHandler, applyExternalMcpAccess, notifyExternalMcpRosterChanged });
  const input = { id: 'server', enabled: false };
  await expect(f.invoke('external_mcp_save', input, makeSurfaces(), { ...context(input), signal: controller.signal })).rejects.toBe(stop);
  expect(applyExternalMcpAccess).not.toHaveBeenCalled();
  expect(notifyExternalMcpRosterChanged).not.toHaveBeenCalled();
});

test('a disabled connection save requests immediate roster withdrawal', async () => {
  const writer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>();
  const server = { serverId: 'server', transport: 'streamable_http', enabled: false } as Awaited<ReturnType<typeof writer>>;
  writer.mockResolvedValue(server);
  const notifyExternalMcpRosterChanged = vi.fn<ExternalMcpToolDeps['notifyExternalMcpRosterChanged']>().mockResolvedValue(undefined);
  const f = configurationFixture({ status: 'submitted', values: { url: 'https://docs.example/mcp' } },
    { saveExternalMcpServer: writer, notifyExternalMcpRosterChanged });
  const result = await f.save({ enabled: false });
  expect(result).toStrictEqual({ saved: true, server, connection: 'not_tested', message: 'fr:saved' });
  expect(writer.mock.calls.map(([, input]) => input.enabled)).toEqual([false]);
  expect(notifyExternalMcpRosterChanged).toHaveBeenCalledExactlyOnceWith({ lowered: { serverIds: ['server'] } });
});

test('a management denial during submission overrides an already rendered card', async () => {
  class Denied extends Error {}
  const writer = vi.fn<ExternalMcpToolDeps['saveExternalMcpServer']>();
  const requireToolPermission = vi.fn<ExternalMcpToolDeps['requireToolPermission']>()
    .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Denied('private authority detail'));
  const f = configurationFixture({ status: 'submitted', values: { url: 'https://docs.example/mcp' } }, {
    ForbiddenError: Denied, requireToolPermission, saveExternalMcpServer: writer,
  });
  const message = 'Your permission to save this connection changed. Reopen the chat in your signed-in admin session. Nothing was saved.';
  expect(await f.save()).toEqual({ saved: false, cancelled: false, reason: 'error', message });
  expect(f.rendered).toHaveBeenCalledTimes(1);
  expect(requireToolPermission).toHaveBeenCalledTimes(2);
  expect(writer).not.toHaveBeenCalled();
});
