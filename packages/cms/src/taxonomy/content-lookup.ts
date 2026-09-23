import type { ContentLookupPort } from "./write-service.js";
import { isContentTypeOnAllowList } from "./write-service.js";

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

/**
 * A1 (taxonomy plan) — the single capability taxonomy needs from a host's Collections entry
 * repository, narrowed the same way {@link ContentRecordLookupPort} narrows the post repo. The
 * field is `type` (an entry's own column name), mapped to this port's `kind` by
 * {@link createEntryBackedContentLookup} below — never renamed in the host's own repo just to
 * satisfy this shape.
 */
export interface EntryRecordLookupPort {
  findById(r: { workspaceId: string; id: string }): Promise<{ workspaceId: string; type: string } | null>;
}

/** `ContentLookupPort` adapter backed by a host's Collections entry repository — the entries-table
 * counterpart to `createPostBackedContentLookup` above, for every `contentType` that is a
 * Collection key rather than `post`/`page`. */
export function createEntryBackedContentLookup(deps: {
  entryRepo: EntryRecordLookupPort;
  workspaceId: string;
}): ContentLookupPort {
  return {
    async resolve({ contentId }) {
      const entry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: contentId });
      return entry ? { workspaceId: entry.workspaceId, kind: entry.type } : null;
    },
  };
}

/**
 * Routes a `resolve()` call to the post repo for `post`/`page` (`isContentTypeOnAllowList`) and to
 * the entry repo for every other `contentType` — a Collection key. `assignTerms`/`unassignTerms`'s
 * `validateAssignmentTarget` (write-service.ts) already decides whether a non-post/page
 * `contentType` is ELIGIBLE via `contentTypeTaxonomyPolicy` before calling this at all; this
 * function only decides which table a resolvable id is looked up against.
 */
export function createContentLookup(deps: {
  postRepo: ContentRecordLookupPort;
  entryRepo: EntryRecordLookupPort;
  workspaceId: string;
}): ContentLookupPort {
  const postLookup = createPostBackedContentLookup({ postRepo: deps.postRepo, workspaceId: deps.workspaceId });
  const entryLookup = createEntryBackedContentLookup({ entryRepo: deps.entryRepo, workspaceId: deps.workspaceId });
  return {
    async resolve(params) {
      return isContentTypeOnAllowList(params.contentType) ? postLookup.resolve(params) : entryLookup.resolve(params);
    },
  };
}
