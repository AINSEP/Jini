/**
 * @file Non-ENOENT / non-ESRCH faults are never swallowed, whatever their shape (string, null, an
 * object without `code`, EACCES), and the installed-revision folder grammar at its edges (digest
 * anchors, local-id anchors, local-id length 64/65). Closes Stryker run-2 pattern 3 survivors at
 * installed-package-roots.ts:8,34,71 and node.ts:16,20,30.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as nativeFilesystem from 'node:fs/promises';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listInstalledPackageRoots } from '../../installed-package-roots.js';
import { createNodeAgentPluginEffects } from '../../node.js';
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

describe('createNodeAgentPluginEffects', () => {
  test('uses an injected filesystem, else node:fs/promises', () => {
    const fake = { ...nativeFilesystem } as FilesystemPort;
    expect(createNodeAgentPluginEffects({}, { filesystem: fake }).filesystem).toBe(fake);
    expect(createNodeAgentPluginEffects({}).filesystem).toBe(nativeFilesystem);
  });

  // `clock.sleep` is pinned with a controlled timer in node-sleep.unit.test.ts (FU-B).

  test.each<[string, unknown, boolean]>([
    ['ESRCH (no such process)', Object.assign(new Error('x'), { code: 'ESRCH' }), false],
    ['EPERM (exists, not ours)', Object.assign(new Error('x'), { code: 'EPERM' }), true],
    ['a thrown string', 'odd', true], ['a thrown null', null, true], ['an object without code', {}, true],
  ])('isAlive when kill throws %s -> %s', (_name, thrown, alive) => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw thrown; });
    expect(createNodeAgentPluginEffects({}).process.isAlive({ pid: 12345 })).toBe(alive);
  });

  test.each([[0], [-1], [1.5], [Number.NaN]])('isAlive(%s) is false without signalling', (pid) => {
    const kill = vi.spyOn(process, 'kill');
    expect(createNodeAgentPluginEffects({}).process.isAlive({ pid })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});
