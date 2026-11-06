import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JiniPackageEntry } from '../lib/pack-jini-packages.js';

const fixture = vi.hoisted(() => ({ archives: new Map<string, string>(), events: [] as string[],
  catalog: [{ id: 'packed-after-prepack', version: '1.0.1' }], guard: vi.fn() }));
vi.mock('../check-plugin-packages.js', () => ({ checkPluginReleaseConsistency: fixture.guard }));
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  execFileSync: vi.fn((command: string, args: string[], options?: { cwd?: string }) => {
    if (command === 'pnpm' && args[0] === 'pack') {
      const output = args[2]!;
      const name = options!.cwd!.split('/').at(-1)!;
      const archive = join(output, 'fixture.tgz');
      writeFileSync(archive, 'archive fixture');
      fixture.archives.set(archive, name);
      fixture.events.push(`pack:${name}`);
      return '';
    }
    if (command === 'tar' && args[0] === '-xzOf') {
      if (args[2] === 'package/catalog.json') return JSON.stringify(fixture.catalog);
      return JSON.stringify({ name: `@jini-ai/${fixture.archives.get(args[1]!)}`, version: '1.0.1' });
    }
    if (command === 'tar' && args[0] === '-tzf') return 'package/package.json\n';
    if (command === 'tar' && args[0] === '-xzf') return '';
    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  }),
}));
import { preparePluginRelease } from '../publish-pending.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-release-prepare-'));
  fixture.events.length = 0;
  fixture.guard.mockReset().mockImplementation(async () => { fixture.events.push('validate'); });
  const catalog = join(root, 'packages/plugin-catalog/catalog.json');
  mkdirSync(dirname(catalog), { recursive: true });
  writeFileSync(catalog, JSON.stringify([{ id: 'stale-before-prepack' }]));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const archive of fixture.archives.keys()) rmSync(dirname(archive), { recursive: true, force: true });
  fixture.archives.clear();
});

function release() {
  const names = ['@jini-ai/provider-plugins', '@jini-ai/agent-plugins', '@jini-ai/plugin-catalog'];
  const registry = new Map(names.map(name => [name, { dir: join(root, 'packages', name.slice('@jini-ai/'.length)),
    pkg: { name, version: '1.0.1' } } as JiniPackageEntry]));
  return { repoRoot: root, registry, pending: names };
}

it('validates the post-prepack catalog and prepared distribution archives after every hook finishes', async () => {
  const archives = await preparePluginRelease(release());
  expect(fixture.events).toEqual(['pack:provider-plugins', 'pack:agent-plugins', 'pack:plugin-catalog', 'validate']);
  const checked = fixture.guard.mock.calls[0]![0];
  expect(checked.entries).toEqual(fixture.catalog);
  expect([...checked.pendingPackages]).toEqual(['provider-plugins', 'agent-plugins'].map(name => [
    `@jini-ai/${name}@1.0.1`, join(dirname(archives.get(`@jini-ai/${name}`)!), 'package'),
  ]));
  expect([...archives.keys()]).toEqual(release().pending);
});

it('returns no uploadable release when the prepared catalog fails validation', async () => {
  fixture.guard.mockRejectedValue(new Error('Release catalog mismatch'));
  await expect(preparePluginRelease(release())).rejects.toThrow('Release catalog mismatch');
  expect(fixture.archives.size).toBe(3);
  // Unexpected commands (including npm/pnpm publish) throw above; preparation performs none.
});
