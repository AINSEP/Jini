/** Library L1 steps 2–4: documents extend media's lifecycle; no second storage owner. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { uploadMedia, listMedia, updateMediaMetadata, trashMedia, purgeMedia } from '../media-service.js';
import { readDocumentText, DOCUMENT_TEXT_PAGE_BYTES, isDocumentOnlyBlob } from '../document-read.js';
import { validateDocumentIngress, MAX_DOCUMENT_BYTES } from '../document-ingress.js';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobGcJournalRepo } from '../repo.memory.js';
import { InMemoryBlobStore } from '../blob-store.memory.js';
import { runBlobGcCycle } from '../blob-gc.js';

function fixture() {
  let id = 0;
  return { clock: { nowMs: () => Date.parse('2026-10-18T00:00:00Z') }, idGen: { newId: () => `doc-${++id}` },
    mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}),
    renditionRepo: new InMemoryAssetRenditionRepo({}), blobStore: new InMemoryBlobStore(),
    journalRepo: new InMemoryBlobGcJournalRepo({}), referenceCheck: { findReferences: async () => [] } };
}
const input = { workspaceId: 'site-a', filename: 'guide.md', kind: 'document' as const,
  contentType: 'application/octet-stream', bytes: Buffer.from('# Guide\n'), createdByPrincipal: 'uploader' };

test('Library: document upload deduplicates, is absent from media lists, rename preserves bytes/hash/creator/name', async () => {
  const deps = fixture();
  const first = (await uploadMedia({ deps, input })).media;
  const second = (await uploadMedia({ deps, input })).media;
  assert.notEqual(first.id, second.id);
  assert.equal(first.kind, 'document');
  assert.equal(first.originalFilename, 'guide.md');
  assert.equal((await deps.blobRepo.list({ workspaceId: 'site-a' })).length, 1);
  assert.deepEqual((await listMedia({ deps, input: { workspaceId: 'site-a' } })).media, []);
  assert.equal((await listMedia({ deps, input: { workspaceId: 'site-a', kind: 'document' } })).media.length, 2);
  await updateMediaMetadata({ deps, input: { workspaceId: 'site-a', id: first.id, title: 'Renamed' } });
  const renamed = await deps.mediaRepo.findById({ workspaceId: 'site-a', id: first.id });
  assert.equal(renamed?.title, 'Renamed');
  assert.equal(renamed?.source.sha256, first.source.sha256);
  assert.equal(renamed?.createdBy, 'uploader');
  assert.equal(renamed?.originalFilename, 'guide.md');
  const blob = await deps.blobRepo.findByHash({ workspaceId: 'site-a', sha256: first.source.sha256 });
  assert.deepEqual(Buffer.from(await deps.blobStore.get({ storageKey: blob!.storageKey })), input.bytes);
  assert.equal((await deps.renditionRepo.listByAsset({ workspaceId: 'site-a', assetId: first.id })).length, 1);
});

test('Library: document Trash/restore/purge leaves shared bytes until all references are gone', async () => {
  const deps = fixture();
  const a = (await uploadMedia({ deps, input })).media;
  const b = (await uploadMedia({ deps, input })).media;
  await trashMedia({ deps, input: { workspaceId: 'site-a', id: a.id } });
  await assert.rejects(readDocumentText({ deps, input: { workspaceId: 'site-a', id: a.id } }));
  const trashed = await deps.mediaRepo.findById({ workspaceId: 'site-a', id: a.id });
  await deps.mediaRepo.save({ ...trashed!, status: 'active' });
  assert.equal((await readDocumentText({ deps, input: { workspaceId: 'site-a', id: a.id } })).text, '# Guide\n');
  for (const doc of [a, b]) {
    await trashMedia({ deps, input: { workspaceId: 'site-a', id: doc.id } });
    await purgeMedia({ deps, input: { workspaceId: 'site-a', id: doc.id } });
    const blob = await deps.blobRepo.findByHash({ workspaceId: 'site-a', sha256: a.source.sha256 });
    assert.equal(blob?.status, doc.id === a.id ? 'active' : 'tombstoned');
  }
  deps.clock.nowMs = () => Date.parse('2027-10-18T00:00:00Z');
  await runBlobGcCycle({ deps, input: { workspaceId: 'site-a' } });
  assert.deepEqual(await deps.blobRepo.list({ workspaceId: 'site-a' }), []);
});

test('Library isolation: retained orphan/tombstone metadata denies bytes; staged bytes and live media owners remain usable', async () => {
  const deps = fixture();
  const doc = (await uploadMedia({ deps, input })).media;
  const probe = { deps, input: { workspaceId: input.workspaceId, sha256: doc.source.sha256 } };
  assert.equal(await isDocumentOnlyBlob(probe), true);
  await trashMedia({ deps, input: { workspaceId: input.workspaceId, id: doc.id } });
  await purgeMedia({ deps, input: { workspaceId: input.workspaceId, id: doc.id } });
  assert.equal(await isDocumentOnlyBlob(probe), true, 'purging the last document does not declassify retained bytes');
  const blob = await deps.blobRepo.findByHash(probe.input); assert.ok(blob);
  await deps.blobRepo.save({ ...blob, status: 'active', tombstonedAt: undefined });
  assert.equal(await isDocumentOnlyBlob(probe), true, 'orphaned active metadata is also denied');
  await deps.mediaRepo.save({ ...doc, id: 'ordinary-owner', slug: 'ordinary-owner', kind: 'media', status: 'active' });
  assert.equal(await isDocumentOnlyBlob(probe), false, 'a live ordinary-media source owner makes shared bytes publishable');
  await deps.mediaRepo.save({ ...doc, id: 'ordinary-owner', slug: 'ordinary-owner', kind: 'media', status: 'trashed' });
  assert.equal(await isDocumentOnlyBlob(probe), true);
  const staged = { workspaceId: 'site-b', sha256: doc.source.sha256 };
  await deps.blobStore.putIfAbsent({ ...staged, bytes: input.bytes });
  assert.equal(await isDocumentOnlyBlob({ deps, input: staged }), false, 'peer staging creates no asset metadata');
});

test('Library: UTF-8 paging at 64 KiB preserves multibyte source and rejects wrong-site, binary and bad offsets', async () => {
  const deps = fixture();
  const source = 'a'.repeat(DOCUMENT_TEXT_PAGE_BYTES - 1) + '🌍'.repeat(40_000);
  const doc = (await uploadMedia({ deps, input: { ...input, bytes: Buffer.from(source) } })).media;
  let offset = 0; let text = '';
  do {
    const page = await readDocumentText({ deps, input: { workspaceId: 'site-a', id: doc.id, offset } });
    assert.ok(Buffer.byteLength(page.text) <= 65536);
    assert.equal(page.untrusted, true);
    text += page.text;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  } while (true);
  assert.equal(text, source);
  await assert.rejects(readDocumentText({ deps, input: { workspaceId: 'site-b', id: doc.id } }));
  await assert.rejects(readDocumentText({ deps, input: { workspaceId: 'site-a', id: doc.id, offset: -1 } }));
  await assert.rejects(readDocumentText({ deps, input: { workspaceId: 'site-a', id: doc.id, offset: 65536 } }));
});

test('Library: ignore declared MIME; reject fake PDF/DOCX, invalid UTF-8, binary controls, JSON, paths and oversize', async () => {
  for (const [filename, bytes] of [
    ['fake.pdf', Buffer.from('<html>not PDF</html>')], ['fake.docx', Buffer.from('PK fake archive')],
    ['bad.md', Buffer.from([0xc3, 0x28])], ['bad.txt', Buffer.from('hello\0world')],
    ['bad.json', Buffer.from('{oops')], ['../guide.md', Buffer.from('text')],
    ['big.txt', Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 65)],
  ] as const) await assert.rejects(validateDocumentIngress({ filename, bytes }));
  assert.equal((await validateDocumentIngress({ filename: 'a.json', bytes: Buffer.from('{"ok":true}') })).contentType, 'application/json');
});

test('Library PDF: high-bit counterfeit signatures are rejected byte-for-byte', async () => {
  const signature = Buffer.from('%PDF-1.7');
  assert.equal((await validateDocumentIngress({ filename: 'real.pdf', bytes: signature })).contentType, 'application/pdf');
  // Each byte would be restored to its ASCII counterpart by the old lossy decoder.
  for (let i = 0; i < signature.length; i++) {
    const counterfeit = Buffer.from(signature); counterfeit[i] = counterfeit[i]! | 0x80;
    await assert.rejects(validateDocumentIngress({ filename: 'counterfeit.pdf', bytes: counterfeit }), /PDF signature/);
  }
});

test('Library: 10 MiB is inclusive and host media overrides never relax document ingress', async () => {
  const deps = fixture();
  const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES, 65);
  assert.equal((await uploadMedia({ deps, input: { ...input, filename: 'max.txt', bytes } }, { maxUploadBytes: MAX_DOCUMENT_BYTES * 5 })).media.kind, 'document');
  await assert.rejects(uploadMedia({ deps, input: { ...input, filename: 'large.txt', bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 65) } }, { maxUploadBytes: MAX_DOCUMENT_BYTES * 5 }));
  await assert.rejects(uploadMedia({ deps, input: { ...input, filename: 'fake.pdf', bytes: Buffer.from('plain text') } }, { allowedMimeTypes: new Set(['application/octet-stream']) }));
  assert.equal((await deps.mediaRepo.list({ workspaceId: 'site-a' })).length, 1);
});
