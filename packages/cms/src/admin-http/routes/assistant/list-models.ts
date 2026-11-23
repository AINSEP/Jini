import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AssistantListModelsResponseDto } from "@jini-ai/core/contracts/site/cms-assistant";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { SupportedExecutionProtocol } from "./execution-request-fields.js";
import {
  authorizeAssistantExecution, executionActorId, probeCredentialRequest, readProbeRequestFields, resolveProbeCredentialOrReject,
  supportedProtocolOrReject, type AssistantExecutionRoutePrincipal, type ProbeRequestFields, type ResolveProbeCredentialFn,
} from "./execution-shared.js";

/** What the host's model-list probe answers (a structural subset of the runtime's response). */
export interface ListModelsProbeResult {
  ok: boolean;
  kind?: string;
  detail?: string;
  models?: ReadonlyArray<{ id: string }>;
}

/** The host's outbound model-list probe, with its own guarded transport (DNS + dispatcher seams) bound in. */
export type ListModelsFn = (
  required: { protocol: SupportedExecutionProtocol; baseUrl: string; apiKey: string },
  optional?: { apiVersion?: string },
) => Promise<ListModelsProbeResult>;

/** The deps this route reads. `noServerKeyMessage` is host copy: where that host keeps keys. */
export interface AssistantListModelsRouteDeps {
  workspaceId: string;
  manageAssistantPermission: string;
  noServerKeyMessage: string;
  resolveProbeCredential: ResolveProbeCredentialFn;
  listModels: ListModelsFn;
}

/**
 * Calls the injected probe and shapes its result into this route's response body — isolated so the
 * two `?? []`/spread-if-present shapes don't add to the handler's own branching. An empty-key auth
 * failure is answered with the host's own copy instead of the runtime's host-neutral one.
 *
 * @complexity O(n) in the returned model count (one `.map()`).
 */
async function fetchListModelsResponse(
  { protocol, credential, apiVersion, deps }: {
    protocol: SupportedExecutionProtocol; credential: { apiKey: string; baseUrl: string }; apiVersion: string | undefined; deps: AssistantListModelsRouteDeps;
  },
  _optional = {},
): Promise<AssistantListModelsResponseDto> {
  const result = await deps.listModels({ protocol, baseUrl: credential.baseUrl, apiKey: credential.apiKey }, apiVersion ? { apiVersion } : {});
  const missingKey = result.kind === "auth_failed" && !credential.apiKey.trim();
  const message = missingKey ? deps.noServerKeyMessage : result.detail;
  return {
    ok: result.ok,
    models: (result.models ?? []).map((model) => model.id),
    ...(message ? { message } : {}),
  };
}

/**
 * POST live-discovers a BYOK provider's model catalog. The outbound call is server-side so the key
 * stays out of the browser's cross-origin fetch and the SSRF guard runs against a server-resolved
 * base URL. The body's `apiKey` is used for this one call and never persisted.
 *
 * Validation runs after authorization (as the hand-written route did), then the host's credential
 * chokepoint decides which key probes and WHERE it may go — deliberately last: a request that cannot
 * proceed must never cause the stored credential to be decrypted at all. The two stored-credential
 * opt-ins stay explicit and separate and must not be softened into "empty key ⇒ use the stored one":
 * this route is shared by screens probing two different keys, and an implicit fallback would let an
 * operator with an empty field silently probe the other screen's credential. `principalId` comes from
 * the session, never the body: it is what scopes the admin branch to the caller's own row.
 */
export const assistantListModelsRoute = defineJsonRoute<ProbeRequestFields, AssistantListModelsResponseDto, AssistantListModelsRouteDeps, AssistantExecutionRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution/models",
  parse: (raw) => ok({ value: readProbeRequestFields({ rawBody: raw.body }) }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeAssistantExecution({ authorize, permission: deps.manageAssistantPermission });
    const principalId = executionActorId({ context });
    const protocol = supportedProtocolOrReject({ protocol: input.protocol });
    if (!input.baseUrl.trim()) rejectRoute({ status: 400, error: "baseUrl is required", code: "VALIDATION_ERROR" });
    const credential = await resolveProbeCredentialOrReject({
      resolve: deps.resolveProbeCredential, request: probeCredentialRequest({ fields: input, principalId }),
    });
    return ok({ value: await fetchListModelsResponse({ protocol, credential, apiVersion: input.apiVersion, deps }) });
  },
});
