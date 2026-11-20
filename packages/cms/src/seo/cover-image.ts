/** @file Read adapter for the shared cover policy; no persisted SEO or post writes. */
import type { GetEntryMetaDeps } from "./seo.js";
import type { SeoMeta } from "./types.js";
import type { SeoPostRecord } from "./ports.js";
import { collectCoverMediaRefs, resolveCoverImage, type CoverImage, type CoverMedia } from "../media/cover-image.js";

/** Use the existing media/image owners to populate the selector's synchronous metadata port.
 * Unknown MIME follows the featured-image owner's existing acceptance rule; videos/trashed refs
 * are refused there before they enter this map. No new lookup or image URL owner is introduced.
 * @complexity O(n + a) body traversal and distinct refs, each with bounded existing media reads.
 */
export async function resolveSeoCoverImage(
  { deps, post }: { deps: GetEntryMetaDeps; post: SeoPostRecord },
  _optional: Record<string, never> = {},
): Promise<CoverImage | null> {
  const media = new Map<string, CoverMedia>();
  await Promise.all(collectCoverMediaRefs({ post }).map(async (ref) => {
    const valid = await deps.media.featuredImage.resolveFeaturedImageRef({ workspaceId: post.workspaceId, ref });
    if (!valid.ok) return;
    const asset = await deps.media.featuredImage.findMediaByIdOrSlug({ workspaceId: post.workspaceId, idOrSlug: ref });
    if (!asset || asset.status === "trashed") return;
    media.set(ref, { id: asset.id, width: asset.width, height: asset.height, contentType: null });
  }));
  return resolveCoverImage({ post, mediaLookup: ({ ref }) => media.get(ref) ?? null }, { allowExternalHttps: true });
}

/** Decode stored overrides for the detached cover projection; reject non-object JSON values.
 * @complexity O(s) time and space for the stored SEO JSON; no effects.
 */
function readCoverSeoOverrides(
  { seoExtJson }: Pick<SeoPostRecord, "seoExtJson">,
  _optional: Record<string, never> = {},
): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(seoExtJson ?? "{}");
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Match the existing SEO evaluator's malformed-JSON fallback. */ return {}; }
  return {};
}

/** Offer a body cover to the existing SEO evaluator below explicit overrides and above defaults.
 * This detached projection is confined to SEO reads; stored featuredMediaId stays untouched.
 * A library ref uses the evaluator's existing featured/default chain, including transform misses.
 * External body URLs populate OG only, never Twitter's fallback.
 * @complexity O(s) for the existing SEO JSON; no effects.
 */
export function withCoverSeoDefaults(
  { post, cover }: { post: SeoPostRecord; cover: CoverImage | null },
  _optional: Record<string, never> = {},
): SeoPostRecord {
  if (post.featuredMediaId || !cover) return post;
  if (cover.mediaId) return { ...post, featuredMediaId: cover.mediaId };
  const overrides = readCoverSeoOverrides({ seoExtJson: post.seoExtJson });
  return {
    ...post,
    seoExtJson: JSON.stringify({
      ...overrides,
      ogImage: overrides.ogImage || cover.url,
    }),
  };
}

/** Project the shared cover into one entry's SEO read port; missing entries keep the evaluator's
 * not-found behavior. Returns the raw row for admin provenance and cover for public JSON-LD.
 * @complexity O(n + a) shared body traversal/media reads; no persisted writes.
 */
export async function withCoverReadDeps(
  { deps, workspaceId, entryId }: { deps: GetEntryMetaDeps; workspaceId: string; entryId: string },
  _optional: Record<string, never> = {},
): Promise<{ deps: GetEntryMetaDeps; cover: CoverImage | null; rawPost: SeoPostRecord | null }> {
  const rawPost = await deps.postRepo.findById({ workspaceId, id: entryId });
  if (!rawPost) return { deps, cover: null, rawPost: null };
  const cover = await resolveSeoCoverImage({ deps, post: rawPost });
  const projected = withCoverSeoDefaults({ post: rawPost, cover });
  // Bind only the read port passed to the evaluator. A transient default must never reach a
  // write service or the shared seoDeps object used elsewhere in this process.
  return { deps: { ...deps, postRepo: {
    findById: async () => projected,
    extractPlainText: deps.postRepo.extractPlainText.bind(deps.postRepo),
    isTrashed: deps.postRepo.isTrashed.bind(deps.postRepo),
  } }, cover, rawPost };
}

/** Mark an external body URL as content in admin meta: its transient ogImage is not a stored
 * override. Keep actual stored overrides authoritative, including ones equal to the body URL.
 * @complexity O(s) stored SEO JSON parsing; pure, with malformed JSON treated as no override.
 */
export function withContentImageSource(
  { meta, rawPost }: { meta: SeoMeta; rawPost: SeoPostRecord | null },
  _optional: Record<string, never> = {},
): SeoMeta {
  if (!rawPost || meta.openGraph.imageSource !== "override") return meta;
  if (readCoverSeoOverrides({ seoExtJson: rawPost.seoExtJson }).ogImage) return meta;
  const { imageOverridden: _overridden, ...openGraph } = meta.openGraph;
  return { ...meta, openGraph: { ...openGraph, imageSource: "content" } };
}
