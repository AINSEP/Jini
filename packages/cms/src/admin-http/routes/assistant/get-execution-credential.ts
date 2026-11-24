import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { assistantActorId, type AssistantRoutePrincipal } from "./shared.js";

/** Reads the caller's own execution credential safe view. Injected: the sealed store is the host's. */
export type ExecutionCredentialReadFn = (required: { workspaceId: string; principalId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantGetExecutionCredentialRouteDeps {
  workspaceId: string;
  readExecutionCredential: ExecutionCredentialReadFn;
}

/**
 * GET the calling admin's OWN BYOK execution credential — never the key itself, only whether one is
 * set and what it ends in. Scoped to `(workspaceId, session principal)`: there is no `:principalId`
 * in the path and none accepted from the request — an admin can only ever read their own row, by
 * construction, not by an authorization check. The safe hint uses a server-only open that degrades
 * to no hint, so this cannot fail on a misconfigured site key.
 */
export const assistantGetExecutionCredentialRoute = defineJsonRoute<Record<string, never>, { data: unknown }, AssistantGetExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution-credential",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const principalId = assistantActorId({ context });
    return ok({ value: { data: await deps.readExecutionCredential({ workspaceId: deps.workspaceId, principalId }) } });
  },
});
