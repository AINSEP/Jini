import { createElement } from 'react';
import type { FormEvent, ComponentType } from 'react';
import type { TabBarTab } from '@jini-ai/ui/tab-strip';
import { SeoDefaultsIcon, SeoSitemapIcon, SeoEntriesIcon } from '../components/SeoIcons.js';
import { buildSeoSettingsPatch, resolveSeoTabId, sortIssuesBySeverity } from '../../rules.js';
import type { SeoTranslator, SeoSettingsPatch, SeoSettings, SeoEntryAnalysis } from '../../models.js';
import { useSeoOptions } from './SeoPorts.hooks.js';
export { buildSeoSettingsPatch, resolveSeoTabId } from '../../rules.js';
export type { SeoTabId } from '../../rules.js';
export function resolveSeoTabs(_required: Record<string, never> = {}, { t = key => key }: { t?: SeoTranslator | undefined } = {}): TabBarTab[] {
  return [
    { id: 'defaults', label: t('Site defaults'), icon: createElement(SeoDefaultsIcon), handle: 'seo-tab-defaults', handleLabel: 'Switch to the Site defaults tab — title template, meta description, social image and card handle, and the default robots directives' },
    { id: 'sitemap', label: t('Sitemap'), icon: createElement(SeoSitemapIcon), handle: 'seo-tab-sitemap', handleLabel: 'Switch to the Sitemap tab — rebuild the cached sitemap, or view the URLs it contains' },
    { id: 'entries', label: t('Pages & posts'), icon: createElement(SeoEntriesIcon), handle: 'seo-tab-entries', handleLabel: 'Switch to the Pages & posts tab — override and analyze the SEO metadata of one page or post' },
  ];
}
export function sitemapStateLabel({ sitemapEnabled }: { sitemapEnabled: boolean }, { t = key => key }: { t?: SeoTranslator | undefined } = {}): string {
  return t(sitemapEnabled ? 'This site publishes a sitemap.' : 'This site does not publish a sitemap. Turn it on under Site defaults.');
}
/** Module onTabChange owns the ?tab= URL. The host uses replace:true to avoid back-stack growth. */
export function useSeoPageActions(
  { onTabChange }: { onTabChange?: ((required: { tab: string }, optional?: Record<string, never>) => void) | undefined }, _optional: Record<string, never> = {},
) { return { changeTab: (tab: string) => onTabChange?.({ tab }) }; }
export function useSeoTabs({ tabId }: { tabId?: string | null | undefined }, _optional: Record<string, never> = {}) {
  const { t } = useSeoOptions();
  return { activeTabId: resolveSeoTabId({ tabId }), tabs: resolveSeoTabs({}, { t }) };
}
export function useAnalyzePanel({ analysis }: { analysis: SeoEntryAnalysis }, _optional: Record<string, never> = {}) {
  return { sortedIssues: sortIssuesBySeverity({ issues: analysis.issues }) };
}
/** All seven defaults remain in one FormData submission; tabs never split this form. */
export function useSeoDefaults({ save }: { save: (patch: SeoSettingsPatch) => Promise<void> }, _optional: Record<string, never> = {}) {
  return { submit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(buildSeoSettingsPatch({ form: new FormData(event.currentTarget) })); } };
}

export interface SeoTabController {
  locale: string;
  settings: SeoSettings;
  saving: boolean;
  save: (patch: SeoSettingsPatch) => Promise<void>;
  defaultOgImage: string;
  setDefaultOgImage: (value: string) => void;
  regenerateSitemap: () => void;
  openSitemapModal: () => void;
}
/** Panel selection is presentation dispatch; this never changes the defaults form's field set. */
export function seoTabPanel(
  { activeTabId, controller, components }: {
    activeTabId: import('../../rules.js').SeoTabId;
    controller: SeoTabController;
    components: { SeoDefaultsTab: ComponentType<{ controller: SeoTabController }>; SeoSitemapTab: ComponentType<{ controller: SeoTabController }>; SeoEntrySection: ComponentType<{ locale: string }> };
  }, _optional: Record<string, never> = {},
) {
  if (activeTabId === 'sitemap') return createElement(components.SeoSitemapTab, { controller });
  if (activeTabId === 'entries') return createElement(components.SeoEntrySection, { locale: controller.locale });
  return createElement(components.SeoDefaultsTab, { controller });
}
