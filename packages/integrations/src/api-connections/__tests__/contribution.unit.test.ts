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
      if (!parsed.ok) throw new Error(parsed.reason);
      const module = definition.validate({ exported: { createHooks: () => ({}) } });
      assert.notEqual(typeof module, 'string');
      if (typeof module === 'string') throw new Error(module);
      return { items: [{ pluginId: 'fixture', descriptor: parsed.descriptors[0]!, module }], refusals: ['earlier refusal'] };
    },
  }, { clientNamespaceFor: async () => 'VENDOR_' });
  assert.deepEqual(result, { connections: [], refusals: ['earlier refusal', "API connection 'account' from 'fixture' was not loaded: Client settings must belong to this plugin's VENDOR_FIXTURE_ namespace."] });
});

const declarationFile = (clientIdEnv: unknown, over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, connections: [{ id: 'account', module: 'connection.mjs',
  clients: { web: { clientIdEnv } }, label: 'Account', authorizationEndpoint: 'https://issuer.example/authorize', tokenEndpoint: 'https://issuer.example/token', ...over }] });
type LoadContributions = Parameters<typeof loadDeclaredApiConnections>[0]['loadContributions'];
type Definition = Parameters<LoadContributions>[0]['definition'];
const reason = (parsed: ReturnType<Definition['parse']>) => (parsed.ok ? 'ok' : parsed.reason);

test('the contribution definition parses the host namespace, falls back to the declared one, and reports the host reason otherwise', async () => {
  let seen: Parameters<LoadContributions>[0] | undefined;
  await loadDeclaredApiConnections({ workspaceId: 'ws', clientNamespace: 'HOST_', callbackFieldRules: realCallbackFieldRules,
    loadContributions: async input => { seen = input; return { items: [], refusals: [] }; } });
  assert.ok(seen);
  const { definition, onReadError, workspaceId } = seen;
  assert.equal(workspaceId, 'ws');
  assert.deepEqual([definition.filename, definition.contribution], ['jini-connections.json', 'API connections']);
  const host = definition.parse({ raw: declarationFile('HOST_ACCOUNT_CLIENT_ID') });
  assert.equal(host.ok && host.descriptors[0]?.clients.web?.clientIdEnv, 'HOST_ACCOUNT_CLIENT_ID');
  const declared = definition.parse({ raw: declarationFile('VENDOR_ACCOUNT_CLIENT_ID') });
  assert.equal(declared.ok && declared.descriptors[0]?.clients.web?.clientIdEnv, 'VENDOR_ACCOUNT_CLIENT_ID');
  const hostReason = 'connections[0].clients.web.clientIdEnv must name a HOST_…_CLIENT_ID setting';
  assert.equal(reason(definition.parse({ raw: declarationFile('VENDOR_ACCOUNT_CLIENT_ID', { byoClient: 'yes' }) })), hostReason);
  assert.equal(reason(definition.parse({ raw: declarationFile(7) })), hostReason);
  assert.equal(reason(definition.parse({ raw: JSON.stringify({ schemaVersion: 1 }) })), 'connections must be an array of at most 8');
  assert.equal(reason(definition.parse({ raw: '{' })), 'not valid JSON');
  const descriptor = host.ok ? host.descriptors[0] : undefined;
  assert.ok(descriptor);
  assert.equal(definition.modulePath({ descriptor }), 'connection.mjs');
  assert.equal(definition.refusal({ plugin: { pluginId: 'fixture' }, descriptor, reason: 'digest mismatch' }), "API connection 'account' from 'fixture' was not loaded: digest mismatch");
  assert.equal(definition.validate({ exported: {} }), 'its module has no createHooks() function');
  assert.deepEqual(onReadError({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }), []);
  assert.equal(onReadError({ error: Object.assign(new Error('denied'), { code: 'EACCES' }) }), undefined);
  assert.equal(onReadError({ error: null }), undefined);
});

async function loadOne(clientIdEnv: string, optional: Parameters<typeof loadDeclaredApiConnections>[1] = {}) {
  return loadDeclaredApiConnections({ workspaceId: 'ws', clientNamespace: 'HOST_', callbackFieldRules: realCallbackFieldRules,
    loadContributions: async ({ definition }) => {
      const parsed = definition.parse({ raw: declarationFile(clientIdEnv, { scopeSets: ['read'], apiOrigins: ['https://api.example'], byoClient: true }) });
      const module = definition.validate({ exported: { createHooks: () => ({}) } });
      if (!parsed.ok || typeof module === 'string') throw new Error('fixture must parse');
      return { items: [{ pluginId: 'fixture', descriptor: parsed.descriptors[0]!, module }], refusals: [] };
    } }, optional);
}

test('a connection in the host namespace loads with its host-read fields and a descriptor bound to the plugin', async () => {
  for (const optional of [{}, { clientNamespaceFor: async () => undefined }]) {
    const { connections, refusals } = await loadOne('HOST_FIXTURE_OAUTH_WEB_CLIENT_ID', optional);
    assert.deepEqual(refusals, []);
    assert.equal(connections.length, 1);
    const [connection] = connections;
    assert.ok(connection);
    assert.equal(connection.pluginId, 'fixture');
    assert.deepEqual([connection.descriptor.pluginId, connection.descriptor.connectionId, connection.descriptor.label, connection.descriptor.tokenEndpoint],
      ['fixture', 'account', 'Account', 'https://issuer.example/token']);
    assert.deepEqual(connection.clients, { web: { clientIdEnv: 'HOST_FIXTURE_OAUTH_WEB_CLIENT_ID' } });
    assert.deepEqual([connection.scopeSets, connection.apiOrigins, connection.byoClient], [['read'], ['https://api.example'], true]);
  }
});

test('a non-Error failure while authorizing a connection is refused with a fixed reason', async () => {
  const { connections, refusals } = await loadOne('HOST_FIXTURE_OAUTH_WEB_CLIENT_ID', { clientNamespaceFor: async () => { throw 'lookup failed'; } });
  assert.deepEqual(connections, []);
  assert.deepEqual(refusals, ["API connection 'account' from 'fixture' was not loaded: invalid descriptor"]);
});
