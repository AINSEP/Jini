import { InMemoryCommentRepo } from '@jini-ai/cms/comments';
import { optionalOneOf, readToolLimit } from '@jini-ai/core';
import type { AdminComment, AdminCommentsPort, CommentsSettings, CommentStatus } from '../../core/ports/comments.js';
import { AdminApiError } from '../../core/transport/errors.js';

const DEFAULT_SETTINGS: CommentsSettings = {
  enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null,
  spamAutoRejectScore: 0.5, maxPerIpPerHour: 20,
};

/** Isolated admin contract fixture over the existing CMS memory repository.
 * Keyset paging, optimistic concurrency and deletion belong to that repository, not this screen.
 * Settings here are an ephemeral read-your-writes fixture; production persistence stays in the
 * host's layered settings ledger. No ingress, auth, outbox or trash-index service is simulated.
 * @param required Seeded comments and settings, copied so later writes cannot alter input fixtures.
 * @param optional Workspace scope and deterministic clock for moderation metadata.
 * @returns The core API with immutable snapshots and decoded status/body errors.
 */
export function createMemoryCommentsApi(
  { items = [], settings = DEFAULT_SETTINGS }: { items?: readonly AdminComment[]; settings?: CommentsSettings },
  { workspaceId = items[0]?.workspaceId ?? '__comments-memory__', now = () => '2026-10-07T00:00:00.000Z' }: { workspaceId?: string; now?: () => string } = {},
): AdminCommentsPort {
  const repo = new InMemoryCommentRepo({ initialComments: items.map(item => ({ ...item, workspaceId: item.workspaceId ?? workspaceId })) });
  let storedSettings = Object.freeze({ ...settings });
  function failure(message: string, status: number, body?: Record<string, unknown>): never {
    throw new AdminApiError({ message, status }, { body });
  }
  return {
    async listCommentsQueue(_required, options = {}) {
      // Same validators as the moderation-queue route: omitted limit is 20, >100 is capped.
      const status = optionalOneOf({ input: options, key: 'status', values: ['pending', 'approved', 'spam', 'trash'] as const }) ?? 'pending';
      const limit = readToolLimit({ input: options, max: 100, fallback: 20 });
      const page = await repo.listModerationQueue({ workspaceId, status, limit, ...(options.cursor ? { cursor: options.cursor } : {}) });
      return Object.freeze({ items: Object.freeze(page.items.map(item => Object.freeze({ ...item }))), nextCursor: page.nextCursor });
    },
    async moderateComment({ commentId, action, expectedVersion }, { note } = {}) {
      const statuses: Record<string, CommentStatus> = { approve: 'approved', spam: 'spam', trash: 'trash', restore: 'approved' };
      const toStatus = Object.hasOwn(statuses, action) ? statuses[action] : undefined;
      if (!toStatus) failure('Invalid moderation action', 400);
      const result = await repo.applyModeration({ workspaceId, id: commentId, expectedVersion,
        action: action === 'spam' ? 'mark_spam' : action, toStatus,
        actorPrincipalId: '__admin-memory__', note: note ?? null, at: now() });
      if (!result.ok) failure(result.reason === 'conflict' ? 'Comment changed' : 'Comment was not found', result.reason === 'conflict' ? 409 : 404,
        result.reason === 'conflict' ? { currentVersion: result.currentVersion } : undefined);
    },
    async purgeComment({ commentId }, { note } = {}) {
      const result = await repo.purge({ workspaceId, id: commentId, actorPrincipalId: '__admin-memory__', note: note ?? null, at: now() });
      if (!result.ok) failure('Comment was not found', 404);
    },
    async getCommentsSettings(_required: Record<string, never>, _options: Record<string, never> = {}) { return Object.freeze({ ...storedSettings }); },
    async putCommentsSettings(_required, patch = {}) {
      // Only fixture-level shape checks: the durable ledger remains the production validator.
      const next = { ...storedSettings, ...patch };
      if (typeof next.enabled !== 'boolean' || typeof next.requireModeration !== 'boolean'
        || !Number.isInteger(next.maxDepth) || next.maxDepth < 0 || next.maxDepth > 20
        || (next.closeAfterDays !== null && (!Number.isInteger(next.closeAfterDays) || next.closeAfterDays < 0))
        || !Number.isFinite(next.spamAutoRejectScore) || next.spamAutoRejectScore < 0 || next.spamAutoRejectScore > 1
        || !Number.isInteger(next.maxPerIpPerHour) || next.maxPerIpPerHour < 1 || next.maxPerIpPerHour > 1000) failure('Invalid Comments settings', 400);
      storedSettings = Object.freeze(next);
      return Object.freeze({ ...storedSettings });
    },
  };
}
