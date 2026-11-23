import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { rejectWidgetError } from "../../http/widgets.js";
import { removeWidgetToolPlacement, type WidgetToolRemovalDeps } from "./agent-tools-placement.js";
import { readWidgetToolTarget, rejectBadWidgetToolTarget, type PlaceTarget } from "./agent-tools-targets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads (see {@link WidgetToolRemovalDeps}). */
export type WidgetRemoveToolRouteDeps = WidgetToolRemovalDeps;

/** This route's validated POST body. */
export interface WidgetRemoveToolInput { target: PlaceTarget; placementId: string }

export interface WidgetRemoveToolResponse { tool: "widgets.remove"; result: Awaited<ReturnType<typeof removeWidgetToolPlacement>> }

/** `widgets.remove` — remove a PLACEMENT (region entry or embed node), never the widget instance
 * itself (that's `widgets.delete`/`.delete.force` via the ordinary CRUD routes). */
export const widgetRemoveToolRoute = defineJsonRoute<WidgetRemoveToolInput, WidgetRemoveToolResponse, WidgetRemoveToolRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/tools/remove",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    const target = readWidgetToolTarget({ body });
    if (!target || typeof body.placementId !== "string") return rejectBadWidgetToolTarget();
    return ok({ value: { target, placementId: body.placementId } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const actor = { principalId: widgetActorId({ context }), kind: "user" };
      const result = await removeWidgetToolPlacement({ deps, actor, target: input.target, placementId: input.placementId });
      return ok({ value: { tool: "widgets.remove", result } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
