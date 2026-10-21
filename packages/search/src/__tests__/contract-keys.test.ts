import { createHash } from 'node:crypto';
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

const identityOf = (parts: readonly string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);

test('searchIndexName is a provider label, a digest of the full (install, site, provider) identity and the generation', () => {
  expect(searchIndexName({ installId: 'Inst-1', siteId: 'My Site', providerId: 'meilisearch', generation: 3 }))
    .toBe(`js_meilisearch_${identityOf(['Inst-1', 'My Site', 'meilisearch'])}_g3`);
  expect(searchIndexName({ installId: '***', siteId: 's', providerId: '***', generation: 0 })).toBe(`js_x_${identityOf(['***', 's', '***'])}_g0`);
  const long = searchIndexName({ installId: 'i'.repeat(500), siteId: 's'.repeat(500), providerId: 'p'.repeat(500), generation: Number.MAX_SAFE_INTEGER });
  expect(long.length).toBeLessThanOrEqual(120);
  expect(long).toMatch(/^[a-z0-9_]+_g9007199254740991$/);
});

test('searchIndexName never collides for identities a lossy slug would merge', () => {
  const name = (installId: string, siteId: string, providerId = 'meilisearch', generation = 1) => searchIndexName({ installId, siteId, providerId, generation });
  const pairs: [string, string][] = [
    [name('inst', 'site-a'), name('inst', 'site_a')],
    [name('inst', 'Site A'), name('inst', 'site a')],
    [name('inst', `${'x'.repeat(40)}one`), name('inst', `${'x'.repeat(40)}two`)],
    [name(`${'i'.repeat(40)}1`, 's'), name(`${'i'.repeat(40)}2`, 's')],
    [name('a_b', 'c'), name('a', 'b_c')],
    [name('inst', 's', 'meili-search'), name('inst', 's', 'meili_search')],
    [name('inst', 's', 'p', 1), name('inst', 's', 'p', 11)],
  ];
  for (const [left, right] of pairs) expect(left).not.toBe(right);
  for (const value of pairs.flat()) expect(value).toMatch(/^[a-z0-9_]{1,120}$/);
});
