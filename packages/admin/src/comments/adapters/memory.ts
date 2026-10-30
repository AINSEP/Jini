import { InMemoryCommentRepo } from '@jini-ai/cms/comments';
import { optionalOneOf, readToolLimit } from '@jini-ai/core';
import type { AdminComment, AdminCommentsPort, CommentsSettings, CommentStatus } from '../../core/ports/comments.js';
import { AdminApiError } from '../../core/transport/errors.js';

const DEFAULT_SETTINGS: CommentsSettings = {
  enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null,
  spamAutoRejectScore: 0.5, maxPerIpPerHour: 20,
};
const MODERATION_STATUSES: Readonly<Record<string, CommentStatus>> = { approve: 'approved', spam: 'spam', trash: 'trash', restore: 'approved' };

function isNumberIn({ value, min, max }: { value: unknown; min: number; max: number }, { integer = false }: { integer?: boolean } = {}): boolean {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) return false;
  return (value as number) >= min && (value as number) <= max;
}
/** Each settings field with its fixture-level shape check and the expectation a refusal names. */
const SETTINGS_RULES: ReadonlyArray<readonly [keyof CommentsSettings, (value: unknown) => boolean, string]> = [
  ['enabled', value => typeof value === 'boolean', 'a boolean'],
  ['requireModeration', value => typeof value === 'boolean', 'a boolean'],
  ['maxDepth', value => isNumberIn({ value, min: 0, max: 20 }, { integer: true }), 'an integer from 0 to 20'],
  ['closeAfterDays', value => value === null || isNumberIn({ value, min: 0, max: Infinity }, { integer: true }), 'null or a non-negative integer'],
  ['spamAutoRejectScore', value => isNumberIn({ value, min: 0, max: 1 }), 'a number from 0 to 1'],
  ['maxPerIpPerHour', value => isNumberIn({ value, min: 1, max: 1000 }, { integer: true }), 'an integer from 1 to 1000'],
];
/** @returns A refusal reason naming the first invalid field, or null when every field is valid. */
function describeInvalidSettings({ settings }: { settings: CommentsSettings }, _optional: Record<string, never> = {}): string | null {
  const rule = SETTINGS_RULES.find(([field, isValid]) => !isValid(settings[field]));
  return rule ? `${rule[0]} must be ${rule[2]}` : null;
}

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
      const toStatus = Object.hasOwn(MODERATION_STATUSES, action) ? MODERATION_STATUSES[action] : undefined;
      if (!toStatus) failure(`Invalid moderation action "${action}": use approve, spam, trash or restore`, 400);
      const result = await repo.applyModeration({ workspaceId, id: commentId, expectedVersion,
        action: action === 'spam' ? 'mark_spam' : action, toStatus,
        actorPrincipalId: '__admin-memory__', note: note ?? null, at: now() });
      if (result.ok) return;
      if (result.reason === 'conflict') {
        failure(`Comment ${commentId} changed since it was loaded (current version ${result.currentVersion}); reload the queue and retry`, 409,
          { currentVersion: result.currentVersion });
      }
      failure(`Comment ${commentId} was not found in this workspace`, 404);
    },
    async purgeComment({ commentId }, { note } = {}) {
      const result = await repo.purge({ workspaceId, id: commentId, actorPrincipalId: '__admin-memory__', note: note ?? null, at: now() });
      if (!result.ok) failure(`Comment ${commentId} was not found in this workspace`, 404);
    },
    async getCommentsSettings(_required: Record<string, never>, _options: Record<string, never> = {}) { return Object.freeze({ ...storedSettings }); },
    async putCommentsSettings(_required, patch = {}) {
      // Only fixture-level shape checks: the durable ledger remains the production validator.
      const next = { ...storedSettings, ...patch };
      const invalid = describeInvalidSettings({ settings: next });
      if (invalid) failure(`Invalid Comments settings: ${invalid}`, 400);
      storedSettings = Object.freeze(next);
      return Object.freeze({ ...storedSettings });
    },
  };
}
