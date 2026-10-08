import { bindReact } from '../../core/react/bind-react.js';
import { agentPluginsModule } from '../agent-plugins.module.js';
import { AgentPluginsPortsContext } from './hooks/AgentPluginsPorts.hooks.js';
import { agentPluginsMessagesEn as m } from '../messages.en.js';
export { useAgentPluginsPorts } from './hooks/AgentPluginsPorts.hooks.js';
/** Host-owned bundled policy copy. All page/tab loaders remain lazy. */
export function agentPlugins(_required: Record<string, never>, { uninstallNotice = m.uninstallUnavailable }: { uninstallNotice?: string } = {}) {
  const tabs = { ...agentPluginsModule.pages.agentPlugins.tabs, installed: { ...agentPluginsModule.pages.agentPlugins.tabs.installed, params: { uninstallNotice } }, downloaded: { ...agentPluginsModule.pages.agentPlugins.tabs.downloaded, params: { uninstallNotice } } };
  const module = { ...agentPluginsModule, pages: { agentPlugins: { ...agentPluginsModule.pages.agentPlugins, tabs } } };
  const react = bindReact({ module, views: { agentPlugins: { page: () => import('./pages/AgentPluginsPage.js'), tabs: { installed: () => import('./tabs/InstalledTab.js'), downloaded: () => import('./tabs/DownloadedTab.js'), marketplace: () => import('./tabs/MarketplaceTab.js') } } } }, { context: AgentPluginsPortsContext });
  return Object.assign(module, { react });
}
