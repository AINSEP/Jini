import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ASSISTANT_ROUTE_PREFIX, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's site-credential service, already bound to the workspace. */
export interface GetSiteCredentialRouteDeps extends AssistantPermissionDeps {
  /** The workspace's site credential view — whether a key is set and a safe hint, never the key. */
  getSiteCredential: () => Promise<unknown>;
}

/**
 * GET the workspace's SITE assistant credential — never the key itself, only whether one
 * is set and what it ends in. Shape and error contract copied from `get-settings.ts` in this same
 * directory: same auth gate, same `{ data }` envelope, same 404-on-workspace-mismatch. The safe length hint is derived
 * by a server-only open. An open failure still leaves metadata readable, so this route cannot
 * fail on a misconfigured site key the way PUT can.
 */
export const getSiteCredentialRoute = defineJsonRoute<undefined, { data: unknown }, GetSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: `${ASSISTANT_ROUTE_PREFIX}/site-credential`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-settings" });
    return ok({ value: { data: await deps.getSiteCredential() } });
  },
});
