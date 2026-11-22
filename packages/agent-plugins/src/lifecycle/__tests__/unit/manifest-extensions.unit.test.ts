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

// REGRESSION: fails if plugin.json is parsed under the default identity namespace instead of the
// supplied extensionNamespace — a malformed, unrelated `tovu` extension then hides valid host metadata.
test('an unrelated malformed identity extension cannot suppress the supplied namespace metadata', () => {
  const pluginManifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { tovu: 'not-an-object', 'org.example.host': { mcpServers: { remote: { defaultTools: { read: ['inspect'] } } } } } };
  const parsed = parseAgentPluginMcpConfig({ value, extensionNamespace: 'org.example.host' }, { pluginManifest });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  expect((parsed.config.servers.remote as RemoteMcpServerConfig).defaultTools).toEqual({ write: [], read: ['inspect'] });
});


test('projects declared companion names from the selected namespace', () => {
  const base = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture' };
  const extensions = { jini: { companions: ['ui-ux-design', 'slide-design', 'ui-ux-design'] }, tovu: { companions: ['legacy'] }, other: { companions: 7 } };
  const canonical = parseAgentPluginManifest({ value: { ...base, extensions } });
  const legacy = parseAgentPluginManifest({ value: { ...base, extensions: { tovu: extensions.tovu, other: extensions.other } } });
  const custom = parseAgentPluginManifest({ value: { ...base, extensions } }, { identityNamespace: 'other' });
  const absent = parseAgentPluginManifest({ value: base });
  expect(canonical.ok && canonical.manifest.companions, 'canonical names retain declaration order and remove duplicates').toEqual(['ui-ux-design', 'slide-design']);
  expect(legacy.ok && legacy.manifest.companions, 'legacy metadata remains the default when canonical metadata is absent').toEqual(['legacy']);
  expect(canonical.ok && canonical.manifest.extensions, 'unrelated extensions stay opaque').toEqual(extensions);
  expect(custom.ok && custom.warnings, 'an explicit namespace reads its own advisory metadata').toContain('companions must be an array of valid plugin names');
  expect(absent.ok && Object.hasOwn(absent.manifest, 'companions'), 'undeclared companions keep the old shape').toBe(false);
});

test('ignores a malformed companion list without rejecting the plugin', () => {
  for (const companions of ['ui-ux-design', ['valid', 'Bad'], ['a--b'], [''], [1], ['x'.repeat(65)]]) {
    const parsed = parseAgentPluginManifest({ value: { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture', extensions: { jini: { companions } } } });
    expect(parsed.ok, 'malformed advisory companions do not reject the manifest').toBe(true);
    if (!parsed.ok) throw new Error('valid manifest expected');
    expect(Object.hasOwn(parsed.manifest, 'companions'), 'a malformed list is omitted as a whole').toBe(false);
    expect(parsed.warnings, 'the omitted companion list has an advisory warning').toContain('companions must be an array of valid plugin names');
  }
});
