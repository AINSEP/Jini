import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi, ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { securityModule } from '../security.module.js';
import { englishSecurity, type SecurityTranslator } from '../messages.en.js';
import { SecurityPortsContext, SecurityTranslationContext, SecurityOwnerControlsContext, SecurityErrorDescriberContext } from './hooks/SecurityPorts.hooks.js';
import type { SecurityTabIcons } from './hooks/SecurityPage.hooks.js';
import type { DescribeRootKeyError } from '../rules.js';
export { useSecurityPorts, useSecurityTranslation, useSecurityOwnerControls } from './hooks/SecurityPorts.hooks.js';
export type { SecurityTranslator } from '../messages.en.js';
export type { SecurityTabIcons } from './hooks/SecurityPage.hooks.js';
/** Root-key tab options, merged into that tab's params. Defaults are the stock behaviour:
 * generate shown, a preview required before start fresh, and no env-var name fallback. */
export interface SecurityRootKeyTabOptions {
  readonly generate?: 'shown' | 'hidden';
  readonly defaultEnvVarName?: string;
  readonly previewRequired?: boolean;
}
export interface SecurityModuleOptions {
  readonly t?: SecurityTranslator;
  readonly rootKeyScopeNotice?: string;
  readonly rootKeyTab?: SecurityRootKeyTabOptions;
  readonly tabIcons?: SecurityTabIcons;
  /** Reads a failure's server code and public detail (for example from the host's API error). The
   * module never shows a raw `Error.message`; without a describer, refusals show fixed copy. */
  readonly describeError?: DescribeRootKeyError;
}
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
function rootKeyParams({ rootKeyScopeNotice, rootKeyTab = {} }: Pick<SecurityModuleOptions, 'rootKeyScopeNotice' | 'rootKeyTab'>, _optional: Record<string, never> = {}) {
  return { ...(rootKeyScopeNotice ? { scopeNotice: rootKeyScopeNotice } : {}), ...rootKeyTab };
}
function withRootKeyParams({ params }: { params: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}) {
  const { pages } = securityModule, { tabs } = pages.secrets;
  return { ...securityModule, pages: { ...pages, secrets: { ...pages.secrets, tabs: { ...tabs, 'root-key': { ...tabs['root-key'], params } } } } };
}
/** One security module per admin scope. Tabs load on demand; host icons reach the page through its
 * lazy wrapper, and the host translator through a context so a locale change never remounts a tab.
 * @example security({ ui: reactModuleUi }, { rootKeyTab: { generate: 'hidden' }, tabIcons })
 */
export function security<Page, Tab>(
  { ui }: { ui: ModuleUi<Page, Tab> },
  { t = englishSecurity, rootKeyScopeNotice, rootKeyTab, tabIcons, describeError }: SecurityModuleOptions = {},
) {
  // Scope membership uses object identity, so bind and return this same per-admin module.
  const module = withRootKeyParams({ params: rootKeyParams({ ...(rootKeyScopeNotice ? { rootKeyScopeNotice } : {}), ...(rootKeyTab ? { rootKeyTab } : {}) }) });
  const react = ui.bindReact({ module, views: { secrets: {
    page: async () => {
      const { SecurityPage } = await import('./pages/SecurityPage.js');
      return { default: (props: TabbedPageProps) => createElement(SecurityPage, { ...props, ...(tabIcons ? { tabIcons } : {}) }) };
    },
    tabs: { 'access-tokens': () => import('./tabs/AccessTokensTab.js'), 'root-key': () => import('./tabs/RootKeyTab.js') },
  } } }, { context: SecurityPortsContext });
  const ScopeProvider = react.Provider;
  /** A live translator override keeps locale changes inside the existing scope: rebuilding the
   * module would remount the tabs and dispose their controllers.
   * `ownerControls` is the host's owner account settings, rendered once above the tabs while the
   * page is visible; it stays mounted across tab changes.
   * @example createElement(feature.react.Provider, { admin, t: hostTranslator, ownerControls, children })
   */
  function Provider({ admin, children, t: currentTranslation = t, ownerControls = null }: { admin: AdminInstance; children: ReactNode } & { t?: SecurityTranslator; ownerControls?: ReactNode }) {
    return createElement(SecurityTranslationContext.Provider, { value: currentTranslation },
      createElement(SecurityOwnerControlsContext.Provider, { value: ownerControls },
        createElement(SecurityErrorDescriberContext.Provider, { value: describeError }, createElement(ScopeProvider, { admin, children }))));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
