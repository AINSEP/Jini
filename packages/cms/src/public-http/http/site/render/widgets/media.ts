import type { JsonValue, JsonObject } from "@jini-ai/core/primitives";
import type { MarkerAttribute } from "../../../../../widgets/markers/index.js";
import { isObject, str } from "../value-readers.js";
import { renderWidgetPlaceholder } from "./placeholder.js";
import { MEDIA_PLAYBACK_COPY } from "../media-playback-copy.js";
import type { GalleryImageRenderer } from "../../../../../widgets/html/gallery-render.js";
import type { WidgetDocRendering } from "../doc/doc-render-contract.js";
import type { WidgetRenderIR } from "../../../../../widgets/index.js";
import type { WidgetMediaHost } from "./widget-render-contract.js";
import { readCaptionTrackInput } from "../../../../../widgets/caption-track.js";

/**
 * Renders a resolved `data-embed-type="media"` Page embed (SPEC-047, generalized 2026-08-07;
 * video/embed capability added 2026-08-24) — `resolver-service.ts`'s `resolveMediaTypeEmbeds`
 * already did the I/O (asset lookup, content-type lookup, and — for a non-video asset — transform
 * version lookup) and only ever puts a `"media-image"` IR into its result map once every value
 * below is a validated primitive, so this function's own `isPlausibleMediaRefId`/`typeof` checks
 * are defense-in-depth (mirrors Jini form renderer's re-check-even-though-upstream-
 * validated precedent), not the primary guard. A malformed `props` shape — which should never
 * happen from this codebase's own resolver, only from some future/foreign IR producer — degrades to
 * the ordinary widget placeholder rather than emitting a malformed or unsafe `<img>`/`<video>` tag.
 *
 * Dispatches on `props.contentType` (present only for a video asset — see `resolveMediaTypeEmbeds`'s
 * own doc for why an image asset's IR never carries it) to `renderVideoTag` instead of
 * `renderImageTag`; `transformName`/`version` are irrelevant to a video tag and simply aren't read
 * on that branch. `props.width`/`height`/`cssClass` come through as `JsonValue` (a
 * `WidgetRenderIR.props` is `JsonObject`, so `null` and `number` both need explicit narrowing) —
 * normalized to each render function's `number | null` / `string | null` contract before
 * delegating, same "own it once, reuse everywhere" split `renderImageTag`'s own doc describes.
 */
/** Shape-narrows `renderWidgetMediaImage`'s optional sizing/class props from raw `JsonValue` to each
 *  render function's own `number | null` / `string | null` contract — pulled out so this one
 *  three-field narrowing step stops being three of `renderWidgetMediaImage`'s own branches (complexity-
 *  debt sweep, 2026-09-03; that function was at cyclomatic 11 against this repo's 9 ceiling). No
 *  behavior change: same "wrong-typed value degrades to null, never a lie" rule as before. */
/** Narrows `props.markerAttributes` (the plain-object array {@link withOccurrenceMediaAttributes}
 *  wrote) back to {@link MarkerAttribute}[] — a malformed entry (wrong-typed `name`, a `value` that
 *  is neither `string` nor `null`) is dropped rather than trusted, the same "wrong-typed value
 *  degrades to null/empty, never a lie" rule {@link normalizeMediaDimensions} already applies to
 *  every other field here; this codebase's own IR is the only producer, so this should never actually
 *  reject anything, but a malformed/foreign IR must still degrade safely rather than throw.
 *  @complexity O(n) in the array's length. */
function normalizeMarkerAttributesProp({ value, host }: { value: JsonValue | undefined; host: WidgetMediaHost }, _optional = {}): readonly MarkerAttribute[] {
  if (!Array.isArray(value)) return host.noMarkerAttributes;
  const attrs: MarkerAttribute[] = [];
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.name !== "string") continue;
    if (typeof entry.value === "string" || entry.value === null) attrs.push({ name: entry.name, value: entry.value });
  }
  return attrs;
}

function normalizeMediaDimensions({ props, host }: { props: JsonObject; host: WidgetMediaHost }, _optional = {}): {
  width: number | null;
  height: number | null;
  cssClass: string | null;
  htmlAttributes: string | null;
  markerAttributes: readonly MarkerAttribute[];
  controls: boolean;
} {
  return {
    width: typeof props.width === "number" ? props.width : null,
    height: typeof props.height === "number" ? props.height : null,
    cssClass: typeof props.cssClass === "string" ? props.cssClass : null,
    htmlAttributes: typeof props.htmlAttributes === "string" ? props.htmlAttributes : null,
    markerAttributes: normalizeMarkerAttributesProp({ value: props.markerAttributes, host }),
    // `EmbedOccurrence.controls`'s own default (`html-embeds.ts`) is `true`; the ONLY way this ends up
    // `false` is `withOccurrenceMediaAttributes` writing the literal JSON boolean `false` here.
    controls: props.controls !== false,
  };
}

/** The audio / video branch of {@link renderWidgetMediaImage}: `null` when the asset is not playable
 *  media (so the caller falls through to the image transform path). Split out so that function stays
 *  inside the complexity ceiling; no behavior change. */
function renderPlaybackTag(
  { props, host, urlKey, sha256, alt, width, height, cssClass, htmlAttributes, markerAttributes, controls }: {
    props: JsonObject; host: WidgetMediaHost; urlKey: string; sha256: { sha256?: string }; alt: string;
  } & ReturnType<typeof normalizeMediaDimensions>,
  _optional = {},
): string | null {
  const { mediaPublicPath, renderVideoTag } = host.media;
  const contentType = props.contentType;
  // G7-9: the resolver stage puts the resolved WebVTT track on the IR; `renderVideoTag` re-validates it.
  const captions = { captionsTrack: readCaptionTrackInput({ value: props.captionsTrack }) };
  if (typeof contentType === "string" && contentType.startsWith("audio/")) {
    return renderVideoTag({ kind: "audio", src: mediaPublicPath({ key: urlKey, ...sha256, variant: { kind: "original", contentType } }), fallbackText: MEDIA_PLAYBACK_COPY.audio, alt, width: null, height: null, cssClass, htmlAttributes, markerAttributes, controls }, captions);
  }
  if (typeof contentType === "string" && contentType.startsWith("video/")) {
    return renderVideoTag({ src: mediaPublicPath({ key: urlKey, ...sha256, variant: { kind: "original", contentType } }), fallbackText: MEDIA_PLAYBACK_COPY.video, alt, width, height, cssClass, htmlAttributes, markerAttributes, controls }, captions);
  }

  return null;
}

export function renderWidgetMediaImage({ props, host }: { props: JsonObject; host: WidgetMediaHost }, _optional = {}): string {
  const { mediaPublicPath, mediaUrlKey, plausibleMediaRefId, renderImageTag } = host.media;
  const assetId = plausibleMediaRefId({ value: props.assetId });
  if (!assetId) {
    return renderWidgetPlaceholder();
  }
  const normalized = normalizeMediaDimensions({ props, host });
  const { width, height, cssClass, htmlAttributes, markerAttributes } = normalized;
  const alt = str({ value: props.alt });
  // Readable-slugs S3: `resolver-service.ts`'s `resolveOneMediaEmbed` (both its video and image IR
  // branches) stashes the resolved record's `slug` onto the IR alongside `assetId` — same
  // `mediaUrlKey` fallback-to-id rule every other emitter here uses.
  const urlKey = mediaUrlKey({ id: assetId, slug: typeof props.slug === "string" ? props.slug : null });
  // `exactOptionalPropertyTypes`: an absent hash is an absent key, not an explicit `undefined`.
  const sha256 = typeof props.sha256 === "string" ? { sha256: props.sha256 } : {};

  /**
   * points `src` at `/m/{assetId}/original` (`routes/site/media-rendition.ts`'s
   * `registerMediaOriginalVideoRoute`) instead of the versioned transform URL: video has no
   * transform/version to template in, since it bypasses the image-transform pipeline entirely (see
   * that route's own doc for why).
   */
  const playback = renderPlaybackTag({ props, host, urlKey, sha256, alt, ...normalized });
  if (playback !== null) return playback;

  const transformName = plausibleMediaRefId({ value: props.transformName });
  const version = props.version;
  if (!transformName || typeof version !== "number") {
    return renderWidgetPlaceholder();
  }
  /** The `/m/...` path segment to serve this asset at — its slug when it has one, otherwise its id.
   *  Built by every caller via `mediaUrlKey` (readable-slugs S3); this function only templates
   *  whatever key it is handed, same as before this field was renamed from `assetId`. */
  const src = mediaPublicPath({ key: urlKey, ...sha256, variant: { kind: "transform", name: transformName, version, ext: "jpg" } });
  return renderImageTag({ src, alt, width, height, cssClass, htmlAttributes, markerAttributes, responsive: props.galleryResponsive === true });
}

/** Gallery image adapter: managed media uses the canonical renderer; URL images retain the
 * document image renderer's scheme, credential and private-admin-route guards. No I/O.
 */
function renderGalleryImage({ image, media, docRendering, host }: Parameters<GalleryImageRenderer>[0] & { docRendering: WidgetDocRendering; host: WidgetMediaHost }, _optional = {}): string {
  const slug = (image as typeof image & { slug?: string }).slug;
  // URL image: no managed reference. `parseGalleryConfig` (Jini `markers/gallery.ts`) accepts a
  // legacy image only with exactly one of `mediaId`/`src`, and media-mode items are slug-only, so an
  // image reaching here with neither `slug` nor `mediaId` always carries its `src` (L082b: the old
  // `src ?? ""` fallback could not run).
  if (slug === undefined && image.mediaId === undefined && image.src !== undefined) {
    return docRendering.renderDocNode({ node: { type: "image", attrs: { src: image.src, alt: image.alt } } });
  }
  // No `!media` guard here: `renderGallery`'s `renderFigure` (Jini `gallery-render.ts`), this
  // adapter's only caller, already returns `""` for a managed image without a media record before
  // calling it. Even if that ever changed, `media` undefined spreads to no `assetId`, which
  // `renderWidgetMediaImage` already renders as the same widget placeholder.
  return renderWidgetMediaImage({ props: { ...media, alt: image.alt, galleryResponsive: true }, host });
}

/** Gallery compatibility and generic media share one renderer. HTML uses the page-body policy. */
export function renderMediaWidget({ ir, docRendering, host }: { ir: WidgetRenderIR; docRendering: WidgetDocRendering; host: WidgetMediaHost }, _optional: Record<string, never> = {}): string {
  const renderImage: GalleryImageRenderer = ({ image, media }) => renderGalleryImage({ image, media, docRendering, host });
  const renderOptions = {
    config: ir.props.config, media: ir.props.media, renderImage,
    renderRawHtml: ({ html, media }: { html: string; media: Record<string, JsonObject> }) => host.renderMediaRawHtml({
      html, media, renderMedia: ({ props }) => renderWidgetMediaImage({ props, host }),
    }, { report: host.report }),
  };
  return host.renderGallery(renderOptions);
}
