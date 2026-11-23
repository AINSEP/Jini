import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

import {
  parseWidgetInstancePayload,
  toWhereUsedResponse,
  WIDGET_CONTENT_TYPE,
  type EntryRefsRepoPort,
  type RegionAreaServiceDeps,
  type WhereUsedResponse,
} from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import { authorizeWidgets, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface WidgetDiagnoseToolRouteDeps {
  workspaceId: string;
  entryRepo: Pick<RegionAreaServiceDeps["entryRepo"], "findById">;
  entryRefsRepo: Pick<EntryRefsRepoPort, "findByTarget">;
}

export interface WidgetDiagnoseToolResponse { tool: "widgets.diagnose"; exists: boolean; status: string | null; whereUsed: WhereUsedResponse }

/** Resolves `widgets.diagnose`'s exists/status pair for an already-fetched entry — a bare
 *  `Awaited<ReturnType<...findById>>` type keeps this tied to the repo port's own return shape
 *  rather than a hand-rolled interface. @complexity O(1). */
function resolveWidgetStatus(entry: Awaited<ReturnType<WidgetDiagnoseToolRouteDeps["entryRepo"]["findById"]>>): {
  exists: boolean;
  status: string | null;
} {
  const isWidget = Boolean(entry) && entry?.type === WIDGET_CONTENT_TYPE;
  if (!isWidget || !entry) return { exists: isWidget, status: null };
  // Fable adversarial-review fix (2026-07-21, Finding B): diagnosing a real entry id that is NOT a
  // widget instance (wrong content type, or a widget row with a malformed payload) used to 500 via
  // an uncaught `parseWidgetInstancePayload` throw — `getWidgetInstance` already guards the same
  // case with an `entry.type` check; this mirrors it instead of parsing blind.
  return orFallbackSync<{ exists: boolean; status: string | null }>({ work: () => {
    return { exists: true, status: parseWidgetInstancePayload({ fieldsJson: entry.fieldsJson }).status };
  }, fallback: { exists: true, status: null }, step: "Read saved widget status" });
}

/** `widgets.diagnose` — read-only: where-used + broken-reference state for one instance, sourced
 * entirely from the already-queryable `entry_refs` index (ADR-047 §5: "a broken widget reference
 * is already a queryable, first-class state, not new detection logic to build"). */
export const widgetDiagnoseToolRoute = defineJsonRoute<{ widgetInstanceId: string }, WidgetDiagnoseToolResponse, WidgetDiagnoseToolRouteDeps, WidgetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/tools/diagnose/:widgetInstanceId",
  parse: (raw) => ok({ value: { widgetInstanceId: String(raw.params.widgetInstanceId) } }),
  handle: async ({ input, deps, authorize }) => {
    try {
      await authorizeWidgets({ authorize, permission: "widgets.read" });
      const entry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: input.widgetInstanceId });
      const { exists, status } = resolveWidgetStatus(entry);
      const refs = await deps.entryRefsRepo.findByTarget({ workspaceId: deps.workspaceId, targetKind: "entry", targetId: input.widgetInstanceId });
      return ok({ value: { tool: "widgets.diagnose", exists, status, whereUsed: toWhereUsedResponse({ refs }, {}) } });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
