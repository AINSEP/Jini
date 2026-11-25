import { agentHandle } from "@jini-ai/core/agent-handles";
import { useId } from "react";

import { AddAgentPluginPanel } from "./AddAgentPluginPanel.js";
import type { AgentPluginUpdateState } from "./hooks/use-agent-plugin-update.hooks.js";

import { type Translate } from '@jini-ai/core/text';
export interface AgentPluginUpdateControlProps {
  /** The row's update state and upload controller, composed by the wired list
   *  (`AgentPlugins.tsx`'s `AgentPluginUpdateSlot`, from `useAgentPluginUpdate`). */
  readonly update: AgentPluginUpdateState;
  readonly t: Translate;
  /** The row's own agent-handle base; the button and panel nest under `<base>-update`. */
  readonly agentHandleBase: string;
}

/**
 * The explicit update of one operator-installed Agent Plugin: an "Update" button that opens the same
 * bounded `.zip`/folder upload the Add tab uses, sent to `AGENT_PLUGIN_UPDATE_ZIP` with the
 * revision this row shows (`archiveDigest`). If the plugin changed meanwhile, the server refuses
 * (`PLUGIN_CHANGED`) and nothing moves. The plugin keeps its memory and its on/off state.
 * There is no "update available" signal: without a catalog nothing knows a newer version exists.
 * Renders only: the open state and the upload controller arrive through `update`.
 */
export function AgentPluginUpdateControl({ update, t, agentHandleBase }: AgentPluginUpdateControlProps) {
  const { open, onToggle, displayName, controller } = update;
  const panelId = useId();
  const base = `${agentHandleBase}-update`;
  return (
    <div>
      <button
        type="button"
        className="btn-secondary"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t("Update")} ${displayName}`}
        disabled={controller.busy}
        onClick={onToggle}
        {...agentHandle({ handle: base }, { role: "button", label: `Show or hide the update upload for "${displayName}"` })}
      >
        {t("Update")}
      </button>
      <div id={panelId} hidden={!open}>
        {open ? <AddAgentPluginPanel controller={controller} handleBase={base} title={`${t("Update")} ${displayName}`} /> : null}
      </div>
    </div>
  );
}
