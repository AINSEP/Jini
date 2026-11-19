import { parseEmbedHtmlAttributes } from "./markers/html-attributes.js";
import type { MarkerAttribute } from "./markers/marker.js";
import { escapeHtml } from "@jini-ai/core/text";

/**
 * Builds a real `<img>` tag from an already-resolved, already-validated media reference — the ONE
 * place its host-resolved media URL is assembled and the ONE place its attributes are escaped. Two callers share this: the TipTap
 * `image` ref-node case below (`assetId`/`transformName`/`version` resolved via
 * `mediaTransformVersions`/`mediaAssetMetadata`, threaded in by the route caller) and
 * `renderWidgetIr`'s `"media-image"` case (media Page embeds,
 * resolved ahead of render by the host's embed resolver) — same URL shape,
 * same escaping, same optional-attribute-omission rule, deliberately implemented once rather than
 * twice so the document and embed renderers cannot diverge.
 *
 * `width`/`height`/`cssClass` are each emitted independently and only when non-null — an asset with
 * only `width` set gets `width="…"` alone, never a `height="0"` or empty `class="""` (the same omission
 * contract as the original image renderer).
 *
 * @complexity O(1).
 * @overallScore 100
 */
/**
 * Re-validates `raw` free-text HTML attributes against the shared render-time allowlist
 * ({@link parseEmbedHtmlAttributes}) and returns only the accepted attribute map — the render-path half of the
 * allowlist's defense-in-depth (enforced at the write path AND the render path,
 * since a client-only check is not a control). `updateMediaMetadata` (`@jini-ai/cms/media`) already
 * validates before writing, so a re-parse failure here should be unreachable through the normal
 * write path — but this function still re-validates rather than trusting a stored value was never
 * written by an older code path, a direct DB edit, or a future bug in the write-side check, matching
 * this file's own "escape/validate at the one place a tag is templated" discipline for every other
 * attribute here.
 *
 * Every render-time re-parse of a free-text `htmlAttributes` field in this file — media asset, media
 * post-node, and widget post-node — goes through this ONE function, so all three share one allowlist
 * and one failure mode: a rejected token (an `on*` handler, an unsafe URL scheme, an unsafe `style`
 * value, a disallowed name) is simply omitted from the returned map, while every other token in the
 * same string still lands (`parseEmbedHtmlAttributes`'s per-token behavior). Only `malformed` —
 * the tokenizer itself losing sync — empties the whole map; `raw`'s caller never needs to
 * distinguish that from "nothing accepted" here, since both return `{}`.
 *
 * @param raw - The free-text `htmlAttributes` field (asset- or node-level) — `null`/empty means no
 *   extra attributes.
 * @complexity O(n) in `raw`'s length (one parse pass), O(k) space for k accepted attributes.
 */
export function resolveEmbedHtmlAttributes({ raw }: { raw: string | null }, _optional = {}): Record<string, string> {
  if (!raw) return {};
  return parseEmbedHtmlAttributes({ text: raw }).attributes;
}

/** A shallow copy of `attributes` with `key` removed — used when a call site already emits its own
 *  value for one allowlisted name (e.g. `renderImageTag`'s hardcoded `loading` default) and needs
 *  the rest formatted without emitting that name twice. @complexity O(k). */
export function omitKey({ attributes, key }: { attributes: Record<string, string>; key: string }, _optional = {}): Record<string, string> {
  const { [key]: _omitted, ...rest } = attributes;
  return rest;
}

/** Formats an already-resolved attribute map into escaped ` name="value"` fragments, one per
 *  entry — the shared tail every one of {@link renderImageTag}/{@link renderVideoTag}'s emitted
 *  attributes eventually goes through. @complexity O(k) in the number of attributes. */
export function formatHtmlAttributes({ attributes }: { attributes: Record<string, string> }, _optional = {}): string {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml({ text: value })}"`)
    .join("");
}

/** No marker forwarded any attribute — the common case (most media markers are bare), shared so
 *  {@link renderImageTag}/{@link renderVideoTag}'s callers don't each allocate an empty array. */
export const NO_MARKER_ATTRIBUTES: readonly MarkerAttribute[] = [];

/**
 * Formats one already-decided value for embedding inside a double-quoted HTML attribute — the render-
 * path half of attribute serialization. An **asset**-sourced value (`MediaRecord.
 * cssClass`/`htmlAttributes`, already allowlist-validated by {@link resolveEmbedHtmlAttributes}, not
 * itself entity-encoded) goes through the ordinary {@link escapeHtml}, matching every pre-existing call
 * site in this file. A **marker**-sourced value is SOURCE TEXT (`EmbedMarker.attrs`'s own
 * {@link MarkerAttribute}) and only its literal `"` is escaped — the identical rule
 * {@link formatMarkerAttributes} applies when re-serializing a wrapper's own kept attributes — so a
 * marker's `&amp;` is never re-escaped into `&amp;amp;`.
 *
 * @complexity O(n) in the value's length.
 */
export function attributeValueHtml({ value, source }: { value: string; source: "asset" | "marker" }, _optional = {}): string {
  return source === "asset" ? escapeHtml({ text: value }) : value.replace(/"/g, "&quot;");
}

/**
 * The `class` rule: the asset's `cssClass` comes first, then the author's marker `class` value,
 * joined with one space — an ADDITION, never a replacement, unlike every other attribute name (see
 * {@link mergeMediaExtraAttributes}'s own doc for why `class` is excluded from that generic merge and
 * handled here instead). A bare (valueless) marker `class` attribute contributes nothing — an
 * attribute name with no class names to add.
 *
 * @complexity O(1) beyond the linear `find` over `markerAttributes`.
 */
export function mergeMediaClassAttr({ assetClass, markerAttributes }: { assetClass: string | null; markerAttributes: readonly MarkerAttribute[] }, _optional = {}): string {
  const markerClass = markerAttributes.find((attr) => attr.name === "class")?.value;
  const parts = [
    assetClass ? attributeValueHtml({ value: assetClass, source: "asset" }) : null,
    markerClass ? attributeValueHtml({ value: markerClass, source: "marker" }) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` class="${parts.join(" ")}"` : "";
}

/**
 * Folds a free-text `htmlAttributes`' own `class` token — now allowlisted, unlike the old
 * `data-*`/`aria-*`-only boundary — into an already-built
 * ` class="..."` fragment from {@link mergeMediaClassAttr}, appended LAST so it layers on top of
 * both the asset's own `cssClass` and a marker's own `class` (the existing precedence between
 * those two is untouched; this is strictly an addition after it). Kept as its own step, rather than
 * folded into {@link mergeMediaClassAttr} itself, so that function's own asset/marker precedence
 * rule stays exactly as documented there — this is a third, independent source, not a change to how
 * the first two combine.
 *
 * @param classAttr - {@link mergeMediaClassAttr}'s own return value: either `""` or a full
 *   ` class="..."` fragment.
 * @param extraClass - `resolveEmbedHtmlAttributes(...).class`, already allowlist-validated,
 *   value-untouched — `undefined` when `htmlAttributes` carried no `class` token.
 * @complexity O(1).
 */
export function foldHtmlAttributesClass({ classAttr, extraClass }: { classAttr: string; extraClass: string | undefined }, _optional = {}): string {
  if (!extraClass) return classAttr;
  const escaped = attributeValueHtml({ value: extraClass, source: "asset" });
  return classAttr === "" ? ` class="${escaped}"` : `${classAttr.slice(0, -1)} ${escaped}"`;
}

/**
 * The `alt` rule for an `<img>`: the author's marker value REPLACES the asset's own `alt`, never
 * appends — unlike `class`. {@link renderVideoTag} has its own sibling for the fallback-text-node case
 * (`<video>` has no `alt` attribute at all).
 *
 * @complexity O(1) beyond the linear `find` over `markerAttributes`.
 */
export function mediaAltAttrValue({ assetAlt, markerAttributes }: { assetAlt: string; markerAttributes: readonly MarkerAttribute[] }, _optional = {}): string {
  const markerAlt = markerAttributes.find((attr) => attr.name === "alt");
  return markerAlt ? attributeValueHtml({ value: markerAlt.value ?? "", source: "marker" }) : attributeValueHtml({ value: assetAlt, source: "asset" });
}

/**
 * The `width`/`height` rule: the author's marker value replaces the asset's own numeric value; a
 * BARE marker `width`/`height` (no `="…"`, meaningless on its own) is treated as no override rather
 * than emitting an empty `width=""`. Shared by both dimensions since the rule (and the "author wins,
 * asset is the fallback, absent is omitted entirely" shape) is identical for each.
 *
 * @complexity O(1) beyond the linear `find` over `markerAttributes`.
 */
export function mediaDimensionAttr({ name, assetValue, markerAttributes }: { name: "width" | "height"; assetValue: number | null; markerAttributes: readonly MarkerAttribute[] }, _optional = {}): string {
  const markerAttr = markerAttributes.find((attr) => attr.name === name);
  if (markerAttr) {
    return markerAttr.value === null ? "" : ` ${name}="${attributeValueHtml({ value: markerAttr.value, source: "marker" })}"`;
  }
  return assetValue != null ? ` ${name}="${assetValue}"` : "";
}

/**
 * Merges the asset's own already-allowlisted `htmlAttributes` extras with a media marker's forwarded
 * attributes into one ordered, ready-to-emit fragment tail —
 * the shared "everything else" merge both {@link renderImageTag} and {@link renderVideoTag} call for
 * the names they don't each render at a fixed position themselves.
 *
 * Order and precedence: asset extras first, in their stored order; a marker attribute of the SAME
 * name then replaces that entry'S VALUE IN PLACE (same position — a `Map`'s `set` on an existing key
 * never moves it), while a marker attribute with a NEW name is appended, in authored order, after
 * every asset extra. This is "author wins, asset extras keep their position", not "marker
 * attributes always come last."
 *
 * `excludeNames` is how each caller keeps its own fixed-position names (`class`, `alt`, `width`,
 * `height`, `loading` for `<img>`, `controls` for `<video>`) out of this generic tail, so they are
 * never emitted twice. `src`/`srcset` are ALWAYS excluded regardless of caller — they are
 * renderer-owned (the resolved asset URL is the whole point of the marker; a `srcset` would
 * silently override `src`) and a marker's own value for either name must never reach the output, not
 * even into this generic merge.
 *
 * @complexity O(n + m) in the asset-extra count n and the marker-attribute count m.
 */
export function mergeMediaExtraAttributes(
  { assetExtras, markerAttributes, excludeNames }: { assetExtras: Record<string, string>; markerAttributes: readonly MarkerAttribute[]; excludeNames: ReadonlySet<string> }, _optional = {}
): string {
  const merged = new Map<string, string>();
  for (const [name, value] of Object.entries(assetExtras)) {
    if (excludeNames.has(name)) continue;
    merged.set(name, ` ${name}="${attributeValueHtml({ value, source: "asset" })}"`);
  }
  for (const attr of markerAttributes) {
    if (excludeNames.has(attr.name) || attr.name === "src" || attr.name === "srcset") continue;
    merged.set(attr.name, attr.value === null ? ` ${attr.name}` : ` ${attr.name}="${attributeValueHtml({ value: attr.value, source: "marker" })}"`);
  }
  return [...merged.values()].join("");
}
