import { bindReact } from '../../react/bind-react.js';
import { securityModule } from '../security.module.js';
import { SecurityPortsContext } from './hooks/SecurityPorts.hooks.js';
export { useSecurityPorts } from './hooks/SecurityPorts.hooks.js';
export function security(_required: Record<string, never>, { rootKeyScopeNotice }: { rootKeyScopeNotice?: string } = {}) {
  const module = { ...securityModule, pages: { secrets: { ...securityModule.pages.secrets, tabs: { ...securityModule.pages.secrets.tabs, 'root-key': { ...securityModule.pages.secrets.tabs['root-key'], params: rootKeyScopeNotice ? { scopeNotice: rootKeyScopeNotice } : {} } } } } };
  const react = bindReact({ module, views: { secrets: { page: () => import('./pages/SecurityPage.js'), tabs: { 'access-tokens': () => import('./tabs/AccessTokensTab.js'), 'root-key': () => import('./tabs/RootKeyTab.js') } } } }, { context: SecurityPortsContext });
  return Object.assign(module, { react });
}
