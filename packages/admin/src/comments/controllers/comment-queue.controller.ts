import { createControllerStore } from '../../core/module/controller-store.js';
import { hasPermission } from '../../core/permissions/rules.js';
import { describeApiError } from '../../core/transport/errors.js';
import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage, CommentModerationAction, CommentStatus } from '../../core/ports/comments.js';
import type { CommentQueueState } from '../models.js';
import { describeModerationError, emptyRowState, type RowActionState } from '../rules.js';
import { englishComments, type CommentsTranslator } from '../messages.en.js';

/** Headless cursor accumulation and per-row actions; page one remains owned by fetch-query.
 * Permissions are affordances, denied by default. Every server write must reauthorize.
 * @param required The core API and current session grants.
 * @param optional Translator and an invalidation callback for every cached status.
 * @returns An instance-scoped store and actions; dispose makes pending settlements inert.
 */
export function createCommentQueueController(
  { api, permissions = [] }: { api: AdminCommentsPort; permissions?: readonly string[] },
  { t = englishComments, onInvalidate }: { t?: CommentsTranslator; onInvalidate?: () => void } = {},
) {
  const store = createControllerStore<CommentQueueState>({ initial: {
    status: 'pending', items: null, nextCursor: null, error: null, loadingMore: false,
    rowState: {}, pendingPurge: null,
  } });
  let firstPage: AdminCommentsQueuePage | null = null;
  let morePages: readonly AdminComment[] = [];
  let firstError: Error | null = null;
  let moreError: string | null = null;
  let pageGeneration = 0;
  let loadingMore = false;
  // Synchronous checked-then-set lock: React's busy render cannot block two same-tick actions.
  // Different actions on the same row share this lock; different rows remain independent.
  const busyRowIds = new Set<string>();

  function publishPages() {
    store.set({ patch: {
      items: firstPage ? [...firstPage.items, ...morePages] : null,
      error: moreError ?? (firstError ? describeApiError({ e: firstError, fallback: t('failed to load the moderation queue') }) : null),
    } });
  }
  // Accumulated pages belong to the current first page. A status switch or refreshed page one
  // supersedes an in-flight cursor read AND releases its synchronous lock, avoiding stuck busy.
  function resetMorePages() {
    pageGeneration++;
    loadingMore = false;
    morePages = [];
    moreError = null;
    store.set({ patch: { loadingMore: false } });
  }
  function patchRowState(id: string, patch: Partial<RowActionState>) {
    const current = store.getSnapshot().rowState;
    store.set({ patch: { rowState: { ...current, [id]: { ...emptyRowState(), ...current[id], ...patch } } } });
  }
  function reloadAfterAction() {
    resetMorePages();
    publishPages();
    // An action moves a row to another status. Invalidating only the current filter would leave
    // previously visited status caches stale, so the hook invalidates KEYS.queueRoot.
    onInvalidate?.();
  }
  function stateFor({ id }: { id: string }, _optional: Record<string, never> = {}): RowActionState {
    return store.getSnapshot().rowState[id] ?? emptyRowState();
  }
  /** Locale/grant changes update affordances without losing the existing cursor or row state. */
  function configure(
    { permissions: nextPermissions, t: nextTranslator }: { permissions: readonly string[]; t: CommentsTranslator },
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted) return;
    permissions = nextPermissions;
    t = nextTranslator;
    publishPages();
  }
  function setStatus({ status }: { status: CommentStatus }, _optional: Record<string, never> = {}) {
    if (store.signal.aborted || status === store.getSnapshot().status) return;
    resetMorePages();
    firstPage = null;
    firstError = null;
    store.set({ patch: { status, items: null, nextCursor: null, error: null, rowState: {} } });
  }
  function settleFirstPage(
    { page, error, status }: { page: AdminCommentsQueuePage | null; error: Error | null; status: CommentStatus },
    _optional: Record<string, never> = {},
  ) {
    if (store.signal.aborted || status !== store.getSnapshot().status) return;
    // A successful new page drops stale cursor pages. Error-only notifications do not erase
    // already rendered data or invalidate a current cursor read.
    if (page !== firstPage) {
      resetMorePages();
      firstPage = page;
      store.set({ patch: { nextCursor: page?.nextCursor ?? null } });
    }
    firstError = error;
    publishPages();
  }
  async function loadMore(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const { nextCursor, status } = store.getSnapshot();
    if (store.signal.aborted || !nextCursor || loadingMore) return;
    loadingMore = true;
    const generation = ++pageGeneration;
    moreError = null; // A retry clears the prior failure before its request settles.
    store.set({ patch: { loadingMore: true } });
    publishPages();
    try {
      const page = await api.listCommentsQueue({}, { status, cursor: nextCursor });
      if (generation !== pageGeneration || store.signal.aborted) return;
      morePages = [...morePages, ...page.items];
      store.set({ patch: { nextCursor: page.nextCursor } });
      publishPages();
    } catch (e) {
      if (generation !== pageGeneration || store.signal.aborted) return;
      moreError = describeApiError({ e, fallback: t('failed to load the moderation queue') });
      publishPages();
    } finally {
      // The reset already released a superseded call's lock; it must not unlock a newer call.
      if (generation === pageGeneration && !store.signal.aborted) {
        loadingMore = false;
        store.set({ patch: { loadingMore: false } });
      }
    }
  }
  async function onModerate(
    { comment, action }: { comment: AdminComment; action: CommentModerationAction },
    _optional: Record<string, never> = {},
  ) {
    const permission = action === 'trash' ? 'comments.delete' : 'comments.moderate';
    if (store.signal.aborted || !hasPermission({ permissions, permission }) || busyRowIds.has(comment.id)) return;
    busyRowIds.add(comment.id);
    patchRowState(comment.id, { busy: true, error: null });
    try {
      await api.moderateComment({ commentId: comment.id, action, expectedVersion: comment.version });
      if (!store.signal.aborted) reloadAfterAction();
    } catch (e) {
      patchRowState(comment.id, { busy: false, error: describeModerationError({ e }, { t }) });
    } finally {
      busyRowIds.delete(comment.id);
    }
  }
  function setPendingPurge({ comment }: { comment: AdminComment | null }, _optional: Record<string, never> = {}) {
    store.set({ patch: { pendingPurge: comment } });
  }
  /** Confirmation closes on success and failure. Errors remain on the affected row. */
  async function onPurge(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    const comment = store.getSnapshot().pendingPurge;
    if (store.signal.aborted || !comment || !hasPermission({ permissions, permission: 'comments.delete.force' }) || busyRowIds.has(comment.id)) return;
    busyRowIds.add(comment.id);
    patchRowState(comment.id, { busy: true, error: null });
    try {
      await api.purgeComment({ commentId: comment.id });
      if (!store.signal.aborted) reloadAfterAction();
    } catch (e) {
      patchRowState(comment.id, { busy: false, error: describeApiError({ e, fallback: t('Failed to purge comment.') }) });
    } finally {
      busyRowIds.delete(comment.id);
      setPendingPurge({ comment: null });
    }
  }
  function dispose(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
    pageGeneration++;
    busyRowIds.clear();
    store.dispose();
  }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, dispose, stateFor,
    configure, setStatus, settleFirstPage, loadMore, onModerate, setPendingPurge, onPurge };
}
