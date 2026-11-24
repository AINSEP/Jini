import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { assistantActorId, rejectAssistantError, type AssistantErrorMapping, type AssistantRoutePrincipal } from "./shared.js";

/** Admin page transport for the same visitor-tools service that assistant chat uses. */
export const ADMIN_VISITOR_TOOLS_PATH = "/api/admin/v1/workspaces/:workspaceId/assistant/visitor-tools";

/**
 * The host's visitor-tools management service, as these routes call it. It owns authorization
 * (`visitor-tools.manage`) and the fresh-revision checks; the routes only carry the caller's id.
 * Each route is handed only the half it calls: GET reads (`list`), PUT writes (`prepare`, `apply`).
 */
export interface VisitorToolsListRoutePort {
  list(required: { callerPrincipalId: string }): Promise<unknown>;
}

/** The write half: PUT prepares the change (the service's fresh-revision check), then applies it. */
export interface VisitorToolsConfigureRoutePort {
  prepare(required: { callerPrincipalId: string; input: unknown }): Promise<unknown>;
  apply(required: { callerPrincipalId: string; prepared: unknown }): Promise<unknown>;
}

/** The whole service a host holds; it satisfies both routes' ports. */
export interface VisitorToolsManagementRoutePort extends VisitorToolsListRoutePort, VisitorToolsConfigureRoutePort {}

/** The deps the GET route reads. */
export interface VisitorToolsListRouteDeps {
  workspaceId: string;
  /** Resolved per request: a host without the service answers the redacted 500, as before. */
  visitorToolsManagement: () => VisitorToolsListRoutePort | undefined;
  /** The host's ladder for its typed service errors: 409 revision conflict (`reload`), 403, 400 validation. */
  errorMappings: readonly AssistantErrorMapping[];
}

/** The deps the PUT route reads: the same, with only the write half of the service. */
export interface VisitorToolsConfigureRouteDeps {
  workspaceId: string;
  /** Resolved per request: a host without the service answers the redacted 500, as before. */
  visitorToolsManagement: () => VisitorToolsConfigureRoutePort | undefined;
  /** The host's ladder for its typed service errors: 409 revision conflict (`reload`), 403, 400 validation. */
  errorMappings: readonly AssistantErrorMapping[];
}

/** The service for this request, or the failure the host answers as its redacted 500. @complexity O(1). */
function visitorToolsService<Port>({ resolve }: { resolve: () => Port | undefined }, _optional: Record<string, never> = {}): Port {
  const service = resolve();
  if (!service) throw new Error("Visitor tools service unavailable.");
  return service;
}

/**
 * GET the visitor-tools view. Requires `visitor-tools.manage` through the service; the enclosing
 * admin module requires a session. Answers `{ data: VisitorToolsView }`.
 */
export const assistantVisitorToolsListRoute = defineJsonRoute<Record<string, never>, { data: unknown }, VisitorToolsListRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    // Single workspace/session boundary; auth and fresh revision checks remain service-owned.
    try {
      const service = visitorToolsService({ resolve: () => deps.visitorToolsManagement() });
      return ok({ value: { data: await service.list({ callerPrincipalId: assistantActorId({ context }) }) } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});

/**
 * PUT one tool's configuration. Body is `{toolId, expectedRevisionSeq, mode?, limits?}`, handed to
 * the service unvalidated (it owns the shape); prepare then apply, answering `{ data: VisitorToolsView }`.
 */
export const assistantVisitorToolsConfigureRoute = defineJsonRoute<{ body: unknown }, { data: unknown }, VisitorToolsConfigureRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context }) => {
    try {
      const service = visitorToolsService({ resolve: () => deps.visitorToolsManagement() });
      const callerPrincipalId = assistantActorId({ context });
      const prepared = await service.prepare({ callerPrincipalId, input: input.body });
      return ok({ value: { data: await service.apply({ callerPrincipalId, prepared }) } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});
