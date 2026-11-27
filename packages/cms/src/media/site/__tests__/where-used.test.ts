import { expect, it, vi } from 'vitest';
import { InMemoryEntryRefsRepo } from '../../../widgets/entry-refs.memory.js';
import type { EntryRefRow } from '../../../widgets/ports.js';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from '../../repo.memory.js';
import { MediaStillReferencedError, type MediaRecord } from '../../types.js';
import { findMediaWhereUsed } from '../where-used.js';
import { purgeMedia } from '../purge-media.js';

const workspaceId = 'west';
const mediaId = 'asset-17';
const slug = 'current-photo';
const retired = 'old-photo';
const input = { workspaceId, mediaId, slug };

const row = (sourceEntryId: string, fieldPath: string, targetId: string, scope = workspaceId): EntryRefRow => ({
  workspaceId: scope, sourceEntryId, sourceKind: 'config-field', fieldPath, targetKind: 'asset', targetId,
});

it('replaces stale post index entries with current bodies and finds retired-slug references', async () => {
  const entryRefsRepo = new InMemoryEntryRefsRepo();
  for (const ref of [
    row('widget', 'config.cover', mediaId), row('widget', 'config.cover', retired),
    row('edited-away', 'bodyHtml', slug), row('trashed', 'bodyHtml', retired),
    row('east-widget', 'config.cover', mediaId, 'east'),
  ]) {
    const scope = { workspaceId: ref.workspaceId, sourceEntryId: ref.sourceEntryId };
    const existing = await entryRefsRepo.findBySource(scope);
    await entryRefsRepo.replaceForSource({ ...scope, refs: [...existing, ref] });
  }
  const postRepo = { list: vi.fn<Parameters<typeof findMediaWhereUsed>[0]['deps']['postRepo']['list']>(async ({ workspaceId }) => {
    if (workspaceId !== 'west') throw new Error('wrong workspace');
    return [
      { id: 'live-doc', bodyFormat: 'doc', bodyJson: { type: 'doc', content: [{ type: 'image', attrs: { assetId: mediaId } }] }, bodyHtml: null },
      { id: 'live-html', bodyFormat: 'html', bodyJson: null, bodyHtml: '<img src="/m/old-photo/original">' },
      { id: 'edited-away', bodyFormat: 'html', bodyJson: null, bodyHtml: '<img src="/m/unrelated/original">' },
      { id: 'trashed', bodyFormat: 'html', bodyJson: null, bodyHtml: '<img src="/m/current-photo/original">', deletedAt: '2026-11-20' },
    ];
  }) };
  const listRetiredSlugs = vi.fn<Parameters<typeof findMediaWhereUsed>[0]['deps']['mediaRepo']['listRetiredSlugs']>(async () => [retired]);
  const deps = { entryRefsRepo, postRepo, mediaRepo: { listRetiredSlugs } };

  const visible = [row('widget', 'config.cover', retired), row('live-doc', 'bodyJson', mediaId), row('live-html', 'bodyHtml', mediaId)];
  expect(await findMediaWhereUsed({ deps, input })).toEqual({ count: 3, references: visible });
  expect(await findMediaWhereUsed({ deps, input }, { includeTrashed: true })).toEqual({
    count: 4, references: [...visible, row('trashed', 'bodyHtml', mediaId)],
  });
  expect(postRepo.list.mock.calls).toEqual([[{ workspaceId }], [{ workspaceId }]]);
  expect(listRetiredSlugs.mock.calls).toEqual([[{ workspaceId, mediaId }], [{ workspaceId, mediaId }]]);
});

it('site purge is blocked by a restorable post and succeeds only after that reference is gone', async () => {
  const asset: MediaRecord = {
    id: mediaId, workspaceId, title: 'Photo', slug, status: 'trashed', source: { sha256: 'a'.repeat(64) },
    alt: '', caption: '', credit: '', createdAt: '2026-11-19', updatedAt: '2026-11-20', version: 4,
    width: null, height: null, cssClass: null, htmlAttributes: null,
  };
  const mediaRepo = Object.assign(new InMemoryMediaRepo({}, { initialRows: [asset] }), {
    listRetiredSlugs: async () => [retired],
  });
  let restorable = true;
  const deps: Parameters<typeof purgeMedia>[0]['deps'] = {
    mediaRepo, blobRepo: new InMemoryAssetBlobRepo({}), renditionRepo: new InMemoryAssetRenditionRepo({}),
    clock: { nowMs: () => 0 }, entryRefsRepo: new InMemoryEntryRefsRepo(),
    postRepo: { list: async () => restorable ? [{ id: 'previous-post', bodyFormat: 'html', bodyJson: null,
      bodyHtml: '<img src="/m/old-photo/original">', deletedAt: '2026-11-20' }] : [] },
  };
  const required = { deps, input: { workspaceId, id: mediaId } };
  const refused = purgeMedia(required);
  await expect(refused).rejects.toBeInstanceOf(MediaStillReferencedError);
  await expect(refused).rejects.toMatchObject({ message: "media 'asset-17' is still referenced", referencing: ['previous-post:bodyHtml'] });
  expect(await mediaRepo.findById(required.input)).toEqual(asset);
  restorable = false;
  expect(await purgeMedia(required)).toEqual({ purged: true });
  expect(await mediaRepo.findById(required.input)).toBeNull();
});
