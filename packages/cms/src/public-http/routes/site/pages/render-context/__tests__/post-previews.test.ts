import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { parseListingBatchSize } from '../../../../../../listing/batch.js';
import { createListingRequestState, ListingBatchNotFoundError } from '../../../../../../listing/request-state.js';
import { deriveExcerpt } from '../../../../../../seo/seo.js';
import { featuredImageView } from '../../../../../http/site/render/template-render-data.js';
import { resolvePostPreviewsForRender } from '../post-previews.js';

it('fills visible batches before paging, shares the widest plain batch and keeps the first duplicate key', async () => {
  const posts: PublicPostRecord[] = ['hidden', 'one', 'two', 'three'].map(id => ({ id, workspaceId: 'w', title: id, slug: id,
    bodyJson: {}, kind: 'post', bodyFormat: 'html', bodyHtml: '<p>Excerpt</p>', status: 'published', updatedAt: '2026-01-02T00:00:00Z', version: 1 }));
  const order: string[] = [];
  const read = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => { order.push('read'); return { posts: posts.slice(offset, offset + limit) }; });
  const listed = vi.fn(async (_required: { post: undefined }, optional: { listed?: readonly PublicPostRecord[] } = {}) => {
    expect(optional.listed?.every(post => post.id !== 'hidden')).toBe(true);
    order.push('media'); return new Map();
  });
  const listingBatch = { pagePath: '/blog', key: 7, after: 2, format: 'json' as const };
  const req = {};
  const listingState = createListingRequestState({});
  listingState.recordListingBatchRequest({ req, listingBatch });
  const result = await resolvePostPreviewsForRender({ deps: {
    workspaceId: 'w', listingBatch, listingPage: 1, deriveExcerpt,
    listPublishedPostPreviews: read,
    decidePostMemberAccess: ({ post }) => ({ allowed: post.id !== 'hidden' }),
    postPreviewsBatchSize: marker => parseListingBatchSize({ config: marker.config }, { fallback: 6 }),
    isPagedPostPreviewsMarker: marker => marker.config.paged === true,
    resolveMediaAssetMetadataForRender: listed, resolveMediaTransformVersionsForRender: async () => new Map(),
    siteTimeZoneDep: () => ({}), postPublicPath: ({ slug }) => '/' + slug, featuredImageView,
    resolveAssignedTermsForRender: async () => [{ termId: 't', termName: 'Topic', taxonomyName: 'Tags' }], listingState,
  }, pageHtml: `<div data-embed-config='{"type":"post-previews","limit":1}'></div><div data-embed-config='{"type":"post-previews","limit":2}'></div><div data-jini-listing="7" data-embed-config='{"type":"post-previews","limit":1}'><template data-jini-card>card</template></div><div data-jini-listing="7" data-embed-config='{"type":"post-previews","limit":9}'></div>`, pagePath: '/blog' });
  expect(result?.previews.map(post => post.title)).toEqual(['one', 'two']);
  expect(result?.batches.get(7)?.items.map(post => post.title)).toEqual(['two']);
  expect(result?.batches.get(7)?.nextHref).toBe('/blog/_more/7/3.json');
  expect(read.mock.calls.map(([input]) => input)).toEqual([
    { offset: 0, limit: 3 }, { offset: 3, limit: 3 }, { offset: 2, limit: 2 },
  ]);
  const json = listingState.listingBatchBody({ req, html: '' });
  expect(json?.format).toBe('json');
  expect(JSON.parse(json!.body)).toEqual({ items: [{ title: 'two', href: '/two', date: '2026-01-02T00:00:00Z',
    dateLabel: 'Jan 2, 2026', excerpt: 'Excerpt', cover: null, terms: ['Topic'] }], nextCursor: 3 });
  expect(order.indexOf('media')).toBeGreaterThan(order.lastIndexOf('read'));
});

it('reports a missing numbered page after visibility filtering', async () => {
  const post: PublicPostRecord = { id: 'hidden', workspaceId: 'w', title: 'hidden', slug: 'hidden', bodyJson: {},
    kind: 'post', bodyFormat: 'html', bodyHtml: '', status: 'published', updatedAt: '2026-01-02T00:00:00Z', version: 1 };
  const media = vi.fn(async () => new Map());
  await expect(resolvePostPreviewsForRender({ deps: {
    workspaceId: 'w', listingBatch: undefined, listingPage: 2, deriveExcerpt,
    listPublishedPostPreviews: async () => ({ posts: [post] }), decidePostMemberAccess: () => ({ allowed: false }),
    postPreviewsBatchSize: () => 2, isPagedPostPreviewsMarker: marker => marker.config.paged === true,
    resolveMediaAssetMetadataForRender: media, resolveMediaTransformVersionsForRender: async () => new Map(),
    siteTimeZoneDep: () => ({}), postPublicPath: ({ slug }) => '/' + slug, featuredImageView,
    resolveAssignedTermsForRender: async () => [], listingState: createListingRequestState({}),
  }, pageHtml: `<div data-embed-config='{"type":"post-previews","paged":true}'></div>`, pagePath: '/blog' })).rejects.toBeInstanceOf(ListingBatchNotFoundError);
  expect(media).not.toHaveBeenCalled();
});

it('renders the second visible page with both navigation links and only that page’s cover inputs', async () => {
  const posts: PublicPostRecord[] = ['one', 'private', 'two', 'three'].map(slug => ({
    id: slug, slug, title: slug, workspaceId: 'w', kind: 'post', bodyFormat: 'html', bodyJson: {},
    bodyHtml: '<p>Body</p>', status: 'published', updatedAt: '2026-01-02T00:00:00Z', version: 1,
  }));
  const media = vi.fn(async () => new Map());
  const result = await resolvePostPreviewsForRender({ deps: {
    workspaceId: 'w', listingPage: 2, listingBatch: undefined, deriveExcerpt,
    listPublishedPostPreviews: async ({ offset, limit }) => ({ posts: posts.slice(offset, offset + limit) }),
    decidePostMemberAccess: ({ post }) => ({ allowed: post.id !== 'private' }),
    postPreviewsBatchSize: () => 1, isPagedPostPreviewsMarker: marker => marker.config.paged === true,
    resolveMediaAssetMetadataForRender: media, resolveMediaTransformVersionsForRender: async () => new Map(),
    siteTimeZoneDep: () => ({}), postPublicPath: ({ slug }) => '/' + slug, featuredImageView,
    resolveAssignedTermsForRender: async () => [], listingState: createListingRequestState({}),
  }, pageHtml: `<div data-embed-config='{"type":"post-previews","paged":true}'></div>`, pagePath: '/news' });
  expect(result?.previews).toEqual([]);
  expect(result?.page?.items.map(({ href }) => href)).toEqual(['/two']);
  expect(result?.page?.nav).toBe('<nav class="jini-pagination" aria-label="Pagination"><a class="jini-pagination-prev" rel="prev" href="/news">Newer posts</a> <span class="jini-pagination-status">Page 2 of 3</span> <a class="jini-pagination-next" rel="next" href="/news/page/3">Older posts</a></nav>');
  expect(media).toHaveBeenCalledExactlyOnceWith({ post: undefined }, { listed: [posts[2]] });
});
