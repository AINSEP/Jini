import { it, expect } from 'vitest';
import { createMemoryMediaApi } from '../adapters/memory.js';
import { filterMediaByTab, resolveActiveTab, safeMediaUrl, acceptsMedia } from '../rules.js';
it('keeps untyped and opaque assets on All and resolves unknown tabs safely', async () => {
  const api = createMemoryMediaApi({});
  const image = await api.upload({
    filename: 'a.svg',
    contentType: 'image/svg+xml',
    dataBase64: '',
  });
  const unknown = { ...image, id: 'unknown', contentType: null };
  expect(filterMediaByTab({ media: [image, unknown], tab: 'images' })).toEqual([image]);
  expect(filterMediaByTab({ media: [image, unknown], tab: 'all' })).toHaveLength(2);
  expect(resolveActiveTab({ tabId: 'typo' })).toBe('all');
  expect(resolveActiveTab({ tabId: 'external-providers' })).toBe('external-providers');
  expect(acceptsMedia({ item: image, accept: ['image/*'] })).toBe(true);
  expect(acceptsMedia({ item: unknown, accept: ['image/*'] })).toBe(false);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.test',
    '/\\evil.test',
    'memory://opaque',
  ])
    expect(safeMediaUrl({ url })).toBeUndefined();
  expect(safeMediaUrl({ url: '/api/original' })).toBe('/api/original');
});
