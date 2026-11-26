import { normalizePublishAt } from "@jini-ai/cms/posts/post-write-fields";
import { normalizePublishAt } from "@jini-ai/cms/posts/post-write-fields";
// Sourced from `assistant/` — an explicitly out-of-scope back-edge for this pass (see the dispatch
// notes this file's narrowing was reported under), not a field this file could re-source from a
// domain-owned port: the MCP-UI/exchange transport is genuinely assistant-owned.
// `ToolInputError` specifically — the marker `@jini-ai/daemon`'s `ToolExecutor` reads to tag a
// rejection `errorKind: 'validation'`. Everything else this file needs comes from `@jini-ai/cms/core`.
import { ToolInputError, requireObject, requireString } from "@jini-ai/core";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { PublicPostKind, PostStatus } from "@jini-ai/cms/core";

import { resolveFeaturedImageRef } from "@jini-ai/cms/posts/featured-image";
import type { PostToolDeps } from "./post-tool-deps.js";

export function requirePostKind(input: Record<string, unknown>): PublicPostKind {
  const value = input.kind;
  if (value !== "post" && value !== "page") {
    // `ToolInputError`, not a bare `Error` — see `toModelFacingUpdateError`'s doc a few lines up
    // for why this marker is load-bearing: `@jini-ai/daemon`'s `ToolExecutor` only tags a
    // rejection `errorKind: 'validation'` (→ 400 with this message intact) when it is
    // `instanceof ToolInputError`; anything else is `'internal'` and reaches the model as a
    // redacted 500. A wrong/missing `kind` is exactly the caller-input-was-the-problem case the
    // marker means, and `requireString` elsewhere in this same file already uses it correctly.
    throw new ToolInputError({ message: "'kind' must be exactly 'post' or 'page'" });
  }
  return value;
}

export function requirePostStatus(input: Record<string, unknown>): PostStatus {
  const value = input.status;
  if (value !== "draft" && value !== "published") {
    // Same reasoning as `requirePostKind` above.
    throw new ToolInputError({ message: "'status' must be exactly 'draft' or 'published'" });
  }
  return value;
}

export function optionalPostStatus(input: Record<string, unknown>): PostStatus | undefined {
  if (input.status === undefined) return undefined;
  return requirePostStatus(input);
}

/** `requireObject` (the kit's generic reader) returns `Record<string, unknown>` — this domain's
 * `bodyJson` is typed as `JsonObject` (`post.ts`), so this narrows the one field that differs.
 * `post.ts`'s own `isJsonObject` check (inside `createPost`/`updatePost`) is the actual runtime
 * shape gate — this cast does not weaken that, it only aligns the caller-facing TS type. */
export function requireBodyJson({ input, key }: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {}): JsonObject {
  return requireObject({ input: input, key: key }) as unknown as JsonObject;
}

/** Optional counterpart to {@link requireBodyJson} — S7's partial-patch shape for
 *  `content_post_update`: a caller who omits `bodyJson` keeps the stored value (merged in by the
 *  handler, not here), but a caller who SENDS a non-object one is still rejected with the exact
 *  same "(object) is required" message `requireObject` always threw — a present-but-malformed
 *  `bodyJson` is a shape error whether or not the field is required. */
export function optionalBodyJson({ input, key }: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {}): JsonObject | undefined {
  if (input[key] === undefined) return undefined;
  return requireBodyJson({ input, key });
}

/** Optional counterpart to `requireString`, for the same S7 partial patch: an omitted field keeps
 *  the stored value, but a SENT one must still be a non-empty string, rejected with the exact
 *  message the full-record shape always gave. The kit's `optionalString` accepts `""`, which would
 *  let an empty title or slug through where the full-record call rejected it. */
export function optionalNonEmptyString({ input, key }: { input: Record<string, unknown>; key: string }, _optional: Record<string, never> = {}): string | undefined {
  if (input[key] === undefined) return undefined;
  return requireString({ input: input, key: key });
}

/** `publishAt` for create/update: omitted ⇒ `undefined` (unchanged), `null` ⇒ clear, otherwise
 *  validated and normalized to UTC by the domain's own `normalizePublishAt` — the same function
 *  `createPost`/`updatePost` apply, called here only so the reply can say when the post goes live
 *  before the write even starts. A malformed value throws `PostValidationError`, which
 *  `withSchemaOnRejection` decorates with the schema. */
export function optionalPublishAt(input: Record<string, unknown>): string | null | undefined {
  return normalizePublishAt({ value: input.publishAt });
}

/**
 * `featuredImage` for create/update: omitted ⇒ `undefined`, `null` ⇒ clear, a string ⇒ resolved by
 * id or slug to the asset id the post stores (see `featured-image.ts` for why the id). Refusals are
 * `ToolInputError`s naming the reference and the next step.
 *
 * @complexity O(1) — one resolver call.
 */
export async function resolveFeaturedImageInput(routeDeps: PostToolDeps, input: Record<string, unknown>): Promise<string | null | undefined> {
  const value = input.featuredImage;
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolInputError({ message: "featuredImage must be a media asset id or slug, or null to remove the featured image." });
  }
  if (!routeDeps.mediaRepo) {
    throw new ToolInputError({ message: "featuredImage: the media library is not available to this assistant session, so a featured image cannot be set here. Set it in the post editor instead." });
  }
  const resolution = await resolveFeaturedImageRef({
    deps: { mediaRepo: routeDeps.mediaRepo, mediaContentTypeStore: routeDeps.mediaContentTypeStore, findMediaByIdOrSlug: routeDeps.findMediaByIdOrSlug },
    input: { workspaceId: routeDeps.workspaceId, ref: value },
  });
  if (!resolution.ok) throw new ToolInputError({ message: routeDeps.featuredImageRefusals[resolution.reason]({ ref: value.trim() }, { contentType: resolution.contentType }) });
  return resolution.id;
}
