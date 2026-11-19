import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";
import { resolveEmbedHtmlAttributes, formatHtmlAttributes, omitKey } from "./media-attributes.js";
import { isNonArrayRecord } from "@jini-ai/core/records";
import { escapeHtml } from "@jini-ai/core/text";
import { plausibleMediaRefId } from "./markers/media-reference.js";


/** The `data-embed-config` element that stands for a managed doc node in Page HTML. `alt` is carried
 *  as a marker attribute because the media resolver reads it there. @complexity O(n) in the node's attrs. */
function docNodeEmbedMarker(required: { config: JsonObject; attrs: JsonObject; alt?: string }): string {
  const parsed = resolveEmbedHtmlAttributes({ raw: (typeof required.attrs.htmlAttributes === "string" ? required.attrs.htmlAttributes : "") || null });
  const classes = [(typeof required.attrs.cssClass === "string" ? required.attrs.cssClass : ""), parsed.class].filter(Boolean).join(" ");
  const classAttr = classes ? ` class="${escapeHtml({ text: classes })}"` : "";
  const altAttr = required.alt ? ` alt="${escapeHtml({ text: required.alt })}"` : "";
  // A single-quoted marker reads its JSON raw, so an apostrophe needs the JSON escape, not an entity.
  const json = JSON.stringify(required.config).replace(/'/g, "\\u0027");
  return `<div${classAttr}${altAttr}${formatHtmlAttributes({ attributes: omitKey({ attributes: parsed, key: "class" }) })} data-embed-config='${json}'></div>`;
}

/** A widget or managed-media node's Page HTML marker; `undefined` for every other node, which the
 *  ordinary renderer handles. A malformed reference stays with that renderer's placeholder. @complexity O(1). */
function managedDocNodeMarker(node: JsonObject): string | undefined {
  const attrs = isNonArrayRecord({ value: node.attrs }) ? node.attrs as JsonObject : {};
  if (node.type === "widgetEmbed" && (typeof attrs.widgetEntryId === "string" ? attrs.widgetEntryId : "")) {
    const config: JsonObject = { type: "widget", id: (typeof attrs.widgetEntryId === "string" ? attrs.widgetEntryId : "") };
    if (attrs.content !== undefined) config.content = attrs.content;
    return docNodeEmbedMarker({ config, attrs });
  }
  const assetId = node.type === "media" || node.type === "image" ? plausibleMediaRefId({ value: attrs.assetId }) : undefined;
  return assetId ? docNodeEmbedMarker({ config: { type: "media", id: assetId }, attrs, alt: (typeof attrs.alt === "string" ? attrs.alt : "") }) : undefined;
}

/** Copies `node` with each managed node replaced by a text token, recording its marker by index.
 *  Past the maximum depth nodes are left for the renderer's own depth limit. @complexity O(n) in nodes. */
function swapManagedDocNodes(required: { node: JsonValue; token: string; markers: string[]; depth: number; maxDepth: number }): JsonValue {
  const { node, token, markers, depth, maxDepth } = required;
  if (!isNonArrayRecord({ value: node }) || depth > maxDepth) return node;
  const object = node as JsonObject;
  const marker = managedDocNodeMarker(object);
  if (marker !== undefined) return { type: "text", text: `${token}${markers.push(marker) - 1}X` };
  if (!Array.isArray(object.content)) return node;
  return { ...object, content: object.content.map(child => swapManagedDocNodes({ node: child, token, markers, depth: depth + 1, maxDepth })) };
}

export function renderDocWithManagedMarkers({ bodyJson, token, maxDepth, renderDocNode }: { bodyJson: unknown; token: string; maxDepth: number; renderDocNode: (required: { node: JsonValue }) => string }, _optional: Record<string, never> = {}): string {
  const markers: string[] = [];
  const html = renderDocNode({ node: swapManagedDocNodes({ node: bodyJson as JsonValue, token, markers, depth: 0, maxDepth }) });
  return html.replace(new RegExp(`${token}(\\d+)X`, "g"), (_match, index: string) => markers[Number(index)] ?? "");
}
