import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApiConnectionHost, startApiConnectionSignIn, runApiConnectionConnect } from '@jini-ai/integrations/api-connections';
import { createAgentPluginStateStore } from '@jini-ai/agent-plugins/admin-surfaces';

it('A4 moved factories are reachable through real node API and universal state entries', () => {
  expect(typeof createApiConnectionHost).toBe('function');
  expect(typeof startApiConnectionSignIn).toBe('function');
  expect(typeof runApiConnectionConnect).toBe('function');
  expect(typeof createAgentPluginStateStore).toBe('function');
  const integrations = JSON.parse(readFileSync(new URL('../../../packages/integrations/package.json', import.meta.url), 'utf8'));
  const plugins = JSON.parse(readFileSync(new URL('../../../packages/agent-plugins/package.json', import.meta.url), 'utf8'));
  expect(integrations.jini.entries['./api-connections']).toBe('node');
  expect(plugins.jini.entries['./admin-surfaces']).toBe('universal');
});

it('A4 moved state store uses host refusal wording and rejects a foreign scope before storage', async () => {
  let reads = 0;
  const unavailable = async (): Promise<never> => { reads++; throw new Error('Unexpected storage call'); };
  const store = createAgentPluginStateStore({ workspaceId: 'studio', messages: { unavailable: 'Studio state unavailable; reopen studio settings.' },
    persistence: { scope: { workspaceId: 'studio', kind: 'api-connection', ownerKey: 'studio', principalId: null, binding: null }, format: 'studio-state',
      vault: { list: unavailable, get: unavailable, put: unavailable, delete: unavailable }, isConflict: () => false } });
  await expect(store.readerFor({ workspaceId: 'foreign', pluginId: 'relay' }).get({ key: 'setting' })).rejects.toThrow('Studio state unavailable; reopen studio settings.');
  expect(reads).toBe(0);
});
