import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi } from '@jini-ai/core/contracts/admin-module';
import { securityModule } from '../security.module.js';
import { englishSecurity, type SecurityTranslator } from '../messages.en.js';
import { SecurityPortsContext, SecurityChromeContext, type SecurityChrome } from './hooks/SecurityPorts.hooks.js';
export { useSecurityPorts } from './hooks/SecurityPorts.hooks.js';
export type { SecurityTranslator } from '../messages.en.js';
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
/** Root-key tab behaviour a host can choose. Each default is the stock Jini flow. */
export interface SecurityRootKeyTabOptions {
  /** `'hidden'` removes the generate action for hosts that create the key elsewhere. */
  readonly generate?: 'shown' | 'hidden';
  /** The env var name a status badge falls back to when the server reply names none. */
  readonly defaultEnvVarName?: string;
  /** `false` lets a failed start-fresh preview still open the confirm step. */
  readonly previewRequired?: boolean;
}
export interface SecurityOptions {
  t?: SecurityTranslator;
  rootKeyScopeNotice?: string;
  rootKeyTab?: SecurityRootKeyTabOptions;
  tabIcons?: SecurityChrome['tabIcons'];
}
function rootKeyParams({ rootKeyScopeNotice, rootKeyTab }: { rootKeyScopeNotice?: string | undefined; rootKeyTab?: SecurityRootKeyTabOptions | undefined }, _optional = {}) {
  return { ...(rootKeyScopeNotice ? { scopeNotice: rootKeyScopeNotice } : {}), ...rootKeyTab };
}
/** One security module per admin scope. The host's translator, tab glyphs ride a
 * context on the Provider, so swapping the locale re-renders without rebuilding the tab controllers.
 * @example createElement(feature.react.Provider, { admin, t: hostTranslator, children })
 */
export function security<Page, Tab>({ ui }: { ui: ModuleUi<Page, Tab> }, { t = englishSecurity, rootKeyScopeNotice, rootKeyTab, tabIcons = {} }: SecurityOptions = {}) {
  const { pages: { secrets } } = securityModule;
  const module = { ...securityModule, pages: { secrets: { ...secrets, tabs: { ...secrets.tabs, 'root-key': { ...secrets.tabs['root-key'], params: rootKeyParams({ rootKeyScopeNotice, rootKeyTab }) } } } } };
  const react = ui.bindReact({ module, views: { secrets: { page: () => import('./pages/SecurityPage.js'), tabs: { 'access-tokens': () => import('./tabs/AccessTokensTab.js'), 'root-key': () => import('./tabs/RootKeyTab.js') } } } }, { context: SecurityPortsContext });
  const ScopeProvider = react.Provider;
  function Provider({ admin, children, t: currentTranslation = t }: { admin: AdminInstance; children: ReactNode; t?: SecurityTranslator }) {
    const chrome: SecurityChrome = { t: currentTranslation, tabIcons };
    return createElement(SecurityChromeContext.Provider, { value: chrome }, createElement(ScopeProvider, { admin, children }));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
