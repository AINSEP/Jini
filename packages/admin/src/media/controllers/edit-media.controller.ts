import { createControllerStore } from '../../core/module/controller-store.js';
import type { MediaApiPort } from '../ports.js';
import type { MediaAsset, MediaMetadataPatch, UploadInput } from '../models.js';
import { diffMediaMetadata, canReplaceMedia } from '../rules.js';
export function createEditMediaController(
  { api, item }: { api: MediaApiPort; item: MediaAsset },
  _optional: Record<string, never> = {},
) {
  // Frozen at mount, exactly like draft's initializer — stays the value draft was seeded
  // from even as the live list advances underneath it. Never diff against a drifting item.
  let baseline = Object.freeze({ ...item });
  const store = createControllerStore({
    initial: {
      draft: metadataDraft({ item }),
      saving: false,
      error: null as string | null,
    },
  });
  async function perform(run: () => Promise<MediaAsset>) {
    if (store.signal.aborted || store.getSnapshot().saving) return false;
    store.set({ patch: { saving: true, error: null } });
    try {
      const saved = await run();
      if (store.signal.aborted) return false;
      baseline = saved;
      store.set({
        patch: {
          draft: metadataDraft({ item: baseline }),
        },
      });
      return true;
    } catch (error) {
      store.set({
        patch: { error: error instanceof Error ? error.message : 'Failed to save media metadata' },
      });
      return false;
    } finally {
      store.set({ patch: { saving: false } });
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose: store.dispose,
    setDraft({ patch }: { patch: MediaMetadataPatch }, _optional: Record<string, never> = {}) {
      if (!store.getSnapshot().saving)
        store.set({ patch: { draft: { ...store.getSnapshot().draft, ...patch } } });
    },
    async save(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      const patch = diffMediaMetadata({ item: baseline, draft: store.getSnapshot().draft });
      if (Object.keys(patch).length === 0) return true;
      return perform(() => api.update({ id: item.id, patch }, { signal: store.signal }));
    },
    async replace({ upload }: { upload: UploadInput }, _optional: Record<string, never> = {}) {
      if (!canReplaceMedia({ api })) {
        store.set({ patch: { error: 'File replacement is unavailable' } });
        return false;
      }
      return perform(() => api.replace!({ id: item.id, upload }, { signal: store.signal }));
    },
  };
}

/** Do not invent CMS fields for hosts which omit them: undefined is an untouched field. */
function metadataDraft({ item }: { item: MediaAsset }): MediaMetadataPatch {
  return Object.fromEntries(Object.entries({ title: item.title, slug: item.slug, alt: item.alt,
    caption: item.caption, credit: item.credit, width: item.width, height: item.height,
    cssClass: item.cssClass, htmlAttributes: item.htmlAttributes }).filter(([, value]) => value !== undefined));
}
