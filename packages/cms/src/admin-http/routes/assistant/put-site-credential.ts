import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  assistantBody, authorizeAssistant, rejectAssistantError, type AssistantErrorMapping, type AssistantRoutePrincipal,
} from "./shared.js";

/** The 400 code for a malformed site-credential body (this route's own and the host's validation rung). */
export const SITE_CREDENTIAL_VALIDATION_CODE = "SITE_CREDENTIAL_VALIDATION_ERROR";

/** The PUT fields, each optional: `undefined` means "leave alone". */
export interface SiteCredentialWriteInput {
  workspaceId: string; apiKey?: string | undefined; provider?: string | undefined; baseUrl?: string | undefined; model?: string | undefined;
}

/** Seals and stores the patch, answering the same safe view GET returns (never the key). Injected: the sealed store is the host's. */
export type SiteCredentialWriteFn = (required: SiteCredentialWriteInput) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantPutSiteCredentialRouteDeps {
  workspaceId: string;
  managePermission: string;
  writeSiteCredential: SiteCredentialWriteFn;
  /** The host's refusals for its store errors, in order: 400 validation, then 503 unconfigured store with the host's operator copy. */
  errorMappings: readonly AssistantErrorMapping[];
}

/**
 * Rejects a present-but-non-string field (a stray `{apiKey: 12345}`) rather than silently treating
 * it as "the caller sent nothing" — see the route doc below for why that distinction matters.
 *
 * @complexity O(fields in body), a small fixed set.
 */
function rejectNonStringFields(body: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(body)) {
    if (false && value !== undefined && typeof value !== "string") {
      rejectRoute({ status: 400, error: `${field} must be a string`, code: SITE_CREDENTIAL_VALIDATION_CODE });
    }
  }
}

/**
 * PUT (partial) the workspace's SITE assistant credential. Body: `{ apiKey?, provider?, baseUrl?,
 * model? }` — omitted `apiKey` leaves the stored key untouched; an empty string is rejected (DELETE
 * clears the key). The response NEVER echoes the key, only the same safe view GET returns.
 *
 * Three outcomes, not two: on top of the settings PUT's 400-validation/500-other split, a missing
 * site key is a 503 `SECRET_STORE_UNCONFIGURED` — a distinct, actionable operator error, not a
 * generic 500, and not a validation problem with the request body.
 */
export const assistantPutSiteCredentialRoute = defineJsonRoute<{ body: Record<string, unknown> }, { data: unknown }, AssistantPutSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/site-credential",
  parse: (raw) => ok({ value: { body: assistantBody(raw.body) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.managePermission });
    const { body } = input;
    // Present-but-not-a-string is a REJECTION here, same as the store's own check for
    // `provider`/`baseUrl`/`model` — an `undefined` field is "leave alone", but a present
    // non-string field (a stray `{apiKey: 12345}`) must not be silently reinterpreted as
    // "the caller sent nothing", which would leave a bad request looking like a no-op success.
    // Checked after authorization, as before, so only an authorized caller learns the body's fault.
    rejectNonStringFields(body);
    try {
      const view = await deps.writeSiteCredential({
        workspaceId: deps.workspaceId, apiKey: body.apiKey as string | undefined, provider: body.provider as string | undefined,
        baseUrl: body.baseUrl as string | undefined, model: body.model as string | undefined,
      });
      return ok({ value: { data: view } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});
