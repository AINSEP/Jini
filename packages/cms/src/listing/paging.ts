import { trimCharsEnd } from "@jini-ai/core/primitives";
import { LISTING_AFTER_MAX, type ListingSource } from './batch.js';
import { isRefusedPage } from './paths.js';

/**
 * Numbered listing pages: the no-JS, crawlable counterpart of a see-more listing. Page 1 is the
 * listing page itself (`/`, `/blog`); page N is `<pagePath>/page/<N>` (`/page/2`, `/blog/page/2`),
 * the same plain-directory shape as a batch URL, so a static export writes `.../page/2/index.html`
 * and every static host serves it. Unlike a batch, a page is a whole document, so its links are
 * real `<a rel="prev|next">` links ({@link renderListingPageNav}) a reader and a crawler can follow.
 */

/** Highest page number a page URL may name; a forged huge page is refused, not scanned toward. */
export const LISTING_PAGE_MAX = 10_000;
/** Source rows {@link readListingPage} reads per round while counting. */
const LISTING_PAGE_CHUNK = 500;

const PAGE_PATH = /^((?:\/[^/]+)*)\/page\/([1-9]\d{0,4})\/?$/;

/** One page of a paged listing: where it sits, how many there are, and its neighbours' URLs. */
export interface ListingPageInfo {
  /** 1-based page number. */
  readonly page: number;
  readonly pageSize: number;
  /** Visible items across every page. */
  readonly total: number;
  /** At least 1: an empty listing is one empty page. */
  readonly totalPages: number;
  /** Visible items before this page. */
  readonly offset: number;
  /** The newer page's URL; absent on page 1. */
  readonly prevHref?: string;
  /** The older page's URL; absent on the last page. */
  readonly nextHref?: string;
}

/** {@link ListingPageInfo} plus the page's own items. */
export interface ListingPage<T> extends ListingPageInfo {
  readonly items: readonly T[];
}

/** A page URL's parts: the listing page's own path (`/` for home) and the page number (≥ 2). */
export interface ListingPageRequest {
  readonly pagePath: string;
  readonly page: number;
}

/** `pagePath` itself for page 1, else `<pagePath>/page/<page>`. @complexity O(n) over `pagePath`. */
export function listingPagePath({ pagePath, page }: ListingPageRequest, _optional: Record<string, never> = {}): string {
  if (page <= 1) return pagePath;
  return `${trimCharsEnd({ text: pagePath, chars: '/' })}/page/${page}`;
}

/**
 * The page request a URL path names, or `undefined`: page 1 (its canonical URL is the page itself),
 * a leading zero, a page past {@link LISTING_PAGE_MAX}, a `.`/`..`/`_more` segment, or an
 * `admin`/`api` page are refused, never normalized. @complexity O(n) over `path`.
 */
export function parseListingPagePath({ path }: { path: string }, _optional: Record<string, never> = {}): ListingPageRequest | undefined {
  const match = PAGE_PATH.exec(path);
  if (!match) return undefined;
  const [, rawPage = '', rawNumber = ''] = match;
  const page = Number(rawNumber);
  if (page < 2 || page > LISTING_PAGE_MAX || isRefusedPage({ page: rawPage })) return undefined;
  return { pagePath: rawPage === '' ? '/' : rawPage, page };
}

/**
 * The paging math for page `page` of `total` items, `pageSize` (floored, at least 1) per page, or
 * `undefined` when `page` is not a whole number in `[1, totalPages]` (the caller answers 404).
 * @complexity O(n) over `pagePath`.
 */
export function computeListingPage(
  { total, page, pageSize }: { total: number; page: number; pageSize: number },
  { pagePath = '/' }: { pagePath?: string } = {},
): ListingPageInfo | undefined {
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return undefined;
  return {
    page,
    pageSize: size,
    total,
    totalPages,
    offset: (page - 1) * size,
    ...(page > 1 ? { prevHref: listingPagePath({ pagePath, page: page - 1 }) } : {}),
    ...(page < totalPages ? { nextHref: listingPagePath({ pagePath, page: page + 1 }) } : {}),
  };
}

/**
 * Page `page` of a listing's visible items, with the visible total, or `undefined` when the page is
 * out of range. A visible total needs every row's visibility, so this reads the source in chunks
 * to the end (at most {@link LISTING_AFTER_MAX} rows, the same ceiling a batch cursor has) and keeps
 * only the requested page's items.
 * @complexity O(rows / chunkSize) source reads, O(rows) `isVisible` calls, O(pageSize) memory.
 */
export async function readListingPage<T>(
  { source, page, pageSize }: { source: ListingSource<T>; page: number; pageSize: number },
  { isVisible = () => true, pagePath = '/', chunkSize = LISTING_PAGE_CHUNK }: { isVisible?: (item: T) => boolean; pagePath?: string; chunkSize?: number } = {},
): Promise<ListingPage<T> | undefined> {
  const size = Math.max(1, Math.floor(pageSize));
  const start = (page - 1) * size;
  const items: T[] = [];
  let total = 0;
  for (let offset = 0; offset < LISTING_AFTER_MAX; offset += chunkSize) {
    const rows = await source({ offset, limit: Math.min(chunkSize, LISTING_AFTER_MAX - offset) });
    total = collectPageRows({ rows, items, total, start, size, isVisible });
    if (rows.length < chunkSize) break;
  }
  const info = computeListingPage({ total, page, pageSize: size }, { pagePath });
  return info === undefined ? undefined : { ...info, items };
}

/** Counts `rows`' visible rows onto `total`, appending those whose visible index falls in
 *  `[start, start + size)` to `items`; returns the new total. @complexity O(rows). */
function collectPageRows<T>(
  { rows, items, total, start, size, isVisible }: { rows: readonly T[]; items: T[]; total: number; start: number; size: number; isVisible: (item: T) => boolean },
  _optional: Record<string, never> = {},
): number {
  let count = total;
  for (const row of rows) {
    if (!isVisible(row)) continue;
    if (count >= start && count < start + size) items.push(row);
    count += 1;
  }
  return count;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The default paging nav for a listing page: a plain `<nav aria-label>` with `rel="prev"`/`rel="next"`
 * links and a "Page N of M" status, unstyled so it inherits the theme's own link/nav styles; `''`
 * when there is only one page. @complexity O(n) over the hrefs and labels.
 */
export function renderListingPageNav(
  { page }: { page: ListingPageInfo },
  { label = 'Pagination', newerLabel = 'Newer posts', olderLabel = 'Older posts' }: { label?: string; newerLabel?: string; olderLabel?: string } = {},
): string {
  if (page.totalPages <= 1) return '';
  const parts = [
    page.prevHref === undefined ? '' : `<a class="jini-pagination-prev" rel="prev" href="${escapeHtml(page.prevHref)}">${escapeHtml(newerLabel)}</a>`,
    `<span class="jini-pagination-status">Page ${page.page} of ${page.totalPages}</span>`,
    page.nextHref === undefined ? '' : `<a class="jini-pagination-next" rel="next" href="${escapeHtml(page.nextHref)}">${escapeHtml(olderLabel)}</a>`,
  ].filter(Boolean);
  return `<nav class="jini-pagination" aria-label="${escapeHtml(label)}">${parts.join(' ')}</nav>`;
}

const PAGINATION_NAV = /<nav class="jini-pagination"[^<>]*>([\s\S]*?)<\/nav>/g;
const PAGE_LINK = /<a\b[^<>]*\brel="(?:prev|next)"[^<>]*\bhref="([^"]*)"/g;

/** Every prev/next href inside {@link renderListingPageNav} navs in `html`, for a static exporter to
 *  follow so every page is written. @complexity O(n). */
export function extractListingPageHrefs({ html }: { html: string }, _optional: Record<string, never> = {}): readonly string[] {
  const hrefs: string[] = [];
  for (const [, inner = ''] of html.matchAll(PAGINATION_NAV)) {
    for (const [, href = ''] of inner.matchAll(PAGE_LINK)) hrefs.push(href.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  return hrefs;
}
