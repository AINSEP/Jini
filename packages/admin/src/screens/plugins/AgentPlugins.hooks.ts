import { useState } from "react";
import type { AgentPluginListRow } from "../../agent-plugins/models.js";

/** The slice of the host's agent-plugins controller the confirmation flow reads. */
export interface AgentPluginConfirmationInputs {
  /** `null` until the list settles. */
  agentPlugins: readonly AgentPluginListRow[] | null;
  onToggleEnabled: (plugin: AgentPluginListRow) => Promise<void> | void;
}

/** Route disabling and removing enabled plugins through their shared confirmation. */
export function useAgentPluginConfirmation({ agentPlugins, onToggleEnabled }: AgentPluginConfirmationInputs, _options = {}) {
  // Which plugin (by id) is waiting on a disable/remove confirm dialog, and which CONTROL asked —
  // `null` when neither tab has one open. Lives here rather than in the agent-plugins data hook —
  // this is presentation flow ("has the operator confirmed yet"), not a network mutation, the same
  // split the host's External MCP panel's own `confirmRemoveId` draws for the identical shape of
  // interstitial. An id rather than a plugin object so the confirmed row is always looked up fresh
  // against the current `agentPlugins` — a stale object reference could not reflect the plugin
  // toggling or vanishing by some other route while the dialog sat open. `variant` travels alongside
  // the id (not derived from `plugin.enabled` at render time) because Installed's switch and
  // Downloaded's Remove button can both open this for an enabled row, and the dialog's own wording
  // must match whichever one the operator actually clicked, not the plugin's state.
  const [pendingDisable, setPendingDisable] = useState<{ pluginId: string; variant: "disable" | "remove" } | null>(
    null,
  );
  const pendingDisablePlugin = agentPlugins?.find((plugin) => plugin.pluginId === pendingDisable?.pluginId) ?? null;

  /** Installed's switch: enabling stays a plain one-click toggle, disabling opens the confirm
   *  dialog (`variant: "disable"`) instead of calling the mutation immediately. */
  function onRequestToggleEnabled(plugin: AgentPluginListRow): void {
    if (plugin.enabled) {
      setPendingDisable({ pluginId: plugin.pluginId, variant: "disable" });
    } else {
      void onToggleEnabled(plugin);
    }
  }

  /** Downloaded's Remove action — shown only for a currently-enabled row (see `AgentPluginRow`'s
   *  own state-area rendering), so unlike `onRequestToggleEnabled` this has no direct-call branch:
   *  Remove always asks first, with `variant: "remove"` so the dialog reads accordingly. */
  function onRequestRemove(plugin: AgentPluginListRow): void {
    setPendingDisable({ pluginId: plugin.pluginId, variant: "remove" });
  }

  return { pendingDisable, setPendingDisable, pendingDisablePlugin, onRequestToggleEnabled, onRequestRemove };
}
