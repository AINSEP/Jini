import assert from 'node:assert/strict';
import { test } from 'vitest';
import { replaceMediaFile, type MediaFileReplacementRepoPort } from '../replace-media-file.js';
import { uploadMedia } from '../media-service.js';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from '../repo.memory.js';
import { InMemoryBlobStore } from '../blob-store.memory.js';

async function fixture() {
  let ids = 0;
  const switches: unknown[] = [];
  let applied = true;
  const mediaRepo: MediaFileReplacementRepoPort = Object.assign(new InMemoryMediaRepo({}), {
    replaceFileIfVersion: async (input: unknown) => { switches.push(input); return { applied }; },
    saveRenditionIfSource: async () => ({ applied: true }),
  });
  const deps = {
    workspaceId: 'workspace', clock: { nowMs: () => Date.parse('2026-10-17T00:00:00Z') },
    idGen: { newId: () => `id-${++ids}` }, mediaRepo, assetBlobRepo: new InMemoryAssetBlobRepo({}),
    blobStore: new InMemoryBlobStore(), mediaContentTypeStore: { set: async (_input: unknown) => {} },
  };
  const { media } = await uploadMedia({ deps: { ...deps, blobRepo: deps.assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}) },
    input: { workspaceId: deps.workspaceId, filename: 'original.png', bytes: new Uint8Array([1]), contentType: 'image/png', createdByPrincipal: 'creator' } });
  return { deps, media, switches, conflict: () => { applied = false; } };
}

test('stages a new blob and delegates the atomic source switch without creating a new identity', async () => {
  const f = await fixture();
  const bytes = new Uint8Array([2, 3, 4]);
  const saved = await replaceMediaFile({ deps: f.deps, media: f.media, bytes, contentType: 'image/png', principalId: 'owner' });
  assert.ok(saved);
  assert.deepEqual(saved, { ...f.media, source: { sha256: saved.source.sha256 }, version: f.media.version + 1 });
  assert.notEqual(saved.source.sha256, f.media.source.sha256);
  const blob = await f.deps.assetBlobRepo.findByHash({ workspaceId: f.deps.workspaceId, sha256: saved.source.sha256 });
  assert.ok(blob);
  assert.deepEqual(await f.deps.blobStore.get({ storageKey: blob.storageKey }), bytes);
  assert.equal(blob.createdByPrincipal, 'owner');
  assert.equal(saved.createdBy, 'creator');
  const switchInput = f.switches[0] as { originalRenditionId: string };
  assert.ok(switchInput.originalRenditionId);
  assert.notEqual(switchInput.originalRenditionId, f.media.id);
  assert.deepEqual(f.switches, [{ workspaceId: f.deps.workspaceId, id: f.media.id, ifVersion: f.media.version,
    sha256: blob.sha256, storageKey: blob.storageKey, originalRenditionId: switchInput.originalRenditionId, updatedAt: f.media.updatedAt }]);
  assert.equal((await f.deps.mediaRepo.list({ workspaceId: f.deps.workspaceId })).length, 1);
});

test('a CAS conflict retains old bytes and stages new bytes for normal orphan collection', async () => {
  const f = await fixture(); f.conflict();
  const result = await replaceMediaFile({ deps: f.deps, media: f.media, bytes: new Uint8Array([2]), contentType: 'image/png', principalId: 'owner' });
  assert.equal(result, null);
  assert.deepEqual(await f.deps.mediaRepo.findById({ workspaceId: f.deps.workspaceId, id: f.media.id }), f.media);
  assert.equal((await f.deps.assetBlobRepo.list({ workspaceId: f.deps.workspaceId })).length, 2);
  const old = await f.deps.assetBlobRepo.findByHash({ workspaceId: f.deps.workspaceId, sha256: f.media.source.sha256 });
  assert.deepEqual(await f.deps.blobStore.get({ storageKey: old!.storageKey }), new Uint8Array([1]));
});

test('empty and oversized replacement bytes cannot reach blob staging or the source switch', async () => {
  const f = await fixture();
  for (const bytes of [new Uint8Array(), new Uint8Array(3)]) {
    await assert.rejects(replaceMediaFile({ deps: f.deps, media: f.media, bytes, contentType: 'image/png', principalId: 'owner' }, { maxUploadBytes: 2 }), /empty or exceeds/);
  }
  assert.equal((await f.deps.assetBlobRepo.list({ workspaceId: f.deps.workspaceId })).length, 1);
  assert.deepEqual(f.switches, []);
});

test('replacement reuses existing bytes and resurrects their tombstoned blob under the GC lock', async () => {
  const f = await fixture();
  const bytes = new Uint8Array([2, 3]);
  const first = await replaceMediaFile({ deps: f.deps, media: f.media, bytes, contentType: 'image/png', principalId: 'owner' });
  const key = { workspaceId: f.deps.workspaceId, sha256: first!.source.sha256 };
  const blob = (await f.deps.assetBlobRepo.findByHash(key))!;
  await f.deps.assetBlobRepo.save({ ...blob, status: 'tombstoned', tombstonedAt: f.media.updatedAt });
  f.deps.blobStore.put = async () => { assert.fail('deduplicated replacement must not rewrite shared bytes'); };
  const second = await replaceMediaFile({ deps: f.deps, media: f.media, bytes, contentType: 'image/png', principalId: 'other' });
  assert.equal(second!.source.sha256, first!.source.sha256);
  assert.deepEqual(await f.deps.assetBlobRepo.findByHash(key), { ...blob, status: 'active', tombstonedAt: undefined });
});

test('SVG replacement uses the upload sanitizer before hashing and persistence', async () => {
  const f = await fixture();
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10"/></svg>');
  const saved = await replaceMediaFile({ deps: f.deps, media: f.media, bytes, contentType: 'image/svg+xml', principalId: 'owner' });
  const blob = (await f.deps.assetBlobRepo.findByHash({ workspaceId: f.deps.workspaceId, sha256: saved!.source.sha256 }))!;
  const stored = new TextDecoder().decode(await f.deps.blobStore.get({ storageKey: blob.storageKey }));
  assert.doesNotMatch(stored, /script|onload|alert/);
  assert.match(stored, /rect/);
});
