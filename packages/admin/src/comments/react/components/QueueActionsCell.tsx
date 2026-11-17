import type { AdminComment, CommentModerationAction, CommentStatus } from '../../../core/ports/comments.js';
import type { CommentsTranslator } from '../../messages.en.js';
import type { RowActionState } from '../../rules.js';
import { RowMenu } from '../../../react/components/RowMenu/RowMenu.js';

import { useQueueActionsCell } from '../hooks/QueueActionsCell.hooks.js';

import { interpolate } from '@jini-ai/core/text';

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
