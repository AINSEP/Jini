import { createElement } from 'react';
import type { ComponentType } from 'react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { SeoDefaultsTab, SeoSitemapTab, SeoEntrySection } from '../pages/SeoPage.js';
import { useWiredSeo } from './use-seo.hooks.js';
import { useSeoCopy } from './SeoPorts.hooks.js';
import type { SeoTabController } from './SeoPage.hooks.js';
/** Standalone lazy tab mounts share the same controllers and markup as the page-owned panels. */
function useSettingsTab({ Panel }: { Panel: ComponentType<{ controller: SeoTabController }> }) {
  const controller = useWiredSeo();
  const t = useSeoCopy();
  if (controller.error && !controller.settings) return createElement('div', { className: 'notice error' }, controller.error);
  if (!controller.settings) return createElement('div', { className: 'notice' }, t({ key: 'Loading SEO settings…' }));
  return createElement(Panel, { controller: { ...controller, settings: controller.settings } });
}
export function SeoDefaultsModuleTab(_required: TabViewProps, _optional: Record<string, never> = {}) { return useSettingsTab({ Panel: SeoDefaultsTab }); }
export function SeoSitemapModuleTab(_required: TabViewProps, _optional: Record<string, never> = {}) { return useSettingsTab({ Panel: SeoSitemapTab }); }
export function SeoEntriesModuleTab(_required: TabViewProps, _optional: Record<string, never> = {}) { return createElement(SeoEntrySection, { locale: 'en' }); }
