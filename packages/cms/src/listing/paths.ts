import { LISTING_AFTER_MAX } from './batch.js';

/**
 * Batch URLs: `<pagePath>/_more/<key>/<after>` (home: `/_more/1/12`). `_` is not a legal slug, so a
 * batch URL can never collide with content, and it is a plain directory route, so a static export
 * writes `.../<after>/index.html` that every static host serves unchanged. The JSON form of the same
 * batch is `<pagePath>/_more/<key>/<after>.json`, exported as that file.
 */

/** Most see-more listings one page may carry; keys are their 1-based document-order ordinals. */
export const LISTING_KEY_MAX = 10;

const BATCH_PATH = /^((?:\/[^/]+)*)\/_more\/([1-9]\d?)\/(\d{1,6})(?:(\.json)|\/?)$/;
const RESERVED_FIRST_SEGMENTS = new Set(['admin', 'api']);

export interface ListingBatchRequest {
  /** The listing page's own path (`/` for home). */
  readonly pagePath: string;
  readonly key: number;
  readonly after: number;
  /** `'json'` for the `.json` form ({@link ListingJsonPage}); absent for the HTML batch. */
  readonly format?: 'json';
}

/** A JSON batch's body: one page of a listing's public items plus the cursor for the next, or `null` after the last. */
export interface ListingJsonPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: number | null;
}

/** The batch URL for `key`'s listing on `pagePath`, starting at source cursor `after`. @complexity O(n) over `pagePath`. */
export function listingBatchPath({ pagePath, key, after, format }: ListingBatchRequest, _optional: Record<string, never> = {}): string {
  return `${pagePath.replace(/\/+$/, '')}/_more/${key}/${after}${format === 'json' ? '.json' : ''}`;
}

/**
 * The batch request a URL path names, or `undefined` when it is not a well-formed batch URL: a bad
 * key or cursor, a `.`/`..` segment, or an `admin`/`api` page are refused, never normalized.
 * @complexity O(n) over `path`.
 */
export function parseListingBatchPath({ path }: { path: string }, _optional: Record<string, never> = {}): ListingBatchRequest | undefined {
  const match = BATCH_PATH.exec(path);
  if (!match) return undefined;
  const [, page = '', rawKey = '', rawAfter = '', json] = match;
  const segments = page.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '_more')) return undefined;
  if (segments[0] !== undefined && RESERVED_FIRST_SEGMENTS.has(segments[0])) return undefined;
  const key = Number(rawKey);
  const after = Number(rawAfter);
  if (key > LISTING_KEY_MAX || after > LISTING_AFTER_MAX) return undefined;
  return { pagePath: page === '' ? '/' : page, key, after, ...(json ? { format: 'json' as const } : {}) };
}
