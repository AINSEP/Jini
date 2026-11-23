import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { ASSISTANT_ROUTE_PREFIX, authorizeAssistant, type AssistantPermissionDeps, type AssistantRoutePrincipal } from "./shared.js";

/** What this route reads: the host's public-assistant settings read and its admin-assistant switch. */
export interface GetAssistantSettingsRouteDeps extends AssistantPermissionDeps {
  /** Settles once the settings definitions are registered; awaited before anything else. */
  assistantSettingsReady: Promise<unknown>;
  /** The workspace's public-assistant settings view. */
  getPublicAssistantSettings: () => Promise<unknown>;
  /** Whether the deployment's ADMIN assistant is switched on (not a workspace setting). */
  adminAssistantEnabled: boolean;
}

/**
 * GET the workspace's public-assistant settings — today, the public assistant's master on/off
 * switch, in the `{ data }` envelope with the 404-on-workspace-mismatch every admin route uses.
 *
 * Also returns a sibling `adminAssistantEnabled` field — the (unrelated) ADMIN assistant's own
 * deployment switch, NOT part of the public-assistant settings and deliberately not folded into
 * them. Piggy-backed onto this response rather than a new endpoint because the host mounts this
 * route UNCONDITIONALLY — gated assistant routes 404 with the switch off, so they cannot tell the
 * client anything, but this route always can. The admin client reads it to decide whether to mount
 * its own chat dock at all.
 */
export const getAssistantSettingsRoute = defineJsonRoute<undefined, { data: unknown; adminAssistantEnabled: boolean }, GetAssistantSettingsRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: `${ASSISTANT_ROUTE_PREFIX}/settings`,
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await deps.assistantSettingsReady;
    await authorizeAssistant({ authorize, permission: deps.adminAssistantPermission, entityType: "assistant-settings" });
    return ok({ value: { data: await deps.getPublicAssistantSettings(), adminAssistantEnabled: deps.adminAssistantEnabled } });
  },
});
