import { createControllerStore } from '../../core/module/controller-store.js';
import { hasPermission } from '../../core/permissions/rules.js';
import { describeApiError } from '../../core/transport/errors.js';
import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage, CommentModerationAction, CommentStatus } from '../../core/ports/comments.js';
import type { CommentQueueState } from '../models.js';
import { describeModerationError, emptyRowState, type RowActionState } from '../rules.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';

type QueueStore = ReturnType<typeof createControllerStore<CommentQueueState>>;
type LoadPage = (required: { status: CommentStatus; cursor: string }) => Promise<AdminCommentsQueuePage>;

/** Mutable closure state shared by the queue actions; one instance per controller. */
interface QueueCtx {
  readonly store: QueueStore;
  readonly api: AdminCommentsPort;
  readonly onInvalidate: (() => void) | undefined;
  readonly loadPage: LoadPage | undefined;
  permissions: readonly string[];
  t: CommentsTranslator;
  firstPage: AdminCommentsQueuePage | null;
  morePages: readonly AdminComment[];
  firstError: Error | null;
  moreError: string | null;
  pageGeneration: number;
  loadingMore: boolean;
  // Synchronous checked-then-set lock: React's busy render cannot block two same-tick actions.
  // Different actions on the same row share this lock; different rows remain independent.
  readonly busyRowIds: Set<string>;
}

function publishPages({ ctx }: { ctx: QueueCtx }) {
  const { store, t } = ctx;
  store.set({ patch: {
    items: ctx.firstPage ? [...ctx.firstPage.items, ...ctx.morePages] : null,
    error: ctx.moreError ?? (ctx.firstError ? describeApiError({ e: ctx.firstError, fallback: t('failed to load the moderation queue') }) : null),
  } });
}
// Accumulated pages belong to the current first page. A status switch or refreshed page one
// supersedes an in-flight cursor read AND releases its synchronous lock, avoiding stuck busy.
function resetMorePages({ ctx }: { ctx: QueueCtx }) {
  ctx.pageGeneration++;
  ctx.loadingMore = false;
  ctx.morePages = [];
  ctx.moreError = null;
  ctx.store.set({ patch: { loadingMore: false } });
}
function patchRowState({ ctx, id, patch }: { ctx: QueueCtx; id: string; patch: Partial<RowActionState> }) {
  const current = ctx.store.getSnapshot().rowState;
  ctx.store.set({ patch: { rowState: { ...current, [id]: { ...emptyRowState(), ...current[id], ...patch } } } });
}
function reloadAfterAction({ ctx }: { ctx: QueueCtx }) {
  resetMorePages({ ctx });
  publishPages({ ctx });
  // An action moves a row to another status. Invalidating only the current filter would leave
  // previously visited status caches stale, so the hook invalidates KEYS.queueRoot.
  ctx.onInvalidate?.();
}
/** A cursor read may only publish while it is still the newest one and the store is live. */
function isCurrentRead({ ctx, generation }: { ctx: QueueCtx; generation: number }) {
  return generation === ctx.pageGeneration && !ctx.store.signal.aborted;
}
function readMorePage({ ctx, status, cursor }: { ctx: QueueCtx; status: CommentStatus; cursor: string }) {
  return ctx.loadPage ? ctx.loadPage({ status, cursor }) : ctx.api.listCommentsQueue({}, { status, cursor });
}
async function loadMore({ ctx }: { ctx: QueueCtx }) {
  const { store } = ctx;
  const { nextCursor, status } = store.getSnapshot();
  if (store.signal.aborted || !nextCursor || ctx.loadingMore) return;
  ctx.loadingMore = true;
  ctx.pageGeneration += 1;
  const generation = ctx.pageGeneration;
  ctx.moreError = null; // A retry clears the prior failure before its request settles.
  store.set({ patch: { loadingMore: true } });
  publishPages({ ctx });
  try {
    const page = await readMorePage({ ctx, status, cursor: nextCursor });
    if (!isCurrentRead({ ctx, generation })) return;
    ctx.morePages = [...ctx.morePages, ...page.items];
    store.set({ patch: { nextCursor: page.nextCursor } });
    publishPages({ ctx });
  } catch (e) {
    if (!isCurrentRead({ ctx, generation })) return;
    ctx.moreError = describeApiError({ e, fallback: ctx.t('failed to load the moderation queue') });
    publishPages({ ctx });
  } finally {
    // The reset already released a superseded call's lock; it must not unlock a newer call.
    if (isCurrentRead({ ctx, generation })) {
      ctx.loadingMore = false;
      store.set({ patch: { loadingMore: false } });
    }
  }
}
async function onModerate({ ctx, comment, action }: { ctx: QueueCtx; comment: AdminComment; action: CommentModerationAction }) {
  const { store, busyRowIds } = ctx;
  const permission = action === 'trash' ? 'comments.delete' : 'comments.moderate';
  if (store.signal.aborted || !hasPermission({ permissions: ctx.permissions, permission }) || busyRowIds.has(comment.id)) return;
  busyRowIds.add(comment.id);
  patchRowState({ ctx, id: comment.id, patch: { busy: true, error: null } });
  try {
    await ctx.api.moderateComment({ commentId: comment.id, action, expectedVersion: comment.version });
    if (!store.signal.aborted) reloadAfterAction({ ctx });
  } catch (e) {
    patchRowState({ ctx, id: comment.id, patch: { busy: false, error: describeModerationError({ e }, { t: ctx.t }) } });
  } finally {
    busyRowIds.delete(comment.id);
  }
}
/** Confirmation closes on success and failure. Errors remain on the affected row. */
async function onPurge({ ctx }: { ctx: QueueCtx }) {
  const { store, busyRowIds } = ctx;
  const comment = store.getSnapshot().pendingPurge;
  if (store.signal.aborted || !comment || !hasPermission({ permissions: ctx.permissions, permission: 'comments.delete.force' }) || busyRowIds.has(comment.id)) return;
  busyRowIds.add(comment.id);
  patchRowState({ ctx, id: comment.id, patch: { busy: true, error: null } });
  try {
    await ctx.api.purgeComment({ commentId: comment.id });
    if (!store.signal.aborted) reloadAfterAction({ ctx });
  } catch (e) {
    patchRowState({ ctx, id: comment.id, patch: { busy: false, error: describeApiError({ e, fallback: ctx.t('Failed to purge comment.') }) } });
  } finally {
    busyRowIds.delete(comment.id);
    store.set({ patch: { pendingPurge: null } });
  }
}
function settleFirstPage({ ctx, page, error, status }: { ctx: QueueCtx; page: AdminCommentsQueuePage | null; error: Error | null; status: CommentStatus }) {
  if (ctx.store.signal.aborted || status !== ctx.store.getSnapshot().status) return;
  // A successful new page drops stale cursor pages. Error-only notifications do not erase
  // already rendered data or invalidate a current cursor read.
  if (page !== ctx.firstPage) {
    resetMorePages({ ctx });
    ctx.firstPage = page;
    ctx.store.set({ patch: { nextCursor: page?.nextCursor ?? null } });
  }
  ctx.firstError = error;
  publishPages({ ctx });
}
function setStatus({ ctx, status }: { ctx: QueueCtx; status: CommentStatus }) {
  if (ctx.store.signal.aborted || status === ctx.store.getSnapshot().status) return;
  resetMorePages({ ctx });
  ctx.firstPage = null;
  ctx.firstError = null;
  ctx.store.set({ patch: { status, items: null, nextCursor: null, error: null, rowState: {} } });
}
/** Locale/grant changes update affordances without losing the existing cursor or row state. */
function configure({ ctx, permissions, t }: { ctx: QueueCtx; permissions: readonly string[]; t: CommentsTranslator }) {
  if (ctx.store.signal.aborted) return;
  ctx.permissions = permissions;
  if (ctx.t === t) return;
  ctx.t = t;
  publishPages({ ctx });
}

/** Headless cursor accumulation and per-row actions; page one remains owned by fetch-query.
 * Permissions are affordances, denied by default. Every server write must reauthorize.
 * @param required The core API and current session grants.
 * @param optional Translator and an invalidation callback for every cached status.
 * @returns An instance-scoped store and actions; dispose makes pending settlements inert.
 */
export function createCommentQueueController(
  { api, permissions = [] }: { api: AdminCommentsPort; permissions?: readonly string[] },
  { t = englishComments, onInvalidate, loadPage }: { t?: CommentsTranslator; onInvalidate?: () => void; loadPage?: LoadPage } = {},
) {
  const store = createControllerStore<CommentQueueState>({ initial: {
    status: 'pending', items: null, nextCursor: null, error: null, loadingMore: false,
    rowState: {}, pendingPurge: null,
  } });
  const ctx: QueueCtx = {
    store, api, onInvalidate, loadPage, permissions, t, firstPage: null, morePages: [],
    firstError: null, moreError: null, pageGeneration: 0, loadingMore: false, busyRowIds: new Set<string>(),
  };
  function dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    ctx.pageGeneration++;
    ctx.busyRowIds.clear();
    store.dispose();
  }
  return {
    getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose,
    stateFor: ({ id }: { id: string }, _optional: Record<string, never> = {}): RowActionState => store.getSnapshot().rowState[id] ?? emptyRowState(),
    configure: (args: { permissions: readonly string[]; t: CommentsTranslator }, _optional: Record<string, never> = {}) => configure({ ctx, ...args }),
    setStatus: (args: { status: CommentStatus }, _optional: Record<string, never> = {}) => setStatus({ ctx, ...args }),
    settleFirstPage: (args: { page: AdminCommentsQueuePage | null; error: Error | null; status: CommentStatus }, _optional: Record<string, never> = {}) => settleFirstPage({ ctx, ...args }),
    loadMore: (_required: Record<string, never> = {}, _optional: Record<string, never> = {}) => loadMore({ ctx }),
    onModerate: (args: { comment: AdminComment; action: CommentModerationAction }, _optional: Record<string, never> = {}) => onModerate({ ctx, ...args }),
    setPendingPurge: ({ comment }: { comment: AdminComment | null }, _optional: Record<string, never> = {}) => store.set({ patch: { pendingPurge: comment } }),
    onPurge: (_required: Record<string, never> = {}, _optional: Record<string, never> = {}) => onPurge({ ctx }),
  };
}
