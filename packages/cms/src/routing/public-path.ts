import type { EmptyOptions } from "./routing.js";

/**
 * Builds a post/page's own public path from its `slug` — the one point every call site that turns a
 * `PostRecord.slug` into a route string goes through, so the content-owned-homepage `"/"` root-slug
 * exception (`post.ts`'s `ROOT_SLUG`) has exactly one implementation instead of N independently
 * re-deriving it. `/${slug}` is correct for every ordinary slug; the one deliberate exception is the
 * literal `"/"` slug itself, which a naive `/${slug}` template would double up into `"//"` — a Page
 * that has claimed the site's own homepage (`post.ts`'s `ROOT_SLUG` doc has the write-time gate that
 * makes `"/"` the only slug this can ever matter for).
 *
 * @complexity O(1).
 */
export function postPublicPath({ slug }: { slug: string }, _optional: EmptyOptions = {}): string {
  return slug === "/" ? "/" : `/${slug}`;
}
