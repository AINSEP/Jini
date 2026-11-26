import { expect, it } from 'vitest';
import { classifySlugFailure, postNotFoundPage } from '../post-not-found.js';
import { PostNotFoundError } from '../../../../../../posts/post.js';
import { ListingBatchNotFoundError } from '../../../../../../listing/request-state.js';

it('redirects before rendering a 404 or recording not-found and classifies listing failures first', async () => {
  const order: string[] = [];
  expect(await postNotFoundPage({
    redirect: async () => { order.push('redirect'); return true; },
    theme: { manifest: { tier: 'static' }, pages: { '404': 'not found' } },
    currentPath: '/missing', staticMenus: undefined,
    finishStaticTierDocument: async () => { order.push('render'); return 'not found'; },
    recordNotFound: () => { order.push('metric'); },
  })).toEqual({ kind: 'handled' });
  expect(order).toEqual(['redirect']);
  expect(classifySlugFailure({ err: Object.create(ListingBatchNotFoundError.prototype) })).toBe('listing');
  expect(classifySlugFailure({ err: Object.create(PostNotFoundError.prototype) })).toBe('missing');
  expect(classifySlugFailure({ err: new Error('fault') })).toBe('fault');
});
