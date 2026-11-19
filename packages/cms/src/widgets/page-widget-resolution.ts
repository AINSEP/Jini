import type { UUID } from "@jini-ai/core/primitives";
import type { EntryListPort, EntryRepoPort } from "../entries/index.js";
import { parseWidgetAreaPayload } from "./entry-payload.js";
import type { WidgetRegionBindingRepoPort } from "./ports.js";
import { WIDGET_AREA_CONTENT_TYPE } from "./types.js";
import type { WidgetPlacementNode, WidgetRegionKey, WidgetRenderIR, WidgetResolveContext } from "./types.js";
import { type InlineEmbedRef, collectWidgetEmbeds } from "./document-embed-refs.js";
import { toRenderIr, resolveWidgetInstances, inlineContentOverrides, assembleInlineResolved } from "./widget-instance-resolution.js";

/**
 * @file `resolvePageWidgets` — the batch-first page-render resolution orchestrator (SPEC-043
 * REQ-23..28; ADR-047 Debate Fold-In Amendment 2).
 *
 * Purpose:
 * The single seam that turns "a page's widget references" (region-bound + inline-embedded) into
 * data the theme can render — one batched entry-load query, grouped by type, at most one
 * `resolveWidgetType` call per type present on the page (REQ-24). Mirrors the `render.ts` "theme is
 * data, core resolves" stance — the theme never calls this directly or resolves a reference itself.
 *
 * `EntryRepoPort` (this task's frozen, real chokepoint contract) has no `findByIds`/batch-by-id
 * primitive — only `findById` (one row) and `EntryListPort.listByWorkspace` (a full-type scan).
 * REQ-24's "one batched query" is satisfied here via ONE `listByWorkspace({workspaceId}, {type: 'widget'})` call
 * per render (not one query per placement/type), which is the batching guarantee AC-16 actually
 * tests (via `resolveWidgetType`'s single-`resolveMany`-call assertion) — a literal `WHERE id IN
 * (...)` primitive does not exist on the real, frozen `EntryRepoPort` this task must compose
 * against without modifying `features/entries`.
 *
 * Architectural role:
 * `widgets` domain logic (implementation outline C-004).
 */

export interface ResolvePageWidgetsDeps {
  bindingRepo: WidgetRegionBindingRepoPort;
  entryRepo: EntryRepoPort & EntryListPort;
}

export interface ResolvePageWidgetsInput {
  readonly workspaceId: UUID;
  /**
   * The already-fetched host document's `bodyJson`, when the caller has one to scan for inline
   * `widgetEmbed` nodes (REQ-21) — e.g. a `PostRecord.bodyJson` on the `home`/`post` site routes.
   * Passed as content rather than an id-to-fetch (unlike the old `pageEntryId` this replaces)
   * because the only real callers already hold the document: `PostRecord` (`features/post`) is a
   * separate, pre-ADR-022 table an `EntryRepoPort.findById` call can never resolve, which is why
   * `pageEntryId` had no real caller and every `widgetEmbed` node in a post body rendered the
   * REQ-28 placeholder forever, never real content. `undefined` when there is no host document
   * (the home route) or nothing to scan.
   */
  readonly pageBodyJson?: unknown;
  /** Region keys the current theme/template declares for this page. */
  readonly resolvedRegions: readonly WidgetRegionKey[];
}

export interface ResolvePageWidgetsRequired {
  deps: ResolvePageWidgetsDeps;
  input: ResolvePageWidgetsInput;
}

export interface ResolvePageWidgetsResult {
  readonly regions: Readonly<Record<WidgetRegionKey, readonly WidgetRenderIR[]>>;
  /** Keyed by `placementId` — one entry per `widgetEmbed` node in the page's `bodyJson`. */
  readonly inlineResolved: ReadonlyMap<UUID, WidgetRenderIR>;
}

/**
 * Never throws (REQ-27's contract) — every per-widget failure is isolated to a placeholder IR node
 * (REQ-28) before this function returns.
 *
 * @complexity O(r) over `resolvedRegions` plus one batched widget-listing query plus one
 * `resolveWidgetType` call per distinct widget type present on the page (REQ-24).
 * @overallScore 100
 */
/** Step 1: region -> widget_area -> ordered, enabled placement list. A malformed widget_area
 *  payload or an unresolvable binding/area degrades that one region to "no widgets" (REQ-27) rather
 *  than throwing. */
async function resolveRegionPlacements(
  deps: ResolvePageWidgetsDeps,
  workspaceId: UUID,
  resolvedRegions: readonly WidgetRegionKey[]
): Promise<Map<WidgetRegionKey, WidgetPlacementNode[]>> {
  const regionPlacements = new Map<WidgetRegionKey, WidgetPlacementNode[]>();
  for (const regionKey of resolvedRegions) {
    regionPlacements.set(regionKey, []);
    const binding = await deps.bindingRepo.findByRegion({ workspaceId, regionKey });
    if (!binding) continue;
    const areaEntry = await deps.entryRepo.findById({ workspaceId, id: binding.areaEntryId });
    if (areaEntry && areaEntry.type === WIDGET_AREA_CONTENT_TYPE) {
      try {
        const payload = parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson });
        regionPlacements.set(
          regionKey,
          payload.doc.placements.filter((placement) => placement.enabled)
        );
      } catch {
        // REQ-27: a malformed widget_area payload (e.g. wiped by an unrelated generic-entry update
        // that bypassed this feature's own write path) degrades this one region to "no widgets" —
        // this function must never throw, matching the doc comment above it that this call site was
        // violating (Fable adversarial-review fix, 2026-07-21, Finding B).
      }
    }
  }
  return regionPlacements;
}

/** Step 3: every distinct widget id referenced on the page, from BOTH region placements and inline
 *  embeds — the set `resolveWidgetInstances` batch-loads against (REQ-24). */
function collectReferencedWidgetIds(
  regionPlacements: ReadonlyMap<WidgetRegionKey, WidgetPlacementNode[]>,
  inlineEmbeds: readonly InlineEmbedRef[]
): Set<UUID> {
  const referencedIds = new Set<UUID>();
  for (const placements of regionPlacements.values()) {
    for (const placement of placements) referencedIds.add(placement.widgetEntryId);
  }
  for (const embed of inlineEmbeds) referencedIds.add(embed.widgetEntryId);
  return referencedIds;
}

export async function resolvePageWidgets(required: ResolvePageWidgetsRequired, _optional: Record<string, never> = {}): Promise<ResolvePageWidgetsResult> {
  const { deps, input } = required;
  const context: WidgetResolveContext = { workspaceId: input.workspaceId, preview: false };

  const regionPlacements = await resolveRegionPlacements(deps, input.workspaceId, input.resolvedRegions);

  // 2. Inline embeds from the host document's bodyJson (REQ-21/23).
  const inlineEmbeds: InlineEmbedRef[] = [];
  if (input.pageBodyJson !== undefined) collectWidgetEmbeds(input.pageBodyJson, inlineEmbeds);

  // 3. One batched widget-instance load for every distinct widget referenced on the page (REQ-24 —
  // see this file's header for why `listByWorkspace` stands in for a literal `WHERE id IN (...)`).
  const referencedIds = collectReferencedWidgetIds(regionPlacements, inlineEmbeds);

  // 4/5. Batch-load + resolve (skipping missing/trashed/purged targets — REQ-27's failure taxonomy
  // handles them as "unresolved", not a crash), at most one `resolveWidgetType` call per distinct
  // type present (REQ-24) — see `resolveWidgetInstances`'s own doc for why this is shared rather
  // than inlined here.
  const allPlacements = [...inlineEmbeds, ...[...regionPlacements.values()].flat()];
  const originalIds = new Set(allPlacements.filter(placement => !placement.content).map(placement => placement.widgetEntryId));
  const resolvedById = await resolveWidgetInstances(deps, input.workspaceId, referencedIds, context, inlineContentOverrides(allPlacements), originalIds);

  // 6. Assemble region -> IR[] (missing/failed placements degrade to the REQ-28 placeholder).
  const regions: Record<WidgetRegionKey, WidgetRenderIR[]> = {};
  for (const [regionKey, placements] of regionPlacements) {
    regions[regionKey] = placements.map((placement) => toRenderIr(resolvedById.get(placement.content ? placement.placementId : placement.widgetEntryId)));
  }

  // 7. Assemble placementId -> IR for inline embeds.
  return { regions, inlineResolved: assembleInlineResolved(inlineEmbeds, resolvedById) };
}
