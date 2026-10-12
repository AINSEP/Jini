import { LISTING_AFTER_MAX } from './batch.js';

/**
 * Batch URLs: `<pagePath>/_more/<key>/<after>` (home: `/_more/1/12`). `_` is not a legal slug, so a
 * batch URL can never collide with content, and it is a plain directory route, so a static export
 * writes `.../<after>/index.html` that every static host serves unchanged.
 */

/** Most see-more listings one page may carry; keys are their 1-based document-order ordinals. */
export const LISTING_KEY_MAX = 10;

const BATCH_PATH = /^((?:\/[^/]+)*)\/_more\/([1-9]\d?)\/(\d{1,6})\/?$/;
const RESERVED_FIRST_SEGMENTS = new Set(['admin', 'api']);

export interface ListingBatchRequest {
  /** The listing page's own path (`/` for home). */
  readonly pagePath: string;
  readonly key: number;
  readonly after: number;
}

/** The batch URL for `key`'s listing on `pagePath`, starting at source cursor `after`. @complexity O(n) over `pagePath`. */
export function listingBatchPath({ pagePath, key, after }: ListingBatchRequest, _optional: Record<string, never> = {}): string {
  return `${pagePath.replace(/\/+$/, '')}/_more/${key}/${after}`;
}

/**
 * The batch request a URL path names, or `undefined` when it is not a well-formed batch URL: a bad
 * key or cursor, a `.`/`..` segment, or an `admin`/`api` page are refused, never normalized.
 * @complexity O(n) over `path`.
 */
export function parseListingBatchPath({ path }: { path: string }, _optional: Record<string, never> = {}): ListingBatchRequest | undefined {
  const match = BATCH_PATH.exec(path);
  if (!match) return undefined;
  const [, page = '', rawKey = '', rawAfter = ''] = match;
  const segments = page.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '_more')) return undefined;
  if (segments[0] !== undefined && RESERVED_FIRST_SEGMENTS.has(segments[0])) return undefined;
  const key = Number(rawKey);
  const after = Number(rawAfter);
  if (key > LISTING_KEY_MAX || after > LISTING_AFTER_MAX) return undefined;
  return { pagePath: page === '' ? '/' : page, key, after };
}
