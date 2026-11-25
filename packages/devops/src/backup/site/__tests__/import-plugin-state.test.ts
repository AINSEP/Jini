import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentPluginLayout } from '@jini-ai/core/contracts/headless/plugin-host';
import { restoreImportedPluginState, type ImportPluginStateDeps, type ImportedArchivePlugin } from '../import-plugin-state.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const plugin = (id: string, digest: string, enabled: boolean, kind = 'agent'): ImportedArchivePlugin => ({ kind, id, digest, enabled });

interface Harness { root: string; dir: string; calls: string[]; activations: Map<string, boolean>; deps: ImportPluginStateDeps; layout: AgentPluginLayout }
async function harness(installed: { pluginId: string; archiveDigest?: string }[], soon: string[] = [], validatePath: (r: { path: string }) => void = () => {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-state-'));
  const dir = await mkdtemp(path.join(tmpdir(), 'plugin-dest-'));
  dirs.push(root, dir);
  const calls: string[] = [], activations = new Map<string, boolean>();
  const layout = { forWorkspace: ({ workspaceId }: { workspaceId: string }) => ({ root: `/ws/${workspaceId}`, pluginMemoryDir: ({ pluginId, kind }: { pluginId: string; kind: string }) => path.join(dir, 'mem', pluginId, kind) }) } as unknown as AgentPluginLayout;
  const deps: ImportPluginStateDeps = {
    sourceRoot: '/bundled',
    starterWorkspaceId: () => 'ws-starter',
    validatePath,
    createLifecycle: ({ sourceRoot }) => ({
      soonCatalog: { sourceRoot },
      seedBundledAgentPlugins: async required => { calls.push(`seed:${required.workspaceId}:${required.sourceRoot}`); },
      listInstalledPlugins: async ({ workspaceRoot }) => { calls.push(`list:${workspaceRoot}`); return installed; },
      setAgentPluginActivation: async ({ pluginId, enabled, actor }) => { calls.push(`set:${pluginId}:${actor}`); activations.set(pluginId, enabled); },
    }),
    findSoonAgentPlugin: async ({ catalog, pluginId }) => { expect(catalog).toEqual({ sourceRoot: '/bundled' }); return soon.includes(pluginId); },
  };
  return { root, dir, calls, activations, deps, layout };
}

describe('restoreImportedPluginState', () => {
  it('does nothing for an archive without agent plugins', async () => {
    const h = await harness([]);
    const placed = await restoreImportedPluginState({ root: h.root, dir: h.dir, layout: h.layout, files: [], deps: h.deps, state: { plugins: [plugin('s', 'd', true, 'site')], trustedPlugins: [], modified: [] } });
    expect(placed.size).toBe(0);
    expect(h.calls).toEqual([]);
    expect(existsSync(path.join(h.root, '.archive-state.json'))).toBe(false);
  });

  it('carries activation by id: trusted+enabled on, untrusted/edited off, other-digest unedited by id, Soon locked off', async () => {
    const h = await harness([
      { pluginId: 'same', archiveDigest: 'd1' }, { pluginId: 'untrusted', archiveDigest: 'd2' }, { pluginId: 'moved-on', archiveDigest: 'new' },
      { pluginId: 'moved-off', archiveDigest: 'new' }, { pluginId: 'edited', archiveDigest: 'new' }, { pluginId: 'locked', archiveDigest: 'd6' },
    ], ['locked']);
    const all = [plugin('same', 'd1', true), plugin('untrusted', 'd2', true), plugin('moved-on', 'old', true), plugin('moved-off', 'old', false), plugin('edited', 'old', true), plugin('locked', 'd6', true), plugin('absent', 'd7', true)];
    await restoreImportedPluginState({ root: h.root, dir: h.dir, layout: h.layout, files: [], deps: h.deps, state: { plugins: all, trustedPlugins: [all[0]!, all[5]!], modified: ['agent-plugins/edited'], keptOff: ['agent-plugins/same', 'agent-plugins/untrusted'] } });
    expect(Object.fromEntries(h.activations)).toEqual({ same: true, untrusted: false, 'moved-on': true, 'moved-off': false, edited: false, locked: false, absent: false });
    expect(h.calls.slice(0, 2)).toEqual(['seed:ws-starter:/bundled', 'list:/ws/ws-starter']);
    expect(h.calls).toContain('set:same:system:import');
    const written = JSON.parse(await readFile(path.join(h.root, '.archive-state.json'), 'utf8'));
    expect(written.keptOff).toEqual(['agent-plugins/untrusted']);
  });

  it('places imported memory only for installed plugins, through the injected path policy', async () => {
    const seen: string[] = [];
    const h = await harness([{ pluginId: 'p1', archiveDigest: 'd' }], [], ({ path: p }) => { seen.push(p); });
    const files = ['agent-plugins/p1/memory/notes/a.md', 'agent-plugins/p1/memory/learned/deep/b.md', 'agent-plugins/other/memory/notes/c.md', 'agent-plugins/p1/package/x.js'];
    for (const file of files) { await mkdir(path.dirname(path.join(h.root, file)), { recursive: true }); await writeFile(path.join(h.root, file), file); }
    const p = plugin('p1', 'd', true);
    const placed = await restoreImportedPluginState({ root: h.root, dir: h.dir, layout: h.layout, files, deps: h.deps, state: { plugins: [p], trustedPlugins: [p], modified: [] } });
    expect([...placed].sort()).toEqual(['agent-plugins/p1/memory/learned/deep/b.md', 'agent-plugins/p1/memory/notes/a.md']);
    expect(await readFile(path.join(h.dir, 'mem/p1/notes/a.md'), 'utf8')).toBe(files[0]);
    expect(await readFile(path.join(h.dir, 'mem/p1/learned/deep/b.md'), 'utf8')).toBe(files[1]);
    expect(seen).toEqual(['mem/p1/notes/a.md', 'mem/p1/learned/deep/b.md']);
  });
});
