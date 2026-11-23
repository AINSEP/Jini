import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminExecutionTestConnectionResponse } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { readOptionalString, validateSupportedProtocol, type SupportedExecutionProtocol } from "./execution-request-fields.js";
import { ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";
import { probeCredentialInput, resolveProbeCredential, type ProbeCredentialResolvers, type ProbeRequestBody } from "./stored-credential-probe.js";

/** The slice of the provider connection-test result this route reads. */
export interface ProviderConnectionResult { ok: boolean; kind: string; detail?: string }

/** What this route reads: the stored-credential readers and the host's connection probe, already bound
 * to its DNS/transport seams and to its redirect refusal (a provider redirect must not carry the
 * probe's credentials to a destination that never passed the SSRF guard). */
export interface TestConnectionRouteDeps extends AssistantPermissionDeps, ProbeCredentialResolvers {
  testProviderConnection: (
    required: { protocol: SupportedExecutionProtocol; baseUrl: string; apiKey: string; model: string },
    optional: { apiVersion?: string },
  ) => Promise<ProviderConnectionResult>;
}

/** True if either required connection-target field is blank.
 *  @complexity O(1). */
function isMissingConnectionTarget({ baseUrl, model }: { baseUrl: string; model: string }, _optional = {}): boolean {
  return !baseUrl.trim() || !model.trim();
}

/** The probe's own detail when it carries one, else a generic verdict naming the failure kind.
 *  @complexity O(1). */
function renderMessage({ result }: { result: ProviderConnectionResult }, _optional: Record<string, never> = {}): string {
  if (result.ok) return result.detail?.trim() ? result.detail : "Connection succeeded";
  return result.detail?.trim() ? result.detail : `Connection failed (${result.kind})`;
}

/**
 * POST probes a BYOK provider endpoint with the caller-supplied credentials
 * — the "Execution mode" tab's `ExecutionPort.testConnection`. Delegates to the
 * host-bound `testProviderConnection` probe: this server makes the real outbound
 * request to the provider so the key never has to leave the admin's own browser
 * via a cross-origin fetch, and so the SSRF guard (`validateBaseUrlResolved`)
 * runs against a base URL the SERVER resolves, not one a hostile client could
 * steer client-side.
 *
 * That guard bounds which ADDRESS SPACE a probe may reach (it rejects
 * loopback/RFC1918/link-local/CGNAT), and deliberately not which HOST — every
 * real provider is a public host. It is therefore not what keeps the stored
 * site credential from being sent somewhere it shouldn't go; see
 * `stored-credential-probe.ts` for the separate rule that does.
 *
 * The request body's `apiKey` is used for exactly this one outbound call and
 * is never persisted anywhere on this server — no settings write, no log
 * line includes it (`testProviderConnection` redacts it out of any upstream
 * error text it surfaces). See the host's execution-mode settings for why
 * that constraint exists (ADR-028 §6) and where the key lives instead
 * (the browser's own localStorage).
 */
export const testConnectionRoute = defineJsonRoute<unknown, AdminExecutionTestConnectionResponse, TestConnectionRouteDeps, AssistantRoutePrincipal>({
  method: "post",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution/test-connection`,
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, authorize, context }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-execution" });
    const body = (input ?? {}) as ProbeRequestBody;
    const protocol = readOptionalString({ value: body.protocol, fallback: "" });
    const baseUrl = readOptionalString({ value: body.baseUrl, fallback: "" });
    const model = readOptionalString({ value: body.model, fallback: "" });
    const apiVersion = readOptionalString({ value: body.apiVersion, fallback: undefined });

    const protocolError = validateSupportedProtocol({ protocol });
    if (protocolError) throw new RouteRefusalError({ status: 400, body: protocolError });
    if (isMissingConnectionTarget({ baseUrl, model })) {
      throw new RouteRefusalError({ status: 400, body: { error: "baseUrl and model are required", code: "VALIDATION_ERROR" } });
    }

    // Which key probes, and WHERE it is allowed to go — one chokepoint shared with
    // `list-models.ts`. A typed key wins and travels to the endpoint its owner named; EITHER
    // stored credential travels only to the endpoint the server already recorded for it, never to
    // one this request body chose. `principalId` comes from the session, never the body — it is
    // what scopes the admin branch to the caller's own row. See `stored-credential-probe.ts`.
    const credential = await resolveProbeCredential({
      deps, input: probeCredentialInput({ body, requestedBaseUrl: baseUrl, principalId: assistantPrincipalId({ context }) }),
    });
    if (!credential.ok) throw new RouteRefusalError({ status: 400, body: credential.failure });

    const result = await deps.testProviderConnection(
      { protocol: protocol as SupportedExecutionProtocol, baseUrl: credential.baseUrl, apiKey: credential.apiKey, model },
      apiVersion ? { apiVersion } : {},
    );
    return ok({ value: { ok: result.ok, message: renderMessage({ result }) } });
  },
});
