import { expect, it } from 'vitest';
import { handleSlugRouteError, classifySlugFailure, postNotFoundPage } from '../post-not-found.js';
import { PostNotFoundError } from '../../../../../../posts/post.js';
import { ListingBatchNotFoundError } from '../../../../../../listing/request-state.js';

it('redirects before rendering a 404 or recording not-found and classifies listing failures first', async () => {
  const order: string[] = [];
  expect(await postNotFoundPage({
    fallbackHtml: 'fallback', redirect: async () => { order.push('redirect'); return true; },
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

it('turns a themed 404 render failure inside the slug catch into the same reported 500', async () => {
  const calls: unknown[] = [];
  const error = new Error('404 rendering');
  await handleSlugRouteError({ err: Object.create(PostNotFoundError.prototype), listing: () => { calls.push('listing'); },
    missing: async () => { throw error; }, report: err => { calls.push(err); }, sendFault: () => { calls.push(500); } });
  expect(calls).toEqual([error, 500]);
});
