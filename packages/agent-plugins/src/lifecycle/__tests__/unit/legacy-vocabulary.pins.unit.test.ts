import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest, parseAgentPluginMcpConfig, legacyAgentPluginMetadataWarning, type LegacyMcpAliases } from '../../manifest.js';

const legacyMcpAliases = { names: { authMode: 'tovuAuthMode', defaultTools: 'tovuDefaultTools', tokenAuth: 'tovuTokenAuth', renamedTools: 'tovuRenamedTools' }, warning: legacyAgentPluginMetadataWarning } satisfies LegacyMcpAliases;

/** R03 pins: legacy spellings are read at the boundary that interprets them, canonical spellings are emitted and shipped. */
const schema = 'https://agent-plugins.org/schemas/1.0.0/';
const plugin = (extension: unknown, namespace = 'jini') => ({ $schema: `${schema}plugin.schema.json`, name: 'portable', extensions: { [namespace]: extension } });
const mcp = (server = {}) => ({ $schema: `${schema}mcp.schema.json`, mcpServers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp', ...server } } });
const packagesRoot = path.resolve(import.meta.dirname, '../../../..');

describe('legacy vocabulary: N-1 reads', () => {
  test('an N-1 manifest that only declares extensions.tovu still parses and warns', () => {
    const legacy = parseAgentPluginManifest({ value: plugin({ id: 'publisher/n-1', summary: 'old' }, 'tovu') });
    expect(legacy).toMatchObject({ ok: true, manifest: { summary: 'old' }, warnings: [expect.stringContaining('extensions.tovu')] });
  });
  test('an N-1 OAuth config (tovuAuthMode) still reads as authMode and emits only the canonical field', () => {
    const parsed = parseAgentPluginMcpConfig({ value: mcp({ tovuAuthMode: 'oauth' }) }, { legacyMcpAliases });
    expect(parsed).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'oauth' } } }, warnings: [expect.stringContaining('deprecated')] });
    if (!parsed.ok) throw new Error('unreachable');
    expect(Object.keys(parsed.config.servers.remote!).filter(key => key.startsWith('tovu'))).toEqual([]);
  });
  test('two hosts translate only their own legacy MCP fields', () => {
    const hostA = { names: { authMode: 'alphaAuth', defaultTools: 'alphaTools', tokenAuth: 'alphaToken', renamedTools: 'alphaRenames' }, warning: 'Alpha aliases deprecated.' } satisfies LegacyMcpAliases;
    const hostB = { names: { authMode: 'betaAuth', defaultTools: 'betaTools', tokenAuth: 'betaToken', renamedTools: 'betaRenames' }, warning: 'Beta aliases deprecated.' } satisfies LegacyMcpAliases;
    const tokenA = { helpUrl: 'https://example.test/alpha', probeUrl: 'https://example.test/alpha/probe' };
    const tokenB = { helpUrl: 'https://example.test/beta', probeUrl: 'https://example.test/beta/probe' };
    const value = mcp({ alphaAuth: 'oauth', alphaTools: { allow: ['alpha'], read: ['alpha'] }, alphaToken: tokenA, alphaRenames: { old: 'alpha' },
      betaAuth: 'none', betaTools: { allow: ['beta'], read: ['beta'] }, betaToken: tokenB, betaRenames: { old: 'beta' } });
    expect(parseAgentPluginMcpConfig({ value })).toEqual({ ok: true, config: { serverIds: ['remote'], servers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp' } } } });
    for (const [aliases, authMode, tool, tokenAuth] of [[hostA, 'oauth', 'alpha', tokenA], [hostB, 'none', 'beta', tokenB]] as const) {
      expect(parseAgentPluginMcpConfig({ value }, { legacyMcpAliases: aliases })).toEqual({ ok: true,
        config: { serverIds: ['remote'], servers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp', authMode,
          defaultTools: { allow: [tool], read: [], write: [] }, tokenAuth, renamedTools: { old: tool } } } }, warnings: [aliases.warning] });
    }
  });
  test('canonical metadata wins even when malformed', () => {
    for (const key of ['authMode', 'defaultTools', 'tokenAuth', 'renamedTools'] as const) {
      const valid = { authMode: 'oauth', defaultTools: { allow: ['inspect'] }, tokenAuth: { helpUrl: 'https://example.test/token', probeUrl: 'https://example.test/probe' }, renamedTools: { old: 'inspect' } };
      const alias = legacyMcpAliases.names[key];
      for (const location of ['manifest', 'inline']) {
        const fields = { [key]: null, [alias]: valid[key] };
        const parsed = parseAgentPluginMcpConfig({ value: mcp(location === 'inline' ? fields : {}) }, {
          legacyMcpAliases, ...(location === 'manifest' ? { pluginManifest: plugin({ mcpServers: { remote: fields } }) } : {}),
        });
        expect(parsed).toEqual({ ok: true, config: { serverIds: ['remote'], servers: {} }, warnings: [legacyMcpAliases.warning] });
      }
    }
  });
  test('current canonical authMode raises no legacy warning', () => {
    const parsed = parseAgentPluginMcpConfig({ value: mcp({ authMode: 'oauth' }) });
    expect(parsed).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'oauth' } } } });
    expect('warnings' in parsed ? parsed.warnings : []).toEqual([]);
  });
});

describe('legacy vocabulary: bundled packages write the canonical spelling', () => {
  const shipped = readdirSync(packagesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => ['plugin.json', 'mcp.json'].map(file => path.join(packagesRoot, entry.name, file)))
    .flatMap(file => { try { return [{ file, text: readFileSync(file, 'utf8') }]; } catch { return []; } });
  test('at least the known bundled manifests were scanned', () => { expect(shipped.length).toBeGreaterThan(20); });
  test.each(shipped.map(({ file, text }) => [path.relative(packagesRoot, file), text] as const))('%s declares no tovu-prefixed key', (_name, text) => {
    expect(text).not.toMatch(/"tovu[A-Za-z]*"\s*:/);
  });
});
