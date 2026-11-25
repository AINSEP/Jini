import { isPublicPost, PostNotFoundError, type PostRecord, type PublicPostRecord } from "../../../posts/post.js";
import { postAuthorForDisplay } from "@jini-ai/core/contracts/site/post-author";
import type { AdminPost, ContentPost } from "@jini-ai/core/contracts/headless/contracts";

/**
 * Maps a post/page record into the richer admin-facing DTO shape.
 * @throws PostNotFoundError for storage-only kinds such as email templates.
 *
 * SPEC-005 REQ-11 (T022): `ext` is spread in only when the record actually carries one, so an
 * entry with no contributing plugin serializes with no `ext` key at all (AC-14) and every
 * pre-feature response field is untouched.
 *
 * SPEC-047/ADR-056 REQ-3: branches on `post.bodyFormat` and returns the matching `AdminPost` union
 * member, never a loose object with both `bodyJson`/`bodyHtml` optionally populated — this is the
 * one place `PostRecord`'s internal shape becomes the wire contract's discriminated union, so it is
 * the one place that can get the branch wrong. The `"html"` branch throwing on a null `bodyHtml`
 * (rather than coercing to `""`) is deliberate: the DB's `posts_body_format_shape` CHECK (REQ-2)
 * guarantees `bodyFormat: "html"` implies a non-null `bodyHtml`, so reaching this branch with a null
 * one is a genuine data-integrity violation this function should fail loudly on, not paper over.
 */
export function toHeadlessPost(record: PostRecord): AdminPost {
  const post = requirePublicPost({ post: record });
  const base = {
    id: post.id,
    workspaceId: post.workspaceId,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    status: post.status,
    updatedAt: post.updatedAt,
    author: post.author ?? null,
    showAuthor: post.showAuthor ?? false,
    version: post.version,
    templateChoice: post.templateChoice ?? null,
    // Tri-state (2026-08-15) — `?? null`, not `?? false`: a `PostRecord` that never had an opinion
    // set (`undefined`) must reach the wire as `null` ("never decided"), the same value a stored
    // database NULL round-trips as. Coalescing to `false` here would silently manufacture an explicit
    // "theme page wins" decision no author ever made. See `PostRecord.overridesThemePage`'s own doc.
    overridesThemePage: post.overridesThemePage ?? null,
    ...(post.ext !== undefined ? { ext: post.ext as Record<string, Record<string, unknown>> } : {}),
    // Present only when set, like `ext` — every pre-existing response stays byte-identical.
    ...(post.publishAt ? { publishAt: post.publishAt } : {}),
    ...(post.featuredMediaId ? { featuredMediaId: post.featuredMediaId } : {}),
  };

  if (post.bodyFormat === "html") {
    if (post.bodyHtml === null) {
      throw new Error(`post '${post.id}' is body_format 'html' with a null body_html — data integrity violation`);
    }
    return { ...base, bodyFormat: "html", bodyJson: null, bodyHtml: post.bodyHtml };
  }

  return { ...base, bodyFormat: "doc", bodyJson: post.bodyJson, bodyHtml: null };
}

/**
 * Maps a post/page record into the narrower public content DTO shape.
 * `bodyHtml` is trusted author HTML with unresolved embed markers; public renderers resolve them.
 * @throws PostNotFoundError for storage-only kinds such as email templates.
 */
export function toHeadlessContentPost(record: PostRecord): ContentPost {
  // Reuse the admin serializer's body-format validation, then select only public fields.
  const post = toHeadlessPost(record);
  const base = {
    id: post.id,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    updatedAt: post.updatedAt,
    author: postAuthorForDisplay({ post: record }),
    showAuthor: post.showAuthor ?? false,
  };
  return post.bodyFormat === "html"
    ? { ...base, bodyFormat: "html", bodyJson: null, bodyHtml: post.bodyHtml }
    : { ...base, bodyJson: post.bodyJson };
}

/** Raw storage callers must not serialize a mail template through either content DTO. */
function requirePublicPost({ post }: { post: PostRecord }, _optional: Record<string, never> = {}): PublicPostRecord {
  if (!isPublicPost(post)) throw new PostNotFoundError(`post '${post.id}' was not found`);
  return post;
}
