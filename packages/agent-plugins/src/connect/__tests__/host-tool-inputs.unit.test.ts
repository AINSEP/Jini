import { expect, it, vi } from 'vitest';
import type { ToolExecutionContext, ToolHandler } from '@jini-ai/core';
import { createProviderStatusTools, type ProviderStatusRow } from '../../lifecycle/host-tools/provider-status-tool.js';
import { createCredentialSaveTools, type CredentialSaveAdapters } from '../credential-save-tool.js';

const context = (input: unknown): ToolExecutionContext => ({ executionId: 'exec', principal: { id: 'operator' }, run: { id: 'run' }, signal: new AbortController().signal, input });
const statusInputs = {
  metadata: {}, authorization: { permission: 'studio.providers.read' }, catalogModule: 'studio/providers.ts',
  messages: {
    description: 'Read studio provider presence. Open studio_settings when asked.',
    pluginIdDescription: 'A studio provider id from studio_plugins.',
    unknownPlugin: ({ pluginId }: { pluginId: unknown }) => `Unknown studio provider ${String(pluginId)}; call studio_plugins.`,
    unexpectedInput: 'Studio provider status accepts only pluginId.',
  },
};
const unused: ToolHandler = async () => { throw new Error('Unexpected credential domain'); };
const adapters: CredentialSaveAdapters = { apiCreate: unused, apiRotate: unused, mediaProvider: unused, sourceControl: unused, publishHost: unused, agentPluginToken: unused, pluginProvider: unused };
const saveInputs = { metadata: {}, toolId: 'studio_secret', categories: ['general'], catalogModule: 'studio/secrets.ts',
  messages: { description: 'Save a studio secret in the human card.', oauthRefusal: 'Use studio_connect for browser sign-in.' } };

it('F2 second host owns provider description, schema, settings-card tool and filter refusals', async () => {
  const tools = createProviderStatusTools(statusInputs);
  const catalog = tools.providerStatusAgentToolCatalog[0]!;
  expect(catalog.description).toBe(statusInputs.messages.description);
  expect(JSON.stringify(catalog.inputSchema)).toContain(statusInputs.messages.pluginIdDescription);
  const row: ProviderStatusRow = { pluginId: 'metrics', settingsCard: { tool: 'studio_secret', input: { kind: 'provider-settings', target: 'metrics' } },
    enabled: true, configured: false, missing: ['Key'], store: 'project', appliesAt: 'now', usedByThisSite: false, usedBy: [] };
  const calls: string[] = [];
  const registration = tools.buildProviderStatusRegistrations({ ports: { authorize: async () => { calls.push('authorize'); }, list: async () => { calls.push('list'); return [row]; } } })[0]!;
  expect(await registration.handler(context({ pluginId: 'metrics' }), {})).toEqual({ providers: [row] });
  expect(calls).toEqual(['authorize', 'list']);
  await expect(registration.handler(context({ pluginId: 'missing' }), {})).rejects.toThrow('Unknown studio provider missing; call studio_plugins.');
  await expect(registration.handler(context({ value: 'forbidden' }), {})).rejects.toThrow(statusInputs.messages.unexpectedInput);
});

it('F2 second host provider catalog provenance reaches registration errors', () => {
  const tools = createProviderStatusTools(statusInputs); tools.providerStatusAgentToolCatalog.length = 0;
  expect(() => tools.buildProviderStatusRegistrations({ ports: { authorize: async () => {}, list: async () => [] } })).toThrow('studio/providers.ts');
});

it('F2 extra-key refusal names the supplied credential tool id', async () => {
  const tools = createCredentialSaveTools(saveInputs);
  expect(tools.credentialSaveCatalog[0]?.name).toBe('studio_secret');
  const registration = tools.buildCredentialSaveRegistrations({ adapters })[0]!;
  await expect(registration.handler(context({ kind: 'api', token: 'not-model-input' }), {})).rejects.toThrow('studio_secret accepts only non-secret metadata for the selected kind; enter secrets in the human form.');
});

it('F2 OAuth plugin cards use the second host navigation refusal after authorization', async () => {
  const tools = createCredentialSaveTools(saveInputs); const calls: string[] = [];
  const registration = tools.buildCredentialSaveRegistrations({ adapters,
    authorizePluginProvider: async () => { calls.push('authorize'); },
    loadPluginCredentialCards: async () => { calls.push('load'); return [{ providerId: 'relay', label: 'Relay', category: 'general', baseUrl: 'https://relay.test', title: 'Relay', saveKind: 'oauth' }]; },
  })[0]!;
  await expect(registration.handler(context({ kind: 'plugin-provider', target: 'relay' }), {})).rejects.toThrow(saveInputs.messages.oauthRefusal);
  expect(calls).toEqual(['authorize', 'load']);
});

it('F2 second host credential catalog provenance reaches registration errors', () => {
  const tools = createCredentialSaveTools(saveInputs); tools.credentialSaveCatalog.length = 0;
  expect(() => tools.buildCredentialSaveRegistrations({ adapters })).toThrow('studio/secrets.ts');
});

function saveFixture() {
  const owners = {
    apiCreate: vi.fn<ToolHandler>(async ctx => ({ owner: 'api-new', input: ctx.input })),
    apiRotate: vi.fn<ToolHandler>(async ctx => ({ owner: 'api-rotate', input: ctx.input })),
    publishHost: vi.fn<ToolHandler>(async ctx => ({ owner: 'publish', input: ctx.input })),
    sourceControl: vi.fn<ToolHandler>(async ctx => ({ owner: 'source', input: ctx.input })),
    mediaProvider: vi.fn<ToolHandler>(async ctx => ({ owner: 'media', input: ctx.input })),
    agentPluginToken: vi.fn<ToolHandler>(async ctx => ({ owner: 'token', input: ctx.input })),
    providerSettings: vi.fn<ToolHandler>(async ctx => ({ owner: 'settings', input: ctx.input })),
    pluginProvider: vi.fn<ToolHandler>(async ctx => ({ owner: 'plugin', input: ctx.input })),
  };
  return { owners, build: createCredentialSaveTools(saveInputs).buildCredentialSaveRegistrations };
}

it.each([
  [{ kind: 'api', label: 'new' }, 'api-new', { label: 'new' }],
  [{ kind: 'api', target: 'old' }, 'api-rotate', { label: 'old' }],
  [{ kind: 'publish-host', target: 'cloud', prefill: { account: 'north' } }, 'publish', { target: 'cloud', account: 'north' }],
  [{ kind: 'publish-host', target: 'cloud' }, 'publish', { target: 'cloud' }],
  [{ kind: 'source-control', target: 'git' }, 'source', { provider: 'git' }],
  [{ kind: 'media-provider', target: 'images' }, 'media', { provider: 'images' }],
  [{ kind: 'agent-plugin-token', target: 'sync' }, 'token', { pluginId: 'sync' }],
  [{ kind: 'provider-settings', target: 'sync' }, 'settings', { pluginId: 'sync' }],
] as const)('routes %j to the owning handler and attaches the saved result', async (input, owner, forwarded) => {
  const { owners, build } = saveFixture();
  const savedResult = vi.fn(async ({ result }: { result: unknown }) => ({ attached: result }));
  const registration = build({ adapters: owners, savedResult })[0]!;
  expect(await registration.handler(context(input))).toEqual({ attached: { owner, input: forwarded } });
  expect(savedResult.mock.calls).toEqual([[{ result: { owner, input: forwarded } }]]);
});

it.each([
  [{ kind: 'no-such-kind' }, 'Unknown credential kind.'],
  [{ kind: 'agent-plugin-token', target: 'allowed', pluginId: 'override' }, 'Use target for the installed plugin id.'],
  [{ kind: 'source-control', target: 'allowed', provider: 'override' }, 'Use target for the credential provider.'],
  [{ kind: 'api', target: 'old', label: 'override' }, 'API token rotation accepts target rather than a creation label.'],
  [{ kind: 'publish-host', target: 'cloud', prefill: [] }, 'Credential prefill must be an object.'],
  [{ kind: 'publish-host', target: 'cloud', prefill: { target: 'override' } }, 'Credential prefill cannot replace target.'],
  [{ kind: 'provider-settings', target: 'sync' }, 'Provider settings are not available here.'],
] as const)('rejects mismatched or unavailable credential inputs %j without effects', async (input, message) => {
  const { owners: { providerSettings: _omitted, ...owners }, build } = saveFixture();
  await expect(build({ adapters: owners })[0]!.handler(context(input))).rejects.toThrow(message);
  expect(Object.values(owners).flatMap(owner => owner.mock.calls)).toEqual([]);
});

it.each([
  ['publish-host', 'publish', { target: 'actual-target' }],
  ['source-control', 'source', { provider: 'actual-target' }],
  ['agent-plugin-token', 'token', { pluginId: 'actual-target' }],
  ['provider-settings', 'settings', { pluginId: 'actual-target' }],
  ['api', 'plugin', { provider: 'card-id' }],
  [undefined, 'plugin', { provider: 'card-id' }],
] as const)('applies card destination %s after authorization using fresh adapters', async (saveKind, owner, forwarded) => {
  const first = saveFixture(), fresh = saveFixture();
  const card = { providerId: 'card-id', label: 'Sync', category: 'general', baseUrl: 'https://sync.example', title: 'Connect', saveTarget: 'actual-target',
    ...(saveKind === undefined ? {} : { saveKind }) };
  const events: string[] = [];
  const authorizePluginProvider = vi.fn(async () => { events.push('authorize'); });
  const loadPluginCredentialCards = vi.fn(async () => { events.push('load'); return [card]; });
  const adaptersForCards = vi.fn(() => fresh.owners);
  const savedResult = vi.fn(async ({ result }: { result: unknown }) => ({ attached: result }));
  const registration = first.build({ adapters: first.owners, authorizePluginProvider, loadPluginCredentialCards, adaptersForCards, savedResult })[0]!;
  const ctx = context({ kind: 'plugin-provider', target: 'card-id' });
  expect(await registration.handler(ctx)).toEqual({ attached: { owner, input: forwarded } });
  expect(events).toEqual(['authorize', 'load']);
  expect(Object.values(first.owners).flatMap(handler => handler.mock.calls)).toEqual([]);
  expect(authorizePluginProvider.mock.calls).toEqual([[ctx]]);
  expect(adaptersForCards.mock.calls).toEqual([[{ cards: [card] }]]);
});

it('does not load plugin declarations without its entry authorization', async () => {
  const { owners, build } = saveFixture();
  const loadPluginCredentialCards = vi.fn(async () => []);
  await expect(build({ adapters: owners, loadPluginCredentialCards })[0]!.handler(context({ kind: 'plugin-provider', target: 'card-id' })))
    .rejects.toThrow('Plugin credential card authorization is unavailable. Use the credential kind directly.');
  expect(loadPluginCredentialCards.mock.calls).toEqual([]);
  expect(owners.pluginProvider.mock.calls).toEqual([]);
});
