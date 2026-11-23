import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { assistantActorId, rejectAssistantError, type AssistantErrorMapping, type AssistantRoutePrincipal } from "./shared.js";

/** Admin page transport for the same visitor-tools service that assistant chat uses. */
export const ADMIN_VISITOR_TOOLS_PATH = "/api/admin/v1/workspaces/:workspaceId/assistant/visitor-tools";

/**
 * The host's visitor-tools management service, as these routes call it. It owns authorization
 * (`visitor-tools.manage`) and the fresh-revision checks; the routes only carry the caller's id.
 */
export interface VisitorToolsManagementRoutePort {
  list(required: { callerPrincipalId: string }): Promise<unknown>;
  prepare(required: { callerPrincipalId: string; input: unknown }): Promise<unknown>;
  apply(required: { callerPrincipalId: string; prepared: unknown }): Promise<unknown>;
}

/** The deps both routes read. */
export interface VisitorToolsRouteSpecDeps {
  workspaceId: string;
  /** Resolved per request: a host without the service answers the redacted 500, as before. */
  visitorToolsManagement: () => VisitorToolsManagementRoutePort | undefined;
  /** The host's ladder for its typed service errors: 409 revision conflict (`reload`), 403, 400 validation. */
  errorMappings: readonly AssistantErrorMapping[];
}

/** The service for this request, or the failure the host answers as its redacted 500. @complexity O(1). */
function visitorToolsService({ deps }: { deps: VisitorToolsRouteSpecDeps }, _optional: Record<string, never> = {}): VisitorToolsManagementRoutePort {
  const service = deps.visitorToolsManagement();
  if (!service) throw new Error("Visitor tools service unavailable.");
  return service;
}

/**
 * GET the visitor-tools view. Requires `visitor-tools.manage` through the service; the enclosing
 * admin module requires a session. Answers `{ data: VisitorToolsView }`.
 */
export const assistantVisitorToolsListRoute = defineJsonRoute<Record<string, never>, { data: unknown }, VisitorToolsRouteSpecDeps, AssistantRoutePrincipal>({
  method: "get",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    // Single workspace/session boundary; auth and fresh revision checks remain service-owned.
    try {
      const service = visitorToolsService({ deps });
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
export const assistantVisitorToolsConfigureRoute = defineJsonRoute<{ body: unknown }, { data: unknown }, VisitorToolsRouteSpecDeps, AssistantRoutePrincipal>({
  method: "put",
  path: ADMIN_VISITOR_TOOLS_PATH,
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context }) => {
    try {
      const service = visitorToolsService({ deps });
      const callerPrincipalId = assistantActorId({ context });
      const prepared = await service.prepare({ callerPrincipalId, input: input.body });
      return ok({ value: { data: await service.apply({ callerPrincipalId, prepared }) } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});
