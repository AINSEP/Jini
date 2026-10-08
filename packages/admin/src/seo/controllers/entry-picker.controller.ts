import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminSeoPort } from '../ports.js';
import { initialEntryPickerState, describeSeoError } from '../models.js';
import type { EntryPickerController, SeoTranslator, SeoErrorFormatter } from '../models.js';
/** Two existing reads, combined posts first then pages; no new content repository. */
export function createEntryPickerController({ api }: { api: AdminSeoPort }, { t = key => key, describeError = describeSeoError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {}) {
  const store = createControllerStore<EntryPickerController>({ initial: initialEntryPickerState });
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    try {
      const [posts, pages] = await Promise.all([api.listSeoPosts({}), api.listSeoPages({})]);
      store.set({ patch: { entries: [...posts, ...pages] } });
    } catch (error) { store.set({ patch: { error: describeError({ error, fallback: t('failed to load entries') }) } }); }
  }
  return { ...store, load };
}
