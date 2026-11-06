import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest, parseAgentPluginMcpConfig, readAgentPluginMetadata } from '../../manifest.js';

const schema = 'https://agent-plugins.org/schemas/1.0.0/';
const plugin = (extension: unknown, namespace = 'jini') => ({ $schema: `${schema}plugin.schema.json`, name: 'portable', extensions: { [namespace]: extension } });
const mcp = (server = {}) => ({ $schema: `${schema}mcp.schema.json`, mcpServers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp', ...server } } });

describe('portable manifest metadata', () => {
  test('normalizes presentation and signals without a host namespace', () => {
    const metadata = { displayName: 'Portable', summary: 'Useful capability', vendorAliases: ['vendor'], toolKeywords: { discover: 'vendor' }, card: { title: 'Connect account' }, hostSignals: [{ env: 'HOSTED', facts: { hosted: true } }], deploymentAdvice: 'Use a host.' };
    expect(parseAgentPluginManifest({ value: plugin(metadata) })).toMatchObject({ ok: true, manifest: metadata });
    expect(readAgentPluginMetadata({ value: plugin(metadata) })).toEqual({ metadata, warnings: [] });
  });
  test('new namespace wins as a whole and legacy metadata warns without user action', () => {
    const value = { ...plugin({ summary: 'new' }), extensions: { jini: { summary: 'new' }, tovu: { summary: 'old', displayName: 'Old' } } };
    expect(readAgentPluginMetadata({ value }).metadata).toEqual({ summary: 'new' });
    const legacy = parseAgentPluginManifest({ value: plugin({ id: 'publisher/portable', summary: 'old' }, 'tovu') });
    expect(legacy).toMatchObject({ ok: true, manifest: { summary: 'old' }, warnings: [expect.stringContaining('2027-05-06')] });
  });
  test('invalid advisory metadata is omitted with warnings; malformed advice drops signal declaration', () => {
    const result = readAgentPluginMetadata({ value: plugin({ summary: 3, vendorAliases: ['good', 4], toolKeywords: { discover: 7 }, card: { title: 7 }, hostSignals: [{ env: 'HOSTED', facts: { hosted: true } }], deploymentAdvice: 'bad\ncopy' }) });
    expect(result.metadata).toEqual({});
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  test('neutral MCP fields override old keys, while malformed new keys never inherit legacy values', () => {
    const pluginManifest = plugin({ mcpServers: { remote: { authMode: 'none', tovuAuthMode: 'oauth', defaultTools: { read: ['inspect'] }, tovuDefaultTools: { allow: ['old'] } } } });
    const parsed = parseAgentPluginMcpConfig({ value: mcp() }, { pluginManifest });
    expect(parsed).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'none', defaultTools: { read: ['inspect'], write: [] } } } } });
    const invalid = parseAgentPluginMcpConfig({ value: mcp() }, { pluginManifest: plugin({ mcpServers: { remote: { authMode: null, tovuAuthMode: 'oauth' } } }) });
    expect(invalid).toMatchObject({ ok: true, config: { servers: {} } });
  });
  test('legacy MCP entries retain sign-in grants but never acquire reviewed reads', () => {
    const parsed = parseAgentPluginMcpConfig({ value: mcp({ tovuAuthMode: 'oauth', tovuDefaultTools: { allow: ['inspect'], read: ['inspect'] } }) });
    expect(parsed).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'oauth', defaultTools: { allow: ['inspect'], read: [], write: [] } } } }, warnings: [expect.stringContaining('2027-05-06')] });
  });
  test('null legacy aliases preserve inline sign-in fallback while canonical null remains invalid', () => {
    const tokenAuth = { helpUrl: 'https://example.test/token', probeUrl: 'https://example.test/probe' };
    const renamedTools = { old_inspect: 'inspect' };
    const value = mcp({ tovuAuthMode: 'oauth', tovuDefaultTools: { allow: ['inspect'], read: ['inspect'] }, tovuTokenAuth: tokenAuth, tovuRenamedTools: renamedTools });
    const legacy = parseAgentPluginMcpConfig({ value }, { pluginManifest: plugin({ mcpServers: { remote: { tovuAuthMode: null, tovuDefaultTools: null } } }, 'tovu') });
    expect(legacy).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'oauth', defaultTools: { allow: ['inspect'], read: [], write: [] }, tokenAuth, renamedTools } } } });
    for (const field of ['authMode', 'defaultTools']) {
      const canonical = parseAgentPluginMcpConfig({ value }, { pluginManifest: plugin({ mcpServers: { remote: { [field]: null } } }) });
      expect(canonical).toMatchObject({ ok: true, config: { servers: {} } });
    }
  });
});
