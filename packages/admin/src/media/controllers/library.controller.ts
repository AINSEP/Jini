import { createControllerStore } from '@jini-ai/core/admin-runtime';
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
type LibraryStore = ReturnType<typeof createControllerStore<LibraryState>>;

/** Mutable closure state shared by the library actions; one instance per controller. */
interface LibraryCtx {
  readonly store: LibraryStore;
  readonly api: MediaApiPort;
  library: readonly MediaAsset[] | null;
  readFailed: boolean;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  readAbort: AbortController | null;
  generation: number;
  writes: Promise<unknown>;
  exclusiveWrite: boolean;
}
function cancelRetry({ ctx }: { ctx: LibraryCtx }) {
  if (ctx.retryTimer !== null) clearTimeout(ctx.retryTimer);
  ctx.retryTimer = null;
}
/** Store patch for an accepted full library: filtered rows plus whole-library tab counts.
 * @complexity O(n) in the library size. */
function libraryView({ ctx, media }: { ctx: LibraryCtx; media: readonly MediaAsset[] }) {
  return { items: queryMedia({ media, query: ctx.store.getSnapshot().query }), counts: countMediaTabs({ media }) };
}
/** Commits a read that is still the latest one; items are frozen so consumers cannot mutate rows. */
function acceptRead({ ctx, all }: { ctx: LibraryCtx; all: readonly MediaAsset[] }) {
  ctx.readFailed = false;
  ctx.retryAttempt = 0;
  ctx.library = all;
  const { items, counts } = libraryView({ ctx, media: all });
  ctx.store.set({
    patch: {
      items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
      counts,
      hasUntyped: all.some((item) => item.contentType === null),
      error: null,
    },
  });
}
/** Publishes the latest read's failure and, when the failure is transient, schedules a retry. */
function failRead({ ctx, error }: { ctx: LibraryCtx; error: unknown }) {
  ctx.readFailed = true;
  ctx.store.set({
    patch: { loading: false, error: error instanceof Error ? error.message : 'Failed to load media' },
  });
  // Retry reads only, never destructive writes. Keep trying at a capped delay so
  // recovery needs no manual repair, while an offline service isn't hammered.
  if (isRetryableMediaError({ error })) {
    const delay = Math.min(1000 * 2 ** Math.min(ctx.retryAttempt, 5), 30000);
    ctx.retryAttempt += 1;
    ctx.retryTimer = setTimeout(() => { ctx.retryTimer = null; void load({ ctx }); }, delay);
  }
}
async function load({ ctx }: { ctx: LibraryCtx }) {
  const { store } = ctx;
  if (store.signal.aborted) return;
  cancelRetry({ ctx });
  ctx.readAbort?.abort();
  const abort = new AbortController();
  ctx.readAbort = abort;
  ctx.generation += 1;
  const ticket = ctx.generation;
  store.set({ patch: { loading: true, error: null } });
  try {
    const all = await ctx.api.list({}, { signal: abort.signal });
    if (ticket === ctx.generation) acceptRead({ ctx, all });
  } catch (error) {
    // A later background failure must not blank an already-rendered screen.
    if (!abort.signal.aborted && ticket === ctx.generation) failRead({ ctx, error });
  } finally {
    if (ticket === ctx.generation) store.set({ patch: { loading: false } });
  }
}
// A reactive cache observer may refresh this library without calling load again. Keep
// filtering/counts in the headless domain; accepting cache data must spend no extra read.
function settleLibrary({ ctx, all, error }: { ctx: LibraryCtx; all?: readonly MediaAsset[]; error?: Error | null }) {
  if (ctx.store.signal.aborted) return;
  if (all) {
    ctx.library = all;
    ctx.store.set({ patch: { ...libraryView({ ctx, media: all }), hasUntyped: all.some(item => item.contentType === null), error: null } });
  }
  if (error) ctx.store.set({ patch: { error: error.message } });
}
/** True when a write for this id (or an exclusive write) must be refused. */
function writeBlocked({ ctx, id }: { ctx: LibraryCtx; id: string | undefined }) {
  const snapshot = ctx.store.getSnapshot();
  if (ctx.store.signal.aborted || ctx.exclusiveWrite) return true;
  return id === undefined ? snapshot.busy : snapshot.pendingIds.includes(id);
}
/** Runs one accepted write, then reloads; resolves true only when it saved and the store is live. */
async function runWrite({ ctx, run, id }: { ctx: LibraryCtx; run: () => Promise<unknown>; id: string | undefined }) {
  const { store } = ctx;
  if (store.signal.aborted) return false;
  // Starting a write clears other writes' failures, so a stale failure from one must
  // not survive past the start of an unrelated one.
  ctx.generation++; ctx.readAbort?.abort(); cancelRetry({ ctx });
  store.set({ patch: { loading: false, error: null } });
  // A single exit: a write disposed mid-flight or a failed write reports false.
  let saved = false;
  try {
    await run();
    if (!store.signal.aborted) {
      await load({ ctx });
      saved = true;
    }
  } catch (error) {
    // The store ignores patches once disposed, so a write failing after dispose publishes nothing.
    store.set({ patch: { loading: false, error: error instanceof Error ? error.message : 'Media write failed' } });
  } finally {
    if (id === undefined) ctx.exclusiveWrite = false;
    const pendingIds = store.getSnapshot().pendingIds.filter(value => value !== id);
    store.set({ patch: { busy: pendingIds.length > 0, pendingIds } });
  }
  return saved;
}
function write({ ctx, run, id }: { ctx: LibraryCtx; run: () => Promise<unknown>; id?: string }) {
  const { store } = ctx;
  if (writeBlocked({ ctx, id })) return Promise.resolve(false);
  if (id === undefined) ctx.exclusiveWrite = true;
  // Serialize accepted writes rather than dropping another card's click. Reserve
  // each id immediately so a double click on the same asset cannot enqueue twice.
  const reserved = store.getSnapshot().pendingIds;
  store.set({ patch: { busy: true, pendingIds: id === undefined ? reserved : [...reserved, id] } });
  const operation = ctx.writes.then(() => runWrite({ ctx, run, id }));
  ctx.writes = operation.catch(() => undefined);
  return operation;
}
async function confirmPurge({ ctx, confirmed }: { ctx: LibraryCtx; confirmed: boolean }) {
  const { store, api } = ctx;
  const item = store.getSnapshot().pendingPurge;
  if (!confirmed || !item) return false;
  const saved = await write({ ctx, run: async () => {
    const result = await api.delete({ id: item.id }, { signal: store.signal });
    if (!result.purged) throw new Error('The file was not permanently deleted');
    // A failed follow-up read must not leave a permanently deleted card focusable.
    if (ctx.library) {
      ctx.library = ctx.library.filter(row => row.id !== item.id);
      store.set({ patch: libraryView({ ctx, media: ctx.library }) });
    }
  } });
  if (saved) store.set({ patch: { pendingPurge: null } });
  return saved;
}
async function setQuery({ ctx, query }: { ctx: LibraryCtx; query: MediaQuery }) {
  // Already-fetched full library owns display order/filtering. Tab/search/order changes
  // never spend another request or flash a loading zero badge.
  const { library } = ctx;
  ctx.store.set({ patch: { query, ...(library ? { items: queryMedia({ media: library, query }) } : {}) } });
  if (!library || ctx.readFailed) await load({ ctx });
}
async function restore({ ctx, id }: { ctx: LibraryCtx; id: string }) {
  const { api, store } = ctx;
  if (!canRestoreMedia({ api })) {
    store.set({ patch: { error: 'Restoring media is unavailable' } });
    return false;
  }
  return write({ ctx, run: () => api.restore!({ id }, { signal: store.signal }), id });
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
  const ctx: LibraryCtx = {
    store, api, library: null, readFailed: false, retryAttempt: 0, retryTimer: null,
    readAbort: null, generation: 0, writes: Promise.resolve(), exclusiveWrite: false,
  };
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    load: (_required: Record<string, never> = {}, _optional: Record<string, never> = {}) => load({ ctx }),
    settleLibrary: (args: { all?: readonly MediaAsset[]; error?: Error | null }, _optional: Record<string, never> = {}) => settleLibrary({ ctx, ...args }),
    setQuery: (args: { query: MediaQuery }, _optional: Record<string, never> = {}) => setQuery({ ctx, ...args }),
    upload: ({ input, alt = '' }: { input: UploadInput; alt?: string }, _optional: Record<string, never> = {}) =>
      write({ ctx, run: () => api.upload(input, { alt, signal: store.signal }) }),
    // Trashing (the reversible first rung of the ladder) has no confirm step — only
    // the irreversible purge step gates on the dialog, matching the original asymmetry.
    trash: ({ id }: { id: string }, _optional: Record<string, never> = {}) =>
      write({ ctx, run: () => api.trash({ id }, { signal: store.signal }), id }),
    restore: (args: { id: string }, _optional: Record<string, never> = {}) => restore({ ctx, ...args }),
    requestPurge({ item }: { item: MediaAsset }, _optional: Record<string, never> = {}) {
      if (!store.getSnapshot().busy && item.status === 'trashed')
        store.set({ patch: { pendingPurge: item } });
    },
    cancelPurge(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      if (!store.getSnapshot().busy) store.set({ patch: { pendingPurge: null } });
    },
    confirmPurge: (args: { confirmed: boolean }, _optional: Record<string, never> = {}) => confirmPurge({ ctx, ...args }),
    dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
      ctx.generation++;
      cancelRetry({ ctx });
      ctx.readAbort?.abort();
      store.dispose();
    },
  };
}
