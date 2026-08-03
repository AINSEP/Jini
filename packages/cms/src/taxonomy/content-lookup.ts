import type { ContentLookupPort } from "./write-service.js";

/**
 * @file The `ContentLookupPort` adapter backed by a host's own post/page repository.
 *
 * `TAXONOMY_ALLOWED_CONTENT_TYPES` (write-service.ts) is exactly `{post, page}` today, and in the
 * CMS runtime this is ported from both live in the SAME `posts` table (a `kind` column
 * distinguishes them) — so this adapter only ever needs a by-id content lookup, never a separate
 * entries table. A future content type extending the allow-list would extend this adapter (or add
 * a sibling), not replace it.
 *
 * ## Why the dependency is declared structurally
 *
 * In the source repo this file imported that host's concrete `PostRepoPort` — a 5-method interface
 * on a 686-line module — and the sibling tool-registration layer imported the same type through
 * that feature's barrel, which additionally re-exported two SQLite adapters and a search index.
 * Taxonomy calls exactly ONE method and reads exactly TWO fields off the result, so the barrel hop
 * put a whole content feature (and, through its adapters, a host database schema) into this
 * domain's dependency closure to obtain a single signature.
 *
 * {@link ContentRecordLookupPort} declares that one method instead. A host satisfies it by passing
 * the post repository it already has — the shape is the contract, so no host type is named here,
 * and the mutual import between taxonomy and the host's content feature disappears rather than
 * being inverted into a new one.
 */

/**
 * The single capability taxonomy needs from a host's content repository: resolve a content id to
 * the workspace it belongs to and the kind of row it actually is.
 *
 * Deliberately narrower than any real repository. A host's own richer record type satisfies this
 * structurally — returning extra fields is always assignable — so implementing it costs nothing.
 */
export interface ContentRecordLookupPort {
  findById(required: { workspaceId: string; id: string }): Promise<{ workspaceId: string; kind: string } | null>;
}

export function createPostBackedContentLookup(deps: {
  postRepo: ContentRecordLookupPort;
  workspaceId: string;
}): ContentLookupPort {
  return {
    async resolve({ contentId }) {
      const post = await deps.postRepo.findById({ workspaceId: deps.workspaceId, id: contentId });
      return post ? { workspaceId: post.workspaceId, kind: post.kind } : null;
    },
  };
}
