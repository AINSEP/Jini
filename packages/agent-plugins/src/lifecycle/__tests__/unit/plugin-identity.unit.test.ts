import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseAgentPluginManifest } from '../../manifest.js';
import { createInstallModule, type AgentPluginArchiveReaderPort, type InstallAgentPluginOptional } from '../../install.js';
import { createAgentPluginLayout } from '../../layout.js';
import { createSearchModule } from '../../search.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await forceRemove(root); });
const manifest = (name: string, id?: string) => ({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name, version: '1.0.0',
  keywords: ['repository'], ...(id ? { extensions: { tovu: { id, provides: ['source-control'] } } } : {}),
});

describe('plugin identity (owner 2026-10-09)', () => {
  it('parses the shared identity contract and keeps portable fields and version separate', () => {
    const result = parseAgentPluginManifest({ value: manifest('github', 'tovu/github') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.manifest.id).toBe('tovu/github');
    expect(result.manifest.name).toBe('github');
    expect(result.manifest.version).toBe('1.0.0');
    expect(result.manifest.provides).toEqual(['source-control']);
    expect(result.warnings).toEqual([]);
  });

  it('warns for legacy manifests and rejects malformed qualified ids and provides', () => {
    const result = parseAgentPluginManifest({ value: manifest('github') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.manifest.id).toBe('unknown/github');
    expect(result.warnings).toEqual(["Plugin 'github' has no publisher-qualified id; using 'unknown/github'."]);
    expect(parseAgentPluginManifest({ value: manifest('github', '../github') })).toEqual({ ok: false, errors: ['Plugin id must have the form publisher/name (lowercase letters, digits, dots and hyphens).'] });
    expect(parseAgentPluginManifest({ value: { ...manifest('github'), extensions: { tovu: { id: 'tovu/github', provides: ['ok', 1] } } } })).toEqual({ ok: false, errors: ['Plugin provides must be an array of capability names.'] });
  });

  it('ranks capability-only and publisher-id queries using the existing ranker', () => {
    const candidate = { pluginId: 'bridge', id: 'tovu/github', provides: ['source-control'], keywords: ['repository'], version: '1.0.0', enabled: false, skills: [], mcpServerIds: [] };
    const search = createSearchModule(ports);
    expect(search.rankInstalledAgentPlugins('source-control', [candidate], 10)).toEqual([{ ...candidate, score: 4 }]);
    expect(search.rankInstalledAgentPlugins('tovu/github', [candidate], 10)).toEqual([{ ...candidate, score: 5 }]);
    expect(search.rankInstalledAgentPlugins('unrelated', [candidate], 10)).toEqual([]);
  });

  async function fixture(optional: { filesystem?: typeof ports.filesystem } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'plugin-identity-')); roots.push(root);
    const layout = createAgentPluginLayout({ root });
    const events: { event: string; message: string }[] = [];
    const installer = createInstallModule({ ...ports, filesystem: optional.filesystem ?? ports.filesystem, layout, extensionNamespace: 'tovu', onEvent: event => events.push(event) });
    async function install(name: string, id: string, workspaceId = 'site', options: InstallAgentPluginOptional & { version?: string } = {}) {
      const text = JSON.stringify({ ...manifest(name, id), version: options.version ?? '1.0.0' });
      const archive = Buffer.from(text);
      const reader: AgentPluginArchiveReaderPort = { async *entries() {
        yield { kind: 'file', entryPath: 'plugin.json', declaredSize: archive.length, executable: false,
          async *openReadStream() { yield archive; } };
      } };
      return installer.installAgentPlugin({ archive, expectedSha256: createHash('sha256').update(archive).digest('hex'), archiveReader: reader, layout, workspaceId }, options);
    }
    return { layout, install, events };
  }

  it('refuses duplicate publisher ids under different names, retaining the first install', async () => {
    const { layout, install } = await fixture();
    const first = await install('github', 'tovu/github');
    expect(first.id).toBe('tovu/github');
    expect(first.provides).toEqual(['source-control']);
    await expect(install('alias', 'tovu/github')).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
    expect(JSON.parse(await readFile(path.join(first.packageRoot, 'plugin.json'), 'utf8')).name).toBe('github');
    const workspace = layout.forWorkspace({ workspaceId: 'site' });
    await expect(readdir(workspace.pluginPackagesDir({ pluginId: 'alias' }))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await install('alias', 'tovu/github', 'other-site')).id).toBe('tovu/github');
  });

  it('serializes competing names and rejects a publisher takeover of the existing slot', async () => {
    const { install } = await fixture();
    const results = await Promise.allSettled([install('first', 'tovu/shared'), install('second', 'tovu/shared')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason.code : undefined).toBe('PLUGIN_ID_CONFLICT');
    await install('vendor', 'tovu/vendor');
    await expect(install('vendor', 'github/vendor')).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
  });

  it('prunes superseded frozen revisions after successful publication while preserving workspace memory and other plugins', async () => {
    const { layout, install } = await fixture();
    const first = await install('github', 'tovu/github');
    const unrelated = await install('bridge', 'vendor/bridge');
    const otherSite = await install('github', 'tovu/github', 'other-site');
    const workspace = layout.forWorkspace({ workspaceId: 'site' });
    const notes = path.join(workspace.pluginMemoryDir({ pluginId: 'github', kind: 'notes' }), 'keep.md');
    await writeFile(notes, 'Operator notes survive upgrades.');
    const second = await install('github', 'tovu/github', 'site', { version: '2.0.0' });
    const third = await install('github', 'tovu/github', 'site', { version: '3.0.0' });
    expect(await readdir(workspace.pluginPackagesDir({ pluginId: 'github' }))).toEqual([third.archiveDigest]);
    await expect(readFile(path.join(first.packageRoot, 'plugin.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(second.packageRoot, 'plugin.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(path.join(third.packageRoot, 'plugin.json'), 'utf8')).version).toBe('3.0.0');
    expect(await readFile(notes, 'utf8')).toBe('Operator notes survive upgrades.');
    expect(JSON.parse(await readFile(path.join(unrelated.packageRoot, 'plugin.json'), 'utf8')).name).toBe('bridge');
    expect(JSON.parse(await readFile(path.join(otherSite.packageRoot, 'plugin.json'), 'utf8')).version).toBe('1.0.0');
  });

  it('does not prune during preview or a rejected publication', async () => {
    const { layout, install } = await fixture();
    const first = await install('github', 'tovu/github');
    await install('github', 'tovu/github', 'site', { version: '2.0.0', previewOnly: true });
    await expect(install('github', 'tovu/github', 'site', { version: '2.0.0', publishGuard: async () => { throw new Error('Publication refused.'); } })).rejects.toThrow('Publication refused.');
    expect(await readdir(layout.forWorkspace({ workspaceId: 'site' }).pluginPackagesDir({ pluginId: 'github' }))).toEqual([first.archiveDigest]);
    expect(JSON.parse(await readFile(path.join(first.packageRoot, 'plugin.json'), 'utf8')).version).toBe('1.0.0');
  });

  it('an interrupted prune warns without rejecting the accepted install or losing either complete revision', async () => {
    const filesystem = { ...ports.filesystem, rename: async (...args: Parameters<typeof ports.filesystem.rename>) => {
      if (path.basename(String(args[1])).startsWith('.uninstalling-')) throw Object.assign(new Error('Pruning unavailable.'), { code: 'EACCES' });
      return ports.filesystem.rename(...args);
    } };
    const { install, events } = await fixture({ filesystem });
    const first = await install('github', 'tovu/github');
    const second = await install('github', 'tovu/github', 'site', { version: '2.0.0' });
    expect(JSON.parse(await readFile(path.join(first.packageRoot, 'plugin.json'), 'utf8')).version).toBe('1.0.0');
    expect(JSON.parse(await readFile(path.join(second.packageRoot, 'plugin.json'), 'utf8')).version).toBe('2.0.0');
    expect(events).toEqual([{ event: 'agent-plugin-revision-prune-warning', message: "Plugin 'github': a superseded revision could not be pruned." }]);
  });
  it('keeps portable plugin.json keyword coercion advisory', () => {
    const result = parseAgentPluginManifest({ value: { ...manifest('bridge', 'tovu/bridge'), keywords: ['repository', 4, ''] } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.manifest.keywords).toEqual(['repository']);
    expect(result.warnings).toEqual(['Plugin keywords must be an array of nonempty strings; invalid keywords were ignored.']);
  });

  it('requires the core peer version that exports the runtime identity entry', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'));
    // 0.4.3 added the runtime identity entry; the floor is now 0.4.9, the first core with ./provider-registry.
    expect(pkg.peerDependencies['@jini-ai/core']).toBe('^0.4.9');
    expect(pkg.peerDependenciesMeta['@jini-ai/core']?.optional).not.toBe(true);
  });

  it.each(['json', 'identity', 'missing'])('isolates a broken %s manifest during real publication', async kind => {
    const { layout, install, events } = await fixture();
    const broken = path.join(layout.forWorkspace({ workspaceId: 'site' }).pluginPackagesDir({ pluginId: 'broken' }), 'b'.repeat(64));
    await mkdir(broken, { recursive: true });
    if (kind !== 'missing') await writeFile(path.join(broken, 'plugin.json'), kind === 'json' ? '{' : JSON.stringify(manifest('broken', 'invalid')));
    const installed = await install('healthy', 'tovu/healthy');
    expect(installed.id).toBe('tovu/healthy');
    expect(JSON.parse(await readFile(path.join(installed.packageRoot, 'plugin.json'), 'utf8')).name).toBe('healthy');
    expect(events.filter(event => event.message.includes("Plugin 'broken'"))).toEqual([
      { event: 'agent-plugin-identity-warning', message: "Plugin 'broken': installed identity manifest is unreadable or invalid; omitted from identity admission." },
    ]);
    await expect(install('alias', 'tovu/healthy')).rejects.toMatchObject({ code: 'PLUGIN_ID_CONFLICT' });
    expect(await readdir(path.join(layout.forWorkspace({ workspaceId: 'site' }).staging))).toEqual([]);
  });

});
