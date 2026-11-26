import { buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { useAgentPluginConfirmation } from "./AgentPlugins.hooks.js";
import type { AgentPluginsProps, AgentPluginsController } from "./AgentPlugins.js";
export function AgentPluginsOverlays({ props, controller, pendingDisable, pendingDisablePlugin, setPendingDisable }: {
  props: AgentPluginsProps;
  controller: AgentPluginsController;
} & Pick<ReturnType<typeof useAgentPluginConfirmation>, "pendingDisable" | "pendingDisablePlugin" | "setPendingDisable">, _optional = {}) {
  const { AgentPluginDetailsModal, AgentPluginDisableConfirmDialog } = props.kit;
  const { pluginRules, agentPluginDisplayName } = props.deps;
  const { inspectedPlugin, closeInspector, onToggleEnabled, t } = controller;
  return <>
        {inspectedPlugin ? <AgentPluginDetailsModal useDetails={props.hooks.useDetails} useAgentPluginMemoryHook={props.hooks.useAgentPluginMemoryHook} useAgentPluginDetailsViewHook={props.hooks.useAgentPluginDetailsViewHook} useAgentPluginSurfacesHook={props.hooks.useAgentPluginSurfacesHook} plugin={inspectedPlugin} t={t} onClose={closeInspector} /> : null}
        {pendingDisable && pendingDisablePlugin ? (
          <AgentPluginDisableConfirmDialog
            rules={pluginRules}
            origin={pendingDisablePlugin.origin}
            requiredBy={pendingDisablePlugin.requiredBy}
            name={agentPluginDisplayName(pendingDisablePlugin)}
            variant={pendingDisable.variant}
            // Same derivation the row itself uses (`buildAgentListHandles`), computed from the one
            // id alone rather than threaded down from whichever tab's row is currently mounted —
            // that function derives a handle from the id, not list position, so this always matches
            // the handle the row published, in either tab.
            agentHandleBase={buildAgentListHandles({ prefix: "agent-plugin-row", ids: [pendingDisablePlugin.pluginId] })[0]!}
            onConfirm={() => {
              setPendingDisable(null);
              void onToggleEnabled(pendingDisablePlugin);
            }}
            onCancel={() => setPendingDisable(null)}
            t={t}
          />
        ) : null}
  </>;
}
