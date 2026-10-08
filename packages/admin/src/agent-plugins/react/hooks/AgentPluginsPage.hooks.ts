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
  const visible = props.description.visible ? props.description.tabs.filter(t => t.visible) : [];
  const active = visible.find(t => t.id.endsWith(`.${props.requestedTab ?? localTab}`)) ?? visible[0];
  const activeId = active?.id.slice(active.id.lastIndexOf('.') + 1) ?? 'installed';
  const pending = snapshot?.pendingDisable, confirming = !!pending && !!snapshot?.busyIds.includes(pending.pluginId);
  const confirmation = pending ? agentPluginDisableCopy(pending) : null;
  const inspected = snapshot?.plugins?.find(p => p.pluginId === snapshot.inspectedId);
  return {
    denied: !props.description.visible || !permissions.includes(AGENT_PLUGINS_READ),
    scope: { controller, snapshot, permissions, uninstallNoteId },
    activeId, ActiveTab: active ? props.tabs[activeId] : undefined, params: active?.params ?? {}, permissions,
    items: visible.map(t => ({ id: t.id.slice(t.id.lastIndexOf('.') + 1), label: t.label, content: null })),
    onValueChange({ value }: { value: string }, _optional = {}) { setLocalTab(value); props.onTabChange?.({ tab: value }); },
    inspector: inspected ? { pluginId: inspected.pluginId, name: humanizeAgentPluginId({ pluginId: inspected.pluginId }) } : null,
    closeInspector(_required: Record<string, never>, _optional = {}) { controller?.closeInspector({}); },
    confirmation, confirming,
    async confirm(_required: Record<string, never>, _optional = {}) { if (!await controller?.confirmDisable({})) throw new Error('Activation was not updated'); },
    cancel(_required: Record<string, never>, _optional = {}) { controller?.cancelDisable({}); },
  };
}
