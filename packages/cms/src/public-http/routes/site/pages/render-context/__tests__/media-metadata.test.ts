import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import type { MediaRecord } from '../../../../../../media/types.js';
import { InMemoryMediaRepo } from '../../../../../../media/repo.memory.js';
import { collectCoverMediaRefs } from '../../../../../../media/cover-image.js';
import { resolveMediaAssetMetadataForRender } from '../media-metadata.js';

it('does no media or MIME reads without media references', async () => {
  const findMediaByIdOrSlug = vi.fn(async () => null);
  const getMany = vi.fn(async () => new Map<string, string>());
  const result = await resolveMediaAssetMetadataForRender({ deps: {
    workspaceId: 'w', mediaRepo: new InMemoryMediaRepo(), mediaContentTypeStore: { getMany },
    collectCoverMediaRefs, findMediaByIdOrSlug, resolveMediaCaptionsTrack: async () => null,
  }, post: undefined });
  expect([...result]).toEqual([]);
  expect(findMediaByIdOrSlug).not.toHaveBeenCalled();
  expect(getMany).not.toHaveBeenCalled();
});

it('keeps authored keys and batches MIME once after filtering missing and trashed rows', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Post', slug: 'post',
    bodyJson: { type: 'doc', content: ['authored-slug', 'gone', 'trashed'].map(assetId => ({ type: 'media', attrs: { assetId } })) },
    kind: 'post', bodyFormat: 'doc', bodyHtml: null, status: 'published', updatedAt: 'now', version: 1 };
  const record: MediaRecord = { id: 'resolved-id', workspaceId: 'w', title: 'Asset', slug: 'authored-slug',
    alt: '', caption: '', credit: '', source: { sha256: 'hash' }, status: 'active', createdAt: 'now', updatedAt: 'now', version: 1,
    width: 10, height: 20, cssClass: null, htmlAttributes: null };
  const order: string[] = [];
  const getMany = vi.fn(async () => { order.push('mime'); return new Map([['hash', 'video/mp4']]); });
  const result = await resolveMediaAssetMetadataForRender({ deps: {
    workspaceId: 'w', mediaRepo: new InMemoryMediaRepo(), mediaContentTypeStore: { getMany }, collectCoverMediaRefs,
    findMediaByIdOrSlug: async ({ input }) => { order.push(input.idOrSlug); return input.idOrSlug === 'gone' ? null : input.idOrSlug === 'trashed' ? { ...record, status: 'trashed' } : record; },
    resolveMediaCaptionsTrack: async () => null,
  }, post });
  expect([...result]).toEqual([['authored-slug', { width: 10, height: 20, cssClass: null, htmlAttributes: null,
    slug: 'authored-slug', sha256: 'hash', contentType: 'video/mp4' }]]);
  expect(getMany).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'w', sha256s: ['hash'] });
  expect(order).toEqual(['authored-slug', 'gone', 'trashed', 'mime']);
});
