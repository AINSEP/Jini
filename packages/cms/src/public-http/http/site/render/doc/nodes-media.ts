import type { DocNodeHandlerRequired, DocNodeRenderDeps } from "./doc-render-contract.js";
import { isObject } from "../value-readers.js";
import { tryRenderRefImage, mediaNodeStyleOverride } from "./media-ref.js";
import { mediaPlaceholder } from "../media-placeholder.js";
import { escapeHtml } from "@jini-ai/core/text";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import { MEDIA_PLAYBACK_COPY } from "../media-playback-copy.js";

/**
 * D7 (original), extended under ADR-027 §4 and this task's quick-and-dirty sizing fix: a
 * TipTap image node reaches this renderer in one of two shapes. LEGACY nodes carry only
 * `attrs.src`/`attrs.title` — some combination of an inlined `data:` blob, an arbitrary
 * external URL, or the *authenticated* admin media-preview URL, none of which are safe or
 * correct to embed unescaped on public, unauthenticated HTML. Unsafe sources keep degrading to the
 * same aspect-ratio placeholder (`mediaPlaceholder`); safe sources and their optional title and
 * dimensions are escaped before rendering. The original D7 safety rationale still applies:
 * a real running server was verified live (see
 * `media/bootstrap.ts`'s file header) to have posts whose only image `src` values are exactly
 * these unsafe kinds, so silently starting to trust `src` would be a public security
 * regression, not a fix.
 *
 * REF nodes (new, ADR-027 §4's own stated `bodyJson` contract: "stores refs
 * `{assetId, transformName}`, never URLs") carry `attrs.assetId`/`attrs.transformName`
 * instead, resolved by {@link tryRenderRefImage}; src-only nodes use {@link safeImageSrc}.
 * REF width/height/class: looked up from `mediaAssetMetadata` by
 * `assetId` ALONE (never gated on whether the src itself resolved to a placeholder-vs-real
 * image — an unresolved ref already returns `null` from {@link tryRenderRefImage}, so this
 * lookup only ever runs once a real `<img src>` is about to be emitted). Each attribute is
 * emitted independently and only when its value is non-null — an asset with only `width` set
 * gets `width="…"` alone, never a `height="0"` or empty `class=""`. Owner's explicit
 * instruction: width/height are BOTH optional; leaving either (or both) unset renders at
 * native size, never a computed/defaulted value.
 */
export function renderDocImage({ node, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const { classes, safeUrl, attributes } = deps.host;
  const refImage = tryRenderRefImage({ attrs, alt, deps });
  if (refImage) return refImage;
  // A managed ref must not publish its editor preview when its transform cannot resolve.
  if (attrs.assetId) return mediaPlaceholder({ props: { label: alt || "Image" }, classes: classes.mediaPlaceholder });
  // LEGACY `src`-only node (the toolbar's "Img by URL", and anything authored before refs
  // existed). Historically this fell straight through to the placeholder — `src` was never read
  // at all. The owner reversed that on 2026-08-12: refusing every `src` is a blunt instrument,
  // and this file already had the right shape for the problem in {@link safeHref}, which does
  // not refuse link hrefs but validates their scheme. {@link safeImageSrc} is that same
  // discipline for an image URL: an allowlist, not a ban. Anything it rejects still degrades to
  // the identical placeholder below, so invariant I2 (never silently empty) is unchanged.
  const legacySrc = safeUrl.safeImageSrc({ value: attrs.src });
  if (legacySrc !== null) {
    return `<img src="${escapeHtml({ text: legacySrc })}" alt="${escapeHtml({ text: alt })}"${attributes.formatHtmlAttributes({ attributes: legacyImageExtras(attrs) })} loading="lazy" />`;
  }
  return mediaPlaceholder({ props: { label: alt || "Image" }, classes: classes.mediaPlaceholder });
}

/** A LEGACY `src`-only image node's optional `title`/`width`/`height`, each kept only when it is a
 *  string or number (stringified; {@link formatHtmlAttributes} escapes them). @complexity O(1). */
function legacyImageExtras(attrs: JsonObject): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const name of ["title", "width", "height"]) {
    const value = attrs[name];
    if (typeof value === "string" || typeof value === "number") extras[name] = String(value);
  }
  return extras;
}

/**
 * The generic `media` doc node (2026-09-11 — owner-directed: don't add a `video` node beside
 * `image`, add ONE node and dispatch on the asset's real content type, so the next kind (audio, …)
 * costs one more branch instead of one more node type/schema entry/renderer everywhere again).
 *
 * Same ref-only contract `image`'s REF shape already established (ADR-027 §4): `attrs.assetId` plus
 * `attrs.transformName` locked to `CORE_PUBLIC_TRANSFORM_NAME` by both the published agent schema
 * (`TIPTAP_DOC_SCHEMA`, `features/post/agent-tools.ts`) and the admin editor's own insert command —
 * there is no `attrs.src` shape here at all, unlike `image`'s LEGACY fallback: `media` is new as of
 * this task, so there is no pre-existing content authored with a raw URL that back-compat has to
 * keep rendering.
 *
 * Dispatches on `deps.mediaAssetMetadata.get(assetId)?.contentType` (see that field's own doc for
 * exactly where it comes from and its one disclosed gap): video/audio types render native players
 * via the shared {@link renderVideoTag}. Anything else — a real image type, an unrecognized type, an asset
 * absent from `mediaAssetMetadata` entirely (`meta` is `undefined`, which reads as "not video" the
 * same as a `null`/non-video `contentType` would) — falls through to {@link tryRenderRefImage}, the EXACT resolution `image` itself
 * uses, so a real image asset referenced through this node renders byte-identical to referencing it
 * through `image`. {@link tryRenderRefImage} already returns `null` for anything it can't resolve
 * (unregistered transform, implausible id shape, …), so an unresolvable `media` node degrades to the
 * same placeholder `image` degrades to — never a crash, never silence.
 *
 * AUDIO (owner-approved mediawidget, 2026-10-10/11): the formerly absent upload/sniffing
 * prerequisites are now owned by the shared media service. Audio extends the existing player
 * renderer and original-byte route, with no new node type or schema. The same per-node style
 * precedence and safe attribute merge therefore apply to video and audio.
 *
 * PER-NODE STYLE OVERRIDES (2026-09-11): `attrs.cssClass`/`attrs.htmlAttributes` — same two field
 * names and same raw-text storage format as `MediaRecord`'s asset-level fields, added to the node
 * itself so one asset used across several posts can be styled differently per post. Precedence is
 * PER FIELD via {@link mediaNodeStyleOverride}: the node's own value wins whenever it is set
 * (non-null, non-empty), the resolved asset's value otherwise — applied identically on both dispatch
 * branches below (video and image), so an operator does not have to learn two different override
 * rules depending on what the asset turns out to be. `htmlAttributes` re-validation is NOT
 * duplicated here: both {@link renderVideoTag} and {@link tryRenderRefImage} (via
 * {@link renderImageTag}) already re-parse whatever string reaches them through
 * `resolveEmbedHtmlAttributes`'s shared embed allowlist and drop just the bad token on anything
 * disallowed, so a node-authored value gets the exact same security boundary an asset-authored value
 * already had, with no new parser and no second copy of the allowlist.
 */
export function renderDocMedia({ node, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const { classes, media } = deps.host;
  const assetId = media.plausibleMediaRefId({ value: attrs.assetId });
  if (!assetId) return mediaPlaceholder({ props: { label: alt || "Media" }, classes: classes.mediaPlaceholder });

  const nodeStyle = mediaNodeStyle(attrs);
  const meta = deps.mediaAssetMetadata.get(assetId);
  const player = meta ? renderDocMediaPlayer({ assetId, alt, meta, nodeStyle, media }) : null;
  return player ?? tryRenderRefImage({ attrs, alt, deps }, { nodeStyleOverride: nodeStyle }) ?? mediaPlaceholder({ props: { label: alt || "Media" }, classes: classes.mediaPlaceholder });
}

/** A `media` node's own `cssClass`/`htmlAttributes` (any string, empty included; `null` otherwise),
 *  the per-node half of {@link mediaNodeStyleOverride}'s precedence. @complexity O(1). */
function mediaNodeStyle(attrs: JsonObject): { cssClass: string | null; htmlAttributes: string | null } {
  return {
    cssClass: typeof attrs.cssClass === "string" ? attrs.cssClass : null,
    htmlAttributes: typeof attrs.htmlAttributes === "string" ? attrs.htmlAttributes : null,
  };
}

/** {@link renderDocMedia}'s video/audio dispatch on the asset's sniffed `contentType`: a native
 *  player with the node's style winning per field over the asset's; `null` for every other type
 *  (the caller then tries the ref image). Audio never carries width/height. @complexity O(n) in the
 *  winning `htmlAttributes` length (one allowlist parse inside {@link renderVideoTag}). */
function renderDocMediaPlayer(
  { assetId, alt, meta, nodeStyle, media }: {
    assetId: string;
    media: DocNodeRenderDeps["host"]["media"];
    alt: string;
    meta: MediaAssetRenderMeta;
    nodeStyle: { cssClass: string | null; htmlAttributes: string | null };
  },
): string | null {
  /** Same `mediaUrlKey`-built `/m/...` key {@link renderImageTag}'s own `urlKey` documents —
   *  readable-slugs S3. */
  const urlKey = media.mediaUrlKey({ id: assetId, slug: meta.slug });
  const sha256 = meta.sha256 ?? null;
  const style = {
    alt,
    cssClass: mediaNodeStyleOverride({ nodeValue: nodeStyle.cssClass, assetValue: meta.cssClass }),
    htmlAttributes: mediaNodeStyleOverride({ nodeValue: nodeStyle.htmlAttributes, assetValue: meta.htmlAttributes }),
  };
  /**
   * points `src` at `/m/{assetId}/original` (`routes/site/media-rendition.ts`'s
   * `registerMediaOriginalVideoRoute`) instead of the versioned transform URL: video has no
   * transform/version to template in, since it bypasses the image-transform pipeline entirely (see
   * that route's own doc for why).
   */
  if (meta.contentType?.startsWith("video/")) return media.renderVideoTag({ src: media.mediaPublicPath({ key: urlKey, sha256, variant: { kind: "original", contentType: meta.contentType } }), fallbackText: MEDIA_PLAYBACK_COPY.video, ...style, width: meta.width, height: meta.height });
  if (meta.contentType?.startsWith("audio/")) return media.renderVideoTag({ kind: "audio", src: media.mediaPublicPath({ key: urlKey, sha256, variant: { kind: "original", contentType: meta.contentType } }), fallbackText: MEDIA_PLAYBACK_COPY.audio, ...style, width: null, height: null });
  return null;
}

export function renderDocYoutube({ node, deps }: DocNodeHandlerRequired, _optional = {}): string {
  // See `extractYoutubeVideoId`'s own doc for why `attrs.src` is re-derived rather than
  // trusted. `start` (seconds into the video) is the only other attr this renders — `width`/
  // `height` are deliberately ignored: `.post-detail-body .youtube-embed` (styles.css) makes
  // every embed a responsive 16:9 box instead, which is both simpler than validating two more
  // numeric attrs and better UX than reproducing the editor's fixed-pixel default on a public
  // page that also has to work on a phone. `youtube-nocookie.com` (privacy-enhanced mode) is
  // used unconditionally rather than reading `nocookie` off attrs — a deliberate simplification,
  // not something the toolbar's own plain "paste a URL" control offers a way to opt out of.
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const { classes, safeUrl } = deps.host;
  const videoId = safeUrl.extractYoutubeVideoId({ value: attrs.src });
  if (!videoId) return mediaPlaceholder({ props: { label: "Video unavailable", ratio: "16 / 9" }, classes: classes.mediaPlaceholder });
  const numericStart = typeof attrs.start === "number" && Number.isInteger(attrs.start) ? attrs.start : 0;
  const start = numericStart > 0 && numericStart <= 999999 ? numericStart : 0;
  const startQuery = start > 0 ? `?start=${start}` : "";
  const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}${startQuery}`;
  return `<div class="${escapeHtml({ text: classes.youtubeEmbed })}"><iframe src="${escapeHtml({ text: embedSrc })}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
}
