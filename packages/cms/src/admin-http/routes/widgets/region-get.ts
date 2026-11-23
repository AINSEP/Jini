import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  parseWidgetAreaPayload,
  parseWidgetInstancePayload,
  toWidgetAreaEntry,
  WIDGET_AREA_CONTENT_TYPE,
  WIDGET_CONTENT_TYPE,
  type WidgetAreaEntry,
  type WidgetReadServiceDeps,
  type WidgetRegionBindingRepoPort,
} from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetAreaResponse } from "../../http/widgets.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { authorizeWidgets, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface WidgetRegionGetRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  entryRepo: Pick<WidgetReadServiceDeps["entryRepo"], "findById">;
  widgetBindingRepo: Pick<WidgetRegionBindingRepoPort, "findByRegion">;
}

/** One placement with its widget's title/type resolved, and whether it no longer resolves. */
export type WidgetRegionPlacement = WidgetAreaEntry["doc"]["placements"][number] & { widgetTitle: string | null; widgetType: string | null; broken: boolean };

export interface WidgetRegionGetResponse { area: WidgetAreaEntry; placements: WidgetRegionPlacement[] }

/**
 * GET one region's area entry, with each placement's `widgetTitle`/`widgetType` resolved —
 * `ui.spec.md` §3.7's `RegionPlacementEditorScreen` loaded state ("an operator must be able to
 * identify what's placed without a second lookup", §5).
 */
export const widgetRegionGetRoute = defineJsonRoute<{ regionKey: string }, WidgetRegionGetResponse, WidgetRegionGetRouteDeps, WidgetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/regions/:regionKey",
  parse: (raw) => ok({ value: { regionKey: String(raw.params.regionKey) } }),
  handle: async ({ input, deps, authorize }) => {
    try {
      await authorizeWidgets({ authorize, permission: "widgets.read" });

      const binding = await deps.widgetBindingRepo.findByRegion({ workspaceId: deps.workspaceId, regionKey: input.regionKey });
      if (!binding) rejectRoute({ status: 404, error: `region '${input.regionKey}' is not bound`, code: "WIDGETS_AREA_NOT_FOUND" });
      const areaEntry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: binding.areaEntryId });
      if (!areaEntry || areaEntry.type !== WIDGET_AREA_CONTENT_TYPE) rejectRoute({ status: 404, error: `region area entry was not found`, code: "WIDGETS_AREA_NOT_FOUND" });

      const area = toWidgetAreaEntry({ entry: areaEntry });
      const doc = parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson }).doc;
      const placements = await Promise.all(
        doc.placements.map(async (placement) => {
          const widget = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: placement.widgetEntryId });
          const payload = widget && widget.type === WIDGET_CONTENT_TYPE ? parseWidgetInstancePayload({ fieldsJson: widget.fieldsJson }) : null;
          return {
            ...placement,
            widgetTitle: widget?.title ?? null,
            widgetType: payload?.widgetType ?? null,
            broken: !widget || !payload || payload.status !== "active",
          };
        })
      );

      return ok({ value: { ...toAdminWidgetAreaResponse(area), placements } });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
