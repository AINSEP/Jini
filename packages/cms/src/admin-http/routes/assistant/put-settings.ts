import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import {
  ASSISTANT_ROUTE_PREFIX, assistantPrincipalId, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal,
} from "./shared.js";

/** What this route reads: the host's public-assistant settings write and its validation classifier. */
export interface PutAssistantSettingsRouteDeps extends AssistantPermissionDeps {
  /** Settles once the settings definitions are registered; awaited before anything else. */
  assistantSettingsReady: Promise<unknown>;
  /** Applies `patch` through the host's settings write chokepoint as `callerPrincipalId`. */
  setPublicAssistantSettings: (required: { patch: unknown; callerPrincipalId: string }) => Promise<unknown>;
  /** True for the host's settings validation failures (answered 400 with their message). */
  isSettingsValidationError: (error: unknown) => boolean;
}

/**
 * PUT (partial) the workspace's public-assistant settings. The body is the patch; a host that
 * mounts no JSON body parser hands `undefined`, which is the empty patch. 400
 * `ASSISTANT_SETTINGS_VALIDATION_ERROR` for a rejected value, 500 everything else.
 */
export const putAssistantSettingsRoute = defineJsonRoute<unknown, { data: unknown }, PutAssistantSettingsRouteDeps, AssistantRoutePrincipal>({
  method: "put",
  path: `${ASSISTANT_ROUTE_PREFIX}/settings`,
  parse: (raw) => ok({ value: raw.body ?? {} }),
  handle: async ({ input, deps, context, authorize }) => {
    await deps.assistantSettingsReady;
    const callerPrincipalId = assistantPrincipalId({ context });
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-settings" });
    try {
      return ok({ value: { data: await deps.setPublicAssistantSettings({ patch: input, callerPrincipalId }) } });
    } catch (error) {
      if (!deps.isSettingsValidationError(error)) throw error;
      throw new RouteRefusalError({ status: 400, body: { error: error instanceof Error ? error.message : String(error), code: "ASSISTANT_SETTINGS_VALIDATION_ERROR" } });
    }
  },
});
