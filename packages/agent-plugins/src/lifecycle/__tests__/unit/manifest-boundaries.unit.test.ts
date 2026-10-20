/** Boundary cases of `manifest.ts`'s field validators: each malformed field excludes exactly what it should. */
import { describe, expect, it } from 'vitest';
import { parseAgentPluginManifest, parseAgentPluginMcpConfig, readAgentPluginExtension, type McpServerConfig } from '../../manifest.js';

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const NAMESPACE = 'org.example.host';

function manifest(fields: Record<string, unknown>) {
  const parsed = parseAgentPluginManifest({ value: { $schema: PLUGIN_SCHEMA, name: 'fixture', ...fields } });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.manifest;
}
/** One declared server, with optional namespaced extension metadata for it. */
function server(entry: unknown, extension?: Record<string, unknown>): McpServerConfig | undefined {
  const pluginManifest = { $schema: PLUGIN_SCHEMA, name: 'fixture', extensions: { [NAMESPACE]: { mcpServers: extension ? { one: extension } : {} } } };
  const parsed = parseAgentPluginMcpConfig({ value: { $schema: MCP_SCHEMA, mcpServers: { one: entry } }, extensionNamespace: NAMESPACE }, { pluginManifest });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.config.servers.one;
}
const remote = (extension: Record<string, unknown>) => server({ type: 'streamable-http', url: 'https://example.com/mcp' }, extension);
const tokenAuth = (fields: Record<string, unknown>) => remote({ tokenAuth: { helpUrl: 'https://example.com/help', probeUrl: 'https://example.com/probe', ...fields } });

describe('plugin.json author', () => {
  it('keeps a string author', () => {
    expect(manifest({ author: 'Ada' }).author).toBe('Ada');
  });
  it('drops a non-string, non-object author', () => {
    expect(manifest({ author: 42 }).author).toBeUndefined();
  });
  it('keeps only the string members of an object author', () => {
    expect(manifest({ author: { name: 'Ada', email: 5, url: 'https://example.com' } }).author).toEqual({ name: 'Ada', url: 'https://example.com' });
  });
  it('keeps an email-only object author', () => {
    expect(manifest({ author: { email: 'ada@example.com' } }).author).toEqual({ email: 'ada@example.com' });
  });
});

describe('plugin.json shape', () => {
  it('refuses a non-object manifest', () => {
    expect(parseAgentPluginManifest({ value: [] })).toEqual({ ok: false, errors: ['plugin.json must be a JSON object'] });
  });
  // Pinned as found: the identity validator reports the same malformed extensions a second time.
  it('refuses a non-object extensions member', () => {
    const parsed = parseAgentPluginManifest({ value: { $schema: PLUGIN_SCHEMA, name: 'fixture', extensions: [] } });
    expect(parsed).toEqual({ ok: false, errors: ['plugin.json extensions must be an object', 'Plugin extensions must be an object.'] });
  });
  it('accepts a known schema without a version warning', () => {
    const parsed = parseAgentPluginManifest({ value: { $schema: PLUGIN_SCHEMA, name: 'fixture' } });
    expect(parsed.ok && parsed.warnings).toEqual(["Plugin 'fixture' has no publisher-qualified id; using 'unknown/fixture'."]);
  });
  it('omits keywords when the manifest declares none', () => {
    expect(manifest({}).keywords).toBeUndefined();
  });
});

describe('stdio servers', () => {
  it('keeps args, env and cwd when each is well formed', () => {
    expect(server({ type: 'stdio', command: 'node', args: ['a'], env: { MODE: 'x' }, cwd: '/w' }))
      .toEqual({ type: 'stdio', command: 'node', args: ['a'], env: { MODE: 'x' }, cwd: '/w' });
  });
  it('omits absent optional fields', () => {
    expect(server({ type: 'stdio', command: 'node' })).toEqual({ type: 'stdio', command: 'node' });
  });
  it('excludes an empty command', () => {
    expect(server({ type: 'stdio', command: '' })).toBeUndefined();
  });
  it('excludes non-array args', () => {
    expect(server({ type: 'stdio', command: 'node', args: 'a' })).toBeUndefined();
  });
  it('excludes args holding a non-string', () => {
    expect(server({ type: 'stdio', command: 'node', args: ['a', 1] })).toBeUndefined();
  });
  it('excludes an env with a non-string value', () => {
    expect(server({ type: 'stdio', command: 'node', env: { MODE: 1 } })).toBeUndefined();
  });
  it('excludes an env setting a reserved key', () => {
    expect(server({ type: 'stdio', command: 'node', env: { PLUGIN_ROOT: '/x' } })).toBeUndefined();
  });
  it('excludes a non-string cwd', () => {
    expect(server({ type: 'stdio', command: 'node', cwd: 1 })).toBeUndefined();
  });
});

describe('remote servers', () => {
  it('excludes an empty url', () => {
    expect(server({ type: 'sse', url: '' })).toBeUndefined();
  });
  it('excludes headers with a non-string value', () => {
    expect(server({ type: 'sse', url: 'https://example.com', headers: { A: 1 } })).toBeUndefined();
  });
  it('keeps string headers', () => {
    expect(server({ type: 'sse', url: 'https://example.com', headers: { A: 'b' } })).toEqual({ type: 'sse', url: 'https://example.com', headers: { A: 'b' } });
  });
  it('keeps authMode none', () => {
    expect(remote({ authMode: 'none' })).toEqual({ type: 'streamable-http', url: 'https://example.com/mcp', authMode: 'none' });
  });
  it('excludes an unknown authMode', () => {
    expect(remote({ authMode: 'basic' })).toBeUndefined();
  });
  it('excludes non-object defaultTools', () => {
    expect(remote({ defaultTools: ['inspect'] })).toBeUndefined();
  });
  it('excludes a default tool list over the 64-entry bound', () => {
    const names = Array.from({ length: 65 }, (_, index) => `tool${index}`);
    expect(remote({ defaultTools: { allow: names } })).toBeUndefined();
  });
  it('excludes a server entry that is not an object while still listing its id', () => {
    const parsed = parseAgentPluginMcpConfig({ value: { $schema: MCP_SCHEMA, mcpServers: { one: 'stdio' } }, extensionNamespace: NAMESPACE });
    expect(parsed).toEqual({ ok: true, config: { serverIds: ['one'], servers: {} } });
  });
});

describe('remote tokenAuth', () => {
  it('keeps importFromEnv and retiredEnv when both are valid env names', () => {
    expect(tokenAuth({ importFromEnv: 'NEW_TOKEN', retiredEnv: ['OLD_TOKEN'] }))
      .toEqual({ type: 'streamable-http', url: 'https://example.com/mcp', tokenAuth: { helpUrl: 'https://example.com/help', probeUrl: 'https://example.com/probe', importFromEnv: 'NEW_TOKEN', retiredEnv: ['OLD_TOKEN'] } });
  });
  it('excludes a non-object tokenAuth', () => {
    expect(remote({ tokenAuth: 'https://example.com' })).toBeUndefined();
  });
  it('excludes a non-https helpUrl', () => {
    expect(tokenAuth({ helpUrl: 'http://example.com/help' })).toBeUndefined();
  });
  it('excludes an unparseable probeUrl', () => {
    expect(tokenAuth({ probeUrl: 'not a url' })).toBeUndefined();
  });
  it('excludes a non-string helpUrl', () => {
    expect(tokenAuth({ helpUrl: 7 })).toBeUndefined();
  });
  it('excludes a helpUrl over 2048 characters', () => {
    expect(tokenAuth({ helpUrl: `https://example.com/${'a'.repeat(2048)}` })).toBeUndefined();
  });
  it('excludes a lower-case importFromEnv', () => {
    expect(tokenAuth({ importFromEnv: 'token' })).toBeUndefined();
  });
  it('excludes retiredEnv holding an invalid name', () => {
    expect(tokenAuth({ retiredEnv: ['OK', 'bad-name'] })).toBeUndefined();
  });
  it('excludes retiredEnv over the 32-entry bound', () => {
    expect(tokenAuth({ retiredEnv: Array.from({ length: 33 }, (_, index) => `OLD_${index}`) })).toBeUndefined();
  });
});

describe('extension namespaces', () => {
  it('parseAgentPluginMcpConfig refuses a blank namespace', () => {
    expect(() => parseAgentPluginMcpConfig({ value: {}, extensionNamespace: ' ' })).toThrow('An extension namespace is required');
  });
  it('readAgentPluginExtension ignores a namespace whose value is not an object', () => {
    expect(readAgentPluginExtension({ manifest: { extensions: { [NAMESPACE]: 'x' } }, namespace: NAMESPACE, read: () => 'read' })).toBeUndefined();
  });
});
