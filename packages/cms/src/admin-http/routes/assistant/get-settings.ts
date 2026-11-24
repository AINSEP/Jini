import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AssistantSettingsEnvelopeDto } from "@jini-ai/core/contracts/site/cms-assistant";

import { authorizeAssistant, type AssistantRoutePrincipal } from "./shared.js";

/** Reads the workspace's public-assistant settings. Injected: the settings ledger mapping is the host's. */
export type AssistantSettingsReadFn = (required: { workspaceId: string }) => Promise<unknown>;

/** The deps this route reads. */
export interface AssistantGetSettingsRouteDeps {
  workspaceId: string;
  /** The host's boot gate for the settings definitions. */
  assistantSettingsReady: PromiseLike<unknown>;
  /** The host's assistant-management permission (a host policy). */
  managePermission: string;
  readAssistantSettings: AssistantSettingsReadFn;
  /** The host's own admin-assistant on/off switch, read once at boot. */
  adminAssistantEnabled: boolean;
}

/**
 * GET the workspace's `site.assistant.*` settings — today, the public assistant's master on/off
 * switch, in the `{ data }` envelope the admin client's `request()` helper expects.
 *
 * Also returns a sibling `adminAssistantEnabled` field — the (unrelated) ADMIN assistant's own off
 * switch, NOT part of the settings ledger and deliberately not folded into it. Piggy-backed onto
 * this response rather than a new endpoint because the host mounts this route UNCONDITIONALLY: the
 * gated assistant modules 404 with the flag off, so they cannot tell the client anything, but this
 * route always can. The admin SPA reads it to decide whether to mount its chat dock at all.
 */
export const assistantGetSettingsRoute = defineJsonRoute<Record<string, never>, AssistantSettingsEnvelopeDto, AssistantGetSettingsRouteDeps, AssistantRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/assistant/settings",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    // Awaited before the permission check (the host's authenticate port has already read the session),
    // so a request during boot waits for the seeded definitions.
    await deps.assistantSettingsReady;
    await authorizeAssistant({ authorize, permission: deps.managePermission });
    const settings = await deps.readAssistantSettings({ workspaceId: deps.workspaceId });
    return ok({ value: { data: settings, adminAssistantEnabled: deps.adminAssistantEnabled } });
  },
});
