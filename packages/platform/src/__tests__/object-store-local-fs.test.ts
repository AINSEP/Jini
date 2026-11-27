import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('local staged writes', () => {
  const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const chunks = async function* () { yield bytes('he'); yield bytes('llo'); };

  let rootDir: string;
  beforeEach(() => { rootDir = mkdtempSync(join(tmpdir(), 'jini-staged-object-')); });
  afterEach(() => { rmSync(rootDir, { recursive: true, force: true }); });

  it('does not replace the previous object until all chunks pass verification', async () => {
    const store = createLocalFsObjectStore({ rootDir });
    const writer = await store.resolveStagedWriter?.({});
    if (!writer) throw new Error('Local store did not supply a staged writer');
    await store.put({ key: 'file', bytes: bytes('old') });
    const signal = new AbortController().signal;
    await writer({ key: 'file', byteLength: 5, sha256, openChunks: async function* (input, options) {
      expect(input).toEqual({});
      expect(options).toEqual({ signal });
      yield bytes('he');
      expect(await store.get({ key: 'file' })).toEqual(bytes('old'));
      yield bytes('llo');
    } }, { signal });
    expect(await store.get({ key: 'file' })).toEqual(bytes('hello'));
    expect(await store.head({ key: 'file' })).toEqual({ size: 5 });
    expect(readdirSync(rootDir)).toEqual(['file']);
  });

  it.each([
    { byteLength: 4, digest: sha256, message: 'staged object length mismatch' },
    { byteLength: 6, digest: sha256, message: 'staged object verification failed' },
    { byteLength: 5, digest: 'a'.repeat(64), message: 'staged object verification failed' },
  ])('does not replace the old object or leave staging debris on a failed length/digest check ($byteLength, $digest)', async ({ byteLength, digest, message }) => {
    const store = createLocalFsObjectStore({ rootDir });
    const writer = await store.resolveStagedWriter?.({});
    if (!writer) throw new Error('Local store did not supply a staged writer');
    await store.put({ key: 'file', bytes: bytes('old') });
    await expect(writer({ key: 'file', byteLength, sha256: digest, openChunks: chunks })).rejects.toThrow(message);
    expect(await store.get({ key: 'file' })).toEqual(bytes('old'));
    expect(readdirSync(rootDir)).toEqual(['file']);
  });

  it.each(['before opening', 'between chunks', 'after the last chunk'])('aborts %s without publishing or retaining staging bytes', async phase => {
    const store = createLocalFsObjectStore({ rootDir });
    const writer = await store.resolveStagedWriter?.({});
    if (!writer) throw new Error('Local store did not supply a staged writer');
    const controller = new AbortController();
    const reason = new Error('upload cancelled');
    let opened = 0;
    if (phase === 'before opening') controller.abort(reason);
    const openChunks = async function* () {
      opened++;
      yield bytes('he');
      if (phase === 'between chunks') controller.abort(reason);
      yield bytes('llo');
      if (phase === 'after the last chunk') controller.abort(reason);
    };
    await expect(writer({ key: 'file', byteLength: 5, sha256, openChunks }, { signal: controller.signal })).rejects.toBe(reason);
    expect(opened).toBe(phase === 'before opening' ? 0 : 1);
    expect(await store.get({ key: 'file' })).toBeNull();
    expect(readdirSync(rootDir)).toEqual([]);
  });
});
