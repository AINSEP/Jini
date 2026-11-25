import type { JsonObject } from "@jini-ai/core/primitives";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  mutateWidgetAreaPlacements,
  type RegionAreaServiceDeps,
  type WidgetAreaEntry,
  type WidgetPlacementNode,
  type WidgetRegionBindingRepoPort,
} from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetAreaResponse } from "../../http/widgets.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `regionDeps` is built per request by the host (its entry locks,
 *  host ports and repositories), exactly as the hand-written route built them. */
export interface WidgetRegionMutatePlacementsRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  widgetBindingRepo: Pick<WidgetRegionBindingRepoPort, "findByRegion">;
  regionDeps: () => RegionAreaServiceDeps;
}

/** This route's validated input: the region from the path plus the normalized whole placement list. */
export interface WidgetRegionMutatePlacementsInput {
  regionKey: string;
  baseVersion: number;
  placements: WidgetPlacementNode[];
}

function isPlacementShape(value: unknown): value is { placementId: string; widgetEntryId: string; enabled: boolean; content?: JsonObject } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.placementId !== "string" || typeof v.widgetEntryId !== "string" || typeof v.enabled !== "boolean") return false;
  return v.content === undefined || (typeof v.content === "object" && v.content !== null && !Array.isArray(v.content));
}

/**
 * Fable adversarial-review fix (2026-07-21, Finding H): the route previously only checked
 * `Array.isArray(body.placements)` — each element's shape was never validated, so client-supplied
 * duplicate `placementId`s and arbitrary extra properties passed straight through into the stored
 * area doc verbatim. Validates every element's shape, rejects duplicate `placementId`s (it is meant
 * to be a stable, unique locator — `entry_refs`' `fieldPath` and reorder/diagnostics all address a
 * placement by it), and returns a NORMALIZED array (the three reference fields and optional content) so nothing
 * extra a client sends ends up persisted. Returns `null` on any violation.
 */
export function parseWidgetRegionPlacements({ raw }: { raw: readonly unknown[] }, _optional: Record<string, never> = {}): WidgetPlacementNode[] | null {
  const placements: WidgetPlacementNode[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!isPlacementShape(item)) return null;
    if (seenIds.has(item.placementId)) return null;
    seenIds.add(item.placementId);
    placements.push({ placementId: item.placementId, widgetEntryId: item.widgetEntryId, enabled: item.enabled, ...(item.content !== undefined ? { content: item.content } : {}) });
  }
  return placements;
}

/** The PUT body's `baseVersion` and normalized placements, refusing each malformed shape with its
 *  own 400 message. @complexity O(n) in the placement count. */
function parseMutatePlacementsBody({ rawBody }: { rawBody: unknown }, _optional: Record<string, never> = {}): { baseVersion: number; placements: WidgetPlacementNode[] } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (typeof body.baseVersion !== "number" || !Array.isArray(body.placements)) {
    rejectRoute({ status: 400, error: "baseVersion and placements[] are required", code: "VALIDATION_ERROR" });
  }
  const placements = parseWidgetRegionPlacements({ raw: body.placements });
  if (!placements) {
    rejectRoute({
      status: 400,
      error: "each placement must be { placementId: string, widgetEntryId: string, enabled: boolean }, with no duplicate placementId",
      code: "VALIDATION_ERROR",
    });
  }
  return { baseVersion: body.baseVersion, placements };
}

/**
 * PUT a region's whole placement list (SPEC-043 REQ-15/16), `widgets.place`-gated. Always a
 * whole-document, version-guarded write (INV-03) — never a per-placement patch endpoint, matching
 * `ui.spec.md` §4.6/§4.7's single `onSave` event over the full `placements` array.
 */
export const widgetRegionMutatePlacementsRoute = defineJsonRoute<WidgetRegionMutatePlacementsInput, { area: WidgetAreaEntry }, WidgetRegionMutatePlacementsRouteDeps, WidgetRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/regions/:regionKey",
  parse: (raw) => ok({ value: { regionKey: String(raw.params.regionKey), ...parseMutatePlacementsBody({ rawBody: raw.body }) } }),
  handle: async ({ input, deps, context }) => {
    try {
      const principalId = widgetActorId({ context });
      const binding = await deps.widgetBindingRepo.findByRegion({ workspaceId: deps.workspaceId, regionKey: input.regionKey });
      if (!binding) rejectRoute({ status: 404, error: `region '${input.regionKey}' is not bound`, code: "WIDGETS_AREA_NOT_FOUND" });

      const { areaEntry } = await mutateWidgetAreaPlacements({
        deps: deps.regionDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId, kind: "user" }, areaEntryId: binding.areaEntryId, baseVersion: input.baseVersion, placements: input.placements },
      });
      return ok({ value: toAdminWidgetAreaResponse(areaEntry) });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
