import { LISTING_KEY_MAX, listingBatchPath, parseListingBatchPath } from './paths.js';
import { LISTING_SEE_MORE_SCRIPT } from './see-more-script.js';

/**
 * String-level markup for see-more listings, so no HTML parser is needed:
 * - the author marks a listing container with `data-jini-see-more`; {@link assignListingKeys} turns
 *   that into `data-jini-listing="<key>"` (1-based, document order) before the listing renders;
 * - the items sit between `<!--jini-listing:<key>-->` sentinels ({@link wrapListingItems}), which is
 *   what {@link extractListingBatch} slices a batch response out of;
 * - the button is a `<button>` carrying the next batch URL in `data-jini-more-href`
 *   ({@link renderListingMore}), `hidden` until the inline script runs, so with no JS it is simply
 *   absent (a batch URL alone is a bare fragment, so a plain link adds nothing for no-JS readers);
 * - a listing that carries a `<template data-jini-card>` card ({@link extractListingCardTemplate})
 *   loads its next batches as JSON (`.json` batch URLs) and the script fills a copy of the card per
 *   item; without one it keeps loading server-rendered HTML batches.
 */

export const LISTING_SEE_MORE_ATTRIBUTE = 'data-jini-see-more';

const SEE_MORE_IN_OPEN_TAG = /(<[a-z][a-z0-9-]*\b[^<>]*?\s)data-jini-see-more(?:=(?:""|''))?(?=[\s/>])/gi;
const LISTING_KEY_ATTRIBUTE = /(?:^|\s)data-jini-listing="(\d+)"/;
const SCRIPT_MARKER = 'data-jini-see-more-script';

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Rewrites each `data-jini-see-more` attribute to `data-jini-listing="<key>"` in document order;
 *  past {@link LISTING_KEY_MAX} the attribute is dropped and the listing renders plain. @complexity O(n). */
export function assignListingKeys({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  let key = 0;
  return html.replace(SEE_MORE_IN_OPEN_TAG, (_whole, before: string) => {
    key += 1;
    return key > LISTING_KEY_MAX ? before.trimEnd() : `${before}data-jini-listing="${key}"`;
  });
}

/** The listing key an element's attribute string carries, if any. @complexity O(n) over `attrs`. */
export function listingKeyOfAttributes({ attrs }: { attrs: string }, _optional: Record<string, never> = {}): number | undefined {
  const match = LISTING_KEY_ATTRIBUTE.exec(attrs);
  return match ? Number(match[1]) : undefined;
}

/** `items` between the sentinels {@link extractListingBatch} slices on. @complexity O(n). */
export function wrapListingItems({ key, items }: { key: number; items: string }, _optional: Record<string, never> = {}): string {
  return `<!--jini-listing:${key}-->${items}<!--/jini-listing:${key}-->`;
}

/** The see-more button for `key`'s listing, carrying its next batch URL; the script shows
 *  `loadingLabel` (disabled) while a batch is fetched. @complexity O(n) over `href`. */
export function renderListingMore(
  { key, href }: { key: number; href: string },
  { label = 'See more', loadingLabel = 'Loading…' }: { label?: string; loadingLabel?: string } = {}
): string {
  return `<button type="button" class="jini-see-more" data-jini-more="${key}" data-jini-more-href="${escapeAttribute(href)}" data-jini-loading="${escapeAttribute(loadingLabel)}" hidden>${escapeAttribute(label)}</button>`;
}

/** Adds the one inline see-more script before `</body>` when the page carries a see-more button and
 *  does not already have the script. @complexity O(n). */
export function injectListingScript({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  if (!html.includes('data-jini-more=') || html.includes(SCRIPT_MARKER)) return html;
  const script = `<script ${SCRIPT_MARKER}>${LISTING_SEE_MORE_SCRIPT}</script>`;
  const bodyClose = html.lastIndexOf('</body>');
  return bodyClose === -1 ? html + script : html.slice(0, bodyClose) + script + html.slice(bodyClose);
}

function moreHrefsIn(html: string, key?: number): string[] {
  const hrefs: string[] = [];
  for (const [tag] of html.matchAll(/<button\b[^<>]*\bdata-jini-more="(\d+)"[^<>]*>/g)) {
    if (key !== undefined && !tag.includes(`data-jini-more="${key}"`)) continue;
    const href = /\bdata-jini-more-href="([^"]*)"/.exec(tag)?.[1];
    if (href !== undefined) hrefs.push(decodeAttribute(href));
  }
  return hrefs;
}

/** `key`'s rendered items and next-batch href, or `undefined` when `html` has no such listing. @complexity O(n). */
export function extractListingBatch({ html, key }: { html: string; key: number }, _optional: Record<string, never> = {}): { items: string; moreHref?: string } | undefined {
  const open = `<!--jini-listing:${key}-->`;
  const start = html.indexOf(open);
  const end = start === -1 ? -1 : html.indexOf(`<!--/jini-listing:${key}-->`, start);
  if (end === -1) return undefined;
  const moreHref = moreHrefsIn(html.slice(end), key)[0];
  return { items: html.slice(start + open.length, end), ...(moreHref !== undefined ? { moreHref } : {}) };
}

/** The document a batch URL serves: the items plus the next button, or none on the last batch. @complexity O(n). */
export function renderListingBatchDocument({ key, items, moreHref }: { key: number; items: string; moreHref?: string }, _optional: Record<string, never> = {}): string {
  const more = moreHref === undefined ? '' : renderListingMore({ key, href: moreHref }).replace(' hidden>', '>');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body><div data-jini-listing-batch="${key}">${items}</div>${more}</body></html>`;
}

/** Every see-more button's batch URL in `html`, for a static exporter to follow. @complexity O(n). */
export function extractListingMoreHrefs({ html }: { html: string }, _optional: Record<string, never> = {}): readonly string[] {
  return moreHrefsIn(html);
}

const CARD_TEMPLATE = /<template\b[^<>]*\sdata-jini-card(?:=(?:""|''))?[\s>][\s\S]*?<\/template>/i;

/** The first `<template data-jini-card>…</template>` element in a listing's authored markup, whole,
 *  or `undefined` when the listing has no client-side card. @complexity O(n). */
export function extractListingCardTemplate({ html }: { html: string }, _optional: Record<string, never> = {}): string | undefined {
  return CARD_TEMPLATE.exec(html)?.[0];
}

/** The next `.json` batch URL a JSON batch at `path` points to, for a static exporter to follow, or
 *  `undefined` after the last batch or for a body that is not a JSON batch. @complexity O(n). */
export function listingJsonNextPath({ path, body }: { path: string; body: string }, _optional: Record<string, never> = {}): string | undefined {
  const request = parseListingBatchPath({ path });
  if (request?.format !== 'json') return undefined;
  let nextCursor: unknown;
  try { nextCursor = (JSON.parse(body) as { nextCursor?: unknown }).nextCursor; } catch { return undefined; }
  return typeof nextCursor === 'number' && Number.isInteger(nextCursor) && nextCursor > request.after ? listingBatchPath({ ...request, after: nextCursor }) : undefined;
}
