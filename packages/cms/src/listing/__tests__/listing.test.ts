import { describe, expect, it } from 'vitest';
import {
  LISTING_BATCH_MAX,
  arrayListingSource,
  assignListingKeys,
  extractListingBatch,
  extractListingMoreHrefs,
  injectListingScript,
  listingBatchPath,
  listingKeyOfAttributes,
  parseListingBatchPath,
  parseListingBatchSize,
  readListingBatch,
  renderListingBatchDocument,
  renderListingMore,
  wrapListingItems,
} from '../index.js';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('readListingBatch', () => {
  it('pages an exact multiple, 0, 1, size and size+1 rows with hasMore/next', async () => {
    const read = (n: number, after: number) => readListingBatch({ source: arrayListingSource({ rows: rows(n) }), after, size: 3 });
    expect(await read(0, 0)).toEqual({ items: [], hasMore: false, next: 0 });
    expect(await read(1, 0)).toEqual({ items: [1], hasMore: false, next: 1 });
    expect(await read(3, 0)).toEqual({ items: [1, 2, 3], hasMore: false, next: 3 });
    expect(await read(4, 0)).toEqual({ items: [1, 2, 3], hasMore: true, next: 3 });
    expect(await read(6, 3)).toEqual({ items: [4, 5, 6], hasMore: false, next: 6 });
  });

  it('skips hidden rows without counting them as items, and the cursor moves past them', async () => {
    const source = arrayListingSource({ rows: rows(10) });
    const odd = (n: number) => n % 2 === 1;
    const first = await readListingBatch({ source, after: 0, size: 2 }, { isVisible: odd });
    expect(first).toEqual({ items: [1, 3], hasMore: true, next: 4 });
    const second = await readListingBatch({ source, after: first.next, size: 2 }, { isVisible: odd });
    expect(second).toEqual({ items: [5, 7], hasMore: true, next: 8 });
    expect(await readListingBatch({ source, after: 8, size: 2 }, { isVisible: odd })).toEqual({ items: [9], hasMore: false, next: 10 });
  });

  it('stops after a bounded number of scan rounds over hidden rows, still reporting more', async () => {
    const reads: number[] = [];
    const source = async ({ offset, limit }: { offset: number; limit: number }) => {
      reads.push(offset);
      return rows(100).slice(offset, offset + limit);
    };
    const batch = await readListingBatch({ source, after: 0, size: 2 }, { isVisible: () => false });
    expect(batch).toEqual({ items: [], hasMore: true, next: 12 });
    expect(reads).toEqual([0, 3, 6, 9]);
  });
});

describe('parseListingBatchSize', () => {
  it('clamps, floors and falls back', () => {
    expect(parseListingBatchSize({ config: {} })).toBe(12);
    expect(parseListingBatchSize({ config: {} }, { fallback: 6 })).toBe(6);
    expect(parseListingBatchSize({ config: { limit: 60 } })).toBe(LISTING_BATCH_MAX);
    expect(parseListingBatchSize({ config: { limit: 4.7 } })).toBe(4);
    for (const limit of [0, -1, '12', Number.NaN, Number.POSITIVE_INFINITY]) expect(parseListingBatchSize({ config: { limit } }, { fallback: 6 })).toBe(6);
    expect(parseListingBatchSize({ config: { max: 3 } }, { limitKey: 'max' })).toBe(3);
  });
});

describe('batch paths', () => {
  it('round-trips page and home paths', () => {
    expect(listingBatchPath({ pagePath: '/blog', key: 1, after: 12 })).toBe('/blog/_more/1/12');
    expect(listingBatchPath({ pagePath: '/', key: 2, after: 24 })).toBe('/_more/2/24');
    expect(parseListingBatchPath({ path: '/blog/_more/1/12' })).toEqual({ pagePath: '/blog', key: 1, after: 12 });
    expect(parseListingBatchPath({ path: '/_more/1/12/' })).toEqual({ pagePath: '/', key: 1, after: 12 });
    expect(parseListingBatchPath({ path: '/docs/guides/_more/10/0' })).toEqual({ pagePath: '/docs/guides', key: 10, after: 0 });
  });

  it('refuses bad keys, cursors, traversal and reserved first segments', () => {
    for (const path of ['/blog/_more/0/12', '/blog/_more/11/12', '/blog/_more/1/x', '/blog/_more/1/100001', '/blog/_more/1/1234567', '/../_more/1/12', '/a/_more/b/_more/1/1', '/admin/_more/1/12', '/api/x/_more/1/12', '/blog/_more/1', '/blog/page/2'])
      expect(parseListingBatchPath({ path })).toBeUndefined();
  });
});

describe('listing markup', () => {
  it('assigns keys in document order and drops the attribute past the cap', () => {
    const tags = Array.from({ length: 11 }, () => '<ul class="x" data-jini-see-more></ul>').join('');
    const out = assignListingKeys({ html: `<div data-jini-see-more="">a</div>${tags}` });
    expect(out.startsWith('<div data-jini-listing="1">a</div><ul class="x" data-jini-listing="2"></ul>')).toBe(true);
    expect(out.match(/data-jini-listing=/g)).toHaveLength(10);
    expect(out.endsWith('<ul class="x"></ul>')).toBe(true);
    expect(listingKeyOfAttributes({ attrs: ' class="x" data-jini-listing="7"' })).toBe(7);
    expect(listingKeyOfAttributes({ attrs: ' class="x"' })).toBeUndefined();
  });

  it('extracts a batch and its next button, and round-trips through the batch document', () => {
    const page = `<ul data-jini-listing="1">${wrapListingItems({ key: 1, items: '<li>a</li>' })}</ul>${renderListingMore({ key: 1, href: '/blog/_more/1/12?x=1&y=2' })}`;
    const batch = extractListingBatch({ html: page, key: 1 });
    expect(batch).toEqual({ items: '<li>a</li>', moreHref: '/blog/_more/1/12?x=1&y=2' });
    expect(extractListingBatch({ html: page, key: 2 })).toBeUndefined();
    const doc = renderListingBatchDocument({ key: 1, ...batch! });
    expect(doc).toContain('<meta name="robots" content="noindex">');
    expect(doc).toContain('<div data-jini-listing-batch="1"><li>a</li></div>');
    expect(doc).not.toContain(' hidden');
    expect(extractListingMoreHrefs({ html: doc })).toEqual(['/blog/_more/1/12?x=1&y=2']);
    expect(extractListingMoreHrefs({ html: renderListingBatchDocument({ key: 1, items: '' }) })).toEqual([]);
  });

  it('adds the script once, before </body>, only when a see-more button exists', () => {
    const more = renderListingMore({ key: 1, href: '/b/_more/1/1' });
    const once = injectListingScript({ html: `<body>${more}</body>` });
    expect(once.indexOf('<script data-jini-see-more-script>')).toBeGreaterThan(once.indexOf(more));
    expect(once.endsWith('</script></body>')).toBe(true);
    expect(injectListingScript({ html: once })).toBe(once);
    expect(injectListingScript({ html: '<body></body>' })).toBe('<body></body>');
  });
});
