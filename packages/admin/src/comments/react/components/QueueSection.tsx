import type { AdminComment, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import type { CommentsTranslator } from '../../messages.en.js';
import type { RowActionState } from '../../rules.js';
import { DataTable } from '../../../react/components/DataTable.js';
import { RowMenu } from '../../../react/components/RowMenu/RowMenu.js';
import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { agentHandle } from '@jini-ai/agentic';
import { interpolate } from '@jini-ai/ui/panel-kit';
import { useWiredCommentQueue } from '../hooks/use-comment-queue.hooks.js';
import { useQueueSection, useQueueActionsCell, useQueueTable, useQueueToolbar } from '../hooks/QueueSection.hooks.js';

const STATUS_OPTIONS: readonly CommentStatus[] = ["pending", "approved", "spam", "trash"];

/** The status-filter `<select>` — pure presentation, no state of its own. */
function QueueToolbar({
  status,
  onStatusChange,
  t,
}: {
  status: CommentStatus;
  onStatusChange: (s: CommentStatus) => void;
  t: CommentsTranslator;
}) {
  const { onChange } = useQueueToolbar({ onStatusChange });
  return (
    <div className="toolbar">
      <div className="field">
        <label className="field-label" htmlFor="comments-status-filter">
          {t("Status")}
        </label>
        <select
          id="comments-status-filter"
          value={status}
          onChange={onChange}
          {...agentHandle({ handle: "comments-status-filter" }, { role: "field", label: "Filter the moderation queue by status" })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** The moderation-queue table's "More" column — a `RowMenu` built from `commentRowMenuItems`, or
 *  an em dash when the operator's permissions leave no items, plus this row's own error (if the
 *  last action against it failed). Top-level rather than an inline `cell` closure so it has its
 *  own directly-testable scope, per `commentRowMenuItems`'s own risk ranking. */
export function QueueActionsCell(props: {
  comment: AdminComment;
  agentHandleBase: string;
  permissions: readonly string[];
  status: CommentStatus;
  rowState: RowActionState;
  t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}) {
  const { menuItems } = useQueueActionsCell(props);
  return (
    <>
      {menuItems.length > 0 ? (
        <RowMenu
          triggerLabel={interpolate({ template: props.t('Actions for the comment by "{author}"'), vars: {
            author: props.comment.authorName,
          } })}
          agentHandle={`${props.agentHandleBase}-menu`}
          items={menuItems}
        />
      ) : (
        <span className="muted-cell">—</span>
      )}
      {props.rowState.error ? (
        <div className="notice error" role="alert">
          {props.rowState.error}
        </div>
      ) : null}
    </>
  );
}

/** The populated-queue view: the table plus its "Load more" pager. Only rendered once
 *  `QueueItemsView` has already ruled out the loading/empty states. */
function QueueTable(props: {
  items: readonly AdminComment[];
  nextCursor: string | null;
  loadingMore: boolean;
  loadMore: () => void;
  permissions: readonly string[];
  status: CommentStatus;
  stateFor: (id: string) => RowActionState;
  t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}) {
  const { columns } = useQueueTable(props);
  return (
    <>
      <DataTable
        rows={props.items}
        rowKey={(comment) => comment.id}
        columns={columns}
      />
      {props.nextCursor ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={props.loadMore}
          disabled={props.loadingMore}
          {...agentHandle({ handle: "comments-load-more" }, { role: "button", label: "Load more comments" })}
        >
          {props.loadingMore ? props.t("Loading…") : props.t("Load more")}
        </button>
      ) : null}
    </>
  );
}

/** Dispatches between the three queue-body states (loading / empty / populated) as a flat
 *  if-chain instead of a nested ternary — the nesting was the cognitive-complexity cost in the
 *  original inline JSX, not the branch count itself. */
function QueueItemsView(props: {
  items: readonly AdminComment[] | null;
  status: CommentStatus;
  nextCursor: string | null;
  loadingMore: boolean;
  loadMore: () => void;
  permissions: readonly string[];
  stateFor: (id: string) => RowActionState;
  t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}) {
  if (!props.items) return <div className="notice">{props.t("Loading comments…")}</div>;
  if (props.items.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>{interpolate({ template: props.t("No {status} comments."), vars: { status: props.status } })}</p>
        </div>
      </div>
    );
  }
  return <QueueTable {...props} items={props.items} />;
}

/** The Purge confirm dialog. Stays mounted unconditionally (driven by `open`) — see
 *  `useCommentQueue`'s `pendingPurge` doc comment for why. */
function QueuePurgeDialog(props: {
  pendingPurge: AdminComment | null;
  busy: boolean;
  t: CommentsTranslator;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.pendingPurge !== null}
      agentHandle="comments-purge"
      title={props.t("Permanently delete this comment?")}
      body={
        props.pendingPurge ? (
          <p>
            {interpolate({ template: props.t('Permanently delete this comment by "{author}"? This cannot be undone.'), vars: {
              author: props.pendingPurge.authorName,
            } })}
          </p>
        ) : null
      }
      confirmLabel={props.t("Permanently delete")}
      destructive
      pending={props.busy}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}

export interface QueueSectionProps {
  permissions: readonly string[];
  t?: CommentsTranslator;
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (the exported
   *  `Comments` below) pass nothing and behave exactly as before. */
  useCommentQueueHook?: typeof useWiredCommentQueue;
}

/** Exported (2026-08-14, previously module-private) so `QueueSection.unit.test.tsx` can drive its
 *  own DI seam directly — the same reason `AiAssistant.tsx`'s `AdminExecutionMode` is exported. */
export function QueueSection(props: QueueSectionProps) {
  const {
    t,
    status,
    setStatus,
    items,
    nextCursor,
    error,
    loadingMore,
    loadMore,
    stateFor,
    onModerate,
    pendingPurge,
    setPendingPurge,
    onPurge,
    onCancelPurge,
    purgeBusy,
  } = useQueueSection(props);

  if (error && !items) return <div className="notice error">{error}</div>;

  return (
    <div>
      <QueueToolbar status={status} onStatusChange={setStatus} t={t} />

      {error ? <div className="notice error">{error}</div> : null}

      <QueueItemsView
        items={items}
        status={status}
        nextCursor={nextCursor}
        loadingMore={loadingMore}
        loadMore={loadMore}
        permissions={props.permissions}
        stateFor={stateFor}
        t={t}
        onModerate={onModerate}
        onRequestPurge={setPendingPurge}
      />

      <QueuePurgeDialog
        pendingPurge={pendingPurge}
        busy={purgeBusy}
        t={t}
        onConfirm={onPurge}
        onCancel={onCancelPurge}
      />
    </div>
  );
}

