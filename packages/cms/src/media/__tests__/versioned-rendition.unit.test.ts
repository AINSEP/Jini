import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryAssetRenditionRepo } from '../repo.memory.js';
import { MediaConflictError, type AssetRenditionRecord } from '../types.js';
import type { MediaFileReplacementInput } from '../replace-media-file.js';
import { guardMediaRenditionRepo } from '../guard-rendition-repo.js';
import { makeMedia } from './versioned-media.fixture.js';
import { InMemoryVersionedMediaRepo } from '../versioned-repo.js';

const media = makeMedia({ id: 'asset', workspaceId: 'ws', source: { sha256: 'source-a' } });
const record: AssetRenditionRecord = { id: 'rendition', workspaceId: 'ws', assetId: 'asset', transformName: 'thumb', version: 1, storageKey: 'thumb', createdAt: '2026-11-01T00:00:00Z' };
const lookup = { workspaceId: 'ws', assetId: 'asset', transformName: 'thumb', version: 1 };

test('memory source-conditional rendition persistence writes to the shared rendition repository', async () => {
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [media], renditionRepo });
  assert.deepEqual(await repo.saveRenditionIfSource({ record, sourceSha256: 'source-a' }), { applied: true });
  assert.deepEqual(await renditionRepo.findOne(lookup), record);
});

test('memory rendition persistence refuses a replaced, missing, foreign or inactive source without writes', async () => {
  for (const current of [null, { ...media, source: { sha256: 'source-b' } }, { ...media, workspaceId: 'other' }, { ...media, status: 'trashed' as const }]) {
    const renditionRepo = new InMemoryAssetRenditionRepo({});
    const repo = new InMemoryVersionedMediaRepo({}, { initialRows: current ? [current] : [], renditionRepo });
    assert.deepEqual(await repo.saveRenditionIfSource({ record, sourceSha256: 'source-a' }), { applied: false });
    assert.equal(await renditionRepo.findOne(lookup), null);
  }
});

test('memory rendition compare and persistence cannot interleave with a later source update', async () => {
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [media], renditionRepo });
  const writing = repo.saveRenditionIfSource({ record, sourceSha256: 'source-a' });
  const persisted = renditionRepo.findOne(lookup);
  await repo.save({ ...media, source: { sha256: 'source-b' } });
  assert.deepEqual(await writing, { applied: true });
  assert.deepEqual(await persisted, record);
  assert.deepEqual(await repo.saveRenditionIfSource({ record: { ...record, id: 'late' }, sourceSha256: 'source-a' }), { applied: false });
  assert.deepEqual(await renditionRepo.listByAsset({ workspaceId: 'ws', assetId: 'asset' }), [record]);
});

const replacement: MediaFileReplacementInput = {
  workspaceId: 'ws', id: 'asset', ifVersion: 1, sha256: 'source-b', storageKey: 'new-original',
  originalRenditionId: 'new-rendition', updatedAt: '2026-11-02T00:00:00Z', contentType: 'image/png',
  provenance: { kind: 'upload' },
};

// Mutation: ignore the captured source hash or write through the unguarded rendition save.
test('a preview started before replacement cannot persist after the source changes', async () => {
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [media], renditionRepo });
  const guarded = guardMediaRenditionRepo({ mediaRepo: repo, renditionRepo, media });
  assert.deepEqual(await repo.replaceFileIfVersion(replacement), { applied: true });
  await assert.rejects(guarded.save(record), MediaConflictError);
  assert.deepEqual(await renditionRepo.listByAsset({ workspaceId: 'ws', assetId: 'asset' }), []);
  const current = await repo.findById({ workspaceId: 'ws', id: 'asset' });
  assert.ok(current);
  assert.equal(current.version, 2);
  assert.deepEqual(current.source, { sha256: 'source-b', contentType: 'image/png', provenance: { kind: 'upload' } });
  await guardMediaRenditionRepo({ mediaRepo: repo, renditionRepo, media: current }).save(record);
  assert.deepEqual(await renditionRepo.findOne(lookup), record);
});

// Mutation: remove a source-switch eligibility predicate or the version comparison.
test('source replacement refuses missing, foreign, inactive, document and stale rows unchanged', async () => {
  for (const current of [null, { ...media, workspaceId: 'other' }, { ...media, status: 'trashed' as const },
    { ...media, kind: 'document' as const }, { ...media, version: 2 }]) {
    const repo = new InMemoryVersionedMediaRepo({}, { initialRows: current ? [current] : [] });
    assert.deepEqual(await repo.replaceFileIfVersion(replacement), { applied: false });
    assert.deepEqual(await repo.list({ workspaceId: current?.workspaceId ?? 'ws' }), current ? [current] : []);
  }
});

// Mutation: reject compensation of an inactive row or fail to restore source/version bookkeeping.
test('source compensation restores the prior source verbatim while its applied version holds', async () => {
  const current = { ...media, status: 'trashed' as const, version: 2, source: { sha256: 'source-b' } };
  const repo = new InMemoryVersionedMediaRepo({}, { initialRows: [current] });
  const restore = { source: media.source, version: 1, updatedAt: media.updatedAt };
  const input: MediaFileReplacementInput = { workspaceId: 'ws', id: 'asset', ifVersion: 2,
    sha256: 'source-a', storageKey: 'original', originalRenditionId: 'original-rendition', updatedAt: media.updatedAt, restore };
  assert.deepEqual(await repo.replaceFileIfVersion(input), { applied: true });
  assert.deepEqual(await repo.findById({ workspaceId: 'ws', id: 'asset' }), { ...current, ...restore });
  assert.deepEqual(await repo.replaceFileIfVersion(input), { applied: false });
});
