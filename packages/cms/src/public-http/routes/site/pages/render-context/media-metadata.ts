import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";
import type { collectCoverMediaRefs } from "../../../../../media/cover-image.js";
import type { findMediaByIdOrSlug } from "../../../../../media/media-service.js";
import type { getLatestTransformDefinition } from "../../../../../media/transform-registry.js";
import type { resolveMediaCaptionsTrack } from "../../../../../media/site/public-path.js";
import type { MediaRepoPort, TransformDefinitionRepoPort } from "../../../../../media/ports.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { featuredImageView, FeaturedImageView as StaticFeaturedImage } from "../../../../http/site/render/template-render-data.js";

/**
 * ADR-027 §4 — resolves the latest registered version of the one core transform NAME a
 * ref-based `{assetId, transformName}` image node can use today
 * (`CORE_PUBLIC_TRANSFORM_NAME`, `media/bootstrap.ts`), ahead of `renderSite`. Mirrors
 * `resolveWidgetsForRender`'s "route resolves, `render.ts` stays I/O-free" split — this is the
 * ONE call site for media resolution, same shape as that function's own doc.
 *
 * Deliberately does NOT scan `post.bodyJson` for every distinct `transformName` an author's doc
 * might reference (the way `resolveHtmlPageEmbeds` scans a Page's `body_html` for embed ids):
 * `registerTransform` has exactly one caller anywhere in this codebase
 * (`ensureCoreMediaTransform`, `apps/website/src/server/runtime/composition/deps.ts`'s boot chain), which only ever registers
 * `CORE_PUBLIC_TRANSFORM_NAME` — there is no OTHER registered name a real ref could resolve
 * against yet, so a single-name lookup is behavior-identical to a full scan at today's real
 * scale. A second core-declared transform (`thumb`, `hero`, ...) would need this widened to a
 * real scan, same as the widget/html-embed resolvers already do for their own multi-id case —
 * disclosed here rather than silently assumed permanent.
 *
 * Returns an empty map (not a thrown error) when the transform is not yet registered (a
 * mid-boot race, or a workspace this hasn't run for) — `renderDocNode`'s `image` case already
 * treats a missing map entry as "not resolvable" and degrades to the placeholder, so this
 * function never needs its own try/catch beyond the route handler's existing one.
 */
export async function resolveMediaTransformVersionsForRender(
  { deps }: { deps: {
    workspaceId: string; transformDefinitionRepo: TransformDefinitionRepoPort;
    getLatestTransformDefinition: typeof getLatestTransformDefinition; CORE_PUBLIC_TRANSFORM_NAME: string;
  } }, _optional = {}
): Promise<ReadonlyMap<string, number>> {
  const definition = await deps.getLatestTransformDefinition({
    deps: { transformRepo: deps.transformDefinitionRepo },
    input: { workspaceId: deps.workspaceId, name: deps.CORE_PUBLIC_TRANSFORM_NAME },
  });
  return definition ? new Map([[deps.CORE_PUBLIC_TRANSFORM_NAME, definition.version]]) : new Map();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walks a TipTap-shaped `bodyJson` tree collecting every ref-based media node's `assetId` — both
 * the legacy image-only ref shape (ADR-027 §4's `{assetId, transformName}`) and the generic `media`
 * node (2026-09-11, `render.ts`'s `renderDocMedia`'s own doc) share this collection, since both key
 * their sizing/content-type override off the SAME `mediaAssetMetadata` map by `assetId` alone —
 * renamed from `collectImageAssetIds` accordingly. Same walk shape as `resolver-service.ts`'s
 * `collectWidgetEmbeds`, kept as a separate local copy since this module has no dependency on
 * that one. A legacy `image` node (only `attrs.src`/`attrs.title`, no `assetId`) is simply never
 * added — `render.ts`'s `image` case never reads `src`/`title` at all (see that case's own
 * comment), so there is nothing for a sizing override to key off for that shape anyway. */
function collectMediaRefAssetIds({ root, out }: { root: unknown; out: Set<string> }, _optional = {}): void {
  // An explicit stack, not recursion: a stored document's nesting depth is attacker/import-controlled
  // and a 5000-deep list overflowed the call stack here (GET /:slug -> 500) before `render.ts`'s own
  // MAX_RENDER_DEPTH placeholder could ever apply. Children are pushed in reverse so the walk stays
  // pre-order, the same visit order the recursive version had.
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) pushReversed({ stack, items: node });
    if (!isPlainObject(node)) continue;
    const assetId = mediaRefAssetId(node);
    if (assetId !== undefined) out.add(assetId);
    if (Array.isArray(node.content)) stack.push(node.content);
  }
}

/** Pushes `items` so they pop in their original order (the walk stays pre-order). */
function pushReversed({ stack, items }: { stack: unknown[]; items: readonly unknown[] }, _optional = {}): void {
  for (let i = items.length - 1; i >= 0; i--) stack.push(items[i]);
}

/** The `assetId` of a ref-based `image`/`media` node, or `undefined` for any other node. */
function mediaRefAssetId(node: Record<string, unknown>): string | undefined {
  if (node.type !== "image" && node.type !== "media") return undefined;
  if (!isPlainObject(node.attrs) || typeof node.attrs.assetId !== "string") return undefined;
  return node.attrs.assetId;
}

/** One resolved media ref's fetched row, ahead of the batched content-type lookup below — carries
 *  `sha256` alongside the sizing fields {@link resolveMediaAssetMetadataForRender} already fetched,
 *  since content type is keyed by the BYTES' identity (sha256), not by assetId — same reasoning
 *  `MediaContentTypeStorePort`'s own file header gives for why it's a separate port at all. Pulled
 *  out to a named type purely so the two-step assembly below reads as two typed passes rather than
 *  one long inline generic. */
type PendingMediaAssetMeta = Omit<MediaAssetRenderMeta, "contentType"> & { readonly sha256: string };

/**
 * Quick-and-dirty public-render sizing fix (owner-directed skip-the-ADR fix, 2026-08-05) —
 * resolves each ref-based media node's `MediaRecord.width`/`height`/`cssClass` override ahead of
 * `renderSite`, mirroring `resolveWidgetsForRender`/`resolveMediaTransformVersionsForRender`'s own
 * "route resolves, `render.ts` stays I/O-free" split (this is the one call site for this
 * resolution, same shape as those functions' own doc). Widened 2026-09-11 to also resolve
 * `contentType` (`render.ts`'s `MediaAssetRenderMeta.contentType`'s own doc) for the new generic
 * `media` doc node's dispatch — same map, same call site, one more field.
 *
 * Unlike `resolveMediaTransformVersionsForRender`, there is no single-name shortcut available here
 * — width/height/class are genuinely PER-ASSET values, not a property of `(workspaceId,
 * transformName)` alone — so this scans `post.bodyJson` for every distinct `assetId` a ref-based
 * `image`/`media` node references (mirroring `resolveHtmlPageEmbeds`'s own per-id scan for a Page's
 * `body_html`), then batch-fetches each one. Public cover fallback also adds refs from listed
 * posts' bodies and HTML images/embeds when their featured slot is empty. Those refs may be slugs,
 * so the existing id-first/slug-history media lookup resolves each key. `MediaRepoPort` (`@jini-ai/cms/media`) has no
 * `findByIds`/batch-by-id primitive — only `findById` — the same frozen-contract situation
 * `resolvePageWidgets`'s own file header discloses for `EntryRepoPort`; one `findById` per
 * distinct `assetId`, run concurrently, is the available primitive at today's real scale (a post
 * body with dozens of distinct images would need this widened to a real batch query, same as the
 * widget/html-embed resolvers already disclose for their own multi-id case).
 *
 * Never throws — a lookup that resolves to `null` (deleted, wrong workspace, or an id that was
 * never a real asset) is skipped, not thrown; the caller's `image`/`media` case already treats an
 * `assetId` absent from the returned map as "no override"/"not resolvable" (omit the attribute, or
 * degrade to the placeholder), never a crash.
 *
 * @complexity O(n + a) over scanned body nodes/bytes and distinct refs, each behind bounded media reads (run
 * concurrently via `Promise.all`, not serially), PLUS one further batched
 * `MediaContentTypeStorePort.getMany` call across every resolved asset's sha256 at once — a single
 * extra round-trip regardless of `a`, not one per asset (mirrors `resolver-service.ts`'s
 * `resolveOneMediaEmbed`, which calls the same port but per-ref since it resolves refs one at a
 * time; this function already gathers every ref up front, so one batched call covers them all).
 */
export async function resolveMediaAssetMetadataForRender({ deps, post }: { deps: {
    workspaceId: string; mediaRepo: MediaRepoPort;
    mediaContentTypeStore: { getMany(required: { workspaceId: string; sha256s: readonly string[] }): Promise<Map<string, string>> };
    collectCoverMediaRefs: typeof collectCoverMediaRefs; findMediaByIdOrSlug: typeof findMediaByIdOrSlug;
    resolveMediaCaptionsTrack: typeof resolveMediaCaptionsTrack;
  }; post: PostRecord | undefined }, /** Featured image (2026-10-05): listed posts whose featured image a theme's post cards may show
   *  (`buildTemplateRenderData`'s `posts[].featuredImage`). The shared policy also collects body
   *  image refs when their featured slot is empty. */
  optional: { listed?: readonly PostRecord[] } = {}): Promise<ReadonlyMap<string, MediaAssetRenderMeta>> {
  const assetIds = new Set<string>();
  if (post) collectMediaRefAssetIds({ root: post.bodyJson, out: assetIds });
  for (const entry of [...(post ? [post] : []), ...(optional.listed ?? [])]) {
    for (const ref of deps.collectCoverMediaRefs({ post: entry })) assetIds.add(ref);
  }
  if (assetIds.size === 0) return new Map();

  const entries = await Promise.all(
    Array.from(assetIds).map(async (assetId): Promise<readonly [string, PendingMediaAssetMeta] | undefined> => {
      const record = await deps.findMediaByIdOrSlug({ deps, input: { workspaceId: deps.workspaceId, idOrSlug: assetId } });
      if (!record || record.status === "trashed") return undefined;
      // G7-9: the doc-node video/audio renderer reads this resolved WebVTT track off the meta.
      const captionsTrack = await deps.resolveMediaCaptionsTrack({ deps, input: { workspaceId: deps.workspaceId, captions: record.captions } });
      return [
        assetId,
        {
          width: record.width,
          height: record.height,
          cssClass: record.cssClass,
          htmlAttributes: record.htmlAttributes,
          slug: record.slug,
          sha256: record.source.sha256,
          ...(captionsTrack ? { captionsTrack } : {}),
        },
      ] as const;
    })
  );
  const pending = entries.filter((entry): entry is readonly [string, PendingMediaAssetMeta] => entry !== undefined);
  if (pending.length === 0) return new Map();

  const contentTypes = await deps.mediaContentTypeStore.getMany({
    workspaceId: deps.workspaceId,
    sha256s: pending.map(([, meta]) => meta.sha256),
  });

  return new Map(
    pending.map(([assetId, meta]): [string, MediaAssetRenderMeta] => [
      assetId,
      {
        width: meta.width,
        height: meta.height,
        cssClass: meta.cssClass,
        htmlAttributes: meta.htmlAttributes,
        slug: meta.slug,
        sha256: meta.sha256,
        contentType: contentTypes.get(meta.sha256) ?? null,
        ...(meta.captionsTrack ? { captionsTrack: meta.captionsTrack } : {}),
      },
    ])
  );
}

/**
 * The featured image a static-tier post template's `{"type":"featured-image"}` marker shows
 * (2026-10-05), or `null` when the post has none or it does not resolve. Collects the shared cover
 * refs (`listed: [post]`) and hands the result to `render.ts`'s own `featuredImageView`,
 * the function the Liquid/Handlebars tiers' `post.featuredImage` comes from — one view, both tiers.
 * A post with no featured id or body media refs costs no asset lookups.
 *
 * @complexity O(n + a) body traversal plus distinct media refs, one MIME batch and transform read.
 */
export async function resolveFeaturedImageForRender(
  { deps, post }: { deps: Parameters<typeof resolveMediaAssetMetadataForRender>[0]["deps"] & Parameters<typeof resolveMediaTransformVersionsForRender>[0]["deps"] & { featuredImageView: typeof featuredImageView }; post: PostRecord }, _optional: Record<string, never> = {}
): Promise<StaticFeaturedImage | null> {
  if (deps.collectCoverMediaRefs({ post }).length === 0) return null;
  const [mediaAssetMetadata, mediaTransformVersions] = await Promise.all([
    resolveMediaAssetMetadataForRender({ deps, post: undefined }, { listed: [post] }),
    resolveMediaTransformVersionsForRender({ deps }),
  ]);
  return deps.featuredImageView({ ctx: { mediaAssetMetadata, mediaTransformVersions }, post });
}
