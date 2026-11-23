import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import type { RuntimeAgentDef, RuntimeModelOption } from "@jini-ai/core/contracts/agents";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { readOptionalString, validateSupportedProtocol, type SupportedExecutionProtocol } from "./execution-request-fields.js";

/**
 * @file Shared guards, types and pure decisions for the four "Execution mode" probe route specs
 * (`detect-agents`, `list-models`, `test-agent`, `test-connection`).
 *
 * These routes hold no store of their own. They are stateless egress probes: detect local agent
 * CLIs on the server host, or make one outbound smoke-test/model-list request to a BYOK provider.
 * Every probe that touches a runtime, a subprocess or the network is a host collaborator injected
 * as a required deps function; the specs keep parsing, authorization, refusal mapping and the
 * response shape.
 */

/** The principal fields these routes read: only the id, which scopes the admin-credential probe. */
export interface AssistantExecutionRoutePrincipal { id: string }

/** The one entity type every execution probe authorizes against. */
export const ASSISTANT_EXECUTION_ENTITY_TYPE = "assistant-execution";

/**
 * Asks for the host's assistant-management permission on `assistant-execution`. Probes act on no
 * single entity, so no `entityId` scope is sent. A mount without an authorizer is a wiring bug, not
 * a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeAssistantExecution(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("assistant execution route has no authorizer");
  await authorize({ permission, entityType: ASSISTANT_EXECUTION_ENTITY_TYPE });
}

/** The authenticated principal's id. @complexity O(1). */
export function executionActorId(
  { context }: { context: AssistantExecutionRoutePrincipal | undefined },
  _optional: Record<string, never> = {},
): string {
  if (!context) throw new Error("assistant execution route has no authenticated principal");
  return context.id;
}

/**
 * The fields of a detected code-agent CLI these routes read — a structural subset of the agent
 * runtime's `DetectedAgent`, so this package needs no dependency on the runtime itself.
 */
export type ExecutionDetectedAgent = Pick<RuntimeAgentDef, "id" | "name" | "reasoningOptions" | "reasoningInModelId"> & {
  available: boolean;
  version?: string | null;
  path?: string;
  models?: RuntimeModelOption[];
  modelsSource?: "live" | "fallback";
  authStatus?: "ok" | "missing" | "unknown";
  authMessage?: string;
};

/** A rejection from the host's stored-credential chokepoint: the flat 400 body, never the key. */
export interface ProbeCredentialRejection { error: string; code: string }

/** Which `(apiKey, baseUrl)` pair a BYOK probe sends, or the 400 the host's chokepoint answers instead. */
export type ProbeCredentialResolution =
  | { ok: true; apiKey: string; baseUrl: string }
  | { ok: false; failure: ProbeCredentialRejection };

/** The request facts the host's credential chokepoint decides from. `principalId` is the session's, never the body's. */
export interface ProbeCredentialRequest {
  requestedBaseUrl: string;
  typedKey: string;
  useStoredCredential: boolean;
  useAdminStoredCredential: boolean;
  principalId: string;
}

/** The host's single chokepoint deciding WHICH key a BYOK probe sends and WHERE it may send it. */
export type ResolveProbeCredentialFn = (required: ProbeCredentialRequest, optional?: Record<string, never>) => Promise<ProbeCredentialResolution>;

/** The body fields both BYOK probes (`list-models`, `test-connection`) read, already narrowed. */
export interface ProbeRequestFields {
  protocol: string;
  baseUrl: string;
  apiVersion: string | undefined;
  /** The key from the request body, if any. Non-empty always wins at the host's chokepoint. */
  typedKey: string;
  /** Opt in to probing with the workspace's STORED site credential instead of a key in this body. */
  useStoredCredential: boolean;
  /** Opt in to probing with the CALLING ADMIN's OWN stored execution credential. A different key
   *  from `useStoredCredential`'s, so the two stay separate flags. */
  useAdminStoredCredential: boolean;
}

/**
 * Reads the shared probe fields off an untyped body: strings verbatim, anything else to its
 * fallback; each stored-credential opt-in only as a strict `true`. Never refuses — validation
 * runs after authorization in `handle`, as it did before.
 * @complexity O(1).
 */
export function readProbeRequestFields(rawBody: unknown, _optional: Record<string, never> = {}): ProbeRequestFields {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    protocol: readOptionalString({ value: body.protocol, fallback: "" }),
    baseUrl: readOptionalString({ value: body.baseUrl, fallback: "" }),
    apiVersion: readOptionalString({ value: body.apiVersion, fallback: undefined }),
    typedKey: readOptionalString({ value: body.apiKey, fallback: "" }),
    useStoredCredential: body.useStoredCredential === true,
    useAdminStoredCredential: body.useAdminStoredCredential === true,
  };
}

/** Refuses an unsupported provider protocol with the shared flat 400 body; narrows it otherwise. @complexity O(1). */
export function supportedProtocolOrReject({ protocol }: { protocol: string }, _optional: Record<string, never> = {}): SupportedExecutionProtocol {
  const protocolError = validateSupportedProtocol({ protocol });
  if (protocolError) rejectRoute({ status: 400, ...protocolError });
  return protocol as SupportedExecutionProtocol;
}

/** The credential request a probe sends: body facts plus the SESSION principal, never one from the body. @complexity O(1). */
export function probeCredentialRequest(
  { fields, principalId }: { fields: ProbeRequestFields; principalId: string },
  _optional: Record<string, never> = {},
): ProbeCredentialRequest {
  return {
    requestedBaseUrl: fields.baseUrl, typedKey: fields.typedKey,
    useStoredCredential: fields.useStoredCredential, useAdminStoredCredential: fields.useAdminStoredCredential, principalId,
  };
}

/**
 * Resolves the probe credential, or refuses with the chokepoint's own 400 body. Runs only after a
 * request's own validation, deliberately: a request that cannot proceed must never cause a stored
 * credential to be decrypted at all.
 * @complexity O(1) plus the injected chokepoint.
 */
export async function resolveProbeCredentialOrReject(
  { resolve, request }: { resolve: ResolveProbeCredentialFn; request: ProbeCredentialRequest },
  _optional: Record<string, never> = {},
): Promise<{ apiKey: string; baseUrl: string }> {
  const credential = await resolve(request);
  if (!credential.ok) rejectRoute({ status: 400, error: credential.failure.error, code: credential.failure.code });
  return { apiKey: credential.apiKey, baseUrl: credential.baseUrl };
}

export type TestAgentOutcome = { ok: boolean; message: string };

/** Formats "<name> <version>" (version omitted when unknown), trimmed. @complexity O(1). */
function describeAgent(agent: ExecutionDetectedAgent): string {
  return `${agent.name} ${agent.version ?? ""}`.trim();
}

/**
 * True when the operator's saved model pick no longer appears in the agent's current model list.
 * See the caller's own comment for why this is checked separately from auth status.
 *
 * @complexity O(models on the agent).
 */
function modelNoLongerOffered({ agent, model }: { agent: ExecutionDetectedAgent; model: string }, _optional = {}): boolean {
  return Boolean(model && agent.models?.length && !agent.models.some((option) => option.id === model));
}

/**
 * Pure decision logic behind the test-agent route — split out of the route handler so the
 * installed/authenticated/model-mismatch/success branches (everything AFTER "the CLI was found on
 * PATH") can be unit-tested directly against fabricated detected-agent objects, with no PATH scan,
 * no subprocess and no module mock, so all four branches are deterministic regardless of host.
 *
 * Only called once `agent` is already known non-null and `agent.available` — the route's own
 * "not found on this server's PATH" branch is unaffected.
 */
export function resolveTestAgentOutcome({ agent, model }: { agent: ExecutionDetectedAgent; model: string }, _optional = {}): TestAgentOutcome {
  if (agent.authStatus === "missing") {
    return {
      ok: false,
      message: agent.authMessage ?? `${agent.name} is installed but not authenticated.`,
    };
  }

  if (agent.authStatus === "unknown") {
    // Not a failure: the adapter declares no auth probe, or its probe could not be classified.
    // Saying "ready" would overstate what was checked, so the message says exactly what was and
    // was not verified.
    return {
      ok: true,
      message: describeAgent(agent) + " responded, but its sign-in status could not be verified.",
    };
  }

  // The caller sends the operator's current per-agent model pick, so check it. A saved selection
  // survives a model list changing under it (the card deliberately keeps a stale pick selectable
  // rather than silently snapping to another model), which means "the CLI is authenticated" and
  // "the model you chose still exists" are different questions. Answering only the first with a
  // green result would tell the operator a run will work when it cannot.
  if (modelNoLongerOffered({ agent, model })) {
    return {
      ok: false,
      message:
        `${agent.name} is installed and authenticated, but it no longer offers the model '${model}'. ` +
        "Pick a different model, or Rescan to refresh the list.",
    };
  }

  return {
    ok: true,
    message: describeAgent(agent) + (model ? ` is installed and authenticated, and offers '${model}'.` : " is installed and authenticated."),
  };
}
