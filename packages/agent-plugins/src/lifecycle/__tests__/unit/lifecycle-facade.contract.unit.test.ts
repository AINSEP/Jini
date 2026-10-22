import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AgentPluginNotInstalledError, PackagePathViolation, createAgentPluginLayout, createAgentPluginLifecycle,
  type AgentPluginArchiveReaderPort, type InstalledAgentPlugin,
} from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file Contract tests for `createAgentPluginLifecycle`'s object-API facade: each adapter maps its
 * `{ ...input }` object onto the module function's positional arguments. Every assertion is a real
 * outcome against one installed package in a temp layout, so a swapped or dropped argument fails.
 */

const workspaceId = 'facade-ws';
const pluginId = 'facade-plugin';
const files: Record<string, string> = {
  'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId, description: 'Charts and dashboards' }),
  [`skills/${pluginId}/SKILL.md`]: '# Facade skill\nBody',
  'mcp.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { main: { type: 'stdio', command: './server.js' } } }),
  'contrib.json': JSON.stringify(['alpha']),
  'module.mjs': 'export default { greeting: "hello from module" };',
};
const archive = Buffer.from('facade-archive');
const digest = createHash('sha256').update(archive).digest('hex');
const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
  for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, async *openReadStream() { yield Buffer.from(text); } };
} };

let root: string;
let layout: ReturnType<typeof createAgentPluginLayout>;
let api: ReturnType<typeof createAgentPluginLifecycle>;
let installed: InstalledAgentPlugin;
let workspaceRoot: string;
beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-facade-')));
  layout = createAgentPluginLayout({ root });
  api = createAgentPluginLifecycle({ ...ports, layout }, { onEvent: () => undefined });
  installed = await api.installAgentPlugin({ layout, workspaceId, archive, archiveReader, expectedSha256: digest });
  workspaceRoot = layout.forWorkspace({ workspaceId }).root;
});
afterAll(async () => { await forceRemove(root); });

describe('construction validates the host context', () => {
  test.each([
    [{ productName: '  ' }], [{ extensionNamespace: '' }], [{ bundledArchiveMagic: '' }],
  ])('refuses a blank required identity %j', override => {
    expect(() => createAgentPluginLifecycle({ ...ports, ...override })).toThrow('productName, extensionNamespace and bundledArchiveMagic are required');
  });
  test('refuses an unknown delivery mode', () => {
    expect(() => createAgentPluginLifecycle({ ...ports, deliveryMode: 'email' as 'inject' })).toThrow('Invalid deliveryMode');
  });
});

describe('positional adapters reach the installed package', () => {
  test('package paths and archive limits', async () => {
    expect(api.normalizePackageEntryPath({ rawEntryPath: 'a\\b/../c.md' })).toBe('a/c.md');
    expect(await api.assertContainedOnDisk({ packageRoot: installed.packageRoot, entryPath: 'plugin.json' })).toBe(path.join(installed.packageRoot, 'plugin.json'));
    await expect(api.assertContainedOnDisk({ packageRoot: installed.packageRoot, entryPath: '../x' })).rejects.toBeInstanceOf(PackagePathViolation);
    expect(api.maxAgentPluginInstallArchiveBytes({})).toBeGreaterThan(0);
  });

  test('capability projection reads skill markdown and MCP servers', async () => {
    expect(await api.readInstalledSkillMarkdown({ packageRoot: installed.packageRoot, skillPath: `skills/${pluginId}/SKILL.md` })).toBe('# Facade skill\nBody');
    expect(await api.readInstalledMcpServerIds({ packageRoot: installed.packageRoot })).toEqual(['main']);
    expect(Object.keys(await api.readInstalledMcpServers({ packageRoot: installed.packageRoot }))).toEqual(['main']);
    expect(api.classifyAgentPluginMcpServerTrust({ server: { type: 'stdio' } })).toBe('requires-confirmation');
    expect(api.classifyAgentPluginMcpServerTrust({ server: { type: 'streamable-http' } })).toBe('auto-admit');
  });

  test('installed listing, digest presence and re-indexing agree on the one package', async () => {
    const workspace = layout.forWorkspace({ workspaceId });
    expect((await api.listInstalledPlugins({ workspaceRoot })).map(plugin => plugin.pluginId)).toEqual([pluginId]);
    expect(await api.isInstalledDigestPresent({ packagesDir: workspace.pluginPackagesDir({ pluginId }), archiveDigest: digest })).toBe(true);
    expect(await api.isInstalledDigestPresent({ packagesDir: workspace.pluginPackagesDir({ pluginId }), archiveDigest: 'f'.repeat(64) })).toBe(false);
    const indexed = await api.indexInstalledRoot({ packageRoot: installed.packageRoot, archiveDigest: digest });
    expect(indexed).toMatchObject({ pluginId, archiveDigest: digest, packageRoot: installed.packageRoot });
  });

  test('search ranks the installed candidate by query and honours the limit', () => {
    const candidates = [{ pluginId, description: 'Charts and dashboards', keywords: [], enabled: true, skills: [], mcpServerIds: [] }, { pluginId: 'other', description: 'Email', keywords: [], enabled: true, skills: [], mcpServerIds: [] }];
    expect(api.rankInstalledAgentPlugins({ query: 'dashboards', candidates, limit: 5 }).map(match => match.pluginId)).toEqual([pluginId]);
    expect(api.rankInstalledAgentPlugins({ query: '', candidates, limit: 5 }, { automatic: true })).toEqual([]);
  });

  test('activation adapters read, resolve and normalize the activation file', async () => {
    await api.assertAgentPluginActivationsWritable({ workspaceRoot });
    expect(await api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'admin@example' })).toEqual({ pluginId, enabled: false });
    const activations = await api.readAgentPluginActivations({ workspaceRoot });
    expect(activations.plugins[pluginId]).toMatchObject({ enabled: false, updatedBy: 'admin@example' });
    expect(api.isAgentPluginActive({ activations, pluginId })).toBe(false);
    expect((await api.resolveAgentPluginActivation({ workspaceRoot, pluginId })).verdict).toBe('inactive');
    expect(await api.isAgentPluginRecordedAsBundled({ workspaceRoot, pluginId })).toBe(false);
    expect(api.normalizeActivations({ value: activations })).toEqual(activations);
    expect(await api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: true, actor: 'admin@example' })).toEqual({ pluginId, enabled: true });
  });

  test('enabling a plugin that is not installed is a typed refusal that writes nothing', async () => {
    const before = await api.readAgentPluginActivations({ workspaceRoot });
    const refusal = api.setAgentPluginEnabled({ workspaceId, pluginId: 'ghost', enabled: true, actor: 'admin@example' });
    await expect(refusal).rejects.toBeInstanceOf(AgentPluginNotInstalledError);
    await expect(refusal).rejects.toMatchObject({ name: 'AgentPluginNotInstalledError', message: "agent plugin 'ghost' is not installed in this workspace" });
    expect(await api.readAgentPluginActivations({ workspaceRoot })).toEqual(before);
  });

  test('bundled digests are recorded, read back, normalized and preferred', async () => {
    const now = () => new Date('2026-01-02T03:04:05.000Z');
    await api.recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId, archiveDigest: digest }] }, { now });
    const bundled = await api.readBundledAgentPluginDigests({ workspaceRoot });
    expect(bundled.get(pluginId)).toBe(digest);
    expect(api.normalizeBundledDigests({ value: { schemaVersion: 1, plugins: { [pluginId]: { archiveDigest: digest } } } }).get(pluginId)).toBe(digest);
    const stale = { pluginId, archiveDigest: 'e'.repeat(64) };
    const current = { pluginId, archiveDigest: digest };
    expect(api.preferBundledAgentPluginDigests({ installed: [stale, current], bundled })).toEqual([current]);
  });

  test('trusted file adapters gate on the bundled digest, then read and import contained files', async () => {
    await api.recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId, archiveDigest: digest }] });
    const verdicts = await api.findTrustedPluginPackages({ workspaceId, filename: 'contrib.json', contribution: 'widgets', requireActive: true }, { orderByPluginId: true });
    expect(verdicts).toEqual([{ trusted: { pluginId, packageRoot: installed.packageRoot } }]);
    expect(await api.findTrustedPluginPackages({ workspaceId, filename: 'not-shipped.json', contribution: 'widgets', requireActive: false })).toEqual([]);
    const plugin = { pluginId, packageRoot: installed.packageRoot };
    expect(await api.readTrustedPluginFile({ plugin, filename: 'contrib.json' })).toBe('["alpha"]');
    expect(await api.importContainedModule({ plugin, modulePath: 'module.mjs' })).toEqual({ exported: { greeting: 'hello from module' } });
    expect(await api.importContainedModule({ plugin, modulePath: '../escape.mjs' })).toBe("module path '../escape.mjs' escapes the plugin root");
  });

  test('contribution loading is wired to the trusted find/read/import owner', async () => {
    await api.recordBundledAgentPluginDigests({ workspaceRoot, seeded: [{ pluginId, archiveDigest: digest }] });
    const result = await api.loadPluginContributions({ workspaceId, definition: {
      filename: 'contrib.json', contribution: 'widgets', kind: 'executable',
      parse: ({ raw }) => ({ ok: true, descriptors: JSON.parse(raw) as string[] }),
      load: async ({ plugin, descriptor, importModule }) => {
        const loaded = await importModule({ plugin, modulePath: 'module.mjs' });
        return typeof loaded === 'string' ? loaded : { descriptor, exported: loaded.exported };
      },
    } });
    expect(result.refusals).toEqual([]);
    expect(result.items).toEqual([{ descriptor: 'alpha', exported: { greeting: 'hello from module' } }]);
  });

  test('archive fetch goes through the host outbound guard and fetch port', async () => {
    const guarded: string[] = [];
    const fetching = createAgentPluginLifecycle({ ...ports, layout,
      outboundGuard: { assertAllowed: async ({ url }) => { guarded.push(url); } },
      fetch: async () => new Response(Buffer.from('zip-bytes')) });
    const fetched = await fetching.fetchAgentPluginArchive({ url: 'https://example.invalid/p.zip' }, { maxBytes: 64 });
    expect(Buffer.from(fetched.archive).toString()).toBe('zip-bytes');
    expect(fetched.sha256).toBe(createHash('sha256').update('zip-bytes').digest('hex'));
    expect(guarded).toEqual(['https://example.invalid/p.zip']);
    expect(fetching.maxAgentPluginArchiveBytes({})).toBeGreaterThan(64);
  });

  test('activation filtering keeps only items whose plugin is active', async () => {
    await api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: false, actor: 'admin@example' });
    const activations = await api.readAgentPluginActivations({ workspaceRoot });
    const items = [{ id: pluginId }, { id: 'never-recorded' }];
    expect(api.filterActiveAgentPlugins({ activations, items, pluginIdOf: ({ item }) => item.id })).toEqual([{ id: 'never-recorded' }]);
    await api.setAgentPluginEnabled({ workspaceId, pluginId, enabled: true, actor: 'admin@example' });
  });

  test('ref resolution defaults to the context delivery mode and memory is bound to the named workspace', async () => {
    const memory = api.pluginMemory({ workspaceId, pluginId });
    await memory.writeNote({ entryPath: 'facts.md', text: 'REMEMBERED' });
    const workspaceLayout = layout.forWorkspace({ workspaceId });
    const injected = await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout });
    expect(injected.ok && injected.promptPrefix).toContain('REMEMBERED');
    const pointed = await api.resolveAgentPluginRefs({ pluginRefIds: [pluginId], workspaceLayout }, { deliveryMode: 'pointer' });
    expect(pointed.ok && pointed.promptPrefix).toContain(`agent_plugin_${pluginId.replace(/-/g, '_')}`);
  });

  test('a bundled source directory packs into an archive the bundled reader can read back', async () => {
    const sourceDir = path.join(root, 'bundled-source');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'plugin.json'), files['plugin.json']!);
    const packed = await api.packAgentPluginDirectory({ sourceDir });
    const names: string[] = [];
    for await (const entry of api.createBundledSourceArchiveReader({}).entries({ archive: packed.bytes })) names.push(entry.entryPath);
    expect(names).toEqual(['plugin.json']);
  });

  test('frozen package trees can be staged, restored and removed', async () => {
    const packagesDir = path.join(root, 'stage-area');
    const tree = path.join(packagesDir, 'tree');
    await fs.mkdir(path.join(tree, 'inner'), { recursive: true });
    await fs.writeFile(path.join(tree, 'inner', 'file'), 'bytes');
    await fs.chmod(tree, 0o555);
    const staged = await api.stageForRemoval({ packagesDir, packageRoot: tree });
    await expect(fs.stat(tree)).rejects.toMatchObject({ code: 'ENOENT' });
    const cause = new Error('rolled back');
    expect(await api.restoreStagedTrees({ staged: [staged], cause })).toBe(cause);
    expect((await fs.stat(tree)).mode & 0o777).toBe(0o555);
    await api.removeFrozenPackageTree({ root: tree });
    await expect(fs.stat(tree)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('layout migration runs against the named workspace', async () => {
    const result = await api.migratePluginLayout({ workspaceId });
    expect(result.complete).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(workspaceRoot, '.agent-plugin-layout-migrated'), 'utf8'))).toEqual({ layoutVersion: 2 });
  });
});
