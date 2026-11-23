import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, credentialRefusal, rejectNonStringFields,
  type AssistantCredentialErrorKind, type AssistantRoutePrincipal,
} from "./shared.js";

/** The PUT body, every field optional; `undefined` means "leave alone". */
export interface ExecutionCredentialPatch {
  apiKey?: string | undefined; protocol?: string | undefined; providerId?: string | null | undefined;
  baseUrl?: string | undefined; model?: string | undefined; maxTokens?: number | undefined;
}

/** What this route reads: the host's credential service, its error classifier and its copy. */
export interface PutExecutionCredentialRouteDeps {
  /** Writes the calling admin's own row; resolves the same view GET returns (never the key). */
  setExecutionCredential: (required: { principalId: string; patch: ExecutionCredentialPatch }) => Promise<unknown>;
  /** Classifies a service failure; `undefined` means unexpected (the host's redacted 500). */
  executionCredentialErrorKind: (error: unknown) => AssistantCredentialErrorKind | undefined;
  /** The 503 sentence naming the deployment's missing site-key setting. */
  secretStoreUnconfiguredError: string;
}

const VALIDATION_CODE = "EXECUTION_CREDENTIAL_VALIDATION_ERROR";

/** `maxTokens` and `providerId` each accept their own shape; every other field defaults to
 *  string-or-omitted. */
const EXECUTION_CREDENTIAL_FIELD_VALIDATORS = {
  maxTokens: { ok: (value: unknown) => value === undefined || typeof value === "number", message: "maxTokens must be a number" },
  providerId: { ok: (value: unknown) => value === undefined || value === null || typeof value === "string", message: "providerId must be a string or null" },
} as const;

/**
 * PUT (partial) the calling admin's OWN BYOK execution credential. Body:
 * `{ apiKey?, protocol?, providerId?, baseUrl?, model?, maxTokens? }` — omitted `apiKey` leaves the
 * stored key untouched; an empty string is rejected (DELETE clears the key). The response NEVER
 * echoes the key, only the same view GET returns.
 *
 * Present-but-wrong-type is a REJECTION, same posture as `put-site-credential.ts` — an `undefined`
 * field is "leave alone," but a present malformed field must not be silently reinterpreted as "the
 * caller sent nothing." Scoped to `(workspace, authenticated principal)`. Same 3-outcome split as
 * `put-site-credential.ts`: 400 validation, 503 `SECRET_STORE_UNCONFIGURED` (checked by the service
 * before any write), 500 everything else.
 */
export const putExecutionCredentialRoute = defineJsonRoute<ExecutionCredentialPatch, { data: unknown }, PutExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution-credential`,
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    rejectNonStringFields({ body, code: VALIDATION_CODE, exempt: EXECUTION_CREDENTIAL_FIELD_VALIDATORS });
    // Only the named fields reach the service; any other (validated) body key is ignored, as before the move.
    const { apiKey, protocol, providerId, baseUrl, model, maxTokens } = body as ExecutionCredentialPatch;
    return ok({ value: { apiKey, protocol, providerId, baseUrl, model, maxTokens } });
  },
  handle: async ({ input, deps, context }) => {
    const principalId = assistantPrincipalId({ context });
    try {
      return ok({ value: { data: await deps.setExecutionCredential({ principalId, patch: input }) } });
    } catch (error) {
      throw credentialRefusal({ error, kind: deps.executionCredentialErrorKind(error), validationCode: VALIDATION_CODE, unconfiguredError: deps.secretStoreUnconfiguredError });
    }
  },
});
