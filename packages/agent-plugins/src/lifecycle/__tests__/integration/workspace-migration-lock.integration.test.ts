import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withFileLock } from '@jini-ai/platform/fs/file-lock';
import { migratePluginLayout, withWorkspaceMigrationLock, type WorkspaceMigrationOwnership } from '../../../../core/persistent-state.js';
import { createAgentPluginLayout } from '../../layout.js';
import { createSeedBundledModule } from '../../seed-bundled.js';
import { createPersistentStateModule } from '../../persistent-state.js';
import type { AgentPluginLifecyclePorts } from '../../ports.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file One lock ordering for the workspace: the layout-migration lock is outermost. A caller that
 * holds it passes explicit ownership into the nested migration (seed's `migrateBeforeSeed` seam), which
 * then runs without acquiring it again; a direct migration still takes it. Real files, real file lock,
 * and a real legacy entry so the migration does work rather than a marker no-op.
 */

const DIGEST = 'd'.repeat(64);
const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-lock-')));
  temporaries.push(dir);
  return dir;
}
/** A workspace in the legacy layout: one package under `packages/sha256/<digest>`. */
async function legacyWorkspace(root: string): Promise<string> {
  const legacy = path.join(root, 'packages', 'sha256', DIGEST);
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'legacy-one' }));
  return legacy;
}
// Bounded so a reacquisition fails the test instead of hanging it.
const lock = <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }) => withFileLock({ lockPath, run }, { staleMs: Infinity, createParent: true, timeoutMs: 1500 });
const effects = { filesystem: fs, contain: async ({ root, entryPath }: { root: string; entryPath: string }) => path.resolve(root, entryPath), withLock: lock,
  parsePluginId: ({ value }: { value: unknown }) => (value as { name: string }).name };
const exists = (target: string) => fs.stat(target).then(() => true, () => false);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('workspace migration lock', () => {
  test('a second contender cannot enter migration work while the first owns the window, then proceeds', async () => {
    const workspaceRoot = await tempDir();
    const legacy = await legacyWorkspace(workspaceRoot);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const first = withWorkspaceMigrationLock({ ...effects, workspaceRoot, run: async () => { entered(); await gate; } });
    await inside;
    const second = migratePluginLayout({ ...effects, workspaceRoot });
    await sleep(300);
    expect(await exists(legacy)).toBe(true);
    expect(await exists(path.join(workspaceRoot, '.agent-plugin-layout-migrated'))).toBe(false);
    release();
    await first;
    expect(await second).toEqual({ complete: true, moved: 1 });
    expect(await exists(path.join(workspaceRoot, 'legacy-one', 'package', 'sha256', DIGEST))).toBe(true);
  });

  test('migration under explicitly passed ownership completes without reacquiring the held lock', async () => {
    const workspaceRoot = await tempDir();
    await legacyWorkspace(workspaceRoot);
    const result = await withWorkspaceMigrationLock({ ...effects, workspaceRoot, run: ({ ownership }) => migratePluginLayout({ ...effects, workspaceRoot }, { ownership }) });
    expect(result).toEqual({ complete: true, moved: 1 });
  });

  test('ownership of another workspace, or one already released, is refused before any move', async () => {
    const [workspaceRoot, other] = [await tempDir(), await tempDir()];
    const legacy = await legacyWorkspace(workspaceRoot);
    let stale: WorkspaceMigrationOwnership | undefined;
    await withWorkspaceMigrationLock({ ...effects, workspaceRoot: other, run: async ({ ownership }) => {
      stale = ownership;
      await expect(migratePluginLayout({ ...effects, workspaceRoot }, { ownership })).rejects.toThrow(/does not hold this workspace/);
    } });
    await expect(migratePluginLayout({ ...effects, workspaceRoot: other }, { ownership: stale! })).rejects.toThrow(/does not hold this workspace/);
    expect(await exists(legacy)).toBe(true);
  });
});

describe('seed under a held workspace lock', () => {
  async function sourceWith(...names: string[]): Promise<string> {
    const source = await tempDir();
    for (const name of names) {
      await fs.mkdir(path.join(source, name, 'skills', name), { recursive: true });
      await fs.writeFile(path.join(source, name, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name }));
      await fs.writeFile(path.join(source, name, 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }
    return source;
  }
  const boundedPorts = (overrides: Partial<AgentPluginLifecyclePorts>, layout: ReturnType<typeof createAgentPluginLayout>): AgentPluginLifecyclePorts => ({
    ...ports, layout, onEvent: () => undefined,
    fileLock: { ...ports.fileLock, withFileLock: (required, optional) => ports.fileLock.withFileLock(required, { ...optional, timeoutMs: 1500 }) },
    ...overrides,
  });

  test('the default nested migration runs under the caller ownership and seed completes', async () => {
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const workspaceRoot = layout.forWorkspace({ workspaceId: 'ws' }).root;
    await legacyWorkspace(workspaceRoot);
    const owned = boundedPorts({}, layout);
    const report = await createPersistentStateModule(owned).withWorkspaceLock({ workspaceRoot, run: ({ ownership }) =>
      createSeedBundledModule(owned).seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot: '/nonexistent-source' }, { ownership }) });
    expect(report.outcomes).toEqual([]);
    expect(await exists(path.join(workspaceRoot, 'legacy-one', 'package', 'sha256', DIGEST))).toBe(true);
  });

  test('the host migrateBeforeSeed seam receives the held ownership and runs the migration under it', async () => {
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const workspaceRoot = layout.forWorkspace({ workspaceId: 'ws' }).root;
    await legacyWorkspace(workspaceRoot);
    const seen: (WorkspaceMigrationOwnership | undefined)[] = [];
    const owned = boundedPorts({ migrateBeforeSeed: async (_required, { ownership } = {}) => {
      seen.push(ownership);
      return migratePluginLayout({ ...effects, workspaceRoot }, ownership ? { ownership } : {});
    } }, layout);
    const report = await withWorkspaceMigrationLock({ ...effects, workspaceRoot, run: ({ ownership }) =>
      createSeedBundledModule(owned).seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot: '/nonexistent-source' }, { ownership }) });
    expect(report.outcomes).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.isHeld()).toBe(false);
    expect(await exists(path.join(workspaceRoot, 'legacy-one', 'package', 'sha256', DIGEST))).toBe(true);
  });

  test('a held id never reaches install while unrelated ids seed as before', async () => {
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const source = await sourceWith('held-one', 'seeded-one');
    const report = await createSeedBundledModule(boundedPorts({}, layout)).seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot: source },
      { heldPluginIds: new Map([['held-one', 'its installed copy is not the one this build installed']]) });
    expect(report.outcomes.map(outcome => [outcome.pluginId, outcome.status])).toEqual([['held-one', 'failed'], ['seeded-one', 'seeded']]);
    expect(report.outcomes[0]).toMatchObject({ reason: 'its installed copy is not the one this build installed' });
    expect(await exists(layout.forWorkspace({ workspaceId: 'ws' }).pluginRootDir({ pluginId: 'held-one' }))).toBe(false);
  });
});
