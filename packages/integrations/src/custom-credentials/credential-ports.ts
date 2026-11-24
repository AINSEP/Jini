/**
 * @file The binding of the core credential request port over a host's EXISTING request functions
 * (the source-control write port is bound separately). Nothing here reimplements a request; each method
 * forwards to the same function the host's tool handlers call today, with the same dependencies, so
 * audit, egress, diagnostic, not-found and remedy-wording policy stay exactly where they are.
 */
import type {
  CredentialProbeInput,
  CredentialProbeStatus,
  CredentialVerification,
  CredentialedRequestErrorClass,
  CredentialedRequestOptional,
  CredentialedRequestPort,
  CredentialedRequestRequired,
  CredentialedRequestResult,
  CredentialedRequestTarget,
} from "@jini-ai/core/contracts/credentials";
import { EgressRefusedError } from "@jini-ai/platform/http/guarded";
import { CredentialedRequestTransportError, CredentialedRequestValidationError } from "../credentialed-http/credentialed-request.js";
import { CustomCredentialNotFoundError } from "../credentialed-http/sets/store.js";

/** Classify by the classes the request adapter actually throws; the thrown object is returned as is.
 * The egress rebuild is the one the host's tool registrations perform before schema decoration.
 * @complexity O(1) — at most four `instanceof` checks.
 */
export function classifyCredentialedRequestError({ error }: { error: unknown }, _optional = {}): CredentialedRequestErrorClass {
  if (error instanceof EgressRefusedError) {
    const callerSafeMessage = error.callerSafeMessage;
    return { category: "egress-refused", error, callerSafeMessage, callerSafeError: new EgressRefusedError({ message: callerSafeMessage }, { callerSafeMessage }) };
  }
  if (error instanceof CredentialedRequestValidationError) return { category: "validation", error, callerSafeMessage: error.message };
  if (error instanceof CustomCredentialNotFoundError) return { category: "not-found", error, callerSafeMessage: error.message };
  if (error instanceof CredentialedRequestTransportError) return { category: "transport", error };
  return { category: "unknown", error };
}

/** The host's existing request functions, each taking the host's own dependency bag first. */
export interface CredentialedRequestHostOperations<Deps extends { readonly repo: unknown; readonly httpClient: unknown }> {
  makeCredentialedRequest(deps: Deps, input: CredentialedRequestRequired & { readonly headers: CredentialedRequestOptional["headers"] | undefined; readonly body: CredentialedRequestOptional["body"] | undefined }): Promise<CredentialedRequestResult>;
  resolveRequestTarget(deps: { readonly repo: Deps["repo"] }, input: { readonly workspaceId: string; readonly label: string; readonly url: string }): Promise<CredentialedRequestTarget>;
  verifyCustomCredential(deps: Deps, input: { readonly workspaceId: string; readonly label: string }): Promise<CredentialVerification>;
  probeCredentialConnection(input: CredentialProbeInput, options: { readonly httpClient: Deps["httpClient"] }): Promise<CredentialProbeStatus>;
}

/** Bind the request port over the host's existing adapter and its composition-built dependencies.
 * @param required.deps The SAME dependencies the host's tool handlers build (repo, sealer, guarded
 *   client, clock, audit, auth-scheme loader).
 * @param required.operations The host's existing request functions those dependencies feed.
 * @returns A port whose every call is one call of the existing adapter function.
 * @complexity O(1) to build; each method costs exactly what the forwarded function costs.
 * @example const port = bindCredentialedRequestPort({ deps, operations }); await port.verify({ workspaceId, label });
 */
export function bindCredentialedRequestPort<Deps extends { readonly repo: unknown; readonly httpClient: unknown }>(
  required: { deps: Deps; operations: CredentialedRequestHostOperations<Deps> }, _optional = {},
): CredentialedRequestPort {
  const { deps, operations } = required;
  return {
    request: (input, optional = {}) => operations.makeCredentialedRequest(deps, { ...input, headers: optional.headers, body: optional.body }),
    resolveTarget: (input) => operations.resolveRequestTarget({ repo: deps.repo }, input),
    verify: (input) => operations.verifyCustomCredential(deps, input),
    probe: (input) => operations.probeCredentialConnection(input, { httpClient: deps.httpClient }),
    classifyError: classifyCredentialedRequestError,
  };
}
