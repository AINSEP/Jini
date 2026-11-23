import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { reorderWidgetEmbeds, type EmbedServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host, exactly as the
 *  hand-written route built them. */
export interface WidgetEmbedReorderRouteDeps {
  workspaceId: string;
  widgetsDeps: () => EmbedServiceDeps;
}

/** This route's validated input: the host entry from the path plus the PUT body's two fields. */
export interface WidgetEmbedReorderInput {
  hostEntryId: string;
  baseVersion: number;
  orderedWidgetEntryIds: string[];
}

/** Whether `value` is an array of non-empty strings. @complexity O(n). */
function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === "string" && id.length > 0);
}

/** PUT a new widget-per-slot order for every EXISTING `widgetEmbed` node in a host entry's body
 * (SPEC-043 REQ-44/45), `widgets.place`-gated. */
export const widgetEmbedReorderRoute = defineJsonRoute<WidgetEmbedReorderInput, Awaited<ReturnType<typeof reorderWidgetEmbeds>>, WidgetEmbedReorderRouteDeps, WidgetRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    // Round-2 external-audit fix (2026-07-21, codex): reject a malformed element shape (400) before
    // it ever reaches the domain layer's existence/liveness check (404) — mirrors
    // region-mutate-placements.ts's own shape-then-existence split.
    if (typeof body.baseVersion !== "number" || !isNonEmptyStringArray(body.orderedWidgetEntryIds)) {
      rejectRoute({ status: 400, error: "baseVersion and non-empty string orderedWidgetEntryIds[] are required", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { hostEntryId: String(raw.params.hostEntryId), baseVersion: body.baseVersion, orderedWidgetEntryIds: body.orderedWidgetEntryIds } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const { entry } = await reorderWidgetEmbeds({
        deps: deps.widgetsDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }), kind: "user" }, ...input },
      });
      return ok({ value: { entry } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
