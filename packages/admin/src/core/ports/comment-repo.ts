/**
 * @file `AdminCommentRepo` — the three comment-store operations the in-memory admin comments adapter calls.
 *
 * Restated structurally from the comments domain's repository (the queue returns whole comments, as the admin queue shows them); the host
 * supplies a factory that seeds a store from initial comments.
 */
import type { AdminComment } from './comments.js';

type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';
type ModerationAction = 'approve' | 'mark_spam' | 'unspam' | 'trash' | 'restore';

export interface AdminCommentRepo {
  listModerationQueue(
    required: { workspaceId: string; status: CommentStatus; limit: number; cursor?: string | null },
    optional?: Record<string, never>,
  ): Promise<{ items: AdminComment[]; nextCursor: string | null }>;
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
