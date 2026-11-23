import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ASSISTANT_ROUTE_PREFIX, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's site-credential service, already bound to the workspace. */
export interface DeleteSiteCredentialRouteDeps extends AssistantPermissionDeps {
  /** Clears the stored site key only; resolves the credential view. */
  deleteSiteCredential: () => Promise<unknown>;
}

/**
 * DELETE the workspace's SITE assistant credential — clears the stored key only.
 * `provider`/`baseUrl`/`model` are left as they were (see the host service's own
 * doc). Idempotent: deleting an already-unset key is a normal 200, not a 404 — this is "make sure no
 * key is stored," not "a key must currently exist." No sealer/keyring involved (clearing needs no
 * decrypt), so this cannot fail on a misconfigured site key either.
 */
export const deleteSiteCredentialRoute = defineJsonRoute<undefined, { data: unknown }, DeleteSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "delete",
  path: `${ASSISTANT_ROUTE_PREFIX}/site-credential`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-settings" });
    return ok({ value: { data: await deps.deleteSiteCredential() } });
  },
});
