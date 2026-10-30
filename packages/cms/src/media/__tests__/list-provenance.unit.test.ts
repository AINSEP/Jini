import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import { buildMediaRegistrations, type MediaToolDeps } from '../tool-registrations.js';
import { uploadMedia } from '../media-service.js';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from '../repo.memory.js';
import { InMemoryBlobStore } from '../blob-store.memory.js';

function fixture(optional: Pick<MediaToolDeps, 'listContentTypes'> = {}) {
  let id = 0;
  const deps: MediaToolDeps = { workspaceId: 'site', authorize: async () => ({ allowed: true, reason: 'matched' }),
    clock: { nowMs: () => Date.parse('2026-10-28T00:00:00Z') }, idGen: { newId: () => `id-${++id}` },
    mediaRepo: new InMemoryMediaRepo({}), assetBlobRepo: new InMemoryAssetBlobRepo({}),
    assetRenditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore() };
  const tools = buildMediaRegistrations(deps, optional);
  const call = async (name: string, input: Record<string, unknown> = {}) => tools.find(t => t.descriptor.id === name)!.handler({
    input, executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' }, signal: new AbortController().signal,
  } as ToolExecutionContext) as Promise<{ media: { id: string; source: unknown }[]; documents: { id: string; source: unknown }[]; nextCursor: string | null }>;
  const save = (filename: string, kind: 'media' | 'document' = 'media') => uploadMedia({
    deps: { ...deps, blobRepo: deps.assetBlobRepo, renditionRepo: deps.assetRenditionRepo },
    input: { workspaceId: 'site', filename, kind, bytes: kind === 'document' ? Buffer.from('# Guide') : Buffer.from([137,80,78,71,13,10,26,10]),
      contentType: kind === 'document' ? 'text/markdown' : 'image/png', createdByPrincipal: 'owner',
      provenance: { kind: 'url', url: 'https://example.com/file?token=secret#secret' } },
  });
  return { deps, call, save };
}

test('media filters title/alt/name substrings case insensitively, combines kind, and returns safe provenance', async () => {
  const f = fixture();
  const { media } = await f.save('Brand.png'); await f.save('unrelated.png');
  await f.deps.mediaRepo.save({ ...media, title: 'Renamed', alt: 'LOGO artwork' });
  assert.deepEqual((await f.call('media_list_assets', { query: 'logo', kind: 'image' })).media.map(r => r.id), [media.id]);
  assert.deepEqual((await f.call('media_list_assets', { query: 'brand' })).media.map(r => r.id), [media.id]);
  assert.deepEqual((await f.call('media_list_assets', { kind: 'video' })).media, []);
  assert.deepEqual((await f.call('media_list_assets')).media[0]!.source, { kind: 'url', url: 'https://example.com/file' });
});

test('both lists page matching rows with tied timestamps, without gaps, and resume after cursor row deletion', async () => {
  for (const tool of ['media_list_assets', 'library_list']) {
    const f = fixture();
    for (let n = 0; n < 5; n++) await f.save(`guide-${n}.md`, tool === 'library_list' ? 'document' : 'media');
    const key = tool === 'library_list' ? 'documents' : 'media';
    const first = await f.call(tool, { limit: 2, query: 'guide' });
    assert.equal(first[key].length, 2); assert.ok(first.nextCursor);
    await f.deps.mediaRepo.remove({ workspaceId: 'site', id: first[key][1]!.id });
    const second = await f.call(tool, { limit: 2, query: 'guide', cursor: first.nextCursor });
    const third = await f.call(tool, { limit: 2, query: 'guide', cursor: second.nextCursor });
    assert.equal(new Set([...first[key], ...second[key], ...third[key]].map(r => r.id)).size, 5);
    assert.equal(third.nextCursor, null);
  }
});

test('default page is bounded; invalid paging/filter input rejects before repository reads', async () => {
  const f = fixture();
  for (let n = 0; n < 52; n++) await f.save(`asset-${n}.png`);
  const page = await f.call('media_list_assets'); assert.equal(page.media.length, 50); assert.ok(page.nextCursor);
  let reads = 0; f.deps.mediaRepo.list = async () => { reads++; return []; };
  for (const tool of ['media_list_assets', 'library_list']) {
    for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: 'bad' }, { query: 3 }, { kind: 'bad' }]) {
      await assert.rejects(f.call(tool, input));
    }
  }
  assert.equal(reads, 0);
});

test('Library filters before paging and never exposes trashed documents or media', async () => {
  const f = fixture(); await f.save('guide.png');
  const { media: hidden } = await f.save('guide-hidden.md', 'document');
  await f.deps.mediaRepo.save({ ...hidden, status: 'trashed' });
  const { media: visible } = await f.save('guide-visible.md', 'document');
  const page = await f.call('library_list', { query: 'GUIDE', kind: 'document', limit: 1 });
  assert.deepEqual(page.documents.map(r => r.id), [visible.id]); assert.equal(page.nextCursor, null);
  assert.deepEqual(page.documents[0]!.source, { kind: 'url', url: 'https://example.com/file' });
  assert.deepEqual((await f.call('library_list', { kind: 'image' })).documents, []);
});

test('kind uses the existing MIME store for legacy assets; media keeps active and trashed statuses', async () => {
  const f = fixture({ listContentTypes: { getMany: async () => new Map([['legacy-hash', 'video/webm']]) } });
  const { media } = await f.save('old.png');
  await f.deps.mediaRepo.save({ ...media, status: 'trashed', source: { sha256: 'legacy-hash' } });
  const page = await f.call('media_list_assets', { kind: 'video' });
  assert.deepEqual(page.media.map(row => row.id), [media.id]);
  assert.equal(Object.hasOwn(page.media[0]!, 'source'), false, 'legacy unknown origin must stay unknown');
  assert.deepEqual((await f.call('media_list_assets', { kind: 'image' })).media, []);
});

test('sniffed kind filters support images, videos and audio without a host MIME store', async () => {
  const f = fixture();
  for (const [contentType, bytes] of [['video/webm', [26,69,223,163]], ['audio/mpeg', [73,68,51]]] as const) {
    await uploadMedia({ deps: { ...f.deps, blobRepo: f.deps.assetBlobRepo, renditionRepo: f.deps.assetRenditionRepo },
      input: { workspaceId: 'site', bytes: Buffer.from(bytes), filename: `${contentType.split('/')[0]}.bin`, contentType, createdByPrincipal: 'owner' } });
  }
  await f.save('image.png');
  for (const kind of ['image', 'video', 'audio']) assert.equal((await f.call('media_list_assets', { kind })).media.length, 1);
});

test('unsafe local provenance rejects before writing; safe relative paths survive upload', async () => {
  const f = fixture();
  const input = { workspaceId: 'site', kind: 'document' as const, filename: 'guide.md', contentType: 'text/markdown',
    bytes: Buffer.from('# Guide'), createdByPrincipal: 'owner' };
  const deps = { ...f.deps, blobRepo: f.deps.assetBlobRepo, renditionRepo: f.deps.assetRenditionRepo };
  for (const path of ['/Users/owner/private.md', 'C:\\Users\\owner\\private.md', '../private.md', '%2e%2e/private.md']) {
    await assert.rejects(uploadMedia({ deps, input: { ...input, provenance: { kind: 'picked-folder', path } } }));
  }
  assert.deepEqual(await f.deps.mediaRepo.list({ workspaceId: 'site' }), []);
  await uploadMedia({ deps, input: { ...input, provenance: { kind: 'picked-folder', path: 'brand/guide.md' } } });
  assert.deepEqual((await f.call('library_list')).documents[0]!.source, { kind: 'picked-folder', path: 'brand/guide.md' });
});
