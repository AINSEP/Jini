import { toolMetadata } from "@jini-ai/core/tool-metadata/server-logs";
import { adaptLegacyAuthorize, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireToolPermission, ToolInputError, ToolPermissionDeniedError as ForbiddenError, type AgentToolSideEffect, type ToolContributor, type ToolRegistration } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { serverLogsAgentToolCatalog } from "./agent-tools.js";
import { parseServerLogFilters, readServerLogs, ServerLogFilterError, type ServerLogSourcePort } from "./read-server-logs.js";

export interface ServerLogsToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  /** Defaults to the log source the host bound on {@link contributeServerLogsTools}. */
  serverLogs?: ServerLogSourcePort;
}

/** The log source a host binds once when contributing the tool (its own process log capture). */
export interface ServerLogsContributorArgs {
  serverLogs: ServerLogSourcePort;
}

export const serverLogsDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> readServerLogs over an in-memory buffer only; writes nothing.
  ["system_read_server_logs", "none"],
]);

/**
 * Builds `system_read_server_logs`, gated by the same `system.read` permission as the admin route.
 * @param deps - Site scope, authorization and the log source port.
 * @returns One read-only registration.
 * @throws {ToolInputError} For an unusable filter or denied system.read.
 * @complexity O(n) over buffered lines.
 */
export function buildServerLogsRegistrations(deps: ServerLogsToolDeps & ServerLogsContributorArgs, _optional: Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "system-server-logs", catalogModule: "server-logs/agent-tools.ts", catalog: indexCatalogById({ catalog: serverLogsAgentToolCatalog }), derivedRisk: serverLogsDerivedRisk, handlers: withModelFacingErrors({ handlers: {
    system_read_server_logs: async ctx => {
      const raw = requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "system.read" }, { entityType: "server-logs" });
      let filters;
      try {
        filters = parseServerLogFilters({ raw });
      } catch (err) {
        if (err instanceof ServerLogFilterError) throw new ToolInputError({ message: err.message });
        throw err;
      }
      return readServerLogs({ logs: deps.serverLogs }, filters);
    },
  }, rules: [forbiddenRule({ domainPrefix: "SERVER_LOGS", error: ForbiddenError })] }) });
}

/** Keeps the diagnostic under its own contributor domain. */
export function contributeServerLogsTools(required: ServerLogsContributorArgs, _optional: Record<string, never> = {}): ToolContributor<ServerLogsToolDeps, unknown> {
  return { domain: "system-server-logs", build: deps => buildServerLogsRegistrations({ ...deps, serverLogs: deps.serverLogs ?? required.serverLogs }), risk: serverLogsDerivedRisk };
}
