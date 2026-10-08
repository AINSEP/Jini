import { createElement, type ReactNode } from 'react';
import type { AdminInstance } from '../../core/module/types.js';
import { bindReact } from '../../core/react/bind-react.js';
import { seoModule } from '../seo.module.js';
import { SeoPortsContext, SeoOptionsContext } from './hooks/SeoPorts.hooks.js';
import type { SeoReactOptions } from './options.js';
export type { SeoReactOptions, SeoMediaPickerSlotProps } from './options.js';
export { useSeoPorts } from './hooks/SeoPorts.hooks.js';
export { resolveSeoTabs, sitemapStateLabel } from './hooks/SeoPage.hooks.js';
export type { SeoProps } from './pages/SeoPage.js';
/** One binding per admin scope. Site origin is host-owned; all views are loaded on demand. */
export function seo(
  { siteUrl }: Pick<SeoReactOptions, 'siteUrl'>,
  optional: Omit<SeoReactOptions, 'siteUrl'> = {},
) {
  const defaults: SeoReactOptions = { siteUrl, ...optional };
  const page = async () => {
    const { SeoPage } = await import('./pages/SeoPage.js');
    return { default: (props: import('../../core/react/bind-react.js').ModulePageProps) =>
      createElement<import('./pages/SeoPage.js').SeoProps>(SeoPage, { tabId: props.requestedTab, onTabChange: props.onTabChange }) };
  };
  const tab = (id: 'SeoDefaultsModuleTab' | 'SeoSitemapModuleTab' | 'SeoEntriesModuleTab') => async () => {
    const views = await import('./hooks/SeoModuleTabs.js');
    return { default: (props: import('../../core/react/bind-react.js').TabViewProps) =>
      createElement(views[id], props) };
  };
  // The unchanged shell owns its active panel and banners. Standalone lazy tab mounts reuse those
  // same panel functions rather than introducing a second markup owner.
  const react = bindReact({ module: seoModule, views: { settings: { page, tabs: { defaults: tab('SeoDefaultsModuleTab'), sitemap: tab('SeoSitemapModuleTab'), entries: tab('SeoEntriesModuleTab') } } } }, { context: SeoPortsContext });
  /** Host options may refresh without replacing lazy views or controller state.
   * @returns The existing port scope plus the current options; factory defaults remain supported.
   * @example <Provider admin={admin} options={localizedOptions}>{children}</Provider>
   */
  function Provider({ admin, children, options = defaults }: { admin: AdminInstance; children: ReactNode; options?: SeoReactOptions }, _optional: Record<string, never> = {}) {
    return createElement(react.Provider, { admin, children: createElement(SeoOptionsContext.Provider, { value: options }, children) });
  }
  return Object.assign({ ...seoModule }, { react: { ...react, Provider } });
}
