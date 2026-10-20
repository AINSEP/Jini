import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useCachedLoader, useFetchQuery, useInvalidate } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import type { CommentQueueState } from '../../models.js';
import { createCommentQueueController } from '../../controllers/comment-queue.controller.js';
import { KEYS, emptyRowState, type RowActionState } from '../../rules.js';
import type { CommentsEventsPort } from '../../ports.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import { useCommentsPorts, useCommentsTranslation } from './CommentsPorts.hooks.js';

const NO_GRANTS: readonly string[] = [];
/** What renders before the controller's first snapshot; mirrors the controller's initial state. */
const BEFORE_FIRST_SNAPSHOT: CommentQueueState = Object.freeze({
  status: 'pending', items: null, nextCursor: null, error: null, loadingMore: false, rowState: {}, pendingPurge: null,
});
type QueueStore = ReturnType<typeof createCommentQueueController>;
type QueuePageLoader = (required: { status: CommentStatus; cursor: string }) => Promise<AdminCommentsQueuePage>;

export interface CommentQueueController {
  status: CommentStatus;
  setStatus: Dispatch<SetStateAction<CommentStatus>>;
  items: readonly AdminComment[] | null;
  nextCursor: string | null;
  error: string | null;
  loadingMore: boolean;
  loadMore: () => void;
  stateFor: (id: string) => RowActionState;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => Promise<void>;
  pendingPurge: AdminComment | null;
  setPendingPurge: Dispatch<SetStateAction<AdminComment | null>>;
  onPurge: () => Promise<void>;
}
function resolveSetState<T>({ value, current }: { value: SetStateAction<T>; current: T }, _optional: Record<string, never> = {}): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(current) : value;
}
/** Before the controller exists every gesture is inert and every row reads as idle. */
function bindQueueActions(
  { controller }: { controller: QueueStore | null },
  _optional: Record<string, never> = {},
): Pick<CommentQueueController, 'setStatus' | 'loadMore' | 'stateFor' | 'onModerate' | 'setPendingPurge' | 'onPurge'> {
  return {
    setStatus: value => { if (controller) controller.setStatus({ status: resolveSetState({ value, current: controller.getSnapshot().status }) }); },
    loadMore: () => controller?.loadMore({}),
    stateFor: id => controller?.stateFor({ id }) ?? emptyRowState(),
    onModerate: async (comment, action) => { await controller?.onModerate({ comment, action }); },
    setPendingPurge: value => { if (controller) controller.setPendingPurge({ comment: resolveSetState({ value, current: controller.getSnapshot().pendingPurge }) }); },
    onPurge: async () => { await controller?.onPurge({}); },
  };
}
/** Cursor pages share page one's cache provider, so a status invalidation reaches them too. */
function useCursorPageLoader(
  { api, status, cursor }: { api: AdminCommentsPort; status: CommentStatus; cursor: string },
  _optional: Record<string, never> = {},
): QueuePageLoader {
  const cursorKey = useMemo(() => [...KEYS.queue(status), 'cursor', cursor], [status, cursor]);
  const fetchCursor = useCallback(() => api.listCommentsQueue({}, { status, cursor }), [api, status, cursor]);
  const cursorLoader = useCachedLoader({ key: cursorKey, fetch: fetchCursor }, { staleTime: 0 });
  return ({ status: requestedStatus, cursor: requestedCursor }) => cursorLoader.load({
    key: [...KEYS.queue(requestedStatus), 'cursor', requestedCursor],
    fetch: () => api.listCommentsQueue({}, { status: requestedStatus, cursor: requestedCursor }),
  });
}
/** Effects attach to injected ports; cursor/row state belongs to the headless controller.
 * The shared cache guards stale page-one keys. Cursor settlement is guarded separately because
 * one fixed query key cannot represent an accumulated list of appended pages.
 */
export function useCommentQueue(
  { api, permissions = NO_GRANTS }: { api: AdminCommentsPort; permissions?: readonly string[] },
  { t = englishComments, events }: { t?: CommentsTranslator; events?: CommentsEventsPort } = {},
): CommentQueueController {
  const invalidate = useInvalidate();
  const invalidateQueue = useCallback(() => invalidate({ key: KEYS.queueRoot }), [invalidate]);
  const loadPageRef = useRef<QueuePageLoader | null>(null);
  const { controller, snapshot } = useController({
    create: () => createCommentQueueController({ api, permissions }, { t, onInvalidate: invalidateQueue, loadPage: required => loadPageRef.current!(required) }),
    dependencies: [api, invalidateQueue],
  });
  useEffect(() => { controller?.configure({ permissions, t }); }, [controller, permissions, t]);
  const view = snapshot ?? BEFORE_FIRST_SNAPSHOT;
  const { status } = view;
  // The gesture remains controller-owned, including its same-tick lock and generation fence.
  // Only I/O changes: cursor pages now share page one's provider and status invalidation prefix.
  loadPageRef.current = useCursorPageLoader({ api, status, cursor: view.nextCursor ?? '' });
  const firstPage = useFetchQuery({ key: KEYS.queue(status), fetch: () => api.listCommentsQueue({}, { status }) });
  useEffect(() => { controller?.settleFirstPage({ page: firstPage.data ?? null, error: firstPage.error, status }); }, [controller, firstPage.data, firstPage.error, status]);
  // Stable identity avoids resubscribing on every render. The host filters out unrelated
  // resources. Unmount removes the subscription even if another cache observer remains active.
  useEffect(() => events?.subscribe({ onRefresh: invalidateQueue }), [events, invalidateQueue]);
  return {
    status, items: view.items, nextCursor: view.nextCursor, error: view.error,
    loadingMore: view.loadingMore, pendingPurge: view.pendingPurge,
    ...bindQueueActions({ controller }),
  };
}
export function useWiredCommentQueue(
  { permissions }: { permissions: readonly string[] },
  _optional: Record<string, never> = {},
): CommentQueueController {
  const { commentsApi, commentsEvents } = useCommentsPorts();
  const t = useCommentsTranslation();
  return useCommentQueue({ api: commentsApi, permissions }, { t, ...(commentsEvents ? { events: commentsEvents } : {}) });
}
