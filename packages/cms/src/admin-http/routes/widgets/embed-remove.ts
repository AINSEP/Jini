import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { removeWidgetEmbed, type EmbedServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host, exactly as the
 *  hand-written route built them. */
export interface WidgetEmbedRemoveRouteDeps {
  workspaceId: string;
  widgetsDeps: () => EmbedServiceDeps;
}

/** This route's validated input: host entry and placement from the path, `baseVersion` from the body. */
export interface WidgetEmbedRemoveInput {
  hostEntryId: string;
  baseVersion: number;
  placementId: string;
}

/** DELETE a `widgetEmbed` placement from a host entry's body (SPEC-043 REQ-44/45), `widgets.place`-gated. */
export const widgetEmbedRemoveRoute = defineJsonRoute<WidgetEmbedRemoveInput, Awaited<ReturnType<typeof removeWidgetEmbed>>, WidgetEmbedRemoveRouteDeps, WidgetRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds/:placementId",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    if (typeof body.baseVersion !== "number") rejectRoute({ status: 400, error: "baseVersion is required", code: "VALIDATION_ERROR" });
    return ok({ value: { hostEntryId: String(raw.params.hostEntryId), baseVersion: body.baseVersion, placementId: String(raw.params.placementId) } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const { entry } = await removeWidgetEmbed({
        deps: deps.widgetsDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }), kind: "user" }, ...input },
      });
      return ok({ value: { entry } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
