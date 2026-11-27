import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, vi } from 'vitest';
import { sniffContentType, trashMedia, uploadMedia } from '../../../media/index.js';
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from '../../../media/repo.memory.js';
import { InMemoryBlobStore } from '../../../media/blob-store.memory.js';
import { InMemoryMediaContentTypeStore } from '../../../media/site/content-type-store.js';
import { purgeMedia } from '../../../media/site/purge-media.js';
import { createFormFileStorage } from '../form-file-storage.js';

const workspaceId = 'first-site';
const file = { filename: 'Visitor File.PNG', contentType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) };
const request = { workspaceId, submissionId: 'response-37', fieldId: 'photo', file };
const sha256 = createHash('sha256').update(file.bytes).digest('hex');

function setup(contentTypes = new InMemoryMediaContentTypeStore()) {
  let next = 0;
  const media = {
    createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => `media-${++next}` },
    mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore(),
    entryRefsRepo: { findByTarget: async () => [] }, postRepo: { list: async () => [] },
    // The host's purge adapter reads the alias index on the same media repo.
  };
  const mediaRepo = Object.assign(media.mediaRepo, { listRetiredSlugs: async () => [] });
  const resolveCreatedByPrincipal = vi.fn(async (_input: { workspaceId: string }, _options?: Record<string, never>) => 'form-system');
  const upload = vi.fn(uploadMedia);
  const storage = createFormFileStorage({
    media: { ...media, mediaRepo }, mediaOps: { sniffContentType, trashMedia, uploadMedia: upload, purgeMedia }, contentTypes, resolveCreatedByPrincipal,
  });
  return { storage, media, upload, resolveCreatedByPrincipal, contentTypes };
}

test('signature detection recognizes PDFs and delegates non-PDF bytes to the media sniffer', () => {
  const { storage } = setup();
  assert.equal(storage.detectContentType({ bytes: Buffer.from('%PDF-1.7') }), 'application/pdf');
  assert.equal(storage.detectContentType({ bytes: file.bytes }), 'image/png');
  assert.equal(storage.detectContentType({ bytes: Buffer.from('%PDF') }), 'application/octet-stream');
});

test('stores a private owner-attributed upload under a server-generated name and discards only the failed attempt', async () => {
  const { storage, media, upload, contentTypes, resolveCreatedByPrincipal } = setup();
  const sibling = await storage.store({ ...request, submissionId: 'response-36' });
  const stored = await storage.store(request);
  assert.deepEqual(stored, { mediaId: 'media-4', filename: 'Visitor File.PNG', contentType: 'image/png', byteSize: 8 });
  assert.deepEqual(resolveCreatedByPrincipal.mock.calls, [[{ workspaceId }, {}], [{ workspaceId }, {}]]);
  const uploadArgs = upload.mock.calls[1]!;
  assert.deepEqual(uploadArgs[0].input, {
    workspaceId, access: 'private', bytes: file.bytes, filename: 'response-37-photo.png', contentType: 'image/png', createdByPrincipal: 'form-system',
  });
  assert.deepEqual(uploadArgs[1], { maxUploadBytes: 10 * 1024 * 1024, allowedMimeTypes: new Set(['image/png']) });
  const row = await media.mediaRepo.findById({ workspaceId, id: stored.mediaId });
  assert.equal(row?.source.private, true);
  assert.equal(row?.createdBy, 'form-system');
  assert.deepEqual(await contentTypes.getMany({ workspaceId, sha256s: [sha256] }), new Map([[sha256, 'image/png']]));

  await storage.discard({ workspaceId, reference: stored });
  assert.equal(await media.mediaRepo.findById({ workspaceId, id: stored.mediaId }), null);
  assert.equal((await media.mediaRepo.findById({ workspaceId, id: sibling.mediaId }))?.status, 'active');
  const blob = await media.blobRepo.findByHash({ workspaceId, sha256 });
  assert.equal(blob?.status, 'active');
  assert.deepEqual([...await media.blobStore.get({ storageKey: blob!.storageKey })], [...file.bytes]);
});

test('failed content-type bookkeeping propagates the error and removes the newly created attachment', async () => {
  const failure = new Error('type store unavailable');
  const types = new InMemoryMediaContentTypeStore();
  const setType = vi.spyOn(types, 'set').mockRejectedValue(failure);
  const { storage, media } = setup(types);
  await assert.rejects(storage.store(request), error => error === failure);
  assert.deepEqual(setType.mock.calls, [[{ workspaceId, sha256, contentType: 'image/png' }]]);
  assert.equal(await media.mediaRepo.findById({ workspaceId, id: 'media-2' }), null);
  assert.deepEqual(await media.renditionRepo.listByAsset({ workspaceId, assetId: 'media-2' }), []);
  assert.equal((await media.blobRepo.findByHash({ workspaceId, sha256 }))?.status, 'tombstoned');
});
