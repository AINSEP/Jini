import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminSeoPort } from '../ports.js';
import { initialSeoEntryState, describeSeoError } from '../models.js';
import type { SeoEntryState, SeoEntryOverridesPatch, SeoTranslator, SeoErrorFormatter } from '../models.js';
import { overrideOrClear } from '../rules.js';

/** Partial edits remain distinct from resolved values, including explicit null clears. */
export function createSeoEntryController(
  { api, entryId }: { api: AdminSeoPort; entryId: string },
  { t = key => key, describeError = describeSeoError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {},
) {
  const store = createControllerStore<SeoEntryState>({ initial: initialSeoEntryState });
  let analyzeGeneration = 0;
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    store.set({ patch: initialSeoEntryState });
    try {
      const [resolved, analysis] = await Promise.all([api.getSeoEntry({ entryId }), api.analyzeSeoEntry({ entryId })]);
      store.set({ patch: { resolved, analysis } });
    } catch (error) { store.set({ patch: { loadError: describeError({ error, fallback: t('failed to load entry SEO data') }) } }); }
  }
  function fieldValue<K extends keyof SeoEntryOverridesPatch>(
    { key, resolvedValue }: { key: K; resolvedValue: SeoEntryOverridesPatch[K] }, _optional: Record<string, never> = {},
  ): SeoEntryOverridesPatch[K] {
    const { touched } = store.getSnapshot();
    return key in touched ? touched[key] : resolvedValue;
  }
  // Normalize at the single sink rather than the eleven input handlers: a future field cannot
  // silently miss the clear-override behavior. An untouched field remains absent from the PUT.
  function setField<K extends keyof SeoEntryOverridesPatch>(
    { key, value }: { key: K; value: SeoEntryOverridesPatch[K] }, _optional: Record<string, never> = {},
  ) {
    store.set({ patch: { touched: { ...store.getSnapshot().touched, [key]: overrideOrClear({ value }) } } });
  }
  async function save(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { touched } = store.getSnapshot();
    if (Object.keys(touched).length === 0) return;
    store.set({ patch: { saving: true, saveError: null, notice: null } });
    try {
      const resolved = await api.putSeoEntry({ entryId }, touched);
      store.set({ patch: { resolved, touched: {}, notice: t('Saved.') } });
      // Saving finishes with the PUT, before this best-effort analysis settles. A newer save's
      // analysis must supersede an earlier slow response (the source's 2026-09-07 race fix).
      const ticket = ++analyzeGeneration;
      void api.analyzeSeoEntry({ entryId }).then(analysis => {
        if (ticket === analyzeGeneration) store.set({ patch: { analysis } });
      }).catch(() => { /* analysis refresh is best-effort; the save already succeeded */ });
    } catch (error) { store.set({ patch: { saveError: describeError({ error, fallback: t('failed to save SEO overrides') }) } }); }
    finally { store.set({ patch: { saving: false } }); }
  }
  return { ...store, load, fieldValue, setField, save };
}
