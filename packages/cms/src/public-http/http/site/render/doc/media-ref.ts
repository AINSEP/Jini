import type { JsonObject } from "@jini-ai/core/primitives";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { renderImageTag } from "../../../../../widgets/media-tags.js";
import type { DocNodeRenderDeps } from "./doc-render-contract.js";

/** The `assetId`/`transformName` pair a ref-shaped image node's `attrs` must carry, or `null` when
 *  either is absent or fails {@link isPlausibleMediaRefId}'s shape check — split out of
 *  {@link tryRenderRefImage} purely to keep that function's own branch count down; no behavior of
 *  its own beyond the two field reads plus the shape check. */
function resolveRefImageIds({ attrs, isPlausibleMediaRefId }: { attrs: JsonObject; isPlausibleMediaRefId: DocNodeRenderDeps["host"]["media"]["isPlausibleMediaRefId"] }): { assetId: string; transformName: string } | null {
  const assetId = typeof attrs.assetId === "string" ? attrs.assetId : undefined;
  const transformName = typeof attrs.transformName === "string" ? attrs.transformName : undefined;
  if (!assetId || !transformName || !isPlausibleMediaRefId({ value: assetId }) || !isPlausibleMediaRefId({ value: transformName })) return null;
  return { assetId, transformName };
}

/** `mediaAssetMetadata`'s per-asset overrides, normalized to {@link renderImageTag}'s `null`-means-
 *  "not set" contract — same reasoning as {@link resolveRefImageIds}: pulled out only to keep
 *  {@link tryRenderRefImage}'s own branch count (three `??` fallbacks plus three `?.` reads all
 *  count as separate branches under this repo's complexity gate) from being counted against it. */
function resolveMediaAssetOverrides({ meta }: { meta: MediaAssetRenderMeta | undefined }, _optional = {}): Pick<
  Parameters<typeof renderImageTag>[0],
  "width" | "height" | "cssClass" | "htmlAttributes"
> {
  return {
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    cssClass: meta?.cssClass ?? null,
    htmlAttributes: meta?.htmlAttributes ?? null,
  };
}

/**
 * The `media` node's per-instance style precedence (2026-09-11, owner-directed: "you may have one
 * image being used across multiple things, and you wanna control the CSS in a post … just in that
 * post" — per-POST override on top of the asset-level default {@link resolveMediaAssetOverrides}
 * already resolves). One field at a time: the NODE's own value wins whenever it is set (non-null,
 * non-empty), the ASSET's value otherwise. Decided per field, not all-or-nothing, so a node that
 * overrides only `cssClass` still inherits the asset's own `htmlAttributes` (and always its
 * width/height — this task threads only `cssClass`/`htmlAttributes` onto the node, never size).
 *
 * "Empty means unset" here mirrors every other optional string field in this file rather than
 * inventing a new convention: {@link renderImageTag}'s own `props.cssClass ? … : ""` check and
 * {@link resolveEmbedHtmlAttributes}'s `!raw` guard both already treat `""` the same as `null`.
 *
 * @complexity O(1).
 */
export function mediaNodeStyleOverride({ nodeValue, assetValue }: { nodeValue: string | null; assetValue: string | null }, _optional = {}): string | null {
  return nodeValue ? nodeValue : assetValue;
}

/**
 * Attempts the REF-node image path — `attrs.assetId`/`attrs.transformName` resolved against
 * `mediaTransformVersions`/`mediaAssetMetadata` (the frozen URL contract). Returns `null`
 * when the ref shape isn't present/plausible, or the transform name isn't yet resolvable.
 * {@link renderDocImage} then uses LEGACY `src` only when no assetId is present — see that
 * function's own doc for the full two-shape contract this implements one
 * half of, and for why an unresolved ref degrades to a placeholder rather than a malformed URL.
 *
 * `nodeStyleOverride` (2026-09-11): optional per-node `cssClass`/`htmlAttributes`, layered over the
 * resolved asset's own same-named fields via {@link mediaNodeStyleOverride} — see that function's
 * doc for the full precedence rule. Only {@link renderDocMedia} (the `media` node) ever passes this;
 * {@link renderDocImage} (the legacy `image` node, out of scope for per-node styling) always omits
 * it, so `image` renders byte-identical to before this parameter existed.
 */
export function tryRenderRefImage(
  { attrs, alt, deps }: { attrs: JsonObject; alt: string; deps: DocNodeRenderDeps }, { nodeStyleOverride }: { nodeStyleOverride?: { cssClass: string | null; htmlAttributes: string | null } } = {}
): string | null {
  const { media } = deps.host;
  const ids = resolveRefImageIds({ attrs, isPlausibleMediaRefId: media.isPlausibleMediaRefId });
  if (!ids) return null;
  const version = deps.mediaTransformVersions.get(ids.transformName);
  if (version === undefined) return null;
  const meta = deps.mediaAssetMetadata.get(ids.assetId);
  const assetOverrides = resolveMediaAssetOverrides({ meta });
  const overrides = nodeStyleOverride
    ? {
        ...assetOverrides,
        cssClass: mediaNodeStyleOverride({ nodeValue: nodeStyleOverride.cssClass, assetValue: assetOverrides.cssClass }),
        htmlAttributes: mediaNodeStyleOverride({ nodeValue: nodeStyleOverride.htmlAttributes, assetValue: assetOverrides.htmlAttributes }),
      }
    : assetOverrides;
  const urlKey = media.mediaUrlKey({ id: ids.assetId, slug: meta?.slug ?? null });
  /** The `/m/...` path segment to serve this asset at — its slug when it has one, otherwise its id.
   *  Built by every caller via `mediaUrlKey` (readable-slugs S3); this function only templates
   *  whatever key it is handed, same as before this field was renamed from `assetId`. */
  const src = media.mediaPublicPath({ key: urlKey, sha256: meta?.sha256 ?? null, variant: { kind: "transform", name: ids.transformName, version, ext: "jpg" } });
  return media.renderImageTag({ src, alt, ...overrides });
}
