import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { insertWidgetEmbed, type EmbedServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError } from "../../http/widgets.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host (its entry locks,
 *  host ports, repositories and outbox), exactly as the hand-written route built them. */
export interface WidgetEmbedInsertRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  widgetsDeps: () => EmbedServiceDeps;
}

/** This route's validated input: the host entry from the path plus the POST body's two fields. */
export interface WidgetEmbedInsertInput {
  hostEntryId: string;
  baseVersion: number;
  widgetEntryId: string;
}

/**
 * POST insert a `widgetEmbed` node into a host entry's body (SPEC-043 REQ-44/45, ADR-047 Debate
 * Fold-In Amendment 6) — the server-side, no-live-editor-required mutation path. `widgets.place`-gated.
 */
export const widgetEmbedInsertRoute = defineJsonRoute<WidgetEmbedInsertInput, Awaited<ReturnType<typeof insertWidgetEmbed>>, WidgetEmbedInsertRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    if (typeof body.baseVersion !== "number" || typeof body.widgetEntryId !== "string") {
      rejectRoute({ status: 400, error: "baseVersion and widgetEntryId are required", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { hostEntryId: String(raw.params.hostEntryId), baseVersion: body.baseVersion, widgetEntryId: body.widgetEntryId } });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const { entry, placementId } = await insertWidgetEmbed({
        deps: deps.widgetsDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }), kind: "user" }, ...input },
      });
      return ok({ value: { entry, placementId } });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
}, { successStatus: 201 });
