import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { trashWidgetInstance, type TrashWidgetInstanceRequired } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host, exactly as the
 *  hand-written route built them. */
export interface WidgetTrashRouteDeps {
  workspaceId: string;
  widgetsDeps: () => TrashWidgetInstanceRequired["deps"];
}

export interface WidgetTrashResponse { trashed: true; id: string; version: number | null }

/** POST move a widget instance to the Trash — `widgets.delete`-gated, never blocked by references
 * (EC-07). Kept for existing callers; the admin's Delete goes through `POST .../trash/items`. A
 * permanent delete is the Trash's purge (there is no widget purge route any more). */
export const widgetTrashRoute = defineJsonRoute<{ id: string }, WidgetTrashResponse, WidgetTrashRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/:id/trash",
  parse: (raw) => ok({ value: { id: String(raw.params.id) } }),
  handle: async ({ input, deps, context }) => {
    try {
      const { widgetInstanceId, version } = await trashWidgetInstance({
        deps: deps.widgetsDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }) }, widgetInstanceId: input.id },
      });
      return ok({ value: { trashed: true, id: widgetInstanceId, version } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
