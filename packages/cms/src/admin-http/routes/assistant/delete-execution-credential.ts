import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's credential service, already bound to the workspace. */
export interface DeleteExecutionCredentialRouteDeps {
  /** Clears the calling admin's own stored key; resolves the credential view (never the key). */
  deleteExecutionCredential: (required: { principalId: string }) => Promise<unknown>;
}

/**
 * DELETE the calling admin's OWN BYOK execution credential — clears the stored key only.
 * `protocol`/`providerId`/`baseUrl`/`model`/`maxTokens` are left as they were (see the host
 * service's own doc). Idempotent: deleting an already-unset key is a normal 200.
 * No sealer/keyring involved, so this cannot fail on a misconfigured site key. Scoped to
 * `(workspace, authenticated principal)` — an admin can only ever clear their own row, so there is
 * no permission check beyond the session.
 */
export const deleteExecutionCredentialRoute = defineJsonRoute<undefined, { data: unknown }, DeleteExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "delete",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution-credential`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context }) => ok({ value: { data: await deps.deleteExecutionCredential({ principalId: assistantPrincipalId({ context }) }) } }),
});
