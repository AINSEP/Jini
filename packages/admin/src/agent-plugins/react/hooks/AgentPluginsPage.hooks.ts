import { createContext, useContext, useId, useState } from 'react';
import type { ModulePageProps } from '../../../core/react/bind-react.js';
import { useController } from '../../../core/react/use-controller.js';
import { createAgentPluginsController } from '../../controllers/agent-plugins.controller.js';
import type { AgentPluginsState } from '../../models.js';
import { AGENT_PLUGINS_READ, agentPluginDisableCopy, humanizeAgentPluginId } from '../../rules.js';
import { useAgentPluginsPorts } from './AgentPluginsPorts.hooks.js';
import { AdminConfigError } from '../../../core/module/index.js';
export interface AgentPluginsPageScope {
  readonly controller: ReturnType<typeof createAgentPluginsController> | null;
  readonly snapshot: Readonly<AgentPluginsState> | null;
  readonly permissions: readonly string[];
  readonly uninstallNoteId: string;
}
export const AgentPluginsPageContext = createContext<AgentPluginsPageScope | null>(null);
export function useAgentPluginsPageScope(_required: Record<string, never>, _optional = {}) {
  const scope = useContext(AgentPluginsPageContext);
  if (!scope) throw new AdminConfigError({ issues: ['Agent plugins page scope unavailable'] });
  return scope;
}
export function useAgentPluginsPage(props: ModulePageProps, _optional = {}) {
  const { agentPluginsApi } = useAgentPluginsPorts({});
  const permissions = props.description.visible ? props.description.grants : [], key = permissions.join('\0');
  const { controller, snapshot } = useController({ create: () => createAgentPluginsController({ api: agentPluginsApi, permissions }), dependencies: [agentPluginsApi, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const [localTab, setLocalTab] = useState('installed'), uninstallNoteId = useId();
  const { visible, active, activeId } = pageTabs({ description: props.description, tab: props.requestedTab ?? localTab });
  return {
    denied: !props.description.visible || !permissions.includes(AGENT_PLUGINS_READ),
    scope: { controller, snapshot, permissions, uninstallNoteId },
    activeId, ActiveTab: active ? props.tabs[activeId] : undefined, params: active?.params ?? {}, permissions,
    items: visible.map(t => ({ id: tabSuffix(t.id), label: t.label, content: null })),
    onValueChange({ value }: { value: string }, _optional = {}) { setLocalTab(value); props.onTabChange?.({ tab: value }); },
    ...pageDialogs({ snapshot }),
    closeInspector(_required: Record<string, never>, _optional = {}) { controller?.closeInspector({}); },
    async confirm(_required: Record<string, never>, _optional = {}) {
      const pluginId = snapshot?.pendingDisable?.pluginId ?? '(none pending)';
      if (!await controller?.confirmDisable({})) throw new Error(`Activation was not updated for agent plugin ${pluginId}: the disable was refused or failed; retry, or reload the list if it changed`);
    },
    cancel(_required: Record<string, never>, _optional = {}) { controller?.cancelDisable({}); },
  };
}
/** A tab id is namespaced (`agentPlugins.installed`); the page addresses tabs by the last segment. */
const tabSuffix = (id: string) => id.slice(id.lastIndexOf('.') + 1);
function pageTabs({ description, tab }: { description: ModulePageProps['description']; tab: string }, _optional = {}) {
  const visible = description.visible ? description.tabs.filter(t => t.visible) : [];
  const active = visible.find(t => t.id.endsWith(`.${tab}`)) ?? visible[0];
  return { visible, active, activeId: active ? tabSuffix(active.id) : 'installed' };
}
function pageDialogs({ snapshot }: { snapshot: Readonly<AgentPluginsState> | null }, _optional = {}) {
  const pending = snapshot?.pendingDisable, confirming = !!pending && !!snapshot?.busyIds.includes(pending.pluginId);
  const inspected = snapshot?.plugins?.find(p => p.pluginId === snapshot.inspectedId);
  return {
    inspector: inspected ? { pluginId: inspected.pluginId, name: humanizeAgentPluginId({ pluginId: inspected.pluginId }) } : null,
    confirmation: pending ? agentPluginDisableCopy(pending) : null, confirming,
  };
}
