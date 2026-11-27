import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { InMemoryAssetBlobRepo } from '../../repo.memory.js';
import { InMemoryBlobStore } from '../../blob-store.memory.js';
import type { MediaRecord } from '../../types.js';
import { InMemoryMediaContentTypeStore } from '../content-type-store.js';
import { readRecordedContentType, resolveContentTypes } from '../content-type-resolution.js';

const workspaceId = 'west';
const seeded = '1'.repeat(64);
const old = '2'.repeat(64);
const unreadable = '3'.repeat(64);
const missing = '4'.repeat(64);
const document = '5'.repeat(64);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function record(id: string, sha256: string, kind: MediaRecord['kind'] = 'media'): MediaRecord {
  return { id, workspaceId, title: id, slug: id, alt: '', caption: '', credit: '', kind,
    source: { sha256 }, status: 'active', createdAt: '2026-11-20', updatedAt: '2026-11-20', version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null };
}

test('listing looks up each uncached non-document blob once, persists sniffed types and retries unreadable bytes', async () => {
  const mediaContentTypeStore = new InMemoryMediaContentTypeStore();
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const blobs = new InMemoryBlobStore();
  const save = async (sha256: string, storageKey: string) => assetBlobRepo.save({
    id: sha256, workspaceId, sha256, storageKey, status: 'active', createdAt: '2026-11-20', createdByPrincipal: 'owner',
  });
  await mediaContentTypeStore.set({ workspaceId, sha256: seeded, contentType: 'image/webp' });
  await mediaContentTypeStore.set({ workspaceId: 'east', sha256: old, contentType: 'image/jpeg' });
  const { storageKey: pngKey } = await blobs.put({ workspaceId, sha256: old, bytes: png });
  await save(old, pngKey);
  const brokenKey = `ws/${workspaceId}/blobs/33/${unreadable}`;
  await save(unreadable, brokenKey);
  const find = vi.spyOn(assetBlobRepo, 'findByHash');
  const get = vi.spyOn(blobs, 'get');
  const deps = { workspaceId, mediaContentTypeStore, assetBlobRepo, blobStore: blobs };
  const media = [record('known', seeded), record('failed', unreadable), record('legacy', old), record('missing', missing), record('copy', old), record('document', document, 'document')];

  assert.deepEqual(await resolveContentTypes({ deps, media }), new Map([[seeded, 'image/webp'], [old, 'image/png']]));
  assert.deepEqual(find.mock.calls, [[{ workspaceId, sha256: unreadable }], [{ workspaceId, sha256: old }], [{ workspaceId, sha256: missing }]]);
  assert.deepEqual(get.mock.calls, [[{ storageKey: brokenKey }], [{ storageKey: pngKey }]]);
  assert.equal(await readRecordedContentType({ deps, sha256: old }), 'image/png');
  assert.equal(await readRecordedContentType({ deps, sha256: unreadable }), null);
  assert.equal(await readRecordedContentType({ deps: { ...deps, workspaceId: 'east' }, sha256: old }), 'image/jpeg');

  await blobs.put({ workspaceId, sha256: unreadable, bytes: png });
  assert.deepEqual(await resolveContentTypes({ deps, media }), new Map([[seeded, 'image/webp'], [old, 'image/png'], [unreadable, 'image/png']]));
  assert.deepEqual(get.mock.calls, [[{ storageKey: brokenKey }], [{ storageKey: pngKey }], [{ storageKey: brokenKey }]]);
});
