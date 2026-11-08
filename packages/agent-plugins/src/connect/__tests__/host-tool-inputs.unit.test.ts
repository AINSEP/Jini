import { expect, it } from 'vitest';
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
