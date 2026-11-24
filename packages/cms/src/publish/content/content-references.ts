import { embedMarkerTarget, scanEmbedMarkers } from "../../widgets/markers/index.js";
import { extractEntryRefs } from "../../widgets/index.js";

import { collectMediaConfigKeys, collectReferencedMediaKeys } from "./media-references.js";
import type { PublishContentReference } from "./type-registry.js";

/**
 * @file What a packed body-bearing state (post, page, collection entry) uses, for plan G3's scoped
 * carry-along (`export-bundle.ts`'s `includeReferencedEntities`). Reads the existing parsers only:
 * - media: `media-references.ts` (`bodyJson` image/media nodes and URLs, `bodyHtml` media markers and
 *   `/m/` URLs, `seoExtJson` images);
 * - widgets: `widgetEmbed` nodes through `entry-refs/extractor.ts`'s `extractEntryRefs` (the walk that
 *   indexes `entry_refs`), and `bodyHtml` widget markers by `id ?? slug` through
 *   `Jini packages/cms/src/widgets/markers/marker.ts`'s `embedMarkerTarget` (the render resolver's own precedence);
 * - terms: the packed `termIds` (posts, pages and entries carry their categories/tags there).
 *
 * Not followed: `post`/`content`/`collection`/`menu` markers and menu links. They show OTHER content
 * rather than being part of this one, so publishing a page never silently publishes another page.
 */

/** Adds `{entityType, key}` once. @complexity O(1). */
function add({ out, entityType, key }: { out: Map<string, PublishContentReference>; entityType: string; key: string }, _optional = {}): void {
  if (key.length > 0) out.set(`${entityType}:${key}`, { entityType, key });
}

/**
 * Every media, widget and term one packed post/page/entry state references. Pure; an unreadable
 * field contributes nothing, since a reference only ever ADDS to a run.
 *
 * @complexity O(n) in the total size of `bodyJson`, `bodyHtml` and `seoExtJson`.
 */
export function collectBodyReferences({ state }: { state: Readonly<Record<string, unknown>> }, _optional = {}): readonly PublishContentReference[] {
  const out = new Map<string, PublishContentReference>();
  for (const key of collectReferencedMediaKeys({ state })) add({ out, entityType: "media", key });

  // Ids are only echoed onto the rows; nothing here reads them.
  const rows = extractEntryRefs({ workspaceId: "", sourceEntryId: "", sourceEntryType: "", bodyJson: state.bodyJson, fieldsExt: {} });
  for (const row of rows) if (row.sourceKind === "widget-embed") add({ out, entityType: "widget", key: row.targetId });

  addHtmlWidgetReferences({ html: state.bodyHtml, out });
  addTermReferences({ termIds: state.termIds, out });
  return [...out.values()];
}

/**
 * The widgets a packed `widget-area` state places, through the same `extractEntryRefs` placement walk.
 *
 * @complexity O(p) in the placement count.
 */
export function collectPlacementReferences({ state }: { state: Readonly<Record<string, unknown>> }, _optional = {}): readonly PublishContentReference[] {
  const rows = extractEntryRefs({ workspaceId: "", sourceEntryId: "", sourceEntryType: "", bodyJson: { placements: state.placements }, fieldsExt: {} });
  const out = new Map<string, PublishContentReference>();
  for (const row of rows) if (row.sourceKind === "widget-area-placement") add({ out, entityType: "widget", key: row.targetId });
  addPlacementMediaReferences({ placements: state.placements, out });
  return [...out.values()];
}

function addHtmlWidgetReferences({ html, out }: { html: unknown; out: Map<string, PublishContentReference> }, _optional: Record<string, never> = {}): void {
  if (typeof html !== "string") return;
  for (const marker of scanEmbedMarkers({ html }).markers) {
    if (marker.type.toLowerCase() !== "widget") continue;
    const target = embedMarkerTarget({ type: marker.type, config: marker.config });
    if (target !== undefined && target.key !== "none") add({ out, entityType: "widget", key: target.value });
  }
}

function addTermReferences({ termIds, out }: { termIds: unknown; out: Map<string, PublishContentReference> }, _optional: Record<string, never> = {}): void {
  if (!Array.isArray(termIds)) return;
  for (const id of termIds) if (typeof id === "string") add({ out, entityType: "term", key: id });
}

function addPlacementMediaReferences({ placements, out }: { placements: unknown; out: Map<string, PublishContentReference> }, _optional: Record<string, never> = {}): void {
  if (!Array.isArray(placements)) return;
  for (const placement of placements) {
    if (typeof placement !== "object" || placement === null) continue;
    for (const key of collectMediaConfigKeys({ config: (placement as Record<string, unknown>).content })) add({ out, entityType: "media", key });
  }
}
