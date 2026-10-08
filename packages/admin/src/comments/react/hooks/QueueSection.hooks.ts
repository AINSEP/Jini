import { createElement, type ChangeEvent } from 'react';
import { buildAgentListHandles } from '@jini-ai/agentic';
import { formatTimestamp } from '@jini-ai/ui/panel-kit';
import type { DataTableColumn } from '../../../react/components/DataTable.js';
import type { AdminComment, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import { commentRowMenuItems, truncate, type RowActionState } from '../../rules.js';
import type { CommentsTranslator } from '../../messages.en.js';
import { QueueActionsCell, type QueueSectionProps } from '../components/QueueSection.js';
import { useWiredCommentQueue } from './use-comment-queue.hooks.js';
import { useCommentsTranslation } from './CommentsPorts.hooks.js';

export function useQueueSection(props: QueueSectionProps, _optional: Record<string, never> = {}) {
  const contextT = useCommentsTranslation();
  const useQueue = props.useCommentQueueHook ?? useWiredCommentQueue;
  const queue = useQueue({ permissions: props.permissions });
  return { ...queue, t: props.t ?? contextT,
    purgeBusy: queue.pendingPurge !== null && queue.stateFor(queue.pendingPurge.id).busy,
    onCancelPurge: () => queue.setPendingPurge(null) };
}
export function useQueueToolbar({ onStatusChange }: { onStatusChange: (status: CommentStatus) => void }, _optional: Record<string, never> = {}) {
  return { onChange: (event: ChangeEvent<HTMLSelectElement>) => onStatusChange(event.target.value as CommentStatus) };
}
export function useQueueActionsCell(props: {
  comment: AdminComment; permissions: readonly string[]; status: CommentStatus; t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}, _optional: Record<string, never> = {}) {
  return { menuItems: commentRowMenuItems({ comment: props.comment,
    context: { permissions: props.permissions, currentFilterStatus: props.status },
    handlers: { onModerate: props.onModerate, onRequestPurge: props.onRequestPurge } }, { t: props.t }) };
}
/** Builds the `DataTable` column descriptors. A plain function rather than a closure declared
 *  inside `QueueTable`'s body — it doesn't need to be a hook-scoped closure, only the values
 *  already threaded through its parameters. */
export function queueColumns(props: {
  permissions: readonly string[];
  status: CommentStatus;
  stateFor: (id: string) => RowActionState;
  t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
  handleForRow: (commentId: string) => string;
}, _optional: Record<string, never> = {}): DataTableColumn<AdminComment>[] {
  return [
    { key: "author", header: props.t("Author"), cell: (comment) => comment.authorName },
    { key: "comment", header: props.t("Comment"), cell: (comment) => truncate({ text: comment.bodyText, max: 120 }) },
    {
      key: "status",
      header: props.t("Status"),
      cell: (comment) => createElement('span', { className: `status status-${comment.status}` }, props.t(comment.status)),
    },
    { key: "depth", header: props.t("Depth"), cell: (comment) => comment.depth },
    { key: "created", header: props.t("Created"), cell: (comment) => formatTimestamp({ iso: comment.createdAt }, { timeZone: "local" }) },
    {
      key: "actions",
      header: props.t("More"),
      cell: (comment) => createElement(QueueActionsCell, {
        comment, agentHandleBase: props.handleForRow(comment.id), permissions: props.permissions,
        status: props.status, rowState: props.stateFor(comment.id), t: props.t,
        onModerate: props.onModerate, onRequestPurge: props.onRequestPurge,
      }),
    },
  ];
}


export function useQueueTable(props: {
  items: readonly AdminComment[]; permissions: readonly string[]; status: CommentStatus;
  stateFor: (id: string) => RowActionState; t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}, _optional: Record<string, never> = {}) {
  // Rows page in over "Load more", so handles are derived fresh each render from whichever rows
  // are currently on screen — same per-row-id lookup `Database.tsx`'s `TimelineBody` uses, needed
  // because `DataTable`'s `cell` callback only receives the row, not its index.
  const rowHandles = buildAgentListHandles({ prefix: "comments-row", ids: props.items.map((comment) => comment.id) }
  );
  const handleById = new Map(props.items.map((comment, index) => [comment.id, rowHandles[index]!]));

  return { columns: queueColumns({ ...props, handleForRow: commentId => handleById.get(commentId)! }) };
}
