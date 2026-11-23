import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeAssistant, type AssistantRoutePrincipal } from "./shared.js";

/** Clears the stored site key and answers the safe view. Injected: the store is the host's. */
export type SiteCredentialClearFn = (required: { workspaceId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantDeleteSiteCredentialRouteDeps {
  workspaceId: string;
  managePermission: string;
  clearSiteCredential: SiteCredentialClearFn;
}

/**
 * DELETE the workspace's SITE assistant credential — clears the stored key only; provider/baseUrl/
 * model are left as they were. Idempotent: deleting an already-unset key is a normal 200, not a
 * 404 — this is "make sure no key is stored," not "a key must currently exist." No sealer/keyring
 * involved (clearing needs no decrypt), so this cannot fail on a misconfigured site key either.
 */
export const assistantDeleteSiteCredentialRoute = defineJsonRoute<Record<string, never>, { data: unknown }, AssistantDeleteSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/site-credential",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.managePermission });
    return ok({ value: { data: await deps.clearSiteCredential({ workspaceId: deps.workspaceId }) } });
  },
});
