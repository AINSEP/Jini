import { describe, expect, it, vi } from 'vitest';
import { createCommentQueueController } from '../controllers/comment-queue.controller.js';
import type { AdminComment, AdminCommentsPort, AdminCommentsQueuePage, CommentStatus } from '../../core/ports/comments.js';
import { AdminApiError } from '../../core/transport/errors.js';
import type { CommentsTranslator } from '../messages.en.js';

const ALL = ['comments.moderate', 'comments.delete', 'comments.delete.force'];
const C1: AdminComment = { id: 'c1', entryId: 'e1', parentId: null, threadRootId: 'c1',
  depth: 0, status: 'pending', authorPrincipalId: null, authorName: 'Reader', authorEmail: null,
  authorUrl: null, authorIpHash: null, bodyText: 'Hello', spamScore: null, spamProvider: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };
const C2: AdminComment = { ...C1, id: 'c2', threadRootId: 'c2' };
const C3: AdminComment = { ...C1, id: 'c3', threadRootId: 'c3' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function fakeApi(overrides: Partial<AdminCommentsPort> = {}): AdminCommentsPort {
  return {
    listCommentsQueue: vi.fn(async () => ({ items: [], nextCursor: null })),
    moderateComment: vi.fn(async () => undefined),
    purgeComment: vi.fn(async () => undefined),
    getCommentsSettings: vi.fn(async () => ({ enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 20 })),
    putCommentsSettings: vi.fn(async () => ({ enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 20 })),
    ...overrides,
  };
}
/** A controller whose page one holds C1 with a cursor, ready for loadMore. */
function seeded(
  { api = fakeApi(), permissions = ALL }: { api?: AdminCommentsPort; permissions?: readonly string[] } = {},
  options: Parameters<typeof createCommentQueueController>[1] = {},
) {
  const controller = createCommentQueueController({ api, permissions }, options);
  const page: AdminCommentsQueuePage = { items: [C1], nextCursor: 'k1' };
  controller.settleFirstPage({ page, error: null, status: 'pending' });
  return { controller, api, page };
}

describe('createCommentQueueController.loadMore', () => {
  it('does nothing without a next cursor', async () => {
    const api = fakeApi();
    const controller = createCommentQueueController({ api });
    await controller.loadMore();
    expect(api.listCommentsQueue).not.toHaveBeenCalled();
  });

  it('reads the next page through the API when no loader is injected and appends it', async () => {
    const api = fakeApi({ listCommentsQueue: vi.fn(async () => ({ items: [C2], nextCursor: 'k2' })) });
    const { controller } = seeded({ api });
    await controller.loadMore();
    expect(api.listCommentsQueue).toHaveBeenCalledWith({}, { status: 'pending', cursor: 'k1' });
    expect(controller.getSnapshot()).toMatchObject({ items: [C1, C2], nextCursor: 'k2', loadingMore: false, error: null });
  });

  it('reads through the injected loader instead of the API', async () => {
    const loadPage = vi.fn(async (_required: { status: CommentStatus; cursor: string }) => ({ items: [C2], nextCursor: null }));
    const { controller, api } = seeded({}, { loadPage });
    await controller.loadMore();
    expect(loadPage).toHaveBeenCalledWith({ status: 'pending', cursor: 'k1' });
    expect(api.listCommentsQueue).not.toHaveBeenCalled();
    expect(controller.getSnapshot().items).toEqual([C1, C2]);
  });

  it('marks loadingMore while the read is in flight', () => {
    const { controller } = seeded({}, { loadPage: () => new Promise(() => {}) });
    void controller.loadMore();
    expect(controller.getSnapshot().loadingMore).toBe(true);
  });

  it('ignores a second same-tick call while one is in flight', async () => {
    const pending = deferred<AdminCommentsQueuePage>();
    const loadPage = vi.fn(() => pending.promise);
    const { controller } = seeded({}, { loadPage });
    const first = controller.loadMore();
    await controller.loadMore();
    pending.resolve({ items: [C2], nextCursor: null });
    await first;
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('does nothing after dispose', async () => {
    const loadPage = vi.fn(async () => ({ items: [C2], nextCursor: null }));
    const { controller } = seeded({}, { loadPage });
    controller.dispose();
    await controller.loadMore();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('publishes the error message of a failed read and unlocks', async () => {
    const { controller } = seeded({}, { loadPage: async () => { throw new AdminApiError({ message: 'Queue read failed (503)', status: 503 }); } });
    await controller.loadMore();
    expect(controller.getSnapshot()).toMatchObject({ error: 'Queue read failed (503)', loadingMore: false, items: [C1], nextCursor: 'k1' });
  });

  it('falls back to the translated message when a failure is not an Error', async () => {
    const t: CommentsTranslator = key => `es:${key}`;
    const { controller } = seeded({}, { t, loadPage: () => Promise.reject('offline') });
    await controller.loadMore();
    expect(controller.getSnapshot().error).toBe('es:failed to load the moderation queue');
  });

  it('clears a prior failure as soon as a retry starts', async () => {
    let calls = 0;
    const { controller } = seeded({}, { loadPage: () => (++calls === 1 ? Promise.reject(new Error('first failed')) : new Promise(() => {})) });
    await controller.loadMore();
    void controller.loadMore();
    expect(controller.getSnapshot().error).toBeNull();
  });

  it('drops a page that settles after a status switch superseded it', async () => {
    const pending = deferred<AdminCommentsQueuePage>();
    const { controller } = seeded({}, { loadPage: () => pending.promise });
    const run = controller.loadMore();
    controller.setStatus({ status: 'spam' });
    pending.resolve({ items: [C2], nextCursor: 'k2' });
    await run;
    expect(controller.getSnapshot()).toMatchObject({ status: 'spam', items: null, nextCursor: null, loadingMore: false });
  });

  it('drops a failure that settles after a refreshed page one superseded it', async () => {
    const pending = deferred<AdminCommentsQueuePage>();
    const { controller } = seeded({}, { loadPage: () => pending.promise });
    const run = controller.loadMore();
    controller.settleFirstPage({ page: { items: [C3], nextCursor: null }, error: null, status: 'pending' });
    pending.reject(new Error('late failure'));
    await run;
    expect(controller.getSnapshot()).toMatchObject({ items: [C3], error: null, loadingMore: false });
  });

  it('does not let a superseded call unlock the newer in-flight call', async () => {
    const old = deferred<AdminCommentsQueuePage>();
    const reads: Array<Promise<AdminCommentsQueuePage>> = [old.promise, new Promise(() => {})];
    const { controller } = seeded({}, { loadPage: () => reads.shift()! });
    const stale = controller.loadMore();
    controller.settleFirstPage({ page: { items: [C3], nextCursor: 'k9' }, error: null, status: 'pending' });
    void controller.loadMore();
    old.resolve({ items: [C2], nextCursor: null });
    await stale;
    expect(controller.getSnapshot()).toMatchObject({ items: [C3], nextCursor: 'k9', loadingMore: true });
  });

  it('leaves the snapshot untouched when disposed mid-read', async () => {
    const pending = deferred<AdminCommentsQueuePage>();
    const { controller } = seeded({}, { loadPage: () => pending.promise });
    const run = controller.loadMore();
    const before = controller.getSnapshot();
    controller.dispose();
    pending.resolve({ items: [C2], nextCursor: null });
    await run;
    expect(controller.getSnapshot()).toBe(before);
  });

  it('leaves the snapshot untouched when a read fails after dispose', async () => {
    const pending = deferred<AdminCommentsQueuePage>();
    const { controller } = seeded({}, { loadPage: () => pending.promise });
    const run = controller.loadMore();
    const before = controller.getSnapshot();
    controller.dispose();
    pending.reject(new Error('late failure'));
    await run;
    expect(controller.getSnapshot()).toBe(before);
  });
});

describe('createCommentQueueController page one and status', () => {
  it('ignores a page one settlement for another status', () => {
    const { controller } = seeded();
    controller.settleFirstPage({ page: { items: [C3], nextCursor: null }, error: null, status: 'spam' });
    expect(controller.getSnapshot().items).toEqual([C1]);
  });

  it('ignores a page one settlement after dispose', () => {
    const controller = createCommentQueueController({ api: fakeApi() });
    controller.dispose();
    controller.settleFirstPage({ page: { items: [C3], nextCursor: null }, error: null, status: 'pending' });
    expect(controller.getSnapshot().items).toBeNull();
  });

  it('keeps rendered rows and appended pages on an error-only notification', async () => {
    const { controller, page } = seeded({}, { loadPage: async () => ({ items: [C2], nextCursor: null }) });
    await controller.loadMore();
    controller.settleFirstPage({ page, error: new Error('refresh failed'), status: 'pending' });
    expect(controller.getSnapshot()).toMatchObject({ items: [C1, C2], error: 'refresh failed' });
  });

  it('describes a page one failure with no page as an error and no rows', () => {
    const controller = createCommentQueueController({ api: fakeApi() });
    controller.settleFirstPage({ page: null, error: new AdminApiError({ message: '', status: 500 }), status: 'pending' });
    expect(controller.getSnapshot()).toMatchObject({ items: null, nextCursor: null, error: 'failed to load the moderation queue' });
  });

  it('ignores switching to the current status', () => {
    const { controller } = seeded();
    const before = controller.getSnapshot();
    controller.setStatus({ status: 'pending' });
    expect(controller.getSnapshot()).toBe(before);
  });

  it('ignores a status switch after dispose', () => {
    const { controller } = seeded();
    controller.dispose();
    controller.setStatus({ status: 'spam' });
    expect(controller.getSnapshot().status).toBe('pending');
  });

  it('ignores configure after dispose', () => {
    const { controller } = seeded({ permissions: [] });
    controller.dispose();
    controller.configure({ permissions: ALL, t: key => `x:${key}` });
    expect(controller.getSnapshot().items).toEqual([C1]);
  });

  it('applies a configured translator to the published error', () => {
    const controller = createCommentQueueController({ api: fakeApi() });
    controller.settleFirstPage({ page: null, error: new AdminApiError({ message: '', status: 500 }), status: 'pending' });
    controller.configure({ permissions: ALL, t: key => `x:${key}` });
    expect(controller.getSnapshot().error).toBe('x:failed to load the moderation queue');
  });

  it('reports an empty row state for an untouched row', () => {
    expect(seeded().controller.stateFor({ id: 'zz' })).toEqual({ busy: false, error: null });
  });
});

describe('createCommentQueueController moderation', () => {
  it('requires comments.delete for trash', async () => {
    const { controller, api } = seeded({ permissions: ['comments.moderate'] });
    await controller.onModerate({ comment: C1, action: 'trash' });
    expect(api.moderateComment).not.toHaveBeenCalled();
  });

  it('requires comments.moderate for approve', async () => {
    const { controller, api } = seeded({ permissions: ['comments.delete'] });
    await controller.onModerate({ comment: C1, action: 'approve' });
    expect(api.moderateComment).not.toHaveBeenCalled();
  });

  it('trashes with comments.delete and invalidates every cached status', async () => {
    const onInvalidate = vi.fn();
    const { controller, api } = seeded({ permissions: ['comments.delete'] }, { onInvalidate });
    await controller.onModerate({ comment: C1, action: 'trash' });
    expect(api.moderateComment).toHaveBeenCalledWith({ commentId: 'c1', action: 'trash', expectedVersion: 1 });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it('ignores a second same-tick action on a busy row', async () => {
    const pending = deferred<void>();
    const api = fakeApi({ moderateComment: vi.fn(() => pending.promise) });
    const { controller } = seeded({ api });
    const first = controller.onModerate({ comment: C1, action: 'approve' });
    await controller.onModerate({ comment: C1, action: 'spam' });
    pending.resolve();
    await first;
    expect(api.moderateComment).toHaveBeenCalledTimes(1);
  });

  it('marks the row busy while the action is in flight', () => {
    const api = fakeApi({ moderateComment: vi.fn(() => new Promise<void>(() => {})) });
    const { controller } = seeded({ api });
    void controller.onModerate({ comment: C1, action: 'approve' });
    expect(controller.stateFor({ id: 'c1' })).toEqual({ busy: true, error: null });
  });

  it('puts a failed action error on the row', async () => {
    const api = fakeApi({ moderateComment: vi.fn(async () => { throw new AdminApiError({ message: 'Moderation refused', status: 403 }); }) });
    const { controller } = seeded({ api });
    await controller.onModerate({ comment: C1, action: 'approve' });
    expect(controller.stateFor({ id: 'c1' })).toEqual({ busy: false, error: 'Moderation refused' });
  });

  it('does not reload when disposed before the action settles', async () => {
    const onInvalidate = vi.fn();
    const pending = deferred<void>();
    const { controller } = seeded({ api: fakeApi({ moderateComment: vi.fn(() => pending.promise) }) }, { onInvalidate });
    const run = controller.onModerate({ comment: C1, action: 'approve' });
    controller.dispose();
    pending.resolve();
    await run;
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it('ignores an action after dispose', async () => {
    const { controller, api } = seeded();
    controller.dispose();
    await controller.onModerate({ comment: C1, action: 'approve' });
    expect(api.moderateComment).not.toHaveBeenCalled();
  });
});

describe('createCommentQueueController purge', () => {
  it('does nothing without a pending purge', async () => {
    const { controller, api } = seeded();
    await controller.onPurge();
    expect(api.purgeComment).not.toHaveBeenCalled();
  });

  it('requires comments.delete.force', async () => {
    const { controller, api } = seeded({ permissions: ['comments.delete'] });
    controller.setPendingPurge({ comment: C1 });
    await controller.onPurge();
    expect(api.purgeComment).not.toHaveBeenCalled();
  });

  it('purges, invalidates and closes the confirmation', async () => {
    const onInvalidate = vi.fn();
    const { controller, api } = seeded({}, { onInvalidate });
    controller.setPendingPurge({ comment: C1 });
    await controller.onPurge();
    expect(api.purgeComment).toHaveBeenCalledWith({ commentId: 'c1' });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().pendingPurge).toBeNull();
  });

  it('keeps a failed purge error on the row with the translated fallback and closes the confirmation', async () => {
    const api = fakeApi({ purgeComment: vi.fn(() => Promise.reject('gone')) });
    const { controller } = seeded({ api }, { t: key => `es:${key}` });
    controller.setPendingPurge({ comment: C1 });
    await controller.onPurge();
    expect(controller.stateFor({ id: 'c1' })).toEqual({ busy: false, error: 'es:Failed to purge comment.' });
    expect(controller.getSnapshot().pendingPurge).toBeNull();
  });

  it('ignores a purge while the row is busy with a moderation', async () => {
    const api = fakeApi({ moderateComment: vi.fn(() => new Promise<void>(() => {})) });
    const { controller } = seeded({ api });
    void controller.onModerate({ comment: C1, action: 'approve' });
    controller.setPendingPurge({ comment: C1 });
    await controller.onPurge();
    expect(api.purgeComment).not.toHaveBeenCalled();
  });

  it('does not reload when disposed before the purge settles', async () => {
    const onInvalidate = vi.fn();
    const pending = deferred<void>();
    const { controller } = seeded({ api: fakeApi({ purgeComment: vi.fn(() => pending.promise) }) }, { onInvalidate });
    controller.setPendingPurge({ comment: C1 });
    const run = controller.onPurge();
    controller.dispose();
    pending.resolve();
    await run;
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it('ignores a purge after dispose', async () => {
    const { controller, api } = seeded();
    controller.setPendingPurge({ comment: C1 });
    controller.dispose();
    await controller.onPurge();
    expect(api.purgeComment).not.toHaveBeenCalled();
  });
});
