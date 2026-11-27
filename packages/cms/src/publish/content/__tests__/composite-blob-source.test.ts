import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCompositePeerBlobSource, FileBlobUnavailableError } from '../composite-blob-source.js';
import { createFileBlobIndex } from '../../transfer/file-blob-index.js';
import { InMemoryBlobStore } from '../../../media/blob-store.memory.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('prefers the workspace blob store even when the shared file index returns a different candidate', async () => {
  const blobStore = new InMemoryBlobStore();
  const bytes = new TextEncoder().encode('stored workspace bytes');
  const checksum = sha256(bytes);
  const { storageKey } = await blobStore.put({ workspaceId: 'site-1', sha256: checksum, bytes });
  const fileBlobIndex = createFileBlobIndex();
  fileBlobIndex.set({ sha256: checksum, entry: { absPath: '/unused-file-index-path', size: 7 } });
  const lookup = vi.fn(fileBlobIndex.get);
  const source = createCompositePeerBlobSource({ blobStore, fileBlobIndex: { ...fileBlobIndex, get: lookup } });
  expect(await source.exists({ sha256: checksum, storageKey })).toBe(true);
  expect(await source.get({ sha256: checksum, storageKey })).toEqual(bytes);
  expect(lookup).not.toHaveBeenCalled();
});

it('returns verified indexed bytes and rechecks the digest after a same-size file edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cms-publish-blob-'));
  try {
    const absPath = join(dir, 'theme.css');
    const bytes = Buffer.from('h1 { color: red; }');
    const edited = Buffer.from('h1 { color: tan; }');
    const checksum = sha256(bytes);
    const query = { sha256: checksum, storageKey: 'absent-workspace-blob' };
    const fileBlobIndex = createFileBlobIndex();
    const source = createCompositePeerBlobSource({ fileBlobIndex, blobStore: new InMemoryBlobStore() });
    fileBlobIndex.set({ sha256: checksum, entry: { absPath, size: bytes.length } });
    await writeFile(absPath, bytes);
    expect(await source.exists(query)).toBe(true);
    expect(await source.get(query)).toEqual(bytes);
    await writeFile(absPath, edited);
    expect(edited.length).toBe(bytes.length);
    expect(await source.exists(query)).toBe(false);
    await expect(source.get(query)).rejects.toBeInstanceOf(FileBlobUnavailableError);
    await expect(source.get(query)).rejects.toThrow(`file blob '${checksum}' is unavailable: the file at its indexed path no longer hashes to the requested sha256`);
    await rm(absPath);
    expect(await source.exists(query)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('returns missing for a digest in neither store and names it on direct retrieval', async () => {
  const query = { sha256: 'never-packed', storageKey: 'absent' };
  const source = createCompositePeerBlobSource({ fileBlobIndex: createFileBlobIndex(), blobStore: new InMemoryBlobStore() });
  expect(await source.exists(query)).toBe(false);
  await expect(source.get(query)).rejects.toBeInstanceOf(FileBlobUnavailableError);
  await expect(source.get(query)).rejects.toThrow("file blob 'never-packed' is unavailable: not present in the blob store or the file index");
});
