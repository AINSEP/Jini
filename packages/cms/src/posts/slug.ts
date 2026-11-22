import { toSlug } from "../html/site/slug.js";

/** api.spec.md §4 / behavior.spec.md §4: caller-supplied `slug` maxLength. Exported for the same
 * reason as {@link MAX_TITLE_LENGTH}. */
export const MAX_SLUG_LENGTH = 120;
export const DERIVED_SLUG_SUFFIX_ROOM = "-999".length;

/** Leave room for the bounded collision suffix so every derived slug remains editable. */
export function derivePostSlugBase({ title }: { title: string }, _optional: Record<string, never> = {}): string {
  const slug = toSlug({ text: title }).slice(0, MAX_SLUG_LENGTH - DERIVED_SLUG_SUFFIX_ROOM);
  let end = slug.length;
  while (end > 0 && slug[end - 1] === "-") end -= 1;
  return slug.slice(0, end) || "untitled";
}

/** Automatic slugs are inferred from the stored title, never from an extra preference flag. */
export function isAutomaticPostSlug({ title, slug }: { title: string; slug: string }, _optional: Record<string, never> = {}): boolean {
  const base = derivePostSlugBase({ title });
  return /^untitled(-\d+)?$/.test(slug) || slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)));
}

/** Shared slug-format rule, exported so `agent-tools.ts` can publish the identical pattern rather
 * than a hand-copied regex literal that could silently drift from what `updatePost`/`createPost`
 * actually enforce. */
export const SLUG_FORMAT_PATTERN = /^[a-z0-9-]+$/;
