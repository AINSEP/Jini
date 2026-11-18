import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi } from '@jini-ai/core/contracts/admin-module';
import { agentPluginsModule } from '../agent-plugins.module.js';
import { AgentPluginsPortsContext, AgentPluginsControllerContext } from './hooks/AgentPluginsPorts.hooks.js';
import { agentPluginsMessagesEn as m } from '../messages.en.js';
export { useAgentPluginsPorts } from './hooks/AgentPluginsPorts.hooks.js';
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
/** Host-owned bundled policy copy. All page/tab loaders remain lazy. */
export function agentPlugins<Page, Tab>({ ui }: { ui: ModuleUi<Page, Tab> }, { uninstallNotice = m.uninstallUnavailable }: { uninstallNotice?: string } = {}) {
  const tabs = { ...agentPluginsModule.pages.agentPlugins.tabs, installed: { ...agentPluginsModule.pages.agentPlugins.tabs.installed, params: { uninstallNotice } }, downloaded: { ...agentPluginsModule.pages.agentPlugins.tabs.downloaded, params: { uninstallNotice } } };
  const module = { ...agentPluginsModule, pages: { agentPlugins: { ...agentPluginsModule.pages.agentPlugins, tabs } } };
  const react = ui.bindReact({ module, views: { agentPlugins: { page: () => import('./pages/AgentPluginsPage.js'), tabs: { installed: () => import('./tabs/InstalledTab.js'), downloaded: () => import('./tabs/DownloadedTab.js'), marketplace: () => import('./tabs/MarketplaceTab.js') } } } }, { context: AgentPluginsPortsContext });
  function Provider({ admin, children }: { admin: AdminInstance; children: ReactNode }, _optional: Record<string, never> = {}) {
    return createElement(AgentPluginsControllerContext.Provider, { value: ui.useController }, createElement(react.Provider, { admin, children }));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
