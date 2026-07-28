import { describe, expect, it, vi } from 'vitest';
import type { BlobFileMeta, BlobStorage } from '@jini-ai/platform';
import { StorageError } from '@jini-ai/platform';
import { BlobStorageProvider } from '../storage.js';

/**
 * Minimal in-memory fake of `@jini-ai/platform`'s `BlobStorage` port — no real filesystem I/O,
 * matching this package's "inject fakes by default" test convention. Mirrors `BlobStorage`'s
 * real documented behavior closely enough to exercise `BlobStorageProvider`'s mapping logic
 * (namespace scoping, NOT_FOUND → null, idempotent delete, path/mtimeMs → key/updatedAt).
 */
function createFakeBlobStorage(): BlobStorage & { calls: Array<{ method: string; args: unknown[] }> } {
  const files = new Map<string, { data: Buffer; meta: BlobFileMeta }>();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const keyOf = (namespace: string, relpath: string) => `${namespace}::${relpath}`;

  return {
    calls,
    async readFile(namespace, relpath) {
      calls.push({ method: 'readFile', args: [namespace, relpath] });
      const entry = files.get(keyOf(namespace, relpath));
      if (!entry) throw new StorageError('NOT_FOUND', `${namespace}/${relpath} not found`);
      return entry.data;
    },
    async writeFile(namespace, relpath, body) {
      calls.push({ method: 'writeFile', args: [namespace, relpath, body] });
      const meta: BlobFileMeta = { path: relpath, size: body.byteLength, mtimeMs: 1_700_000_000_000 };
      files.set(keyOf(namespace, relpath), { data: body, meta });
      return meta;
    },
    async listFiles(namespace) {
      calls.push({ method: 'listFiles', args: [namespace] });
      return [...files.entries()]
        .filter(([key]) => key.startsWith(`${namespace}::`))
        .map(([, entry]) => entry.meta);
    },
    async deleteFile(namespace, relpath) {
      calls.push({ method: 'deleteFile', args: [namespace, relpath] });
      files.delete(keyOf(namespace, relpath));
    },
    async statFile(namespace, relpath) {
      calls.push({ method: 'statFile', args: [namespace, relpath] });
      return files.get(keyOf(namespace, relpath))?.meta ?? null;
    },
  };
}

describe('BlobStorageProvider', () => {
  it('rejects construction with an empty namespace', () => {
    expect(() => new BlobStorageProvider(createFakeBlobStorage(), { namespace: '' })).toThrow(/namespace/);
  });

  it('put() delegates to blobStorage.writeFile scoped under the configured namespace', async () => {
    const blobStorage = createFakeBlobStorage();
    const provider = new BlobStorageProvider(blobStorage, { namespace: 'tenant-1' });
    const meta = await provider.put('images/a.png', new Uint8Array([1, 2, 3]));

    expect(blobStorage.calls[0]).toEqual({
      method: 'writeFile',
      args: ['tenant-1', 'images/a.png', Buffer.from([1, 2, 3])],
    });
    expect(meta).toEqual({ key: 'images/a.png', size: 3, updatedAt: 1_700_000_000_000 });
  });

  it('put() echoes contentType back in the returned meta but cannot persist it (BlobFileMeta has no such field)', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    const meta = await provider.put('a.png', new Uint8Array([1]), { contentType: 'image/png' });
    expect(meta.contentType).toBe('image/png');

    // A later list() cannot recover it — nothing under @jini-ai/platform ever stored it.
    const listed = await provider.list();
    expect(listed[0]?.contentType).toBeUndefined();
  });

  it('get() returns the bytes for a known key', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    await provider.put('a.bin', new Uint8Array([9, 8, 7]));
    const result = await provider.get('a.bin');
    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual([9, 8, 7]);
  });

  it('get() maps a BlobStorage NOT_FOUND error to null', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    expect(await provider.get('missing.bin')).toBeNull();
  });

  it('get() rethrows a non-NOT_FOUND BlobStorage error', async () => {
    const blobStorage = createFakeBlobStorage();
    blobStorage.readFile = vi.fn(async () => {
      throw new StorageError('IO', 'disk exploded');
    });
    const provider = new BlobStorageProvider(blobStorage, { namespace: 'ns' });
    await expect(provider.get('a.bin')).rejects.toThrow('disk exploded');
  });

  it('get() rethrows a non-StorageError thrown by the backing BlobStorage', async () => {
    const blobStorage = createFakeBlobStorage();
    blobStorage.readFile = vi.fn(async () => {
      throw new Error('unexpected');
    });
    const provider = new BlobStorageProvider(blobStorage, { namespace: 'ns' });
    await expect(provider.get('a.bin')).rejects.toThrow('unexpected');
  });

  it('delete() is idempotent for an unknown key (delegates straight through to BlobStorage.deleteFile)', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    await expect(provider.delete('nope')).resolves.toBeUndefined();
  });

  it('delete() removes a known key', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    await provider.put('a.bin', new Uint8Array([1]));
    await provider.delete('a.bin');
    expect(await provider.get('a.bin')).toBeNull();
  });

  it('list() with no prefix returns every object under the namespace, sorted by key', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    await provider.put('b.bin', new Uint8Array([1]));
    await provider.put('a.bin', new Uint8Array([1]));
    expect((await provider.list()).map((m) => m.key)).toEqual(['a.bin', 'b.bin']);
  });

  it('list() filters by prefix', async () => {
    const provider = new BlobStorageProvider(createFakeBlobStorage(), { namespace: 'ns' });
    await provider.put('images/a.png', new Uint8Array([1]));
    await provider.put('docs/a.pdf', new Uint8Array([1]));
    expect((await provider.list('images/')).map((m) => m.key)).toEqual(['images/a.png']);
  });

  it('two providers over the same BlobStorage but different namespaces do not see each other\'s keys', async () => {
    const blobStorage = createFakeBlobStorage();
    const tenantA = new BlobStorageProvider(blobStorage, { namespace: 'tenant-a' });
    const tenantB = new BlobStorageProvider(blobStorage, { namespace: 'tenant-b' });
    await tenantA.put('secret.bin', new Uint8Array([1]));
    expect(await tenantB.get('secret.bin')).toBeNull();
    expect(await tenantB.list()).toEqual([]);
  });
});
