import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { updateWidgetInstance, type WidgetInstanceEntry, type WidgetWriteServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetResponse } from "../../http/widgets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host, exactly as the
 *  hand-written route built them. */
export interface WidgetUpdateRouteDeps {
  workspaceId: string;
  widgetsDeps: () => WidgetWriteServiceDeps;
}

/** The validated PUT input: the instance id plus its OCC base version, title and config. */
export interface WidgetUpdateInput {
  id: string;
  baseVersion: number;
  title?: string;
  config: Record<string, unknown>;
}

/**
 * The PUT body checks, in the hand-written route's order: `baseVersion` first, then `title`.
 *
 * @complexity O(1).
 */
function parseWidgetUpdate({ id, rawBody }: { id: string; rawBody: unknown }, _optional: Record<string, never> = {}): WidgetUpdateInput {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (typeof body.baseVersion !== "number") rejectRoute({ status: 400, error: "baseVersion is required", code: "VALIDATION_ERROR" });
  if (body.title !== undefined && typeof body.title !== "string") rejectRoute({ status: 400, error: "title must be a string", code: "VALIDATION_ERROR" });
  const config = typeof body.config === "object" && body.config !== null ? (body.config as Record<string, unknown>) : {};
  return { id, baseVersion: body.baseVersion, ...(typeof body.title === "string" ? { title: body.title } : {}), config };
}

/** PUT an existing widget instance's config (SPEC-043 REQ-05/06), `widgets.update`-gated, OCC via `baseVersion`. */
export const widgetUpdateRoute = defineJsonRoute<WidgetUpdateInput, { widget: WidgetInstanceEntry }, WidgetUpdateRouteDeps, WidgetRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/:id",
  parse: (raw) => ok({ value: parseWidgetUpdate({ id: String(raw.params.id), rawBody: raw.body }) }),
  handle: async ({ input, deps, context }) => {
    try {
      const { instance } = await updateWidgetInstance({
        deps: deps.widgetsDeps(),
        input: {
          workspaceId: deps.workspaceId,
          actor: { principalId: widgetActorId({ context }) },
          widgetInstanceId: input.id,
          baseVersion: input.baseVersion,
          ...(input.title === undefined ? {} : { title: input.title }),
          config: input.config,
        },
      });
      return ok({ value: toAdminWidgetResponse(instance) });
    } catch (err) {
      return rejectWidgetError({ err });
    }
  },
});
