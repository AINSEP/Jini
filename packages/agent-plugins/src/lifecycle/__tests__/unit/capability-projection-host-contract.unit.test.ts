import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PackagePathViolation, createAgentPluginLayout, createAgentPluginLifecycle } from '../../index.js';
import { parseAgentPluginMcpConfig } from '../../manifest.js';
import { ports } from '../test-support.js';

/**
 * @file Host contract for the capability projection reached through `createAgentPluginLifecycle`'s
 * object API — the surface a host binds instead of keeping its own copy of these readers. Pins:
 * the MCP transport trust boundary (`stdio` never auto-admits), containment of every disk read,
 * the fail-open `mcp.json` posture, namespace parity with the standalone parser under a portable
 * namespace, and metadata warnings delivered to the host's `onEvent` sink rather than a console.
 */

const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
type HostEvent = { readonly event: string; readonly message: string };
let dir: string;
let events: HostEvent[];
let api: ReturnType<typeof createAgentPluginLifecycle>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'capability-projection-host-contract-'));
  events = [];
  api = createAgentPluginLifecycle(
    { ...ports, extensionNamespace: 'jini', layout: createAgentPluginLayout({ root: path.join(dir, 'layout') }) },
    { onEvent: ({ event, message }) => { events.push({ event, message }); } },
  );
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function packageRoot(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = path.join(dir, name);
  await mkdir(root, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), body);
  }
  return root;
}

describe('classifyAgentPluginMcpServerTrust (object API)', () => {
  test('stdio requires operator confirmation; only remote transports auto-admit', () => {
    expect(api.classifyAgentPluginMcpServerTrust({ server: { type: 'stdio' } })).toBe('requires-confirmation');
    expect(api.classifyAgentPluginMcpServerTrust({ server: { type: 'streamable-http' } })).toBe('auto-admit');
    expect(api.classifyAgentPluginMcpServerTrust({ server: { type: 'sse' } })).toBe('auto-admit');
  });
});

describe('readInstalledSkillMarkdown (object API)', () => {
  test('reads a contained skill and refuses a symlink that leaves the package', async () => {
    const root = await packageRoot('skill-pkg', { 'skills/a/SKILL.md': '# A' });
    expect(await api.readInstalledSkillMarkdown({ packageRoot: root, skillPath: 'skills/a/SKILL.md' })).toBe('# A');
    await writeFile(path.join(dir, 'outside.md'), 'outside secret');
    await symlink(path.join(dir, 'outside.md'), path.join(root, 'skills', 'escape.md'));
    await expect(api.readInstalledSkillMarkdown({ packageRoot: root, skillPath: 'skills/escape.md' })).rejects.toBeInstanceOf(PackagePathViolation);
    await expect(api.readInstalledSkillMarkdown({ packageRoot: root, skillPath: '../outside.md' })).rejects.toBeInstanceOf(PackagePathViolation);
  });
});

describe('readInstalledMcpServers / readInstalledMcpServerIds (object API)', () => {
  test('an mcp.json symlinked outside the package is never read: fail-open to nothing, not a throw', async () => {
    const root = await packageRoot('mcp-escape', {});
    await writeFile(path.join(dir, 'outside-mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { evil: { type: 'stdio', command: 'x' } } }));
    await symlink(path.join(dir, 'outside-mcp.json'), path.join(root, 'mcp.json'));
    expect(await api.readInstalledMcpServers({ packageRoot: root })).toEqual({});
    expect(await api.readInstalledMcpServerIds({ packageRoot: root })).toEqual([]);
  });

  test('missing, malformed and wrong-schema mcp.json all collapse to nothing without a warning', async () => {
    const before = events.length;
    const missing = await packageRoot('mcp-missing', {});
    const malformed = await packageRoot('mcp-malformed', { 'mcp.json': '{not json' });
    const wrongSchema = await packageRoot('mcp-wrong-schema', { 'mcp.json': JSON.stringify({ $schema: 'https://example.test/other', mcpServers: {} }) });
    for (const root of [missing, malformed, wrongSchema]) {
      expect(await api.readInstalledMcpServers({ packageRoot: root })).toEqual({});
      expect(await api.readInstalledMcpServerIds({ packageRoot: root })).toEqual([]);
    }
    expect(events.length).toBe(before);
  });

  test('an unreadable plugin.json withholds metadata but transport discovery still works', async () => {
    const root = await packageRoot('mcp-bad-manifest', {
      'plugin.json': '{broken',
      'mcp.json': JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { remote: { type: 'sse', url: 'https://example.test/sse' } } }),
    });
    expect(await api.readInstalledMcpServers({ packageRoot: root })).toEqual({ remote: { type: 'sse', url: 'https://example.test/sse' } });
    expect(await api.readInstalledMcpServerIds({ packageRoot: root })).toEqual(['remote']);
  });

  test('legacy server metadata keeps its working connection and warns through the host onEvent sink', async () => {
    const before = events.length;
    const root = await packageRoot('mcp-legacy-server', {
      'plugin.json': JSON.stringify({ $schema: PLUGIN_SCHEMA, name: 'example', version: '1.0.0', extensions: { jini: { id: 'publisher/example' } } }),
      'mcp.json': JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp', tovuAuthMode: 'oauth' } } }),
    });
    const servers = await api.readInstalledMcpServers({ packageRoot: root });
    expect(servers.remote).toEqual({ type: 'streamable-http', url: 'https://example.test/mcp', authMode: 'oauth' });
    const emitted = events.slice(before);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every(entry => entry.event === 'agent-plugin-metadata-warning')).toBe(true);
    expect(emitted.some(entry => entry.message.includes('2027-05-06'))).toBe(true);
  });

  test('under a portable namespace the lifecycle parse equals the standalone parser with no namespace (legacy manifest key)', async () => {
    const manifest = { $schema: PLUGIN_SCHEMA, name: 'legacy', version: '1.0.0', extensions: { tovu: { id: 'publisher/legacy', mcpServers: { remote: { authMode: 'oauth' } } } } };
    const mcp = { $schema: MCP_SCHEMA, mcpServers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp' }, local: { type: 'stdio', command: './bin/server' } } };
    const root = await packageRoot('mcp-legacy-manifest', { 'plugin.json': JSON.stringify(manifest), 'mcp.json': JSON.stringify(mcp) });
    const before = events.length;
    const standalone = parseAgentPluginMcpConfig({ value: mcp }, { pluginManifest: manifest });
    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;
    expect(standalone.warnings?.length).toBeGreaterThan(0);
    expect(standalone.config.servers.remote).toMatchObject({ authMode: 'oauth' });
    expect(await api.readInstalledMcpServers({ packageRoot: root })).toEqual({ ...standalone.config.servers });
    expect(events.slice(before).map(entry => entry.message)).toEqual([...(standalone.warnings ?? [])]);
    expect(await api.readInstalledMcpServerIds({ packageRoot: root })).toEqual([...standalone.config.serverIds]);
  });
});
