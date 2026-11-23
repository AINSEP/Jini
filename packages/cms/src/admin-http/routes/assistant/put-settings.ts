import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  assistantActorId, assistantBody, authorizeAssistant, rejectAssistantError, type AssistantErrorMapping, type AssistantRoutePrincipal,
} from "./shared.js";

/**
 * Validates and writes a partial public-assistant settings patch, then answers the settings as they
 * now read. Injected: the settings ledger and its per-key authorization are the host's.
 */
export type AssistantSettingsWriteFn = (required: { workspaceId: string; patch: unknown; callerPrincipalId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantPutSettingsRouteDeps {
  workspaceId: string;
  assistantSettingsReady: PromiseLike<unknown>;
  managePermission: string;
  writeAssistantSettings: AssistantSettingsWriteFn;
  /** The host's refusals for its own validation errors (400), in order. */
  errorMappings: readonly AssistantErrorMapping[];
}

/**
 * PUT (partial) the workspace's `site.assistant.*` settings — the route the admin's AI Assistant
 * screen flips the public switch through. Same auth gate as the matching GET, same `{ data }`
 * envelope, same 400-on-validation / 500-on-everything-else split, and it returns the settings AS
 * THEY NOW READ so the client renders the persisted truth rather than the value it optimistically sent.
 */
export const assistantPutSettingsRoute = defineJsonRoute<{ patch: unknown }, { data: unknown }, AssistantPutSettingsRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/settings",
  parse: (raw) => ok({ value: { patch: assistantBody(raw.body) } }),
  handle: async ({ input, deps, context, authorize }) => {
    await deps.assistantSettingsReady;
    await authorizeAssistant({ authorize, permission: deps.managePermission });
    const callerPrincipalId = assistantActorId({ context });
    try {
      return ok({ value: { data: await deps.writeAssistantSettings({ workspaceId: deps.workspaceId, patch: input.patch, callerPrincipalId }) } });
    } catch (err) {
      return rejectAssistantError({ err, mappings: deps.errorMappings });
    }
  },
});
