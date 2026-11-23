import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  assistantActorId, assistantBody, rejectAssistantError, type AssistantErrorMapping, type AssistantRoutePrincipal,
} from "./shared.js";

/** The 400 code for a malformed execution-credential body (this route's own and the host's validation rung). */
export const EXECUTION_CREDENTIAL_VALIDATION_CODE = "EXECUTION_CREDENTIAL_VALIDATION_ERROR";

/** The PUT fields, each optional: `undefined` means "leave alone"; `providerId: null` clears it. */
export interface ExecutionCredentialWriteInput {
  workspaceId: string;
  principalId: string;
  apiKey?: string | undefined;
  protocol?: string | undefined;
  providerId?: string | null | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  maxTokens?: number | undefined;
}

/** Seals and stores the caller's patch, answering the same safe view GET returns (never the key). Injected: the store is the host's. */
export type ExecutionCredentialWriteFn = (required: ExecutionCredentialWriteInput) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantPutExecutionCredentialRouteDeps {
  workspaceId: string;
  writeExecutionCredential: ExecutionCredentialWriteFn;
  /** The host's refusals for its store errors, in order: 400 validation, then 503 unconfigured store with the host's operator copy. */
  errorMappings: readonly AssistantErrorMapping[];
}

/** `maxTokens` and `providerId` each accept their own shape; every other field defaults to
 *  string-or-omitted (looked up via the `undefined` key below). */
const EXECUTION_CREDENTIAL_FIELD_VALIDATORS: Readonly<
  Record<string, { readonly ok: (required: { value: unknown }, optional?: Record<string, never>) => boolean; readonly message: string }>
> = {
  maxTokens: { ok: ({ value }) => value === undefined || typeof value === "number", message: "maxTokens must be a number" },
  providerId: {
    ok: ({ value }) => value === undefined || value === null || typeof value === "string",
    message: "providerId must be a string or null",
  },
};

/**
 * Validates one `PUT` body field's shape. Present-but-wrong-type is a REJECTION, same posture as the
 * site-credential PUT's identical check — an `undefined` field is "leave alone," but a present
 * malformed field must not be silently reinterpreted as "the caller sent nothing."
 *
 * @complexity O(1).
 */
function validateExecutionCredentialField({ field, value }: { field: string; value: unknown }, _optional = {}): void {
  const specific = EXECUTION_CREDENTIAL_FIELD_VALIDATORS[field];
  const ok = specific ? specific.ok({ value }) : value === undefined || typeof value === "string";
  if (ok) {
    return;
  }
  rejectRoute({ status: 400, error: specific ? specific.message : `${field} must be a string`, code: EXECUTION_CREDENTIAL_VALIDATION_CODE });
}

/** The write input from a validated body, scoped to the caller's own row. @complexity O(1). */
function toWriteInput({ deps, principalId, body }: { deps: { workspaceId: string }; principalId: string; body: Record<string, unknown> }, _optional: Record<string, never> = {}): ExecutionCredentialWriteInput {
  return {
    workspaceId: deps.workspaceId, principalId,
    apiKey: body.apiKey as string | undefined, protocol: body.protocol as string | undefined,
    providerId: body.providerId as string | null | undefined, baseUrl: body.baseUrl as string | undefined,
    model: body.model as string | undefined, maxTokens: body.maxTokens as number | undefined,
  };
}

/**
 * PUT (partial) the calling admin's OWN BYOK execution credential. Body:
 * `{ apiKey?, protocol?, providerId?, baseUrl?, model?, maxTokens? }` — omitted `apiKey` leaves the
 * stored key untouched; an empty string is rejected (DELETE clears the key). The response NEVER
 * echoes the key, only the same safe view GET returns.
 *
 * Scoped to `(workspaceId, session principal)` — an admin can only ever write their own row. Same
 * 3-outcome split as the site-credential PUT: 400 validation, 503 `SECRET_STORE_UNCONFIGURED`
 * (missing site key, checked before any write), 500 everything else.
 */
export const assistantPutExecutionCredentialRoute = defineJsonRoute<{ body: Record<string, unknown> }, { data: unknown }, AssistantPutExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution-credential",
  parse: (raw) => ok({ value: { body: assistantBody(raw.body) } }),
  handle: async ({ input, deps, context }) => {
    // The session is read before the body, as before: a missing principal is the redacted 500, not a 400.
    const principalId = assistantActorId({ context });
    for (const [field, value] of Object.entries(input.body)) {
      validateExecutionCredentialField({ field, value });
    }
    try {
      return ok({ value: { data: await deps.writeExecutionCredential(toWriteInput({ deps, principalId, body: input.body })) } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});
