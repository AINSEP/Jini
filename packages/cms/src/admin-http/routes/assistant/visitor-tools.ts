import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { VisitorToolsView } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { ForbiddenError, ValueValidationFailedError } from "@jini-ai/core/settings";

import { ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, type AssistantRoutePrincipal } from "./shared.js";

/**
 * @file Admin page transport for the same visitor-tools service that assistant chat uses.
 * GET/PUT require visitor-tools.manage through the service; the enclosing admin module requires a session.
 * PUT body is {toolId, expectedRevisionSeq, mode?, limits?}; both return {data: VisitorToolsView}.
 * Auth and fresh revision checks remain service-owned, so neither spec calls `authorize`.
 */

export const ADMIN_VISITOR_TOOLS_PATH = `${ASSISTANT_ROUTE_PREFIX}/visitor-tools`;

/** The wire read model as a host service hands it over: the core DTO with every level read-only, so
 * a host whose own view type is deeply `readonly` binds without a cast. */
type ReadonlyDeep<T> = T extends readonly (infer E)[] ? readonly ReadonlyDeep<E>[] : T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;
export type VisitorToolsReadModel = ReadonlyDeep<VisitorToolsView>;

/** The slice of the host's visitor-tools management service these routes call. Method syntax keeps
 * the host's own prepared-value type assignable to `unknown` here. */
export interface VisitorToolsManagementSlice {
  list(required: { callerPrincipalId: string }): Promise<VisitorToolsReadModel>;
  prepare(required: { callerPrincipalId: string; input: unknown }): Promise<unknown>;
  apply(required: { callerPrincipalId: string; prepared: unknown }): Promise<VisitorToolsReadModel>;
}

/** How the host classifies its own typed visitor-tools errors; anything else falls through the ladder. */
export type VisitorToolsErrorKind = "revision-conflict" | "policy-validation";

/** What both routes read: the service (absent ⇒ the host's redacted 500) and the host error classifier. */
export interface VisitorToolsRouteDepsBase {
  visitorToolsManagement: VisitorToolsManagementSlice | undefined;
  visitorToolsErrorKind: (error: unknown) => VisitorToolsErrorKind | undefined;
}
export type ListVisitorToolsRouteDeps = VisitorToolsRouteDepsBase;
export type ConfigureVisitorToolsRouteDeps = VisitorToolsRouteDepsBase;

/** The routes' answer envelope. */
export interface VisitorToolsResponse { data: VisitorToolsReadModel }

/** Map typed service errors without leaking settings/provider failures; ladder order is the
 * hand-written one (conflict, forbidden, validation). An unmapped error is returned unchanged for the
 * host's redacted 500. @complexity O(1). */
function visitorToolsRefusal({ error, kind }: { error: unknown; kind: VisitorToolsErrorKind | undefined }, _optional: Record<string, never> = {}): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (kind === "revision-conflict") {
    return new RouteRefusalError({ status: 409, body: { error: message, code: "VISITOR_TOOLS_REVISION_CONFLICT", reload: true } });
  }
  if (error instanceof ForbiddenError) {
    return new RouteRefusalError({ status: 403, body: { error: "visitor-tools.manage is required", code: "FORBIDDEN" } });
  }
  if (kind === "policy-validation" || error instanceof ValueValidationFailedError) {
    return new RouteRefusalError({ status: 400, body: { error: message, code: "VISITOR_TOOLS_VALIDATION_ERROR" } });
  }
  return error;
}

/** Single session boundary for both operations: the service must be bound and the session read,
 * then any service failure goes through the refusal ladder. @complexity O(1) plus bounded service I/O. */
async function runVisitorTools(
  { deps, context, operation }: {
    deps: VisitorToolsRouteDepsBase; context: AssistantRoutePrincipal | undefined;
    operation: (required: { service: VisitorToolsManagementSlice; callerPrincipalId: string }) => Promise<VisitorToolsReadModel>;
  },
  _optional: Record<string, never> = {},
): Promise<VisitorToolsResponse> {
  try {
    const service = deps.visitorToolsManagement;
    if (!service) throw new Error("Visitor tools service unavailable.");
    const callerPrincipalId = assistantPrincipalId({ context });
    return { data: await operation({ service, callerPrincipalId }) };
  } catch (error) {
    throw visitorToolsRefusal({ error, kind: deps.visitorToolsErrorKind(error) });
  }
}

/** GET the visitor-tools read model, as the session principal. */
export const listVisitorToolsRoute = defineJsonRoute<undefined, VisitorToolsResponse, ListVisitorToolsRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context }) => ok({
    value: await runVisitorTools({ deps, context, operation: ({ service, callerPrincipalId }) => service.list({ callerPrincipalId }) }),
  }),
});

/** PUT one tool's mode/limits: the service prepares the raw body, then applies the prepared change. */
export const configureVisitorToolsRoute = defineJsonRoute<unknown, VisitorToolsResponse, ConfigureVisitorToolsRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, context }) => ok({
    value: await runVisitorTools({ deps, context, operation: async ({ service, callerPrincipalId }) => {
      const prepared = await service.prepare({ callerPrincipalId, input });
      return service.apply({ callerPrincipalId, prepared });
    } }),
  }),
});
