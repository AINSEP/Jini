import { expect, it } from 'vitest';
import { mediaProviderCatalogRoute } from '../provider-catalog.js';

it('authorizes media.read before catalog lookup and returns exactly the providers envelope', async () => {
  const order: unknown[] = [];
  const providers: [] = [];
  const deps = { workspaceId: 'w', listCatalog: () => { order.push('catalog'); return providers; } };
  const input = { input: {}, deps, context: { id: 'owner' }, authorize: async (required: unknown) => { order.push(required); } };
  expect(await mediaProviderCatalogRoute.handle(input, { signal: new AbortController().signal })).toEqual({ ok: true, value: { providers } });
  expect(order).toEqual([{ permission: 'media.read', entityType: 'media' }, 'catalog']);
  order.length = 0;
  await expect(mediaProviderCatalogRoute.handle({ ...input, authorize: async () => { throw new Error('denied'); } }, { signal: new AbortController().signal })).rejects.toThrow('denied');
  expect(order).toEqual([]);
});
