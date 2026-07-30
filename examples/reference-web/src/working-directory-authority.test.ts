import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPlaygroundWorkingDirectoryAuthority,
  isLoopbackAddress,
} from './working-directory-authority.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jini-cwd-authority-'));
  roots.push(root);
  const sample = join(root, 'examples/sample-projects/starter-site');
  const external = join(root, 'external');
  await mkdir(sample, { recursive: true });
  await mkdir(external);
  const canonicalSample = await realpath(sample);
  const canonicalExternal = await realpath(external);
  return {
    root,
    sample,
    external,
    canonicalSample,
    canonicalExternal,
    authority: await createPlaygroundWorkingDirectoryAuthority({
      repoRoot: root,
      projects: new Set(['starter-site']),
      grantSecret: 'test-secret',
    }),
  };
}

describe('playground working-directory authority', () => {
  it('recognizes only direct loopback socket addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.2')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
  it('allows declared samples but rejects forged absolute and relative paths', async () => {
    const {
      authority,
      canonicalSample,
      canonicalExternal,
      external,
    } = await fixture();
    await expect(authority.resolveForRun(undefined, 'starter-site')).resolves.toBe(canonicalSample);
    await expect(authority.resolveForRun(
      'examples/sample-projects/starter-site',
      'starter-site',
    )).resolves.toBe(canonicalSample);
    await expect(authority.resolveForRun(external, 'starter-site'))
      .rejects.toThrow('has not been approved');
    await expect(authority.resolveForRun('external', 'starter-site'))
      .rejects.toThrow('has not been approved');
  });

  it('accepts only secret-protected canonical grants and keeps them multi-use', async () => {
    const { authority, canonicalExternal, external } = await fixture();
    await expect(authority.grant(external, 'wrong')).rejects.toThrow('grant denied');
    await expect(authority.grant(external, 'test-secret')).resolves.toBe(canonicalExternal);
    await expect(authority.resolveForRun(external, 'starter-site')).resolves.toBe(canonicalExternal);
    await expect(authority.resolveForRun(external, 'starter-site')).resolves.toBe(canonicalExternal);
  });

  it('rejects a selected symlink after its target changes', async () => {
    const { authority, root, external } = await fixture();
    const other = join(root, 'other');
    const link = join(root, 'selected-link');
    await mkdir(other);
    await symlink(external, link);
    await authority.grant(link, 'test-secret');
    await rm(link);
    await symlink(other, link);

    await expect(authority.resolveForRun(link, 'starter-site'))
      .rejects.toThrow('has not been approved');
  });
});
