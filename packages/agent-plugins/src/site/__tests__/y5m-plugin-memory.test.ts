import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { bindAgentPluginMemory } from '../plugin-memory.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await filesystem.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await filesystem.realpath(await filesystem.mkdtemp(path.join(os.tmpdir(), 'plugin-memory-')));
  roots.push(root);
  const layout = { root, forWorkspace: ({ workspaceId }: { workspaceId: string }) => {
    if (!/^[a-z]+$/.test(workspaceId)) throw new Error('invalid workspace');
    return { root: path.join(root, 'ws', workspaceId) };
  } } as Parameters<ReturnType<typeof bindAgentPluginMemory>['pluginMemory']>[0]['layout'];
  const invalidWorkspace = vi.fn();
  const siblingFailure = vi.fn();
  // A spied copy keeps readdir's overloads intact while recording the calls the lazy reader makes.
  const spiedFilesystem = { ...filesystem };
  const readdir = vi.spyOn(spiedFilesystem, 'readdir');
  const bound = bindAgentPluginMemory({
    filesystem: spiedFilesystem, withLock: async ({ run }) => run(),
    workspaceDirectory: ({ layout }) => path.join(layout.root, 'ws'),
    parseManifest: () => ({ ok: true, manifest: { name: 'sample' } }),
    onEvent: vi.fn(), invalidWorkspace, siblingFailure,
  });
  const contain = async ({ root, entryPath }: { root: string; entryPath: string }) => path.resolve(root, entryPath);
  return { root, layout, bound, contain, readdir, invalidWorkspace, siblingFailure };
}

it('migrates only the owned workspace without discovering siblings', async () => {
  const f = await fixture();
  await f.bound.withAgentPluginWorkspaceLock({ workspaceRoot: f.layout.forWorkspace({ workspaceId: 'active' }).root, run: async ({ ownership }) => {
    const before = f.readdir.mock.calls.length;
    await f.bound.migrateSiteAgentPluginLayouts({ layout: f.layout, workspaceId: 'active', contain: f.contain }, { ownership });
    expect(f.readdir.mock.calls.slice(before).some(([directory]) => directory === path.join(f.root, 'ws'))).toBe(false);
  } });
});

it('validates legacy directories, skips files and isolates sibling failures', async () => {
  const f = await fixture();
  await filesystem.mkdir(path.join(f.root, 'ws', 'bad-id'), { recursive: true });
  await filesystem.mkdir(path.join(f.root, 'ws', 'broken'), { recursive: true });
  await filesystem.mkdir(path.join(f.root, 'ws', 'good'), { recursive: true });
  await filesystem.writeFile(path.join(f.root, 'ws', 'file'), '');
  const visited: string[] = [];
  const contain = async (input: { root: string; entryPath: string }) => {
    visited.push(input.root);
    if (input.root.endsWith('/broken')) throw new Error('broken sibling');
    return f.contain(input);
  };
  await f.bound.migrateSiblingAgentPluginLayouts({ layout: f.layout, workspaceId: 'active', contain });
  expect(f.invalidWorkspace).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'bad-id' }));
  expect(f.siblingFailure).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'broken' }));
  expect(visited.some(root => root.endsWith('/good'))).toBe(true);
  expect(visited.some(root => root.endsWith('/file'))).toBe(false);
});

it('propagates unrecognized discovery errors', async () => {
  const f = await fixture();
  const error = Object.assign(new Error('denied'), { code: 'EACCES' });
  f.readdir.mockRejectedValueOnce(error);
  await expect(f.bound.migrateSiteAgentPluginLayouts({ layout: f.layout, workspaceId: 'active', contain: f.contain })).rejects.toBe(error);
});

it('preserves exact note delimiters and JSON quoting', async () => {
  const f = await fixture();
  const input = { layout: f.layout, workspaceId: 'active', pluginId: 'sample', contain: f.contain };
  const memory = f.bound.pluginMemory(input);
  const required = { workspaceRoot: f.layout.forWorkspace({ workspaceId: 'active' }).root, pluginId: 'sample', contain: f.contain, guidance: 'Guidance' };
  expect(await f.bound.appendPluginNotes(required)).toBe('Guidance');
  await memory.writeNote({ entryPath: 'note.txt', text: 'a "quote"\nline' });
  expect(await f.bound.appendPluginNotes(required)).toBe('Guidance\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n' + JSON.stringify([{ relativePath: 'note.txt', text: 'a "quote"\nline' }]));
});

it('uses canonical plugin state ownership for contained files and preserves the lock result', async () => {
  const f = await fixture();
  const workspaceRoot = f.layout.forWorkspace({ workspaceId: 'active' }).root;
  await filesystem.mkdir(path.join(workspaceRoot, 'sample', 'data'), { recursive: true });
  const entryPath = 'sample/data/cache.json';
  const canonical = path.join(workspaceRoot, entryPath);
  await filesystem.writeFile(canonical, 'cache-value');
  const scoped = f.bound.assertOwnedPluginPath({ contain: f.contain, workspaceRoot, entryPath });
  expect(await scoped).toBe(canonical);
  await expect(f.bound.withAgentPluginStateLock({ contain: f.contain, workspaceRoot, pluginId: 'sample',
    run: () => filesystem.readFile(canonical, 'utf8'),
  })).resolves.toBe('cache-value');
  await expect(f.bound.migrateSiteAgentPluginLayouts({ contain: f.contain, layout: f.layout, workspaceId: 'active' }))
    .resolves.toEqual({ complete: true, moved: 0 });
  expect(JSON.parse(await filesystem.readFile(path.join(workspaceRoot, '.agent-plugin-layout-migrated'), 'utf8'))).toEqual({ layoutVersion: 2 });
});
