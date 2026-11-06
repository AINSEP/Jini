import { expect, test } from 'vitest';
import { readDocumentText } from '../document-read.js';
import { uploadMedia } from '../media-service.js';
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from '../repo.memory.js';
import { InMemoryBlobStore } from '../blob-store.memory.js';

test('a host without size probing can read an empty text page at EOF with exact byte offsets', async () => {
  const blobStore = new InMemoryBlobStore();
  const deps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore,
    clock: { nowMs: () => 0 }, idGen: { newId: () => 'doc' } };
  const { media } = await uploadMedia({ deps, input: { workspaceId: 'site', filename: 'guide.md', kind: 'document',
    contentType: 'text/markdown', bytes: Buffer.from('é'), createdByPrincipal: 'owner' } });
  // sizeOf is an optional host capability; byte validation still belongs to the reader.
  const withoutSize = Object.create(blobStore) as InMemoryBlobStore;
  Object.defineProperty(withoutSize, 'sizeOf', { value: undefined });
  expect(await readDocumentText({ deps: { ...deps, blobStore: withoutSize }, input: { workspaceId: 'site', id: media.id, offset: 2 } })).toEqual({
    id: media.id, text: '', offset: 2, nextOffset: null, totalBytes: 2, truncated: false, untrusted: true,
  });
  await expect(readDocumentText({ deps, input: { workspaceId: 'site', id: media.id, offset: 1 } })).rejects.toThrow('invalid document size or UTF-8 byte offset');
});


test('document text reads limit concurrent byte loads and release capacity after a failure', async () => {
  const blobStore = new InMemoryBlobStore();
  const deps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore,
    clock: { nowMs: () => 0 }, idGen: { newId: () => 'doc' } };
  const { media } = await uploadMedia({ deps, input: { workspaceId: 'site', filename: 'guide.md', kind: 'document',
    contentType: 'text/markdown', bytes: Buffer.from('hello'), createdByPrincipal: 'owner' } });
  const get = blobStore.get.bind(blobStore);
  let reads = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const slowStore = Object.create(blobStore) as InMemoryBlobStore;
  slowStore.get = async input => { reads++; await blocked; throw new Error('read failed'); };
  const read = () => readDocumentText({ deps: { ...deps, blobStore: slowStore }, input: { workspaceId: 'site', id: media.id } });
  const first = read(), second = read();
  await new Promise(resolve => setTimeout(resolve, 0));
  const third = read();
  // Attach handlers before releasing I/O, so rejected reads cannot become unhandled promises.
  const outcomes = Promise.allSettled([first, second, third]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const concurrentReads = reads;
  release();
  const results = await outcomes;
  expect(concurrentReads).toBe(2);
  expect(results[2]).toMatchObject({ status: 'rejected', reason: { message: expect.stringMatching(/documents.*reading|document.*busy/i) } });
  slowStore.get = get;
  expect((await read()).text).toBe('hello');
});
