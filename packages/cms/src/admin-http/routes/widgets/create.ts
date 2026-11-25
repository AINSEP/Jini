import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createWidgetInstance, type WidgetInstanceEntry, type WidgetTypeKey, type WidgetWriteServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetResponse } from "../../http/widgets.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `widgetsDeps` is built per request by the host (its entry locks,
 *  host ports, repositories and outbox), exactly as the hand-written route built them. */
export interface WidgetCreateRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  widgetsDeps: () => WidgetWriteServiceDeps;
}

/** This route's validated POST body shape. */
export interface WidgetCreateBody {
  widgetType: WidgetTypeKey;
  title: string;
  config: Record<string, unknown>;
  slug?: string;
}

/** This route's validated POST body shape, or `null` when `widgetType`/`title` failed validation.
 *  `widgetType` is cast, not validated, against the real `WidgetTypeKey` union here —
 *  `createWidgetInstance` (`getWidgetTypeRegistration`) is what rejects an unregistered type at
 *  runtime. @complexity O(1). */
function parseWidgetCreateBody({ rawBody }: { rawBody: unknown }, _optional = {}): WidgetCreateBody | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (typeof body.widgetType !== "string" || typeof body.title !== "string") return null;
  return {
    widgetType: body.widgetType as WidgetTypeKey,
    title: body.title,
    config: typeof body.config === "object" && body.config !== null ? (body.config as Record<string, unknown>) : {},
    ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
  };
}

/**
 * POST a new widget instance (SPEC-043 REQ-01/02/03), `widgets.create`-gated (enforced inside
 * `createWidgetInstance` itself — REQ-40 requires the SAME gate for human and AI-originated calls,
 * so the domain function owns the check, not this route). Backs both `ui.spec.md`'s
 * `WidgetInstanceEditorScreen` create flow and the `widgets.create` half of `WidgetPickerDialog`'s
 * "create new" path (REQ-33/35).
 */
export const widgetCreateRoute = defineJsonRoute<WidgetCreateBody, { widget: WidgetInstanceEntry }, WidgetCreateRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets",
  parse: (raw) => {
    const parsedBody = parseWidgetCreateBody({ rawBody: raw.body });
    if (!parsedBody) rejectRoute({ status: 400, error: "widgetType and title are required strings", code: "VALIDATION_ERROR" });
    return ok({ value: parsedBody });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const { instance } = await createWidgetInstance({
        deps: deps.widgetsDeps(),
        input: { workspaceId: deps.workspaceId, actor: { principalId: widgetActorId({ context }), kind: "user" }, ...input },
      });
      return ok({ value: toAdminWidgetResponse(instance) });
    } catch (err) {
      return rejectWidgetError({ err, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
}, { successStatus: 201 });
