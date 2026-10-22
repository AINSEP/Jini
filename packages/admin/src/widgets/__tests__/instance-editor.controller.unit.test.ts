import { describe, it, expect, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import { createMemoryWidgetsApi } from '../adapters/memory.js';
import { createWidgetInstanceEditorController } from '../controllers/instance-editor.controller.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidget, AdminWidgetWhereUsed } from '../models.js';
import { deferred, flush, widgetRow } from './fixtures/controller-harness.js';

const defaultConfig = (type: string) => ({ defaultFor: type });
const existing = { widgetId: 'w1', widgetType: null };
function setup(api: AdminWidgetsPort, optional: Parameters<typeof createWidgetInstanceEditorController>[1] = {}, params: { widgetId: string | null; widgetType: string | null } = existing) {
  return createWidgetInstanceEditorController({ api, params, defaultConfig }, optional);
}

describe('createWidgetInstanceEditorController load', () => {
  it('starts a create editor with the type default config and no loading', async () => {
    const c = setup(createMemoryWidgetsApi({}), {}, { widgetId: null, widgetType: 'social-links' });
    expect(c.getSnapshot()).toMatchObject({ isNew: true, loading: false, config: { defaultFor: 'social-links' }, widgetType: 'social-links' });
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ isNew: true, widget: null, title: '', loading: false, widgetType: 'social-links' });
  });

  it('falls back to the text default config when the create route names no type', async () => {
    const c = setup(createMemoryWidgetsApi({}), {}, { widgetId: null, widgetType: null });
    await c.load();
    expect(c.getSnapshot().config).toEqual({ defaultFor: 'text' });
  });

  it('loads an existing widget into the editor fields', async () => {
    const whereUsed: AdminWidgetWhereUsed = { count: 1, references: [{ kind: 'region', sourceEntryId: 'a1', fieldPath: 'p' }] };
    const c = setup(createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })], whereUsed: { w1: whereUsed } }));
    expect(c.getSnapshot()).toMatchObject({ loading: true, config: {} });
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ isNew: false, loading: false, error: null, title: 'Title w1', config: { body: 'w1' }, whereUsed, widgetType: 'text' });
  });

  it('marks a reload as loading while the read is in flight', async () => {
    const c = setup(createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] }));
    await c.load();
    const run = c.load();
    expect(c.getSnapshot()).toMatchObject({ loading: true, error: null });
    await run;
    expect(c.getSnapshot().loading).toBe(false);
  });

  it('replaces the route when the host slug rule redirects', async () => {
    const navigate = vi.fn();
    const slugRedirectPath = vi.fn((base: string, requestedId: string, item: { id: string; slug: string }) => `${base}/${item.slug}?from=${requestedId}`);
    await setup(createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] }), { navigate, slugRedirectPath }).load();
    expect(navigate).toHaveBeenCalledWith('/widgets/w1-slug?from=w1', { replace: true });
  });

  it('does not navigate when the slug rule returns null', async () => {
    const navigate = vi.fn();
    await setup(createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] }), { navigate, slugRedirectPath: () => null }).load();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the API error message when the read fails', async () => {
    const c = setup(createMemoryWidgetsApi({}));
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ error: 'fake widget not found: w1', loading: false });
  });

  it('shows the translated fallback when the read fails with a non-error value', async () => {
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), getWidget: () => Promise.reject('boom') };
    const c = setup(api, { t: key => `T:${key}` });
    await c.load();
    expect(c.getSnapshot().error).toBe('T:failed to load widget');
  });

  it('ignores a superseded read after the route params change', async () => {
    const first = deferred<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>();
    const memory = createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w2' })] });
    const api: AdminWidgetsPort = { ...memory, getWidget: (input, options) => input.id === 'w1' ? first.promise : memory.getWidget(input, options) };
    const c = setup(api);
    const stale = c.load();
    c.setParams({ params: { widgetId: 'w2', widgetType: null } });
    await flush();
    first.resolve({ widget: widgetRow({ id: 'w1' }), whereUsed: { count: 0, references: [] } });
    await stale;
    expect(c.getSnapshot()).toMatchObject({ title: 'Title w2', loading: false });
  });

  it('ignores a superseded read failure', async () => {
    const first = deferred<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>();
    const memory = createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w2' })] });
    const api: AdminWidgetsPort = { ...memory, getWidget: (input, options) => input.id === 'w1' ? first.promise : memory.getWidget(input, options) };
    const c = setup(api);
    const stale = c.load();
    c.setParams({ params: { widgetId: 'w2', widgetType: null } });
    await flush();
    first.reject(new Error('late failure'));
    await stale;
    expect(c.getSnapshot().error).toBeNull();
  });

  it('writes nothing after dispose', async () => {
    const pending = deferred<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>();
    const c = setup({ ...createMemoryWidgetsApi({}), getWidget: () => pending.promise });
    const run = c.load();
    const before = c.getSnapshot();
    c.dispose();
    pending.resolve({ widget: widgetRow({ id: 'w1' }), whereUsed: { count: 0, references: [] } });
    await run;
    expect(c.getSnapshot()).toBe(before);
  });

  it('keeps a stale existing-widget load error after switching to the create route (reported, not fixed)', async () => {
    const c = setup(createMemoryWidgetsApi({}));
    await c.load();
    c.setParams({ params: { widgetId: null, widgetType: 'text' } });
    await flush();
    expect(c.getSnapshot()).toMatchObject({ isNew: true, error: 'fake widget not found: w1' });
  });
});

describe('createWidgetInstanceEditorController save', () => {
  it('does nothing without a resolved widget type', async () => {
    const api = createMemoryWidgetsApi({});
    const create = vi.spyOn(api, 'createWidget');
    const c = setup(api, {}, { widgetId: null, widgetType: null });
    await c.save();
    expect(create).not.toHaveBeenCalled();
    expect(c.getSnapshot().saving).toBe(false);
  });

  it('creates a new widget and navigates to its slug', async () => {
    const navigate = vi.fn();
    const api = createMemoryWidgetsApi({});
    const c = setup(api, { navigate }, { widgetId: null, widgetType: 'text' });
    c.setTitle({ title: 'Fresh' });
    c.setConfig({ config: { body: 'x' } });
    await c.save();
    expect(api.widgets[0]).toMatchObject({ title: 'Fresh', config: { body: 'x' } });
    expect(navigate).toHaveBeenCalledWith('/widgets/fake-slug-1');
    expect(c.getSnapshot().saving).toBe(false);
  });

  it('updates an existing widget and reports the saved version', async () => {
    const c = setup(createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] }));
    await c.load();
    c.setTitle({ title: 'Renamed' });
    await c.save();
    expect(c.getSnapshot()).toMatchObject({ title: 'Renamed', message: 'Saved · version 2', saving: false, widget: { version: 2 } });
  });

  it('does not update when the existing widget never loaded', async () => {
    const api = createMemoryWidgetsApi({});
    const update = vi.spyOn(api, 'updateWidget');
    const c = setup(api, {}, { widgetId: null, widgetType: 'text' });
    c.setParams({ params: { widgetId: 'w1', widgetType: null } });
    await flush();
    expect(c.getSnapshot()).toMatchObject({ isNew: false, widget: null, widgetType: 'text' });
    await c.save();
    expect(update).not.toHaveBeenCalled();
    expect(c.getSnapshot().saving).toBe(false);
  });

  it('maps a version conflict to the refresh message', async () => {
    const api = createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] });
    const c = setup(api);
    await c.load();
    await api.updateWidget({ id: 'w1', baseVersion: 1, config: {} });
    await c.save();
    expect(c.getSnapshot()).toMatchObject({ error: 'This widget changed since you loaded it, refresh and try again.', fieldErrors: [], saving: false });
  });

  it('ignores a save result once the editor identity changed', async () => {
    const pending = deferred<{ widget: AdminWidget }>();
    let entity = 'a';
    const memory = createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] });
    const c = setup({ ...memory, updateWidget: () => pending.promise }, { getEntityKey: () => entity });
    await c.load();
    const run = c.save();
    entity = 'b';
    pending.resolve({ widget: widgetRow({ id: 'w1' }, { version: 9 }) });
    await run;
    expect(c.getSnapshot()).toMatchObject({ saving: true, message: null });
  });

  it('ignores a save failure once the editor identity changed', async () => {
    const pending = deferred<{ widget: AdminWidget }>();
    let entity = 'a';
    const memory = createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' })] });
    const c = setup({ ...memory, updateWidget: () => pending.promise }, { getEntityKey: () => entity });
    await c.load();
    const run = c.save();
    entity = 'b';
    pending.reject(new AdminApiError({ message: 'late', status: 500 }));
    await run;
    expect(c.getSnapshot()).toMatchObject({ saving: true, error: null });
  });
});
