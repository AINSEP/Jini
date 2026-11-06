import { expect, test, vi } from 'vitest';
import { createDocumentTextReader } from '../../document-read.js';
import { uploadMedia } from '../../media-service.js';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from '../../repo.memory.js';
import { InMemoryBlobStore } from '../../blob-store.memory.js';
import type { DocumentTextExtractorPort } from '../../document-text.js';

async function fixture(extractor?: DocumentTextExtractorPort) {
  let id = 0;
  const blobStore = new InMemoryBlobStore();
  const deps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore,
    clock: { nowMs: () => 0 }, idGen: { newId: () => `document-${++id}` },
    documentTextExtractors: extractor ? [extractor] : [] };
  const text = 'é'.repeat(40_000);
  const { media } = await uploadMedia({ deps, input: { workspaceId: 'site', filename: extractor ? 'guide.pdf' : 'guide.txt',
    kind: 'document', contentType: extractor ? 'application/pdf' : 'text/plain',
    bytes: Buffer.from(extractor ? '%PDF-1.7\nfixture' : text), createdByPrincipal: 'owner' } });
  const get = vi.spyOn(blobStore, 'get');
  return { deps, input: { workspaceId: 'site', id: media.id }, get, media, text };
}

test('following text byte offsets loads the source once and preserves UTF-8', async () => {
  const f = await fixture(), read = createDocumentTextReader({});
  const first = await read(f);
  const second = await read({ ...f, input: { ...f.input, offset: first.nextOffset! } });
  expect(first.text + second.text).toBe(f.text);
  expect(second.nextOffset).toBeNull();
  expect(f.get).toHaveBeenCalledOnce();
});

test('following extracted pages reuses extraction and source bytes', async () => {
  const text = '🙂'.repeat(40_000);
  const extract = vi.fn(async () => ({ text, truncated: true, pagesRead: 100, totalPages: 101 }));
  const f = await fixture({ contentType: 'application/pdf', extract }), read = createDocumentTextReader({});
  const first = await read(f);
  const second = await read({ ...f, input: { ...f.input, offset: first.nextOffset! } });
  expect(second.extractionTruncated).toBe(true);
  expect(second.totalPages).toBe(101);
  expect(second.text).toBe(text.slice(first.text.length, first.text.length + second.text.length));
  expect(extract).toHaveBeenCalledOnce();
  expect(f.get).toHaveBeenCalledOnce();
});

test('cached pages still check current workspace and document status', async () => {
  const f = await fixture(), read = createDocumentTextReader({});
  const first = await read(f);
  await expect(read({ ...f, input: { ...f.input, workspaceId: 'other', offset: first.nextOffset! } })).rejects.toThrow('not found');
  await f.deps.mediaRepo.save({ ...f.media, status: 'trashed' });
  await expect(read({ ...f, input: { ...f.input, offset: first.nextOffset! } })).rejects.toThrow('not found');
  expect(f.get).toHaveBeenCalledOnce();
});

test('expired pages load the current source again', async () => {
  const f = await fixture(), read = createDocumentTextReader({});
  vi.useFakeTimers();
  try {
    const first = await read(f);
    await vi.advanceTimersByTimeAsync(60_000);
    await read({ ...f, input: { ...f.input, offset: first.nextOffset! } });
    expect(f.get).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

test('a new first page refreshes extraction instead of hiding adapter changes', async () => {
  const extract = vi.fn(async () => ({ text: 'x'.repeat(80_000), truncated: false }));
  const f = await fixture({ contentType: 'application/pdf', extract }), read = createDocumentTextReader({});
  await read(f);
  await read(f);
  expect(extract).toHaveBeenCalledTimes(2);
});


test('replacement source hashes cannot reuse a previous text snapshot', async () => {
  const f = await fixture(), read = createDocumentTextReader({});
  const first = await read(f);
  const replacement = await uploadMedia({ deps: f.deps, input: { workspaceId: 'site', filename: 'replacement.txt', kind: 'document',
    contentType: 'text/plain', bytes: Buffer.from('z'.repeat(80_000)), createdByPrincipal: 'owner' } });
  await f.deps.mediaRepo.save({ ...f.media, source: replacement.media.source });
  const second = await read({ ...f, input: { ...f.input, offset: first.nextOffset! } });
  expect(second.text).toBe('z'.repeat(80_000 - first.nextOffset!));
  expect(f.get).toHaveBeenCalledTimes(2);
});

test('same ids and hashes in another host never share cached bytes', async () => {
  const firstHost = await fixture(), secondHost = await fixture(), read = createDocumentTextReader({});
  const first = await read(firstHost);
  await read({ ...secondHost, input: { ...secondHost.input, offset: first.nextOffset! } });
  expect(secondHost.get).toHaveBeenCalledOnce();
});
