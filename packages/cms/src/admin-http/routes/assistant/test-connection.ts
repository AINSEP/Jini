import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { SupportedExecutionProtocol } from "./execution-request-fields.js";
import {
  authorizeAssistantExecution, executionActorId, probeCredentialRequest, readProbeRequestFields, resolveProbeCredentialOrReject,
  supportedProtocolOrReject, type AssistantExecutionRoutePrincipal, type ProbeRequestFields, type ResolveProbeCredentialFn,
} from "./execution-shared.js";

/** What the host's connection probe answers (a structural subset of the runtime's response). */
export interface ConnectionProbeResult { ok: boolean; kind: string; detail?: string }

/** The host's outbound connection probe, with its own guarded, redirect-refusing transport bound in. */
export type TestConnectionFn = (
  required: { protocol: SupportedExecutionProtocol; baseUrl: string; apiKey: string; model: string },
  optional?: { apiVersion?: string },
) => Promise<ConnectionProbeResult>;

/** The deps this route reads. */
export interface AssistantTestConnectionRouteDeps {
  workspaceId: string;
  manageAssistantPermission: string;
  resolveProbeCredential: ResolveProbeCredentialFn;
  testConnection: TestConnectionFn;
}

/** The connection-probe body fields: the shared probe fields plus the model to smoke-test. */
export type TestConnectionInput = ProbeRequestFields & { model: string };

/** True if either required connection-target field is blank.
 *  @complexity O(1). */
function isMissingConnectionTarget({ baseUrl, model }: { baseUrl: string; model: string }, _optional = {}): boolean {
  return !baseUrl.trim() || !model.trim();
}

/** The verdict message: the probe's detail when it gave one, else a default per outcome. @complexity O(1). */
function renderMessage(result: ConnectionProbeResult): string {
  if (result.ok) return result.detail?.trim() ? result.detail : "Connection succeeded";
  return result.detail?.trim() ? result.detail : `Connection failed (${result.kind})`;
}

/**
 * POST probes a BYOK provider endpoint with the caller-supplied (or host-resolved stored)
 * credentials. The server makes the real outbound request so the key never has to leave the
 * admin's own browser via a cross-origin fetch, and so the SSRF guard runs against a base URL the
 * SERVER resolves. That guard bounds which ADDRESS SPACE a probe may reach, deliberately not which
 * HOST; keeping a stored credential away from a caller-chosen host is the host chokepoint's rule.
 *
 * A typed key wins and travels to the endpoint its owner named; EITHER stored credential travels
 * only to the endpoint the server already recorded for it. `principalId` comes from the session,
 * never the body — it is what scopes the admin branch to the caller's own row.
 */
export const assistantTestConnectionRoute = defineJsonRoute<TestConnectionInput, { ok: boolean; message: string }, AssistantTestConnectionRouteDeps, AssistantExecutionRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution/test-connection",
  parse: (raw) => {
    const model = (raw.body ?? {}) as { model?: unknown };
    return ok({ value: { ...readProbeRequestFields(raw.body), model: typeof model.model === "string" ? model.model : "" } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeAssistantExecution({ authorize, permission: deps.manageAssistantPermission });
    const principalId = executionActorId({ context });
    const protocol = supportedProtocolOrReject({ protocol: input.protocol });
    if (isMissingConnectionTarget(input)) rejectRoute({ status: 400, error: "baseUrl and model are required", code: "VALIDATION_ERROR" });
    const credential = await resolveProbeCredentialOrReject({
      resolve: deps.resolveProbeCredential, request: probeCredentialRequest({ fields: input, principalId }),
    });
    const result = await deps.testConnection(
      { protocol, baseUrl: credential.baseUrl, apiKey: credential.apiKey, model: input.model },
      input.apiVersion ? { apiVersion: input.apiVersion } : {},
    );
    return ok({ value: { ok: result.ok, message: renderMessage(result) } });
  },
});
