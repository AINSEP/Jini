import type { JsonObject } from "@jini-ai/core/primitives";
import { resolveSiteTimeZoneSafely } from "./date-label.js";
import type { WidgetResolveContext } from "./types.js";
import type { ResolveHtmlPageEmbedsDeps } from "./resolver-contracts.js";
import { type InlineEmbedRef, collectWidgetEmbeds, collectMediaRefAssetIds } from "./document-embed-refs.js";
import { resolveWidgetInstances, inlineContentOverrides, assembleInlineResolved } from "./widget-instance-resolution.js";
import { type ResolvedMediaRecord, mediaIrSlug } from "./media-embed-resolution.js";

/**
 * Owner-reported bug (2026-08-12, widened 2026-09-11 to also collect the generic `media` node — see
 * {@link collectMediaRefAssetIds}'s own doc) — resolves the `mediaTransformVersions`/
 * `mediaAssetMetadata` context a "post-content" IR's embedded TipTap doc needs to render its OWN
 * ref-based `image`/`media` nodes as real pictures instead of the filename-labelled placeholder.
 * Before this function existed,
 * NEITHER value was ever resolved for this render path at all: `render.ts`'s `renderWidgetPostContent`
 * called `renderDocNode(bodyJson)` with no media context, which silently defaults both to empty maps
 * — every ref-based image's transform lookup was unconditionally a miss, regardless of whether the
 * asset/transform genuinely existed (confirmed live: asset uploaded, `"public"` transform
 * registered, `/m/` rendition route returning 200 — and still a placeholder, because nothing upstream
 * ever looked any of that up for this render path). See `renderWidgetPostContent`'s own doc in
 * `render.ts` for the full trace.
 *
 * Mirrors `routes/site/pages.ts`'s `resolveMediaTransformVersionsForRender`/
 * `resolveMediaAssetMetadataForRender` — the identical resolution the generic (non-template) render
 * path already performs for `renderSite` — reusing THIS file's own `getLatestTransformDefinition`/
 * `mediaRepo.findById` primitives (already proven correct here by {@link resolveMediaTypeEmbeds}, the
 * sibling `"media"` embed resolver) rather than a third implementation of either lookup.
 *
 * Returns plain JSON, not `Map`s: `WidgetRenderIR.props` is a `JsonObject`, and this file must not
 * import `render.ts` (see this file's layering note above) to build a real `Map` and hand it across
 * that boundary directly. `render.ts`'s `readMediaTransformVersions`/`readMediaAssetMetadata`
 * reconstruct the `Map`s `renderDocNode` needs from this exact shape.
 *
 * Never throws (REQ-27, same discipline every resolver in this file follows): a `bodyJson` with no
 * ref-based images, or missing `mediaRepo`/`transformRepo` deps, resolves to empty objects —
 * `render.ts`'s `image` case already degrades an absent transform-version/metadata entry to the
 * placeholder, never a crash.
 *
 * Single-transform-name shortcut deliberately mirrored from `resolveMediaTransformVersionsForRender`
 * (not a per-node scan of every distinct `transformName` present): `registerTransform` has exactly
 * one caller anywhere in this codebase (`ensureCoreMediaTransform`), which only ever registers
 * {@link CORE_PUBLIC_TRANSFORM_NAME} — see that function's own doc for the full disclosure and what
 * widening this would take.
 *
 * Widened 2026-09-11 to also resolve `contentType` (`render.ts`'s `MediaAssetRenderMeta.contentType`'s
 * own doc), closing the gap that doc's own history section used to describe: this function's caller
 * is NOT limited to "a page embeds this post" — `routes/site/pages.ts`'s `renderViaTemplate` reaches
 * this same function (via `resolveContentTypeEmbeds`'s DB branch) for a post rendered at its OWN
 * public URL through a static-tier theme template, so a video asset in a post's own body was
 * silently rendering as `<img>` there too, not only when embedded into a page. Resolved via
 * `deps.mediaContentTypeStore`, keyed by the resolved record's `source.sha256` (the bytes' identity,
 * not the asset id) — the identical mechanism `resolveOneMediaEmbed` (this file's own sibling `media`
 * embed-type resolver) and `resolveMediaAssetMetadataForRender` (`routes/site/pages.ts`) both already
 * use, batched into ONE `getMany` call across every resolved asset rather than one call per asset
 * (that function's own shape, not `resolveOneMediaEmbed`'s per-ref shape, since this function already
 * gathers every ref up front). `mediaContentTypeStore` absent, or a sha256 with no recorded type,
 * both degrade `contentType` to `null` — read by `render.ts`'s `renderDocMedia` as "not video", never
 * a crash or a guess.
 *
 * @complexity O(a) over the distinct ref-based `assetId`s the body references, each behind one
 * `mediaRepo.findById` call, run concurrently via `Promise.all` alongside the single transform-
 * definition lookup — same shape `resolveMediaAssetMetadataForRender` and `resolveMediaTypeEmbeds`
 * both already use for their own per-asset fan-out — PLUS one further batched
 * `MediaContentTypeStorePort.getMany` call across every resolved asset's sha256 at once, run after
 * that fan-out resolves (its input is those results), mirroring `resolveMediaAssetMetadataForRender`'s
 * identical two-step shape.
 */
async function resolvePostContentMediaContext(
  deps: ResolveHtmlPageEmbedsDeps,
  bodyJson: JsonObject,
  context: WidgetResolveContext
): Promise<{ mediaTransformVersions: JsonObject; mediaAssetMetadata: JsonObject }> {
  const { mediaRepo, transformRepo, mediaContentTypeStore } = deps;
  const assetIds = new Set<string>();
  collectMediaRefAssetIds(bodyJson, assetIds);
  if (assetIds.size === 0 || !mediaRepo || !transformRepo) {
    return { mediaTransformVersions: {}, mediaAssetMetadata: {} };
  }

  const [definition, resolvedRecords] = await Promise.all([
    deps.host.media.getLatestTransformDefinition({
      deps: { transformRepo },
      input: { workspaceId: context.workspaceId, name: deps.host.media.publicTransformName },
    }),
    Promise.all(
      Array.from(assetIds).map(async (assetId): Promise<readonly [string, ResolvedMediaRecord] | undefined> => {
        const record = await mediaRepo.findById({ workspaceId: context.workspaceId, id: assetId });
        return record ? ([assetId, record] as const) : undefined;
      })
    ),
  ]);
  const found = resolvedRecords.filter((entry): entry is readonly [string, ResolvedMediaRecord] => entry !== undefined);

  const contentTypes =
    found.length > 0 && mediaContentTypeStore
      ? await mediaContentTypeStore.getMany({ workspaceId: context.workspaceId, sha256s: found.map(([, record]) => record.source.sha256) })
      : undefined;

  return {
    mediaTransformVersions: definition ? { [deps.host.media.publicTransformName]: definition.version } : {},
    mediaAssetMetadata: Object.fromEntries(
      found.map(([assetId, record]) => [
        assetId,
        {
          width: record.width,
          height: record.height,
          cssClass: record.cssClass,
          htmlAttributes: record.htmlAttributes,
          slug: mediaIrSlug(record),
          sha256: record.source.sha256,
          contentType: contentTypes?.get(record.source.sha256) ?? null,
        },
      ])
    ),
  };
}

/**
 * Owner-reported bug (2026-09-22) — the inline-widget half of a "post-content" IR's render context,
 * the sibling of {@link resolvePostContentMediaContext}. A `widgetEmbed` node in the embedded body
 * used to render as the placeholder on every template-rendered post, because `render.ts`'s
 * `renderWidgetPostContent` had no `inlineResolved` map to look its `placementId` up in. Resolves
 * through the SAME `collectWidgetEmbeds`/`resolveWidgetInstances`/`assembleInlineResolved` chain
 * `resolvePageWidgets` uses for the non-template path, and returns plain JSON
 * (`placementId -> WidgetRenderIR`) for the same layering reason that function's doc gives;
 * `render.ts`'s `readInlineWidgets` rebuilds the `Map`.
 *
 * @complexity O(w) over the body's `widgetEmbed` nodes plus, only when there is at least one, one
 * batched widget-instance load and one `resolveWidgetType` call per distinct type (REQ-24).
 */
async function resolvePostContentWidgetContext(
  deps: ResolveHtmlPageEmbedsDeps,
  bodyJson: JsonObject,
  context: WidgetResolveContext
): Promise<{ inlineWidgets: JsonObject }> {
  const inlineEmbeds: InlineEmbedRef[] = [];
  collectWidgetEmbeds(bodyJson, inlineEmbeds);
  if (inlineEmbeds.length === 0) return { inlineWidgets: {} };
  const referencedIds = new Set(inlineEmbeds.map((embed) => embed.widgetEntryId));
  const resolvedById = await resolveWidgetInstances(deps, context.workspaceId, referencedIds, context, inlineContentOverrides(inlineEmbeds), new Set(inlineEmbeds.filter(embed => !embed.content).map(embed => embed.widgetEntryId)));
  const inlineResolved = assembleInlineResolved(inlineEmbeds, resolvedById);
  return { inlineWidgets: Object.fromEntries(inlineResolved) as unknown as JsonObject };
}

/** Everything a "post-content" IR's embedded body needs to render beyond the body itself — media
 *  context plus inline widgets — spread into the IR's `props` by all three "post-content" builders. */
export async function resolvePostContentRenderContext(
  deps: ResolveHtmlPageEmbedsDeps,
  bodyJson: JsonObject,
  context: WidgetResolveContext
): Promise<JsonObject> {
  const [mediaContext, widgetContext, timeZone] = await Promise.all([
    resolvePostContentMediaContext(deps, bodyJson, context),
    resolvePostContentWidgetContext(deps, bodyJson, context),
    deps.siteTimeZone ? resolveSiteTimeZoneSafely({ workspaceId: context.workspaceId }, { siteTimeZone: deps.siteTimeZone }) : undefined,
  ]);
  return { ...mediaContext, ...widgetContext, ...(timeZone === undefined ? {} : { timeZone }) };
}
