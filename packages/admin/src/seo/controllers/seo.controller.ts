import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminSeoPort } from '../ports.js';
import { initialSeoState, describeSeoError } from '../models.js';
import type { SeoState, SeoTranslator, SeoSettingsPatch } from '../models.js';

/** One settings write owner; image drafts rebaseline only on accepted server settings. */
export function createSeoController(
  { api }: { api: AdminSeoPort },
  { t = (key) => key }: { t?: SeoTranslator | undefined } = {},
) {
  const store = createControllerStore<SeoState>({ initial: initialSeoState });
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    try {
      const settings = await api.getSeoSettings({});
      store.set({ patch: { settings, defaultOgImage: settings.defaultOgImage ?? '' } });
    } catch (error) {
      store.set({ patch: { error: describeSeoError({ error, fallback: t('failed to load SEO settings') }) } });
    }
  }
  async function save({ patch }: { patch: SeoSettingsPatch }, _optional: Record<string, never> = {}) {
    store.set({ patch: { saving: true, error: null, notice: null } });
    try {
      const settings = await api.putSeoSettings({}, patch);
      store.set({ patch: { settings, defaultOgImage: settings.defaultOgImage ?? '', notice: t('Saved.') } });
    } catch (error) {
      store.set({ patch: { error: describeSeoError({ error, fallback: t('failed to save SEO settings') }) } });
    } finally { store.set({ patch: { saving: false } }); }
  }
  async function regenerateSitemap(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Promise<boolean> {
    store.set({ patch: { saving: true, error: null, notice: null } });
    try {
      await api.regenerateSeoSitemap({});
      store.set({ patch: { notice: t('Sitemap regeneration accepted.') } });
      return true;
    } catch (error) {
      store.set({ patch: { error: describeSeoError({ error, fallback: t('failed to regenerate sitemap') }) } });
      return false;
    } finally { store.set({ patch: { saving: false } }); }
  }
  return {
    ...store, load, save, regenerateSitemap,
    setDefaultOgImage({ value }: { value: string }, _optional: Record<string, never> = {}) { store.set({ patch: { defaultOgImage: value } }); },
    openSitemapModal(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { store.set({ patch: { sitemapModalOpen: true } }); },
    closeSitemapModal(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { store.set({ patch: { sitemapModalOpen: false } }); },
  };
}
