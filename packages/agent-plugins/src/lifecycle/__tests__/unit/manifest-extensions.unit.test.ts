import { test, expect } from 'vitest';
import { parseAgentPluginMcpConfig, readAgentPluginExtension, parseAgentPluginManifest, type RemoteMcpServerConfig } from '../../index.js';

const value = { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { remote: { type: 'streamable-http', url: 'https://example.com/mcp' } } };
function defaults(defaultTools: unknown, namespace = 'org.example.host'): RemoteMcpServerConfig | undefined {
  const pluginManifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { 'org.example.host': { mcpServers: { remote: { defaultTools } } } } };
  const parsed = parseAgentPluginMcpConfig({ value, extensionNamespace: namespace }, { pluginManifest });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const server = parsed.config.servers.remote;
  return server?.type === 'stdio' ? undefined : server;
}
// Generalized t05 tests: exact grants, list bounds, subset validation and namespace isolation.
test('read names survive alongside independent write defaults', () => {
  expect(defaults({ allow: ['inspect', 'create'], write: ['create'], read: ['inspect'] })?.defaultTools).toEqual({ allow: ['inspect', 'create'], write: ['create'], read: ['inspect'] });
});
test('read-only declarations leave sign-in grants absent', () => {
  expect(defaults({ read: ['inspect'] })?.defaultTools).toEqual({ write: [], read: ['inspect'] });
  expect(defaults({ read: ['inspect'], write: ['create'] })).toBeUndefined();
});
test('malformed and out-of-grant read lists exclude the entire server', () => {
  expect(defaults({ allow: ['inspect'], read: ['other'] })).toBeUndefined();
  for (const read of ['inspect', ['inspect', 'bad name'], ['/inspect'], [''], [1], ['x'.repeat(65)], Array.from({ length: 65 }, (_, i) => `t${i}`)]) expect(defaults({ read })).toBeUndefined();
});
test('exactly 64 reviewed names are permitted; omitted reads default to empty', () => {
  const read = Array.from({ length: 64 }, (_, i) => `T${i}._-`);
  expect(defaults({ allow: read, read })?.defaultTools?.read).toEqual(read);
  expect(defaults({ allow: ['inspect'] })?.defaultTools?.read).toEqual([]);
});
test('a different namespace and inline metadata never supply reviewed reads', () => {
  expect(defaults({ read: ['inspect'] }, 'org.other.host')?.defaultTools).toBeUndefined();
  const parsed = parseAgentPluginMcpConfig({ value: { ...value, mcpServers: { remote: { ...value.mcpServers.remote, defaultTools: { read: ['inspect'] } } } }, extensionNamespace: 'org.example.host' });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect((parsed.config.servers.remote as RemoteMcpServerConfig).defaultTools).toBeUndefined();
});
test('an invalid manifest cannot supply reviewed reads', () => {
  const parsed = parseAgentPluginMcpConfig({ value, extensionNamespace: 'org.example.host' }, { pluginManifest: { name: 'fixture', extensions: { 'org.example.host': { mcpServers: { remote: { defaultTools: { read: ['inspect'] } } } } } } });
  if (!parsed.ok) throw new Error('invalid transport fixture');
  expect((parsed.config.servers.remote as RemoteMcpServerConfig).defaultTools).toBeUndefined();
});
test('typed readers select an own namespace and adapt application fields without core knowing them', () => {
  const manifest = parseAgentPluginManifest({ value: { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { 'org.example.host': { mode: 'oauth' } } } });
  if (!manifest.ok) throw new Error('invalid manifest');
  expect(readAgentPluginExtension({ manifest: manifest.manifest, namespace: 'org.example.host', read: ({ value }) => ({ authMode: value.mode }) })).toEqual({ authMode: 'oauth' });
  expect(() => readAgentPluginExtension({ manifest: manifest.manifest, namespace: '', read: ({ value }) => value })).toThrow('namespace');
  expect(readAgentPluginExtension({ manifest: { extensions: {} }, namespace: 'constructor', read: ({ value }) => value })).toBeUndefined();
});

test('host metadata readers translate custom extension keys before the generic validators run', () => {
  const pluginManifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { 'org.custom.host': { mcpServers: { remote: { clientAuth: 'oauth', reviewed: ['inspect'] } } } } };
  const parsed = parseAgentPluginMcpConfig({ value, extensionNamespace: 'org.custom.host' }, {
    pluginManifest,
    readServerMetadata: ({ serverId, value }) => {
      expect(serverId).toBe('remote');
      return { authMode: value.clientAuth, defaultTools: { read: value.reviewed } };
    },
  });
  if (!parsed.ok) throw new Error('invalid fixture');
  expect(parsed.config.servers.remote).toMatchObject({ authMode: 'oauth', defaultTools: { write: [], read: ['inspect'] } });
});

// REGRESSION: fails if readServerMetadata is skipped when the server has no plugin.json extension.
test('host translates legacy transport metadata only through an explicit reader', () => {
  const input = { value: { ...value, mcpServers: { remote: { ...value.mcpServers.remote, clientAuth: 'oauth', grants: { allow: ['inspect'] } } } }, extensionNamespace: 'org.legacy.host' };
  const baseline = parseAgentPluginMcpConfig(input);
  const treatment = parseAgentPluginMcpConfig(input, {
    readServerMetadata: ({ server }) => ({ authMode: server.clientAuth, defaultTools: server.grants }),
  });
  if (!baseline.ok || !treatment.ok) throw new Error('valid transport required for both probes');
  const before = baseline.config.servers.remote;
  const after = treatment.config.servers.remote;
  if (!before || before.type === 'stdio' || !after || after.type === 'stdio') throw new Error('remote transport expected');
  expect(before.authMode).toBeUndefined();
  expect(before.defaultTools).toBeUndefined();
  expect(after.authMode).toBe('oauth');
  expect(after.defaultTools).toEqual({ allow: ['inspect'], write: [], read: [] });
  // Both reach parsed output; only the explicit host reader explains the differing metadata.
});

// REGRESSION: fails if translated metadata bypasses the bounded generic validators.
test('legacy translation cannot hide malformed grants or a malformed declared extension', () => {
  const malformed = parseAgentPluginMcpConfig({ value, extensionNamespace: 'org.legacy.host' }, {
    readServerMetadata: () => ({ defaultTools: { allow: ['inspect'], read: ['ungranted'] } }),
  });
  if (!malformed.ok) throw new Error('valid transport required');
  expect(malformed.config.serverIds).toEqual(['remote']);
  expect(malformed.config.servers.remote).toBeUndefined();
  let readerCalls = 0;
  const invalidExtension = parseAgentPluginMcpConfig({ value, extensionNamespace: 'org.legacy.host' }, {
    pluginManifest: { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { 'org.legacy.host': { mcpServers: { remote: 'malformed' } } } },
    readServerMetadata: () => { readerCalls++; return {}; },
  });
  if (!invalidExtension.ok) throw new Error('valid transport required');
  expect(readerCalls).toBe(0);
  expect(invalidExtension.config.servers.remote).toBeUndefined();
});
