import { createControllerStore } from '../../core/module/controller-store.js';
import type { AdminSeoPort } from '../ports.js';
import type { SitemapState, SitemapModalView } from '../models.js';
/** Disabled is terminal, distinct from loading. Refetch generations ignore older responses. */
export function createSitemapController(
  { api, enabled }: { api: AdminSeoPort; enabled: boolean }, _optional: Record<string, never> = {},
) {
  const store = createControllerStore<SitemapState>({ initial: { status: enabled ? 'loading' : 'disabled', error: null, xmlText: '', filter: '', view: 'table' } });
  let generation = 0;
  async function load(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    if (!enabled) return;
    const ticket = ++generation;
    store.set({ patch: { status: 'loading', error: null } });
    try {
      const { text } = await api.fetchSitemapXml({}, { signal: store.signal });
      if (ticket === generation) store.set({ patch: { xmlText: text, status: 'ready' } });
    } catch (error) {
      if (ticket === generation) store.set({ patch: { error: error instanceof Error ? error.message : 'failed to load the sitemap', status: 'error' } });
    }
  }
  return {
    ...store, load,
    setFilter({ value }: { value: string }, _optional: Record<string, never> = {}) { store.set({ patch: { filter: value } }); },
    setView({ view }: { view: SitemapModalView }, _optional: Record<string, never> = {}) { store.set({ patch: { view } }); },
  };
}
