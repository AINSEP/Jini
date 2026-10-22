import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalFsObjectStore, createLocalFsObjectStoreProvider } from '../object-store/index.js';

const bytes = (text: string) => new TextEncoder().encode(text);
const LONG = 'x'.repeat(300); // ENAMETOOLONG: a real fault that is neither absence nor occupancy

describe('createLocalFsObjectStore', () => {
  let rootDir: string;
  beforeEach(() => { rootDir = mkdtempSync(join(tmpdir(), 'jini-object-store-')); });
  afterEach(() => { rmSync(rootDir, { recursive: true, force: true }); });

  it('writes at join(rootDir, key) — the LocalFsBlobStore path formula — and reads it back', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    const key = 'ws/w1/blobs/ab/abcdef';
    expect(await store.put({ key, bytes: bytes('one') })).toEqual({ written: true });
    expect(readFileSync(join(rootDir, key), 'utf8')).toBe('one');
    expect(new TextDecoder().decode((await store.get({ key }))!)).toBe('one');
    expect(await store.get({ key })).toBeInstanceOf(Uint8Array);
    expect(await store.head({ key })).toEqual({ size: 3 });
    expect(await store.put({ key, bytes: bytes('two!') })).toEqual({ written: true });
    expect(await store.head({ key })).toEqual({ size: 4 });
    expect(store.publicAccess).toBeUndefined();
  });

  it('ifAbsent creates once and leaves an occupied key untouched', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    expect(await store.put({ key: 'a/b', bytes: bytes('first') }, { ifAbsent: true })).toEqual({ written: true });
    expect(await store.put({ key: 'a/b', bytes: bytes('second') }, { ifAbsent: true })).toEqual({ written: false });
    expect(readFileSync(join(rootDir, 'a/b'), 'utf8')).toBe('first');
  });

  it('absence is null; delete is idempotent', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    expect(await store.get({ key: 'missing' })).toBeNull();
    expect(await store.head({ key: 'missing' })).toBeNull();
    await store.delete({ key: 'missing' });
    writeFileSync(join(rootDir, 'present'), 'x');
    await store.delete({ key: 'present' });
    expect(await store.head({ key: 'present' })).toBeNull();
  });

  it('other filesystem faults reject instead of reading as absence or occupancy', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    await expect(store.put({ key: LONG, bytes: bytes('x') }, { ifAbsent: true })).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
    await expect(store.get({ key: LONG })).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
    await expect(store.head({ key: LONG })).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
  });

  it('refuses keys that escape the root before touching the filesystem', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    for (const key of ['../outside', 'a/../../outside', '', '.', '/etc/passwd']) {
      await expect(store.get({ key })).rejects.toThrow(/outside the store root/);
    }
  });

  describe('physical containment (symlinks)', () => {
    let outside: string;
    beforeEach(() => { outside = mkdtempSync(join(tmpdir(), 'jini-object-store-outside-')); });
    afterEach(() => { rmSync(outside, { recursive: true, force: true }); });

    it('refuses every operation through a directory symlink that points outside the root', async () => {
      writeFileSync(join(outside, 'victim'), 'secret');
      symlinkSync(outside, join(rootDir, 'link'));
      const store = createLocalFsObjectStore({ rootDir });
      await expect(store.get({ key: 'link/victim' })).rejects.toThrow(/outside the store root/);
      await expect(store.head({ key: 'link/victim' })).rejects.toThrow(/outside the store root/);
      await expect(store.put({ key: 'link/victim', bytes: bytes('pwned') })).rejects.toThrow(/outside the store root/);
      await expect(store.put({ key: 'link/new/deep', bytes: bytes('pwned') })).rejects.toThrow(/outside the store root/);
      await expect(store.delete({ key: 'link/victim' })).rejects.toThrow(/outside the store root/);
      expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('secret');
      expect(existsSync(join(outside, 'new'))).toBe(false);
    });

    it('refuses to read, stat or write through a final-component file symlink', async () => {
      writeFileSync(join(outside, 'victim'), 'secret');
      symlinkSync(join(outside, 'victim'), join(rootDir, 'alias'));
      const store = createLocalFsObjectStore({ rootDir });
      await expect(store.get({ key: 'alias' })).rejects.toMatchObject({ code: 'ELOOP' });
      await expect(store.head({ key: 'alias' })).rejects.toThrow(/symbolic link/);
      await expect(store.put({ key: 'alias', bytes: bytes('pwned') })).rejects.toMatchObject({ code: 'ELOOP' });
      expect(await store.put({ key: 'alias', bytes: bytes('pwned') }, { ifAbsent: true })).toEqual({ written: false });
      expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('secret');
      await store.delete({ key: 'alias' });
      expect(existsSync(join(rootDir, 'alias'))).toBe(false);
      expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('secret');
    });

    it('accepts symlinks that stay inside the root, including a symlinked root', async () => {
      mkdirSync(join(rootDir, 'real'));
      symlinkSync(join(rootDir, 'real'), join(rootDir, 'inner'));
      const viaLink = join(outside, 'root-link');
      symlinkSync(rootDir, viaLink);
      const store = createLocalFsObjectStore({ rootDir: viaLink });
      expect(await store.put({ key: 'inner/a/b', bytes: bytes('ok') })).toEqual({ written: true });
      expect(readFileSync(join(rootDir, 'real/a/b'), 'utf8')).toBe('ok');
      expect(await store.head({ key: 'inner/a/b' })).toEqual({ size: 2 });
      expect(lstatSync(viaLink).isSymbolicLink()).toBe(true);
    });

    it('creates a root that does not exist yet', async () => {
      const store = createLocalFsObjectStore({ rootDir: join(rootDir, 'not', 'yet') });
      expect(await store.put({ key: 'k', bytes: bytes('v') })).toEqual({ written: true });
      expect(readFileSync(join(rootDir, 'not/yet/k'), 'utf8')).toBe('v');
    });

    it('a non-directory ancestor rejects with its real errno, not as absence', async () => {
      writeFileSync(join(rootDir, 'file'), 'x');
      const store = createLocalFsObjectStore({ rootDir });
      await expect(store.get({ key: 'file/child/grandchild' })).rejects.toMatchObject({ code: 'ENOTDIR' });
    });
  });

  it('the local provider binds the root and ignores settings', async () => {
    const provider = createLocalFsObjectStoreProvider({ rootDir });
    const created = provider.create({ settings: { bucket: 'ignored' }, host: {} });
    expect(created.status).toBe('ok');
    if (created.status !== 'ok') return;
    await created.value.put({ key: 'k', bytes: bytes('v') });
    expect(readFileSync(join(rootDir, 'k'), 'utf8')).toBe('v');
  });
});
