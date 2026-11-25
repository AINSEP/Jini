import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest, parseAgentPluginMcpConfig } from '../../manifest.js';

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
    const parsed = parseAgentPluginMcpConfig({ value: mcp({ tovuAuthMode: 'oauth' }) });
    expect(parsed).toMatchObject({ ok: true, config: { servers: { remote: { authMode: 'oauth' } } }, warnings: [expect.stringContaining('deprecated')] });
    if (!parsed.ok) throw new Error('unreachable');
    expect(Object.keys(parsed.config.servers.remote!).filter(key => key.startsWith('tovu'))).toEqual([]);
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
