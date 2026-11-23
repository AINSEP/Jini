import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { createWidgetInstance, type WidgetInstanceEntry, type WidgetWriteServiceDeps, type EmbedServiceDeps } from "../../../widgets/index.js";
import { rejectWidgetError, toAdminWidgetResponse, widgetDomainErrorToResponse } from "../../http/widgets.js";
import { placeWidgetToolTarget, type WidgetToolActor, type WidgetToolPlacementDeps } from "./agent-tools-placement.js";
import { parseCreateToolInput, rejectBadWidgetToolTarget, type CreateToolInput } from "./agent-tools-targets.js";
import { widgetActorId, type WidgetRoutePrincipal } from "./shared.js";

/** The deps this route reads: the placement deps, with `widgetsDeps` also serving the create. */
export interface WidgetCreateToolRouteDeps extends WidgetToolPlacementDeps {
  widgetsDeps: () => WidgetWriteServiceDeps & EmbedServiceDeps;
}

export interface WidgetCreateToolResponse {
  tool: "widgets.create";
  widget: WidgetInstanceEntry;
  result: Awaited<ReturnType<typeof placeWidgetToolTarget>>;
}

/** The body a placement failure answers with: the created widget, `placementFailed: true`, and the
 *  failure's own `{ error, code, ... }` envelope merged in. Exported so a host answering a failure
 *  this spec cannot map (see {@link WidgetToolPlacementFailedError}) builds the identical shape.
 *  @complexity O(size of the error body). */
export function widgetToolPlacementFailedBody({ widget, errorBody }: { widget: WidgetInstanceEntry; errorBody: Record<string, unknown> }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return { tool: "widgets.create", widget: toAdminWidgetResponse(widget).widget, placementFailed: true, ...errorBody };
}

/** A placement failure that is not a widgets domain error (e.g. a host plugin hook refusing the
 *  embed host's save, or an unexpected failure). Carries the already-created widget so the host's
 *  error port can answer with {@link widgetToolPlacementFailedBody} around its own envelope. */
export class WidgetToolPlacementFailedError extends Error {
  readonly widget: WidgetInstanceEntry;
  override readonly cause: unknown;
  constructor({ widget, cause }: { widget: WidgetInstanceEntry; cause: unknown }) {
    super("widgets.create placed no widget: placement failed after the instance was created");
    this.name = "WidgetToolPlacementFailedError";
    this.widget = widget;
    this.cause = cause;
  }
}

/**
 * Finding D (Fable adversarial-review fix, 2026-07-21): placement failing AFTER the
 * instance was already created must not silently drop the created id — the instance is
 * real and persisted regardless of whether placement succeeded. Without this, a caller
 * (especially a retrying AI agent) sees only an error, has no way to know the instance
 * already exists, and mints a duplicate via a second `widgets.create` call instead of
 * retrying placement with `widgets.place`.
 *
 * @complexity O(n) in the fixed widget error table length.
 */
export function rejectWidgetToolPlacementFailure({ widget, err }: { widget: WidgetInstanceEntry; err: unknown }, _optional: Record<string, never> = {}): never {
  const mapped = widgetDomainErrorToResponse({ err });
  if (mapped) throw new RouteRefusalError({ status: mapped.status, body: widgetToolPlacementFailedBody({ widget, errorBody: mapped.body }) });
  throw new WidgetToolPlacementFailedError({ widget, cause: err });
}

/** Creates the instance, refusing a widgets domain error the same way every widgets route does.
 *  @complexity O(1) plus the write service. */
async function createToolInstance({ deps, actor, input }: { deps: WidgetCreateToolRouteDeps; actor: WidgetToolActor; input: CreateToolInput }, _optional: Record<string, never> = {}): Promise<WidgetInstanceEntry> {
  try {
    const { instance } = await createWidgetInstance({
      deps: deps.widgetsDeps(),
      input: { workspaceId: deps.workspaceId, actor, widgetType: input.widgetType, title: input.title, config: input.config },
    });
    return instance;
  } catch (err) {
    return rejectWidgetError({ err });
  }
}

/** `widgets.create` — create a NEW widget instance and place it in one call. Distinct from
 * `widgets.place` (REQ-35, AC-25). */
export const widgetCreateToolRoute = defineJsonRoute<CreateToolInput, WidgetCreateToolResponse, WidgetCreateToolRouteDeps, WidgetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/tools/create",
  parse: (raw) => {
    const parsed = parseCreateToolInput({ body: (raw.body ?? {}) as Record<string, unknown> });
    if (!parsed) return rejectBadWidgetToolTarget();
    return ok({ value: parsed });
  },
  handle: async ({ input, deps, context }) => {
    const actor = { principalId: widgetActorId({ context }), kind: "user" };
    const instance = await createToolInstance({ deps, actor, input });
    try {
      const result = await placeWidgetToolTarget({ deps, actor, target: input.target, widgetEntryId: instance.id });
      return ok({ value: { tool: "widgets.create", widget: toAdminWidgetResponse(instance).widget, result } });
    } catch (placeErr) {
      return rejectWidgetToolPlacementFailure({ widget: instance, err: placeErr });
    }
  },
}, { successStatus: 201 });
