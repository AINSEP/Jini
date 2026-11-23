import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminExecutionListModelsResponse } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { readOptionalString, validateSupportedProtocol, type SupportedExecutionProtocol } from "./execution-request-fields.js";
import { ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";
import {
  probeCredentialInput, resolveProbeCredential,
  type ProbeCredentialResolution, type ProbeCredentialResolvers, type ProbeRequestBody,
} from "./stored-credential-probe.js";

/** The slice of the provider model-catalog result this route reads. */
export interface ProviderModelsResult { ok: boolean; kind: string; detail?: string; models?: Array<{ id: string }> }

/** What this route reads: the stored-credential readers, the host's model-catalog probe (already
 * bound to its DNS/transport seams) and the host's empty-key copy. */
export interface ListModelsRouteDeps extends AssistantPermissionDeps, ProbeCredentialResolvers {
  listProviderModels: (
    required: { protocol: SupportedExecutionProtocol; baseUrl: string; apiKey: string },
    optional: { apiVersion?: string },
  ) => Promise<ProviderModelsResult>;
  /**
   * Replaces the runtime's host-neutral empty-key refusal ("No API key saved. Save one to load
   * models.") with one that says where the host keeps keys.
   */
  noServerKeyMessage: string;
}

/**
 * Calls the injected model-catalog probe and shapes its result into this route's response body —
 * isolated so the two `?? []`/spread-if-present shapes don't add to the handler's own branching.
 *
 * @complexity O(n) in the returned model count (one `.map()`).
 */
async function fetchListModelsResponse(
  { protocol, credential, apiVersion, deps }: {
    protocol: SupportedExecutionProtocol; credential: Extract<ProbeCredentialResolution, { ok: true }>;
    apiVersion: string | undefined; deps: ListModelsRouteDeps;
  },
  _optional: Record<string, never> = {},
): Promise<AdminExecutionListModelsResponse> {
  const result = await deps.listProviderModels(
    { protocol, baseUrl: credential.baseUrl, apiKey: credential.apiKey },
    apiVersion ? { apiVersion } : {},
  );
  const missingKey = result.kind === "auth_failed" && !credential.apiKey.trim();
  const message = missingKey ? deps.noServerKeyMessage : result.detail;
  return {
    ok: result.ok,
    models: (result.models ?? []).map((model) => model.id),
    ...(message ? { message } : {}),
  };
}

/**
 * POST live-discovers a BYOK provider's model catalog — the "Execution mode"
 * tab's optional `ExecutionPort.listModels`. Delegates to the host-bound
 * `listProviderModels` probe: the same reasons `test-connection.ts` makes its
 * outbound call server-side apply here — the key stays out of the browser's
 * cross-origin fetch and the SSRF guard runs against a server-resolved base URL.
 *
 * Same never-persisted `apiKey` contract as `test-connection.ts` — see that
 * file's header.
 *
 * An earlier revision of this header answered the wrong threat here, and it is worth leaving the
 * correction visible: it argued the stored credential was safe because "the key still never reaches
 * the browser — decrypted, used for one outbound call, and only model IDs come back". Every clause
 * of that is true, and none of it was the exposure. The key did not need to reach the browser; the
 * SERVER sent it wherever the request body's `baseUrl` pointed, so a principal who may never read
 * that key could have it delivered to a host they controlled. `stored-credential-probe.ts` is what
 * actually holds the boundary now. A correct sentence about the wrong boundary reads like a safety
 * argument and audits like one too.
 *
 * Authorization runs before the body is read, as the hand-written route did.
 */
export const listModelsRoute = defineJsonRoute<unknown, AdminExecutionListModelsResponse, ListModelsRouteDeps, AssistantRoutePrincipal>({
  method: "post",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution/models`,
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, authorize, context }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-execution" });
    const body = (input ?? {}) as ProbeRequestBody;
    const protocol = readOptionalString({ value: body.protocol, fallback: "" });
    const baseUrl = readOptionalString({ value: body.baseUrl, fallback: "" });
    const apiVersion = readOptionalString({ value: body.apiVersion, fallback: undefined });

    const protocolError = validateSupportedProtocol({ protocol });
    if (protocolError) throw new RouteRefusalError({ status: 400, body: protocolError });
    if (!baseUrl.trim()) throw new RouteRefusalError({ status: 400, body: { error: "baseUrl is required", code: "VALIDATION_ERROR" } });

    /**
     * Which key probes the provider, and WHERE that key is allowed to go — one chokepoint shared
     * with `test-connection.ts`. Runs AFTER the validation above, deliberately: a request that
     * cannot proceed must never cause the stored credential to be decrypted at all.
     *
     * A typed key always wins, and travels to the endpoint its owner named. Otherwise, and ONLY
     * when the caller explicitly opted in, the workspace's stored site credential is used — and
     * then it travels only to the endpoint the SERVER already recorded for it. A caller cannot
     * name a destination for a key ADR-058 forbids them to read; see
     * `stored-credential-probe.ts`'s header for the boundary and the residual path it leaves.
     *
     * The opt-in is the other load-bearing part and must not be softened into "empty key ⇒ use
     * the stored one". This route is shared: the admin execution screens call it for the ADMIN's
     * own key, and the AI Assistant tab calls it for the SITE's key. An implicit fallback would
     * mean an operator on one screen with an empty field silently probes — and discovers models
     * for — the other screen's credential, quietly crossing the exact boundary ADR-058 §5 exists
     * to make structural. Two keys stay two keys, including here, which is why they have two
     * separate flags rather than one.
     *
     * `principalId` comes from the session, never the body: it is what makes the admin branch
     * able to open only the caller's own row.
     */
    const credential = await resolveProbeCredential({
      deps, input: probeCredentialInput({ body, requestedBaseUrl: baseUrl, principalId: assistantPrincipalId({ context }) }),
    });
    if (!credential.ok) throw new RouteRefusalError({ status: 400, body: credential.failure });

    return ok({ value: await fetchListModelsResponse({ protocol: protocol as SupportedExecutionProtocol, credential, apiVersion, deps }) });
  },
});
