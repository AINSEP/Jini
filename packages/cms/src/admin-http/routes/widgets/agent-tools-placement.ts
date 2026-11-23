import {
  insertWidgetEmbed,
  mutateWidgetAreaPlacements,
  parseWidgetAreaPayload,
  removeWidgetEmbed,
  WidgetAreaNotFoundError,
  type EmbedServiceDeps,
  type RegionAreaServiceDeps,
  type WidgetPlacementNode,
  type WidgetRegionBindingRepoPort,
} from "../../../widgets/index.js";
import type { PlaceTarget } from "./agent-tools-targets.js";

/**
 * @file The `widgets.place` / `widgets.create` / `widgets.remove` / `widgets.diagnose` AI tool
 * surface (SPEC-043 REQ-35/44, ADR-047 §5). Thin gateway clients — every call maps 1:1 to the SAME
 * C-005/C-006/C-007 domain functions the human admin routes use, gated by the SAME `widgets.*`
 * permission check (INV-07: an agent's effective permission is always `grant ∩ delegator`,
 * unchanged by this feature). No bespoke AI-agent transport is invented here — REQ-35's "distinct,
 * explicit gateway operations" requirement is about `place` vs `create` being two DISTINCT,
 * unambiguous operations (never one "add widget" call that could mean either), not about a
 * separate wire protocol from the ordinary admin HTTP surface; ADR-047 §5 phrases these as "thin
 * gateway/tool clients, the same shape as ADR-029 §8's `navigation.update`," which is itself an
 * ordinary admin route.
 *
 * Each tool call is ONE atomic operation (unlike the human UI's two-step "create, then place"
 * flow over separate routes) — an agent tool call for "place this widget in the footer" should not
 * require two round-trips.
 *
 * This module holds the placement helpers the tool route specs share.
 */

/** The deps a tool's remove path reads. `widgetsDeps` / `regionDeps` are built per call by the
 *  host (its entry locks, host ports and repositories), exactly as the hand-written routes built them. */
export interface WidgetToolRemovalDeps {
  workspaceId: string;
  widgetBindingRepo: Pick<WidgetRegionBindingRepoPort, "findByRegion">;
  entryRepo: Pick<RegionAreaServiceDeps["entryRepo"], "findById">;
  widgetsDeps: () => EmbedServiceDeps;
  regionDeps: () => RegionAreaServiceDeps;
}

/** The deps a tool's place path reads: the removal deps plus the placement-id minter. */
export interface WidgetToolPlacementDeps extends WidgetToolRemovalDeps {
  idGen: { newId(): string };
}

/** The tool call's actor; `kind` is its provenance for the embed service's post-save attribution. */
export interface WidgetToolActor { principalId: string; kind: string }

/** The `widget_area` entry bound to `regionKey`, refusing an unbound region or a missing area
 *  entry with the same 404 the region routes return. @complexity O(1) repository reads. */
async function loadBoundArea({ deps, regionKey }: { deps: WidgetToolRemovalDeps; regionKey: string }, _optional: Record<string, never> = {}) {
  const binding = await deps.widgetBindingRepo.findByRegion({ workspaceId: deps.workspaceId, regionKey });
  // Round-2 external-audit fix (2026-07-21, agy + Opus 4.8, independently converged): a bare Error
  // isn't recognized by widgetErrorToResponse, so an unbound region 500'd instead of the same 404
  // WIDGETS_AREA_NOT_FOUND region-mutate-placements.ts already returns for this exact condition.
  if (!binding) throw new WidgetAreaNotFoundError({ message: `region '${regionKey}' is not bound` });
  const areaEntry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: binding.areaEntryId });
  if (!areaEntry) throw new WidgetAreaNotFoundError({ message: `region area entry for '${regionKey}' was not found` });
  return { areaEntryId: binding.areaEntryId, placements: parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson }).doc.placements };
}

/** Appends `widgetEntryId` to a region's CURRENT placement list (loaded fresh) and writes the
 * whole list back, per REQ-15's whole-document discipline — never a partial patch. */
async function placeIntoRegion({ deps, actor, target, widgetEntryId }: { deps: WidgetToolPlacementDeps; actor: WidgetToolActor; target: Extract<PlaceTarget, { kind: "region" }>; widgetEntryId: string }, _optional = {}) {
  const { areaEntryId, placements } = await loadBoundArea({ deps, regionKey: target.regionKey });
  const nextPlacements: WidgetPlacementNode[] = [...placements, { placementId: deps.idGen.newId(), widgetEntryId, enabled: true }];
  return mutateWidgetAreaPlacements({
    deps: deps.regionDeps(),
    input: { workspaceId: deps.workspaceId, actor, areaEntryId, baseVersion: target.baseVersion, placements: nextPlacements },
  });
}

/** Places `widgetEntryId` into a region or an embed host, dispatching on the target kind.
 *  @complexity O(placements in the region) for a region, O(1) plus the embed service otherwise. */
export async function placeWidgetToolTarget({ deps, actor, target, widgetEntryId }: { deps: WidgetToolPlacementDeps; actor: WidgetToolActor; target: PlaceTarget; widgetEntryId: string }, _optional = {}) {
  if (target.kind === "region") {
    return placeIntoRegion({ deps, actor, target, widgetEntryId });
  }
  return insertWidgetEmbed({
    deps: deps.widgetsDeps(),
    input: { workspaceId: deps.workspaceId, actor, hostEntryId: target.hostEntryId, baseVersion: target.baseVersion, widgetEntryId },
  });
}

/** Removes a region-bound placement by loading the CURRENT placement list and writing it back
 *  without `placementId`, matching `placeIntoRegion`'s whole-document discipline (REQ-15).
 *  @complexity O(placements in the region). */
async function removeRegionPlacement({ deps, actor, target, placementId }: { deps: WidgetToolRemovalDeps; actor: WidgetToolActor; target: Extract<PlaceTarget, { kind: "region" }>; placementId: string }, _optional = {}) {
  const { areaEntryId, placements } = await loadBoundArea({ deps, regionKey: target.regionKey });
  return mutateWidgetAreaPlacements({
    deps: deps.regionDeps(),
    input: { workspaceId: deps.workspaceId, actor, areaEntryId, baseVersion: target.baseVersion, placements: placements.filter((p) => p.placementId !== placementId) },
  });
}

/** Dispatches to the embed or region removal path — mirrors `placeWidgetToolTarget`'s own dispatch
 *  shape; the embed path is a thin pass-through to `removeWidgetEmbed`.
 *  @complexity O(1) plus whichever branch's own cost. */
export async function removeWidgetToolPlacement({ deps, actor, target, placementId }: { deps: WidgetToolRemovalDeps; actor: WidgetToolActor; target: PlaceTarget; placementId: string }, _optional = {}) {
  if (target.kind === "embed") {
    return removeWidgetEmbed({
      deps: deps.widgetsDeps(),
      input: { workspaceId: deps.workspaceId, actor, hostEntryId: target.hostEntryId, baseVersion: target.baseVersion, placementId },
    });
  }
  return removeRegionPlacement({ deps, actor, target, placementId });
}
