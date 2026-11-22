import { widgetReport } from "./resolver-contracts.js";
import { isPlausibleMediaRefId } from "./markers/media-reference.js";
import type { WidgetHostPorts, MediaContentTypeStorePort } from "./host-ports.js";
import type { MediaRepoPort, TransformDefinitionRepoPort } from "../media/index.js";
import type { PageHtmlEmbedRef } from "./html/html-embeds.js";
import type { WidgetRenderIR, WidgetResolveContext } from "./types.js";
import type { ResolveHtmlPageEmbedsDeps } from "./resolver-contracts.js";

/**
 * `data-embed-type="media"` resolver (2026-08-07) — NEW logic, not adapted from
 * `resolveWidgetType`: a media embed targets an assets-domain record (`MediaRepoPort`), never a
 * `widget`-type entries row, so it shares nothing with `resolveWidgetInstances`'s batching shape
 * beyond the same REQ-27/28 never-throws/degrade-to-absent discipline every resolver here follows.
 *
 * `data-embed-id` is the `assetId`; `data-embed-variant` is the transform name, defaulting to
 * {@link CORE_PUBLIC_TRANSFORM_NAME} (`"public"`, confirmed live against `media/bootstrap.ts`'s own
 * boot registration, not assumed from the plan doc) when the author omits `data-embed-variant`.
 * Builds the same `/m/{assetId}/{transformName}.v{version}/...` URL contract `render.ts`'s TipTap
 * `image` case already uses — this function only resolves the DATA (`{assetId, transformName,
 * version, alt, width, height, cssClass}`); `render.ts`'s `renderWidgetMediaImage`/`renderImageTag`
 * own the actual URL templating and escaping (the "reuse, don't reimplement" split this dispatch was
 * asked for, mirroring how `resolveWidgetTypeEmbeds` resolves data and `renderWidgetIr` renders it).
 *
 * **Scope limitation versus the original implementation plan — CLOSED for video, still open for
 * everything else (2026-08-24).** The plan's step 3 called for dispatching by the asset's STORED
 * MIME TYPE. `MediaRecord` (`@jini-ai/cms/media`) still has no mime/contentType field of its own —
 * that remains an upstream `@jini-ai/cms` gap, not fixed here — but this host now has a
 * host-owned side channel for it: `mediaContentTypeStore` (`media/content-type-store.ts`), keyed by
 * `record.source.sha256`, already populated at upload time (the host app's `src/server/inbound/admin-http/routes/media/upload.ts`) for the
 * admin Media screen's own Images/Videos filter. When present and it knows the asset's type as
 * `video/*`, this resolver now skips the image-transform lookup entirely and resolves a `video`-kind
 * IR instead — `render.ts`'s `renderWidgetMediaImage` branches on it. Everything else (no store
 * supplied, a sha256 miss, or a non-video type) falls through to the exact image-only behavior this
 * resolver has always had. Audio is still unhandled — no audio player exists anywhere in this
 * codebase to dispatch to, and nothing in this pass's scope asked for one.
 *
 * Never throws (REQ-27): a missing `mediaRepo`/`transformRepo` dependency, an id/name that fails
 * {@link isPlausibleMediaRefId}'s shape check, a nonexistent asset, or an unregistered transform name
 * all leave that ref's id absent from the returned map — `render.ts`'s `renderHtmlPageBody` degrades
 * an absent id to the REQ-28 placeholder exactly as it does for every other resolver here.
 *
 * @complexity O(e) over the media refs present (already capped at `MAX_HTML_EMBEDS_PER_PAGE`
 * upstream by `scanHtmlEmbeds`) — one `MediaRepoPort.findById` plus, for a non-video asset, at most
 * one `getLatestTransformDefinition` call per ref, run concurrently via `Promise.all` (mirrors
 * `pages.ts`'s `resolveMediaAssetMetadataForRender`'s own per-asset `findById` fan-out — the same
 * frozen-no-batch-primitive situation `MediaRepoPort` discloses there). A video asset additionally
 * costs one `mediaContentTypeStore.getMany` call (single-element, same no-batch shape) but skips the
 * transform lookup entirely, so the per-ref cost never exceeds the pre-existing image path's.
 * @overallScore 100
 */
/** One resolved `MediaRepoPort.findById` row — inferred rather than imported since this file has no
 *  standing `MediaRecord` import (see `resolveMediaPublicUrls`'s own file for why `media/`'s public
 *  types stay narrow at each import site). */
export type ResolvedMediaRecord = NonNullable<Awaited<ReturnType<MediaRepoPort["findById"]>>>;

/** The IR's `slug` for a resolved asset: `null` means "has none" (`MediaAssetRenderMeta`'s own
 *  contract), and a pre-backfill row stores that as `""`, so an empty slug is normalized to `null`
 *  rather than passed through. Shared by every media IR builder in this file. */
export function mediaIrSlug(record: ResolvedMediaRecord): string | null {
  return record.slug || null;
}

/** Shape-narrows a media ref into a usable `{assetId, transformName}` pair, or `undefined` when the
 *  ref's `id`/`variant` fails {@link isPlausibleMediaRefId}'s check — split out of
 *  {@link resolveOneMediaEmbed} so that function's own branch count stays proportional to "which
 *  resolution step failed", not also this shape check. */
/**
 * T10 (2026-09-16 embed-attributes plan): `ref.id ?? ref.slug` — a `"media"` marker accepts a `slug`
 * the same way a `"widget"` marker already does ({@link resolveWidgetTypeEmbeds}'s own doc,
 * 2026-08-31): `id` wins when both are present and `slug` is never even consulted, matching
 * `resolveOneMediaEmbed`'s own doc on its `refAssetId` — the value returned here IS that map key, and
 * is passed straight into `findMediaByIdOrSlug`, which has always accepted either shape; only this
 * shape-check gate was missing it before. Named `assetId` still (not `idOrSlug`) since that field is
 * renamed at its one call site immediately.
 */
function parseMediaEmbedRef(
  ref: PageHtmlEmbedRef,
  context: WidgetResolveContext,
  host: Pick<WidgetHostPorts, "media">
): { assetId: string; transformName: string } | undefined {
  const assetId = ref.id ?? ref.slug;
  const transformName = ref.variant ?? host.media.publicTransformName;
  if (assetId === null || !isPlausibleMediaRefId({ value: assetId }) || !isPlausibleMediaRefId({ value: transformName })) {
    widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "media" reference — missing or invalid "id"/"slug"/"variant" in data-embed-config' }, { meta: { workspaceId: context.workspaceId } });
    return undefined;
  }
  return { assetId, transformName };
}

/** Builds the non-video (image-transform) IR for a resolved asset — the transform lookup + prop
 *  assembly {@link resolveOneMediaEmbed} defers to once it knows the asset isn't a video. `undefined`
 *  when `transformName` names no registered transform. */
async function buildMediaImageIr(
  assetId: string,
  transformName: string,
  transformRepo: TransformDefinitionRepoPort,
  record: ResolvedMediaRecord,
  context: WidgetResolveContext,
  host: Pick<WidgetHostPorts, "media">
): Promise<WidgetRenderIR | undefined> {
  const definition = await host.media.getLatestTransformDefinition({
    deps: { transformRepo },
    input: { workspaceId: context.workspaceId, name: transformName },
  });
  if (!definition) {
    widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "media" reference — transform not registered' }, { meta: { workspaceId: context.workspaceId, assetId, transformName } });
    return undefined;
  }
  return {
    componentId: "media-image",
    props: {
      assetId,
      // Readable-slugs S3: `render.ts`'s `renderWidgetMediaImage` reads this to build the emitted
      // `/m/...` URL via `mediaUrlKey` — `null`/absent falls back to `assetId`, same as every other
      // emitter. See the rewritten comment at this function's own caller for why emitting the slug
      // here is now safe (S2a/S2b's `media_slug_history` rename safety).
      slug: mediaIrSlug(record),
      sha256: record.source.sha256,
      transformName,
      version: definition.version,
      alt: record.alt,
      width: record.width,
      height: record.height,
      cssClass: record.cssClass,
      htmlAttributes: record.htmlAttributes,
    },
  };
}

/** The marker's asset record: a slug-only marker is looked up by slug, anything else by id-or-slug. */
function findMediaEmbedRecord({ ref, refAssetId, mediaRepo, context, host }: {
  ref: PageHtmlEmbedRef;
  refAssetId: string;
  mediaRepo: MediaRepoPort;
  context: WidgetResolveContext;
  host: Pick<WidgetHostPorts, "media">;
}): Promise<ResolvedMediaRecord | null> {
  return ref.id === null && ref.slug !== null
    ? mediaRepo.findBySlug({ workspaceId: context.workspaceId, slug: ref.slug })
    : host.media.findMediaByIdOrSlug({ deps: { mediaRepo }, input: { workspaceId: context.workspaceId, idOrSlug: refAssetId } });
}

/** The recorded content type of `record`'s bytes, or `undefined` with no store or no recorded type. */
async function lookupMediaContentType(
  { record, context }: { record: ResolvedMediaRecord; context: WidgetResolveContext },
  { mediaContentTypeStore }: { mediaContentTypeStore?: MediaContentTypeStorePort | undefined } = {},
): Promise<string | undefined> {
  if (!mediaContentTypeStore) return undefined;
  const types = await mediaContentTypeStore.getMany({ workspaceId: context.workspaceId, sha256s: [record.source.sha256] });
  return types.get(record.source.sha256);
}

/** Video and audio render through the native player, never the image-transform pipeline. */
function isPlayerContentType(contentType: string | undefined): contentType is string {
  return contentType?.startsWith("video/") === true || contentType?.startsWith("audio/") === true;
}

function playerMediaIr({ canonicalAssetId, record, contentType }: { canonicalAssetId: string; record: ResolvedMediaRecord; contentType: string }): WidgetRenderIR {
  return {
    componentId: "media-image",
    props: {
      assetId: canonicalAssetId,
      slug: mediaIrSlug(record),
      sha256: record.source.sha256,
      contentType,
      alt: record.alt,
      width: record.width,
      height: record.height,
      cssClass: record.cssClass,
      htmlAttributes: record.htmlAttributes,
    },
  };
}

/** One media ref's resolved id + IR, or `undefined` when it could not be resolved — extracted so
 *  {@link resolveMediaTypeEmbeds}'s own `Promise.all` callback is a thin per-ref dispatch, never the
 *  decision itself. `mediaRepo`/`transformRepo` are passed non-optional here: the caller has already
 *  guarded their absence before ever constructing this per-ref work. */
async function resolveOneMediaEmbed(
  ref: PageHtmlEmbedRef,
  mediaRepo: MediaRepoPort,
  transformRepo: TransformDefinitionRepoPort,
  mediaContentTypeStore: MediaContentTypeStorePort | undefined,
  context: WidgetResolveContext,
  host: Pick<WidgetHostPorts, "media">
): Promise<{ assetId: string; ir: WidgetRenderIR } | undefined> {
  const parsed = parseMediaEmbedRef(ref, context, host);
  if (!parsed) return undefined;
  // `refAssetId` is exactly what the marker's `data-embed-id` says — a theme author may write
  // either the asset's `id` or its `slug` (2026-09-07). It stays the MAP KEY this function returns
  // (`resolveMediaTypeEmbeds`'s caller looks up the resolved map by the marker's own literal id, so
  // the key must match what was typed, not what it resolved to). `props.assetId` below is still
  // normalized to the canonical `record.id` (the gate/lookup identifier), but `render.ts` no longer
  // builds the served `/m/...` URL straight from it: as of readable-slugs S3, `props.slug` (added
  // below) is what `mediaUrlKey` actually emits into `src`, falling back to `props.assetId` only when
  // there is no valid slug. A later slug rename no longer risks breaking a URL already baked into
  // previously-rendered HTML — that used to be `record.id`'s whole reason for being the emitted
  // value; now it is `media_slug_history` (S2a/S2b) keeping the OLD slug resolving too.
  const { assetId: refAssetId, transformName } = parsed;

  const record = await findMediaEmbedRecord({ ref, refAssetId, mediaRepo, context, host });
  if (!record || record.status !== "active") {
    widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "media" reference — no such asset' }, { meta: { workspaceId: context.workspaceId, assetId: refAssetId } });
    return undefined;
  }
  const canonicalAssetId = record.id;

  const contentType = await lookupMediaContentType({ record, context }, { mediaContentTypeStore });
  if (isPlayerContentType(contentType)) {
    // Video/audio need no image transform lookup: the shared native-player renderer points at
    // `/m/{assetId}/original` (the byte-passthrough route — see that route's own doc for why
    // video can't go through the image-transform pipeline below), so `transformName`/`version`
    // would be unused props for this IR.
    return { assetId: refAssetId, ir: playerMediaIr({ canonicalAssetId, record, contentType }) };
  }

  const ir = await buildMediaImageIr(canonicalAssetId, transformName, transformRepo, record, context, host);
  return ir ? { assetId: refAssetId, ir } : undefined;
}

export async function resolveMediaTypeEmbeds(
  refs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const resolved = new Map<string, WidgetRenderIR>();
  const { mediaRepo, transformRepo, mediaContentTypeStore } = deps;
  if (!mediaRepo || !transformRepo) {
    if (refs.length > 0) {
      widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: "media" embeds present but no mediaRepo/transformRepo dependency was supplied — every occurrence degrades to the placeholder' }, { meta: { workspaceId: context.workspaceId, occurrences: refs.length } });
    }
    return resolved;
  }

  const entries = await Promise.all(
    refs.map((ref) => resolveOneMediaEmbed(ref, mediaRepo, transformRepo, mediaContentTypeStore, context, deps.host))
  );
  for (const entry of entries) {
    if (entry) resolved.set(entry.assetId, entry.ir);
  }

  return resolved;
}

/** Gallery widget adapter over the same media owner used by gallery HTML embeds. */
export function resolveGalleryWidgetMedia(
  { refs, deps, context }: { refs: readonly PageHtmlEmbedRef[]; deps: ResolveHtmlPageEmbedsDeps; context: WidgetResolveContext },
  _optional: Record<string, never> = {},
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  return resolveMediaTypeEmbeds(refs, deps, context);
}
