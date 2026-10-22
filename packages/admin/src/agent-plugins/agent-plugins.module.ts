import { defineAdminModule } from '../core/module/index.js';
import { agentPluginsApiToken } from './ports.js';
import { agentPluginsMessagesEn as m } from './messages.en.js';
import { AGENT_PLUGINS_READ } from './rules.js';
export const agentPluginsModule = defineAdminModule({ id: 'agent-plugins', requires: { agentPluginsApi: agentPluginsApiToken }, messages: m, pages: { agentPlugins: { path: '/agent-plugins', label: m.title, permissions: [AGENT_PLUGINS_READ], nav: { group: 'operations', icon: 'package' }, tabs: { installed: { label: m.installed }, downloaded: { label: m.downloaded }, marketplace: { label: m.marketplace } } } } });
