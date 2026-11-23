import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { getWidgetInstance, toWhereUsedResponse, type EntryRefsRepoPort, type WhereUsedResponse, type WidgetInstanceEntry, type WidgetReadServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface WidgetGetRouteDeps {
  workspaceId: string;
  entryRepo: WidgetReadServiceDeps["entryRepo"];
  authorize: WidgetReadServiceDeps["authorize"];
  entryRefsRepo: Pick<EntryRefsRepoPort, "findByTarget">;
}

export interface WidgetGetResponse { widget: WidgetInstanceEntry; revisions: []; whereUsed: WhereUsedResponse }

/**
 * GET one widget instance (SPEC-043 REQ-04), plus its REQ-34 where-used disclosure — the exact
 * data `ui.spec.md`'s `WhereUsedBanner` needs, folded into the same response so the editor screen
 * needs one round-trip, not two.
 */
export const widgetGetRoute = defineJsonRoute<{ id: string }, WidgetGetResponse, WidgetGetRouteDeps, WidgetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id) } }),
  handle: async ({ input, deps, context }) => {
    try {
      const { instance, revisions } = await getWidgetInstance({
        deps: { entryRepo: deps.entryRepo, authorize: deps.authorize },
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }) }, widgetInstanceId: input.id },
      });
      const refs = await deps.entryRefsRepo.findByTarget({ workspaceId: deps.workspaceId, targetKind: "entry", targetId: instance.id });
      return ok({ value: { widget: instance, revisions, whereUsed: toWhereUsedResponse({ refs }, {}) } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
