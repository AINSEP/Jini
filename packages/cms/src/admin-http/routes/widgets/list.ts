import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { listWidgetInstances, type WidgetInstanceEntry, type WidgetReadServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface WidgetListRouteDeps {
  workspaceId: string;
  entryRepo: WidgetReadServiceDeps["entryRepo"];
  authorize: WidgetReadServiceDeps["authorize"];
}

/** The optional list filters, as the query carries them. */
export interface WidgetListQuery { widgetType?: string; includeInactive: boolean }

export interface WidgetListResponse { widgets: WidgetInstanceEntry[]; skippedCount?: number; skippedIds?: string[] }

/**
 * GET the widget instance library (SPEC-043 REQ-04), `widgets.read`-gated. Defaults to
 * `active`-only (`?includeInactive=true` to also list `trash`/`purged`), narrowable by
 * `?widgetType=`.
 *
 * Response body carries optional `skippedCount` and `skippedIds` fields (dossier C5 follow-up,
 * 2026-08-03) — present only when `listWidgetInstances` dropped malformed records, so a client
 * can identify the records that could not be read without every caller handling new keys.
 */
export const widgetListRoute = defineJsonRoute<WidgetListQuery, WidgetListResponse, WidgetListRouteDeps, WidgetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets",
  parse: (raw) => ok({ value: {
    ...(typeof raw.query.widgetType === "string" ? { widgetType: raw.query.widgetType } : {}),
    includeInactive: raw.query.includeInactive === "true",
  } }),
  handle: async ({ input, deps, context }) => {
    try {
      const { instances, skippedCount, skippedIds } = await listWidgetInstances({
        deps: { entryRepo: deps.entryRepo, authorize: deps.authorize },
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }) }, ...input },
      });
      // Additive, optional wire fields (dossier C5 follow-up) — only present when a malformed
      // record was skipped, so the response shape is unchanged for the common case.
      return ok({ value: { widgets: instances, ...(skippedCount > 0 ? { skippedCount, skippedIds } : {}) } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
