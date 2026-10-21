import { expect, test } from 'vitest';
import { decodeSearchKey, encodeSearchKey, searchIndexName } from '../contract.js';

test('search keys round-trip, and a slash inside a part cannot forge another key', () => {
  const key = { siteId: 's/1', workspaceId: 'w', collection: 'post', documentId: 'a b' };
  const encoded = encodeSearchKey({ key });
  expect(encoded).toBe('s%2F1/w/post/a%20b');
  expect(decodeSearchKey({ encoded })).toEqual(key);
});

test('decodeSearchKey refuses anything that is not four well-formed parts', () => {
  expect(decodeSearchKey({ encoded: 'a/b/c' })).toBeUndefined();
  expect(decodeSearchKey({ encoded: 'a/b/c/d/e' })).toBeUndefined();
  expect(decodeSearchKey({ encoded: 'a/b/c/%E0%A4%A' })).toBeUndefined();
});

test('searchIndexName is derived from install, site, provider and generation', () => {
  expect(searchIndexName({ installId: 'Inst-1', siteId: 'My Site', providerId: 'meilisearch', generation: 3 })).toBe('js_inst_1_my_site_meilisearch_g3');
  expect(searchIndexName({ installId: '***', siteId: 's', providerId: 'p', generation: 0 })).toBe('js_x_s_p_g0');
  expect(searchIndexName({ installId: 'i'.repeat(50), siteId: 's'.repeat(50), providerId: 'p'.repeat(50), generation: 1 }).length).toBeLessThanOrEqual(120);
});
