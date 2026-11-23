import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { parseWidgetAreaPayload, type WidgetReadServiceDeps, type WidgetRegionBindingRepoPort, type WidgetRegionBindingRow } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { authorizeWidgets, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface WidgetRegionsListRouteDeps {
  workspaceId: string;
  entryRepo: Pick<WidgetReadServiceDeps["entryRepo"], "findById">;
  widgetBindingRepo: Pick<WidgetRegionBindingRepoPort, "listByWorkspace">;
}

export interface WidgetRegionsListResponse { regions: Array<WidgetRegionBindingRow & { placementCount: number }> }

/**
 * GET every currently-bound widget region (SPEC-043 REQ-11/12), `widgets.read`-gated — backs
 * `ui.spec.md`'s `WidgetRegionsScreen`. Only ACTIVELY-bound regions are listed:
 * `widgetBindingRepo.listByWorkspace` only ever holds live bindings (REQ-14's orphaned-on-theme-
 * switch case removes the BINDING row, retaining the underlying `widget_area` entry — see
 * `repo.memory.ts`'s `markInactive`) — a separate "list every widget_area entry including
 * currently-unbound ones" view is not built in this pass, disclosed rather than silently omitted.
 */
export const widgetRegionsListRoute = defineJsonRoute<Record<string, never>, WidgetRegionsListResponse, WidgetRegionsListRouteDeps, WidgetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/regions",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    try {
      await authorizeWidgets({ authorize, permission: "widgets.read" });
      const bindings = await deps.widgetBindingRepo.listByWorkspace({ workspaceId: deps.workspaceId });
      const regions = await Promise.all(
        bindings.map(async (binding) => {
          const areaEntry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: binding.areaEntryId });
          const placementCount = areaEntry ? parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson }).doc.placements.length : 0;
          return { ...binding, placementCount };
        })
      );
      return ok({ value: { regions } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
