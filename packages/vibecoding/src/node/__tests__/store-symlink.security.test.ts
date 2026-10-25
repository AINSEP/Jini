/**
 * @file Writes never follow links: a revision that writes through an in-root symlinked FILE or an
 * in-root symlinked PARENT directory is refused with INVALID_PATH and the link target is untouched,
 * even though path containment alone would allow the alias (it stays inside the root). Pins the
 * behaviour behind L10 Stryker survivors node/store.ts:72 (`info.isSymbolicLink()`) and :318
 * (`refuseSymlink`). Both mutants are equivalent on POSIX and stay alive: `lstat` of a link is
 * neither a file nor a directory, so the special-file arm refuses it too, and `regularPath` refuses
 * before the atomic writer's `refuseSymlink` flag is reached (that flag only matters in a race).
 * Real temp folders.
 */
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createProjectPaths, projectLimits } from '../paths.js';
import { createProjectStore } from '../store.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const bytes = (value: string) => new TextEncoder().encode(value);

async function project() {
  const base = await fs.mkdtemp(join(tmpdir(), 'vibe-symlink-')); roots.push(base);
  const root = join(base, 'app'), stateDir = join(base, 'state');
  await fs.mkdir(join(root, 'real'), { recursive: true }); await fs.mkdir(stateDir);
  await fs.writeFile(join(root, 'real/target.txt'), 'original');
  const limits = projectLimits({}), paths = createProjectPaths({ root, limits, policy: { allows: () => true } });
  const store = createProjectStore({ root, stateDir, paths, limits });
  const initial = await store.locked(async () => {
    const scanned = await store.scan({ current: null });
    const revisionId = await store.prepare({ files: scanned.files });
    return store.select({ current: null, revisionId, captured: scanned.observed });
  });
  const write = (files: Map<string, Uint8Array>) => store.locked(async () => {
    const revisionId = await store.prepare({ files });
    return store.select({ current: initial, revisionId });
  });
  return { root, write };
}

test('a write through an in-root symlinked file is refused and its target is untouched', async () => {
  const { root, write } = await project();
  await fs.symlink(join(root, 'real/target.txt'), join(root, 'alias.txt'));
  await expect(write(new Map([['real/target.txt', bytes('original')], ['alias.txt', bytes('hijack')]])))
    .rejects.toMatchObject({ code: 'INVALID_PATH', message: 'link or special file refused: alias.txt' });
  expect(await fs.readFile(join(root, 'real/target.txt'), 'utf8')).toBe('original');
});

test('a write under an in-root symlinked parent directory is refused and nothing lands in the target', async () => {
  const { root, write } = await project();
  await fs.symlink(join(root, 'real'), join(root, 'aliasdir'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(write(new Map([['real/target.txt', bytes('original')], ['aliasdir/new.txt', bytes('hijack')]])))
    .rejects.toMatchObject({ code: 'INVALID_PATH', message: 'link or special file refused: aliasdir/new.txt' });
  await expect(fs.stat(join(root, 'real/new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('the same writes through plain files and folders succeed', async () => {
  const { root, write } = await project();
  await write(new Map([['real/target.txt', bytes('changed')], ['plain/new.txt', bytes('new')]]));
  expect(await fs.readFile(join(root, 'real/target.txt'), 'utf8')).toBe('changed');
  expect(await fs.readFile(join(root, 'plain/new.txt'), 'utf8')).toBe('new');
});
