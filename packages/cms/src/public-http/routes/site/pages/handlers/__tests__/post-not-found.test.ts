import { expect, it, vi } from 'vitest';
import { handleSlugRouteError, classifySlugFailure, postNotFoundPage, handlePostNotFoundOnSlugRoute } from '../post-not-found.js';
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

it.each([
  { tier: 'static', pages: { '404': 'theme source' }, finished: 'rendered 404', html: 'rendered 404', renders: true },
  { tier: 'static', pages: { '404': 'theme source' }, finished: undefined, html: 'fallback', renders: true },
  { tier: 'templated', pages: { '404': 'theme source' }, finished: 'rendered 404', html: 'fallback', renders: false },
  { tier: 'static', pages: {}, finished: 'rendered 404', html: 'fallback', renders: false },
  { tier: null, pages: {}, finished: 'rendered 404', html: 'fallback', renders: false },
] as const)('writes 404 for tier=$tier, pages=$pages and rendered HTML=$finished', async ({ tier, pages, finished, html, renders }) => {
  const theme = tier === null ? null : { manifest: { tier }, pages };
  const staticMenus = { header: ['Home'] };
  const finishStaticTierDocument = vi.fn(async () => finished);
  const recordNotFound = vi.fn();
  const send = vi.fn();
  await handlePostNotFoundOnSlugRoute({
    redirect: async () => false, theme, currentPath: '/missing/article', staticMenus,
    finishStaticTierDocument, recordNotFound, fallbackHtml: 'fallback', send,
  });
  expect(finishStaticTierDocument.mock.calls).toEqual(renders ? [[{
    theme, currentPath: '/missing/article', staticMenus, pageId: '404', html: 'theme source',
  }]] : []);
  expect(recordNotFound).toHaveBeenCalledExactlyOnceWith();
  expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'page', status: 404, html });
});

it('does not send or record a 404 when its post-content redirect handled the response', async () => {
  const send = vi.fn();
  const recordNotFound = vi.fn();
  const finishStaticTierDocument = vi.fn(async () => 'rendered 404');
  await handlePostNotFoundOnSlugRoute({
    redirect: async () => true, theme: { manifest: { tier: 'static' }, pages: { '404': 'theme source' } },
    currentPath: '/old/article', staticMenus: {}, finishStaticTierDocument, recordNotFound,
    fallbackHtml: 'fallback', send,
  });
  expect(send).not.toHaveBeenCalled();
  expect(finishStaticTierDocument).not.toHaveBeenCalled();
  expect(recordNotFound).not.toHaveBeenCalled();
});

it.each([
  { classification: 'listing', err: new ListingBatchNotFoundError() },
  { classification: 'missing', err: new PostNotFoundError('no published post') },
  { classification: 'fault', err: new Error('database disconnected') },
] as const)('routes a $classification failure to its own response path', async ({ classification, err }) => {
  const calls: unknown[] = [];
  await handleSlugRouteError({ err, listing: () => { calls.push('listing'); },
    missing: async () => { calls.push('missing'); }, report: error => { calls.push(error); }, sendFault: () => { calls.push(500); } });
  expect(calls).toEqual(classification === 'fault' ? [err, 500] : [classification]);
});
