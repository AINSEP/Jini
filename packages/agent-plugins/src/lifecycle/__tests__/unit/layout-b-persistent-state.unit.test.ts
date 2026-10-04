import { test, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createAgentPluginLayout } from '../../layout.js';
import { createInstallModule, type AgentPluginArchiveReaderPort } from '../../install.js';
import { createResolveAgentPluginRefsModule } from '../../resolve-agent-plugin-refs.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import { createUninstallModule } from '../../uninstall.js';
import { ports as defaultPorts } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

test('neutral lifecycle uses Layout B, never refreezes a deduplicated install, and preserves notes/data through update', async () => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jini-layout-b-')));
  const layout = createAgentPluginLayout({ root: temporary });
  const workspaceId = 'workspace-local';
  const workspace = layout.forWorkspace({ workspaceId });
  let freezeWrites = 0;
  const ports = { ...defaultPorts, layout, filesystem: { ...fs, chmod: (async (filename, mode) => {
    if (String(filename).includes('/package/sha256/')) freezeWrites++;
    return fs.chmod(filename, mode);
  }) as typeof fs.chmod } };
  const { installAgentPlugin } = createInstallModule(ports);
  const install = async (version: string) => {
    const archive = Buffer.from(version);
    const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
      for (const [entryPath, text] of [['plugin.json', JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example', version })], ['skills/example/SKILL.md', '# Example\nGuidance']]) {
        yield { kind: 'file', entryPath: entryPath!, async *openReadStream() { yield Buffer.from(text!); } };
      }
    } };
    return installAgentPlugin({ layout, workspaceId, archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex') });
  };
  try {
    const first = await install('1.0.0');
    expect(first.packageRoot).toBe(path.join(workspace.root, 'example', 'package', 'sha256', first.archiveDigest));
    const firstFreezeWrites = freezeWrites;
    expect(firstFreezeWrites).toBeGreaterThan(0);
    expect(await install('1.0.0')).toEqual(first);
    expect(freezeWrites).toBe(firstFreezeWrites);
    const memory = createPersistentStateModule(ports).memory({ workspaceRoot: workspace.root, pluginId: 'example' });
    await memory.writeNote({ entryPath: 'project.md', text: 'USER-CONTEXT' });
    await memory.learned.write({ entryPath: 'account.json', text: 'LEARNED-CACHE' });
    await fs.writeFile(path.join(workspace.pluginDataDir({ pluginId: 'example' }), 'cache'), 'STATE');
    await install('2.0.0');
    expect(await memory.read({ kind: 'notes', entryPath: 'project.md' })).toBe('USER-CONTEXT');
    expect(await memory.learned.read({ entryPath: 'account.json' })).toBe('LEARNED-CACHE');
    expect(await fs.readFile(path.join(workspace.pluginDataDir({ pluginId: 'example' }), 'cache'), 'utf8')).toBe('STATE');
    const refs = createResolveAgentPluginRefsModule(ports);
    expect(await refs.listInstalledPlugins(workspace.root)).toHaveLength(2);
    const uninstall = createUninstallModule(ports);
    const request = { layout, workspaceId, pluginId: 'example' };
    await uninstall.uninstallAgentPlugin(request);
    expect(await refs.listInstalledPlugins(workspace.root)).toEqual([]);
    expect(await memory.read({ kind: 'notes', entryPath: 'project.md' })).toBe('USER-CONTEXT');
    await install('2.0.0');
    const resolved = await refs.resolveAgentPluginRefs(['example'], workspace, 'inject');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) { expect(resolved.promptPrefix).toContain('USER-CONTEXT'); expect(resolved.promptPrefix).not.toContain('LEARNED-CACHE'); }
    const preview = await uninstall.previewAgentPluginUninstall(request);
    await uninstall.uninstallAgentPlugin(request, { confirmedPreview: preview, deleteMemory: true });
    await expect(fs.stat(workspace.pluginRootDir({ pluginId: 'example' }))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(temporary); }
});
