import { describe, expect, it } from 'vitest';
import { memoryCommentsApi } from './fakes/comment-repo.js';
import { createMemoryCommentsApi } from '../adapters/memory.js';
import type { AdminCommentRepo } from '../../core/ports/comment-repo.js';
import type { AdminComment, CommentModerationAction, CommentsSettings } from '../../core/ports/comments.js';
import { AdminApiError } from '@jini-ai/core/admin-runtime';

const SEED: AdminComment = { id: 'c1', entryId: 'e1', parentId: null, threadRootId: 'c1',
  depth: 0, status: 'pending', authorPrincipalId: null, authorName: 'Reader', authorEmail: null,
  authorUrl: null, authorIpHash: null, bodyText: 'Hello', spamScore: null, spamProvider: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };

/** Wire-shaped input a host could forward unchecked; JSON keeps it honest without a type cast. */
function untrusted<T>(json: string): T {
  return JSON.parse(json) as T;
}

async function caught(run: () => Promise<unknown>): Promise<AdminApiError> {
  try {
    await run();
  } catch (e) {
    if (e instanceof AdminApiError) return e;
    throw e;
  }
  throw new Error('expected the call to reject with AdminApiError');
}

describe('createMemoryCommentsApi settings validation', () => {
  const invalid: ReadonlyArray<[string, Partial<CommentsSettings>, string]> = [
    ['enabled not boolean', untrusted('{"enabled":"yes"}'), 'enabled must be a boolean'],
    ['requireModeration not boolean', untrusted('{"requireModeration":1}'), 'requireModeration must be a boolean'],
    ['maxDepth fractional', { maxDepth: 1.5 }, 'maxDepth must be an integer from 0 to 20'],
    ['maxDepth below 0', { maxDepth: -1 }, 'maxDepth must be an integer from 0 to 20'],
    ['maxDepth above 20', { maxDepth: 21 }, 'maxDepth must be an integer from 0 to 20'],
    ['closeAfterDays fractional', { closeAfterDays: 0.5 }, 'closeAfterDays must be null or a non-negative integer'],
    ['closeAfterDays negative', { closeAfterDays: -1 }, 'closeAfterDays must be null or a non-negative integer'],
    ['spamAutoRejectScore NaN', { spamAutoRejectScore: Number.NaN }, 'spamAutoRejectScore must be a number from 0 to 1'],
    ['spamAutoRejectScore below 0', { spamAutoRejectScore: -0.1 }, 'spamAutoRejectScore must be a number from 0 to 1'],
    ['spamAutoRejectScore above 1', { spamAutoRejectScore: 1.1 }, 'spamAutoRejectScore must be a number from 0 to 1'],
    ['maxPerIpPerHour fractional', { maxPerIpPerHour: 2.5 }, 'maxPerIpPerHour must be an integer from 1 to 1000'],
    ['maxPerIpPerHour below 1', { maxPerIpPerHour: 0 }, 'maxPerIpPerHour must be an integer from 1 to 1000'],
    ['maxPerIpPerHour above 1000', { maxPerIpPerHour: 1001 }, 'maxPerIpPerHour must be an integer from 1 to 1000'],
  ];
  for (const [name, patch, reason] of invalid) {
    it(`rejects ${name} with 400 naming the field`, async () => {
      const api = memoryCommentsApi({});
      const error = await caught(() => api.putCommentsSettings({}, patch));
      expect(error.status).toBe(400);
      expect(error.message).toBe(`Invalid Comments settings: ${reason}`);
    });
  }

  it('accepts every inclusive boundary value', async () => {
    const api = memoryCommentsApi({});
    const low = { enabled: false, requireModeration: false, maxDepth: 0, closeAfterDays: 0, spamAutoRejectScore: 0, maxPerIpPerHour: 1 };
    expect(await api.putCommentsSettings({}, low)).toEqual(low);
    const high = { enabled: true, requireModeration: true, maxDepth: 20, closeAfterDays: 365, spamAutoRejectScore: 1, maxPerIpPerHour: 1000 };
    expect(await api.putCommentsSettings({}, high)).toEqual(high);
  });

  it('keeps stored settings unchanged after a rejected patch', async () => {
    const api = memoryCommentsApi({});
    const before = await api.getCommentsSettings({});
    await caught(() => api.putCommentsSettings({}, { maxDepth: 99 }));
    expect(await api.getCommentsSettings({})).toEqual(before);
  });

  it('treats an omitted patch as a no-op that returns a frozen copy', async () => {
    const api = memoryCommentsApi({});
    const result = await api.putCommentsSettings({});
    expect(result).toEqual(await api.getCommentsSettings({}));
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('createMemoryCommentsApi queue listing', () => {
  it('lists the pending queue when no options are passed', async () => {
    const api = memoryCommentsApi({ items: [SEED, { ...SEED, id: 'c2', threadRootId: 'c2', status: 'spam' }] });
    const page = await api.listCommentsQueue({});
    expect(page.items.map(item => item.id)).toEqual(['c1']);
  });
});

describe('createMemoryCommentsApi moderation and purge refusals', () => {
  it('rejects an unknown moderation action with 400 naming it', async () => {
    const api = memoryCommentsApi({ items: [SEED] });
    const error = await caught(() => api.moderateComment({ commentId: 'c1', action: untrusted<CommentModerationAction>('"toString"'), expectedVersion: 1 }));
    expect(error.status).toBe(400);
    expect(error.message).toBe('Invalid moderation action "toString": use approve, spam, trash or restore');
  });

  it('rejects a stale version with 409 and the current version in the body', async () => {
    const api = memoryCommentsApi({ items: [SEED] });
    const error = await caught(() => api.moderateComment({ commentId: 'c1', action: 'approve', expectedVersion: 7 }));
    expect(error.status).toBe(409);
    expect(error.body).toEqual({ currentVersion: 1 });
    expect(error.message).toBe('Comment c1 changed since it was loaded (current version 1); reload the queue and retry');
  });

  it('rejects moderating a missing comment with 404 and no body', async () => {
    const api = memoryCommentsApi({ items: [SEED] });
    const error = await caught(() => api.moderateComment({ commentId: 'nope', action: 'spam', expectedVersion: 1 }));
    expect(error.status).toBe(404);
    expect(error.body).toBeUndefined();
    expect(error.message).toBe('Comment nope was not found in this workspace');
  });

  it('rejects purging a missing comment with 404', async () => {
    const api = memoryCommentsApi({ items: [SEED] });
    const error = await caught(() => api.purgeComment({ commentId: 'nope' }, { note: 'gone' }));
    expect(error.status).toBe(404);
    expect(error.message).toBe('Comment nope was not found in this workspace');
  });

  it('records the moderation note and clock on an accepted action', async () => {
    const api = memoryCommentsApi({ items: [SEED] }, { now: () => '2026-10-10T00:00:00.000Z' });
    await api.moderateComment({ commentId: 'c1', action: 'approve', expectedVersion: 1 }, { note: 'ok' });
    const page = await api.listCommentsQueue({}, { status: 'approved' });
    expect(page.items.map(item => [item.id, item.status, item.version])).toEqual([['c1', 'approved', 2]]);
  });
});

describe('createMemoryCommentsApi repository binding', () => {
  /** A repository that records what the adapter asks of it, so argument order and field placement are pinned. */
  function recordingRepo() {
    const calls: Array<{ method: string; args: unknown }> = [];
    const repo: AdminCommentRepo = {
      async listModerationQueue(args) { calls.push({ method: 'listModerationQueue', args }); return { items: [], nextCursor: null }; },
      async applyModeration(args) { calls.push({ method: 'applyModeration', args }); return { ok: true }; },
      async purge(args) { calls.push({ method: 'purge', args }); return { ok: true }; },
    };
    const seeded: unknown[][] = [];
    return { calls, seeded, repoFactory: ({ initialComments }: { initialComments: readonly unknown[] }) => { seeded.push([...initialComments]); return repo; } };
  }
  const NOW = () => '2026-10-10T00:00:00.000Z';

  it('seeds the repository it is handed with the items, filling in the workspace', () => {
    const { repoFactory, seeded } = recordingRepo();
    createMemoryCommentsApi({ items: [SEED], repoFactory }, { workspaceId: 'w9' });
    expect(seeded).toEqual([[{ ...SEED, workspaceId: 'w9' }]]);
  });

  it('lists the queue through the repository with the status, limit and optional cursor', async () => {
    const { repoFactory, calls } = recordingRepo();
    const api = createMemoryCommentsApi({ repoFactory }, { workspaceId: 'w9' });
    await api.listCommentsQueue({}, { status: 'spam', limit: 500, cursor: 'k' });
    await api.listCommentsQueue({}, {});
    expect(calls).toEqual([
      { method: 'listModerationQueue', args: { workspaceId: 'w9', status: 'spam', limit: 100, cursor: 'k' } },
      { method: 'listModerationQueue', args: { workspaceId: 'w9', status: 'pending', limit: 20 } },
    ]);
  });

  it('moderates and purges through the repository with the action, target status, actor, note and clock', async () => {
    const { repoFactory, calls } = recordingRepo();
    const api = createMemoryCommentsApi({ repoFactory }, { workspaceId: 'w9', now: NOW });
    await api.moderateComment({ commentId: 'c1', action: 'spam', expectedVersion: 3 }, { note: 'bot' });
    await api.purgeComment({ commentId: 'c1' }, {});
    expect(calls).toEqual([
      { method: 'applyModeration', args: { workspaceId: 'w9', id: 'c1', expectedVersion: 3, action: 'mark_spam', toStatus: 'spam', actorPrincipalId: '__admin-memory__', note: 'bot', at: NOW() } },
      { method: 'purge', args: { workspaceId: 'w9', id: 'c1', actorPrincipalId: '__admin-memory__', note: null, at: NOW() } },
    ]);
  });

  it('reports the repository\'s not-found and conflict outcomes as 404 and 409', async () => {
    const repo: AdminCommentRepo = {
      listModerationQueue: async () => ({ items: [], nextCursor: null }),
      applyModeration: async ({ id }) => (id === 'stale' ? { ok: false, reason: 'conflict', currentVersion: 7 } : { ok: false, reason: 'not-found' }),
      purge: async () => ({ ok: false, reason: 'not-found' }),
    };
    const api = createMemoryCommentsApi({ repoFactory: () => repo });
    expect((await caught(() => api.moderateComment({ commentId: 'stale', action: 'approve', expectedVersion: 1 }, {}))).status).toBe(409);
    expect((await caught(() => api.moderateComment({ commentId: 'gone', action: 'approve', expectedVersion: 1 }, {}))).status).toBe(404);
    expect((await caught(() => api.purgeComment({ commentId: 'gone' }, {}))).status).toBe(404);
  });
});
