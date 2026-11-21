/**
 * @file Non-ENOENT / non-ESRCH faults are never swallowed, whatever their shape (string, null, an
 * object without `code`, EACCES), and the installed-revision folder grammar at its edges (digest
 * anchors, local-id anchors, local-id length 64/65). Closes Stryker run-2 pattern 3 survivors at
 * installed-package-roots.ts:8,34,71 and node.ts:16,20,30.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listInstalledPackageRoots } from '../../installed-package-roots.js';
import type { AgentPluginLifecyclePorts, FilesystemPort } from '../../ports.js';
import { forceRemove } from '../fixtures/force-remove.js';
import { ports } from '../test-support.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await forceRemove(root); });

describe('listInstalledPackageRoots: only ENOENT means "no store"', () => {
  const failing = (thrown: unknown): AgentPluginLifecyclePorts => ({
    ...ports, filesystem: { ...ports.filesystem, readdir: (async () => { throw thrown; }) as unknown as FilesystemPort['readdir'] },
  });
  test.each<[string, unknown]>([
    ['a string', 'disk on fire'], ['null', null], ['an object without code', { message: 'x' }],
    ['EACCES', Object.assign(new Error('denied'), { code: 'EACCES' })], ['a numeric code', { code: 2 }],
  ])('%s propagates unchanged', async (_name, thrown) => {
    await expect(listInstalledPackageRoots({ ports: failing(thrown), workspaceRoot: '/ws' })).rejects.toBe(thrown);
  });
  test('ENOENT is an empty store', async () => {
    await expect(listInstalledPackageRoots({ ports: failing(Object.assign(new Error('gone'), { code: 'ENOENT' })), workspaceRoot: '/ws' })).resolves.toEqual([]);
  });
});

describe('installed revision folder grammar', () => {
  test('digest folders must be exactly 64 lowercase hex; local ids are anchored and at most 64 chars', async () => {
    const workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'jini-grammar-')));
    roots.push(workspaceRoot);
    const digest = 'a'.repeat(64);
    const make = (localId: string, name: string) => mkdir(path.join(workspaceRoot, localId, 'package', 'sha256', name), { recursive: true });
    await make('ok', digest);
    await make('ok', `${digest}0`);
    await make('ok', `0${digest}`);
    await make('ok', 'A'.repeat(64));
    await make('x'.repeat(64), digest);
    await make('x'.repeat(65), digest);
    await make('bad_', digest);
    await make('_bad', digest);
    const listed = await listInstalledPackageRoots({ ports, workspaceRoot });
    expect(listed.map((root) => `${root.localId}/${root.archiveDigest}`).sort()).toEqual([`ok/${digest}`, `${'x'.repeat(64)}/${digest}`].sort());
  });
});
