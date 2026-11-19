import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi } from '@jini-ai/core/contracts/admin-module';
import { redirectsModule } from '../redirects.module.js';
import { RedirectsPortsContext, RedirectsControllerContext } from './hooks/RedirectsPorts.hooks.js';
import { RedirectsOptionsContext } from './hooks/RedirectsOptions.hooks.js';
import type { RedirectsReactOptions } from './hooks/RedirectsOptions.hooks.js';
export type { RedirectsReactOptions, RedirectsRenderMessageInput } from './hooks/RedirectsOptions.hooks.js';
export { useRedirectsPorts, RedirectsControllerContext } from './hooks/RedirectsPorts.hooks.js';
export { useRedirects } from './hooks/use-redirects.hooks.js';
export { useHitCountCell } from './hooks/use-hit-count-cell.hooks.js';
export { useImportRedirectsForm } from './hooks/use-import-redirects-form.hooks.js';
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
/** Instance-scoped options and lazy list page; host supplies publish action and localized markup.
 * @example redirects({ ui }, { t, headerActions, slots: { renderMessage } });
 */
export function redirects<Page, Tab>({ ui }: { ui: ModuleUi<Page, Tab> }, options: RedirectsReactOptions = {}) {
  const react = ui.bindReact({ module: redirectsModule, views: { list: { tabs: {}, page: async () => {
    const { RedirectsPage } = await import('./pages/RedirectsPage.js');
    return { default: () => createElement(RedirectsPage) };
  } } } }, { context: RedirectsPortsContext });
  const ScopeProvider = react.Provider;
  /** Live host options keep the mounted page and its drafts intact across locale changes.
   * Factory options remain the default for hosts without a live override.
   * @example createElement(feature.react.Provider, { admin, options: localizedOptions, children });
   */
  function Provider({ admin, children, options: currentOptions = options }: { admin: AdminInstance; children: ReactNode } & { options?: RedirectsReactOptions }) {
    return createElement(RedirectsOptionsContext.Provider, { value: currentOptions }, createElement(RedirectsControllerContext.Provider, { value: ui.useController }, createElement(ScopeProvider, { admin, children })));
  }
  return Object.assign({ ...redirectsModule }, { react: { ...react, Provider } });
}
