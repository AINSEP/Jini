import { createProjectPaths } from './filesystem.js';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { projectLimits } from '../paths.js';
import { createProjectStore, type StoreCheckpoint } from './filesystem.js';
import { openFileTreeProject } from './filesystem.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const bytes = (value: string) => new TextEncoder().encode(value);
test.each<StoreCheckpoint>(['objects', 'manifest', 'journal', 'delete', 'write', 'prune', 'clear'])(
  'reopen after crash at %s converges to the selected complete tree', async crashStep => {
    const base = await fs.mkdtemp(join(tmpdir(), 'vibe-recovery-')); roots.push(base);
    const root = join(base, 'app'), stateDir = join(base, 'state');
    await fs.mkdir(join(root, 'old'), { recursive: true }); await fs.mkdir(stateDir);
    await fs.writeFile(join(root, 'old/gone.txt'), 'old');
    await fs.writeFile(join(root, 'kept.txt'), 'before');
    const limits = projectLimits({}), paths = createProjectPaths({ root, limits, policy: { allows: () => true } });
    const input = { root, stateDir, paths, limits };
    const store = createProjectStore(input);
    const initial = await store.locked(async () => {
      const scanned = await store.scan({ current: null });
      const revisionId = await store.prepare({ files: scanned.files });
      return store.select({ current: null, revisionId, captured: scanned.observed });
    });
    let crashed = false;
    const broken = createProjectStore(input, { checkpoint: ({ step }) => {
      if (step === crashStep && !crashed) { crashed = true; throw new Error(`process died at ${step}`); }
    } });
    await expect(broken.locked(async () => {
      const revisionId = await broken.prepare({ files: new Map([['new/file.txt', bytes('new')], ['kept.txt', bytes('after')]]) });
      await broken.select({ current: initial, revisionId });
    })).rejects.toThrow(`process died at ${crashStep}`);
    const reopened = createProjectStore(input);
    const recovered = await reopened.locked(() => reopened.recover());
    expect(recovered?.pending).toBeNull();
    const committed = !['objects', 'manifest'].includes(crashStep);
    expect(await fs.readFile(join(root, 'kept.txt'), 'utf8')).toBe(committed ? 'after' : 'before');
    if (committed) {
      expect(await fs.readFile(join(root, 'new/file.txt'), 'utf8')).toBe('new');
      await expect(fs.stat(join(root, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
    } else expect(await fs.readFile(join(root, 'old/gone.txt'), 'utf8')).toBe('old');
    const second = await reopened.locked(() => reopened.recover());
    expect(second).toEqual(recovered);
  },
);
test('corrupt current metadata is never treated as a new empty project', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-corrupt-')); roots.push(base);
  const root = join(base, 'app'), stateDir = join(base, 'state');
  await fs.mkdir(root); await fs.mkdir(stateDir); await fs.writeFile(join(root, 'safe.txt'), 'safe');
  await fs.writeFile(join(stateDir, 'current.json'), 'null');
  const limits = projectLimits({}), paths = createProjectPaths({ root, limits, policy: { allows: () => true } });
  const store = createProjectStore({ root, stateDir, paths, limits });
  await expect(store.locked(() => store.recover())).rejects.toMatchObject({ code: 'CORRUPT' });
  expect(await fs.readFile(join(root, 'safe.txt'), 'utf8')).toBe('safe');
});
test('a corrupted selected object refuses reopen without overwriting working files', async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-object-')); roots.push(base);
  const input = { root: join(base, 'app'), stateDir: join(base, 'state'), policy: { allows: () => true } };
  await fs.mkdir(input.root); await fs.writeFile(join(input.root, 'safe.txt'), 'safe');
  await openFileTreeProject(input);
  const object = (await fs.readdir(join(input.stateDir, 'objects')))[0]!;
  await fs.writeFile(join(input.stateDir, 'objects', object), 'broken');
  await expect(openFileTreeProject(input)).rejects.toMatchObject({ code: 'CORRUPT' });
  expect(await fs.readFile(join(input.root, 'safe.txt'), 'utf8')).toBe('safe');
});
