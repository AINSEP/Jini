import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import type { MediaRecord } from '../../../../../../media/types.js';
import { InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from '../../../../../../media/repo.memory.js';
import { collectCoverMediaRefs } from '../../../../../../media/cover-image.js';
import { getLatestTransformDefinition } from "../../../../../../media/transform-registry.js";
import { featuredImageView } from "../../../../../http/site/render/template-render-data.js";
import { resolveMediaAssetMetadataForRender, resolveMediaTransformVersionsForRender, resolveFeaturedImageForRender } from '../media-metadata.js';

it('does no media or MIME reads without media references', async () => {
  const findMediaByIdOrSlug = vi.fn(async () => null);
  const getMany = vi.fn(async () => new Map<string, string>());
  const result = await resolveMediaAssetMetadataForRender({ deps: {
    workspaceId: 'w', mediaRepo: new InMemoryMediaRepo({}), mediaContentTypeStore: { getMany },
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
    workspaceId: 'w', mediaRepo: new InMemoryMediaRepo({}), mediaContentTypeStore: { getMany }, collectCoverMediaRefs,
    findMediaByIdOrSlug: async ({ input }) => { order.push(input.idOrSlug); return input.idOrSlug === 'gone' ? null : input.idOrSlug === 'trashed' ? { ...record, status: 'trashed' } : record; },
    resolveMediaCaptionsTrack: async () => null,
  }, post });
  expect([...result]).toEqual([['authored-slug', { width: 10, height: 20, cssClass: null, htmlAttributes: null,
    slug: 'authored-slug', sha256: 'hash', contentType: 'video/mp4' }]]);
  expect(getMany).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'w', sha256s: ['hash'] });
  expect(order).toEqual(['authored-slug', 'gone', 'trashed', 'mime']);
});

function featuredFixture() {
  const post: PublicPostRecord = { id: 'feature', workspaceId: 'coast', title: 'Coastline', slug: 'coastline', bodyJson: {},
    kind: 'post', bodyFormat: 'doc', bodyHtml: null, status: 'published', updatedAt: '2026-01-02T00:00:00Z', version: 1 };
  const record: MediaRecord = { id: 'asset-7', workspaceId: 'coast', title: 'Asset', slug: 'sunset-on-coast',
    alt: '', caption: '', credit: '', source: { sha256: 'aabbccddeeff0123' }, status: 'active',
    createdAt: 'now', updatedAt: 'now', version: 1, width: 80, height: 60, cssClass: null, htmlAttributes: null };
  const getMany = vi.fn(async () => new Map([['aabbccddeeff0123', 'image/png']]));
  const findMediaByIdOrSlug = vi.fn<Parameters<typeof resolveMediaAssetMetadataForRender>[0]['deps']['findMediaByIdOrSlug']>(
    async ({ input }) => input.workspaceId === 'coast' && input.idOrSlug === 'asset-7' ? record : null,
  );
  const transformDefinitionRepo = new InMemoryTransformDefinitionRepo({});
  const deps = {
    workspaceId: 'coast', mediaRepo: new InMemoryMediaRepo({}), transformDefinitionRepo,
    getLatestTransformDefinition, CORE_PUBLIC_TRANSFORM_NAME: 'public', featuredImageView, collectCoverMediaRefs,
    mediaContentTypeStore: { getMany }, findMediaByIdOrSlug, resolveMediaCaptionsTrack: async () => null,
  };
  async function insertTransform(workspaceId: string, name: string, version: number) {
    await transformDefinitionRepo.insert({ id: [workspaceId, name, version].join(':'), workspaceId, name, version,
      params: { format: 'webp' }, owner: 'core', createdAt: '2026-01-02T00:00:00Z' });
  }
  return { deps, post, getMany, findMediaByIdOrSlug, insertTransform };
}

it('only projects the latest version of the configured public transform from this workspace', async () => {
  const { deps, insertTransform } = featuredFixture();
  await insertTransform('other-site', 'public', 18);
  await insertTransform('coast', 'private', 90);
  expect(await resolveMediaTransformVersionsForRender({ deps })).toEqual(new Map());
  await insertTransform('coast', 'public', 4);
  await insertTransform('coast', 'public', 2);
  expect(await resolveMediaTransformVersionsForRender({ deps })).toEqual(new Map([['public', 4]]));
});

it('uses the authored cover ID but renders its public slug, source version and dimensions', async () => {
  const { deps, post, insertTransform, getMany, findMediaByIdOrSlug } = featuredFixture();
  await insertTransform('coast', 'public', 4);
  expect(await resolveFeaturedImageForRender({ deps, post: { ...post, featuredMediaId: 'asset-7' } })).toEqual({
    url: '/m/sunset-on-coast/public.v4/image.jpg?v=aabbccddeeff', alt: 'Coastline', width: 80, height: 60,
  });
  expect(findMediaByIdOrSlug.mock.calls.map(([{ input }]) => input)).toEqual([{ workspaceId: 'coast', idOrSlug: 'asset-7' }]);
  expect(getMany).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'coast', sha256s: ['aabbccddeeff0123'] });
});

it('does not read media or transforms for a post without a cover reference', async () => {
  const { deps, post, getMany, findMediaByIdOrSlug } = featuredFixture();
  const readTransform = vi.fn<typeof getLatestTransformDefinition>(async () => null);
  expect(await resolveFeaturedImageForRender({ deps: { ...deps, getLatestTransformDefinition: readTransform }, post })).toBeNull();
  expect(readTransform).not.toHaveBeenCalled();
  expect(findMediaByIdOrSlug).not.toHaveBeenCalled();
  expect(getMany).not.toHaveBeenCalled();
});
