import { describe, expect, it } from 'vitest';
import { LISTING_AFTER_MAX, arrayListingSource } from '../batch.js';
import {
  LISTING_PAGE_MAX,
  computeListingPage,
  extractListingPageHrefs,
  listingPagePath,
  parseListingPagePath,
  readListingPage,
  renderListingPageNav,
} from '../paging.js';

const rows = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

describe('computeListingPage', () => {
  it('page 1 of several: no prev, next is /page/2', () => {
    expect(computeListingPage({ total: 60, page: 1, pageSize: 24 })).toEqual({
      page: 1, pageSize: 24, total: 60, totalPages: 3, offset: 0, nextHref: '/page/2',
    });
  });

  it('a middle page links both ways; page 2 links back to the bare page path', () => {
    expect(computeListingPage({ total: 60, page: 2, pageSize: 24 }, { pagePath: '/blog' })).toEqual({
      page: 2, pageSize: 24, total: 60, totalPages: 3, offset: 24, prevHref: '/blog', nextHref: '/blog/page/3',
    });
  });

  it('the last page has no next', () => {
    expect(computeListingPage({ total: 60, page: 3, pageSize: 24 }, { pagePath: '/blog/' })).toEqual({
      page: 3, pageSize: 24, total: 60, totalPages: 3, offset: 48, prevHref: '/blog/page/2',
    });
  });

  it('a page past the last, or below 1, is out of range', () => {
    expect(computeListingPage({ total: 60, page: 4, pageSize: 24 })).toBeUndefined();
    expect(computeListingPage({ total: 60, page: 0, pageSize: 24 })).toBeUndefined();
    expect(computeListingPage({ total: 60, page: 1.5, pageSize: 24 })).toBeUndefined();
  });

  it('0 items is one empty page; page 2 of it is out of range', () => {
    expect(computeListingPage({ total: 0, page: 1, pageSize: 24 })).toEqual({ page: 1, pageSize: 24, total: 0, totalPages: 1, offset: 0 });
    expect(computeListingPage({ total: 0, page: 2, pageSize: 24 })).toBeUndefined();
  });

  it('exactly one page of items is one page; one more makes two', () => {
    expect(computeListingPage({ total: 24, page: 1, pageSize: 24 })?.totalPages).toBe(1);
    expect(computeListingPage({ total: 24, page: 1, pageSize: 24 })?.nextHref).toBeUndefined();
    expect(computeListingPage({ total: 25, page: 1, pageSize: 24 })).toMatchObject({ totalPages: 2, nextHref: '/page/2' });
    expect(computeListingPage({ total: 25, page: 2, pageSize: 24 })).toMatchObject({ offset: 24, prevHref: '/' });
  });

  it('a page size below 1 is floored to 1', () => {
    expect(computeListingPage({ total: 2, page: 2, pageSize: 0 })).toMatchObject({ pageSize: 1, totalPages: 2, offset: 1 });
  });
});

describe('listingPagePath / parseListingPagePath', () => {
  it('page 1 is the page itself; later pages hang /page/<n> off it', () => {
    expect(listingPagePath({ pagePath: '/', page: 1 })).toBe('/');
    expect(listingPagePath({ pagePath: '/', page: 2 })).toBe('/page/2');
    expect(listingPagePath({ pagePath: '/blog//', page: 7 })).toBe('/blog/page/7');
  });

  it('parses home and nested pages, with or without a trailing slash', () => {
    expect(parseListingPagePath({ path: '/page/2' })).toEqual({ pagePath: '/', page: 2 });
    expect(parseListingPagePath({ path: '/page/2/' })).toEqual({ pagePath: '/', page: 2 });
    expect(parseListingPagePath({ path: '/blog/page/12' })).toEqual({ pagePath: '/blog', page: 12 });
  });

  it('refuses page 1 (the page itself is canonical), a leading zero, a huge page, and reserved/odd segments', () => {
    expect(parseListingPagePath({ path: '/page/1' })).toBeUndefined();
    expect(parseListingPagePath({ path: '/page/02' })).toBeUndefined();
    expect(parseListingPagePath({ path: `/page/${LISTING_PAGE_MAX + 1}` })).toBeUndefined();
    expect(parseListingPagePath({ path: `/page/${LISTING_PAGE_MAX}` })).toEqual({ pagePath: '/', page: LISTING_PAGE_MAX });
    expect(parseListingPagePath({ path: '/admin/page/2' })).toBeUndefined();
    expect(parseListingPagePath({ path: '/a/../page/2' })).toBeUndefined();
    expect(parseListingPagePath({ path: '/blog/_more/page/2' })).toBeUndefined();
    expect(parseListingPagePath({ path: '/blog/page/x' })).toBeUndefined();
  });
});

describe('readListingPage', () => {
  it('returns the requested page of visible items and the visible total', async () => {
    const page = await readListingPage({ source: arrayListingSource({ rows: rows(10) }), page: 2, pageSize: 3 }, { isVisible: (n) => n % 2 === 0, chunkSize: 2 });
    expect(page).toEqual({ items: [6, 8], page: 2, pageSize: 3, total: 5, totalPages: 2, offset: 3, prevHref: '/' });
  });

  it('defaults to every row visible and links from the given page path', async () => {
    const page = await readListingPage({ source: arrayListingSource({ rows: rows(25) }), page: 1, pageSize: 24 }, { pagePath: '/blog' });
    expect(page?.items).toHaveLength(24);
    expect(page).toMatchObject({ total: 25, totalPages: 2, nextHref: '/blog/page/2' });
  });

  it('is undefined for a page past the last', async () => {
    expect(await readListingPage({ source: arrayListingSource({ rows: rows(24) }), page: 2, pageSize: 24 })).toBeUndefined();
  });

  it('stops scanning at LISTING_AFTER_MAX source rows', async () => {
    let reads = 0;
    const endless = async ({ limit }: { offset: number; limit: number }) => { reads += 1; return rows(limit); };
    const page = await readListingPage({ source: endless, page: 1, pageSize: 1 }, { chunkSize: LISTING_AFTER_MAX / 2 });
    expect(reads).toBe(2);
    expect(page?.total).toBe(LISTING_AFTER_MAX);
  });
});

describe('renderListingPageNav', () => {
  it('renders nothing for a single page', () => {
    expect(renderListingPageNav({ page: { page: 1, pageSize: 24, total: 24, totalPages: 1, offset: 0 } })).toBe('');
  });

  it('renders an accessible nav with rel=prev/next links and a status', () => {
    const html = renderListingPageNav({ page: { page: 2, pageSize: 24, total: 60, totalPages: 3, offset: 24, prevHref: '/', nextHref: '/page/3' } });
    expect(html).toBe(
      '<nav class="jini-pagination" aria-label="Pagination"><a class="jini-pagination-prev" rel="prev" href="/">Newer posts</a> <span class="jini-pagination-status">Page 2 of 3</span> <a class="jini-pagination-next" rel="next" href="/page/3">Older posts</a></nav>'
    );
  });

  it('omits the missing side and escapes custom labels and hrefs', () => {
    const html = renderListingPageNav(
      { page: { page: 1, pageSize: 1, total: 2, totalPages: 2, offset: 0, nextHref: '/a"b' } },
      { label: 'Posts & pages', olderLabel: 'Older <', newerLabel: 'unused' }
    );
    expect(html).toBe('<nav class="jini-pagination" aria-label="Posts &amp; pages"><span class="jini-pagination-status">Page 1 of 2</span> <a class="jini-pagination-next" rel="next" href="/a&quot;b">Older &lt;</a></nav>');
    const last = renderListingPageNav({ page: { page: 2, pageSize: 1, total: 2, totalPages: 2, offset: 1, prevHref: '/' } });
    expect(last).toBe('<nav class="jini-pagination" aria-label="Pagination"><a class="jini-pagination-prev" rel="prev" href="/">Newer posts</a> <span class="jini-pagination-status">Page 2 of 2</span></nav>');
  });
});

describe('extractListingPageHrefs', () => {
  it('collects every rel=prev/next href inside pagination navs only', () => {
    const nav = renderListingPageNav({ page: { page: 2, pageSize: 1, total: 3, totalPages: 3, offset: 1, prevHref: '/blog', nextHref: '/blog/page/3' } });
    const html = `<a rel="next" href="/elsewhere">x</a>${nav}<nav><a rel="next" href="/nope">y</a></nav>`;
    expect(extractListingPageHrefs({ html })).toEqual(['/blog', '/blog/page/3']);
  });

  it('decodes escaped hrefs and returns nothing without a nav', () => {
    expect(extractListingPageHrefs({ html: '<p>none</p>' })).toEqual([]);
    expect(extractListingPageHrefs({ html: '<nav class="jini-pagination"><a rel="next" href="/a&amp;b">n</a></nav>' })).toEqual(['/a&b']);
  });
});
