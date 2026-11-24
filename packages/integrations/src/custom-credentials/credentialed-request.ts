/**
 * @file The host's custom-credential request operations over the guarded credentialed-http pipeline.
 * `credentialed-http` owns validation, header injection, response redaction and audit-entry shape; this
 * module binds that pipeline to a host's saved-credential store, its HTTP client ABI, its egress-refusal
 * class and its remedy wording, and returns the `(deps, input)` operations that
 * `bindCredentialedRequestPort` (`./credential-ports.ts`) consumes as `operations`.
 */
import type { Clock, HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { CredentialSchemeRule } from "../credentialed-http/auth-schemes.js";
import type { CredentialTarget, ResolvedCredential } from "../credentialed-http/ports.js";
import {
  CredentialNotFoundError,
  CredentialedRequestValidationError,
  makeCredentialedRequest as requestWithCredential,
  probeCredentialConnection as probeConnection,
  resolveRequestTarget as resolveCredentialTarget,
  verifyCustomCredential as verifyCredential,
  type AuthFailureDiagnostic,
  type CredentialConnectionProbeInput,
  type CredentialConnectionProbeStatus,
  type CredentialedRequestAuditEntry,
  type CredentialedRequestDeps,
  type CredentialedRequestExecutedResult,
  type CredentialedRequestOptions,
  type CustomCredentialVerificationResult,
  type MakeCredentialedRequestInput,
} from "../credentialed-http/credentialed-request.js";
import { CustomCredentialNotFoundError } from "../credentialed-http/sets/store.js";
import type { EgressRefusedErrorClass } from "./credential-ports.js";

/** The host's dependency bag: its store `repo`, its guarded `httpClient`, a clock, an optional
 * positional audit sink and its installed auth-scheme loader. Extra fields (a sealer) pass through. */
export interface CustomCredentialRequestHostDeps {
  readonly repo: unknown;
  readonly httpClient: unknown;
  readonly clock: Clock;
  readonly audit?: { record(entry: CredentialedRequestAuditEntry): void };
  readonly loadAuthSchemes: (ctx: { readonly workspaceId: string }) => Promise<readonly CredentialSchemeRule[]>;
}

/** What the host injects: its store reads, its client's send, its egress class, its default audit sink
 * and the remedy sentence appended to a saved-hosts refusal. */
export interface CustomCredentialRequestHost<Deps extends CustomCredentialRequestHostDeps> {
  /** Non-decrypting label lookup (origins only). */
  readonly describe: (deps: Pick<Deps, "repo">, input: { workspaceId: string; label: string }) => Promise<CredentialTarget | null>;
  /** Decrypting label lookup through the host's sealed store. */
  readonly resolve: (deps: Deps, input: { workspaceId: string; label: string }) => Promise<ResolvedCredential | null>;
  /** One send through the host's guarded client, forwarding the redirect policy unchanged. */
  readonly send: (required: { httpClient: Deps["httpClient"]; request: HttpRequest }, optional?: Parameters<HttpClientPort["send"]>[1]) => Promise<HttpResponse>;
  readonly EgressRefusedError: EgressRefusedErrorClass;
  /** The audit sink used when `deps.audit` is omitted. */
  readonly defaultAudit: () => { record(entry: CredentialedRequestAuditEntry): void };
  /** Appended (after " — ") to a "not one of this credential's saved hosts" refusal. */
  readonly savedHostRemedy: string;
}

/** The host's request input: the pipeline's required fields plus optional headers/body. */
export type CustomCredentialRequestInput = MakeCredentialedRequestInput & Pick<CredentialedRequestOptions, "headers" | "body">;

/** The four `(deps, input)` operations a host exposes to its tool handlers. */
export interface CustomCredentialRequestOperations<Deps extends CustomCredentialRequestHostDeps> {
  readonly makeCredentialedRequest: (deps: Deps, input: CustomCredentialRequestInput) => Promise<CredentialedRequestExecutedResult>;
  readonly resolveRequestTarget: (deps: Pick<Deps, "repo">, input: { workspaceId: string; label: string; url: unknown }) => Promise<{ label: string; url: URL }>;
  readonly verifyCustomCredential: (deps: Deps, input: { workspaceId: string; label: unknown }) => Promise<CustomCredentialVerificationResult>;
  readonly probeCredentialConnection: (required: CredentialConnectionProbeInput, options: { httpClient: Deps["httpClient"] }) => Promise<CredentialConnectionProbeStatus>;
}

/** Translate body/audit arguments without changing the guarded transport or plugin trust gates. */
function adaptRequestDeps<Deps extends CustomCredentialRequestHostDeps>({ deps, host }: { deps: Deps; host: CustomCredentialRequestHost<Deps> }, _optional = {}): CredentialedRequestDeps {
  const audit = deps.audit ?? host.defaultAudit();
  return {
    // The describe path never decrypts; resolve uses the existing host AAD/store boundary.
    resolver: { describe: (input) => host.describe({ repo: deps.repo }, input), resolve: (input) => host.resolve(deps, input) },
    // Forward the policy so a pre-save probe cannot follow redirects through the legacy host ABI.
    httpClient: { send: ({ request }, options) => host.send({ httpClient: deps.httpClient, request }, options) },
    clock: deps.clock,
    audit: { record: ({ entry }) => audit.record(entry) },
    // Keep installed-plugin digest trust checks in the host; generic scheme precedence needs no
    // provider catalog. One loaded rule set is shared by header building and failure diagnostics.
    schemeRegistry: {
      load: async (input) => deps.loadAuthSchemes(input),
    },
  };
}

/** Return authentication facts without inferring a provider's required scheme from a 401.
 * The credential recovery adapter owns secure token rotation; only provider documentation can
 * establish a need for Basic authentication. Pure, O(1) time and space.
 */
function mapDiagnostic({ diagnostic }: { diagnostic: AuthFailureDiagnostic }, _optional = {}): AuthFailureDiagnostic {
  return { schemeSent: diagnostic.schemeSent, usernameStored: diagnostic.usernameStored };
}

// An egress refusal is a caller-fixable target rejection, not a DNS/timeout crash. Preserve its
// instanceof identity so the tool layer can publish the safe reason instead of INTERNAL_ERROR.
function requestPolicy({ EgressRefusedError }: { EgressRefusedError: EgressRefusedErrorClass }, _optional = {}): CredentialedRequestOptions {
  return {
    errorPolicy: {
      isEgressRefusal: ({ error }) => error instanceof EgressRefusedError,
      describeEgressRefusal: ({ error }) => error instanceof EgressRefusedError ? error.message : "",
    },
    diagnosticMapper: mapDiagnostic,
  };
}

/** Keep the store's not-found identity and the host's remedy wording at the adapter boundary. */
function rethrowHostError({ error, savedHostRemedy }: { error: unknown; savedHostRemedy: string }, _optional = {}): never {
  if (error instanceof CredentialNotFoundError) throw new CustomCredentialNotFoundError(error.message);
  if (error instanceof CredentialedRequestValidationError && error.message.includes("which is not one of this credential's saved hosts (")) {
    throw new CredentialedRequestValidationError({ message: `${error.message} — ${savedHostRemedy}` });
  }
  throw error;
}

/** Bind the credentialed-http pipeline to a host's store, client, egress class and remedy wording.
 * @param required.host Everything host-specific (see {@link CustomCredentialRequestHost}).
 * @returns `resolveRequestTarget` (non-decrypting DELETE-target check), `verifyCustomCredential`,
 *   `makeCredentialedRequest` and `probeCredentialConnection`, each `(deps, input)`.
 * @complexity O(1) to build; each operation costs one store read plus at most one bounded HTTP request.
 * @example const ops = bindCustomCredentialRequestOperations({ host }); await ops.verifyCustomCredential(deps, { workspaceId, label });
 */
export function bindCustomCredentialRequestOperations<Deps extends CustomCredentialRequestHostDeps>(
  { host }: { host: CustomCredentialRequestHost<Deps> }, _optional = {},
): CustomCredentialRequestOperations<Deps> {
  const policy = requestPolicy({ EgressRefusedError: host.EgressRefusedError });
  const rethrow = (error: unknown): never => rethrowHostError({ error, savedHostRemedy: host.savedHostRemedy });
  return {
    // DELETE confirmation validates and renders its target without decryption: a human's "no" must not
    // cost a secret read. The persisted base URL/additional hosts alone define what can be requested.
    resolveRequestTarget: async (deps, input) => {
      try {
        return await resolveCredentialTarget({ resolver: { describe: (required) => host.describe({ repo: deps.repo }, required) }, input });
      } catch (error) { return rethrow(error); }
    },
    verifyCustomCredential: async (deps, input) => {
      try { return await verifyCredential({ deps: adaptRequestDeps({ deps, host }), input }, policy); }
      catch (error) { return rethrow(error); }
    },
    // The host gates DELETE with its own confirmation; GET/POST/PUT/PATCH retain parity with site
    // operations without a plan/confirm/execute ceremony. This adapter executes only after its
    // caller's policy allows it and deliberately has no independent confirmation state.
    makeCredentialedRequest: async (deps, input) => {
      const { headers, body, ...requiredInput } = input;
      try {
        return await requestWithCredential({ deps: adaptRequestDeps({ deps, host }), input: requiredInput }, { ...policy, headers, body });
      } catch (error) { return rethrow(error); }
    },
    // Adapt the guarded host client to the bodyless, redirect-refusing GET probe; no transport error
    // or response body escapes.
    probeCredentialConnection: (required, options) =>
      probeConnection({ ...required, httpClient: { send: ({ request }, redirectPolicy) => host.send({ httpClient: options.httpClient, request }, redirectPolicy) } }),
  };
}
