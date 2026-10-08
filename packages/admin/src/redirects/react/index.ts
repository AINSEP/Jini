import { createElement } from 'react';
import { bindReact } from '../../core/react/bind-react.js';
import { redirectsModule } from '../redirects.module.js';
import { RedirectsPortsContext } from './hooks/RedirectsPorts.hooks.js';
import { RedirectsOptionsContext } from './hooks/RedirectsOptions.hooks.js';
import type { RedirectsReactOptions } from './hooks/RedirectsOptions.hooks.js';
export type { RedirectsReactOptions, RedirectsRenderMessageInput } from './hooks/RedirectsOptions.hooks.js';
export { useRedirectsPorts } from './hooks/RedirectsPorts.hooks.js';
export { useRedirects } from './hooks/use-redirects.hooks.js';
export { useHitCountCell } from './hooks/use-hit-count-cell.hooks.js';
export { useImportRedirectsForm } from './hooks/use-import-redirects-form.hooks.js';
/** Instance-scoped options and lazy list page; host supplies publish action and localized markup.
 * @example redirects({}, { t, headerActions, slots: { renderMessage } });
 */
export function redirects(_required: Record<string, never>, options: RedirectsReactOptions = {}) {
  const react = bindReact({ module: redirectsModule, views: { list: { tabs: {}, page: async () => {
    const { RedirectsPage } = await import('./pages/RedirectsPage.js');
    return { default: () => createElement(RedirectsPage) };
  } } } }, { context: RedirectsPortsContext });
  const ScopeProvider = react.Provider;
  /** Live host options keep the mounted page and its drafts intact across locale changes.
   * Factory options remain the default for hosts without a live override.
   * @example createElement(feature.react.Provider, { admin, options: localizedOptions, children });
   */
  function Provider({ admin, children, options: currentOptions = options }: Parameters<typeof ScopeProvider>[0] & { options?: RedirectsReactOptions }) {
    return createElement(RedirectsOptionsContext.Provider, { value: currentOptions }, createElement(ScopeProvider, { admin, children }));
  }
  return Object.assign({ ...redirectsModule }, { react: { ...react, Provider } });
}
