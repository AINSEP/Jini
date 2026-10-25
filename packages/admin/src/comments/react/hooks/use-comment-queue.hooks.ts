import { createContext, createElement, useContext, useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { useCachedLoader, useFetchQuery, useInvalidate, useFetchQueryScope } from '@jini-ai/ui/fetch-query';
import { AdminConfigError } from '../../../core/module/create-admin.js';
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

/** Host-owned identity; never infer tenancy or the current operator from returned rows. */
export interface CommentQueueScope {
  readonly workspaceId: string;
  readonly principalId: string;
}
const CommentQueueScopeContext = createContext<CommentQueueScope | null>(null);

/** Supply live workspace/principal identity to wired queues, including with a singleton API.
 * Update scope at the authentication boundary before rendering the next principal's children.
 */
export function CommentQueueScopeProvider({ scope, children }: { scope: CommentQueueScope; children: ReactNode }) {
  return createElement(CommentQueueScopeContext.Provider, { value: scope }, children);
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
function queueDisplay({ snapshot }: { snapshot: CommentQueueState | null }, _optional: Record<string, never> = {}): QueueDisplay {
  const { status, items, nextCursor, error, loadingMore, pendingPurge } = snapshot ?? BEFORE_FIRST_SNAPSHOT;
  return { status, items, nextCursor, error, loadingMore, pendingPurge };
}

/** Resolve React's value/updater forms against the attached controller's current snapshot. */
function resolveSetState<T>({ value, current }: { value: SetStateAction<T>; current: T }, _optional: Record<string, never> = {}): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(current) : value;
}
/** Adapt public React setters/actions to the attached headless controller.
 * Before the controller exists every gesture is inert and every row reads as idle.
 */
function bindQueueActions(
  { controller }: { controller: QueueStore | null },
  _optional: Record<string, never> = {},
): QueueActions {
  return {
    setStatus: value => { if (controller) controller.setStatus({ status: resolveSetState({ value, current: controller.getSnapshot().status }) }); },
    loadMore: () => controller?.loadMore({}),
    stateFor: id => controller?.stateFor({ id }) ?? emptyRowState(),
    onModerate: async (comment, action) => { await controller?.onModerate({ comment, action }); },
    setPendingPurge: value => { if (controller) controller.setPendingPurge({ comment: resolveSetState({ value, current: controller.getSnapshot().pendingPurge }) }); },
    onPurge: async () => { await controller?.onPurge({}); },
  };
}
/** Cursor pages share page one's scoped cache prefix, so invalidation stays within that scope. */
function useCursorPageLoader(
  { api, queueRoot, status, cursor }: { api: AdminCommentsPort; queueRoot: readonly (string | number)[]; status: CommentStatus; cursor: string },
  _optional: Record<string, never> = {},
): QueuePageLoader {
  const cursorKey = useMemo(() => [...queueRoot, status, 'cursor', cursor], [queueRoot, status, cursor]);
  const fetchCursor = useCallback(() => api.listCommentsQueue({}, { status, cursor }), [api, status, cursor]);
  const cursorLoader = useCachedLoader({ key: cursorKey, fetch: fetchCursor }, { staleTime: 0 });
  return ({ status: requestedStatus, cursor: requestedCursor }) => cursorLoader.load({
    key: [...queueRoot, requestedStatus, 'cursor', requestedCursor],
    fetch: () => api.listCommentsQueue({}, { status: requestedStatus, cursor: requestedCursor }),
  });
}
/** Effects attach to injected ports; cursor/row state belongs to the headless controller.
 * The shared cache guards stale page-one keys. Cursor settlement is guarded separately because
 * one fixed query key cannot represent an accumulated list of appended pages.
 * All read/invalidation keys include explicit workspace/principal identity and API identity.
 * A scope change hides the previous controller immediately, before effect cleanup runs.
 */
export function useCommentQueue(
  { api, scope, permissions = NO_GRANTS }: { api: AdminCommentsPort; scope: CommentQueueScope; permissions?: readonly string[] },
  { t = englishComments, events }: { t?: CommentsTranslator; events?: CommentsEventsPort } = {},
): CommentQueueController {
  const invalidate = useInvalidate();
  // Weak API keys preserve sharing between consumers without retaining APIs from previous sessions.
  // Explicit workspace/principal keys below also isolate hosts that retain one API across sessions.
  const apiScope = useFetchQueryScope({ owner: api });
  const queueRoot = useMemo(() => [...KEYS.queueRoot, apiScope, scope.workspaceId, scope.principalId], [apiScope, scope.workspaceId, scope.principalId]);
  const invalidateQueue = useCallback(() => invalidate({ key: queueRoot }), [invalidate, queueRoot]);
  const loadPageRef = useRef<QueuePageLoader | null>(null);
  const { controller: attachedController, snapshot: attachedSnapshot } = useController({
    create: () => ({ ...createCommentQueueController({ api, permissions }, { t, onInvalidate: invalidateQueue, loadPage: required => loadPageRef.current!(required) }), queueRoot }),
    dependencies: [api, invalidateQueue],
  });
  // Effects replace the controller after commit; hide the previous scope during that render too.
  const controller = attachedController?.queueRoot === queueRoot ? attachedController : null;
  const snapshot = controller ? attachedSnapshot : null;
  useEffect(() => { controller?.configure({ permissions, t }); }, [controller, permissions, t]);
  const display = queueDisplay({ snapshot });
  const { status } = display;
  // The gesture remains controller-owned, including its same-tick lock and generation fence.
  // Only I/O changes: cursor pages now share page one's provider and status invalidation prefix.
  loadPageRef.current = useCursorPageLoader({ api, queueRoot, status, cursor: display.nextCursor ?? '' });
  const firstPage = useFetchQuery({ key: [...queueRoot, status], fetch: () => api.listCommentsQueue({}, { status }) });
  useEffect(() => { controller?.settleFirstPage({ page: firstPage.data ?? null, error: firstPage.error, status }); }, [controller, firstPage.data, firstPage.error, status]);
  // Stable identity avoids resubscribing on every render. The host filters out unrelated
  // resources. Unmount removes the subscription even if another cache observer remains active.
  useEffect(() => events?.subscribe({ onRefresh: invalidateQueue }), [events, invalidateQueue]);
  return { ...display, ...bindQueueActions({ controller }) };
}
export function useWiredCommentQueue(
  { permissions }: { permissions: readonly string[] },
  _optional: Record<string, never> = {},
): CommentQueueController {
  const { commentsApi, commentsEvents } = useCommentsPorts();
  const t = useCommentsTranslation();
  const scope = useContext(CommentQueueScopeContext);
  if (!scope) throw new AdminConfigError({ issues: ['Comment queue requires an explicit workspace/principal scope'] });
  return useCommentQueue({ api: commentsApi, scope, permissions }, { t, ...(commentsEvents ? { events: commentsEvents } : {}) });
}
