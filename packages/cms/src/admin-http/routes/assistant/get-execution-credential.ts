import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's credential service, already bound to the workspace. */
export interface GetExecutionCredentialRouteDeps {
  /** The calling admin's own credential view — whether a key is set and a safe hint, never the key. */
  getExecutionCredential: (required: { principalId: string }) => Promise<unknown>;
}

/**
 * GET the calling admin's OWN BYOK execution credential — never the key itself, only whether one is
 * set and what it ends in. Scoped to `(workspace, authenticated principal)`: there is no
 * `:principalId` in the path and none accepted from the request — an admin can only ever read their
 * own row, by construction, not by an authorization check. Shape and error contract mirror
 * `get-site-credential.ts`: same `{ data }` envelope, same 404-on-workspace-mismatch. The safe hint uses a
 * server-only open that degrades to no hint, so this cannot fail on a misconfigured site key.
 */
export const getExecutionCredentialRoute = defineJsonRoute<undefined, { data: unknown }, GetExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: `${ASSISTANT_ROUTE_PREFIX}/execution-credential`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context }) => ok({ value: { data: await deps.getExecutionCredential({ principalId: assistantPrincipalId({ context }) }) } }),
});
