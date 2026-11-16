/**
 * @file `AdminCommentRepo` — the three comment-store operations the in-memory admin comments adapter calls.
 *
 * Restated structurally from the comments domain's repository (only the fields the adapter reads); the host
 * supplies a factory that seeds a store from initial comments.
 */
type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';
type ModerationAction = 'approve' | 'mark_spam' | 'unspam' | 'trash' | 'restore';
interface RepoComment { readonly id: string; readonly workspaceId: string; readonly status: CommentStatus; readonly version: number }

export interface AdminCommentRepo {
  listModerationQueue(
    required: { workspaceId: string; status: CommentStatus; limit: number; cursor?: string | null },
    optional?: Record<string, never>,
  ): Promise<{ items: RepoComment[]; nextCursor: string | null }>;
  applyModeration(
    required: {
      workspaceId: string; id: string; expectedVersion: number; action: ModerationAction; toStatus: CommentStatus;
      actorPrincipalId: string; note: string | null; at: string;
    },
    optional?: Record<string, never>,
  ): Promise<{ ok: true } | { ok: false; reason: 'not-found' | 'conflict'; currentVersion?: number | undefined }>;
  purge(
    required: { workspaceId: string; id: string; actorPrincipalId: string; note: string | null; at: string },
    optional?: Record<string, never>,
  ): Promise<{ ok: true } | { ok: false; reason: 'not-found' }>;
}

export type AdminCommentRepoFactory = (required: { initialComments: readonly unknown[] }, optional?: Record<string, never>) => AdminCommentRepo;
