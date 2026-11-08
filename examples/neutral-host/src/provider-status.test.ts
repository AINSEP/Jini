import { expect, it } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import { createSystemClock } from '@jini-ai/core/primitives';
import { createTimeoutScheduler } from '@jini-ai/daemon/scheduler';
import { askThenReport, createSurfaceExchangeStore } from '@jini-ai/daemon/surface-exchanges';
import { createCredentialSaveTools } from '@jini-ai/agent-plugins/connect';
import { createProviderStatusTools, type ProviderStatusRow } from '@jini-ai/agent-plugins/lifecycle/host-tools';

it('provider status: reports configured providers with no product names, shows the host settings card and saves through memory', async () => {
  const secret = 'human-only-provider-key';
  const memory = new Map<string, string>();
  const exchanges = createSurfaceExchangeStore({ clock: createSystemClock(), scheduler: createTimeoutScheduler({}), idGenerator: { newId: () => 'settings-1' }, defaultChannel: 'mcp-ui' });
  const settingsCard = { tool: 'credential_save' as const, input: { kind: 'provider-settings' as const, target: 'metrics' } };
  const fields = [{ name: 'apiKey', label: 'API key', secret: true, required: true }];
  const status = createProviderStatusTools({ metadata: {}, authorization: { permission: 'studio.providers.read' }, catalogModule: 'studio/providers.ts', messages: { description: 'Read provider presence in the studio.', pluginIdDescription: 'Studio provider id from studio_plugins.', unknownPlugin: ({ pluginId }) => `Unknown studio provider ${String(pluginId)}; call studio_plugins.`, unexpectedInput: 'Studio provider status accepts only pluginId.' } });
  const rows = (): ProviderStatusRow[] => [{ pluginId: 'metrics', fields, settingsCard,
    enabled: true, configured: memory.has('metrics'), missing: memory.has('metrics') ? [] : ['API key'],
    store: 'site', appliesAt: 'now', usedByThisSite: true, usedBy: ['studio'] }];
  const context = (input: unknown): ToolExecutionContext => ({ executionId: 'exec', principal: { id: 'operator' }, run: { id: 'run' }, signal: new AbortController().signal, input });
  const read = status.buildProviderStatusRegistrations({ ports: {
    list: async () => rows(), authorize: async ctx => { expect(ctx.principal.id).toBe('operator'); },
  } })[0]!;
  const before = await read.handler(context({}), {}) as { providers: ProviderStatusRow[] };
  expect(before.providers[0]?.configured).toBe(false);
  expect(before.providers[0]?.settingsCard).toEqual(settingsCard);
  expect(status.providerStatusAgentToolCatalog[0]?.authorization.permission).toBe('studio.providers.read');

  const unused = async (): Promise<never> => { throw new Error('Unexpected credential domain'); };
  const tools = createCredentialSaveTools({ metadata: {}, toolId: 'credential_save', categories: ['general'], messages: { description: 'Save a provider credential in the studio human card.', oauthRefusal: 'Use studio_connect for browser sign-in.' }, catalogModule: 'studio/secrets.ts' });
  const save = tools.buildCredentialSaveRegistrations({ adapters: {
    apiCreate: unused, apiRotate: unused, mediaProvider: unused, sourceControl: unused,
    publishHost: unused, agentPluginToken: unused, pluginProvider: unused,
    providerSettings: async (ctx, optional = {}) => {
      // The host supplies its own card adapter; the domain package does not select a UI package.
      const exchange = exchanges.open({ binding: { toolId: 'credential_save', principalId: ctx.principal.id, channel: 'mcp-ui' }, emit: optional.emitSurface! });
      return askThenReport({ exchange,
        confirmationEmission: { channel: 'mcp-ui', payload: { resource: { type: 'resource', resource: {
          uri: 'ui://studio/provider-settings', mimeType: 'text/html;profile=mcp-app',
          text: '<form aria-label="Provider settings"><label>API key<input name="apiKey" type="password"></label><button>Save</button></form>',
        } } } },
        handle: async answer => {
          if (answer.status !== 'received') throw new Error('Settings card did not receive an answer');
          expect(typeof answer.params.apiKey).toBe('string');
          memory.set(String((ctx.input as { pluginId: string }).pluginId), String(answer.params.apiKey));
          return { result: { saved: true } };
        },
      });
    },
  } })[0]!;
  const shown: unknown[] = [];
  let raised!: () => void;
  const ready = new Promise<void>(resolve => { raised = resolve; });
  const pending = save.handler(context(before.providers[0]!.settingsCard!.input), { emitSurface: async emission => { shown.push(emission); raised(); } });
  await Promise.race([ready, pending.then(() => { throw new Error('Settings save did not show a card'); })]);
  expect(JSON.stringify(shown)).toContain('Provider settings');
  expect(JSON.stringify(shown)).toContain('type=\\"password\\"');
  expect(exchanges.deliver({ exchangeId: 'settings-1', principalId: 'operator', params: { apiKey: secret } }, { toolId: 'credential_save' })).toEqual({ ok: true });
  const result = await pending;
  expect(result).toEqual({ saved: true });
  expect(memory.get('metrics')).toBe(secret);
  const after = await read.handler(context({ pluginId: 'metrics' }), {}) as { providers: ProviderStatusRow[] };
  expect(after.providers[0]?.configured).toBe(true);
  expect(after.providers[0]?.missing).toEqual([]);
  expect(exchanges.size()).toBe(0);
  expect(JSON.stringify([shown, result, after])).not.toContain(secret);
  expect(JSON.stringify([shown, result, after]).toLowerCase()).not.toContain('tovu');
});
