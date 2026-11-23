/**
 * @file The shared "old id-bookmark lands on the slug URL" redirect rule (readable-slugs S6a,
 * 2026-09-23) — generalised out of `widgetSlugRedirectPath` (now `@jini-ai/admin/widgets`), the
 * first of these (2026-09-22, URL-uses-slug). Posts, Pages, and Widgets each resolve either a
 * record's id or its current slug server-side (`getPostByIdOrSlug`/`getPageByIdOrSlug`/
 * `getWidgetInstance`), so a stale bookmark or shared link built from the old id-based URL still
 * loads the right record — this only decides whether the ADDRESS BAR itself should quietly catch up
 * to the slug once that record has loaded, via a `replace` navigation (never a pushed history entry:
 * the operator never chose to visit the id URL as a distinct step, so Back shouldn't stop there
 * either).
 */

/** RFC 4122 shape (`randomUUID()`'s output — every entries-table id, per `server/runtime
 *  /composition/{app,deps}.ts`'s `idGen`, shared by posts/pages/widgets alike) — the only way this
 *  module tells "an old id-based URL" apart from "a slug that merely differs from a stale local
 *  copy of the record" (e.g. a background refetch after a rename elsewhere, which must NOT be
 *  treated as an id link and redirected out from under the operator). A record's own slug
 *  (`slugify(title)-${8 hex chars}` for widgets, similarly derived for posts/pages) never matches
 *  this shape, so the check can't misfire on a legitimate slug. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The path an editor's load effect should replace-navigate to once its record has loaded, when the
 * URL segment that resolved it was the record's raw id rather than its current slug — or `null`
 * when no redirect is needed.
 *
 * `null` covers two cases identically: `requestedId` already IS the item's current slug (nothing to
 * do), or `requestedId` doesn't look like THIS item's own id at all — a UUID-shaped string that
 * belongs to a different record (never redirect based on a mismatch this module can't actually
 * verify) or any other slug-shaped string (a plain "different slug", not a recognizable id link).
 *
 * @complexity Time/space: O(1).
 */
export function slugRedirectPath({ base, requestedId, item }: { base: string; requestedId: string; item: { id: string; slug: string } }, _options = {}): string | null {
  if (requestedId === item.slug) return null;
  if (requestedId !== item.id || !UUID_RE.test(requestedId)) return null;
  return `${base}/${item.slug}`;
}
