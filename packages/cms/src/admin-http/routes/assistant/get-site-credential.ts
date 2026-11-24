import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeAssistant, type AssistantRoutePrincipal } from "./shared.js";

/** Reads the site credential's safe view (`isSet`, mask, metadata — never the key). Injected: the sealed store is the host's. */
export type SiteCredentialReadFn = (required: { workspaceId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantGetSiteCredentialRouteDeps {
  workspaceId: string;
  managePermission: string;
  readSiteCredential: SiteCredentialReadFn;
}

/**
 * GET the workspace's SITE assistant credential — never the key itself, only whether one is set and
 * what it ends in. Same auth gate and `{ data }` envelope as the settings GET. The safe length hint
 * is derived by a server-only open; an open failure still leaves metadata readable, so this route
 * cannot fail on a misconfigured site key the way PUT can.
 */
export const assistantGetSiteCredentialRoute = defineJsonRoute<Record<string, never>, { data: unknown }, AssistantGetSiteCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/site-credential",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeAssistant({ authorize, permission: deps.managePermission });
    return ok({ value: { data: await deps.readSiteCredential({ workspaceId: deps.workspaceId }) } });
  },
});
