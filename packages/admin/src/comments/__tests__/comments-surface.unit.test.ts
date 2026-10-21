import { describe, expect, it, vi } from 'vitest';
import * as barrel from '../index.js';
import { createHttpCommentsApi, createHttpCommentsSession, type CommentsTransportPort } from '../adapters/http.js';
import { createCommentQueueController } from '../controllers/comment-queue.controller.js';
import { createCommentSettingsController } from '../controllers/comment-settings.controller.js';
import { createCommentsController } from '../controllers/comments.controller.js';
import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminComment, AdminCommentsPort, CommentsSettings } from '../../core/ports/comments.js';

const SETTINGS: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 5, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 20 };
const C1: AdminComment = { id: 'c1', entryId: 'e1', parentId: null, threadRootId: 'c1',
  depth: 0, status: 'pending', authorPrincipalId: null, authorName: 'Reader', authorEmail: null,
  authorUrl: null, authorIpHash: null, bodyText: 'Hello', spamScore: null, spamProvider: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };

type Call = { path: string; method: string; body?: unknown };
function recordingTransport(reply: (call: Call) => unknown = () => ({ data: SETTINGS })) {
  const calls: Call[] = [];
  const transport: CommentsTransportPort = {
    async request<T>(required: Call) { calls.push(required); return reply(required) as T; },
    url: ({ path }) => `https://host.test${path}`,
  };
  return { calls, transport };
}
function fakeApi(overrides: Partial<AdminCommentsPort> = {}): AdminCommentsPort {
  return {
    listCommentsQueue: vi.fn(async () => ({ items: [], nextCursor: null })),
    moderateComment: vi.fn(async () => undefined),
    purgeComment: vi.fn(async () => undefined),
    getCommentsSettings: vi.fn(async () => SETTINGS),
    putCommentsSettings: vi.fn(async () => SETTINGS),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function settingsForm(fields: Record<string, string>) { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; }

describe('comments HTTP adapter', () => {
  it('builds the queue query from every provided filter and trims a trailing slash off the base', async () => {
    const { calls, transport } = recordingTransport(() => ({ items: [], nextCursor: null }));
    const api = createHttpCommentsApi({ transport, basePath: '/workspaces/w1/comments/' });
    await api.listCommentsQueue({}, { status: 'spam', cursor: 'k2', limit: 25 });
    await api.listCommentsQueue({});
    expect(calls).toEqual([
      { path: '/workspaces/w1/comments/queue?status=spam&cursor=k2&limit=25', method: 'GET' },
      { path: '/workspaces/w1/comments/queue', method: 'GET' },
    ]);
  });

  it('sends moderation, purge and settings writes to their routes and unwraps settings data', async () => {
    const { calls, transport } = recordingTransport();
    const api = createHttpCommentsApi({ transport, basePath: '/c' });
    await api.moderateComment({ commentId: 'a/b', action: 'approve', expectedVersion: 3 }, { note: 'ok' });
    await api.purgeComment({ commentId: 'c1' });
    expect(await api.getCommentsSettings({})).toEqual(SETTINGS);
    expect(await api.putCommentsSettings({}, { maxDepth: 2 })).toEqual(SETTINGS);
    expect(await api.putCommentsSettings({})).toEqual(SETTINGS);
    expect(calls).toEqual([
      { path: '/c/a%2Fb/approve', method: 'POST', body: { expectedVersion: 3, note: 'ok' } },
      { path: '/c/c1/purge', method: 'POST', body: { note: undefined } },
      { path: '/c/settings', method: 'GET' },
      { path: '/c/settings', method: 'PUT', body: { maxDepth: 2 } },
      { path: '/c/settings', method: 'PUT', body: {} },
    ]);
  });

  it('adopts a host error carrying a numeric status as the shared AdminApiError, keeping code and body', async () => {
    const hostError = Object.assign(new Error('version conflict'), { status: 409, code: 'VERSION_CONFLICT', body: { currentVersion: 4 } });
    const { transport } = recordingTransport(() => { throw hostError; });
    const failure = await createHttpCommentsApi({ transport, basePath: '/c' }).getCommentsSettings({}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AdminApiError);
    expect(failure).toMatchObject({ message: 'version conflict', status: 409, code: 'VERSION_CONFLICT', body: { currentVersion: 4 } });
  });

  it('rethrows errors it cannot decode unchanged', async () => {
    const already = new AdminApiError({ message: 'gone', status: 410 });
    const plain = new Error('socket hang up');
    const textStatus = Object.assign(new Error('odd'), { status: '500' });
    for (const thrown of [already, plain, textStatus, 'not an error']) {
      const { transport } = recordingTransport(() => { throw thrown; });
      await expect(createHttpCommentsApi({ transport, basePath: '/c' }).listCommentsQueue({})).rejects.toBe(thrown);
    }
  });

  it('reads the session principal over the host auth path', async () => {
    const me = { principalId: 'p1', effectivePermissions: ['comments.moderate'] };
    const { calls, transport } = recordingTransport(() => me);
    expect(await createHttpCommentsSession({ transport, path: '/auth/me' }).me({})).toBe(me);
    expect(calls).toEqual([{ path: '/auth/me', method: 'GET' }]);
  });
});

describe('comments controllers edge outcomes', () => {
  it('treats a permissions payload without grants as an empty grant list', () => {
    const controller = createCommentsController({});
    controller.settle({ data: {}, error: null });
    expect(controller.getSnapshot()).toEqual({ permissions: [], error: null });
  });

  it('applies new grants without republishing pages when the translator is unchanged', async () => {
    const api = fakeApi();
    const controller = createCommentQueueController({ api, permissions: [] });
    controller.settleFirstPage({ page: { items: [C1], nextCursor: null }, error: null, status: 'pending' });
    const listener = vi.fn();
    controller.subscribe({ listener });
    controller.configure({ permissions: ['comments.moderate'], t: barrel.englishComments });
    expect(listener).not.toHaveBeenCalled();
    await controller.onModerate({ comment: C1, action: 'approve' });
    expect(api.moderateComment).toHaveBeenCalledWith({ commentId: 'c1', action: 'approve', expectedVersion: 1 });
  });

  it('honours a live grant change but ignores settings configure after dispose', () => {
    const controller = createCommentSettingsController({ api: fakeApi(), permissions: [] });
    controller.configure({ permissions: ['comments.configure'], t: barrel.englishComments });
    controller.settleRead({ settings: null, error: new Error('down') });
    expect(controller.getSnapshot().error).toBe('down');
    controller.dispose();
    controller.configure({ permissions: [], t: key => `x:${key}` });
    expect(controller.getSnapshot()).toEqual({ settings: null, error: 'down', saving: false, notice: null });
  });

  it('drops a save reply that lands after dispose without notifying or invalidating', async () => {
    const reply = deferred<CommentsSettings>();
    const onInvalidate = vi.fn();
    const put = vi.fn(async () => ({ ...SETTINGS, enabled: false })).mockImplementationOnce(async () => ({ ...SETTINGS, enabled: false })).mockImplementation(() => reply.promise);
    const controller = createCommentSettingsController({ api: fakeApi({ putCommentsSettings: put }), permissions: ['comments.configure'] }, { onInvalidate });
    controller.settleRead({ settings: SETTINGS, error: null });
    await controller.save({ form: settingsForm({ enabled: 'on', requireModeration: 'on', spamAutoRejectScore: '2' }) });
    expect(controller.getSnapshot().error).toBe('Spam auto-reject score must be between 0 and 1.');
    await controller.save({ form: settingsForm({ requireModeration: 'on' }) });
    expect(controller.getSnapshot()).toMatchObject({ settings: { ...SETTINGS, enabled: false }, notice: 'Saved.' });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    const saving = controller.save({ form: settingsForm({ requireModeration: 'on', maxDepth: '3' }) });
    controller.dispose();
    reply.resolve({ ...SETTINGS, enabled: false, maxDepth: 3 });
    await saving;
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().settings).toEqual({ ...SETTINGS, enabled: false });
    expect(controller.getSnapshot().notice).toBeNull();
  });

  it('shows the translated save fallback when the backend rejects with a non-Error value', async () => {
    const controller = createCommentSettingsController({ api: fakeApi({ putCommentsSettings: async () => { throw 'nope'; } }), permissions: ['comments.configure'] }, { t: key => `x:${key}` });
    controller.settleRead({ settings: SETTINGS, error: null });
    await controller.save({ form: settingsForm({ enabled: 'on', requireModeration: 'on', maxDepth: '3' }) });
    expect(controller.getSnapshot()).toMatchObject({ saving: false, notice: null, error: 'x:failed to save Comments settings' });
  });
});

describe('comments rules and copy through the public barrel', () => {
  it('keys each status queue under the shared queue root', () => {
    expect(barrel.KEYS.queue('spam')).toEqual(['comments', 'queue', 'spam']);
    expect(barrel.KEYS.queue('pending').slice(0, 2)).toEqual([...barrel.KEYS.queueRoot]);
  });

  it('leaves unknown copy keys and unfilled placeholders visible', () => {
    expect(barrel.englishComments('Not a known key {n}')).toBe('Not a known key {n}');
    expect(barrel.englishComments('Not a known key {n}', { n: 3 })).toBe('Not a known key 3');
  });

  it('treats numeric fields missing from the submitted form as unchanged', () => {
    const patch = barrel.buildSettingsPatch({ form: settingsForm({ enabled: 'on', requireModeration: 'on' }), current: SETTINGS });
    expect(patch).toEqual({});
  });
});
