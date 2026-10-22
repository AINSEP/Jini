import { describe, it, expect, vi } from 'vitest';
import { AdminApiError } from '../../core/transport/errors.js';
import { createMemoryWidgetsApi } from '../adapters/memory.js';
import { createWidgetRegionEditorController } from '../controllers/region-editor.controller.js';
import type { AdminWidgetsPort } from '../ports.js';
import type { AdminWidgetArea, AdminWidgetPlacement } from '../models.js';
import { deferred, flush, widgetRow } from './fixtures/controller-harness.js';

type RegionResult = { area: AdminWidgetArea; placements: AdminWidgetPlacement[] };
const area = (regionKey: string, version = 1): AdminWidgetArea => ({ id: `area-${regionKey}`, workspaceId: 'ws', regionKey, updatedAt: 'then', version });
const placement = (placementId: string, enabled = true): AdminWidgetPlacement => ({ placementId, widgetEntryId: 'w1', enabled, widgetTitle: 'Title w1', widgetType: 'text', broken: false });
function seeded() {
  return createMemoryWidgetsApi({ widgets: [widgetRow({ id: 'w1' }), widgetRow({ id: 'w2' })], areas: {
    sidebar: { area: area('sidebar'), placements: [placement('p1'), placement('p2', false)] },
    footer: { area: area('footer'), placements: [] },
  } });
}

describe('createWidgetRegionEditorController load', () => {
  it('starts loading and then shows the region placements', async () => {
    const c = createWidgetRegionEditorController({ api: seeded(), regionKey: 'sidebar' });
    expect(c.getSnapshot().loading).toBe(true);
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ area: { regionKey: 'sidebar' }, placements: [{ placementId: 'p1' }, { placementId: 'p2' }], loading: false, error: null });
  });

  it('shows the API error message when the read fails', async () => {
    const c = createWidgetRegionEditorController({ api: seeded(), regionKey: 'missing' });
    await c.load();
    expect(c.getSnapshot()).toMatchObject({ error: 'fake widget region not found: missing', loading: false });
  });

  it('shows the translated fallback when the read fails with a non-error value', async () => {
    const c = createWidgetRegionEditorController({ api: { ...seeded(), getWidgetRegion: () => Promise.reject('boom') }, regionKey: 'sidebar' }, { t: key => `T:${key}` });
    await c.load();
    expect(c.getSnapshot().error).toBe('T:failed to load region');
  });

  it('ignores a superseded read after the region key changes', async () => {
    const first = deferred<RegionResult>(), memory = seeded();
    const api: AdminWidgetsPort = { ...memory, getWidgetRegion: (input, options) => input.regionKey === 'sidebar' ? first.promise : memory.getWidgetRegion(input, options) };
    const c = createWidgetRegionEditorController({ api, regionKey: 'sidebar' });
    const stale = c.load();
    c.setRegionKey({ regionKey: 'footer' });
    await flush();
    first.resolve({ area: area('sidebar'), placements: [placement('late')] });
    await stale;
    expect(c.getSnapshot()).toMatchObject({ area: { regionKey: 'footer' }, placements: [], loading: false });
  });

  it('ignores a superseded read failure', async () => {
    const first = deferred<RegionResult>(), memory = seeded();
    const api: AdminWidgetsPort = { ...memory, getWidgetRegion: (input, options) => input.regionKey === 'sidebar' ? first.promise : memory.getWidgetRegion(input, options) };
    const c = createWidgetRegionEditorController({ api, regionKey: 'sidebar' });
    const stale = c.load();
    c.setRegionKey({ regionKey: 'footer' });
    await flush();
    first.reject(new Error('late failure'));
    await stale;
    expect(c.getSnapshot().error).toBeNull();
  });

  it('writes nothing after dispose', async () => {
    const pending = deferred<RegionResult>();
    const c = createWidgetRegionEditorController({ api: { ...seeded(), getWidgetRegion: () => pending.promise }, regionKey: 'sidebar' });
    const run = c.load();
    const before = c.getSnapshot();
    c.dispose();
    pending.resolve({ area: area('sidebar'), placements: [] });
    await run;
    expect(c.getSnapshot()).toBe(before);
  });
});

describe('createWidgetRegionEditorController placements', () => {
  it('adds a draft placement and fills its title once the lookup resolves', async () => {
    const c = createWidgetRegionEditorController({ api: seeded(), regionKey: 'sidebar' });
    await c.load();
    c.addPlacement({ widgetInstanceId: 'w2' });
    expect(c.getSnapshot().placements[2]).toMatchObject({ widgetEntryId: 'w2', widgetTitle: null, enabled: true });
    await flush();
    expect(c.getSnapshot().placements).toMatchObject([{ placementId: 'p1', widgetTitle: 'Title w1' }, { placementId: 'p2' }, { widgetEntryId: 'w2', widgetTitle: 'Title w2', widgetType: 'text' }]);
  });

  it('keeps an untitled draft when the lookup fails', async () => {
    const c = createWidgetRegionEditorController({ api: seeded(), regionKey: 'sidebar' });
    await c.load();
    c.addPlacement({ widgetInstanceId: 'missing' });
    await flush();
    expect(c.getSnapshot().placements[2]).toMatchObject({ widgetEntryId: 'missing', widgetTitle: null });
  });

  it('removes, moves and toggles placements by identity', async () => {
    const c = createWidgetRegionEditorController({ api: seeded(), regionKey: 'sidebar' });
    await c.load();
    c.moveAt({ index: 0, direction: 1 });
    expect(c.getSnapshot().placements.map(p => p.placementId)).toEqual(['p2', 'p1']);
    c.toggleEnabled({ placementId: 'p2' });
    expect(c.getSnapshot().placements.map(p => p.enabled)).toEqual([true, true]);
    c.removeAt({ placementId: 'p1' });
    expect(c.getSnapshot().placements.map(p => p.placementId)).toEqual(['p2']);
  });
});

describe('createWidgetRegionEditorController save', () => {
  it('does nothing before the region loaded', async () => {
    const api = seeded();
    const mutate = vi.spyOn(api, 'mutateWidgetRegionPlacements');
    await createWidgetRegionEditorController({ api, regionKey: 'sidebar' }).save();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('saves only the identity fields, reports the version and rereads', async () => {
    const api = seeded();
    const mutate = vi.spyOn(api, 'mutateWidgetRegionPlacements');
    const c = createWidgetRegionEditorController({ api, regionKey: 'sidebar' });
    await c.load();
    await c.save();
    expect(mutate).toHaveBeenCalledWith({ regionKey: 'sidebar', baseVersion: 1, placements: [{ placementId: 'p1', widgetEntryId: 'w1', enabled: true }, { placementId: 'p2', widgetEntryId: 'w1', enabled: false }] }, expect.anything());
    expect(c.getSnapshot()).toMatchObject({ message: 'Saved · version 2', saving: false, area: { version: 2 } });
    await flush();
    expect(c.getSnapshot()).toMatchObject({ loading: false, area: { version: 2 } });
  });

  it('maps a region conflict to the refresh message', async () => {
    const api = seeded();
    const c = createWidgetRegionEditorController({ api, regionKey: 'sidebar' });
    await c.load();
    await api.mutateWidgetRegionPlacements({ regionKey: 'sidebar', baseVersion: 1, placements: [] });
    await c.save();
    expect(c.getSnapshot()).toMatchObject({ error: 'This region changed since you loaded it, refresh and try again.', saving: false });
  });

  it('ignores a save result once the region key changed', async () => {
    const pending = deferred<{ area: AdminWidgetArea }>();
    const c = createWidgetRegionEditorController({ api: { ...seeded(), mutateWidgetRegionPlacements: () => pending.promise }, regionKey: 'sidebar' });
    await c.load();
    const run = c.save();
    c.setRegionKey({ regionKey: 'footer' });
    await flush();
    pending.resolve({ area: area('sidebar', 7) });
    await run;
    expect(c.getSnapshot()).toMatchObject({ area: { regionKey: 'footer' }, message: null });
  });

  it('ignores a save failure once the region key changed', async () => {
    const pending = deferred<{ area: AdminWidgetArea }>();
    const c = createWidgetRegionEditorController({ api: { ...seeded(), mutateWidgetRegionPlacements: () => pending.promise }, regionKey: 'sidebar' });
    await c.load();
    const run = c.save();
    c.setRegionKey({ regionKey: 'footer' });
    await flush();
    pending.reject(new AdminApiError({ message: 'late', status: 500 }));
    await run;
    expect(c.getSnapshot().error).toBeNull();
  });
});
