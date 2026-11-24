import type { findMediaByIdOrSlug, MediaRepoPort } from "../media/index.js";
import type { MediaContentTypeStorePort } from "../media/site/content-type-store.js";
import { PostValidationError } from "./post.js";

/**
 * @file Resolves the media reference a caller gives for a post/page's featured image (2026-10-05)
 * to the canonical asset id `PostRecord.featuredMediaId` stores.
 *
 * Why the id and never the slug: the render path looks the featured asset up by id
 * (`featuredImageView` in `render.ts` reads `mediaAssetMetadata.get(post.featuredMediaId)`), and a
 * media slug is editable, so storing one would break the moment the asset is renamed.
 *
 * `normalizeFeaturedMediaId` (`post.ts`) checks shape only; this is the existence check it defers
 * to "the caller that resolved it". Both writers call it: the agent tool (`resolveFeaturedImageInput`
 * in `tool-registrations.ts`) and the admin REST post/page update routes (via
 * {@link resolveFeaturedMediaIdForWrite}). The REST arm was added 2026-10-05 after a visual check
 * saved a VIDEO as a post's featured image through the editor's picker — the picker trusting the
 * library was not enough, because the library holds videos too.
 */

export interface FeaturedImageDeps {
  mediaRepo: MediaRepoPort;
  /** The media owner's id-first, then-slug lookup, bound by the host. Injected (not imported) so the
   *  posts subpath never loads the media service and its node-only runtime. */
  findMediaByIdOrSlug: typeof findMediaByIdOrSlug;
  /** Optional: content types are sniffed into this store lazily, so an asset may have none yet. An
   *  unknown type is accepted (it cannot be told apart from an image); a known non-image is not. */
  mediaContentTypeStore?: Pick<MediaContentTypeStorePort, "getMany">;
}

export type FeaturedImageResolution =
  | { ok: true; id: string }
  | { ok: false; reason: "missing" | "trashed" | "not-image"; contentType?: string };

/**
 * Looks the reference up through `findMediaByIdOrSlug` (id first, then slug — the lookup every
 * media reference in this codebase uses), and refuses a trashed asset or one whose recorded content type is not an image.
 *
 * @complexity O(1) — at most two repo reads and one content-type read.
 */
export async function resolveFeaturedImageRef(required: {
  deps: FeaturedImageDeps;
  input: { workspaceId: string; ref: string };
}, _optional: Record<string, never> = {}): Promise<FeaturedImageResolution> {
  const { deps, input } = required;
  const ref = input.ref.trim();
  const asset = await deps.findMediaByIdOrSlug({ deps: { mediaRepo: deps.mediaRepo }, input: { workspaceId: input.workspaceId, idOrSlug: ref } });
  if (!asset) return { ok: false, reason: "missing" };
  if (asset.status === "trashed") return { ok: false, reason: "trashed" };
  const types = await deps.mediaContentTypeStore?.getMany({ workspaceId: input.workspaceId, sha256s: [asset.source.sha256] });
  const contentType = types?.get(asset.source.sha256);
  if (contentType !== undefined && !contentType.startsWith("image/")) return { ok: false, reason: "not-image", contentType };
  return { ok: true, id: asset.id };
}

const FEATURED_MEDIA_ID_REFUSALS: Record<"missing" | "trashed" | "not-image", (required: { ref: string }, optional?: { contentType?: string | undefined }) => string> = {
  missing: ({ ref }, _optional = {}) => `featuredMediaId: no media asset has the id '${ref}'.`,
  trashed: ({ ref }, _optional = {}) => `featuredMediaId: media asset '${ref}' is in Trash. Restore it first, or pick another image.`,
  // `resolveFeaturedImageRef` only reports "not-image" together with the known type it judged.
  "not-image": ({ ref }, { contentType } = {}) => `featuredMediaId: media asset '${ref}' is ${contentType}, not an image. A featured image must be an image.`,
};

/**
 * The admin REST routes' `featuredMediaId` check — {@link resolveFeaturedImageRef} with its
 * refusals thrown as `PostValidationError`, which both update routes already answer as a 400
 * `VALIDATION_ERROR`. Omitted (`undefined`) and `null` (clear) pass through untouched; a non-string
 * is left to `normalizeFeaturedMediaId`'s shape check in `updatePost`. A string resolves to the
 * canonical asset id, so a media slug sent here is stored as the id (see this file's header for why).
 *
 * @complexity O(1) — one resolver call.
 */
export async function resolveFeaturedMediaIdForWrite(required: {
  deps: FeaturedImageDeps;
  input: { workspaceId: string; featuredMediaId: string | null | undefined };
}, _optional: Record<string, never> = {}): Promise<string | null | undefined> {
  const { deps, input } = required;
  const value = input.featuredMediaId;
  if (typeof value !== "string" || value.trim() === "") return value;
  const resolution = await resolveFeaturedImageRef({ deps, input: { workspaceId: input.workspaceId, ref: value } });
  if (!resolution.ok) throw new PostValidationError(FEATURED_MEDIA_ID_REFUSALS[resolution.reason]({ ref: value.trim() }, { contentType: resolution.contentType }));
  return resolution.id;
}
