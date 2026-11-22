import type { AdminComment, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import { commentRowMenuItems } from '../../rules.js';
import type { CommentsTranslator } from '../../messages.en.js';

export function useQueueActionsCell(props: {
  comment: AdminComment; permissions: readonly string[]; status: CommentStatus; t: CommentsTranslator;
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  onRequestPurge: (comment: AdminComment) => void;
}, _optional: Record<string, never> = {}) {
  return { menuItems: commentRowMenuItems({ comment: props.comment,
    context: { permissions: props.permissions, currentFilterStatus: props.status },
    handlers: { onModerate: props.onModerate, onRequestPurge: props.onRequestPurge } }, { t: props.t }) };
}
