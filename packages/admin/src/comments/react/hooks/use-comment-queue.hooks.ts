import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useCachedLoader, useFetchQuery, useInvalidate } from '@jini-ai/ui/fetch-query';
import { useController } from '../../../core/react/use-controller.js';
import type { AdminComment, AdminCommentsPort, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import { createCommentQueueController } from '../../controllers/comment-queue.controller.js';
import { KEYS, emptyRowState, type RowActionState } from '../../rules.js';
import type { CommentsEventsPort } from '../../ports.js';
import { englishComments, type CommentsTranslator } from '../../messages.en.js';
import type { CommentQueueState } from '../../models.js';
import { useCommentsPorts, useCommentsTranslation } from './CommentsPorts.hooks.js';

const NO_GRANTS: readonly string[] = [];

// The host binds workspace and principal to an API instance. Weak keys preserve sharing
// between consumers of that instance without retaining APIs from previous sessions.
const queueScopes = new WeakMap<AdminCommentsPort, number>();
let nextQueueScope = 0;

/** Allocate a cache namespace for a scoped API; never infer tenancy from returned rows. */
function queueScope({ api }: { api: AdminCommentsPort }): number {
  let scope = queueScopes.get(api);
  if (scope === undefined) {
    scope = ++nextQueueScope;
    queueScopes.set(api, scope);
  }
  return scope;
}

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

type QueueDisplay = Pick<CommentQueueController, 'status' | 'items' | 'nextCursor' | 'error' | 'loadingMore' | 'pendingPurge'>;
type QueueActions = Omit<CommentQueueController, keyof QueueDisplay>;

/** Preserve the hook's loading defaults while no controller from the current scope is attached. */
function queueDisplay({ snapshot }: { snapshot: CommentQueueState | null }): QueueDisplay {
  const { status, items, nextCursor, error, loadingMore, pendingPurge } = snapshot ?? {
    status: 'pending', items: null, nextCursor: null, error: null, loadingMore: false, pendingPurge: null,
  };
  return { status, items, nextCursor, error, loadingMore, pendingPurge };
}

/** Adapt public React setters/actions to the attached headless controller; loading actions stay inert. */
function queueActions({ controller }: { controller: ReturnType<typeof createCommentQueueController> | null }): QueueActions {
  return {
    setStatus: value => { if (controller) controller.setStatus({ status: typeof value === 'function' ? value(controller.getSnapshot().status) : value }); },
    loadMore: () => controller?.loadMore({}),
    stateFor: id => controller?.stateFor({ id }) ?? emptyRowState(),
    onModerate: async (comment, action) => { await controller?.onModerate({ comment, action }); },
    setPendingPurge: value => { if (controller) controller.setPendingPurge({ comment: typeof value === 'function' ? value(controller.getSnapshot().pendingPurge) : value }); },
    onPurge: async () => { await controller?.onPurge({}); },
  };
}

/** Effects attach to injected ports; cursor/row state belongs to the headless controller.
 * The shared cache guards stale page-one keys. Cursor settlement is guarded separately because
 * one fixed query key cannot represent an accumulated list of appended pages.
 * All read/invalidation keys include the API's workspace/principal scope. Hosts must replace
 * the scoped API when either changes; the public hook arguments stay unchanged.
 */
export function useCommentQueue(
  { api, permissions = NO_GRANTS }: { api: AdminCommentsPort; permissions?: readonly string[] },
  { t = englishComments, events }: { t?: CommentsTranslator; events?: CommentsEventsPort } = {},
): CommentQueueController {
  const invalidate = useInvalidate();
  const queueRoot = useMemo(() => [...KEYS.queueRoot, queueScope({ api })], [api]);
  const invalidateQueue = useCallback(() => invalidate({ key: queueRoot }), [invalidate, queueRoot]);
  const loadPageRef = useRef<((required: { status: CommentStatus; cursor: string }) => Promise<import('../../../core/ports/comments.js').AdminCommentsQueuePage>) | null>(null);
  const { controller: attachedController, snapshot: attachedSnapshot } = useController({
    create: () => ({ ...createCommentQueueController({ api, permissions }, { t, onInvalidate: invalidateQueue, loadPage: required => loadPageRef.current!(required) }), api }),
    dependencies: [api, invalidateQueue],
  });
  // Effects replace the controller after commit; hide the previous scope during that render too.
  const controller = attachedController?.api === api ? attachedController : null;
  const snapshot = controller ? attachedSnapshot : null;
  useEffect(() => { controller?.configure({ permissions, t }); }, [controller, permissions, t]);
  const display = queueDisplay({ snapshot });
  const { status } = display;
  const cursor = display.nextCursor ?? '';
  const cursorKey = useMemo(() => [...queueRoot, status, 'cursor', cursor], [queueRoot, status, cursor]);
  const fetchCursor = useCallback(() => api.listCommentsQueue({}, { status, cursor }), [api, status, cursor]);
  const cursorLoader = useCachedLoader({ key: cursorKey, fetch: fetchCursor }, { staleTime: 0 });
  // The gesture remains controller-owned, including its same-tick lock and generation fence.
  // Only I/O changes: cursor pages now share page one's provider and status invalidation prefix.
  loadPageRef.current = ({ status: requestedStatus, cursor: requestedCursor }) => cursorLoader.load({
    key: [...queueRoot, requestedStatus, 'cursor', requestedCursor],
    fetch: () => api.listCommentsQueue({}, { status: requestedStatus, cursor: requestedCursor }),
  });
  const firstPage = useFetchQuery({ key: [...queueRoot, status], fetch: () => api.listCommentsQueue({}, { status }) });
  useEffect(() => { controller?.settleFirstPage({ page: firstPage.data ?? null, error: firstPage.error, status }); }, [controller, firstPage.data, firstPage.error, status]);
  // Stable identity avoids resubscribing on every render. The host filters out unrelated
  // resources. Unmount removes the subscription even if another cache observer remains active.
  useEffect(() => events?.subscribe({ onRefresh: invalidateQueue }), [events, invalidateQueue]);
  return { ...display, ...queueActions({ controller }) };
}
export function useWiredCommentQueue(
  { permissions }: { permissions: readonly string[] },
  _optional: Record<string, never> = {},
): CommentQueueController {
  const { commentsApi, commentsEvents } = useCommentsPorts();
  const t = useCommentsTranslation();
  return useCommentQueue({ api: commentsApi, permissions }, { t, ...(commentsEvents ? { events: commentsEvents } : {}) });
}
