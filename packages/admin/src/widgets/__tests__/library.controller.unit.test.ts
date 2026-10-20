import { describe, it, expect, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import { createMemoryWidgetsApi } from '../adapters/memory.js';
import { createWidgetsLibraryController } from '../controllers/library.controller.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidget } from '../models.js';
import { deferred, flush, widgetRow } from './fixtures/controller-harness.js';

type ListResult = Awaited<ReturnType<AdminWidgetsPort['listWidgets']>>;
const w1 = widgetRow({ id: 'w1' }), w2 = widgetRow({ id: 'w2' });
function failingTrash(error: unknown, seed: AdminWidget[] = [w1]): AdminWidgetsPort {
  return { ...createMemoryWidgetsApi({ widgets: seed }), trashWidget: () => Promise.reject(error) };
}

describe('createWidgetsLibraryController load', () => {
  it('lists active widgets with zero skipped rows by default', async () => {
    const c = createWidgetsLibraryController({ api: createMemoryWidgetsApi({ widgets: [w1, widgetRow({ id: 'gone' }, { status: 'trash' })] }) });
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ widgets: [w1], skippedCount: 0, skippedIds: [], error: null });
  });

  it('passes through the skipped malformed rows the server reported', async () => {
    const c = createWidgetsLibraryController({ api: createMemoryWidgetsApi({ skippedCount: 2, skippedIds: ['a', 'b'] }) });
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ widgets: [], skippedCount: 2, skippedIds: ['a', 'b'] });
  });

  it('shows the API error message when the list fails', async () => {
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), listWidgets: () => Promise.reject(new AdminApiError({ message: 'list denied', status: 403 })) };
    const c = createWidgetsLibraryController({ api });
    await c.load();
    expect(c.getSnapshot().error).toBe('list denied');
  });

  it('shows the translated fallback when the list fails with a non-error value', async () => {
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), listWidgets: () => Promise.reject('boom') };
    const c = createWidgetsLibraryController({ api }, { t: key => `T:${key}` });
    await c.load();
    expect(c.getSnapshot().error).toBe('T:failed to load widgets');
  });

  it('lets the latest read win over an earlier one that settles later', async () => {
    const first = deferred<ListResult>(), firstFail = deferred<ListResult>();
    const replies = [first.promise, firstFail.promise, Promise.resolve({ widgets: [w2] })];
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), listWidgets: () => replies.shift()! };
    const c = createWidgetsLibraryController({ api });
    const a = c.load(), b = c.load();
    await c.load();
    first.resolve({ widgets: [w1] });
    firstFail.reject(new Error('late failure'));
    await Promise.all([a, b]);
    expect(c.getSnapshot()).toMatchObject({ widgets: [w2], error: null });
  });

  it('writes nothing after dispose', async () => {
    const pending = deferred<ListResult>();
    const c = createWidgetsLibraryController({ api: { ...createMemoryWidgetsApi({}), listWidgets: () => pending.promise } });
    const run = c.load();
    const before = c.getSnapshot();
    c.dispose();
    pending.resolve({ widgets: [w1] });
    await run;
    expect(c.getSnapshot()).toBe(before);
  });
});

describe('createWidgetsLibraryController trash flow', () => {
  it('does nothing when no trash is pending', async () => {
    const api = createMemoryWidgetsApi({ widgets: [w1] });
    const trash = vi.spyOn(api, 'trashWidget');
    await createWidgetsLibraryController({ api }).confirmTrash();
    expect(trash).not.toHaveBeenCalled();
  });

  it('request clears the error and cancel closes the dialog', () => {
    const c = createWidgetsLibraryController({ api: createMemoryWidgetsApi({}) });
    c.requestTrash({ widget: w1 });
    expect(c.getSnapshot()).toMatchObject({ pendingTrash: w1, error: null });
    c.cancelTrash();
    expect(c.getSnapshot().pendingTrash).toBeNull();
  });

  it('marks the confirmed widget as trashing while the request is in flight', async () => {
    const pending = deferred<{ ok: true; version: number | null }>();
    const c = createWidgetsLibraryController({ api: { ...createMemoryWidgetsApi({ widgets: [w1] }), trashWidget: () => pending.promise } });
    c.requestTrash({ widget: w1 });
    const run = c.confirmTrash();
    expect(c.getSnapshot().trashingId).toBe('w1');
    pending.resolve({ ok: true, version: 2 });
    await run;
    expect(c.getSnapshot()).toMatchObject({ trashingId: null, pendingTrash: null });
  });

  it('trashes the widget, closes the dialog and rereads the list', async () => {
    const api = createMemoryWidgetsApi({ widgets: [w1, w2] });
    const c = createWidgetsLibraryController({ api });
    await c.load();
    c.requestTrash({ widget: w1 });
    await c.confirmTrash();
    await flush();
    expect(c.getSnapshot()).toMatchObject({ widgets: [w2], pendingTrash: null, trashingId: null, error: null });
  });

  it('treats an already-missing widget as gone and rereads without an error', async () => {
    const api = failingTrash(new AdminApiError({ message: 'missing', status: 404 }, { code: 'NOT_FOUND' }));
    const list = vi.spyOn(api, 'listWidgets');
    const c = createWidgetsLibraryController({ api });
    c.requestTrash({ widget: w1 });
    await c.confirmTrash();
    expect(list).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toMatchObject({ error: null, pendingTrash: null });
  });

  it('maps a trash version change to the reload message', async () => {
    const c = createWidgetsLibraryController({ api: failingTrash(new AdminApiError({ message: 'changed', status: 409 }, { code: 'TRASH_VERSION_CHANGED' })) });
    c.requestTrash({ widget: w1 });
    await c.confirmTrash();
    expect(c.getSnapshot().error).toBe('This item changed since you loaded it. Reload and try again.');
  });

  it('shows any other API error message', async () => {
    const c = createWidgetsLibraryController({ api: failingTrash(new AdminApiError({ message: 'trash denied', status: 403 })) });
    c.requestTrash({ widget: w1 });
    await c.confirmTrash();
    expect(c.getSnapshot()).toMatchObject({ error: 'trash denied', pendingTrash: null, trashingId: null });
  });

  it('shows the translated fallback when trash fails with a non-error value', async () => {
    const c = createWidgetsLibraryController({ api: failingTrash('boom') }, { t: key => `T:${key}` });
    c.requestTrash({ widget: w1 });
    await c.confirmTrash();
    expect(c.getSnapshot().error).toBe('T:delete failed');
  });

  it('keeps a confirmation opened for another widget while the first trash settles', async () => {
    const pending = deferred<{ ok: true; version: number | null }>();
    const c = createWidgetsLibraryController({ api: { ...createMemoryWidgetsApi({ widgets: [w1, w2] }), trashWidget: () => pending.promise } });
    c.requestTrash({ widget: w1 });
    const run = c.confirmTrash();
    c.requestTrash({ widget: w2 });
    pending.resolve({ ok: true, version: 2 });
    await run;
    expect(c.getSnapshot()).toMatchObject({ pendingTrash: w2, trashingId: null });
  });

  it('keeps another in-flight trashing id when an older trash settles', async () => {
    const replies = [deferred<{ ok: true; version: number | null }>(), deferred<{ ok: true; version: number | null }>()];
    const queue = [...replies];
    const c = createWidgetsLibraryController({ api: { ...createMemoryWidgetsApi({ widgets: [w1, w2] }), trashWidget: () => queue.shift()!.promise } });
    c.requestTrash({ widget: w1 });
    const first = c.confirmTrash();
    c.requestTrash({ widget: w2 });
    const second = c.confirmTrash();
    replies[0]!.resolve({ ok: true, version: 2 });
    await first;
    expect(c.getSnapshot()).toMatchObject({ trashingId: 'w2', pendingTrash: w2 });
    replies[1]!.resolve({ ok: true, version: 2 });
    await second;
  });

  it('stores the chosen create type', () => {
    const c = createWidgetsLibraryController({ api: createMemoryWidgetsApi({}) });
    c.setCreateType({ type: 'social-links' });
    expect(c.getSnapshot().createType).toBe('social-links');
  });
});
