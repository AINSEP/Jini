/** `listInstalledPackageRoots()` — which on-disk folders count as installed revisions. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listInstalledPackageRoots } from '../../installed-package-roots.js';
import type { AgentPluginLifecyclePorts, FilesystemPort } from '../../ports.js';
import { forceRemove } from '../fixtures/force-remove.js';
import { ports } from '../test-support.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await forceRemove(root); });

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'jini-package-roots-')));
  roots.push(root);
  return root;
}
async function revision(workspaceRoot: string, localId: string, digest: string): Promise<string> {
  const packageRoot = path.join(workspaceRoot, localId, 'package', 'sha256', digest);
  await mkdir(packageRoot, { recursive: true });
  return packageRoot;
}

describe('listInstalledPackageRoots', () => {
  it('treats a missing store as empty', async () => {
    const workspaceRoot = path.join(await workspace(), 'absent');
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('propagates a store fault other than a missing directory', async () => {
    const workspaceRoot = path.join(await workspace(), 'file');
    await writeFile(workspaceRoot, '');
    await expect(listInstalledPackageRoots({ ports, workspaceRoot })).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('lists a contained revision with its local id, digest and package root', async () => {
    const workspaceRoot = await workspace();
    const packageRoot = await revision(workspaceRoot, 'my-plugin', DIGEST_A);
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([{ localId: 'my-plugin', archiveDigest: DIGEST_A, packageRoot }]);
  });

  it('skips a top-level file', async () => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, 'activations.json'), '{}');
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('skips a folder whose name is not a plugin id', async () => {
    const workspaceRoot = await workspace();
    await revision(workspaceRoot, 'Not_An_Id', DIGEST_A);
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('skips a folder name longer than 64 characters', async () => {
    const workspaceRoot = await workspace();
    await revision(workspaceRoot, 'a'.repeat(65), DIGEST_A);
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('skips a memory-only folder with no package store', async () => {
    const workspaceRoot = await workspace();
    await mkdir(path.join(workspaceRoot, 'memory-only', 'data'), { recursive: true });
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('skips store entries that are not digest directories', async () => {
    const workspaceRoot = await workspace();
    const store = path.dirname(await revision(workspaceRoot, 'my-plugin', 'not-a-digest'));
    await writeFile(path.join(store, DIGEST_B), '');
    expect(await listInstalledPackageRoots({ ports, workspaceRoot })).toEqual([]);
  });

  it('isolates a revision that resolves outside the workspace and still lists the others', async () => {
    const workspaceRoot = await workspace();
    await revision(workspaceRoot, 'my-plugin', DIGEST_A);
    const kept = await revision(workspaceRoot, 'my-plugin', DIGEST_B);
    const filesystem: FilesystemPort = { ...ports.filesystem };
    const original = ports.filesystem.realpath;
    vi.spyOn(filesystem, 'realpath').mockImplementation(async (target: Parameters<FilesystemPort['realpath']>[0]) => {
      // As if the revision were swapped for a symlink out of the workspace after the listing.
      if (String(target).endsWith(DIGEST_A)) return path.join(tmpdir(), 'elsewhere');
      return original(target);
    });
    const faulty: AgentPluginLifecyclePorts = { ...ports, filesystem };
    expect(await listInstalledPackageRoots({ ports: faulty, workspaceRoot })).toEqual([{ localId: 'my-plugin', archiveDigest: DIGEST_B, packageRoot: kept }]);
  });
});
