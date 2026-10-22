import type { AdminComment, CommentsSettings, CommentStatus } from '../core/ports/comments.js';
import type { RowActionState } from './rules.js';

export interface CommentsState {
  readonly permissions: readonly string[] | null;
  readonly error: string | null;
}
export interface CommentQueueState {
  readonly status: CommentStatus;
  readonly items: readonly AdminComment[] | null;
  readonly nextCursor: string | null;
  readonly error: string | null;
  readonly loadingMore: boolean;
  readonly rowState: Readonly<Record<string, RowActionState>>;
  readonly pendingPurge: AdminComment | null;
}
export interface CommentSettingsState {
  readonly settings: CommentsSettings | null;
  readonly error: string | null;
  readonly saving: boolean;
  readonly notice: string | null;
}
