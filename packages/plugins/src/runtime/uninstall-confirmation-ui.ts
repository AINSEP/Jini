import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";

import type { PluginUninstallPreview } from "../host/uninstall.js";

/**
 * @file The dialog `plugins_uninstall` raises before it removes anything.
 *
 * Same held-open exchange as `enable-confirmation-ui.ts` (this domain's own sibling) and
 * `agent-plugins/uninstall-confirmation-ui.ts` (the OTHER plugin family's identical dialog): the
 * model's one call parks, and only the browser POST to `mcp-ui-tool-calls-route.ts` can resolve it
 * (ADR-055 Decision 2; the host's `human-confirm.ts` has the full chain). So `plugins_uninstall`
 * must also be on `assistant/mcp-ui-tool-calls.ts`'s `MCP_UI_REDEEMABLE_TOOL_IDS`, or every
 * Confirm/Cancel click 403s.
 *
 * This file is deliberately its own module rather than a shared one with `agent-plugins/
 * uninstall-confirmation-ui.ts`: the two plugin families' wording, warnings, and preview shapes
 * genuinely differ (a site plugin's artifact is shared across every workspace this instance serves;
 * an Agent Plugin's is per-workspace), and a shared builder would either blur that difference or grow
 * a family-switch branch neither side asked for.
 */

/** The tool id the dialog asks the Host to call back. Single source of truth for both halves. */
export const PLUGINS_UNINSTALL_TOOL_ID = "plugins_uninstall";

/**
 * Describes the uninstall-confirmation dialog for the shared approval transport.
 *
 * @param spec.preview - What would be removed. The plugin is NAMED, because "uninstall this plugin?"
 * without saying which one is not consent.
 * @complexity O(n) in the rendered field lengths.
 */
export function describeUninstallApproval({ preview }: { preview: PluginUninstallPreview }, _optional = {}): HumanConfirmSpec {
  return {
    toolId: PLUGINS_UNINSTALL_TOOL_ID, errorCode: "PLUGINS",
    title: `Move ${preview.name} to trash?`,
    description: `This moves the site plugin "${preview.pluginId}" (version ${preview.version}) to the Trash for 60 days.`,
    details: [{ label: "Plugin", value: preview.pluginId }, { label: "Version", value: preview.version }],
    warning: "This removes it for all workspaces on this site. You can restore it from Admin → Trash for 60 days; " +
      "only a human can delete it permanently.", danger: true, confirmLabel: "Move to trash",
    // A tool action resolves the parked call at once, rather than stranding it until the deadline.
    cancelLabel: "Cancel",
  };
}
