import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  ASSISTANT_ROUTE_PREFIX, authorizeAssistant, credentialRefusal, rejectNonStringFields,
  type AssistantCredentialErrorKind, type AssistantPermissionDeps, type AssistantRoutePrincipal,
} from "./shared.js";

/** The PUT body, every field optional; `undefined` means "leave alone". */
export interface SiteCredentialPatch { apiKey?: string | undefined; provider?: string | undefined; baseUrl?: string | undefined; model?: string | undefined }

/** What this route reads: the host's site-credential service, its error classifier and its copy. */
export interface PutSiteCredentialRouteDeps extends AssistantPermissionDeps {
  /** Writes the workspace's site credential; resolves the same view GET returns (never the key). */
  setSiteCredential: (required: { patch: SiteCredentialPatch }) => Promise<unknown>;
  /** Classifies a service failure; `undefined` means unexpected (the host's redacted 500). */
  siteCredentialErrorKind: (error: unknown) => AssistantCredentialErrorKind | undefined;
  /** The 503 sentence naming the deployment's missing site-key setting. */
  secretStoreUnconfiguredError: string;
}

const VALIDATION_CODE = "SITE_CREDENTIAL_VALIDATION_ERROR";

/**
 * PUT (partial) the workspace's SITE assistant credential. Body `{ apiKey?, provider?, baseUrl?,
 * model? }` — an omitted `apiKey` leaves the stored key untouched; an empty string is rejected
 * (DELETE clears the key). The response NEVER echoes the key, only the same view GET returns.
 * 400 `SITE_CREDENTIAL_VALIDATION_ERROR`, 503 `SECRET_STORE_UNCONFIGURED`, 500 everything else.
 * Authorization runs before body validation.
 *
 * Three outcomes, not two: the 503 sits on top of the usual 400-validation/500-other split — a
 * missing site key is a distinct, actionable operator error, not a generic 500, and not a
 * validation problem with the request body.
 */
export const putSiteCredentialRoute = defineJsonRoute<Record<string, unknown>, { data: unknown }, PutSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: `${ASSISTANT_ROUTE_PREFIX}/site-credential`,
  parse: (raw) => ok({ value: (raw.body ?? {}) as Record<string, unknown> }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-settings" });
    // Present-but-not-a-string is a REJECTION here, same as the service's own check for
    // `provider`/`baseUrl`/`model` — an `undefined` field is "leave alone", but a present
    // non-string field (a stray `{apiKey: 12345}`) must not be silently reinterpreted as "the
    // caller sent nothing", which would leave a bad request looking like a no-op success.
    rejectNonStringFields({ body: input, code: VALIDATION_CODE });
    try {
      const { apiKey, provider, baseUrl, model } = input as SiteCredentialPatch;
      return ok({ value: { data: await deps.setSiteCredential({ patch: { apiKey, provider, baseUrl, model } }) } });
    } catch (error) {
      throw credentialRefusal({ error, kind: deps.siteCredentialErrorKind(error), validationCode: VALIDATION_CODE, unconfiguredError: deps.secretStoreUnconfiguredError });
    }
  },
});
