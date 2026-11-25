import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { rejectWidgetError } from "../../http/widgets.js";
import { placeWidgetToolTarget, type WidgetToolPlacementDeps } from "./agent-tools-placement.js";
import { readWidgetToolTarget, rejectBadWidgetToolTarget, type PlaceTarget } from "./agent-tools-targets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads (see {@link WidgetToolPlacementDeps}). */
export type WidgetPlaceToolRouteDeps = WidgetToolPlacementDeps;

/** This route's validated POST body. */
export interface WidgetPlaceToolInput { target: PlaceTarget; widgetInstanceId: string }

export interface WidgetPlaceToolResponse { tool: "widgets.place"; result: Awaited<ReturnType<typeof placeWidgetToolTarget>> }

/** `widgets.place` — reference an EXISTING widget instance into a target. Distinct from
 * `widgets.create` (REQ-35, AC-25): this call never creates a new instance. */
export const widgetPlaceToolRoute = defineJsonRoute<WidgetPlaceToolInput, WidgetPlaceToolResponse, WidgetPlaceToolRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/tools/place",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    const target = readWidgetToolTarget({ body });
    if (!target || typeof body.widgetInstanceId !== "string") return rejectBadWidgetToolTarget();
    return ok({ value: { target, widgetInstanceId: body.widgetInstanceId } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const actor = { principalId: widgetActorId({ context }), kind: "user" as const };
      const result = await placeWidgetToolTarget({ deps, actor, target: input.target, widgetEntryId: input.widgetInstanceId });
      return ok({ value: { tool: "widgets.place", result } });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
