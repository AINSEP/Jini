import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";
import { markersOfType } from "../../../../../widgets/markers/index.js";
import type { AssignedTermView, EntryTermReadPort } from "../../../../../taxonomy/index.js";

/**
 * Taxonomy render-surface gap fix (2026-09-02) — categories and tags had a complete WRITE path
 * (`assign-terms.ts` -> `entry_terms`) and NO read path: a term assigned to a page/post rendered
 * nowhere on the public site. Resolves `post`'s assigned terms ahead of {@link renderViaTemplate},
 * mirroring `resolveMediaAssetMetadataForRender`'s own "route resolves, render stays I/O-free" split
 * immediately above it in this file — this is the one call site.
 *
 * `deps.entryTermReadRepo` is OPTIONAL (`routes/types.ts`'s own doc on that field explains why: no
 * `InMemoryEntryTermRepo` adapter implements it yet) — an absent repo degrades to "no terms
 * resolved", same as every other optional resolved input in this file (`mediaTransformVersions`,
 * `pageHtmlEmbeds`, …) degrades to its own empty default rather than throwing.
 *
 * `post.kind` (`"post"` | `"page"`) is passed straight through as the taxonomy `contentType` —
 * `TAXONOMY_ALLOWED_CONTENT_TYPES` (`@jini-ai/cms/taxonomy`) is exactly `{post, page}`, and
 * `assign-terms.ts` writes `entry_terms.content_type` from this same field, so no translation is
 * needed between the two vocabularies.
 *
 * @complexity O(1) plus {@link EntryTermReadPort.listForContent}'s own one-join-query cost.
 */
export async function resolveAssignedTermsForRender(
  { deps, post }: { deps: { entryTermReadRepo?: EntryTermReadPort }; post: PostRecord }, _optional: Record<string, never> = {}
): Promise<readonly AssignedTermView[]> {
  if (!deps.entryTermReadRepo) return [];
  return deps.entryTermReadRepo.listForContent({ contentType: post.kind, contentId: post.id });
}

/**
 * Insert `block` right after the current entry's own `{"type":"content"}` element (its first one,
 * matched by id, or by slug for a slug-only marker: the same match `postAuthorForContentHeader`
 * uses). Runs before that marker resolves, so `block` ends up beside the entry's content inside
 * whatever wraps it (the theme's `<article>`), never after the footer. A template with no such
 * element shows none of the entry's body, so it shows no `block` either.
 * @complexity O(n) in `html` length for one marker scan and one splice; pure, no I/O.
 */
export function placeAfterCurrentContent(
  required: { html: string; post: { id: string; slug: string }; block: string },
  _optional: Record<string, never> = {},
): string {
  const { html, post, block } = required;
  if (block === "") return html;
  const content = markersOfType({ html, type: "content" }).find(marker =>
    marker.id !== undefined ? marker.id === post.id : marker.config.slug === post.slug);
  if (!content) return html;
  const end = content.index + content.whole.length;
  return html.slice(0, end) + block + html.slice(end);
}
