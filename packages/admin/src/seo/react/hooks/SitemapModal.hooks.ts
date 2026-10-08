import type { SitemapModalController } from '../../models.js';
import { useSeoCopy, useSeoOptions } from './SeoPorts.hooks.js';
import { buildAgentListHandles } from '@jini-ai/agentic';
/** Refetch only after accepted regeneration; a failed write must leave the viewed XML alone. */
export function useSitemapModalRegenerate(
  { onRegenerate, refetch }: { onRegenerate: () => Promise<boolean>; refetch: () => void }, _optional: Record<string, never> = {},
) {
  return { handleRegenerate: async () => { if (await onRegenerate()) refetch(); } };
}
export function useSitemapTable({ modal }: { modal: SitemapModalController }, _optional: Record<string, never> = {}) {
  return { rowHandles: buildAgentListHandles({ prefix: 'seo-sitemap-row', ids: modal.filteredEntries.map(entry => entry.loc) }) };
}
export function useSitemapViewToggle({ modal }: { modal: SitemapModalController }, _optional: Record<string, never> = {}) {
  return { toggleView: () => modal.setView(modal.view === 'raw' ? 'table' : 'raw') };
}
export function useSitemapPresentation({ locale, modal }: { locale: string; modal: SitemapModalController }, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { siteUrl } = useSeoOptions();
  const title = modal.status === 'ready' ? t({ locale, key: 'Sitemap · {count} URLs' }).replace('{count}', String(modal.entries.length)) : t({ locale, key: 'Sitemap' });
  return { title, sourceUrl: `${siteUrl().replace(/\/$/, '')}/sitemap.xml` };
}
