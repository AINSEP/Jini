import { expect, it } from 'vitest';
import { listingState } from './listing-state.js';

it('returns the JSON listing batch for the requesting object only', async () => {
  const request = { url: '/news/_more/2/8.json' };
  const anotherRequest = { ...request };
  const batch = { pagePath: '/news', key: 2, after: 8, format: 'json' as const };
  listingState.recordListingBatchRequest({ req: request, listingBatch: batch });
  await listingState.storeListingJsonPage({ listingBatch: batch, keyed: new Map([
    [1, { posts: [{ slug: 'unrelated' }], next: null }],
    [2, { posts: [{ slug: 'tides' }, { slug: 'weather' }], next: 10 }],
  ]), toItem: ({ post }) => ({ href: '/' + post.slug }) });
  expect(listingState.listingBatchBody({ req: request, html: '<main>Full page</main>' })).toEqual({
    format: 'json', body: '{"items":[{"href":"/tides"},{"href":"/weather"}],"nextCursor":10}',
  });
  expect(listingState.listingBatchBody({ req: anotherRequest, html: '<main>Full page</main>' })).toBeUndefined();
});
