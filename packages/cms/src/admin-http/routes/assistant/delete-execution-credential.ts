import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { assistantActorId, type AssistantRoutePrincipal } from "./shared.js";

/** Clears the caller's own stored execution key and answers the safe view. Injected: the store is the host's. */
export type ExecutionCredentialClearFn = (required: { workspaceId: string; principalId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantDeleteExecutionCredentialRouteDeps {
  workspaceId: string;
  clearExecutionCredential: ExecutionCredentialClearFn;
}

/**
 * DELETE the calling admin's OWN BYOK execution credential — clears the stored key only; the
 * protocol/providerId/baseUrl/model/maxTokens metadata is left as it was. Idempotent: deleting an
 * already-unset key is a normal 200. No sealer/keyring involved, so this cannot fail on a
 * misconfigured site key. Scoped to `(workspaceId, session principal)` — an admin can only ever
 * clear their own row.
 */
export const assistantDeleteExecutionCredentialRoute = defineJsonRoute<Record<string, never>, { data: unknown }, AssistantDeleteExecutionCredentialRouteDeps, AssistantRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/execution-credential",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const principalId = assistantActorId({ context });
    return ok({ value: { data: await deps.clearExecutionCredential({ workspaceId: deps.workspaceId, principalId }) } });
  },
});
