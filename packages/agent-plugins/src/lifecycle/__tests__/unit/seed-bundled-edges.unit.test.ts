import { afterEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentPluginLayout } from '../../layout.js';
import { createSeedBundledModule } from '../../seed-bundled.js';
import { createBundledSourceArchiveModule } from '../../bundled-source-archive.js';
import type { PackingForSource, SeedBundledAgentPluginsOptional } from '../../seed-bundled.js';
import { BUNDLED_DIGESTS_FILENAME } from '../../bundled-digests.js';
import { ACTIVATIONS_FILENAME } from '../../activation.js';
import type { AgentPluginLifecyclePorts, FilesystemPort } from '../../ports.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * @file `seedBundledAgentPlugins` never throws: source discovery skips non-packages, and migration,
 * activation, per-plugin and ledger faults — including non-Error throws from an injected port —
 * become report entries.
 */

const temporaries: string[] = [];
afterEach(async () => { for (const dir of temporaries.splice(0)) await forceRemove(dir); });
async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'seed-edges-')));
  temporaries.push(dir);
  return dir;
}
async function sourceWithPlugin(): Promise<string> {
  const source = await tempDir();
  await fs.mkdir(path.join(source, 'seeded-one', 'skills', 'seeded-one'), { recursive: true });
  await fs.writeFile(path.join(source, 'seeded-one', 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'seeded-one' }));
  await fs.writeFile(path.join(source, 'seeded-one', 'skills', 'seeded-one', 'SKILL.md'), '# Seeded\n');
  return source;
}
async function seed(sourceRoot: string, overrides: Partial<AgentPluginLifecyclePorts> = {}) {
  const layout = createAgentPluginLayout({ root: await tempDir() });
  const { seedBundledAgentPlugins } = createSeedBundledModule({ ...ports, layout, onEvent: () => undefined, ...overrides });
  return { layout, report: await seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot }) };
}
function failingFs(match: (target: string) => boolean, thrown: unknown, method: 'open' | 'readdir'): FilesystemPort {
  const original = fs[method] as (...args: unknown[]) => Promise<unknown>;
  return { ...fs, [method]: async (target: string, ...rest: unknown[]) => {
    if (match(String(target))) throw thrown;
    return original(target, ...rest);
  } } as FilesystemPort;
}

describe('source discovery', () => {
  test('a missing source root seeds nothing', async () => {
    const { report } = await seed(path.join(await tempDir(), 'absent'));
    expect(report.outcomes).toEqual([]);
  });
  test('stray files and directories without plugin.json are skipped silently', async () => {
    const source = await sourceWithPlugin();
    await fs.writeFile(path.join(source, 'README.md'), '# not a plugin');
    await fs.mkdir(path.join(source, 'scratch'));
    const { report } = await seed(source);
    expect(report.outcomes.map(outcome => [outcome.pluginId, outcome.status])).toEqual([['seeded-one', 'seeded']]);
    expect(report.ledgerFailure).toBeUndefined();
  });
});

describe('faults become report entries', () => {
  test('a non-Error thrown by the host migration port fails every plugin with its text', async () => {
    const source = await sourceWithPlugin();
    const { report } = await seed(source, { migrateBeforeSeed: async () => { throw 'migration port offline'; } });
    expect(report).toEqual({ sourceRoot: source, outcomes: [{ pluginId: 'seeded-one', status: 'failed', reason: 'migration port offline' }], retirements: [] });
  });
  test('a non-Error activation-lock fault fails every plugin before any install', async () => {
    const source = await sourceWithPlugin();
    const { layout, report } = await seed(source, { filesystem: failingFs(target => target.endsWith(`${ACTIVATIONS_FILENAME}.lock`), 'lock device gone', 'open') });
    expect(report.outcomes).toEqual([{ pluginId: 'seeded-one', status: 'failed', reason: 'lock device gone' }]);
    await expect(fs.stat(layout.forWorkspace({ workspaceId: 'ws' }).pluginRootDir({ pluginId: 'seeded-one' }))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('a non-Error while packing one plugin fails only that plugin', async () => {
    const source = await sourceWithPlugin();
    const { report } = await seed(source, { filesystem: failingFs(target => target.endsWith(`${path.sep}seeded-one`), 'unreadable source', 'readdir') });
    expect(report.outcomes).toEqual([{ pluginId: 'seeded-one', status: 'failed', reason: 'unreadable source' }]);
  });
  test('a ledger write fault is reported while the seeded plugin stays seeded', async () => {
    const source = await sourceWithPlugin();
    const { report } = await seed(source, { filesystem: failingFs(target => target.includes(`${BUNDLED_DIGESTS_FILENAME}.tmp-`), new Error('ledger disk full'), 'open') });
    expect(report.outcomes.map(outcome => outcome.status)).toEqual(['seeded']);
    expect(report.ledgerFailure).toBe('ledger disk full');
  });
  test('a non-Error ledger write fault is rendered as text', async () => {
    const source = await sourceWithPlugin();
    const { report } = await seed(source, { filesystem: failingFs(target => target.includes(`${BUNDLED_DIGESTS_FILENAME}.tmp-`), 'ledger offline', 'open') });
    expect(report.ledgerFailure).toBe('ledger offline');
  });
  test('an unreadable activations file fails every plugin with the activation error message', async () => {
    const source = await sourceWithPlugin();
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const workspaceRoot = layout.forWorkspace({ workspaceId: 'ws' }).root;
    await fs.mkdir(path.join(workspaceRoot, ACTIVATIONS_FILENAME), { recursive: true });
    const { seedBundledAgentPlugins } = createSeedBundledModule({ ...ports, layout, onEvent: () => undefined });
    const report = await seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot: source });
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ pluginId: 'seeded-one', status: 'failed' });
    expect((report.outcomes[0] as { reason: string }).reason).toContain(`${ACTIVATIONS_FILENAME} could not be read (EISDIR`);
  });
});

describe('opt-in packing during seeding', () => {
  test.each(['shared', 'per-source'] as const)('%s canonical packing installs the paired snapshot and preserves activation and ledger behavior', async mode => {
    const sourceRoot = await sourceWithPlugin();
    const sourceDir = path.join(sourceRoot, 'seeded-one');
    await fs.writeFile(path.join(sourceDir, 'excluded.txt'), 'not installed');
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const packing = { digestEncoding: 'canonical-files-v1' as const, excludeNames: ['excluded.txt'] };
    const seen: { sourceDir: string; dirName: string }[] = [];
    const forSource: PackingForSource = async (required, optional) => {
      seen.push(required);
      expect(optional).toEqual({});
      return packing;
    };
    const optional: SeedBundledAgentPluginsOptional = { packing: mode === 'shared' ? packing : forSource };
    const context = { ...ports, layout, onEvent: () => undefined };
    const { seedBundledAgentPlugins } = createSeedBundledModule(context);
    const baseline = await createBundledSourceArchiveModule(context).packAgentPluginDirectory(sourceDir);
    const packed = await createBundledSourceArchiveModule(context).packAgentPluginDirectory(sourceDir, packing);
    expect(packed.sha256).not.toBe(baseline.sha256);
    const report = await seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot }, optional);
    expect(report.outcomes).toEqual([{ pluginId: 'seeded-one', status: 'seeded', archiveDigest: packed.sha256, activationRecorded: true }]);
    expect(report.ledgerFailure).toBeUndefined();
    expect(seen).toEqual(mode === 'shared' ? [] : [{ sourceDir, dirName: 'seeded-one' }]);
    const workspace = layout.forWorkspace({ workspaceId: 'ws' });
    const installed = path.join(workspace.pluginPackagesDir({ pluginId: 'seeded-one' }), packed.sha256);
    expect(await fs.readFile(path.join(installed, 'skills/seeded-one/SKILL.md'), 'utf8')).toBe('# Seeded\n');
    await expect(fs.stat(path.join(installed, 'excluded.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(workspace.root, BUNDLED_DIGESTS_FILENAME), 'utf8')).toContain(packed.sha256);
    expect(await fs.readFile(path.join(workspace.root, ACTIVATIONS_FILENAME), 'utf8')).toContain('"enabled": false');
    const repeated = await seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot }, optional);
    expect(repeated.outcomes).toEqual([{ pluginId: 'seeded-one', status: 'seeded', archiveDigest: packed.sha256, activationRecorded: false }]);
  });

  test('a failed per-source policy uses the existing per-plugin failure report', async () => {
    const sourceRoot = await sourceWithPlugin();
    const layout = createAgentPluginLayout({ root: await tempDir() });
    const api = createSeedBundledModule({ ...ports, layout });
    const report = await api.seedBundledAgentPlugins({ layout, workspaceId: 'ws', sourceRoot }, {
      packing: async () => { throw new Error('packing policy unavailable'); },
    });
    expect(report.outcomes).toEqual([{ pluginId: 'seeded-one', status: 'failed', reason: 'packing policy unavailable' }]);
  });
});
