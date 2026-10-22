import type { SitemapModalController } from '../../models.js';
import { useSeoCopy, useSeoOptions } from './SeoPorts.hooks.js';
import { buildAgentListHandles } from '@jini-ai/agentic';
/** The regeneration mutation owns cache invalidation; forwarding it must not start a second
 * XML read. Failed writes leave the viewed XML alone.
 * @returns The mutation callback as the modal's click handler; no additional I/O.
 * @complexity O(1).
 */
export function useSitemapModalRegenerate(
  { onRegenerate }: { onRegenerate: () => Promise<boolean> }, _optional: Record<string, never> = {},
) {
  return { handleRegenerate: onRegenerate };
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
