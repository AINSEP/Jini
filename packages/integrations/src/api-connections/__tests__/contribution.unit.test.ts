import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadDeclaredApiConnections } from '../contribution.js';
import { realCallbackFieldRules } from './fixtures/real-capabilities.js';

test('shape parsing admits a declared namespace before the plugin-specific authorization refuses it', async () => {
  const result = await loadDeclaredApiConnections({ workspaceId: 'ws', clientNamespace: 'HOST_', callbackFieldRules: realCallbackFieldRules,
    loadContributions: async ({ definition }, options) => {
      assert.deepEqual(options, { orderByPluginId: true });
      const parsed = definition.parse({ raw: JSON.stringify({ schemaVersion: 1, connections: [{ id: 'account', module: 'connection.mjs',
        clients: { web: { clientIdEnv: 'VENDOR_OTHER_CLIENT_ID' } }, label: 'Account',
        authorizationEndpoint: 'https://issuer.example/authorize', tokenEndpoint: 'https://issuer.example/token',
      }] }) });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) throw new Error(parsed.reason);
      const module = definition.validate({ exported: { createHooks: () => ({}) } });
      assert.notEqual(typeof module, 'string');
      if (typeof module === 'string') throw new Error(module);
      return { items: [{ pluginId: 'fixture', descriptor: parsed.descriptors[0]!, module }], refusals: ['earlier refusal'] };
    },
  }, { clientNamespaceFor: async () => 'VENDOR_' });
  assert.deepEqual(result, { connections: [], refusals: ['earlier refusal', "API connection 'account' from 'fixture' was not loaded: Client settings must belong to this plugin's VENDOR_FIXTURE_ namespace."] });
});
