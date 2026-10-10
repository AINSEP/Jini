import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useCachedLoader, useFetchQuery, useInvalidate } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminComment, AdminCommentsPort, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import { createCommentQueueController } from '../../controllers/comment-queue.controller.js';
import { KEYS, emptyRowState, type RowActionState } from '../../rules.js';
import type { CommentsEventsPort } from '../../ports.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import { useCommentsPorts, useCommentsTranslation } from './CommentsPorts.hooks.js';

const NO_GRANTS: readonly string[] = [];

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
  const loadPageRef = useRef<((required: { status: CommentStatus; cursor: string }) => Promise<import('../../../core/ports/comments.js').AdminCommentsQueuePage>) | null>(null);
  const { controller, snapshot } = useController({
    create: () => createCommentQueueController({ api, permissions }, { t, onInvalidate: invalidateQueue, loadPage: required => loadPageRef.current!(required) }),
    dependencies: [api, invalidateQueue],
  });
  useEffect(() => { controller?.configure({ permissions, t }); }, [controller, permissions, t]);
  const status = snapshot?.status ?? 'pending';
  const cursor = snapshot?.nextCursor ?? '';
  const cursorKey = useMemo(() => [...KEYS.queue(status), 'cursor', cursor], [status, cursor]);
  const fetchCursor = useCallback(() => api.listCommentsQueue({}, { status, cursor }), [api, status, cursor]);
  const cursorLoader = useCachedLoader({ key: cursorKey, fetch: fetchCursor }, { staleTime: 0 });
  // The gesture remains controller-owned, including its same-tick lock and generation fence.
  // Only I/O changes: cursor pages now share page one's provider and status invalidation prefix.
  loadPageRef.current = ({ status: requestedStatus, cursor: requestedCursor }) => cursorLoader.load({
    key: [...KEYS.queue(requestedStatus), 'cursor', requestedCursor],
    fetch: () => api.listCommentsQueue({}, { status: requestedStatus, cursor: requestedCursor }),
  });
  const firstPage = useFetchQuery({ key: KEYS.queue(status), fetch: () => api.listCommentsQueue({}, { status }) });
  useEffect(() => { controller?.settleFirstPage({ page: firstPage.data ?? null, error: firstPage.error, status }); }, [controller, firstPage.data, firstPage.error, status]);
  // Stable identity avoids resubscribing on every render. The host filters out unrelated
  // resources. Unmount removes the subscription even if another cache observer remains active.
  useEffect(() => events?.subscribe({ onRefresh: invalidateQueue }), [events, invalidateQueue]);
  return {
    status,
    setStatus: value => { if (controller) controller.setStatus({ status: typeof value === 'function' ? value(controller.getSnapshot().status) : value }); },
    items: snapshot?.items ?? null, nextCursor: snapshot?.nextCursor ?? null,
    error: snapshot?.error ?? null, loadingMore: snapshot?.loadingMore ?? false,
    loadMore: () => controller?.loadMore({}),
    stateFor: id => controller?.stateFor({ id }) ?? emptyRowState(),
    onModerate: async (comment, action) => { await controller?.onModerate({ comment, action }); },
    pendingPurge: snapshot?.pendingPurge ?? null,
    setPendingPurge: value => { if (controller) controller.setPendingPurge({ comment: typeof value === 'function' ? value(controller.getSnapshot().pendingPurge) : value }); },
    onPurge: async () => { await controller?.onPurge({}); },
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
