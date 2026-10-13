/** @file Pure media slug policy; writes and public URL rendering share the same format and UUID-shadowing rule. */
/** Shared slug-format rule (2026-09-07) — same shape as `post`'s `SLUG_FORMAT_PATTERN`: lowercase
 *  letters, digits, and dashes only. Media slugs have no reserved-word list (`post`'s `admin`/`api`
 *  exclusions exist because a post slug can become a literal URL path segment a route dispatches
 *  on; a media slug is only ever a lookup key, never a route itself, so that hazard doesn't apply). */
const MEDIA_SLUG_FORMAT_PATTERN = /^[a-z0-9-]+$/;

/**
 * Slugs that spell a UUID are refused outright (2026-09-07 fix).
 *
 * A lowercase UUID is `[a-z0-9-]+` character for character, so {@link MEDIA_SLUG_FORMAT_PATTERN}
 * happily accepted one — and {@link findMediaByIdOrSlug} used to resolve SLUG FIRST, so pointing one
 * asset's slug at another asset's `id` silently took over every reference already authored against
 * that id (every `/m/{id}/…` URL a host's renderer has ever emitted for the victim). That resolution
 * order is now id-first, which closes the hijack for rows that already carry such a slug; this rule
 * is the write-path half — a slug that can only ever shadow an id is not a slug anyone wants, so it
 * is refused where a human can still see why rather than silently shadowed at read time.
 *
 * Shape-based, not a lookup: it rejects EVERY UUID-shaped value, not only ones that currently
 * collide, so a slug cannot become a hijack later when some future upload happens to mint that id.
 * Ordinary hex-and-dash slugs (`abc-123-def`, `2026-09-07-launch-clip`) are unaffected — nothing but
 * the exact 8-4-4-4-12 hex grouping matches.
 */
const MEDIA_SLUG_UUID_SHAPE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Return whether a media lookup slug has the accepted shape, without I/O.
 * @complexity O(n) time in the slug length, O(1) space.
 * @example isValidMediaSlugFormat({ slug: "summer-photo" }); // true
 */
export function isValidMediaSlugFormat(requiredArgs: { slug: string }, optionalArgs: Record<string, never> = {}): boolean {
  const { slug } = requiredArgs;
  return MEDIA_SLUG_FORMAT_PATTERN.test(slug) && !MEDIA_SLUG_UUID_SHAPE_PATTERN.test(slug);
}
