import { isNonArrayRecord } from "@jini-ai/core";
import type { JsonObject, UUID } from "@jini-ai/core/primitives";

export interface InlineEmbedRef {
  placementId: UUID;
  widgetEntryId: UUID;
  content?: JsonObject;
}

/** Pre-order visit of every non-array record node in a TipTap-shaped tree, kept off the call stack. */
function forEachDocNode(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) visitDocNode(stack, stack.pop(), visit);
}

/** One step of {@link forEachDocNode}: arrays push their items in reverse (pre-order), records are visited then their `content` pushed. */
function visitDocNode(stack: unknown[], node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    return;
  }
  const candidate = { value: node };
  if (!isNonArrayRecord(candidate)) return;
  visit(candidate.value);
  if (Array.isArray(candidate.value.content)) stack.push(candidate.value.content);
}

/** The inline ref a `widgetEmbed` node carries, or `undefined` for any other node or malformed attrs. */
function inlineEmbedRef(node: Record<string, unknown>): InlineEmbedRef | undefined {
  const attrs = { value: node.type === "widgetEmbed" ? node.attrs : undefined };
  if (!isNonArrayRecord(attrs) || typeof attrs.value.widgetEntryId !== "string" || typeof attrs.value.placementId !== "string") return undefined;
  return { placementId: attrs.value.placementId, widgetEntryId: attrs.value.widgetEntryId, ...(isNonArrayRecord({ value: attrs.value.content }) ? { content: attrs.value.content as JsonObject } : {}) };
}

/** Walks a TipTap-shaped bodyJson tree collecting every `widgetEmbed` node (REQ-21) — same shape `core/entry-refs/extractor.ts` walks, kept separate since this module has no dependency on `core/entry-refs`. */
export function collectWidgetEmbeds(root: unknown, out: InlineEmbedRef[]): void {
  // An explicit stack, not recursion: a stored document's nesting depth is attacker/import-controlled
  // and a 5000-deep list overflowed the call stack here (GET /:slug -> 500) before `render.ts`'s own
  // MAX_RENDER_DEPTH placeholder could ever apply. Children are pushed in reverse so the walk stays
  // pre-order, the same visit order the recursive version had.
  forEachDocNode(root, (node) => {
    const embed = inlineEmbedRef(node);
    if (embed) out.push(embed);
  });
}

/** Scans a TipTap-shaped `bodyJson` tree for every ref-based `image`/`media` node's `assetId`
 *  (`{assetId, transformName}` shape) — both the legacy image-only ref shape and the
 *  generic `media` node (2026-09-11, `render.ts`'s `renderDocMedia`'s own doc) share this collection,
 *  since both key their sizing/content-type override off the SAME `mediaAssetMetadata` map by
 *  `assetId` alone. Widened 2026-09-11 (owner-reported, verifying the admin Preview-tab fix: a
 *  `media` node embedded in a post's body rendered as a placeholder through this exact
 *  "post-content" IR path, even with the asset/transform fine, because this collector only ever
 *  recognized `"image"`) to match `routes/site/pages.ts`'s own `collectMediaRefAssetIds`, which was
 *  widened the same day — renamed from `isRefBasedImageNode`/`collectImageAssetIds` accordingly. Same
 *  walk shape as that module's copy, still duplicated rather than imported: that module sits above
 *  this one in the codebase's layering (this file's `resolveMediaTypeEmbeds`'s own doc discloses the
 *  same constraint for `render.ts`). A legacy `image` node (only `attrs.src`, no `assetId`) is never
 *  added — nothing here needs a sizing/version override for that shape. */
/** A TipTap `image` or `media` node carrying the `{assetId, transformName}` ref shape (vs. a legacy
 *  `image` node's `attrs.src`-only shape, which `media` has no equivalent of at all — see this file's
 *  header on `Media`/`renderDocMedia` for why). */
function isRefBasedMediaNode(obj: Record<string, unknown>): obj is Record<string, unknown> & { attrs: Record<string, unknown> } {
  return (obj.type === "image" || obj.type === "media") && typeof obj.attrs === "object" && obj.attrs !== null;
}

export function collectMediaRefAssetIds(root: unknown, out: Set<string>): void {
  // Iterative for the same reason as {@link collectWidgetEmbeds} (a 5000-deep post overflowed here).
  forEachDocNode(root, (node) => {
    if (isRefBasedMediaNode(node) && typeof node.attrs.assetId === "string") out.add(node.attrs.assetId);
  });
}
