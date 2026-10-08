import type { AdminWidgetsPort } from '../ports.js';
/** Mutates an isolated adapter. Returns named checks and throws at the first contract failure. */
export async function runWidgetsApiConformance({ api }: { api: AdminWidgetsPort }, _optional: Record<string, never> = {}): Promise<readonly string[]> {
  const checks: string[] = [];
  function assert(condition: boolean, name: string) { if (!condition) throw new Error(`Widgets API conformance: ${name}`); checks.push(name); }
  async function rejects(run: () => Promise<unknown>, name: string) { let rejected = false; try { await run(); } catch { rejected = true; } assert(rejected, name); }
  const input = { widgetType: 'text', title: 'Conformance widget', config: { body: 'initial' } };
  const { widget } = await api.createWidget(input);
  assert(widget.id.length > 0 && widget.slug.length > 0 && widget.status === 'active', 'create active instance');
  input.config.body = 'caller changed';
  assert((await api.getWidget({ id: widget.id })).widget.config.body === 'initial', 'create copies config input');
  assert((await api.getWidget({ id: widget.slug })).widget.id === widget.id, 'get resolves slug or id');
  const firstList = await api.listWidgets({});
  assert(firstList.widgets.some(w => w.id === widget.id), 'active list includes created instance');
  assert((await api.listWidgets({ widgetType: 'social-links' })).widgets.every(w => w.widgetType === 'social-links'), 'type filter');
  const { widget: updated } = await api.updateWidget({ id: widget.id, baseVersion: widget.version, config: { body: 'updated' } });
  assert(updated.title === widget.title && updated.version > widget.version, 'omitted title preserved and version advances');
  assert(widget.config.body === 'initial' && firstList.widgets.find(w => w.id === widget.id)?.version === widget.version, 'prior snapshots stay detached');
  await rejects(() => api.updateWidget({ id: widget.id, baseVersion: widget.version, config: {} }), 'stale instance write rejects');
  const regionKey = `conformance-${widget.id}`;
  const { area } = await api.bindWidgetRegion({ regionKey });
  const initialAreaVersion = area.version;
  assert((await api.listWidgetRegions({})).regions.some(r => r.regionKey === regionKey), 'bound region listed');
  assert((await api.getWidgetRegion({ regionKey })).placements.length === 0, 'new region empty');
  const placements = [
    { placementId: 'p-one', widgetEntryId: widget.id, enabled: false },
    { placementId: 'p-two', widgetEntryId: widget.id, enabled: true },
    { placementId: 'p-broken', widgetEntryId: 'missing-conformance-widget', enabled: true },
  ];
  const { area: savedArea } = await api.mutateWidgetRegionPlacements({ regionKey, baseVersion: area.version, placements });
  assert(savedArea.version > area.version && area.version === initialAreaVersion, 'region version advances without mutating old snapshot');
  const placed = await api.getWidgetRegion({ regionKey });
  assert(placed.placements.map(p => p.placementId).join() === placements.map(p => p.placementId).join(), 'ordered placement identities and repeated refs retained');
  assert(placed.placements[0]?.enabled === false && placed.placements[1]?.widgetTitle === updated.title, 'placement enabled and title projection');
  assert(placed.placements[2]?.broken === true, 'broken reference remains visible');
  assert((await api.listWidgetRegions({})).regions.find(r => r.regionKey === regionKey)?.placementCount === placements.length, 'region list placement count updates');
  await rejects(() => api.mutateWidgetRegionPlacements({ regionKey, baseVersion: area.version, placements: [] }), 'stale region write rejects');
  const abort = new AbortController(); abort.abort();
  await rejects(() => api.listWidgets({}, { signal: abort.signal }), 'aborted list rejects');
  await rejects(() => api.updateWidget({ id: widget.id, baseVersion: updated.version, title: 'must not save', config: {} }, { signal: abort.signal }), 'aborted write rejects');
  assert((await api.getWidget({ id: widget.id })).widget.title === widget.title, 'aborted write has no effects');
  await rejects(() => api.getWidget({ id: 'missing-conformance-widget' }), 'missing instance rejects');
  await rejects(() => api.getWidgetRegion({ regionKey: 'missing-conformance-region' }), 'missing region rejects');
  await api.trashWidget({ id: widget.id });
  assert(!(await api.listWidgets({})).widgets.some(w => w.id === widget.id), 'trash removes active listing');
  assert((await api.listWidgets({ includeInactive: true })).widgets.find(w => w.id === widget.id)?.status === 'trash', 'trash retained for shared lifecycle');
  return checks;
}
