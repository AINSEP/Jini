import { adaptLegacyAuthorize, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireToolPermission, ToolInputError, ToolPermissionDeniedError as ForbiddenError, type AgentToolSideEffect, type AgentToolDefinition, type ToolContributor, type ToolRegistration } from "@jini-ai/core";
import { forbiddenRule, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import type { TelemetryTestResult } from "./telemetry-test.js";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { toolMetadata } from "@jini-ai/core/tool-metadata/observability";

export interface ObservabilityToolDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  sendTelemetryTest?: (required: Record<string, never>, optional?: Record<string, never>) => Promise<TelemetryTestResult>;
}
/** The fixed diagnostic message the host's `sendTelemetryTest` reports; the description names it verbatim. */
export interface ObservabilityCatalogArgs {
  testErrorMessage: string;
}
export function createObservabilityAgentToolCatalog({ testErrorMessage }: ObservabilityCatalogArgs, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [{
    name: "observability_send_test_error",
    description: `Send the fixed diagnostic '${testErrorMessage}', one test span and one telemetry_test analytics event through this site's tracker. Requires admin system.write. No confirmation needed. Returns provider ids and signals accepted locally; this is not proof of remote delivery. Analytics still requires telemetry consent. Takes no arguments.`,
    sideEffects: "mutates-durable-state", authorization: { permission: "system.write" },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }];
}
export const observabilityDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([["observability_send_test_error", "mutates-durable-state"]]);

/** Thin admin adapter over the same diagnostic action as the HTTP surface.
 * @returns One registration. @throws ToolInputError for unavailable service or extra input.
 * @complexity O(1) excluding the injected authorization and diagnostic action.
 */
export function buildObservabilityRegistrations(deps: ObservabilityToolDeps & ObservabilityCatalogArgs, _options = {}): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "observability",
    catalogModule: "observability/tool-registrations.ts", catalog: indexCatalogById({ catalog: createObservabilityAgentToolCatalog({ testErrorMessage: deps.testErrorMessage }) }), derivedRisk: observabilityDerivedRisk,
    handlers: withModelFacingErrors({ handlers: {
      observability_send_test_error: async ctx => {
        const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
        if (Object.keys(input).length) throw new ToolInputError({ message: "observability_send_test_error takes no arguments." });
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId,
          principalId: ctx.principal.id, permission: "system.write" }, { entityType: "observability" });
        if (!deps.sendTelemetryTest) throw new ToolInputError({ message: "Telemetry test is unavailable on this server." });
        ctx.signal.throwIfAborted();
        return deps.sendTelemetryTest({});
      },
    }, rules: [forbiddenRule({ domainPrefix: "OBSERVABILITY", error: ForbiddenError })] }),
  });
}
export function contributeObservabilityTools(required: ObservabilityCatalogArgs, _options = {}): ToolContributor<ObservabilityToolDeps, object> {
  return { domain: "observability", build: deps => buildObservabilityRegistrations({ ...deps, testErrorMessage: required.testErrorMessage }), risk: observabilityDerivedRisk };
}
