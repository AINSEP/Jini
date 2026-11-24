import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { bindWidgetArea, type RegionAreaServiceDeps, type WidgetAreaEntry } from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetAreaResponse } from "../../http/widgets.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { authorizeWidgets, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `regionDeps` is built per request by the host (its entry locks,
 *  host ports and repositories), exactly as the hand-written route built them. */
export interface WidgetRegionBindRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  regionDeps: () => RegionAreaServiceDeps;
}

/**
 * POST bind a new region by key (SPEC-043 REQ-11/13), `widgets.place`-gated. `bindWidgetArea`
 * itself is idempotent (an already-bound region key returns its existing area entry, never
 * duplicates) — this is the free-text bind control `ui.spec.md` §3.6/§9 documents, the manual
 * counterpart to REQ-13's (currently unwired, see the implementation-outline addendum) automatic
 * on-theme-activation seeding.
 */
export const widgetRegionBindRoute = defineJsonRoute<{ body: Record<string, unknown> }, { area: WidgetAreaEntry }, WidgetRegionBindRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/regions",
  parse: (raw) => ok({ value: { body: (raw.body ?? {}) as Record<string, unknown> } }),
  handle: async ({ input, deps, authorize }) => {
    const regionKey = input.body.regionKey;
    if (typeof regionKey !== "string" || regionKey.trim() === "") rejectRoute({ status: 400, error: "regionKey is required", code: "VALIDATION_ERROR" });

    try {
      await authorizeWidgets({ authorize, permission: "widgets.place" });
      const { areaEntry } = await bindWidgetArea({
        deps: deps.regionDeps(),
        input: { workspaceId: deps.workspaceId, regionKey: regionKey.trim() },
      });
      return ok({ value: toAdminWidgetAreaResponse(areaEntry) });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
}, { successStatus: 201 });
