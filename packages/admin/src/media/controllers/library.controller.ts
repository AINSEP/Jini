import { createControllerStore } from '../../core/module/controller-store.js';
import { queryMedia, countMediaTabs, canRestoreMedia, isRetryableMediaError } from '../rules.js';
import type { MediaApiPort } from '../ports.js';
import type { MediaAsset, MediaQuery, UploadInput } from '../models.js';
export interface LibraryState {
  readonly items: readonly MediaAsset[] | null;
  readonly query: MediaQuery;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly pendingIds: readonly string[];
  readonly error: string | null;
  readonly pendingPurge: MediaAsset | null;
  readonly hasUntyped: boolean;
  readonly counts: ReturnType<typeof countMediaTabs> | null;
}
export function createLibraryController(
  { api }: { api: MediaApiPort },
  { query = {} }: { query?: MediaQuery } = {},
) {
  const store = createControllerStore<LibraryState>({
    initial: {
      items: null,
      query,
      loading: false,
      busy: false,
      pendingIds: [],
      error: null,
      pendingPurge: null,
      hasUntyped: false,
      counts: null,
    },
  });
  let library: readonly MediaAsset[] | null = null;
  let readFailed = false, retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }
  let readAbort: AbortController | null = null,
    generation = 0;
  async function load(
    _required: Record<string, never> = {},
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted) return;
    cancelRetry();
    readAbort?.abort();
    const abort = new AbortController();
    readAbort = abort;
    const ticket = ++generation;
    store.set({ patch: { loading: true, error: null } });
    try {
      const all = await api.list({}, { signal: abort.signal });
      const items = queryMedia({ media: all, query: store.getSnapshot().query });
      if (ticket === generation) {
        readFailed = false;
        retryAttempt = 0;
        library = all;
        store.set({
          patch: {
            items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
            counts: countMediaTabs({ media: all }),
            hasUntyped: all.some((item) => item.contentType === null),
            error: null,
          },
        });
      }
    } catch (error) {
      // A later background failure must not blank an already-rendered screen.
      if (!abort.signal.aborted && ticket === generation) {
        readFailed = true;
        store.set({
          patch: { loading: false, error: error instanceof Error ? error.message : 'Failed to load media' },
        });
        // Retry reads only, never destructive writes. Keep trying at a capped delay so
        // recovery needs no manual repair, while an offline service isn't hammered.
        if (isRetryableMediaError({ error })) {
          const delay = Math.min(1000 * 2 ** Math.min(retryAttempt++, 5), 30000);
          retryTimer = setTimeout(() => { retryTimer = null; void load(); }, delay);
        }
      }
    } finally {
      if (ticket === generation) store.set({ patch: { loading: false } });
    }
  }
  let writes: Promise<unknown> = Promise.resolve();
  let exclusiveWrite = false;
  function write(run: () => Promise<unknown>, id?: string) {
    if (store.signal.aborted || exclusiveWrite || (id === undefined ? store.getSnapshot().busy : store.getSnapshot().pendingIds.includes(id))) return Promise.resolve(false);
    if (id === undefined) exclusiveWrite = true;
    // Serialize accepted writes rather than dropping another card's click. Reserve
    // each id immediately so a double click on the same asset cannot enqueue twice.
    store.set({ patch: { busy: true, pendingIds: id === undefined ? store.getSnapshot().pendingIds : [...store.getSnapshot().pendingIds, id] } });
    const operation = writes.then(async () => {
      if (store.signal.aborted) return false;
      // Starting a write clears other writes' failures, so a stale failure from one must
      // not survive past the start of an unrelated one.
      generation++; readAbort?.abort(); cancelRetry();
      store.set({ patch: { loading: false, error: null } });
      try {
        await run();
        if (store.signal.aborted) return false;
        await load();
        return true;
      } catch (error) {
        if (!store.signal.aborted) store.set({ patch: { loading: false, error: error instanceof Error ? error.message : 'Media write failed' } });
        return false;
      } finally {
        if (id === undefined) exclusiveWrite = false;
        const pendingIds = store.getSnapshot().pendingIds.filter(value => value !== id);
        store.set({ patch: { busy: pendingIds.length > 0, pendingIds } });
      }
    });
    writes = operation.catch(() => undefined);
    return operation;
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    load,
    async setQuery({ query }: { query: MediaQuery }, _optional: Record<string, never> = {}) {
      // Already-fetched full library owns display order/filtering. Tab/search/order changes
      // never spend another request or flash a loading zero badge.
      store.set({ patch: { query, ...(library ? { items: queryMedia({ media: library, query }) } : {}) } });
      if (!library || readFailed) await load();
    },
    async upload(
      { input, alt = '' }: { input: UploadInput; alt?: string },
      _optional: Record<string, never> = {},
    ) {
      return write(() => api.upload(input, { alt, signal: store.signal }));
    },
    // Trashing (the reversible first rung of the ladder) has no confirm step — only
    // the irreversible purge step gates on the dialog, matching the original asymmetry.
    async trash({ id }: { id: string }, _optional: Record<string, never> = {}) {
      return write(() => api.trash({ id }, { signal: store.signal }), id);
    },
    async restore({ id }: { id: string }, _optional: Record<string, never> = {}) {
      if (!canRestoreMedia({ api })) {
        store.set({ patch: { error: 'Restoring media is unavailable' } });
        return false;
      }
      return write(() => api.restore!({ id }, { signal: store.signal }), id);
    },
    requestPurge({ item }: { item: MediaAsset }, _optional: Record<string, never> = {}) {
      if (!store.getSnapshot().busy && item.status === 'trashed')
        store.set({ patch: { pendingPurge: item } });
    },
    cancelPurge(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      if (!store.getSnapshot().busy) store.set({ patch: { pendingPurge: null } });
    },
    async confirmPurge(
      { confirmed }: { confirmed: boolean },
      _optional: Record<string, never> = {},
    ) {
      const item = store.getSnapshot().pendingPurge;
      if (!confirmed || !item) return false;
      const saved = await write(async () => {
        const result = await api.delete({ id: item.id }, { signal: store.signal });
        if (!result.purged) throw new Error('The file was not permanently deleted');
        // A failed follow-up read must not leave a permanently deleted card focusable.
        if (library) {
          library = library.filter(row => row.id !== item.id);
          store.set({ patch: { items: queryMedia({ media: library, query: store.getSnapshot().query }), counts: countMediaTabs({ media: library }) } });
        }
      });
      if (saved) store.set({ patch: { pendingPurge: null } });
      return saved;
    },
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      generation++;
      cancelRetry();
      readAbort?.abort();
      store.dispose();
    },
  };
}
