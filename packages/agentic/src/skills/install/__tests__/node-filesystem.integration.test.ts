import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSkillFilesystem } from '../node-filesystem.js';

describe('node skill filesystem adapter (real temporary directory)', () => {
  const filesystem = createNodeSkillFilesystem({});
  let root = '';
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'skill-fs-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('classifies files, directories, symlinks and other node types without following links', async () => {
    await writeFile(path.join(root, 'SKILL.md'), 'guidance');
    await mkdir(path.join(root, 'refs'));
    await symlink(path.join(root, 'SKILL.md'), path.join(root, 'link.md'));
    expect(await filesystem.lstat({ path: path.join(root, 'SKILL.md') })).toEqual({ kind: 'file', size: 8 });
    expect((await filesystem.lstat({ path: path.join(root, 'refs') })).kind).toBe('directory');
    expect((await filesystem.lstat({ path: path.join(root, 'link.md') })).kind).toBe('symlink');
    expect((await filesystem.lstat({ path: '/dev/null' })).kind).toBe('other');
  });

  it('refuses to read a directory or a file larger than the record limit', async () => {
    await mkdir(path.join(root, 'refs'));
    await writeFile(path.join(root, 'state.json'), '0123456789');
    await expect(filesystem.readFile({ path: path.join(root, 'refs'), maxBytes: 64 })).rejects.toThrow('Invalid skill installation record.');
    await expect(filesystem.readFile({ path: path.join(root, 'state.json'), maxBytes: 9 })).rejects.toThrow('Invalid skill installation record.');
    expect(Buffer.from(await filesystem.readFile({ path: path.join(root, 'state.json'), maxBytes: 10 })).toString()).toBe('0123456789');
  });

  // Virtual files report size 0 yet stream content; the byte count read, not the stat, is the bound.
  it.runIf(existsSync('/proc/self/status'))('bounds a file whose reported size understates its contents', async () => {
    await expect(filesystem.readFile({ path: '/proc/self/status', maxBytes: 16 })).rejects.toThrow('Invalid skill installation record.');
  });

  it('creates files exclusively and never overwrites an existing one', async () => {
    const target = path.join(root, 'state.json');
    await filesystem.writeFile({ path: target, bytes: Buffer.from('{"enabled":true}'), exclusive: true, mode: 0o600 });
    await expect(filesystem.writeFile({ path: target, bytes: Buffer.from('{}'), exclusive: true, mode: 0o600 })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(target, 'utf8')).toBe('{"enabled":true}');
  });
});
